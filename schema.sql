create extension if not exists "uuid-ossp";

create table if not exists public.branches (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  phone text,
  role text not null default 'pending' check (role in ('pending','sale','manager','admin')),
  branch_id uuid references public.branches(id),
  owner_name text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text,
  source text default 'MKT',
  branch_id uuid references public.branches(id),
  owner_id uuid references public.profiles(id),
  status text default 'Lead mới',
  package_interest text default 'Membership',
  value numeric default 0,
  follow_date date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.branches(name) values
('AKC Ba Đình'),('AKC Cầu Giấy'),('AKC Long Biên'),('AKC Xuân La'),('AKC Thanh Xuân'),('AKC Đống Đa'),('AKC Tương Mai')
on conflict (name) do nothing;

create or replace function public.handle_new_user()
returns trigger as $$
declare first_branch uuid;
begin
  select id into first_branch from public.branches order by created_at asc limit 1;
  insert into public.profiles(id,email,full_name,phone,role,branch_id,owner_name,status,active)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)),new.raw_user_meta_data->>'phone','pending',coalesce((new.raw_user_meta_data->>'branch_id')::uuid,first_branch),coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)),'pending',false);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.current_role() returns text language sql stable security definer as $$ select role from public.profiles where id=auth.uid() $$;
create or replace function public.current_branch_id() returns uuid language sql stable security definer as $$ select branch_id from public.profiles where id=auth.uid() $$;

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.leads enable row level security;

create policy "branches read" on public.branches for select to authenticated using (true);
create policy "branches admin write" on public.branches for all to authenticated using (public.current_role()='admin') with check (public.current_role()='admin');

create policy "profiles read" on public.profiles for select to authenticated using (id=auth.uid() or public.current_role()='admin' or (public.current_role()='manager' and branch_id=public.current_branch_id()));
create policy "profiles admin update" on public.profiles for update to authenticated using (public.current_role()='admin') with check (public.current_role()='admin');

create policy "leads read role" on public.leads for select to authenticated using (public.current_role()='admin' or (public.current_role()='manager' and branch_id=public.current_branch_id()) or (public.current_role()='sale' and owner_id=auth.uid()));
create policy "leads insert role" on public.leads for insert to authenticated with check (public.current_role()='admin' or (public.current_role()='manager' and branch_id=public.current_branch_id()) or (public.current_role()='sale' and owner_id=auth.uid() and branch_id=public.current_branch_id()));
create policy "leads update role" on public.leads for update to authenticated using (public.current_role()='admin' or (public.current_role()='manager' and branch_id=public.current_branch_id()) or (public.current_role()='sale' and owner_id=auth.uid())) with check (public.current_role()='admin' or (public.current_role()='manager' and branch_id=public.current_branch_id()) or (public.current_role()='sale' and owner_id=auth.uid() and branch_id=public.current_branch_id()));
create policy "leads delete admin" on public.leads for delete to authenticated using (public.current_role()='admin');
