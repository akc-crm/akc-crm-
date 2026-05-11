# AKC CRM v8 Supabase Cloud

Bản v8 dùng Supabase Auth + Supabase Database để nhiều sale dùng chung online.

## Cài đặt nhanh
1. Tạo project Supabase.
2. Vào SQL Editor, chạy file `schema.sql`.
3. Deploy source lên Vercel/GitHub.
4. Thêm Environment Variables trong Vercel:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Đăng ký tài khoản admin đầu tiên trên web.
6. Vào Supabase SQL Editor, chạy `make_first_admin.sql` sau khi sửa email admin.
7. Đăng nhập admin, duyệt sale/manager.

## Local
npm install
npm run dev
