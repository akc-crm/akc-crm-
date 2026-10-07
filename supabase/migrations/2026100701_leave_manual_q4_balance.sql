-- Remaining leave entered by Admin is the available balance AFTER pending
-- reservations. Preserve approved/pending allocations and stop accrual in 2026.
create table if not exists public.employee_leave_2026_overrides (
 employee_id uuid primary key references public.profiles(id) on delete cascade,
 remaining_at_entry integer not null check (remaining_at_entry between 0 and 12),
 allowance integer not null check (allowance >= remaining_at_entry),
 updated_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now()
);
alter table public.employee_leave_2026_overrides enable row level security;
create policy leave_2026_override_read on public.employee_leave_2026_overrides
 for select to authenticated using (
  employee_id=auth.uid() or akc_profile_role()='admin' or
  (akc_profile_role()='manager' and exists(
   select 1 from profiles p where p.id=employee_id and akc_can_access_branch(p.branch_id::text)
  ))
 );
revoke all on public.employee_leave_2026_overrides from anon, authenticated;
grant select on public.employee_leave_2026_overrides to authenticated;

create or replace function public.leave_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- Missing hire dates are NOT invented. For existing staff entered in the 2026
-- transition, use a separate accrual anchor so 2027 needs no manual renewal.
create or replace function public.leave_allowance(
 hire_on date, manual_2026 integer, target_year integer, as_of date
) returns integer language sql immutable as $$
 select case
  when target_year <> extract(year from as_of)::int then 0
  when target_year=2026 and manual_2026 is not null then manual_2026
  when hire_on is not null then public.leave_accrued(hire_on,as_of)
  when target_year>=2027 and manual_2026 is not null
   then public.leave_accrued(date '2026-12-31',as_of)
  else 0 end
$$;

create or replace function public.set_leave_manual_2026(
 target_employee uuid, remaining_days integer
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare occupied integer; today date := public.leave_today();
begin
 if akc_profile_role() is distinct from 'admin' then raise exception 'Chỉ Admin được nhập số phép'; end if;
 if today < date '2026-10-01' or today > date '2026-12-31' then
  raise exception 'Nhập phép quý 4 chỉ áp dụng đến 31/12/2026';
 end if;
 if remaining_days is null or remaining_days < 0 or remaining_days > 12 then
  raise exception 'Số phép còn lại phải là số nguyên từ 0 đến 12';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(target_employee::text,0));
 if not exists(select 1 from profiles where id=target_employee and active=true) then
  raise exception 'Nhân sự không hoạt động hoặc không tồn tại';
 end if;
 select coalesce(sum(paid_days),0)::int into occupied from leave_requests
  where employee_id=target_employee and status in ('Chờ duyệt','Đã duyệt')
   and start_date >= date '2026-01-01' and start_date < date '2027-01-01';
 insert into employee_leave_2026_overrides(employee_id,remaining_at_entry,allowance,updated_by)
  values(target_employee,remaining_days,remaining_days+occupied,auth.uid())
 on conflict(employee_id) do update set remaining_at_entry=excluded.remaining_at_entry,
  allowance=excluded.allowance,updated_by=excluded.updated_by,updated_at=now();
end$$;
revoke all on function public.set_leave_manual_2026(uuid,integer) from public;
grant execute on function public.set_leave_manual_2026(uuid,integer) to authenticated;

create or replace view public.leave_balances with (security_invoker=true) as
 select p.id employee_id,p.branch_id,s.hire_date,
 public.leave_allowance(s.hire_date,o.allowance,extract(year from public.leave_today())::int,public.leave_today()) accrued,
 coalesce(sum(r.paid_days) filter(where r.status='Đã duyệt' and extract(year from r.start_date)=extract(year from public.leave_today())),0)::int used,
 coalesce(sum(r.paid_days) filter(where r.status='Chờ duyệt' and extract(year from r.start_date)=extract(year from public.leave_today())),0)::int reserved,
 greatest(0,public.leave_allowance(s.hire_date,o.allowance,extract(year from public.leave_today())::int,public.leave_today())
  -coalesce(sum(r.paid_days) filter(where r.status in ('Chờ duyệt','Đã duyệt') and extract(year from r.start_date)=extract(year from public.leave_today())),0))::int remaining
 from profiles p left join employee_leave_settings s on s.employee_id=p.id
 left join employee_leave_2026_overrides o on o.employee_id=p.id
 left join leave_requests r on r.employee_id=p.id
 where p.active=true group by p.id,p.branch_id,s.hire_date,o.allowance;
grant select on public.leave_balances to authenticated;

create or replace function public.submit_leave_request(
 target_employee uuid,start_on date,end_on date,leave_reason text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare employee profiles%rowtype; h date; manual integer; allowed integer;
 occupied integer; paid integer; days integer; result uuid; today date := public.leave_today();
begin
 if target_employee is null or auth.uid() is null then raise exception 'Phiên đăng nhập không hợp lệ'; end if;
 if target_employee<>auth.uid() and akc_profile_role() is distinct from 'admin' then raise exception 'Chỉ được gửi đơn cho chính mình';end if;
 if start_on is null or end_on is null or start_on<today or end_on<start_on or end_on-start_on>30 or extract(year from start_on)<>extract(year from end_on) then raise exception 'Khoảng nghỉ phải ở tương lai, trong cùng năm và tối đa 31 ngày';end if;
 if nullif(trim(leave_reason),'') is null then raise exception 'Cần nhập lý do nghỉ';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_employee::text,0));
 select * into employee from profiles where id=target_employee and active=true;
 if not found or employee.branch_id is null then raise exception 'Nhân sự chưa có cơ sở hoạt động';end if;
 select hire_date into h from employee_leave_settings where employee_id=target_employee;
 select allowance into manual from employee_leave_2026_overrides where employee_id=target_employee;
 if h is null and manual is null then raise exception 'Admin cần thiết lập ngày vào làm hoặc số phép quý 4 trước khi xin nghỉ';end if;
 allowed:=public.leave_allowance(h,manual,extract(year from start_on)::int,today);
 days:=end_on-start_on+1;
 if exists(select 1 from leave_requests where employee_id=target_employee and status in ('Chờ duyệt','Đã duyệt') and start_date<=end_on and end_date>=start_on) then raise exception 'Khoảng ngày này trùng đơn đã gửi';end if;
 select coalesce(sum(paid_days),0)::int into occupied from leave_requests
  where employee_id=target_employee and status in ('Chờ duyệt','Đã duyệt')
   and extract(year from start_date)=extract(year from start_on);
 paid:=least(days,greatest(0,allowed-occupied));
 insert into leave_requests(employee_id,branch_id,start_date,end_date,reason,paid_days,unpaid_days)
 values(target_employee,employee.branch_id,start_on,end_on,trim(leave_reason),paid,days-paid) returning id into result;
 return result;
end$$;
revoke all on function public.submit_leave_request(uuid,date,date,text) from public;
grant execute on function public.submit_leave_request(uuid,date,date,text) to authenticated;
