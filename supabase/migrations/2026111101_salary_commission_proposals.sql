-- Salary and commission proposals extend the existing management-only proposal flow.
alter table public.internal_requests
  add column if not exists target_employee_id uuid references public.profiles(id),
  add column if not exists current_salary numeric,
  add column if not exists proposed_salary numeric,
  add column if not exists commission_percent numeric;

alter table public.internal_requests drop constraint if exists internal_requests_request_type_check;
alter table public.internal_requests add constraint internal_requests_request_type_check check(request_type in (
  'Nghỉ phép','Tạm ứng','Mua sắm','Sửa chữa','Bổ sung trang thiết bị','Dụng cụ tập luyện',
  'Bảo trì','Bảo dưỡng','Sửa chữa CLB','Đề xuất tăng lương','Đề xuất hỗ trợ hoa hồng'
));

alter table public.internal_requests drop constraint if exists internal_requests_salary_proposal_check;
alter table public.internal_requests add constraint internal_requests_salary_proposal_check check(
  request_type<>'Đề xuất tăng lương'
  or (target_employee_id is not null and current_salary>0 and proposed_salary>current_salary and commission_percent is null)
);

alter table public.internal_requests drop constraint if exists internal_requests_commission_proposal_check;
alter table public.internal_requests add constraint internal_requests_commission_proposal_check check(
  request_type<>'Đề xuất hỗ trợ hoa hồng'
  or (target_employee_id is not null and commission_percent in (5,10,15,20,23,26) and current_salary is null and proposed_salary is null)
);

alter table public.internal_requests drop constraint if exists internal_requests_target_branch_check;
alter table public.internal_requests add constraint internal_requests_target_branch_check check(
  target_employee_id is null or branch_id is not null
);

create index if not exists idx_internal_requests_target_employee
  on public.internal_requests(target_employee_id,created_at desc)
  where target_employee_id is not null;

create or replace function public.get_proposal_summary(target_branch uuid default null,target_category text default null,start_on date default null,end_on date default null)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('count',count(*),'amount',coalesce(sum(amount),0),'approved',count(*) filter(where status='Đã duyệt'))
 from internal_requests where request_type in (
  'Bổ sung trang thiết bị','Dụng cụ tập luyện','Bảo trì','Bảo dưỡng','Sửa chữa CLB',
  'Đề xuất tăng lương','Đề xuất hỗ trợ hoa hồng'
 )
 and (target_branch is null or branch_id=target_branch) and (target_category is null or request_type=target_category)
 and (start_on is null or created_at::date>=start_on) and (end_on is null or created_at::date<=end_on)
 and akc_profile_role() in ('admin','manager') $$;

revoke all on function public.get_proposal_summary(uuid,text,date,date) from public;
grant execute on function public.get_proposal_summary(uuid,text,date,date) to authenticated;

-- Managers may only target an active employee in a branch they can access.
create or replace function public.guard_internal_request_personnel_target() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare employee_branch uuid;
begin
 if new.request_type not in ('Đề xuất tăng lương','Đề xuất hỗ trợ hoa hồng') then return new;end if;
 select branch_id into employee_branch from profiles where id=new.target_employee_id and active=true;
 if employee_branch is null or employee_branch<>new.branch_id then
  raise exception 'Nhân sự được đề xuất không thuộc cơ sở đã chọn';
 end if;
 if akc_profile_role()<>'admin' and not akc_can_access_branch(employee_branch::text) then
  raise exception 'Không có quyền đề xuất cho nhân sự này';
 end if;
 return new;
end$$;

drop trigger if exists guard_internal_request_personnel_target on public.internal_requests;
create trigger guard_internal_request_personnel_target
before insert or update of request_type,target_employee_id,branch_id on public.internal_requests
for each row execute function public.guard_internal_request_personnel_target();

analyze public.internal_requests;
