-- AKC CRM stability and BOARD access hardening.
-- Safe to run repeatedly.

create index if not exists idx_pt_checklists_pt_item_datetime
  on public.pt_checklists (pt_id, item_type, show_date desc, start_time desc);
create index if not exists idx_pt_checklists_branch_item_datetime
  on public.pt_checklists (branch_id, item_type, show_date desc, start_time desc);

create or replace function public.akc_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.active = true
    and p.status = 'approved'
  limit 1
$$;

create or replace function public.akc_can_access_branch(target_branch text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(bool_or(
    p.role = 'admin'
    or target_branch = p.branch_id::text
    or target_branch = any(coalesce(p.extra_branch_ids, '{}'::text[]))
  ), false)
  from public.profiles p
  where p.id = (select auth.uid())
    and p.active = true
    and p.status = 'approved'
$$;

create or replace function public.akc_can_access_board(target_board uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.boards b
    join public.profiles p on p.id = (select auth.uid())
    where b.id = target_board
      and p.active = true
      and p.status = 'approved'
      and (
        p.role = 'admin'
        or b.branch_id = p.branch_id
        or b.branch_id::text = any(coalesce(p.extra_branch_ids, '{}'::text[]))
      )
  )
$$;

create or replace function public.akc_can_access_card(target_card uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.board_cards c
    join public.boards b on b.id = c.board_id
    join public.profiles p on p.id = (select auth.uid())
    where c.id = target_card
      and p.active = true
      and p.status = 'approved'
      and (
        p.role = 'admin'
        or b.branch_id = p.branch_id
        or b.branch_id::text = any(coalesce(p.extra_branch_ids, '{}'::text[]))
      )
  )
$$;

revoke all on function public.akc_profile_role() from public;
revoke all on function public.akc_can_access_branch(text) from public;
revoke all on function public.akc_can_access_board(uuid) from public;
revoke all on function public.akc_can_access_card(uuid) from public;
grant execute on function public.akc_profile_role() to authenticated;
grant execute on function public.akc_can_access_branch(text) to authenticated;
grant execute on function public.akc_can_access_board(uuid) to authenticated;
grant execute on function public.akc_can_access_card(uuid) to authenticated;

drop policy if exists "boards read" on public.boards;
drop policy if exists "boards write" on public.boards;
drop policy if exists boards_insert_by_branch on public.boards;
drop policy if exists boards_select_by_branch on public.boards;
drop policy if exists boards_update_by_branch on public.boards;
create policy boards_branch_access on public.boards
  for all to authenticated
  using (public.akc_can_access_branch(branch_id::text))
  with check (public.akc_can_access_branch(branch_id::text));

drop policy if exists "board_lists read" on public.board_lists;
drop policy if exists "board_lists write" on public.board_lists;
create policy board_lists_branch_access on public.board_lists
  for all to authenticated
  using (public.akc_can_access_board(board_id))
  with check (public.akc_can_access_board(board_id));

drop policy if exists "board_cards read" on public.board_cards;
drop policy if exists "board_cards write" on public.board_cards;
create policy board_cards_branch_access on public.board_cards
  for all to authenticated
  using (public.akc_can_access_board(board_id))
  with check (public.akc_can_access_board(board_id));

drop policy if exists "card_checklists read" on public.card_checklists;
drop policy if exists "card_checklists write" on public.card_checklists;
create policy card_checklists_branch_access on public.card_checklists
  for all to authenticated
  using (public.akc_can_access_card(card_id))
  with check (public.akc_can_access_card(card_id));

drop policy if exists "card_comments read" on public.card_comments;
drop policy if exists "card_comments write" on public.card_comments;
create policy card_comments_branch_access on public.card_comments
  for all to authenticated
  using (public.akc_can_access_card(card_id))
  with check (public.akc_can_access_card(card_id));

drop policy if exists pt_show_delete_admin_only on public.pt_checklists;
drop policy if exists pt_show_insert_scope on public.pt_checklists;
drop policy if exists pt_show_select_scope on public.pt_checklists;
drop policy if exists pt_show_update_scope on public.pt_checklists;

create policy pt_show_select_scope on public.pt_checklists
  for select to authenticated
  using (
    item_type <> 'teaching_show'
    or public.akc_profile_role() = 'admin'
    or (public.akc_profile_role() = 'manager' and public.akc_can_access_branch(branch_id))
    or (public.akc_profile_role() = 'pt' and pt_id = (select auth.uid()))
  );

create policy pt_show_insert_scope on public.pt_checklists
  for insert to authenticated
  with check (
    item_type <> 'teaching_show'
    or public.akc_profile_role() = 'admin'
    or (public.akc_profile_role() = 'manager' and public.akc_can_access_branch(branch_id))
    or (
      public.akc_profile_role() = 'pt'
      and pt_id = (select auth.uid())
      and public.akc_can_access_branch(branch_id)
    )
  );

create policy pt_show_update_scope on public.pt_checklists
  for update to authenticated
  using (
    item_type <> 'teaching_show'
    or public.akc_profile_role() = 'admin'
    or (public.akc_profile_role() = 'manager' and public.akc_can_access_branch(branch_id))
    or (public.akc_profile_role() = 'pt' and pt_id = (select auth.uid()))
  )
  with check (
    item_type <> 'teaching_show'
    or public.akc_profile_role() = 'admin'
    or (public.akc_profile_role() = 'manager' and public.akc_can_access_branch(branch_id))
    or (
      public.akc_profile_role() = 'pt'
      and pt_id = (select auth.uid())
      and public.akc_can_access_branch(branch_id)
    )
  );

create policy pt_show_delete_admin_only on public.pt_checklists
  for delete to authenticated
  using (item_type <> 'teaching_show' or public.akc_profile_role() = 'admin');

analyze public.pt_checklists;
analyze public.board_cards;
analyze public.card_comments;
