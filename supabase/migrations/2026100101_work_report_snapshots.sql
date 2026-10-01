-- Lightweight checklist history: one aggregate row per day, branch and department.
-- At 7 branches x 3 departments x 70 days this stays around 1,470 rows.
create table if not exists public.work_report_snapshots (
  snapshot_date date not null,
  branch_id uuid not null references public.branches(id) on delete cascade,
  department text not null check (department in ('Lễ tân','PT','Sale')),
  total integer not null default 0 check (total >= 0),
  done integer not null default 0 check (done >= 0 and done <= total),
  daily_incomplete integer not null default 0 check (daily_incomplete >= 0),
  weekly_incomplete integer not null default 0 check (weekly_incomplete >= 0),
  monthly_incomplete integer not null default 0 check (monthly_incomplete >= 0),
  captured_at timestamptz not null default now(),
  primary key (snapshot_date, branch_id, department)
);

create index if not exists idx_work_report_snapshots_branch_date
  on public.work_report_snapshots (branch_id, snapshot_date desc);

alter table public.work_report_snapshots enable row level security;
drop policy if exists work_report_snapshots_read on public.work_report_snapshots;
create policy work_report_snapshots_read on public.work_report_snapshots
  for select to authenticated
  using (
    public.akc_profile_role() = 'admin'
    or (public.akc_profile_role() = 'manager' and public.akc_can_access_branch(branch_id::text))
  );

grant select on public.work_report_snapshots to authenticated;

create or replace function public.capture_work_report_snapshot(snapshot_on date default current_date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.work_report_snapshots (
    snapshot_date, branch_id, department, total, done,
    daily_incomplete, weekly_incomplete, monthly_incomplete, captured_at
  )
  select
    snapshot_on,
    b.branch_id,
    coalesce(
      ed.department,
      case
        when p.role = 'reception' then 'Lễ tân'
        when p.role = 'pt' then 'PT'
        when p.role = 'sale' then 'Sale'
        else null
      end
    ) as department,
    count(*)::integer,
    count(*) filter (where cc.done)::integer,
    count(*) filter (where not cc.done and c.recurrence_cycle = 'daily')::integer,
    count(*) filter (where not cc.done and c.recurrence_cycle = 'weekly')::integer,
    count(*) filter (where not cc.done and c.recurrence_cycle = 'monthly')::integer,
    now()
  from public.board_cards c
  join public.boards b on b.id = c.board_id
  join public.card_checklists cc on cc.card_id = c.id
  left join public.profiles p on p.id = c.owner_id
  left join public.employee_departments ed on ed.employee_id = p.id
  where c.due_date = snapshot_on
  group by b.branch_id, department
  having coalesce(
    ed.department,
    case
      when p.role = 'reception' then 'Lễ tân'
      when p.role = 'pt' then 'PT'
      when p.role = 'sale' then 'Sale'
      else null
    end
  ) is not null
  on conflict (snapshot_date, branch_id, department) do update set
    total = excluded.total,
    done = excluded.done,
    daily_incomplete = excluded.daily_incomplete,
    weekly_incomplete = excluded.weekly_incomplete,
    monthly_incomplete = excluded.monthly_incomplete,
    captured_at = excluded.captured_at;

  delete from public.work_report_snapshots
  where snapshot_date < snapshot_on - 70;
end;
$$;

revoke all on function public.capture_work_report_snapshot(date) from public;
grant execute on function public.capture_work_report_snapshot(date) to service_role;

-- Past days come from compact snapshots; only today is read live.
create or replace function public.get_work_report(
  period_kind text default 'month',
  target_branch uuid default null,
  start_on date default null,
  end_on date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d1 date;
  d2 date;
  report_today date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  payload jsonb;
begin
  if public.akc_profile_role() not in ('admin','manager') then
    raise exception 'Không có quyền xem báo cáo';
  end if;

  if period_kind = 'day' then
    d1 := report_today;
    d2 := report_today;
  elsif period_kind = 'month' then
    d1 := date_trunc('month', report_today)::date;
    d2 := report_today;
  elsif period_kind = 'custom' and start_on is not null and end_on >= start_on and end_on - start_on <= 366 then
    d1 := start_on;
    d2 := end_on;
  else
    raise exception 'Khoảng thời gian không hợp lệ';
  end if;

  with historical as (
    select
      s.branch_id,
      br.name as branch_name,
      s.department,
      s.total,
      s.done,
      s.daily_incomplete,
      s.weekly_incomplete,
      s.monthly_incomplete
    from public.work_report_snapshots s
    join public.branches br on br.id = s.branch_id
    where s.snapshot_date between d1 and least(d2, report_today - 1)
      and (target_branch is null or s.branch_id = target_branch)
      and (public.akc_profile_role() = 'admin' or public.akc_can_access_branch(s.branch_id::text))
  ), live_today as (
    select
      b.branch_id,
      br.name as branch_name,
      coalesce(
        ed.department,
        case
          when p.role = 'reception' then 'Lễ tân'
          when p.role = 'pt' then 'PT'
          when p.role = 'sale' then 'Sale'
          else null
        end
      ) as department,
      count(*)::integer as total,
      count(*) filter (where cc.done)::integer as done,
      count(*) filter (where not cc.done and c.recurrence_cycle = 'daily')::integer as daily_incomplete,
      count(*) filter (where not cc.done and c.recurrence_cycle = 'weekly')::integer as weekly_incomplete,
      count(*) filter (where not cc.done and c.recurrence_cycle = 'monthly')::integer as monthly_incomplete
    from public.board_cards c
    join public.boards b on b.id = c.board_id
    join public.branches br on br.id = b.branch_id
    join public.card_checklists cc on cc.card_id = c.id
    left join public.profiles p on p.id = c.owner_id
    left join public.employee_departments ed on ed.employee_id = p.id
    where report_today between d1 and d2
      and c.due_date = report_today
      and (target_branch is null or b.branch_id = target_branch)
      and (public.akc_profile_role() = 'admin' or public.akc_can_access_branch(b.branch_id::text))
    group by b.branch_id, br.name, department
    having coalesce(
      ed.department,
      case
        when p.role = 'reception' then 'Lễ tân'
        when p.role = 'pt' then 'PT'
        when p.role = 'sale' then 'Sale'
        else null
      end
    ) is not null
  ), items as (
    select * from historical
    union all
    select * from live_today
  ), dep as (
    select
      department,
      sum(total)::integer as total,
      sum(done)::integer as done,
      round(100.0 * sum(done) / nullif(sum(total), 0))::integer as percent
    from items
    group by department
  ), brs as (
    select
      branch_id,
      branch_name,
      sum(total)::integer as total,
      sum(done)::integer as done,
      round(100.0 * sum(done) / nullif(sum(total), 0))::integer as percent
    from items
    group by branch_id, branch_name
  ), overdue as (
    select
      coalesce(sum(daily_incomplete), 0)::integer as daily,
      coalesce(sum(weekly_incomplete), 0)::integer as weekly,
      coalesce(sum(monthly_incomplete), 0)::integer as monthly
    from items
  )
  select jsonb_build_object(
    'departments', (select coalesce(jsonb_agg(to_jsonb(dep)), '[]'::jsonb) from dep),
    'branches', (select coalesce(jsonb_agg(to_jsonb(brs)), '[]'::jsonb) from brs),
    'overdue', (select to_jsonb(overdue) from overdue),
    'has_history', exists(select 1 from historical)
  ) into payload;

  return payload;
end;
$$;

revoke all on function public.get_work_report(text,uuid,date,date) from public;
grant execute on function public.get_work_report(text,uuid,date,date) to authenticated;

-- Supabase pg_cron runs in UTC. 13:55 UTC = 20:55 Viet Nam, before the 21:00 reset.
create extension if not exists pg_cron with schema extensions;
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'akc-work-report-snapshot' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end;
$$;

select cron.schedule(
  'akc-work-report-snapshot',
  '55 13 * * *',
  $cron$select public.capture_work_report_snapshot((timezone('Asia/Ho_Chi_Minh', now()))::date);$cron$
);
