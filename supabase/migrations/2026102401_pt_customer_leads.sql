-- PT may manage only customer leads assigned to their own account and branch.
-- Existing admin, manager and sale access remains unchanged.

drop policy if exists "leads read role" on public.leads;
create policy "leads read role" on public.leads
for select to authenticated
using (
  public.current_role() = 'admin'
  or (public.current_role() = 'manager' and branch_id = public.current_branch_id())
  or (public.current_role() in ('sale', 'pt') and owner_id = auth.uid())
);

drop policy if exists "leads insert role" on public.leads;
create policy "leads insert role" on public.leads
for insert to authenticated
with check (
  public.current_role() = 'admin'
  or (public.current_role() = 'manager' and branch_id = public.current_branch_id())
  or (
    public.current_role() in ('sale', 'pt')
    and owner_id = auth.uid()
    and branch_id = public.current_branch_id()
  )
);

drop policy if exists "leads update role" on public.leads;
create policy "leads update role" on public.leads
for update to authenticated
using (
  public.current_role() = 'admin'
  or (public.current_role() = 'manager' and branch_id = public.current_branch_id())
  or (public.current_role() in ('sale', 'pt') and owner_id = auth.uid())
)
with check (
  public.current_role() = 'admin'
  or (public.current_role() = 'manager' and branch_id = public.current_branch_id())
  or (
    public.current_role() in ('sale', 'pt')
    and owner_id = auth.uid()
    and branch_id = public.current_branch_id()
  )
);
