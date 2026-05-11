-- Sau khi đăng ký tài khoản admin đầu tiên trên web, thay email rồi chạy lệnh này trong Supabase SQL Editor.
update public.profiles
set role='admin', status='approved', active=true, branch_id=null, owner_name=full_name
where email='admin@akc.vn';
