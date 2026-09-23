-- AKC Operations Sprint 1-3: BOARD review/KPI, internal approvals, executive dashboard.
-- Additive and safe to rerun. No existing lead, PT, checklist or Storage data is rewritten.

alter table public.board_cards add column if not exists workflow_status text not null default 'Chưa bắt đầu';
alter table public.board_cards add column if not exists started_at timestamptz;
alter table public.board_cards add column if not exists submitted_at timestamptz;
alter table public.board_cards add column if not exists reviewed_at timestamptz;
alter table public.board_cards add column if not exists reviewer_id uuid references public.profiles(id);
alter table public.board_cards add column if not exists review_note text not null default '';
alter table public.board_cards add column if not exists result_url text not null default '';
alter table public.board_cards add column if not exists base_kpi_points integer not null default 30;
alter table public.board_cards add column if not exists earned_kpi_points integer not null default 0;
alter table public.board_cards add column if not exists revision_count integer not null default 0;
alter table public.board_cards drop constraint if exists board_cards_workflow_status_check;
alter table public.board_cards add constraint board_cards_workflow_status_check check (workflow_status in ('Chưa bắt đầu','Đang thực hiện','Chờ nghiệm thu','Hoàn thành','Làm lại'));
create index if not exists idx_board_cards_workflow_due on public.board_cards(workflow_status,due_date) where due_date is not null;
create index if not exists idx_board_cards_reviewer_status on public.board_cards(reviewer_id,workflow_status);

create table if not exists public.kpi_ledger(
 id uuid primary key default uuid_generate_v4(), card_id uuid not null references public.board_cards(id) on delete cascade,
 user_id uuid not null references public.profiles(id), branch_id uuid references public.branches(id), points integer not null,
 reason text not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(card_id)
);
create index if not exists idx_kpi_ledger_user_created on public.kpi_ledger(user_id,created_at desc);
create index if not exists idx_kpi_ledger_branch_created on public.kpi_ledger(branch_id,created_at desc);
alter table public.kpi_ledger enable row level security;
drop policy if exists kpi_ledger_read_scope on public.kpi_ledger;
create policy kpi_ledger_read_scope on public.kpi_ledger for select to authenticated using(user_id=auth.uid() or public.akc_profile_role() in ('admin','manager'));

create table if not exists public.internal_requests(
 id uuid primary key default uuid_generate_v4(), request_type text not null check(request_type in ('Nghỉ phép','Tạm ứng','Mua sắm','Sửa chữa')),
 title text not null, description text not null, amount numeric not null default 0, date_from date, date_to date,
 branch_id uuid references public.branches(id), created_by uuid not null references public.profiles(id), status text not null default 'Chờ duyệt' check(status in ('Chờ duyệt','Đã duyệt','Từ chối')),
 approver_id uuid references public.profiles(id), decision_note text not null default '', decided_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_internal_requests_scope on public.internal_requests(branch_id,status,created_at desc);
create index if not exists idx_internal_requests_creator on public.internal_requests(created_by,created_at desc);
alter table public.internal_requests enable row level security;
grant select,insert on public.internal_requests to authenticated;
grant select on public.kpi_ledger to authenticated;
drop policy if exists internal_requests_select_scope on public.internal_requests;
drop policy if exists internal_requests_insert_scope on public.internal_requests;
create policy internal_requests_select_scope on public.internal_requests for select to authenticated using(created_by=auth.uid() or public.akc_profile_role()='admin' or (public.akc_profile_role()='manager' and public.akc_can_access_branch(branch_id::text)));
create policy internal_requests_insert_scope on public.internal_requests for insert to authenticated with check(created_by=auth.uid() and (branch_id is null or public.akc_can_access_branch(branch_id::text)));

create or replace function public.start_board_card(card_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin update board_cards set workflow_status='Đang thực hiện',started_at=coalesce(started_at,now()),updated_at=now() where id=card_id and owner_id=auth.uid() and akc_can_access_card(id) and workflow_status in ('Chưa bắt đầu','Làm lại');if not found then raise exception 'Không thể bắt đầu thẻ này';end if;end$$;
create or replace function public.submit_board_card(card_id uuid,result_link text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if nullif(trim(result_link),'') is null then raise exception 'Cần nhập link kết quả';end if;update board_cards set workflow_status='Chờ nghiệm thu',result_url=trim(result_link),submitted_at=now(),updated_at=now() where id=card_id and owner_id=auth.uid() and akc_can_access_card(id) and workflow_status in ('Đang thực hiện','Làm lại');if not found then raise exception 'Không thể gửi nghiệm thu thẻ này';end if;end$$;
create or replace function public.review_board_card(card_id uuid,approved boolean,note text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c board_cards%rowtype;actor_role text;branch uuid;points integer;
begin actor_role:=akc_profile_role();if actor_role not in ('admin','manager') then raise exception 'Không có quyền nghiệm thu';end if;select bc.* into c from board_cards bc where bc.id=card_id and akc_can_access_card(bc.id) for update;if not found or c.workflow_status<>'Chờ nghiệm thu' then raise exception 'Thẻ không ở trạng thái chờ nghiệm thu';end if;select b.branch_id into branch from boards b where b.id=c.board_id;if approved then points:=greatest(0,round(c.base_kpi_points*(case when c.due_date is null or c.submitted_at::date<=c.due_date then 1 else .7 end)*(greatest(.4,1-c.revision_count*.15))));update board_cards set workflow_status='Hoàn thành',reviewer_id=auth.uid(),review_note=coalesce(note,''),reviewed_at=now(),earned_kpi_points=points,updated_at=now() where id=card_id;insert into kpi_ledger(card_id,user_id,branch_id,points,reason,created_by) values(card_id,c.owner_id,branch,points,'Nghiệm thu BOARD',auth.uid()) on conflict(card_id) do update set points=excluded.points,reason=excluded.reason,created_by=excluded.created_by,created_at=now();else if nullif(trim(note),'') is null then raise exception 'Cần nhập lý do làm lại';end if;update board_cards set workflow_status='Làm lại',reviewer_id=auth.uid(),review_note=trim(note),reviewed_at=now(),revision_count=revision_count+1,earned_kpi_points=0,updated_at=now() where id=card_id;end if;end$$;
create or replace function public.decide_internal_request(request_id uuid,new_status text,note text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r internal_requests%rowtype;begin if akc_profile_role() not in ('admin','manager') then raise exception 'Không có quyền phê duyệt';end if;if new_status not in ('Đã duyệt','Từ chối') then raise exception 'Trạng thái không hợp lệ';end if;select * into r from internal_requests where id=request_id for update;if not found or not (akc_profile_role()='admin' or akc_can_access_branch(r.branch_id::text)) then raise exception 'Không có quyền xử lý đề xuất';end if;update internal_requests set status=new_status,decision_note=coalesce(note,''),approver_id=auth.uid(),decided_at=now(),updated_at=now() where id=request_id;end$$;

create or replace function public.get_executive_dashboard(days_back integer default 30,target_branch uuid default null) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with allowed as(select greatest(1,least(coalesce(days_back,30),365)) d where akc_profile_role() in ('admin','manager')),
bs as(select b.id,b.name from branches b,allowed a where (target_branch is null or b.id=target_branch) and (akc_profile_role()='admin' or akc_can_access_branch(b.id::text))),
lm as(select l.branch_id,count(*) leads,count(*) filter(where l.status='Đã mua gói') won,coalesce(sum(l.value) filter(where l.status='Đã mua gói'),0) revenue from leads l,allowed a where l.created_at>=now()-(a.d||' days')::interval and l.branch_id in(select id from bs) group by l.branch_id),
cm as(select b.branch_id,count(*) filter(where c.due_date<current_date and c.workflow_status not in('Hoàn thành')) overdue,count(*) filter(where c.workflow_status='Chờ nghiệm thu') pending from board_cards c join boards b on b.id=c.board_id where b.branch_id in(select id from bs) group by b.branch_id),
rm as(select r.branch_id,count(*) filter(where r.status='Chờ duyệt') pending from internal_requests r where r.branch_id in(select id from bs) group by r.branch_id),
rows as(select bs.id branch_id,bs.name branch_name,coalesce(lm.leads,0) leads,coalesce(lm.won,0) won,coalesce(lm.revenue,0) revenue,coalesce(cm.overdue,0) overdue_cards,coalesce(cm.pending,0) pending_review,coalesce(rm.pending,0) pending_requests from bs left join lm on lm.branch_id=bs.id left join cm on cm.branch_id=bs.id left join rm on rm.branch_id=bs.id),
kp as(select k.user_id,p.full_name,sum(k.points) points,count(*) completed_cards from kpi_ledger k join profiles p on p.id=k.user_id,allowed a where k.created_at>=now()-(a.d||' days')::interval and (target_branch is null or k.branch_id=target_branch) and (akc_profile_role()='admin' or akc_can_access_branch(k.branch_id::text)) group by k.user_id,p.full_name order by points desc limit 10)
select jsonb_build_object('summary',jsonb_build_object('leads',coalesce(sum(leads),0),'won',coalesce(sum(won),0),'revenue',coalesce(sum(revenue),0),'overdue_cards',coalesce(sum(overdue_cards),0),'pending_review',coalesce(sum(pending_review),0),'pending_requests',coalesce(sum(pending_requests),0)),'branches',coalesce(jsonb_agg(to_jsonb(rows) order by revenue desc),'[]'::jsonb),'kpi',(select coalesce(jsonb_agg(to_jsonb(kp)),'[]'::jsonb) from kp)) from rows$$;

revoke all on function public.start_board_card(uuid) from public;revoke all on function public.submit_board_card(uuid,text) from public;revoke all on function public.review_board_card(uuid,boolean,text) from public;revoke all on function public.decide_internal_request(uuid,text,text) from public;revoke all on function public.get_executive_dashboard(integer,uuid) from public;
grant execute on function public.start_board_card(uuid) to authenticated;grant execute on function public.submit_board_card(uuid,text) to authenticated;grant execute on function public.review_board_card(uuid,boolean,text) to authenticated;grant execute on function public.decide_internal_request(uuid,text,text) to authenticated;grant execute on function public.get_executive_dashboard(integer,uuid) to authenticated;
analyze public.board_cards;analyze public.internal_requests;analyze public.kpi_ledger;
