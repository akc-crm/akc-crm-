-- Weekly rest-day swaps are separate from annual leave. Approval queues one
-- Kiot schedule-move job and never changes paid/unpaid leave balances.

create table if not exists public.weekly_rest_change_requests (
 id uuid primary key default uuid_generate_v4(),
 employee_id uuid not null references public.profiles(id),
 branch_id uuid not null references public.branches(id),
 old_rest_date date not null,
 new_rest_date date not null,
 reason text not null check (length(trim(reason)) between 1 and 500),
 status text not null default 'Chờ duyệt' check (status in ('Chờ duyệt','Đã duyệt','Từ chối')),
 approver_id uuid references public.profiles(id),
 decision_note text not null default '',
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (old_rest_date<>new_rest_date),
 check (abs(new_rest_date-old_rest_date)<=7)
);

create unique index if not exists idx_weekly_rest_change_pending_exact
 on public.weekly_rest_change_requests(employee_id,old_rest_date,new_rest_date)
 where status='Chờ duyệt';
create index if not exists idx_weekly_rest_change_pending_branch
 on public.weekly_rest_change_requests(branch_id,created_at desc)
 where status='Chờ duyệt';

alter table public.weekly_rest_change_requests enable row level security;
create policy weekly_rest_change_read on public.weekly_rest_change_requests
 for select to authenticated using (
  employee_id=auth.uid() or akc_profile_role()='admin' or
  (akc_profile_role()='manager' and akc_can_access_branch(branch_id::text))
 );
revoke all on public.weekly_rest_change_requests from anon,authenticated;
grant select on public.weekly_rest_change_requests to authenticated;

create table if not exists public.kiot_shift_move_jobs (
 id uuid primary key default uuid_generate_v4(),
 weekly_rest_change_request_id uuid not null unique references public.weekly_rest_change_requests(id) on delete cascade,
 employee_id uuid not null references public.profiles(id),
 branch_id uuid not null references public.branches(id),
 old_rest_date date not null,
 new_rest_date date not null,
 status text not null default 'pending' check (status in ('pending','processing','succeeded','failed','cancelled')),
 attempt_count integer not null default 0 check (attempt_count>=0),
 available_at timestamptz not null default now(),
 locked_at timestamptz,
 locked_by text,
 completed_at timestamptz,
 last_error text,
 result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_kiot_shift_move_due on public.kiot_shift_move_jobs(available_at,created_at)
 where status in ('pending','failed');
alter table public.kiot_shift_move_jobs enable row level security;
revoke all on public.kiot_shift_move_jobs from anon,authenticated;

create or replace function public.submit_weekly_rest_change(
 target_employee uuid,old_rest_on date,new_rest_on date,change_reason text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare employee public.profiles%rowtype; result uuid; today date:=public.leave_today();
begin
 if auth.uid() is null then raise exception 'Phiên đăng nhập không hợp lệ'; end if;
 if target_employee<>auth.uid() and akc_profile_role() is distinct from 'admin' then
  raise exception 'Chỉ được gửi yêu cầu cho chính mình';
 end if;
 if old_rest_on is null or new_rest_on is null or old_rest_on<=today or new_rest_on<=today then
  raise exception 'Hai ngày đổi nghỉ phải ở tương lai';
 end if;
 if old_rest_on=new_rest_on or abs(new_rest_on-old_rest_on)>7 then
  raise exception 'Hai ngày phải khác nhau và cách nhau không quá 7 ngày';
 end if;
 if nullif(trim(change_reason),'') is null then raise exception 'Cần nhập lý do đổi ngày nghỉ tuần'; end if;
 select * into employee from public.profiles where id=target_employee and active=true;
 if not found or employee.branch_id is null then raise exception 'Nhân sự chưa có cơ sở hoạt động'; end if;
 if exists(select 1 from public.weekly_rest_change_requests x
  where x.employee_id=target_employee and x.status='Chờ duyệt'
   and (x.old_rest_date in(old_rest_on,new_rest_on) or x.new_rest_date in(old_rest_on,new_rest_on))) then
  raise exception 'Nhân sự đã có yêu cầu đổi ngày liên quan đang chờ duyệt';
 end if;
 insert into public.weekly_rest_change_requests(employee_id,branch_id,old_rest_date,new_rest_date,reason)
 values(target_employee,employee.branch_id,old_rest_on,new_rest_on,trim(change_reason)) returning id into result;
 return result;
end$$;

create or replace function public.enqueue_kiot_shift_move(target_request uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.weekly_rest_change_requests%rowtype; result uuid;
begin
 select * into r from public.weekly_rest_change_requests where id=target_request for update;
 if not found or r.status<>'Đã duyệt' then raise exception 'Yêu cầu đổi ngày nghỉ tuần chưa được duyệt'; end if;
 insert into public.kiot_shift_move_jobs(
  weekly_rest_change_request_id,employee_id,branch_id,old_rest_date,new_rest_date
 ) values(r.id,r.employee_id,r.branch_id,r.old_rest_date,r.new_rest_date)
 on conflict(weekly_rest_change_request_id) do update set updated_at=excluded.updated_at
 returning id into result;
 return result;
end$$;

create or replace function public.decide_weekly_rest_change(
 request_id uuid,new_status text,note text default ''
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.weekly_rest_change_requests%rowtype;
begin
 if akc_profile_role() is distinct from 'admin' then raise exception 'Chỉ Admin được duyệt đổi ngày nghỉ tuần'; end if;
 if new_status not in ('Đã duyệt','Từ chối') then raise exception 'Trạng thái không hợp lệ'; end if;
 if new_status='Từ chối' and nullif(trim(note),'') is null then raise exception 'Cần nhập lý do từ chối'; end if;
 select * into r from public.weekly_rest_change_requests where id=request_id for update;
 if not found or r.status<>'Chờ duyệt' then raise exception 'Yêu cầu không còn chờ duyệt'; end if;
 update public.weekly_rest_change_requests set status=new_status,approver_id=auth.uid(),
  decision_note=coalesce(note,''),decided_at=now(),updated_at=now() where id=r.id;
 if new_status='Đã duyệt' then perform public.enqueue_kiot_shift_move(r.id); end if;
end$$;

create or replace function public.claim_kiot_shift_move_jobs(
 worker_name text,batch_size integer default 1,lease_minutes integer default 10
) returns setof public.kiot_shift_move_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if nullif(trim(worker_name),'') is null then raise exception 'Thiếu tên worker'; end if;
 batch_size:=least(5,greatest(1,batch_size));lease_minutes:=least(60,greatest(2,lease_minutes));
 update public.kiot_shift_move_jobs set status='failed',locked_at=null,locked_by=null,
  available_at=now(),last_error='Worker lease expired',updated_at=now()
 where status='processing' and locked_at<now()-make_interval(mins=>lease_minutes);
 return query with due as(
  select id from public.kiot_shift_move_jobs where status in('pending','failed')
   and available_at<=now() and attempt_count<5 order by available_at,created_at
   for update skip locked limit batch_size
 ) update public.kiot_shift_move_jobs j set status='processing',attempt_count=j.attempt_count+1,
  locked_at=now(),locked_by=worker_name,last_error=null,updated_at=now()
 from due where j.id=due.id returning j.*;
end$$;

create or replace function public.finish_kiot_shift_move_job(
 target_job uuid,worker_name text,was_successful boolean,
 worker_result jsonb default '{}'::jsonb,error_message text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.kiot_shift_move_jobs set status=case when was_successful then 'succeeded' else 'failed' end,
  completed_at=case when was_successful then now() else null end,
  available_at=case when was_successful then available_at else now()+make_interval(mins=>least(60,greatest(2,attempt_count*5))) end,
  locked_at=null,locked_by=null,result=coalesce(worker_result,'{}'::jsonb),
  last_error=case when was_successful then null else left(coalesce(error_message,'Robot không trả chi tiết lỗi'),1000) end,
  updated_at=now() where id=target_job and status='processing' and locked_by=worker_name;
 if not found then raise exception 'Job không còn thuộc worker này'; end if;
end$$;

create or replace function public.purge_kiot_shift_move_jobs(retain_days integer default 70)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare deleted_count integer;
begin
 delete from public.kiot_shift_move_jobs where status in('succeeded','cancelled')
  and coalesce(completed_at,updated_at)<now()-make_interval(days=>least(365,greatest(30,retain_days)));
 get diagnostics deleted_count=row_count;return deleted_count;
end$$;

revoke all on function public.submit_weekly_rest_change(uuid,date,date,text) from public;
revoke all on function public.decide_weekly_rest_change(uuid,text,text) from public;
revoke all on function public.enqueue_kiot_shift_move(uuid) from public;
revoke all on function public.claim_kiot_shift_move_jobs(text,integer,integer) from public;
revoke all on function public.finish_kiot_shift_move_job(uuid,text,boolean,jsonb,text) from public;
revoke all on function public.purge_kiot_shift_move_jobs(integer) from public;
grant execute on function public.submit_weekly_rest_change(uuid,date,date,text) to authenticated;
grant execute on function public.decide_weekly_rest_change(uuid,text,text) to authenticated;
grant execute on function public.claim_kiot_shift_move_jobs(text,integer,integer) to service_role;
grant execute on function public.finish_kiot_shift_move_job(uuid,text,boolean,jsonb,text) to service_role;
grant execute on function public.purge_kiot_shift_move_jobs(integer) to service_role;
