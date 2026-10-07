-- Durable queue for approved leave -> Kiot attendance robot.
-- The approval and queue creation happen in the same database transaction.
create table if not exists public.kiot_attendance_jobs (
 id uuid primary key default uuid_generate_v4(),
 leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
 employee_id uuid not null references public.profiles(id),
 branch_id uuid not null references public.branches(id),
 work_date date not null,
 attendance_type text not null check (attendance_type in ('Nghỉ phép hưởng lương','Nghỉ không lương')),
 status text not null default 'pending' check (status in ('pending','processing','succeeded','failed','cancelled')),
 attempt_count integer not null default 0 check (attempt_count >= 0),
 available_at timestamptz not null default now(),
 locked_at timestamptz,
 locked_by text,
 completed_at timestamptz,
 last_error text,
 result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (leave_request_id, work_date)
);

create index if not exists idx_kiot_attendance_jobs_due
 on public.kiot_attendance_jobs(available_at, created_at)
 where status in ('pending','failed');
create index if not exists idx_kiot_attendance_jobs_leave
 on public.kiot_attendance_jobs(leave_request_id, work_date);

alter table public.kiot_attendance_jobs enable row level security;
revoke all on public.kiot_attendance_jobs from anon, authenticated;

create or replace function public.enqueue_kiot_attendance_jobs(target_leave_request uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.leave_requests%rowtype; inserted_count integer;
begin
 select * into r from public.leave_requests where id=target_leave_request for update;
 if not found or r.status <> 'Đã duyệt' then
  raise exception 'Chỉ tạo đồng bộ cho đơn đã duyệt';
 end if;

 insert into public.kiot_attendance_jobs(
  leave_request_id, employee_id, branch_id, work_date, attendance_type
 )
 select r.id, r.employee_id, r.branch_id, day::date,
  case when row_number() over(order by day) <= r.paid_days
   then 'Nghỉ phép hưởng lương' else 'Nghỉ không lương' end
 from generate_series(r.start_date::timestamp,r.end_date::timestamp,interval '1 day') day
 on conflict (leave_request_id,work_date) do nothing;
 get diagnostics inserted_count = row_count;
 return inserted_count;
end$$;

create or replace function public.claim_kiot_attendance_jobs(
 worker_name text, batch_size integer default 5, lease_minutes integer default 10
) returns setof public.kiot_attendance_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if nullif(trim(worker_name),'') is null then raise exception 'Thiếu tên worker'; end if;
 batch_size := least(20,greatest(1,batch_size));
 lease_minutes := least(60,greatest(2,lease_minutes));

 update public.kiot_attendance_jobs
 set status='failed',locked_at=null,locked_by=null,available_at=now(),
  last_error='Worker lease expired',updated_at=now()
 where status='processing' and locked_at < now() - make_interval(mins=>lease_minutes);

 return query
 with due as (
  select id from public.kiot_attendance_jobs
  where status in ('pending','failed') and available_at<=now() and attempt_count<5
  order by available_at,created_at
  for update skip locked limit batch_size
 )
 update public.kiot_attendance_jobs j
 set status='processing',attempt_count=j.attempt_count+1,locked_at=now(),
  locked_by=worker_name,last_error=null,updated_at=now()
 from due where j.id=due.id returning j.*;
end$$;

create or replace function public.finish_kiot_attendance_job(
 target_job uuid, worker_name text, was_successful boolean,
 worker_result jsonb default '{}'::jsonb, error_message text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.kiot_attendance_jobs
 set status=case when was_successful then 'succeeded' else 'failed' end,
  completed_at=case when was_successful then now() else null end,
  available_at=case when was_successful then available_at else now()+make_interval(mins=>least(60,greatest(2,attempt_count*5))) end,
  locked_at=null,locked_by=null,result=coalesce(worker_result,'{}'::jsonb),
  last_error=case when was_successful then null else left(coalesce(error_message,'Robot không trả chi tiết lỗi'),1000) end,
  updated_at=now()
 where id=target_job and status='processing' and locked_by=worker_name;
 if not found then raise exception 'Job không còn thuộc worker này'; end if;
end$$;

create or replace function public.purge_kiot_attendance_jobs(retain_days integer default 70)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare deleted_count integer;
begin
 delete from public.kiot_attendance_jobs
 where status in ('succeeded','cancelled')
  and coalesce(completed_at,updated_at) < now()-make_interval(days=>least(365,greatest(30,retain_days)));
 get diagnostics deleted_count = row_count;
 return deleted_count;
end$$;

revoke all on function public.enqueue_kiot_attendance_jobs(uuid) from public;
revoke all on function public.claim_kiot_attendance_jobs(text,integer,integer) from public;
revoke all on function public.finish_kiot_attendance_job(uuid,text,boolean,jsonb,text) from public;
revoke all on function public.purge_kiot_attendance_jobs(integer) from public;
grant execute on function public.claim_kiot_attendance_jobs(text,integer,integer) to service_role;
grant execute on function public.finish_kiot_attendance_job(uuid,text,boolean,jsonb,text) to service_role;
grant execute on function public.purge_kiot_attendance_jobs(integer) to service_role;

-- Replace approval function so approved leave is queued atomically.
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
 if new_status='Đã duyệt' then perform public.enqueue_kiot_attendance_jobs(request_id); end if;
end$$;
revoke all on function public.decide_leave_request(uuid,text,text) from public;
grant execute on function public.decide_leave_request(uuid,text,text) to authenticated;
