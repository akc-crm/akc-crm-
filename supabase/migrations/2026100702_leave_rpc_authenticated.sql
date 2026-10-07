-- Supabase default privileges may grant anon explicit RPC execution.
-- Keep leave mutation RPCs restricted to authenticated sessions.
revoke all on function public.set_leave_manual_2026(uuid,integer) from anon;
revoke all on function public.submit_leave_request(uuid,date,date,text) from anon;
