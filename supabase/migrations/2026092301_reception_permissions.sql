-- Reception role and least-privilege access for proposals and BOARD.
-- Additive permission update; no business records are rewritten or deleted.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending','reception','sale','pt','manager','admin'));

-- Facility proposals are private to Admin and Manager.
drop policy if exists internal_requests_select_scope on public.internal_requests;
drop policy if exists internal_requests_insert_scope on public.internal_requests;
create policy internal_requests_select_management on public.internal_requests
  for select to authenticated
  using (
    public.akc_profile_role()='admin'
    or (
      public.akc_profile_role()='manager'
      and public.akc_can_access_branch(branch_id::text)
    )
  );
create policy internal_requests_insert_management on public.internal_requests
  for insert to authenticated
  with check (
    created_by=auth.uid()
    and public.akc_profile_role() in ('admin','manager')
    and public.akc_can_access_branch(branch_id::text)
  );

-- Staff can read the BOARD for their branch. Only Admin/Manager can change
-- its structure and cards. Staff may only tick/untick checklist items.
drop policy if exists boards_branch_access on public.boards;
create policy boards_read_by_branch on public.boards
  for select to authenticated using (public.akc_can_access_branch(branch_id::text));
create policy boards_manage_by_management on public.boards
  for all to authenticated
  using (public.akc_profile_role() in ('admin','manager') and public.akc_can_access_branch(branch_id::text))
  with check (public.akc_profile_role() in ('admin','manager') and public.akc_can_access_branch(branch_id::text));

drop policy if exists board_lists_branch_access on public.board_lists;
create policy board_lists_read_by_branch on public.board_lists
  for select to authenticated using (public.akc_can_access_board(board_id));
create policy board_lists_manage_by_management on public.board_lists
  for all to authenticated
  using (public.akc_profile_role() in ('admin','manager') and public.akc_can_access_board(board_id))
  with check (public.akc_profile_role() in ('admin','manager') and public.akc_can_access_board(board_id));

drop policy if exists board_cards_branch_access on public.board_cards;
create policy board_cards_read_by_branch on public.board_cards
  for select to authenticated using (public.akc_can_access_board(board_id));
create policy board_cards_manage_by_management on public.board_cards
  for all to authenticated
  using (public.akc_profile_role() in ('admin','manager') and public.akc_can_access_board(board_id))
  with check (public.akc_profile_role() in ('admin','manager') and public.akc_can_access_board(board_id));

drop policy if exists card_checklists_branch_access on public.card_checklists;
create policy card_checklists_read_by_branch on public.card_checklists
  for select to authenticated using (public.akc_can_access_card(card_id));
create policy card_checklists_tick_by_staff on public.card_checklists
  for update to authenticated
  using (public.akc_can_access_card(card_id))
  with check (public.akc_can_access_card(card_id));
create policy card_checklists_create_by_management on public.card_checklists
  for insert to authenticated
  with check (public.akc_profile_role() in ('admin','manager') and public.akc_can_access_card(card_id));
create policy card_checklists_delete_by_management on public.card_checklists
  for delete to authenticated
  using (public.akc_profile_role() in ('admin','manager') and public.akc_can_access_card(card_id));

create or replace function public.guard_staff_checklist_update()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.akc_profile_role() not in ('admin','manager')
    and (
      new.card_id is distinct from old.card_id
      or new.text is distinct from old.text
      or new.position is distinct from old.position
    )
 then
   raise exception 'Nhân viên chỉ được cập nhật trạng thái checklist';
 end if;
 return new;
end$$;
drop trigger if exists guard_staff_checklist_update on public.card_checklists;
create trigger guard_staff_checklist_update
before update on public.card_checklists
for each row execute function public.guard_staff_checklist_update();

-- Reception has no need for card discussions or customer images.
drop policy if exists card_comments_branch_access on public.card_comments;
create policy card_comments_read_non_reception on public.card_comments
  for select to authenticated
  using (public.akc_profile_role()<>'reception' and public.akc_can_access_card(card_id));
create policy card_comments_write_non_reception on public.card_comments
  for all to authenticated
  using (public.akc_profile_role()<>'reception' and public.akc_can_access_card(card_id))
  with check (public.akc_profile_role()<>'reception' and public.akc_can_access_card(card_id));

-- Keep the reporting fallback aligned with the new account role.
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
  coalesce(ed.department,case when p.role='reception' then 'Lễ tân' when p.role='pt' then 'PT' when p.role='sale' then 'Sale' else null end) department,
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
