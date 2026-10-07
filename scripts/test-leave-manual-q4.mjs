import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Supply a temporary PGlite installation via PGLITE_TEST_MODULE; production
// dependencies remain unchanged. These checks execute actual PostgreSQL SQL.
const {PGlite}=await import(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const admin='11111111-1111-4111-8111-111111111111';
const staff='22222222-2222-4222-8222-222222222222';
const branch='33333333-3333-4333-8333-333333333333';
const original=readFileSync(new URL('../supabase/migrations/2026092101_operations_approved.sql',import.meta.url),'utf8');
const accrued=original.slice(original.indexOf('create or replace function public.leave_accrued'),original.indexOf('create or replace view public.leave_balances'));
await db.exec(`
 create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
 create function public.akc_profile_role() returns text language sql stable as $$select current_setting('app.role',true)$$;
 create function public.akc_can_access_branch(text) returns boolean language sql stable as $$select false$$;
 create table profiles(id uuid primary key,branch_id uuid,active boolean default true);
 create table employee_leave_settings(employee_id uuid primary key references profiles(id),hire_date date not null);
 create table leave_requests(id uuid primary key default gen_random_uuid(),employee_id uuid references profiles(id),branch_id uuid,start_date date,end_date date,reason text,paid_days integer,unpaid_days integer,status text default 'Chờ duyệt');
 insert into profiles(id,branch_id) values('${admin}','${branch}'),('${staff}','${branch}');
 grant usage on schema public,auth to authenticated;
 grant select on profiles,employee_leave_settings,leave_requests to authenticated;
 ${accrued}
`);
await db.exec(readFileSync(new URL('../supabase/migrations/2026100701_leave_manual_q4_balance.sql',import.meta.url),'utf8'));
const clock=async date=>db.exec(`create or replace function public.leave_today() returns date language sql stable as $$select date '${date}'$$;`);
const actor=async(role,id)=>db.query("select set_config('app.role',$1,false),set_config('app.uid',$2,false)",[role,id]);
const balance=async()=> (await db.query('select * from leave_balances where employee_id=$1',[staff])).rows[0];
await clock('2026-10-07'); await actor('admin',admin);
await db.exec(`insert into leave_requests(employee_id,branch_id,start_date,end_date,reason,paid_days,unpaid_days,status) values
 ('${staff}','${branch}','2026-10-01','2026-10-02','old',2,0,'Đã duyệt'),
 ('${staff}','${branch}','2026-10-03','2026-10-03','pending',1,0,'Chờ duyệt');`);
await db.query('select set_leave_manual_2026($1,3)',[staff]);
assert.deepEqual(Object.fromEntries(Object.entries(await balance()).filter(([k])=>['accrued','used','reserved','remaining'].includes(k))),{accrued:6,used:2,reserved:1,remaining:3});
for(const value of [-1,13,null]) await assert.rejects(db.query('select set_leave_manual_2026($1,$2)',[staff,value]));
await actor('manager',admin); await assert.rejects(db.query('select set_leave_manual_2026($1,9)',[staff]));
await actor('pt',staff); await assert.rejects(db.query('select set_leave_manual_2026($1,9)',[staff]));
await actor('',staff); await assert.rejects(db.query('select set_leave_manual_2026($1,9)',[staff]));
await actor('pt',staff);
const first=(await db.query("select submit_leave_request($1,'2026-10-10','2026-10-12','test') id",[staff])).rows[0].id;
assert.equal((await balance()).remaining,0);
assert.deepEqual((await db.query('select paid_days,unpaid_days from leave_requests where id=$1',[first])).rows[0],{paid_days:3,unpaid_days:0});
const next=(await db.query("select submit_leave_request($1,'2026-10-15','2026-10-16','test') id",[staff])).rows[0].id;
assert.deepEqual((await db.query('select paid_days,unpaid_days from leave_requests where id=$1',[next])).rows[0],{paid_days:0,unpaid_days:2});
await db.exec("update leave_requests set status='Từ chối' where reason='pending'");
assert.equal((await balance()).remaining,1);
await actor('admin',admin); await db.query('select set_leave_manual_2026($1,4)',[staff]);
assert.equal((await balance()).remaining,4);
assert.equal((await db.query('select count(*) n from employee_leave_settings')).rows[0].n,0,'No hire date is invented');
await db.exec('set role authenticated');
assert.equal((await balance()).remaining,4,'Authenticated view can read the transition balance');
await db.exec('reset role');
await clock('2026-12-31'); assert.equal((await balance()).remaining,4,'No extra Q4 accrual');
await clock('2027-01-01'); assert.equal((await balance()).remaining,0,'No manual carry into 2027');
await assert.rejects(db.query('select set_leave_manual_2026($1,4)',[staff]));
await clock('2027-01-31'); assert.equal((await balance()).remaining,1,'Unknown hire date still accrues automatically in 2027');
await actor('pt',staff);
await db.query("select submit_leave_request($1,'2027-01-31','2027-01-31','2027')",[staff]);
assert.equal((await balance()).remaining,0);
await clock('2027-12-31'); assert.equal((await balance()).remaining,11,'12 earned days less one used');
await clock('2028-01-01'); assert.equal((await balance()).remaining,0,'Annual reset continues');
await db.close();
console.log('PASS: PostgreSQL permissions, zero/invalid values, manual reservations, no invented hire date, Q4 freeze and 2027 automatic accrual/reset');
