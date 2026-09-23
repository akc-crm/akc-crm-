-- Approved operations modules; existing BOARD data is untouched.
-- Requires 2026091901_operations_sprints_1_3.sql.
alter table public.internal_requests drop constraint if exists internal_requests_request_type_check;
alter table public.internal_requests add constraint internal_requests_request_type_check check(request_type in ('Nghỉ phép','Tạm ứng','Mua sắm','Sửa chữa','Bổ sung trang thiết bị','Dụng cụ tập luyện','Bảo trì','Bảo dưỡng','Sửa chữa CLB'));
create or replace function public.get_proposal_summary(target_branch uuid default null,target_category text default null,start_on date default null,end_on date default null)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('count',count(*),'amount',coalesce(sum(amount),0),'approved',count(*) filter(where status='Đã duyệt'))
 from internal_requests where request_type in ('Bổ sung trang thiết bị','Dụng cụ tập luyện','Bảo trì','Bảo dưỡng','Sửa chữa CLB')
 and (target_branch is null or branch_id=target_branch) and (target_category is null or request_type=target_category)
 and (start_on is null or created_at::date>=start_on) and (end_on is null or created_at::date<=end_on)
 and akc_profile_role() in ('admin','manager') $$;
revoke all on function public.get_proposal_summary(uuid,text,date,date) from public;
grant execute on function public.get_proposal_summary(uuid,text,date,date) to authenticated;

create table if not exists public.employee_leave_settings(
 employee_id uuid primary key references public.profiles(id) on delete cascade,
 hire_date date not null, created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.leave_requests(
 id uuid primary key default uuid_generate_v4(), employee_id uuid not null references public.profiles(id),
 branch_id uuid not null references public.branches(id), start_date date not null,end_date date not null,
 reason text not null, paid_days integer not null default 0,unpaid_days integer not null default 0,
 status text not null default 'Chờ duyệt' check(status in ('Chờ duyệt','Đã duyệt','Từ chối')),
 approver_id uuid references public.profiles(id),decision_note text not null default '',decided_at timestamptz,
 created_at timestamptz not null default now(),check(end_date>=start_date),check(paid_days>=0 and unpaid_days>=0)
);
create index if not exists idx_leave_employee_year on public.leave_requests(employee_id,start_date,status);
create index if not exists idx_leave_branch_pending on public.leave_requests(branch_id,created_at desc) where status='Chờ duyệt';
alter table public.employee_leave_settings enable row level security;
alter table public.leave_requests enable row level security;
create policy leave_settings_read on public.employee_leave_settings for select to authenticated using(employee_id=auth.uid() or akc_profile_role()='admin' or (akc_profile_role()='manager' and exists(select 1 from profiles p where p.id=employee_id and akc_can_access_branch(p.branch_id::text))));
create policy leave_requests_read on public.leave_requests for select to authenticated using(employee_id=auth.uid() or akc_profile_role()='admin' or (akc_profile_role()='manager' and akc_can_access_branch(branch_id::text)));
grant select on public.employee_leave_settings,public.leave_requests to authenticated;

-- A completed calendar month earns one day; reset at the start of each calendar year.
create or replace function public.leave_accrued(hire_date date,as_of date default current_date)
returns integer language sql immutable as $$
 select least(12,greatest(0,(extract(year from age(as_of,hire_date))::int*12+extract(month from age(as_of,hire_date))::int)
 -greatest(0,extract(year from age(make_date(extract(year from as_of)::int,1,1),hire_date))::int*12+extract(month from age(make_date(extract(year from as_of)::int,1,1),hire_date))::int)))
$$;
create or replace view public.leave_balances with (security_invoker=true) as
 select p.id employee_id,p.branch_id,s.hire_date,
 case when s.hire_date is null then 0 else leave_accrued(s.hire_date) end accrued,
 coalesce(sum(r.paid_days) filter(where r.status='Đã duyệt' and extract(year from r.start_date)=extract(year from current_date)),0)::int used,
 coalesce(sum(r.paid_days) filter(where r.status='Chờ duyệt' and extract(year from r.start_date)=extract(year from current_date)),0)::int reserved,
 greatest(0,case when s.hire_date is null then 0 else leave_accrued(s.hire_date) end
 -coalesce(sum(r.paid_days) filter(where r.status in ('Chờ duyệt','Đã duyệt') and extract(year from r.start_date)=extract(year from current_date)),0))::int remaining
 from profiles p left join employee_leave_settings s on s.employee_id=p.id left join leave_requests r on r.employee_id=p.id
 where p.active=true group by p.id,p.branch_id,s.hire_date;
grant select on public.leave_balances to authenticated;

create or replace function public.set_leave_hire_date(target_employee uuid,start_on date) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if akc_profile_role()<>'admin' then raise exception 'Chỉ admin được thiết lập ngày vào làm';end if;
 if start_on is null or start_on>current_date then raise exception 'Ngày vào làm không hợp lệ';end if;
 insert into employee_leave_settings(employee_id,hire_date) values(target_employee,start_on)
 on conflict(employee_id) do update set hire_date=excluded.hire_date,updated_at=now();
end$$;
create or replace function public.submit_leave_request(target_employee uuid,start_on date,end_on date,leave_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare employee profiles%rowtype;h date;allowed integer;occupied integer;paid integer;days integer;result uuid;
begin
 if target_employee<>auth.uid() and akc_profile_role()<>'admin' then raise exception 'Chỉ được gửi đơn cho chính mình';end if;
 if start_on is null or end_on is null or start_on<current_date or end_on<start_on or end_on-start_on>30 or extract(year from start_on)<>extract(year from end_on) then raise exception 'Khoảng nghỉ phải ở tương lai, trong cùng năm và tối đa 31 ngày';end if;
 if nullif(trim(leave_reason),'') is null then raise exception 'Cần nhập lý do nghỉ';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_employee::text,0));
 select * into employee from profiles where id=target_employee and active=true;
 if not found or employee.branch_id is null then raise exception 'Nhân sự chưa có cơ sở hoạt động';end if;
 select hire_date into h from employee_leave_settings where employee_id=target_employee;
 if h is null then raise exception 'Admin cần thiết lập ngày vào làm trước khi xin nghỉ';end if;
 allowed:=leave_accrued(h);days:=end_on-start_on+1;
 if exists(select 1 from leave_requests where employee_id=target_employee and status in ('Chờ duyệt','Đã duyệt') and start_date<=end_on and end_date>=start_on) then raise exception 'Khoảng ngày này trùng đơn đã gửi';end if;
 select coalesce(sum(paid_days),0) into occupied from leave_requests where employee_id=target_employee and status in ('Chờ duyệt','Đã duyệt') and extract(year from start_date)=extract(year from start_on);
 paid:=least(days,greatest(0,allowed-occupied));
 insert into leave_requests(employee_id,branch_id,start_date,end_date,reason,paid_days,unpaid_days)
 values(target_employee,employee.branch_id,start_on,end_on,trim(leave_reason),paid,days-paid) returning id into result;
 return result;
end$$;
create or replace function public.decide_leave_request(request_id uuid,new_status text,note text default '') returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r leave_requests%rowtype;
begin
 if akc_profile_role() not in ('admin','manager') then raise exception 'Không có quyền duyệt';end if;
 if new_status not in ('Đã duyệt','Từ chối') then raise exception 'Trạng thái không hợp lệ';end if;
 select * into r from leave_requests where id=request_id for update;
 if not found or r.status<>'Chờ duyệt' or (akc_profile_role()<>'admin' and not akc_can_access_branch(r.branch_id::text)) then raise exception 'Đơn không còn chờ duyệt hoặc không thuộc quyền xử lý';end if;
 if new_status='Từ chối' and nullif(trim(note),'') is null then raise exception 'Cần nhập lý do từ chối';end if;
 update leave_requests set status=new_status,approver_id=auth.uid(),decision_note=coalesce(note,''),decided_at=now() where id=request_id;
end$$;
revoke all on function public.set_leave_hire_date(uuid,date),public.submit_leave_request(uuid,date,date,text),public.decide_leave_request(uuid,text,text) from public;
grant execute on function public.set_leave_hire_date(uuid,date),public.submit_leave_request(uuid,date,date,text),public.decide_leave_request(uuid,text,text) to authenticated;

-- Admin assigns departments independently of CRM sales/PT account roles.
create table if not exists public.employee_departments(
 employee_id uuid primary key references public.profiles(id) on delete cascade,
 department text not null check(department in ('Lễ tân','PT','Sale'))
);
alter table public.employee_departments enable row level security;
create policy employee_departments_read on public.employee_departments for select to authenticated using(employee_id=auth.uid() or akc_profile_role()='admin' or (akc_profile_role()='manager' and exists(select 1 from profiles p where p.id=employee_id and akc_can_access_branch(p.branch_id::text))));
grant select on public.employee_departments to authenticated;
create or replace function public.set_employee_department(target_employee uuid,new_department text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if akc_profile_role()<>'admin' then raise exception 'Chỉ admin được gán bộ phận';end if;
 if new_department not in ('Lễ tân','PT','Sale') then raise exception 'Bộ phận không hợp lệ';end if;
 insert into employee_departments(employee_id,department) values(target_employee,new_department)
 on conflict(employee_id) do update set department=excluded.department;
end$$;
revoke all on function public.set_employee_department(uuid,text) from public;
grant execute on function public.set_employee_department(uuid,text) to authenticated;

-- Checklist aggregation uses existing card completion state; no row-level history is fabricated.
create or replace function public.get_work_report(period_kind text default 'month',target_branch uuid default null,start_on date default null,end_on date default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d1 date;d2 date;payload jsonb;
begin
 if akc_profile_role() not in ('admin','manager') then raise exception 'Không có quyền xem báo cáo';end if;
 if period_kind='day' then d1:=current_date;d2:=current_date;
 elsif period_kind='month' then d1:=date_trunc('month',current_date)::date;d2:=current_date;
 elsif period_kind='custom' and start_on is not null and end_on>=start_on and end_on-start_on<=366 then d1:=start_on;d2:=end_on;
 else raise exception 'Khoảng thời gian không hợp lệ';end if;
 with items as (
 select b.branch_id,br.name branch_name,
 coalesce(ed.department,case when p.role='pt' then 'PT' when p.role='sale' then 'Sale' else null end) department,
 c.recurrence_cycle cycle,cc.done,c.due_date
 from board_cards c join boards b on b.id=c.board_id join branches br on br.id=b.branch_id
 join card_checklists cc on cc.card_id=c.id left join profiles p on p.id=c.owner_id left join employee_departments ed on ed.employee_id=p.id
 where (target_branch is null or b.branch_id=target_branch) and (akc_profile_role()='admin' or akc_can_access_branch(b.branch_id::text))
 and c.due_date between d1 and d2
 ), dep as (select department,count(*) total,count(*) filter(where done) done,round(100.0*count(*) filter(where done)/nullif(count(*),0))::int percent from items where department is not null group by department),
 brs as (select branch_id,branch_name,count(*) total,count(*) filter(where done) done,round(100.0*count(*) filter(where done)/nullif(count(*),0))::int percent from items group by branch_id,branch_name),
 overdue as (select count(*) filter(where cycle='daily') daily,count(*) filter(where cycle='weekly') weekly,count(*) filter(where cycle='monthly') monthly from items where not done and due_date<current_date)
 select jsonb_build_object('departments',(select coalesce(jsonb_agg(to_jsonb(dep)),'[]'::jsonb) from dep),'branches',(select coalesce(jsonb_agg(to_jsonb(brs)),'[]'::jsonb) from brs),'overdue',(select to_jsonb(overdue) from overdue)) into payload;
 return payload;
end$$;
revoke all on function public.get_work_report(text,uuid,date,date) from public;
grant execute on function public.get_work_report(text,uuid,date,date) to authenticated;
-- Prevent replaying a decision after a proposal has left the pending queue.
create or replace function public.decide_internal_request(request_id uuid,new_status text,note text default '') returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r internal_requests%rowtype;
begin
 if akc_profile_role() not in ('admin','manager') then raise exception 'Không có quyền phê duyệt';end if;
 if new_status not in ('Đã duyệt','Từ chối') then raise exception 'Trạng thái không hợp lệ';end if;
 select * into r from internal_requests where id=request_id for update;
 if not found or r.status<>'Chờ duyệt' or (akc_profile_role()<>'admin' and not akc_can_access_branch(r.branch_id::text)) then raise exception 'Đề xuất không còn chờ duyệt hoặc không thuộc quyền xử lý';end if;
 if new_status='Từ chối' and nullif(trim(note),'') is null then raise exception 'Cần nhập lý do từ chối';end if;
 update internal_requests set status=new_status,decision_note=coalesce(note,''),approver_id=auth.uid(),decided_at=now(),updated_at=now() where id=request_id;
end$$;
