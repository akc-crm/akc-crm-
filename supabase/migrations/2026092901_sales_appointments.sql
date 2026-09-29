-- Sales appointment workflow linked to CRM leads.
-- Additive migration: preserves all existing leads and appointment notes.

create table if not exists public.sales_appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  customer_name text not null,
  phone text not null,
  branch_id uuid not null references public.branches(id),
  owner_id uuid not null references public.profiles(id),
  appointment_date date not null,
  appointment_time time not null,
  need text not null default '',
  expected_revenue numeric(14,0) not null default 0 check (expected_revenue >= 0),
  actual_revenue numeric(14,0) not null default 0 check (actual_revenue >= 0),
  package_name text not null default '',
  status text not null default 'Chờ khách' check (status in ('Chờ khách','Đã đến','Đã tập thử','Đã chốt','Chưa chốt','Không đến','Khách hủy','Chưa cập nhật')),
  note text not null default '',
  outcome_note text not null default '',
  follow_up_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_appointments_date_branch
  on public.sales_appointments(appointment_date desc, branch_id, appointment_time);
create index if not exists idx_sales_appointments_owner_date
  on public.sales_appointments(owner_id, appointment_date desc);
create index if not exists idx_sales_appointments_lead
  on public.sales_appointments(lead_id);

-- Bring existing CRM appointments into the new calendar once. A matching row
-- is skipped, so rerunning the migration cannot duplicate legacy schedules.
insert into public.sales_appointments(lead_id,customer_name,phone,branch_id,owner_id,appointment_date,appointment_time,need,expected_revenue,actual_revenue,status,note,created_by)
select l.id,l.name,coalesce(l.phone,''),l.branch_id,l.owner_id,l.follow_date,
  coalesce(nullif((regexp_match(coalesce(l.note,''),'Giờ hẹn:\s*([0-2][0-9]:[0-5][0-9])'))[1], '')::time,time '18:00'),
  coalesce(l.package_interest,''),coalesce(l.value,0),case when l.status='Đã mua gói' then coalesce(l.value,0) else 0 end,
  case when l.status='Đã mua gói' then 'Đã chốt' when l.status='T1' then 'Đã tập thử' else 'Chờ khách' end,
  coalesce(l.note,''),l.owner_id
from public.leads l
where l.follow_date is not null and l.branch_id is not null and l.owner_id is not null
  and (l.source='Lịch hẹn' or coalesce(l.note,'') ilike '%Giờ hẹn:%')
  and not exists(select 1 from public.sales_appointments a where a.lead_id=l.id and a.appointment_date=l.follow_date);

alter table public.sales_appointments enable row level security;

drop policy if exists sales_appointments_read_scope on public.sales_appointments;
drop policy if exists sales_appointments_insert_scope on public.sales_appointments;
drop policy if exists sales_appointments_update_scope on public.sales_appointments;
create policy sales_appointments_read_scope on public.sales_appointments
  for select to authenticated
  using (
    owner_id=auth.uid()
    or public.akc_profile_role()='admin'
    or (public.akc_profile_role()='manager' and public.akc_can_access_branch(branch_id::text))
  );
create policy sales_appointments_insert_scope on public.sales_appointments
  for insert to authenticated
  with check (
    created_by=auth.uid()
    and public.akc_can_access_branch(branch_id::text)
    and (owner_id=auth.uid() or public.akc_profile_role() in ('admin','manager'))
  );
create policy sales_appointments_update_scope on public.sales_appointments
  for update to authenticated
  using (
    owner_id=auth.uid()
    or public.akc_profile_role()='admin'
    or (public.akc_profile_role()='manager' and public.akc_can_access_branch(branch_id::text))
  )
  with check (
    owner_id=auth.uid()
    or public.akc_profile_role()='admin'
    or (public.akc_profile_role()='manager' and public.akc_can_access_branch(branch_id::text))
  );
grant select,insert,update on public.sales_appointments to authenticated;

create or replace function public.create_sales_appointment(
  customer_phone text,
  customer_full_name text,
  target_branch uuid,
  target_owner uuid,
  appointment_on date,
  appointment_at time,
  customer_need text,
  projected_revenue numeric,
  appointment_note text default ''
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor_role text:=public.akc_profile_role();
  clean_phone text:=regexp_replace(coalesce(customer_phone,''),'[^0-9+]','','g');
  selected_owner uuid;
  existing_lead public.leads%rowtype;
  new_appointment_id uuid;
begin
  if actor_role not in ('admin','manager','sale') then raise exception 'Tài khoản không có quyền tạo lịch hẹn';end if;
  if not public.akc_can_access_branch(target_branch::text) then raise exception 'Không có quyền tại cơ sở này';end if;
  selected_owner:=case when actor_role in ('admin','manager') then coalesce(target_owner,auth.uid()) else auth.uid() end;
  if nullif(trim(customer_full_name),'') is null or length(clean_phone)<9 then raise exception 'Tên khách hoặc số điện thoại chưa hợp lệ';end if;
  if appointment_on is null or appointment_at is null then raise exception 'Cần chọn ngày và giờ hẹn';end if;
  if coalesce(projected_revenue,0)<0 then raise exception 'Dự doanh số không hợp lệ';end if;

  select * into existing_lead from public.leads
  where regexp_replace(coalesce(phone,''),'[^0-9+]','','g')=clean_phone
  order by created_at desc limit 1;

  if not found then
    insert into public.leads(name,phone,source,branch_id,owner_id,status,package_interest,value,follow_date,note)
    values(trim(customer_full_name),clean_phone,'Lịch hẹn',target_branch,selected_owner,'Đặt lịch',coalesce(customer_need,''),coalesce(projected_revenue,0),appointment_on,
      'Giờ hẹn: '||to_char(appointment_at,'HH24:MI')||E'\n'||coalesce(appointment_note,''))
    returning * into existing_lead;
  elsif existing_lead.status<>'Đã mua gói' then
    update public.leads set follow_date=appointment_on,status='Đặt lịch',package_interest=coalesce(nullif(customer_need,''),package_interest),
      note=trim(both E'\n' from coalesce(note,'')||E'\nLịch hẹn: '||to_char(appointment_on,'DD/MM/YYYY')||' '||to_char(appointment_at,'HH24:MI')||' · '||coalesce(appointment_note,''))
    where id=existing_lead.id;
  end if;

  insert into public.sales_appointments(lead_id,customer_name,phone,branch_id,owner_id,appointment_date,appointment_time,need,expected_revenue,note,created_by)
  values(existing_lead.id,trim(customer_full_name),clean_phone,target_branch,selected_owner,appointment_on,appointment_at,coalesce(customer_need,''),coalesce(projected_revenue,0),coalesce(appointment_note,''),auth.uid())
  returning id into new_appointment_id;
  return new_appointment_id;
end$$;

create or replace function public.update_sales_appointment_result(
  appointment_id uuid,
  result_status text,
  sold_package text default '',
  realized_revenue numeric default 0,
  result_note text default '',
  next_follow_up date default null
) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.sales_appointments%rowtype;actor_role text:=public.akc_profile_role();lead_note text;
begin
  if result_status not in ('Đã đến','Đã tập thử','Đã chốt','Chưa chốt','Không đến','Khách hủy') then raise exception 'Kết quả lịch hẹn không hợp lệ';end if;
  select * into a from public.sales_appointments where id=appointment_id for update;
  if not found then raise exception 'Không tìm thấy lịch hẹn';end if;
  if not (a.owner_id=auth.uid() or actor_role='admin' or (actor_role='manager' and public.akc_can_access_branch(a.branch_id::text))) then raise exception 'Không có quyền cập nhật lịch hẹn';end if;
  if result_status='Đã chốt' and (coalesce(realized_revenue,0)<=0 or nullif(trim(sold_package),'') is null) then raise exception 'Cần nhập gói bán và doanh số thực tế';end if;

  update public.sales_appointments set status=result_status,package_name=case when result_status='Đã chốt' then trim(sold_package) else package_name end,
    actual_revenue=case when result_status='Đã chốt' then realized_revenue else actual_revenue end,
    outcome_note=coalesce(result_note,''),follow_up_date=case when result_status in ('Chưa chốt','Không đến','Khách hủy') then next_follow_up else null end,updated_at=now()
  where id=a.id;

  lead_note:='Kết quả lịch hẹn '||to_char(a.appointment_date,'DD/MM/YYYY')||': '||result_status||case when nullif(trim(result_note),'') is null then '' else ' · '||trim(result_note) end;
  if a.lead_id is not null then
    if result_status='Đã chốt' then
      update public.leads set status='Đã mua gói',value=realized_revenue,package_interest=trim(sold_package),follow_date=a.appointment_date,
        note=trim(both E'\n' from coalesce(note,'')||E'\n'||lead_note) where id=a.lead_id;
    elsif result_status='Đã tập thử' then
      update public.leads set status='T1',follow_date=coalesce(next_follow_up,a.appointment_date),note=trim(both E'\n' from coalesce(note,'')||E'\n'||lead_note) where id=a.lead_id and status<>'Đã mua gói';
    elsif result_status in ('Chưa chốt','Không đến','Khách hủy') then
      update public.leads set follow_date=coalesce(next_follow_up,follow_date),note=trim(both E'\n' from coalesce(note,'')||E'\n'||lead_note) where id=a.lead_id;
    else
      update public.leads set note=trim(both E'\n' from coalesce(note,'')||E'\n'||lead_note) where id=a.lead_id;
    end if;
  end if;
end$$;

create or replace function public.mark_stale_sales_appointments()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare affected integer;
begin
  update public.sales_appointments set status='Chưa cập nhật',updated_at=now()
  where status='Chờ khách' and appointment_date<current_date
    and (owner_id=auth.uid() or public.akc_profile_role()='admin' or (public.akc_profile_role()='manager' and public.akc_can_access_branch(branch_id::text)));
  get diagnostics affected=row_count;return affected;
end$$;

revoke all on function public.create_sales_appointment(text,text,uuid,uuid,date,time,text,numeric,text) from public;
revoke all on function public.update_sales_appointment_result(uuid,text,text,numeric,text,date) from public;
revoke all on function public.mark_stale_sales_appointments() from public;
grant execute on function public.create_sales_appointment(text,text,uuid,uuid,date,time,text,numeric,text) to authenticated;
grant execute on function public.update_sales_appointment_result(uuid,text,text,numeric,text,date) to authenticated;
grant execute on function public.mark_stale_sales_appointments() to authenticated;
