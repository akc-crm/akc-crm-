import React,{useEffect,useMemo,useRef,useState}from'react';
import{createRoot}from'react-dom/client';
import{supabase,isSupabaseConfigured}from'./supabaseClient';
import'./style.css';
const STATUSES=['Lead mới','Đã gọi','Đặt lịch','T1','Đã mua gói','Mất lead'];
const SOURCES=['MKT','FB Tổng','Page cơ sở','Vãng lai','Tự kiếm','Khách cũ','Khách giới thiệu','Hotline tổng','Website'];
const TASK_STATUSES=['Việc mới','Đang xử lý','Chờ duyệt','Hoàn thành','Tạm dừng'];
const PRIORITIES=['Thấp','Vừa','Gấp','Rất gấp'];
const DEFAULT_BOARD_BG='linear-gradient(135deg,#f8fafc,#ffffff 45%,#eef2ff)';
const money=n=>Number(n||0).toLocaleString('vi-VN')+'đ';
const today=()=>new Date().toISOString().slice(0,10);
function bname(bs,id){return bs.find(b=>b.id===id)?.name||'Chưa gán cơ sở'}
function uname(us,id){return us.find(u=>u.id===id)?.full_name||'Chưa gán sale'}
function App(){
 const[session,setSession]=useState(null),[isRecovery,setIsRecovery]=useState(false),[profile,setProfile]=useState(null),[branches,setBranches]=useState([]),[users,setUsers]=useState([]),[leads,setLeads]=useState([]),[tasks,setTasks]=useState([]),[ptShows,setPtShows]=useState([]),[boards,setBoards]=useState([]),[boardLists,setBoardLists]=useState([]),[boardCards,setBoardCards]=useState([]),[cardChecks,setCardChecks]=useState([]),[cardComments,setCardComments]=useState([]),[selectedBoard,setSelectedBoard]=useState(''),[page,setPage]=useState('Tổng quan'),[modal,setModal]=useState(null),[taskModal,setTaskModal]=useState(null),[boardModal,setBoardModal]=useState(null),[cardModal,setCardModal]=useState(null),[calendarModal,setCalendarModal]=useState(null),[passwordModal,setPasswordModal]=useState(null),[loading,setLoading]=useState(true);
 const dragCard=useRef(null);
 const[userMenu,setUserMenu]=useState(false);
 const fileInputRef=useRef(null);
 const[filter,setFilter]=useState({branch_id:'',source:'',owner_id:'',date_from:'',date_to:'',q:''});
 if(!isSupabaseConfigured)return <Setup/>;
 useEffect(()=>{supabase.auth.getSession().then(({data})=>{setSession(data.session);});const{data:s}=supabase.auth.onAuthStateChange((event,ss)=>{setSession(ss);if(event==='PASSWORD_RECOVERY'){setIsRecovery(true);}else if(event==='SIGNED_IN'||event==='SIGNED_OUT'){setIsRecovery(false);}});return()=>s.subscription.unsubscribe()},[]);
 async function load(silent=false){if(!silent)setLoading(true);const{data:bs}=await supabase.from('branches').select('*').order('name');setBranches(bs||[]);if(session?.user){const{data:p}=await supabase.from('profiles').select('*').eq('id',session.user.id).single();setProfile(p||null);const{data:us}=await supabase.from('profiles').select('*').order('created_at',{ascending:false});setUsers(us||[]);const{data:ls}=await supabase.from('leads').select('*').order('created_at',{ascending:false}).limit(500);setLeads(ls||[]);const{data:ts}=await supabase.from('operation_tasks').select('*').order('created_at',{ascending:false});setTasks(ts||[]);
try{
 let sq=supabase.from('pt_checklists').select('*').eq('item_type','teaching_show').order('show_date',{ascending:false}).order('start_time',{ascending:false});
 if(p?.role==='pt')sq=sq.eq('pt_id',p.id);
 if(p?.role==='manager'){const mBranches=[p.branch_id,...(p.extra_branch_ids||[])].filter(Boolean);if(mBranches.length===1)sq=sq.eq('branch_id',mBranches[0]);else if(mBranches.length>1)sq=sq.in('branch_id',mBranches);}
 const{data:ps}=await sq;
 setPtShows(ps||[]);
}catch(_e){setPtShows([])}
}if(!silent)setLoading(false)}
 async function loadBoard(){const{data:bd}=await supabase.from('boards').select('*').order('position',{ascending:true}).order('created_at',{ascending:true});setBoards(bd||[]);if((bd||[]).length&&!selectedBoard)setSelectedBoard((bd||[])[0].id);const{data:bl}=await supabase.from('board_lists').select('*').order('position',{ascending:true});setBoardLists(bl||[]);const{data:bc}=await supabase.from('board_cards').select('*').order('position',{ascending:true}).order('created_at',{ascending:true});setBoardCards(bc||[]);const{data:cc}=await supabase.from('card_checklists').select('*').order('position',{ascending:true});setCardChecks(cc||[]);const{data:cm}=await supabase.from('card_comments').select('*').order('created_at',{ascending:true});setCardComments(cm||[])}
 useEffect(()=>{load(false)},[session?.user?.id]);
 useEffect(()=>{if(session?.user&&page==='BOARD')loadBoard()},[page,session?.user?.id]);
 useEffect(()=>{if(!session?.user)return;
  const reloadLeads=()=>supabase.from('leads').select('*').order('created_at',{ascending:false}).limit(500).then(({data})=>setLeads(data||[]));
  const reloadProfiles=()=>{supabase.from('profiles').select('*').eq('id',session.user.id).single().then(({data})=>setProfile(data));supabase.from('profiles').select('*').order('created_at',{ascending:false}).then(({data})=>setUsers(data||[]));};
  const reloadBranches=()=>supabase.from('branches').select('*').order('name').then(({data})=>setBranches(data||[]));
  const reloadTasks=()=>supabase.from('operation_tasks').select('*').order('created_at',{ascending:false}).then(({data})=>setTasks(data||[]));
  const reloadPtShows=()=>{let sq=supabase.from('pt_checklists').select('*').eq('item_type','teaching_show').order('show_date',{ascending:false}).order('start_time',{ascending:false});if(profile?.role==='pt')sq=sq.eq('pt_id',profile.id);if(profile?.role==='manager'){const mb=[profile.branch_id,...(profile.extra_branch_ids||[])].filter(Boolean);if(mb.length===1)sq=sq.eq('branch_id',mb[0]);else if(mb.length>1)sq=sq.in('branch_id',mb);}sq.then(({data})=>setPtShows(data||[]));};
  const reloadBoard=()=>{if(page!=='BOARD')return;loadBoard();};
  const c=supabase.channel('akc-v9').on('postgres_changes',{event:'*',schema:'public',table:'leads'},reloadLeads).on('postgres_changes',{event:'*',schema:'public',table:'profiles'},reloadProfiles).on('postgres_changes',{event:'*',schema:'public',table:'branches'},reloadBranches).on('postgres_changes',{event:'*',schema:'public',table:'operation_tasks'},reloadTasks).on('postgres_changes',{event:'*',schema:'public',table:'pt_checklists'},reloadPtShows).on('postgres_changes',{event:'*',schema:'public',table:'boards'},reloadBoard).on('postgres_changes',{event:'*',schema:'public',table:'board_lists'},reloadBoard).on('postgres_changes',{event:'*',schema:'public',table:'board_cards'},reloadBoard).on('postgres_changes',{event:'*',schema:'public',table:'card_checklists'},reloadBoard).on('postgres_changes',{event:'*',schema:'public',table:'card_comments'},reloadBoard).subscribe();return()=>supabase.removeChannel(c)},[session?.user?.id,page]);
 if(isRecovery)return <ResetPasswordForm onDone={()=>{setIsRecovery(false);supabase.auth.signOut();}}/>; if(!session)return <Auth branches={branches}/>; if(loading)return <Splash text='Đang tải CRM...'/>; if(!profile||profile.status!=='approved'||!profile.active)return <Pending profile={profile}/>;
 const isAdmin=profile.role==='admin',isManager=profile.role==='manager',isSale=profile.role==='sale',isPT=profile.role==='pt',isStaff=['sale','pt'].includes(profile.role);
 const managerBranches=isManager?[profile.branch_id,...(profile.extra_branch_ids||[])].filter(Boolean):[];
 function managerCanAccessBranch(bid){if(!isManager)return false;if(!managerBranches.length)return true;return managerBranches.includes(bid);}
 const avBranches=isAdmin?branches:branches.filter(b=>b.id===profile.branch_id);
 const avUsers=isAdmin?users.filter(u=>u.active&&u.status==='approved'&&u.role!=='pending'):users.filter(u=>u.active&&u.status==='approved'&&u.branch_id===profile.branch_id&&(isManager||u.id===profile.id));
 const rows=leads.filter(l=>(!filter.branch_id||l.branch_id===filter.branch_id)&&(!filter.source||l.source===filter.source)&&(!filter.owner_id||l.owner_id===filter.owner_id)&&(!filter.date_from||String(l.created_at).slice(0,10)>=filter.date_from)&&(!filter.date_to||String(l.created_at).slice(0,10)<=filter.date_to)&&(!filter.q||String((l.name||'')+' '+(l.phone||'')+' '+(l.note||'')).toLowerCase().includes(filter.q.toLowerCase())));
 const pending=users.filter(u=>u.status==='pending').length;
 const nav=isPT?['BOARD','Show PT']:['Tổng quan','Lead','Pipeline','Lịch hẹn','BOARD','Show PT',...(isAdmin||isManager?['Báo cáo']:[]),...(isAdmin?['Cơ sở',`Tài khoản${pending?' ('+pending+')':''}`]:[]),'Zalo/Facebook'];
 async function saveLead(f){const row={name:f.name,phone:f.phone,source:f.source,branch_id:isSale?profile.branch_id:f.branch_id,owner_id:isSale?profile.id:f.owner_id,status:f.status,package_interest:f.package_interest,value:Number(f.value||0),follow_date:f.follow_date||(f.status==='T1'?today():null),note:f.note};const q=f.id?supabase.from('leads').update(row).eq('id',f.id):supabase.from('leads').insert(row);const{error}=await q;if(error)alert(error.message);setModal(null);load(true)}
 async function delLead(id){if(!isAdmin)return alert('Chỉ admin được xóa lead');if(confirm('Xóa lead này?')){const{error}=await supabase.from('leads').delete().eq('id',id);if(error)alert(error.message);load(true)}}
 async function status(id,s){const patch={status:s};if(s==='T1')patch.follow_date=today();const{error}=await supabase.from('leads').update(patch).eq('id',id);if(error)alert(error.message);load(true)}
 async function addDemo(){const b=avBranches[0],u=avUsers[0]||profile;const{error}=await supabase.from('leads').insert({name:'Lead AKC Demo',phone:'09'+Math.floor(10000000+Math.random()*89999999),source:'MKT',branch_id:b?.id||profile.branch_id,owner_id:u?.id||profile.id,status:'Lead mới',package_interest:'Membership',value:3500000,follow_date:today(),note:'Lead demo cloud'});if(error)alert(error.message);load(true)}
 function exportData(){if(!(isAdmin||isManager))return alert('Chỉ admin/manager được xuất dữ liệu');const data=rows.map(l=>({name:l.name||'',phone:l.phone?`="${String(l.phone).replaceAll('\"','')}"`:'',source:l.source||'',branch:bname(branches,l.branch_id),owner:uname(users,l.owner_id),status:l.status||'',package_interest:l.package_interest||'',value:l.value||0,follow_date:l.follow_date||'',note:l.note||''}));const csv=['Tên khách,SĐT,Nguồn,Cơ sở,Sale,Trạng thái,Mục tiêu/Gói,Doanh số dự kiến,Ngày hẹn,Ghi chú',...data.map(r=>[r.name,r.phone,r.source,r.branch,r.owner,r.status,r.package_interest,r.value,r.follow_date,r.note].map(x=>'"'+String(x).replaceAll('\"','\"\"')+'"').join(','))].join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8-sig'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='AKC_CRM_DATA_'+today()+'.csv';a.click();URL.revokeObjectURL(a.href)}
 async function importData(e){if(!(isAdmin||isManager))return alert('Chỉ admin/manager được nhập dữ liệu');const file=e.target.files?.[0];if(!file)return;const text=await file.text();const lines=text.split(/\r?\n/).filter(Boolean).slice(1);const defaultBranch=avBranches[0]?.id||profile.branch_id,defaultOwner=avUsers[0]?.id||profile.id;const data=lines.map(line=>line.split(',').map(x=>x.replace(/^\"|\"$/g,''))).map(cols=>({name:cols[0]||'Khách mới',phone:cols[1]||'',source:cols[2]||'MKT',branch_id:defaultBranch,owner_id:defaultOwner,status:cols[5]||'Lead mới',package_interest:cols[6]||'',value:Number(String(cols[7]||0).replace(/[^0-9]/g,'')),follow_date:cols[8]||null,note:cols[9]||''}));if(!data.length)return alert('File chưa có dữ liệu');const{error}=await supabase.from('leads').insert(data);if(error)alert(error.message);else alert('Import thành công '+data.length+' dòng');e.target.value='';load(true)}
 async function saveAppointment(f){const row={name:f.name||'Khách hẹn',phone:f.phone||'',source:'Lịch hẹn',branch_id:f.branch_id||profile.branch_id,owner_id:f.owner_id||profile.id,status:f.status||'T1',package_interest:f.goal||'',value:Number(f.value||0),follow_date:f.date||today(),note:`Giờ hẹn: ${f.time||''}\nMục tiêu: ${f.goal||''}\n${f.note||''}`};const{error}=await supabase.from('leads').insert(row);if(error)alert(error.message);setCalendarModal(null);load(true)}
 async function saveTask(f){const checklist=String(f.checklist_text||'').split('\n').map(x=>x.trim()).filter(Boolean).map((text,i)=>({text,done:(f.checklist||[])[i]?.done||false}));const row={title:f.title,description:f.description||'',status:f.status||'Việc mới',priority:f.priority||'Vừa',branch_id:isSale?profile.branch_id:(f.branch_id||null),owner_id:f.owner_id||profile.id,reviewer_id:f.reviewer_id||null,due_date:f.due_date||null,checklist,result_note:f.result_note||'',lead_id:f.lead_id||null};const q=f.id?supabase.from('operation_tasks').update(row).eq('id',f.id):supabase.from('operation_tasks').insert({...row,created_by:profile.id});const{error}=await q;if(error)alert(error.message);setTaskModal(null);load(true)}
 async function delTask(id){if(!(isAdmin||isManager))return alert('Chỉ admin/manager được xóa việc');if(confirm('Xóa công việc này?')){const{error}=await supabase.from('operation_tasks').delete().eq('id',id);if(error)alert(error.message);load(true)}}
 async function moveTask(id,status){const{error}=await supabase.from('operation_tasks').update({status}).eq('id',id);if(error)alert(error.message);load(true)}
 async function addDemoTask(){const b=avBranches[0],u=avUsers[0]||profile;const{error}=await supabase.from('operation_tasks').insert({title:'Checklist vận hành AKC demo',description:'Việc mẫu thay Trello: giao việc, checklist, deadline, duyệt việc.',status:'Việc mới',priority:'Gấp',branch_id:b?.id||profile.branch_id,owner_id:u?.id||profile.id,reviewer_id:(isAdmin||isManager)?profile.id:null,due_date:today(),created_by:profile.id,checklist:[{text:'Xác nhận yêu cầu',done:false},{text:'Cập nhật kết quả',done:false}]});if(error)alert(error.message);load(true)}
 async function saveBoard(f){const row={name:f.name||'Board AKC',background:f.background||DEFAULT_BOARD_BG,branch_id:isStaff?profile.branch_id:(f.branch_id||null),position:Number(f.position||boards.length),created_by:profile.id};const q=f.id?supabase.from('boards').update(row).eq('id',f.id):supabase.from('boards').insert(row).select().single();const{data,error}=await q;if(error)return alert(error.message);if(data?.id)setSelectedBoard(data.id);setBoardModal(null);load(true)}
 async function delBoard(id){if(!(isAdmin||isManager))return alert('Chỉ admin/manager được xóa board');if(confirm('Xóa board này và toàn bộ danh sách/thẻ?')){const{error}=await supabase.from('boards').delete().eq('id',id);if(error)alert(error.message);setSelectedBoard('');load(true)}}
 async function quickBoard(){const{data:b,error}=await supabase.from('boards').insert({name:'Ban Điều Hành AKC',background:DEFAULT_BOARD_BG,position:boards.length,created_by:profile.id}).select().single();if(error)return alert(error.message);setSelectedBoard(b.id);const names=['Giám Đốc Điều Hành','Phòng chất lượng PT','Leader Team LT','Phòng Kinh Doanh'];const rows=names.map((name,i)=>({board_id:b.id,name,position:i,created_by:profile.id}));const{data:ls,error:le}=await supabase.from('board_lists').insert(rows).select();if(le)return alert(le.message);if(ls?.[0])await supabase.from('board_cards').insert({board_id:b.id,list_id:ls[0].id,title:'CEO',description:'Mô tả công việc và quyền hạn điều hành.\n- Xây dựng chiến lược\n- Theo dõi KPI\n- Duyệt kế hoạch',position:0,created_by:profile.id,owner_id:profile.id});load(true)}
 async function addBoardList(boardId,name){if(!boardId)return alert('Chưa chọn board');if(!name.trim())return;const pos=boardLists.filter(l=>l.board_id===boardId).length;const{error}=await supabase.from('board_lists').insert({board_id:boardId,name:name.trim(),position:pos,created_by:profile.id});if(error)alert(error.message);load(true)}
 async function renameBoardList(list){const name=prompt('Tên danh sách',list.name);if(name){const{error}=await supabase.from('board_lists').update({name}).eq('id',list.id);if(error)alert(error.message);load(true)}}
 async function delBoardList(id){if(confirm('Xóa danh sách và các thẻ bên trong?')){const{error}=await supabase.from('board_lists').delete().eq('id',id);if(error)alert(error.message);load(true)}}
 async function saveBoardCard(f){const boardId=f.board_id||selectedBoard;if(!boardId)return alert('Chưa chọn board');let listId=f.list_id;if(!listId){const first=boardLists.find(l=>l.board_id===boardId);if(!first)return alert('Board chưa có danh sách');listId=first.id}const row={board_id:boardId,list_id:listId,title:f.title||'Thẻ mới',description:f.description||'',cover_image:f.cover_image||'',owner_id:f.owner_id||null,due_date:f.due_date||null,label:f.label||'',position:Number(f.position||0),updated_at:new Date().toISOString()};const q=f.id?supabase.from('board_cards').update(row).eq('id',f.id):supabase.from('board_cards').insert({...row,created_by:profile.id}).select().single();const{data,error}=await q;if(error)return alert(error.message);const cardId=f.id||data?.id;if(cardId&&f.checklist_text!==undefined){const lines=String(f.checklist_text||'').split(/[\n.;]+/).map(x=>x.trim()).filter(Boolean);const old=cardChecks.filter(c=>c.card_id===cardId);for(let i=0;i<lines.length;i++){if(!old.find(o=>String(o.text).trim().toLowerCase()===lines[i].toLowerCase()))await supabase.from('card_checklists').insert({card_id:cardId,text:lines[i],position:old.length+i,created_by:profile.id})}}setCardModal(null);load(true)}
 async function delBoardCard(id){if(confirm('Xóa thẻ này?')){const{error}=await supabase.from('board_cards').delete().eq('id',id);if(error)alert(error.message);setCardModal(null);load(true)}}
 async function moveBoardCard(cardId,listId){const pos=boardCards.filter(c=>c.list_id===listId).length;const{error}=await supabase.from('board_cards').update({list_id:listId,position:pos,updated_at:new Date().toISOString()}).eq('id',cardId);if(error)alert(error.message);load(true)}
 async function toggleCheck(id,done){const{error}=await supabase.from('card_checklists').update({done:!done}).eq('id',id);if(error)alert(error.message);load(true)}
 async function updateCheckText(id,text){if(!String(text||'').trim())return alert('Nội dung checklist không được trống');const{error}=await supabase.from('card_checklists').update({text:String(text).trim()}).eq('id',id);if(error)alert(error.message);load(true)}
 async function deleteCheck(id){if(!confirm('Xóa mục checklist này?'))return;const{error}=await supabase.from('card_checklists').delete().eq('id',id);if(error)alert(error.message);load(true)}
 async function addComment(cardId,message){if(!String(message||'').trim())return;const{error}=await supabase.from('card_comments').insert({card_id:cardId,user_id:profile.id,message:message.trim()});if(error)alert(error.message);load(true)}
 async function updateComment(id,message){if(!String(message||'').trim())return alert('Bình luận không được trống');const{error}=await supabase.from('card_comments').update({message:String(message).trim()}).eq('id',id);if(error)alert(error.message);load(true)}
 async function deleteComment(id){if(!confirm('Xóa bình luận này?'))return;const{error}=await supabase.from('card_comments').delete().eq('id',id);if(error)alert(error.message);load(true)}

 async function changeOwnPassword(f){if(!f.password||f.password.length<6)return alert('Mật khẩu mới tối thiểu 6 ký tự');if(f.password!==f.confirm)return alert('Mật khẩu xác nhận chưa khớp');const{error}=await supabase.auth.updateUser({password:f.password});if(error)return alert(error.message);setPasswordModal(null);alert('Đổi mật khẩu thành công. Lần đăng nhập sau dùng mật khẩu mới.')}


 function canAccessPtShow(show){
  if(isAdmin)return true;
  if(isManager)return !managerBranches.length||managerCanAccessBranch(show.branch_id);
  if(isPT)return show.pt_id===profile.id;
  return false;
 }
 function canEditPtShow(show){
  if(isAdmin)return true;
  if(isManager)return canAccessPtShow(show);
  if(isPT)return show.pt_id===profile.id&&['draft','registered','rejected'].includes(show.show_status||'registered');
  return false;
 }
 function canCompletePtShow(show){
  if(!show)return false;
  const ready=['draft','registered'].includes(show.show_status||'registered');
  if(!ready)return false;
  if(isAdmin)return true;
  if(isManager)return !managerBranches.length||managerCanAccessBranch(show.branch_id);
  if(isPT)return show.pt_id===profile.id;
  return false;
 }
 function canApprovePtShow(show){
  return (isAdmin||(isManager&&(!managerBranches.length||managerCanAccessBranch(show.branch_id))))&&show.show_status==='completed_pending_approval';
 }
 async function savePtShow(f){
  const oldShow=f.id?ptShows.find(x=>x.id===f.id):null;
  if(oldShow&&!canEditPtShow(oldShow))return alert('Anh/chị không có quyền sửa show này.');
  if(profile.role==='pt'&&f.id&&oldShow&&oldShow.pt_id!==profile.id)return alert('PT chỉ được sửa show của chính mình.');
  if(profile.role==='manager'&&managerBranches.length&&f.branch_id&&!managerCanAccessBranch(f.branch_id))return alert('Manager chỉ được tạo/sửa show của cơ sở được phân quyền.');
  const pt=profile.role==='pt'?profile:(users.find(u=>u.id===(f.pt_id||profile.id))||profile);
  const branchId=profile.role==='pt'?profile.branch_id:(profile.role==='manager'?(f.branch_id||profile.branch_id):(f.branch_id||profile.branch_id||null));
  const br=branches.find(b=>b.id===branchId);
  const safeStatus=profile.role==='pt'?(oldShow?.show_status==='rejected'?'registered':(oldShow?.show_status||'registered')):(f.show_status||'registered');
  const row={
   item_type:'teaching_show',
   title:f.title||('Show dạy PT - '+(f.customer_name||'Khách hàng')),
   customer_name:f.customer_name||'',
   kiot_customer_id:f.kiot_customer_id||'',
   pt_id:pt.id,
   pt_name:pt.full_name||pt.email||'',
   kiot_employee_id:f.kiot_employee_id||pt.kiot_employee_id||'',
   branch_id:branchId,
   branch_name:f.branch_name||br?.name||'',
   kiot_branch_id:f.kiot_branch_id||'',
   show_date:f.show_date||today(),
   start_time:f.start_time||'18:00',
   end_time:f.end_time||'19:00',
   service_product_id:f.service_product_id||'',
   service_product_name:f.service_product_name||'Buổi PT / Teaching show',
   price:Number(f.price||0),
   discount_percent:Number(f.discount_percent||0),
   discount_amount:Number(f.discount_amount||0),
   show_status:safeStatus,
   description:f.description||''
  };
  const q=f.id?supabase.from('pt_checklists').update(row).eq('id',f.id):supabase.from('pt_checklists').insert({...row,created_by:profile.id});
  const{error}=await q;if(error)return alert(error.message);setModal(null);load(true)
 }
 async function completePtShow(id){
  const show=ptShows.find(x=>x.id===id);
  if(!show||!canCompletePtShow(show))return alert('Anh/chị không có quyền bấm hoàn thành show này hoặc show không còn ở trạng thái đã đăng ký.');
  const{data,error}=await supabase.rpc('mark_pt_show_completed',{show_id:id});
  if(error)return alert(error.message);

  // Gọi trực tiếp webhook n8n sau khi CRM update trạng thái thành công
  // Production webhook URL (workflow đã active)
  const webhook='https://n8n.kickfits.info/webhook/crm-show-pt-status';
  try{
    const res=await fetch(webhook,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        event:'show_status_changed',
        show_id:show.id||id,
        show_code:show.show_crm_code||show.show_code||show.id||id,
        status:'completed_pending_approval',
        customer_name:show.customer_name||show.title||'',
        kiot_customer_id:show.kiot_customer_id||'',
        pt_id:show.pt_id||'',
        pt_name:show.pt_name||profile.full_name||'',
        kiot_employee_id:show.kiot_employee_id||'',
        branch_id:show.branch_id||'',
        branch_name:show.branch_name||'',
        show_date:show.show_date||'',
        start_time:show.start_time||'',
        end_time:show.end_time||'',
        service_name:show.service_product_name||show.service_name||'',
        service_id:show.service_product_id||show.service_id||'',
        price:Number(show.price||0),
        note:show.description||show.note||'',
        completed_at:new Date().toISOString()
      })
    });
    if(!res.ok){
      const txt=await res.text().catch(()=>String(res.status));
      console.warn('N8N webhook response error',res.status,txt);
      alert('Đã hoàn thành trong CRM, nhưng n8n chưa nhận được webhook: '+res.status);
    }
  }catch(_e){
    console.warn('N8N webhook failed',_e);
    alert('Đã hoàn thành trong CRM, nhưng gọi webhook n8n bị lỗi. Kiểm tra workflow test/production và CORS.');
  }

  alert('Đã chuyển sang trạng thái Chờ duyệt Telegram.');
  load(true)
 }
 async function approvePtShow(id){
  const show=ptShows.find(x=>x.id===id);
  if(!show||!canApprovePtShow(show))return alert('Chỉ manager/admin đúng quyền mới được duyệt show này.');
  const{error}=await supabase.rpc('approve_pt_show',{show_id:id,manager_id:profile.id,manager_name:profile.full_name||profile.email||''});
  if(error)return alert(error.message);alert('Đã duyệt. Luồng Telegram/Kiot có thể bắt trạng thái approved để tạo hóa đơn.');load(true)
 }
 async function rejectPtShow(id){
  const show=ptShows.find(x=>x.id===id);
  if(!show||!(isAdmin||(isManager&&(!managerBranches.length||managerCanAccessBranch(show.branch_id)))))return alert('Chỉ manager/admin đúng quyền mới được từ chối show này.');
  const reason=prompt('Lý do từ chối')||'Không đạt yêu cầu';
  const{error}=await supabase.from('pt_checklists').update({show_status:'rejected',rejected_by:profile.id,rejected_by_name:profile.full_name||profile.email||'',rejected_at:new Date().toISOString(),reject_reason:reason,updated_at:new Date().toISOString()}).eq('id',id);
  if(error)return alert(error.message);load(true)
 }
 async function markKiotInvoice(show){
  if(!(isAdmin||isManager))return alert('Chỉ manager/admin được lưu mã hóa đơn Kiot.');
  if(isManager&&managerBranches.length&&!managerCanAccessBranch(show.branch_id))return alert('Manager chỉ được xử lý show của cơ sở được phân quyền.');
  const code=prompt('Mã hóa đơn Kiot',show.kiot_invoice_code||'');
  if(!code)return;
  const{error}=await supabase.rpc('mark_pt_show_kiot_invoice_created',{show_id:show.id,invoice_id:code,invoice_code:code});
  if(error)return alert(error.message);load(true)
 }
 async function deletePtShow(id){
  if(!isAdmin)return alert('Chỉ Admin mới được xóa show PT.');
  if(!confirm('Xác nhận xóa show PT này? Hành động không thể hoàn tác.'))return;
  const{error}=await supabase.from('pt_checklists').delete().eq('id',id);
  if(error)return alert(error.message);load(true)
 }
 const visibleBoards=isStaff?boards.filter(b=>b.branch_id===profile.branch_id):boards;
 const base=isPT&&!['BOARD','Show PT'].includes(page)?'BOARD':(page.startsWith('Tài khoản')?'Tài khoản':page);
 return <div className='app'><aside><div className='brand'><div className='logo'>AKC</div><div><h1>AKC CRM</h1><p>Cloud v8</p></div></div><div className='mobile-user'><button className='user-pill' onClick={()=>setUserMenu(!userMenu)}><span>{(profile.full_name||'U').slice(0,1).toUpperCase()}</span></button>{userMenu&&<div className='user-menu'><strong>{profile.full_name}</strong><small>{profile.role}</small><button onClick={()=>setPasswordModal({})}>Đổi mật khẩu</button><button onClick={()=>supabase.auth.signOut()}>Đăng xuất</button></div>}</div><nav>{nav.map(n=><button key={n} className={base===n.split(' (')[0]?'active':''} onClick={()=>setPage(n.split(' (')[0])}>{n}</button>)}</nav><div className='me'><b>{profile.full_name}</b><span>{profile.role} {profile.branch_id?'· '+bname(branches,profile.branch_id):''}</span><button onClick={()=>setPasswordModal({})}>Đổi mật khẩu</button><button onClick={()=>supabase.auth.signOut()}>Đăng xuất</button></div></aside><main><header><div><h2>{base}</h2><p>{isAdmin?'Admin toàn hệ thống':isManager?'Manager cơ sở':'Sale cá nhân'} · Supabase realtime</p></div><div><input ref={fileInputRef} type='file' accept='.csv' style={{display:'none'}} onChange={importData}/>{(isAdmin||isManager)&&base!=='BOARD'&&<><button onClick={()=>fileInputRef.current?.click()}>Nhập CSV</button><button onClick={exportData}>Xuất CSV</button></>}{base==='BOARD'?<button className='primary' onClick={()=>setBoardModal({})}>+ Tạo board</button>:base==='Lịch hẹn'?<button className='primary' onClick={()=>setCalendarModal({})}>+ Thêm lịch hẹn</button>:base==='Show PT'?<button className='primary' onClick={()=>setModal({type:'teaching_show'})}>+ Đăng ký show PT</button>:<button className='primary' onClick={()=>setModal({})}>+ Thêm lead</button>}</div></header>{!isPT&&<Filters filter={filter} setFilter={setFilter} branches={avBranches} users={avUsers}/>}{base==='Tổng quan'&&<Dashboard leads={rows} branches={avBranches} users={avUsers}/>} {base==='Lead'&&<Lead leads={rows} branches={branches} users={users} edit={setModal} del={delLead} isAdmin={isAdmin}/>} {base==='Pipeline'&&<Pipeline leads={rows} branches={branches} users={users} setStatus={status}/>} {base==='Lịch hẹn'&&<Calendar leads={rows} branches={branches} users={users} add={()=>setCalendarModal({})}/>} {base==='BOARD'&&<BoardPage boards={visibleBoards} lists={boardLists} cards={boardCards} checks={cardChecks} comments={cardComments} users={users} profile={profile} selectedBoard={selectedBoard} setSelectedBoard={setSelectedBoard} setBoardModal={setBoardModal} setCardModal={setCardModal} addList={addBoardList} renameList={renameBoardList} delList={delBoardList} delBoard={delBoard} moveCard={moveBoardCard} dragCard={dragCard}/>} {base==='Show PT'&&<TeachingShows shows={ptShows} branches={branches} users={users} profile={profile} edit={setModal} complete={completePtShow} approve={approvePtShow} reject={rejectPtShow} markInvoice={markKiotInvoice} deleteShow={deletePtShow}/>} {base==='Báo cáo'&&<Reports leads={rows} branches={branches} users={users}/>}  {base==='Cơ sở'&&isAdmin&&<Branches branches={branches} reload={()=>load(true)}/>} {base==='Tài khoản'&&isAdmin&&<Users users={users} branches={branches} reload={()=>load(true)}/>} {base==='Zalo/Facebook'&&<Panel title='Zalo/Facebook' text='Sẵn sàng nối Zalo OA, Facebook Lead Form, Hotline ở bản tiếp theo.'/>}</main>{modal&&(modal.type==='teaching_show'?<PtShowModal initial={modal} branches={avBranches} users={users.filter(u=>u.role==='pt'||u.role==='manager'||u.role==='admin')} profile={profile} onClose={()=>setModal(null)} onSave={savePtShow}/>:<LeadModal initial={modal} branches={avBranches} users={avUsers} profile={profile} onClose={()=>setModal(null)} onSave={saveLead}/>)} {calendarModal&&<AppointmentModal initial={calendarModal} branches={avBranches} users={avUsers} profile={profile} onClose={()=>setCalendarModal(null)} onSave={saveAppointment}/>} {taskModal&&<TaskModal initial={taskModal} branches={avBranches} users={avUsers} leads={leads} profile={profile} onClose={()=>setTaskModal(null)} onSave={saveTask}/>} {boardModal&&<BoardModal initial={boardModal} branches={avBranches} profile={profile} onClose={()=>setBoardModal(null)} onSave={saveBoard}/>} {cardModal&&<BoardCardModal initial={cardModal} lists={boardLists.filter(l=>l.board_id===(cardModal.board_id||selectedBoard))} users={users} checks={cardChecks.filter(c=>c.card_id===cardModal.id)} comments={cardComments.filter(c=>c.card_id===cardModal.id)} profile={profile} onClose={()=>setCardModal(null)} onSave={saveBoardCard} onDelete={delBoardCard} toggleCheck={toggleCheck} updateCheckText={updateCheckText} deleteCheck={deleteCheck} addComment={addComment} updateComment={updateComment} deleteComment={deleteComment}/>} {passwordModal&&<PasswordModal onClose={()=>setPasswordModal(null)} onSave={changeOwnPassword}/>}</div>}
function Setup(){return <Splash text='Chưa cấu hình Supabase. Thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trong Vercel.'/>}
function Splash({text}){return <div className='login'><div className='card'><div className='logo big'>AKC</div><h1>AKC CRM v8</h1><p>{text}</p></div></div>}
function Pending({profile}){return <div className='login'><div className='card'><div className='logo big'>AKC</div><h1>Đang chờ duyệt</h1><p>{profile?.email||''} chưa được Admin duyệt hoặc đang bị khóa.</p><button className='primary full' onClick={()=>supabase.auth.signOut()}>Đăng xuất</button></div></div>}
function PasswordModal({onClose,onSave}){const[f,setF]=useState({password:'',confirm:''});return <div className='modal' onMouseDown={onClose}><form className='modal-card password-modal' onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();onSave(f)}}><div className='modal-head'><h3>Đổi mật khẩu</h3><button type='button' onClick={onClose}>×</button></div><label>Mật khẩu mới<input type='password' value={f.password} onChange={e=>setF({...f,password:e.target.value})} minLength={6} required/></label><label>Nhập lại mật khẩu mới<input type='password' value={f.confirm} onChange={e=>setF({...f,confirm:e.target.value})} minLength={6} required/></label><p className='hint'>Sau khi đổi, lần đăng nhập sau dùng mật khẩu mới. Nếu quên mật khẩu, dùng nút Quên mật khẩu ở màn hình đăng nhập.</p><button className='primary full'>Cập nhật mật khẩu</button></form></div>}
function ResetPasswordForm({onDone}){const[pw,setPw]=useState(''),[pw2,setPw2]=useState(''),[err,setErr]=useState(''),[ok,setOk]=useState(false);async function submit(e){e.preventDefault();setErr('');if(pw.length<6)return setErr('Mật khẩu tối thiểu 6 ký tự');if(pw!==pw2)return setErr('Mật khẩu xác nhận chưa khớp');const{error}=await supabase.auth.updateUser({password:pw});if(error)return setErr(error.message);setOk(true);setTimeout(()=>onDone(),2000);}return <div className='login'><div className='card'><div className='logo big'>AKC</div><h1>Đặt mật khẩu mới</h1><p>Nhập mật khẩu mới cho tài khoản của bạn.</p>{ok?<div className='success'>Đổi mật khẩu thành công! Đang chuyển về trang đăng nhập...</div>:<form onSubmit={submit}><label>Mật khẩu mới<input type='password' value={pw} onChange={e=>setPw(e.target.value)} minLength={6} required autoFocus/></label><label>Nhập lại mật khẩu mới<input type='password' value={pw2} onChange={e=>setPw2(e.target.value)} minLength={6} required/></label>{err&&<div className='error'>{err}</div>}<button className='primary full'>Cập nhật mật khẩu</button></form>}</div></div>}
function Auth({branches}){const[mode,setMode]=useState('login'),[err,setErr]=useState(''),[login,setLogin]=useState({email:'',password:''}),[reg,setReg]=useState({name:'',phone:'',email:'',password:'',branch_id:''});useEffect(()=>{if(branches[0]&&!reg.branch_id)setReg(r=>({...r,branch_id:branches[0].id}))},[branches]);async function inx(e){e.preventDefault();setErr('');const{error}=await supabase.auth.signInWithPassword({email:login.email.trim().toLowerCase(),password:login.password});if(error)setErr(error.message)}async function up(e){e.preventDefault();setErr('');const{error}=await supabase.auth.signUp({email:reg.email.trim().toLowerCase(),password:reg.password,options:{data:{full_name:reg.name,phone:reg.phone,branch_id:reg.branch_id}}});if(error)return setErr(error.message);setMode('login');setLogin({email:reg.email,password:reg.password});setErr('Đăng ký thành công. Tài khoản đang chờ Admin duyệt.')}async function forgot(){setErr('');if(!login.email.trim())return setErr('Nhập email trước rồi bấm Quên mật khẩu.');const{error}=await supabase.auth.resetPasswordForEmail(login.email.trim().toLowerCase(),{redirectTo:window.location.origin+'/reset-password'});if(error)return setErr(error.message);setErr('Đã gửi email khôi phục mật khẩu. Anh/chị kiểm tra hộp thư.') }return <div className='login'><div className='card'><div className='logo big'>AKC</div><h1>{mode==='login'?'Đăng nhập AKC CRM':'Đăng ký tài khoản'}</h1><p>{mode==='login'?'Tài khoản phải được Admin duyệt mới đăng nhập được.':'Sau khi đăng ký, Admin sẽ phân quyền và kích hoạt tài khoản.'}</p>{mode==='login'?<form onSubmit={inx}><label>Email<input value={login.email} onChange={e=>setLogin({...login,email:e.target.value})} required/></label><label>Mật khẩu<input type='password' value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} required/></label>{err&&<div className={err.includes('thành công')||err.includes('Đã gửi')?'success':'error'}>{err}</div>}<button className='primary full'>Đăng nhập</button><button type='button' className='ghost full' onClick={forgot}>Quên mật khẩu</button><button type='button' className='ghost full' onClick={()=>{setMode('register');setErr('')}}>Đăng ký tài khoản mới</button></form>:<form onSubmit={up}><label>Họ tên<input value={reg.name} onChange={e=>setReg({...reg,name:e.target.value})} required/></label><label>SĐT<input value={reg.phone} onChange={e=>setReg({...reg,phone:e.target.value})}/></label><label>Email<input type='email' value={reg.email} onChange={e=>setReg({...reg,email:e.target.value})} required/></label><label>Mật khẩu<input type='password' value={reg.password} onChange={e=>setReg({...reg,password:e.target.value})} required/></label><label>Cơ sở<select value={reg.branch_id} onChange={e=>setReg({...reg,branch_id:e.target.value})}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{err&&<div className='error'>{err}</div>}<button className='primary full'>Gửi đăng ký</button><button type='button' className='ghost full' onClick={()=>{setMode('login');setErr('')}}>Quay lại đăng nhập</button></form>}</div></div>}
function Filters({filter,setFilter,branches,users}){const set=(k,v)=>setFilter({...filter,[k]:v});return <section className='filters'><input className='lead-search' value={filter.q||''} onChange={e=>set('q',e.target.value)} placeholder='Tìm tên/SĐT khách hàng...'/><select value={filter.branch_id} onChange={e=>set('branch_id',e.target.value)}><option value=''>Tất cả cơ sở</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><select value={filter.source} onChange={e=>set('source',e.target.value)}><option value=''>Tất cả nguồn</option>{SOURCES.map(s=><option key={s}>{s}</option>)}</select><select value={filter.owner_id} onChange={e=>set('owner_id',e.target.value)}><option value=''>Tất cả sale</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><input type='date' className='date-from' value={filter.date_from||''} onChange={e=>set('date_from',e.target.value)} title='Từ ngày'/><input type='date' className='date-to' value={filter.date_to||''} onChange={e=>set('date_to',e.target.value)} title='Đến ngày'/><button onClick={()=>setFilter({branch_id:'',source:'',owner_id:'',date_from:'',date_to:'',q:''})}>Xóa lọc</button></section>}
function Dashboard({leads,branches,users}){const won=leads.filter(l=>l.status==='Đã mua gói'),rev=won.reduce((s,l)=>s+Number(l.value||0),0);const bySource=SOURCES.map(src=>({name:src,value:leads.filter(l=>l.source===src).length})).filter(x=>x.value);const byStatus=STATUSES.map(st=>({name:st,value:leads.filter(l=>l.status===st).length}));const bySale=users.map(u=>({name:u.full_name||'NV',value:leads.filter(l=>l.owner_id===u.id).length})).filter(x=>x.value).slice(0,8);const last7=[...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const key=d.toISOString().slice(0,10);return{name:key.slice(5),value:leads.filter(l=>String(l.created_at||'').slice(0,10)===key).length}});const max=Math.max(1,...bySource.map(x=>x.value),...bySale.map(x=>x.value),...last7.map(x=>x.value));const pieColors=['#38bdf8','#fb7185','#fb923c','#facc15','#22c55e','#ef4444'];let pieAcc=0;const totalStatus=Math.max(1,byStatus.reduce((s,x)=>s+x.value,0));const pieStops=byStatus.map((x,i)=>{const start=pieAcc;pieAcc+=x.value/totalStatus*360;return `${pieColors[i%pieColors.length]} ${start}deg ${pieAcc}deg`}).join(',');return <><div className='cards dashboard-kpis'><Card t='Tổng Lead' v={leads.length} s='Lead trong bộ lọc'/><Card t='Lịch hẹn' v={leads.filter(l=>l.follow_date).length} s='Khách hẹn CLB'/><Card t='Đã chốt' v={won.length} s='Khách đã mua gói'/><Card t='Doanh thu dự kiến' v={money(rev)} s='Theo deal đã chốt'/></div><div className='dash-grid'><section className='panel chart-card'><div className='chart-head'><h3>Lead theo nguồn</h3><span>Facebook / Zalo / TikTok / Referral</span></div><div className='bar-chart'>{bySource.length?bySource.map(x=><div className='bar-col' key={x.name}><i style={{height:(x.value/max*100)+'%'}}></i><span>{x.name}</span><b>{x.value}</b></div>):<p>Chưa có dữ liệu nguồn.</p>}</div></section><section className='panel chart-card'><div className='chart-head'><h3>Trạng thái lead</h3><span>Pipeline hiện tại</span></div><div className='pie-wrap'><div className='pie-chart' style={{background:`conic-gradient(${pieStops||'#e5e7eb 0deg 360deg'})`}}><span>{leads.length}</span></div><div className='pie-legend'>{byStatus.map((x,i)=><p key={x.name}><i style={{background:pieColors[i%pieColors.length]}}></i>{x.name}: <b>{x.value}</b></p>)}</div></div><div className='funnel-mini'>{byStatus.map((x,i)=><div key={x.name} className={'funnel-step s'+i}><b>{x.value}</b><span>{x.name}</span></div>)}</div></section><section className='panel chart-card'><div className='chart-head'><h3>Lead theo thời gian</h3><span>7 ngày gần nhất</span></div><div className='line-fake'>{last7.map(x=><div key={x.name} className='line-point'><i style={{height:(x.value/max*100)+'%'}}></i><span>{x.name}</span><b>{x.value}</b></div>)}</div></section><section className='panel chart-card'><div className='chart-head'><h3>KPI theo sale</h3><span>Lead đang phụ trách</span></div><div className='hbar-chart'>{bySale.length?bySale.map(x=><div className='hbar' key={x.name}><span>{x.name}</span><i><em style={{width:(x.value/max*100)+'%'}}></em></i><b>{x.value}</b></div>):<p>Chưa có dữ liệu sale.</p>}</div></section></div><section className='panel funnel-panel'><div className='chart-head'><h3>Funnel chuyển đổi</h3><span>Mới → Gọi → Hẹn → Chốt</span></div><div className='funnel-cards'>{byStatus.map((x,i)=><div className={'funnel-card fc'+i} key={x.name}><span>{x.name}</span><b>{x.value}</b><small>{leads.length?Math.round(x.value/leads.length*100):0}% tổng lead</small></div>)}</div></section></>}


function TeachingShows({shows,branches,users,profile,edit,complete,approve,reject,markInvoice,deleteShow}){
 const isApprover=['admin','manager'].includes(profile.role);
 const isAdmin=profile.role==='admin',isManager=profile.role==='manager',isPT=profile.role==='pt';
 const statusLabel={
  draft:'Nháp',
  registered:'Đã đăng ký',
  completed_pending_approval:'Chờ duyệt',
  approved:'Đã duyệt',
  rejected:'Từ chối',
  kiot_invoice_created:'Đã tạo HĐ Kiot',
  kiot_invoice_error:'Lỗi HĐ Kiot'
 };
 const canSee=s=>isAdmin||(isManager&&(!profile.branch_id||s.branch_id===profile.branch_id))||(isPT&&s.pt_id===profile.id);
 const canEdit=s=>isAdmin||(isManager&&canSee(s))||(isPT&&s.pt_id===profile.id&&['draft','registered','rejected'].includes(s.show_status||'registered'));
 const canComplete=s=>['draft','registered'].includes(s.show_status||'registered')&&(isAdmin||(isManager&&canSee(s))||(isPT&&s.pt_id===profile.id));
 const canApprove=s=>isApprover&&canSee(s)&&s.show_status==='completed_pending_approval';
 const list=shows.filter(canSee);
 const title=isPT?'Show PT của tôi':isManager?'Show PT cơ sở':'Checklist Show PT / Duyệt hóa đơn';
 return <section className='panel pt-show-panel'><div className='chart-head'><div><h3>{title}</h3><p>{isPT?'PT chỉ thấy show của chính mình và bấm hoàn thành để gửi quản lý duyệt.':'Luồng: PT đăng ký show → PT bấm hoàn thành → Quản lý duyệt → n8n/Telegram/Kiot tạo hóa đơn.'}</p></div></div><div className='table pt-show-table'><table><thead><tr><th>KH / PT</th><th>Ngày giờ</th><th>Cơ sở</th><th>Gói dịch vụ</th><th>Giá</th><th>Trạng thái</th>{isApprover&&<th>Kiot</th>}<th>Thao tác</th></tr></thead><tbody>{list.map(s=><tr key={s.id}><td><b>{s.customer_name||s.title}</b><br/><small>Show: {s.show_crm_code||s.id}</small><br/><small>PT: {s.pt_name||uname(users,s.pt_id)}</small></td><td>{s.show_date||''}<br/><small>{s.start_time||''} - {s.end_time||''}</small></td><td>{s.branch_name||bname(branches,s.branch_id)}</td><td>{s.service_product_name||''}</td><td>{money(s.price)}</td><td><span className={'show-status '+String(s.show_status||'draft')}>{statusLabel[s.show_status]||s.show_status}</span>{s.reject_reason&&<small>{s.reject_reason}</small>}</td>{isApprover&&<td>{s.kiot_invoice_code?<b>{s.kiot_invoice_code}</b>:<small>Chưa tạo</small>}</td>}<td><div className='show-actions'>{canEdit(s)&&<button onClick={()=>edit({...s,type:'teaching_show'})}>Sửa</button>}{canComplete(s)&&<button className='primary' onClick={()=>complete(s.id)}>Hoàn thành</button>}{canApprove(s)&&<><button className='primary' onClick={()=>approve(s.id)}>Duyệt</button><button className='danger' onClick={()=>reject(s.id)}>Từ chối</button></>}{isApprover&&canSee(s)&&s.show_status==='approved'&&<button onClick={()=>markInvoice(s)}>Lưu mã HĐ</button>}{isAdmin&&<button className='danger' onClick={()=>deleteShow(s.id)}>Xóa</button>}{!canEdit(s)&&!canComplete(s)&&!canApprove(s)&&!(isApprover&&s.show_status==='approved')&&!isAdmin&&<small>Chỉ xem</small>}</div></td></tr>)}{!list.length&&<tr><td colSpan={isApprover?'8':'7'}>Chưa có show PT. Bấm “Đăng ký show” để tạo checklist/hồ sơ chờ duyệt.</td></tr>}</tbody></table></div></section>
}
function PtShowModal({initial,branches,users,profile,onClose,onSave}){
 const isApprover=['admin','manager'].includes(profile.role);
 const pts=profile.role==='pt'?[profile]:users.filter(u=>['pt','manager','admin'].includes(u.role)&&(profile.role!=='manager'||!profile.branch_id||u.branch_id===profile.branch_id||u.id===profile.id));
 const defaultBranch=profile.branch_id||branches[0]?.id||'';
 const makeShowCode=()=> 'SHOW-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+Math.random().toString(36).slice(2,7).toUpperCase();
 const firstPt=pts[0]||profile;
 const[f,setF]=useState({type:'teaching_show',show_crm_code:initial.show_crm_code||initial.show_id||makeShowCode(),customer_name:'',kiot_customer_id:'',pt_id:profile.role==='pt'?profile.id:(firstPt.id||profile.id),kiot_employee_id:firstPt.kiot_employee_id||'',branch_id:defaultBranch,show_date:today(),start_time:'18:00',end_time:'19:00',service_product_id:'',service_product_name:'',price:'',discount_percent:'',discount_amount:'',show_status:'registered',description:'',...initial});
 const set=(k,v)=>setF({...f,[k]:v});
 // Kiot search states
 const[custResults,setCustResults]=useState([]);
 const[custLoading,setCustLoading]=useState(false);
 const[custOpen,setCustOpen]=useState(false);
 const[svcResults,setSvcResults]=useState([]);
 const[svcLoading,setSvcLoading]=useState(false);
 const[svcOpen,setSvcOpen]=useState(false);
 const[empLoading,setEmpLoading]=useState(false);
 const[kiotBranches,setKiotBranches]=useState([]);
 const[branchLoading,setBranchLoading]=useState(false);
 const[noteLoading,setNoteLoading]=useState(false);
 const custTimer=useRef(null);
 const svcTimer=useRef(null);
 // Load Kiot branches on mount
 useEffect(()=>{
  setBranchLoading(true);
  fetch('/api/show/kiot-search?type=branch&q=all').then(r=>r.json()).then(d=>{
   if(d.success)setKiotBranches(d.results||[]);
  }).catch(()=>{}).finally(()=>setBranchLoading(false));
 },[]);
 // Auto-fill kiot_employee_id for firstPt if not set in Supabase
 useEffect(()=>{
  if(!f.kiot_employee_id&&f.pt_id){
   const pt=pts.find(u=>u.id===f.pt_id)||firstPt;
   const ptName=pt.full_name||pt.email||'';
   if(ptName.length>=2){
    setEmpLoading(true);
    fetch('/api/show/kiot-search?type=employee&q='+encodeURIComponent(ptName))
     .then(r=>r.json()).then(data=>{
      if(data.success&&data.results.length>0){
       const match=data.results[0];
       setF(prev=>({...prev,kiot_employee_id:String(match.id||'')}));
      }
     }).catch(()=>{}).finally(()=>setEmpLoading(false));
   }
  }
 },[]);
 // Debounced Kiot customer search
 function searchCustomer(q){
  setF(prev=>({...prev,customer_name:q}));
  if(custTimer.current)clearTimeout(custTimer.current);
  if(!q||q.length<2){setCustResults([]);setCustOpen(false);return;}
  setCustLoading(true);
  custTimer.current=setTimeout(async()=>{
   try{
    const resp=await fetch('/api/show/kiot-search?type=customer&q='+encodeURIComponent(q));
    const data=await resp.json();
    if(data.success){setCustResults(data.results||[]);setCustOpen(true);}
   }catch(e){console.error('Kiot search error',e)}
   setCustLoading(false);
  },500);
 }
 function selectCustomer(c){
  setF(prev=>({...prev,customer_name:c.name,kiot_customer_id:c.code}));
  setCustOpen(false);setCustResults([]);
  // Auto-fill ghi chú số buổi từ Kiot
  autoFillNote(c.code,f.service_product_name||'');
 }
 async function autoFillNote(customerCode,serviceName){
  if(!customerCode)return;
  setNoteLoading(true);
  try{
   const params=new URLSearchParams({customer_code:customerCode});
   if(serviceName)params.append('service_name',serviceName);
   const resp=await fetch('/api/show/kiot-customer-info?'+params.toString());
   const data=await resp.json();
   if(data.success&&data.auto_note){
    setF(prev=>({...prev,description:data.auto_note}));
   }
  }catch(e){console.error('autoFillNote error',e);}
  setNoteLoading(false);
 }

 // Debounced Kiot service search
 function searchService(q){
  setF(prev=>({...prev,service_product_name:q}));
  if(svcTimer.current)clearTimeout(svcTimer.current);
  if(!q||q.length<2){setSvcResults([]);setSvcOpen(false);return;}
  setSvcLoading(true);
  svcTimer.current=setTimeout(async()=>{
   try{
    const resp=await fetch('/api/show/kiot-search?type=product&q='+encodeURIComponent(q));
    const data=await resp.json();
    if(data.success){setSvcResults(data.results||[]);setSvcOpen(true);}
   }catch(e){console.error('Kiot search error',e)}
   setSvcLoading(false);
  },500);
 }
 function selectService(s){
  setF(prev=>({...prev,service_product_id:s.code,service_product_name:s.name,price:s.price||prev.price}));
  setSvcOpen(false);setSvcResults([]);
  // Nếu là gói nhóm -> điền 1/1, nếu đã chọn KH -> re-fetch ghi chú
  if(/nhóm/i.test(s.name)){
   setF(prev=>({...prev,service_product_id:s.code,service_product_name:s.name,price:s.price||prev.price,description:'1/1'}));
  }else if(f.kiot_customer_id){
   autoFillNote(f.kiot_customer_id,s.name);
  }
 }
 function changePT(id){
  const pt=pts.find(u=>u.id===id)||profile;
  const ptKiotId=pt.kiot_employee_id||'';
  setF(prev=>({...prev,pt_id:id,kiot_employee_id:ptKiotId||prev.kiot_employee_id||'',branch_id:profile.role==='admin'?(pt.branch_id||prev.branch_id):prev.branch_id}));
  // Only search Kiot API if pt.kiot_employee_id is not set in Supabase
  if(!ptKiotId){
   const ptName=pt.full_name||pt.email||'';
   if(ptName.length>=2){
    setEmpLoading(true);
    fetch('/api/show/kiot-search?type=employee&q='+encodeURIComponent(ptName))
     .then(r=>r.json()).then(data=>{
      if(data.success&&data.results.length>0){
       const match=data.results[0];
       setF(prev=>({...prev,kiot_employee_id:String(match.id||match.code||'')}));
      }
     }).catch(()=>{}).finally(()=>setEmpLoading(false));
   }
  }
 }
 function changeServiceId(v){const presets={PT001:'Buổi PT cá nhân',PTSHOW:'Buổi PT / Teaching show',GROUPPT:'Buổi PT nhóm'};setF({...f,service_product_id:v,service_product_name:f.service_product_name||presets[String(v).toUpperCase()]||''});}
 function submit(e){e.preventDefault();
  if(!String(f.customer_name||'').trim())return alert('Tên khách hàng là bắt buộc.');
  if(!String(f.kiot_customer_id||'').trim())return alert('Mã KH Kiot là bắt buộc. Nhập tên/SĐT khách để tìm từ Kiot.');
  if(!String(f.pt_id||'').trim())return alert('PT phụ trách là bắt buộc.');
  if(!String(f.kiot_employee_id||'').trim())return alert('Mã nhân viên Kiot là bắt buộc.');
  if(!String(f.branch_id||'').trim())return alert('Cơ sở là bắt buộc.');
  if(!f.show_date||!f.start_time||!f.end_time)return alert('Ngày dạy, giờ bắt đầu và giờ kết thúc là bắt buộc.');
  if(!String(f.service_product_id||'').trim())return alert('Mã dịch vụ Kiot là bắt buộc.');
  if(!String(f.service_product_name||'').trim())return alert('Gói/dịch vụ là bắt buộc.');
  if(Number(f.price)<0||f.price==='')return alert('Giá không được để trống (nhập 0 nếu đã thu tiền trước).');
  onSave({...f,show_status:f.show_status||'registered'});
 }
 return <div className='modal pt-show-overlay' onMouseDown={onClose}><form className='modal-card pt-show-modal pt-show-form-v2' onMouseDown={e=>e.stopPropagation()} onSubmit={submit}><div className='modal-head no-close'><div><h3>{f.id?'Sửa show PT':'Đăng ký show PT'}</h3><p>Click ra vùng tối bên ngoài để đóng form.</p></div><button type='button' className='modal-close-x' onClick={onClose}>&times;</button></div><div className='show-code-box'><label>Mã show CRM / show_id<input value={f.show_crm_code||''} onChange={e=>set('show_crm_code',e.target.value)} required/></label><small>Mã này dùng để n8n/Telegram/Kiot đối soát đúng hồ sơ show.</small></div><div className='modal-grid'><label className='kiot-autocomplete'>Tên khách hàng <b>*</b><input value={f.customer_name||''} onChange={e=>searchCustomer(e.target.value)} onFocus={()=>{if(custResults.length)setCustOpen(true)}} onBlur={()=>setTimeout(()=>setCustOpen(false),200)} required placeholder='Nhập tên/SĐT để tìm KH Kiot' autoComplete='off'/>{custLoading&&<small className='kiot-loading'>Đang tìm...</small>}{custOpen&&custResults.length>0&&<ul className='kiot-dropdown'>{custResults.map(c=><li key={c.id} onMouseDown={()=>selectCustomer(c)}><b>{c.name}</b><span>{c.code}{c.phone?' · '+c.phone:''}</span></li>)}</ul>}</label><label>Mã KH Kiot <b>*</b><input value={f.kiot_customer_id||''} onChange={e=>set('kiot_customer_id',e.target.value)} required placeholder='Tự fill khi chọn KH'/></label><label>PT phụ trách <b>*</b><select disabled={profile.role==='pt'} value={f.pt_id||''} onChange={e=>changePT(e.target.value)} required>{pts.map(u=><option key={u.id} value={u.id}>{u.full_name||u.email}</option>)}</select></label><label>Mã NV Kiot <b>*</b>{empLoading&&<small className='kiot-loading'>Đang tìm...</small>}<input value={f.kiot_employee_id||''} onChange={e=>set('kiot_employee_id',e.target.value)} required placeholder='Tự fill khi chọn PT'/></label><label>Cơ sở Kiot <b>*</b><select value={f.kiot_branch_id||''} onChange={e=>{const kb=kiotBranches.find(b=>String(b.id)===e.target.value);setF(prev=>({...prev,kiot_branch_id:e.target.value,branch_name:kb?kb.name:prev.branch_name}))}} required>{!f.kiot_branch_id&&<option value=''>-- Chọn cơ sở Kiot --</option>}{kiotBranches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div><div className='show-datetime-row'><label>Ngày dạy <b>*</b><input type='date' value={f.show_date||today()} onChange={e=>set('show_date',e.target.value)} required/></label><label>Giờ BĐ <b>*</b><input type='time' value={f.start_time||''} onChange={e=>set('start_time',e.target.value)} required/></label><label>Giờ KT <b>*</b><input type='time' value={f.end_time||''} onChange={e=>set('end_time',e.target.value)} required/></label></div><div className='modal-grid'><label className='kiot-autocomplete'>Gói/dịch vụ Kiot <b>*</b><input value={f.service_product_name||''} onChange={e=>searchService(e.target.value)} onFocus={()=>{if(svcResults.length)setSvcOpen(true)}} onBlur={()=>setTimeout(()=>setSvcOpen(false),200)} required placeholder='Nhập tên dịch vụ (VD: Cá nhân 250k)' autoComplete='off'/>{svcLoading&&<small className='kiot-loading'>Đang tìm...</small>}{svcOpen&&svcResults.length>0&&<ul className='kiot-dropdown'>{svcResults.map(s=><li key={s.id} onMouseDown={()=>selectService(s)}><b>{s.name}</b><span>{s.code} · {money(s.price)}</span></li>)}</ul>}</label><label>Mã dịch vụ Kiot <b>*</b><input value={f.service_product_id||''} onChange={e=>changeServiceId(e.target.value)} required placeholder='Tự fill khi chọn DV'/></label><label>Giá <b>*</b><input type='number' min='0' value={f.price===0?'0':(f.price||'')} onChange={e=>set('price',e.target.value)} required placeholder='0 nếu đã thu tiền trước'/></label><label>Giảm giá (%)<input type='number' min='0' max='100' step='0.1' value={f.discount_percent||''} onChange={e=>{const pct=e.target.value;const amt=pct&&Number(f.price)?Math.round(Number(f.price)*Number(pct)/100):'';setF(prev=>({...prev,discount_percent:pct,discount_amount:amt?String(amt):''}))}} placeholder='VD: 2.5'/></label><label>Giảm giá (VNĐ)<input type='number' min='0' value={f.discount_amount||''} onChange={e=>{const amt=e.target.value;const pct=amt&&Number(f.price)?((Number(amt)/Number(f.price))*100).toFixed(1):'';setF(prev=>({...prev,discount_amount:amt,discount_percent:pct}))}} placeholder='VD: 10000'/></label>{isApprover&&<label>Trạng thái<select value={f.show_status||'registered'} onChange={e=>set('show_status',e.target.value)}><option value='registered'>Đã đăng ký</option><option value='completed_pending_approval'>Chờ duyệt</option><option value='approved'>Đã duyệt</option><option value='rejected'>Từ chối</option></select></label>}</div><label>Ghi chú <span>optional</span>{noteLoading&&<small className='kiot-loading'>Đang tự động tính số buổi...</small>}<textarea value={f.description||''} onChange={e=>set('description',e.target.value)} placeholder='Số buổi sẽ tự điền khi chọn KH và dịch vụ...'/></label><button className='primary full'>Lưu show PT</button></form></div>
}

function Reports({leads,branches,users}){const sold=leads.filter(l=>l.status==='Đã mua gói'),rev=sold.reduce((s,l)=>s+Number(l.value||0),0);const bySale=users.map(u=>({id:u.id,name:u.full_name||u.email||'Chưa tên',count:sold.filter(l=>l.owner_id===u.id).length,revenue:sold.filter(l=>l.owner_id===u.id).reduce((s,l)=>s+Number(l.value||0),0)})).filter(x=>x.count||x.revenue).sort((a,b)=>b.revenue-a.revenue);const byBranch=branches.map(b=>({id:b.id,name:b.name,count:sold.filter(l=>l.branch_id===b.id).length,revenue:sold.filter(l=>l.branch_id===b.id).reduce((s,l)=>s+Number(l.value||0),0)})).filter(x=>x.count||x.revenue).sort((a,b)=>b.revenue-a.revenue);const maxSale=Math.max(...bySale.map(x=>x.revenue),1),maxBranch=Math.max(...byBranch.map(x=>x.revenue),1);return <><div className='cards report-kpis'><Card t='Khách đã mua gói' v={sold.length} s='Chỉ tính trạng thái Đã mua gói'/><Card t='Tổng doanh thu' v={money(rev)} s='Theo dữ liệu trong bộ lọc'/><Card t='Sale có doanh thu' v={bySale.length} s='Nhân sự chốt gói'/><Card t='Doanh thu TB/khách' v={money(sold.length?Math.round(rev/sold.length):0)} s='Giá trị trung bình'/></div><div className='report-grid'><section className='panel report-card'><div className='report-head'><h3>Doanh thu theo sale</h3><span>Khách đã mua gói</span></div>{bySale.length?bySale.map(x=><div className='report-bar' key={x.id}><div><b>{x.name}</b><small>{x.count} khách</small></div><div className='bar-wrap'><i style={{width:(x.revenue/maxSale*100)+'%'}}></i></div><strong>{money(x.revenue)}</strong></div>):<p>Chưa có khách đã mua gói trong bộ lọc.</p>}</section><section className='panel report-card'><div className='report-head'><h3>Doanh thu theo cơ sở</h3><span>Chi nhánh</span></div>{byBranch.length?byBranch.map(x=><div className='report-bar' key={x.id}><div><b>{x.name}</b><small>{x.count} khách</small></div><div className='bar-wrap branch'><i style={{width:(x.revenue/maxBranch*100)+'%'}}></i></div><strong>{money(x.revenue)}</strong></div>):<p>Chưa có doanh thu theo cơ sở.</p>}</section></div><section className='panel report-card'><div className='report-head'><h3>Danh sách khách đã mua gói</h3><span>{sold.length} khách</span></div><div className='table'><table><thead><tr><th>Khách hàng</th><th>SĐT</th><th>Cơ sở</th><th>Sale</th><th>Gói tập</th><th>Doanh thu</th><th>Ngày tạo</th><th>Ghi chú</th></tr></thead><tbody>{sold.map(l=><tr key={l.id}><td><b>{l.name}</b></td><td>{l.phone}</td><td>{bname(branches,l.branch_id)}</td><td>{uname(users,l.owner_id)}</td><td>{l.package_interest||''}</td><td><b>{money(l.value)}</b></td><td>{l.created_at?String(l.created_at).slice(0,10):''}</td><td>{l.note||''}</td></tr>)}{!sold.length&&<tr><td colSpan='8'>Chưa có khách hàng đã mua gói.</td></tr>}</tbody></table></div></section></>}
function Card({t,v,s}){return <div className='card'><span>{t}</span><strong>{v}</strong><small>{s}</small></div>}
function Panel({title,text}){return <section className='panel'><h3>{title}</h3><p>{text}</p></section>}
function Lead({leads,branches,users,edit,del,isAdmin}){const[q,setQ]=useState('');const filtered=leads.filter(l=>!q||String(l.name||'').toLowerCase().includes(q.toLowerCase())||String(l.phone||'').includes(q));return <section className='panel'><div className='chart-head'><h3>Danh sách Lead</h3><input className='lead-search' value={q} onChange={e=>setQ(e.target.value)} placeholder='Tìm tên hoặc SĐT khách hàng...'/></div><div className='table'><table><thead><tr><th>Khách</th><th>SĐT</th><th>Nguồn</th><th>Cơ sở</th><th>Sale</th><th>Trạng thái</th><th>Giá trị</th><th>Thao tác</th></tr></thead><tbody>{filtered.map(l=><tr key={l.id}><td><b>{l.name}</b><br/><small>{l.note}</small></td><td>{l.phone}</td><td>{l.source}</td><td>{bname(branches,l.branch_id)}</td><td>{uname(users,l.owner_id)}</td><td><span className='badge'>{l.status}</span></td><td>{money(l.value)}</td><td><button onClick={()=>edit(l)}>Sửa</button>{isAdmin&&<button className='danger' onClick={()=>del(l.id)}>Xóa</button>}</td></tr>)}</tbody></table></div></section>}
function Pipeline({leads,branches,users,setStatus}){return <div className='kanban'>{STATUSES.map(s=><div className='stage' key={s}><h3>{s}</h3>{leads.filter(l=>l.status===s).map(l=><div className='deal' key={l.id}><b>{l.name}</b><span>{bname(branches,l.branch_id)}</span><span>{uname(users,l.owner_id)} · {money(l.value)}</span><select value={l.status} onChange={e=>setStatus(l.id,e.target.value)}>{STATUSES.map(x=><option key={x}>{x}</option>)}</select></div>)}</div>)}</div>}
function Calendar({leads,branches,users,add}){const appts=leads.filter(l=>l.follow_date).sort((a,b)=>String(a.follow_date).localeCompare(String(b.follow_date)));const groups=appts.reduce((m,l)=>{(m[l.follow_date] ||= []).push(l);return m},{});return <section className='panel calendar-panel'><div className='chart-head'><h3>Lịch hẹn</h3><button className='primary' onClick={add}>+ Thêm lịch hẹn</button></div>{Object.keys(groups).length?Object.entries(groups).map(([date,items])=><div className='day-group' key={date}><h3>{date}</h3>{items.map(l=><div className='appointment' key={l.id}><div><b>{l.name}</b><p>{l.note}</p></div><div><span>{bname(branches,l.branch_id)}</span><span>{uname(users,l.owner_id)}</span><strong>{money(l.value)}</strong></div></div>)}</div>):<p>Chưa có lịch hẹn. Bấm “Thêm lịch hẹn” để tạo lịch T1 theo ngày, giờ, cơ sở, mục tiêu và doanh số dự kiến.</p>}</section>}
function AppointmentModal({initial,branches,users,profile,onClose,onSave}){const[f,setF]=useState({name:'',phone:'',branch_id:profile.branch_id||branches[0]?.id||'',owner_id:profile.id,date:today(),time:'18:00',status:'T1',goal:'Giảm cân',value:0,note:'',...initial});const set=(k,v)=>setF({...f,[k]:v});return <div className='modal' onMouseDown={onClose}><form className='modal-card appointment-modal' onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();onSave(f)}}><div className='modal-head'><h3>Thêm lịch hẹn</h3><button type='button' onClick={onClose}>×</button></div><div className='modal-grid'><label>Tên khách<input value={f.name} onChange={e=>set('name',e.target.value)} required/></label><label>SĐT<input value={f.phone} onChange={e=>set('phone',e.target.value)}/></label><label>Ngày hẹn<input type='date' value={f.date} onChange={e=>set('date',e.target.value)} required/></label><label>Giờ hẹn<input type='time' value={f.time} onChange={e=>set('time',e.target.value)}/></label><label>Cơ sở<select value={f.branch_id||''} onChange={e=>set('branch_id',e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Sale/PT phụ trách<select value={f.owner_id||''} onChange={e=>set('owner_id',e.target.value)}>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label><label>Loại lịch<select value={f.status} onChange={e=>set('status',e.target.value)}><option>T1</option><option>Đặt lịch</option><option>Đã gọi</option></select></label><label>Dự doanh số<input type='number' value={f.value} onChange={e=>set('value',e.target.value)} placeholder='500000'/></label></div><label>Mục tiêu<input value={f.goal} onChange={e=>set('goal',e.target.value)} placeholder='Giảm cân / Tăng cơ...'/></label><label>Ghi chú<textarea value={f.note} onChange={e=>set('note',e.target.value)}/></label><button className='primary full'>Lưu lịch hẹn</button></form></div>}
function Branches({branches,reload}){const[name,setName]=useState('');async function add(){if(!name.trim())return;const{error}=await supabase.from('branches').insert({name:name.trim()});if(error)alert(error.message);setName('');reload(true)}async function rename(b){const n=prompt('Tên mới',b.name);if(n){await supabase.from('branches').update({name:n}).eq('id',b.id);reload(true)}}async function remove(b){if(confirm('Xóa cơ sở?')){const{error}=await supabase.from('branches').delete().eq('id',b.id);if(error)alert(error.message);reload(true)}}return <section className='panel'><h3>Quản lý cơ sở</h3><div className='add'><input value={name} onChange={e=>setName(e.target.value)} placeholder='Tên cơ sở'/><button className='primary' onClick={add}>+ Thêm</button></div>{branches.map(b=><div className='row' key={b.id}><b>{b.name}</b><span><button onClick={()=>rename(b)}>Sửa</button><button className='danger' onClick={()=>remove(b)}>Xóa</button></span></div>)}</section>}
function Users({users,branches,reload}){
 const[edit,setEdit]=useState(null);
 const[transfer,setTransfer]=useState({from_id:'',to_id:''});
 const[kiotUsers,setKiotUsers]=useState([]);
 const[kiotLoading,setKiotLoading]=useState(false);
 const activeSales=users.filter(u=>u.active&&u.status==='approved'&&['sale','manager','admin'].includes(u.role));
 // Load Kiot users once when edit opens
 function openEdit(u){
  setEdit(u);
  if(!kiotUsers.length){
   setKiotLoading(true);
   fetch('/api/show/kiot-search?type=employee&q=PT')
    .then(r=>r.json()).then(d=>{
     if(d.success)setKiotUsers(d.results||[]);
    }).catch(()=>{}).finally(()=>setKiotLoading(false));
  }
 }
 // Auto-search Kiot by full_name when name changes
 async function autoMatchKiot(name){
  if(!name||name.length<2)return;
  try{
   const r=await fetch('/api/show/kiot-search?type=employee&q='+encodeURIComponent(name));
   const d=await r.json();
   if(d.success&&d.results.length>0){
    const match=d.results[0];
    setEdit(prev=>({...prev,kiot_employee_id:String(match.id)}));
    setKiotUsers(prev=>prev.find(u=>u.id===match.id)?prev:[...prev,match]);
   }
  }catch(e){}
 }
 async function save(){const{error}=await supabase.from('profiles').update({full_name:edit.full_name,phone:edit.phone,role:edit.role,branch_id:edit.branch_id||null,owner_name:edit.owner_name||edit.full_name,status:edit.status,active:edit.active,kiot_employee_id:edit.kiot_employee_id||null,extra_branch_ids:edit.role==='manager'?(edit.extra_branch_ids||[]):[]}).eq('id',edit.id);if(error)alert(error.message);setEdit(null);reload(true)}
 async function removeUser(u){if(!confirm('Xóa tài khoản '+(u.full_name||u.email)+' khỏi danh sách CRM? Lưu ý: nên khóa tài khoản thay vì xóa nếu user đã có data.'))return;const{error}=await supabase.from('profiles').delete().eq('id',u.id);if(error)alert(error.message);reload(true)}
 async function resetPass(u){if(!u.email)return alert('Tài khoản này chưa có email');if(!confirm('Gửi email đặt lại mật khẩu cho '+(u.full_name||u.email)+'?'))return;const{error}=await supabase.auth.resetPasswordForEmail(String(u.email).trim().toLowerCase(),{redirectTo:window.location.origin+'/reset-password'});if(error)alert(error.message);else alert('Đã gửi email đặt lại mật khẩu cho '+u.email)}
 async function transferData(){
  const from=transfer.from_id,to=transfer.to_id;
  if(!from||!to)return alert('Chọn sale nguồn và sale nhận dữ liệu.');
  if(from===to)return alert('Sale nguồn và sale nhận không được trùng nhau.');
  const fromUser=users.find(u=>u.id===from),toUser=users.find(u=>u.id===to);
  if(!confirm(`Chuyển toàn bộ data từ ${fromUser?.full_name||'sale cũ'} sang ${toUser?.full_name||'sale mới'}?\n\nBao gồm: Lead, lịch hẹn/follow-up, task điều hành, thẻ BOARD đang phụ trách.\nComment lịch sử vẫn giữ nguyên người đã viết.`))return;
  const steps=[
   supabase.from('leads').update({owner_id:to}).eq('owner_id',from),
   supabase.from('operation_tasks').update({owner_id:to}).eq('owner_id',from),
   supabase.from('operation_tasks').update({reviewer_id:to}).eq('reviewer_id',from),
   supabase.from('board_cards').update({owner_id:to,updated_at:new Date().toISOString()}).eq('owner_id',from)
  ];
  const results=await Promise.allSettled(steps);
  const err=results.find(r=>r.status==='fulfilled'&&r.value?.error);
  const rej=results.find(r=>r.status==='rejected');
  if(err)return alert(err.value.error.message);
  if(rej)return alert(rej.reason?.message||'Có lỗi khi chuyển dữ liệu.');
  alert('Đã chuyển data sale thành công. Anh có thể khóa tài khoản cũ nếu nhân sự nghỉ.');
  setTransfer({from_id:'',to_id:''});
  reload(true);
 }
 return <section className='panel'><h3>Tài khoản</h3><div className='transfer-box'><h4>Chuyển data sale</h4><p>Chuyển Lead, lịch hẹn, task và thẻ BOARD từ nhân sự cũ sang nhân sự mới. Không nên xóa tài khoản đã từng nhập data.</p><div className='transfer-row'><select value={transfer.from_id} onChange={e=>setTransfer({...transfer,from_id:e.target.value})}><option value=''>Chọn sale nguồn</option>{activeSales.map(u=><option key={u.id} value={u.id}>{u.full_name} · {u.email||''}</option>)}</select><span>→</span><select value={transfer.to_id} onChange={e=>setTransfer({...transfer,to_id:e.target.value})}><option value=''>Chọn sale nhận</option>{activeSales.map(u=><option key={u.id} value={u.id}>{u.full_name} · {u.email||''}</option>)}</select><button className='primary' onClick={transferData}>Chuyển data</button></div></div>{edit&&<div className='editor'><input value={edit.full_name||''} onChange={e=>setEdit({...edit,full_name:e.target.value})} onBlur={e=>autoMatchKiot(e.target.value)}/><select value={edit.role} onChange={e=>setEdit({...edit,role:e.target.value})}><option>pending</option><option>sale</option><option>pt</option><option>manager</option><option>admin</option></select><select value={edit.branch_id||''} onChange={e=>setEdit({...edit,branch_id:e.target.value})}><option value=''>Tất cả/Không gán</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><select value={edit.status} onChange={e=>setEdit({...edit,status:e.target.value})}><option>pending</option><option>approved</option><option>rejected</option></select><select value={edit.active?'1':'0'} onChange={e=>setEdit({...edit,active:e.target.value==='1'})}><option value='1'>active</option><option value='0'>locked</option></select>{edit.role==='manager'&&<label style={{display:'flex',flexDirection:'column',gap:'2px',fontSize:'12px'}}><span>Cơ sở phụ (giữ Ctrl/Cmd để chọn nhiều)</span><select multiple value={edit.extra_branch_ids||[]} onChange={e=>setEdit({...edit,extra_branch_ids:Array.from(e.target.selectedOptions).map(o=>o.value)})} style={{height:'80px'}}>{branches.filter(b=>b.id!==edit.branch_id).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><small style={{color:'#888'}}>Manager sẽ thấy và quản lý được tất cả cơ sở đã chọn.</small></label>}<label style={{display:'flex',flexDirection:'column',gap:'2px',fontSize:'12px'}}><span>Mã NV Kiot {kiotLoading&&<small>(đang tải...)</small>}</span><select value={edit.kiot_employee_id||''} onChange={e=>setEdit({...edit,kiot_employee_id:e.target.value})}><option value=''>-- Chưa gán / Tự tìm --</option>{kiotUsers.map(u=><option key={u.id} value={String(u.id)}>{u.name} (ID: {u.id})</option>)}</select><small style={{color:'#888'}}>Tự điền khi blur khỏi ô Tên. Hoặc chọn thủ công.</small></label><button className='primary' onClick={save}>Lưu</button></div>}<div className='table'><table><thead><tr><th>Tên</th><th>Email</th><th>Role</th><th>Cơ sở</th><th>Mã Kiot</th><th>Duyệt</th><th>Active</th><th></th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.full_name}</td><td>{u.email}</td><td>{u.role}</td><td>{bname(branches,u.branch_id)}</td><td><small>{u.kiot_employee_id||'—'}</small></td><td>{u.status}</td><td>{u.active?'active':'locked'}</td><td><button onClick={()=>openEdit(u)}>Sửa/Duyệt</button><button onClick={()=>resetPass(u)}>Reset pass</button><button className='danger' onClick={()=>removeUser(u)}>Xóa</button></td></tr>)}</tbody></table></div></section>}
function LeadModal({initial,branches,users,profile,onClose,onSave}){const isSale=profile.role==='sale';const[f,setF]=useState({name:'',phone:'',source:'MKT',branch_id:isSale?profile.branch_id:(branches[0]?.id||''),owner_id:isSale?profile.id:(users[0]?.id||profile.id),status:'Lead mới',package_interest:'Membership',value:0,follow_date:'',note:'',...initial});const set=(k,v)=>setF({...f,[k]:v});return <div className='modal'><form className='modal-card' onSubmit={e=>{e.preventDefault();onSave(f)}}><div className='modal-head'><h3>{f.id?'Sửa lead':'Thêm lead'}</h3><button type='button' onClick={onClose}>×</button></div><label>Tên khách<input value={f.name} onChange={e=>set('name',e.target.value)} required/></label><label>SĐT<input value={f.phone||''} onChange={e=>set('phone',e.target.value)}/></label><label>Nguồn<select value={f.source} onChange={e=>set('source',e.target.value)}>{SOURCES.map(x=><option key={x}>{x}</option>)}</select></label><label>Cơ sở<select disabled={isSale} value={f.branch_id||''} onChange={e=>set('branch_id',e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Sale<select disabled={isSale} value={f.owner_id||''} onChange={e=>set('owner_id',e.target.value)}>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label><label>Trạng thái<select value={f.status} onChange={e=>set('status',e.target.value)}>{STATUSES.map(x=><option key={x}>{x}</option>)}</select></label><label>Gói<input value={f.package_interest||''} onChange={e=>set('package_interest',e.target.value)}/></label><label>Giá trị<input type='number' value={f.value||0} onChange={e=>set('value',e.target.value)}/></label><label>Follow-up<input type='date' value={f.follow_date||''} onChange={e=>set('follow_date',e.target.value)}/></label><label>Ghi chú<textarea value={f.note||''} onChange={e=>set('note',e.target.value)}/></label><button className='primary full'>Lưu</button></form></div>}

function Operations({tasks,branches,users,leads,profile,edit,del,move}){const mine=tasks.filter(t=>t.owner_id===profile.id),late=tasks.filter(t=>t.due_date&&t.due_date<today()&&t.status!=='Hoàn thành');return <><div className='cards'><Card t='Tổng việc' v={tasks.length} s='Module điều hành'/><Card t='Việc của tôi' v={mine.length} s='Đang được giao'/><Card t='Quá hạn' v={late.length} s='Cần xử lý'/><Card t='Hoàn thành' v={tasks.filter(t=>t.status==='Hoàn thành').length} s='Đã đóng'/></div><div className='kanban ops'>{TASK_STATUSES.map(s=><div className='stage' key={s}><h3>{s}</h3>{tasks.filter(t=>t.status===s).map(t=><div className={'deal taskcard p-'+String(t.priority||'').replaceAll(' ','-')} key={t.id}><div className='taskTop'><b>{t.title}</b><span className='badge'>{t.priority}</span></div><span>{bname(branches,t.branch_id)} · {uname(users,t.owner_id)}</span>{t.due_date&&<span className={t.due_date<today()&&t.status!=='Hoàn thành'?'late':''}>Deadline: {t.due_date}</span>}{t.lead_id&&<span>Lead: {leads.find(l=>l.id===t.lead_id)?.name||'Đã gắn lead'}</span>}<div className='progress'><i style={{width:((t.checklist||[]).filter(x=>x.done).length/Math.max((t.checklist||[]).length,1)*100)+'%'}}></i></div><select value={t.status} onChange={e=>move(t.id,e.target.value)}>{TASK_STATUSES.map(x=><option key={x}>{x}</option>)}</select><div className='actions'><button onClick={()=>edit(t)}>Chi tiết</button>{(profile.role==='admin'||profile.role==='manager')&&<button className='danger' onClick={()=>del(t.id)}>Xóa</button>}</div></div>)}</div>)}</div><Panel title='Gợi ý tích hợp CRM' text='Có thể gắn task trực tiếp với Lead/Học viên để tự nhắc sale chăm sóc, CSKH gia hạn, Marketing chạy campaign và CEO xem KPI.'/></>}
function TaskModal({initial,branches,users,leads,profile,onClose,onSave}){const isSale=profile.role==='sale';const[f,setF]=useState(()=>({...{title:'',description:'',status:'Việc mới',priority:'Vừa',branch_id:isSale?profile.branch_id:(branches[0]?.id||''),owner_id:profile.id,reviewer_id:'',due_date:'',checklist:[],checklist_text:'',result_note:'',lead_id:''},...initial,checklist_text:initial.checklist_text??(initial.checklist||[]).map(x=>x.text).join('\n')}));const set=(k,v)=>setF({...f,[k]:v});function toggle(i){const ck=[...(f.checklist||[])];ck[i]={...ck[i],done:!ck[i]?.done};setF({...f,checklist:ck})}return <div className='modal'><form className='modal-card' onSubmit={e=>{e.preventDefault();onSave(f)}}><div className='modal-head'><h3>{f.id?'Chi tiết công việc':'Tạo công việc'}</h3><button type='button' onClick={onClose}>×</button></div><label>Tiêu đề<input value={f.title} onChange={e=>set('title',e.target.value)} required/></label><label>Mô tả<textarea value={f.description||''} onChange={e=>set('description',e.target.value)}/></label><div className='modal-grid'><label>Trạng thái<select value={f.status} onChange={e=>set('status',e.target.value)}>{TASK_STATUSES.map(x=><option key={x}>{x}</option>)}</select></label><label>Ưu tiên<select value={f.priority} onChange={e=>set('priority',e.target.value)}>{PRIORITIES.map(x=><option key={x}>{x}</option>)}</select></label><label>Cơ sở<select disabled={isSale} value={f.branch_id||''} onChange={e=>set('branch_id',e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Người phụ trách<select value={f.owner_id||''} onChange={e=>set('owner_id',e.target.value)}>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label><label>Người duyệt<select value={f.reviewer_id||''} onChange={e=>set('reviewer_id',e.target.value)}><option value=''>Chưa chọn</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label><label>Deadline<input type='date' value={f.due_date||''} onChange={e=>set('due_date',e.target.value)}/></label></div><label>Gắn với Lead<select value={f.lead_id||''} onChange={e=>set('lead_id',e.target.value)}><option value=''>Không gắn lead</option>{leads.slice(0,300).map(l=><option key={l.id} value={l.id}>{l.name} · {l.phone||''}</option>)}</select></label><label>Checklist - mỗi dòng là 1 đầu việc<textarea value={f.checklist_text||''} onChange={e=>set('checklist_text',e.target.value)} placeholder={'Gọi xác nhận\nGửi báo giá\nCập nhật kết quả'}/></label>{(f.checklist||[]).length>0&&<div className='checklist'>{(f.checklist||[]).map((c,i)=><label key={i} className='check'><input type='checkbox' checked={!!c.done} onChange={()=>toggle(i)}/>{c.text}</label>)}</div>}<label>Kết quả / ghi chú nghiệm thu<textarea value={f.result_note||''} onChange={e=>set('result_note',e.target.value)}/></label><button className='primary full'>Lưu công việc</button></form></div>}


function BoardPage({boards,lists,cards,checks,comments,users,profile,selectedBoard,setSelectedBoard,setBoardModal,setCardModal,addList,renameList,delList,delBoard,moveCard,dragCard}){const[listName,setListName]=useState('');const board=boards.find(b=>b.id===selectedBoard)||boards[0];const isPT=profile.role==='pt';useEffect(()=>{if(!selectedBoard&&boards[0])setSelectedBoard(boards[0].id)},[boards.length]);if(!boards.length)return <section className='board-empty'><h2>BOARD AKC</h2><p>Tạo board nội bộ giống Trello để quản lý nhân sự, phòng ban, checklist ngày/tuần/tháng và hội thoại trong từng thẻ.</p>{!isPT&&<button className='primary' onClick={()=>setBoardModal({})}>+ Tạo board đầu tiên</button>}</section>;const bl=lists.filter(l=>l.board_id===board.id);return <section className='akc-board' style={{background:board.background||DEFAULT_BOARD_BG}}><div className='board-bar'><div><select value={board.id} onChange={e=>setSelectedBoard(e.target.value)}>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>{!isPT&&<><button onClick={()=>setBoardModal(board)}>Sửa board</button><button className='danger' onClick={()=>delBoard(board.id)}>Xóa</button></>}</div>{!isPT&&<form onSubmit={e=>{e.preventDefault();addList(board.id,listName);setListName('')}}><input value={listName} onChange={e=>setListName(e.target.value)} placeholder='+ Thêm danh sách khác'/><button>Thêm</button></form>}</div><div className='board-canvas'>{bl.map(l=>{const cs=cards.filter(c=>c.list_id===l.id);return <div className='board-list' key={l.id} onDragOver={e=>e.preventDefault()} onDrop={()=>dragCard.current&&moveCard(dragCard.current,l.id)}><div className='list-head'><b>{l.name}</b><span><button onClick={()=>renameList(l)}>•••</button><button onClick={()=>delList(l.id)}>×</button></span></div>{cs.map(c=>{const cks=checks.filter(x=>x.card_id===c.id),done=cks.filter(x=>x.done).length;return <div className='board-card' key={c.id} draggable onDragStart={()=>dragCard.current=c.id} onClick={()=>setCardModal(c)}>{c.cover_image&&<img src={c.cover_image} alt='cover'/>}<b>{c.title}</b>{c.description&&<p>{c.description.slice(0,90)}{c.description.length>90?'...':''}</p>}<div className='card-meta'>{c.label&&<span className='badge'>{c.label}</span>}{c.due_date&&<span>🕒 {c.due_date}</span>}{cks.length>0&&<span>☑ {done}/{cks.length}</span>}{comments.filter(m=>m.card_id===c.id).length>0&&<span>💬 {comments.filter(m=>m.card_id===c.id).length}</span>}</div></div>})}<button className='add-card' onClick={()=>setCardModal({board_id:board.id,list_id:l.id})}>+ Thêm thẻ</button></div>})}</div></section>}
function BoardModal({initial,branches,profile,onClose,onSave}){const isStaff=['sale','pt'].includes(profile.role);const[f,setF]=useState({name:'',branch_id:isStaff?profile.branch_id:(branches[0]?.id||''),background:DEFAULT_BOARD_BG,...initial});return <div className='modal dark-modal'><form className='modal-card' onSubmit={e=>{e.preventDefault();onSave(f)}}><div className='modal-head'><h3>{f.id?'Sửa board':'Tạo board'}</h3><button type='button' onClick={onClose}>×</button></div><label>Tên board<input value={f.name||''} onChange={e=>setF({...f,name:e.target.value})} required/></label><label>Cơ sở áp dụng<select disabled={isStaff} value={f.branch_id||''} onChange={e=>setF({...f,branch_id:e.target.value})}><option value=''>Toàn hệ thống / Admin</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Background<input value={f.background||''} onChange={e=>setF({...f,background:e.target.value})} placeholder='linear-gradient(...) hoặc link ảnh'/></label><button className='primary full'>Lưu board</button></form></div>}
function BoardCardModal({initial,lists,users,checks,comments,profile,onClose,onSave,onDelete,toggleCheck,updateCheckText,deleteCheck,addComment,updateComment,deleteComment}){
 const[comment,setComment]=useState('');
 const[editingComment,setEditingComment]=useState(null);
 const[commentText,setCommentText]=useState('');
 const[openCheckMenu,setOpenCheckMenu]=useState(null);
 const[editingCheck,setEditingCheck]=useState(null);
 const[checkText,setCheckText]=useState('');
 const fileRef=useRef(null);
 const khFileRef=useRef(null);
 const[f,setF]=useState(()=>({...{title:'',description:'',cover_image:'',label:'',owner_id:profile.id,due_date:'',list_id:lists[0]?.id||'',checklist_text:''},...initial,checklist_text:''}));
 const set=(k,v)=>setF({...f,[k]:v});
 useEffect(()=>{const onKey=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[]);
 function submitComment(){if(!f.id)return alert('Anh lưu thẻ trước rồi mới bình luận được.');if(!comment.trim())return;addComment(f.id,comment);setComment('')}
 function parseChecklistInput(v){return String(v||'').split(/[\n.;]+/).map(x=>x.trim()).filter(Boolean)}
 async function pickAvatar(e){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>set('cover_image',reader.result);reader.readAsDataURL(file)}
 function uploadCustomerImages(e){if(!f.id)return alert('Lưu thẻ trước rồi mới up ảnh KH');const files=[...(e.target.files||[])];files.forEach(file=>{const reader=new FileReader();reader.onload=()=>addComment(f.id,'IMAGE::'+reader.result);reader.readAsDataURL(file)});e.target.value=''}
 const done=checks.filter(c=>c.done).length,total=checks.length,percent=total?Math.round(done/total*100):0;
 return <div className='modal board-modal light-card-modal' onMouseDown={onClose}>
  <form className='modal-card board-card-detail trello-detail-60-40' onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();onSave(f)}}>
   <div className='detail-avatar-wrap'>
    <input ref={fileRef} type='file' accept='image/*' style={{display:'none'}} onChange={pickAvatar}/>
    <button type='button' className='detail-avatar' onClick={()=>fileRef.current?.click()} title='Bấm để thêm ảnh đại diện'>
     {f.cover_image?<img src={f.cover_image} alt='avatar'/>:<span>+</span>}
    </button>
    <small>Bấm vào ảnh để thay avatar</small>
   </div>
   <div className='detail-left'>
    <h3>Chi tiết thẻ</h3>
    <label>Tiêu đề<input value={f.title||''} onChange={e=>set('title',e.target.value)} required/></label>
    <div className='modal-grid compact-grid'><label>Danh sách<select value={f.list_id||''} onChange={e=>set('list_id',e.target.value)}>{lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>Người phụ trách<select value={f.owner_id||''} onChange={e=>set('owner_id',e.target.value)}><option value=''>Chưa gán</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label><label>Ngày<input type='date' value={f.due_date||''} onChange={e=>set('due_date',e.target.value)}/></label><label>Nhãn<input value={f.label||''} onChange={e=>set('label',e.target.value)} placeholder='CEO / Checklist ngày...'/></label></div>
    <label>Mô tả công việc<textarea value={f.description||''} onChange={e=>set('description',e.target.value)} rows={8}/></label>
    <div className='check-add-box'><label>Thêm checklist nhanh</label><textarea value={f.checklist_text||''} onChange={e=>set('checklist_text',e.target.value)} rows={3} placeholder={'Dán nhiều mục vào đây. Mỗi mục kết thúc bằng dấu chấm hoặc xuống dòng.'} onKeyDown={e=>{if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();onSave(f)}}}/><small>Hệ thống tự tách theo dấu chấm, dấu chấm phẩy hoặc xuống dòng.</small>{f.checklist_text&&<div className='check-preview'>{parseChecklistInput(f.checklist_text).slice(0,8).map((x,i)=><span key={i}>+ {x}</span>)}</div>}</div>
    {total>0&&<div className='checklist trello-checks compact-checks'><div className='check-title'><h4>Checklist hiện tại</h4><span>{done}/{total} · {percent}%</span></div><div className='mini-progress'><i style={{width:percent+'%'}}></i></div>{checks.map(c=><div key={c.id} className='check-line'><input type='checkbox' checked={!!c.done} onChange={()=>toggleCheck(c.id,c.done)}/>{editingCheck===c.id?<input className='inline-check-input' autoFocus value={checkText} onChange={e=>setCheckText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){updateCheckText(c.id,checkText);setEditingCheck(null)}}}/>:<button type='button' className={c.done?'check-text done':'check-text'} onClick={()=>{setEditingCheck(c.id);setCheckText(c.text)}}>{c.text}</button>}<div className='more-wrap'><button type='button' className='more-btn' onClick={()=>setOpenCheckMenu(openCheckMenu===c.id?null:c.id)}>⋯</button>{openCheckMenu===c.id&&<div className='more-menu'><button type='button' onClick={()=>{setEditingCheck(c.id);setCheckText(c.text);setOpenCheckMenu(null)}}>Sửa</button><button type='button' onClick={()=>{updateCheckText(c.id,checkText||c.text);setEditingCheck(null);setOpenCheckMenu(null)}}>Lưu</button><button type='button' className='danger-link' onClick={()=>{deleteCheck(c.id);setOpenCheckMenu(null)}}>Xóa</button></div>}</div></div>)}</div>}
    <div className='modal-actions'><button className='primary'>Lưu thẻ</button>{f.id&&<button type='button' className='danger' onClick={()=>onDelete(f.id)}>Xóa thẻ</button>}</div>
   </div>
   <div className='comments detail-right'><h4>Hội thoại / Ảnh KH</h4><input ref={khFileRef} type='file' accept='image/*' multiple style={{display:'none'}} onChange={uploadCustomerImages}/><button type='button' className='upload-kh' onClick={()=>khFileRef.current?.click()}>+ Up ảnh thay đổi KH</button><div className='comment-list'>{comments.map(c=>{const u=users.find(x=>x.id===c.user_id),mine=c.user_id===profile.id||profile.role==='admin';return <div className='comment' key={c.id}><div className='comment-avatar'>{(u?.full_name||'?').slice(0,1)}</div><div className='comment-body'><div className='comment-head'><b>{uname(users,c.user_id)}</b><small>{String(c.created_at||'').slice(0,16).replace('T',' ')}</small>{mine&&<span><button type='button' onClick={()=>{setEditingComment(c.id);setCommentText(c.message)}}>Sửa</button><button type='button' onClick={()=>deleteComment(c.id)}>Xóa</button></span>}</div>{editingComment===c.id?<div className='comment-edit'><input value={commentText} onChange={e=>setCommentText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){updateComment(c.id,commentText);setEditingComment(null)}}}/><button type='button' onClick={()=>{updateComment(c.id,commentText);setEditingComment(null)}}>Lưu</button></div>:(String(c.message||'').startsWith('IMAGE::')?<img className='comment-photo' src={c.message.slice(7)} alt='Ảnh KH'/>:<p>{c.message}</p>)}</div></div>})}</div>{f.id?<div className='comment-compose'><input value={comment} onChange={e=>setComment(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();submitComment()}}} placeholder='Viết bình luận...'/><button type='button' onClick={submitComment}>Gửi</button></div>:<small>Lưu thẻ trước để bật hội thoại.</small>}</div>
  </form>
 </div>}

createRoot(document.getElementById('root')).render(<App/>);
