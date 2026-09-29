-- Khóa lịch hẹn theo cơ sở: Sale chỉ thấy/cập nhật lịch của chính mình
-- và bản ghi bắt buộc phải thuộc cơ sở mà tài khoản được phép truy cập.
drop policy if exists sales_appointments_read_scope on public.sales_appointments;
create policy sales_appointments_read_scope on public.sales_appointments
  for select to authenticated
  using (
    public.akc_profile_role() = 'admin'
    or (
      public.akc_can_access_branch(branch_id::text)
      and (
        owner_id = auth.uid()
        or public.akc_profile_role() = 'manager'
      )
    )
  );

drop policy if exists sales_appointments_update_scope on public.sales_appointments;
create policy sales_appointments_update_scope on public.sales_appointments
  for update to authenticated
  using (
    public.akc_profile_role() = 'admin'
    or (
      public.akc_can_access_branch(branch_id::text)
      and (
        owner_id = auth.uid()
        or public.akc_profile_role() = 'manager'
      )
    )
  )
  with check (
    public.akc_profile_role() = 'admin'
    or (
      public.akc_can_access_branch(branch_id::text)
      and (
        owner_id = auth.uid()
        or public.akc_profile_role() = 'manager'
      )
    )
  );
