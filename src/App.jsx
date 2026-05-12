import React,{useEffect,useMemo,useRef,useState}from'react';
import{createRoot}from'react-dom/client';
import{supabase,isSupabaseConfigured}from'./supabaseClient';
import*as XLSX from'xlsx';
import'./style.css';

const STATUSES=['Lead mới','Đã gọi','Đặt lịch','T1','Đã mua gói','Mất lead'];
const SOURCES=['MKT','FB Tổng','Page cơ sở','Vãng lai','Tự kiếm','Khách cũ','Khách giới thiệu','Hotline tổng','Website'];
const money=n=>Number(n||0).toLocaleString('vi-VN')+'đ';
const today=()=>new Date().toISOString().slice(0,10);
function bname(bs,id){return bs.find(b=>b.id===id)?.name||'Chưa gán cơ sở'}
function uname(us,id){return us.find(u=>u.id===id)?.full_name||'Chưa gán sale'}

function App(){
 const[session,setSession]=useState(null),[profile,setProfile]=useState(null),[branches,setBranches]=useState([]),[users,setUsers]=useState([]),[leads,setLeads]=useState([]),[page,setPage]=useState('Tổng quan'),[modal,setModal]=useState(null),[loading,setLoading]=useState(true);
 const[filter,setFilter]=useState({branch_id:'',source:'',owner_id:'',date:''});
 const fileInputRef=useRef(null);

 if(!isSupabaseConfigured)return <Setup/>;

 useEffect(()=>{supabase.auth.getSession().then(({data})=>setSession(data.session));const{data:s}=supabase.auth.onAuthStateChange((_e,ss)=>setSession(ss));return()=>s.subscription.unsubscribe()},[]);

 async function load(){setLoading(true);const{data:bs}=await supabase.from('branches').select('*').order('name');setBranches(bs||[]);if(session?.user){const{data:p}=await supabase.from('profiles').select('*').eq('id',session.user.id).single();setProfile(p||null);const{data:us}=await supabase.from('profiles').select('*').order('created_at',{ascending:false});setUsers(us||[]);const{data:ls}=await supabase.from('leads').select('*').order('created_at',{ascending:false});setLeads(ls||[])}setLoading(false)}
 useEffect(()=>{load()},[session?.user?.id]);
 useEffect(()=>{if(!session?.user)return;const c=supabase.channel('akc-v8').on('postgres_changes',{event:'*',schema:'public',table:'leads'},load).on('postgres_changes',{event:'*',schema:'public',table:'profiles'},load).on('postgres_changes',{event:'*',schema:'public',table:'branches'},load).subscribe();return()=>supabase.removeChannel(c)},[session?.user?.id]);

 if(!session)return <Auth branches={branches}/>;
 if(loading)return <Splash text='Đang tải CRM...'/>;
 if(!profile||profile.status!=='approved'||!profile.active)return <Pending profile={profile}/>;

 const isAdmin=profile.role==='admin',isManager=profile.role==='manager',isSale=profile.role==='sale';
 const avBranches=isAdmin?branches:branches.filter(b=>b.id===profile.branch_id);
 const avUsers=isAdmin?users.filter(u=>u.active&&u.status==='approved'&&u.role!=='pending'):users.filter(u=>u.active&&u.status==='approved'&&u.branch_id===profile.branch_id&&(isManager||u.id===profile.id));
 const rows=leads.filter(l=>(!filter.branch_id||l.branch_id===filter.branch_id)&&(!filter.source||l.source===filter.source)&&(!filter.owner_id||l.owner_id===filter.owner_id)&&(!filter.date||String(l.created_at).slice(0,10)===filter.date));
 const pending=users.filter(u=>u.status==='pending').length;
 const nav=['Tổng quan','Lead','Pipeline','Lịch hẹn',...(isAdmin||isManager?['Báo cáo']:[]),...(isAdmin?['Cơ sở',`Tài khoản${pending?' ('+pending+')':''}`]:[]),'Zalo/Facebook'];

 async function saveLead(f){
  const row={name:f.name,phone:f.phone,source:f.source,branch_id:isSale?profile.branch_id:f.branch_id,owner_id:isSale?profile.id:f.owner_id,status:f.status,package_interest:f.package_interest,value:Number(f.value||0),follow_date:f.follow_date||null,note:f.note};
  const q=f.id?supabase.from('leads').update(row).eq('id',f.id):supabase.from('leads').insert(row);
  const{error}=await q;if(error)alert(error.message);setModal(null);load()
 }

 async function delLead(id){if(!isAdmin)return alert('Chỉ admin được xóa lead');if(confirm('Xóa lead này?')){const{error}=await supabase.from('leads').delete().eq('id',id);if(error)alert(error.message);load()}}
 async function status(id,s){const{error}=await supabase.from('leads').update({status:s}).eq('id',id);if(error)alert(error.message);load()}
 async function addDemo(){const b=avBranches[0],u=avUsers[0]||profile;const{error}=await supabase.from('leads').insert({name:'Lead AKC Demo',phone:'09'+Math.floor(10000000+Math.random()*89999999),source:'MKT',branch_id:b?.id||profile.branch_id,owner_id:u?.id||profile.id,status:'Lead mới',package_interest:'Membership',value:3500000,follow_date:today(),note:'Lead demo cloud'});if(error)alert(error.message);load()}

 function exportExcel(){
  const data=rows.map(l=>({
   'Tên khách':l.name||'',
   'Số điện thoại':l.phone||'',
   'Nguồn':l.source||'',
   'Cơ sở':bname(branches,l.branch_id),
   'Sale phụ trách':uname(users,l.owner_id),
   'Trạng thái':l.status||'',
   'Gói quan tâm':l.package_interest||'',
   'Giá trị':Number(l.value||0),
   'Ngày hẹn / Follow-up':l.follow_date||'',
   'Ghi chú':l.note||'',
   'Ngày tạo':l.created_at?String(l.created_at).slice(0,10):''
  }));
  const ws=XLSX.utils.json_to_sheet(data);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'AKC Leads');
  XLSX.writeFile(wb,`AKC_CRM_Leads_${today()}.xlsx`);
 }

 async function importExcel(e){
  const file=e.target.files?.[0];
  if(!file)return;
  try{
   const buffer=await file.arrayBuffer();
   const workbook=XLSX.read(buffer);
   const sheet=workbook.Sheets[workbook.SheetNames[0]];
   const excelRows=XLSX.utils.sheet_to_json(sheet);
   if(!excelRows.length)return alert('File Excel không có dữ liệu.');

   const defaultBranch=avBranches[0]?.id||profile.branch_id;
   const defaultOwner=avUsers[0]?.id||profile.id;

   const data=excelRows.map(r=>{
    const branchText=r['Cơ sở']||r['Co so']||r['Branch']||'';
    const ownerText=r['Sale']||r['Sale phụ trách']||r['Nhan su']||r['Owner']||'';

    const branch=branches.find(b=>b.name.toLowerCase().trim()===String(branchText).toLowerCase().trim());
    const owner=users.find(u=>String(u.full_name||u.owner_name||'').toLowerCase().trim()===String(ownerText).toLowerCase().trim());

    const rawValue=String(r['Giá trị']||r['Gia tri']||r['Value']||0).replace(/[^\d]/g,'');

    return{
     name:r['Tên khách']||r['Ten khach']||r['Tên']||r['Name']||'Chưa có tên',
     phone:String(r['Số điện thoại']||r['SDT']||r['SĐT']||r['Phone']||''),
     source:r['Nguồn']||r['Nguon']||r['Source']||'MKT',
     branch_id:isSale?profile.branch_id:(branch?.id||defaultBranch),
     owner_id:isSale?profile.id:(owner?.id||defaultOwner),
     status:r['Trạng thái']||r['Trang thai']||r['Status']||'Lead mới',
     package_interest:r['Gói quan tâm']||r['Goi quan tam']||r['Package']||'Membership',
     value:Number(rawValue||0),
     follow_date:r['Ngày hẹn']||r['Follow-up']||r['Follow up']||null,
     note:r['Ghi chú']||r['Ghi chu']||r['Note']||''
    }
   });

   const{error}=await supabase.from('leads').insert(data);
   if(error)return alert(error.message);
   alert(`Import thành công ${data.length} lead.`);
   e.target.value='';
   load();
  }catch(err){
   alert('Import lỗi: '+err.message);
  }
 }

 const base=page.startsWith('Tài khoản')?'Tài khoản':page;

 return <div className='app'><aside><div className='brand'><div className='logo'>AKC</div><div><h1>AKC CRM</h1><p>Cloud v8</p></div></div><nav>{nav.map(n=><button key={n} className={base===n.split(' (')[0]?'active':''} onClick={()=>setPage(n.split(' (')[0])}>{n}</button>)}</nav><div className='me'><b>{profile.full_name}</b><span>{profile.role} {profile.branch_id?'· '+bname(branches,profile.branch_id):''}</span><button onClick={()=>supabase.auth.signOut()}>Đăng xuất</button></div></aside><main><header><div><h2>{base}</h2><p>{isAdmin?'Admin toàn hệ thống':isManager?'Manager cơ sở':'Sale cá nhân'} · Supabase realtime</p></div><div><input ref={fileInputRef} type='file' accept='.xlsx,.xls,.csv' style={{display:'none'}} onChange={importExcel}/><button onClick={()=>fileInputRef.current?.click()}>Import Excel</button><button onClick={exportExcel}>Xuất Excel</button><button onClick={addDemo}>+ Demo</button><button className='primary' onClick={()=>setModal({})}>+ Thêm lead</button></div></header><Filters filter={filter} setFilter={setFilter} branches={avBranches} users={avUsers}/>{base==='Tổng quan'&&<Dashboard leads={rows} branches={avBranches} users={avUsers}/>} {base==='Lead'&&<Lead leads={rows} branches={branches} users={users} edit={setModal} del={delLead} isAdmin={isAdmin}/>} {base==='Pipeline'&&<Pipeline leads={rows} branches={branches} users={users} setStatus={status}/>} {base==='Lịch hẹn'&&<Calendar leads={rows} branches={branches} users={users}/>} {base==='Báo cáo'&&<Dashboard leads={rows} branches={avBranches} users={avUsers}/>} {base==='Cơ sở'&&isAdmin&&<Branches branches={branches} reload={load}/>} {base==='Tài khoản'&&isAdmin&&<Users users={users} branches={branches} reload={load}/>} {base==='Zalo/Facebook'&&<Panel title='Zalo/Facebook' text='Sẵn sàng nối Zalo OA, Facebook Lead Form, Hotline ở bản tiếp theo.'/>}</main>{modal&&<LeadModal initial={modal} branches={avBranches} users={avUsers} profile={profile} onClose={()=>setModal(null)} onSave={saveLead}/>}</div>
}

function Setup(){return <Splash text='Chưa cấu hình Supabase. Thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trong Vercel.'/>}
function Splash({text}){return <div className='login'><div className='card'><div className='logo big'>AKC</div><h1>AKC CRM v8</h1><p>{text}</p></div></div>}
function Pending({profile}){return <div className='login'><div className='card'><div className='logo big'>AKC</div><h1>Đang chờ duyệt</h1><p>{profile?.email||''} chưa được Admin duyệt hoặc đang bị khóa.</p><button className='primary full' onClick={()=>supabase.auth.signOut()}>Đăng xuất</button></div></div>}
function Auth({branches}){const[mode,setMode]=useState('login'),[err,setErr]=useState(''),[login,setLogin]=useState({email:'',password:''}),[reg,setReg]=useState({name:'',phone:'',email:'',password:'',branch_id:''});useEffect(()=>{if(branches[0]&&!reg.branch_id)setReg(r=>({...r,branch_id:branches[0].id}))},[branches]);async function inx(e){e.preventDefault();setErr('');const{error}=await supabase.auth.signInWithPassword({email:login.email.trim().toLowerCase(),password:login.password});if(error)setErr(error.message)}async function up(e){e.preventDefault();setErr('');const{error}=await supabase.auth.signUp({email:reg.email.trim().toLowerCase(),password:reg.password,options:{data:{full_name:reg.name,phone:reg.phone,branch_id:reg.branch_id}}});if(error)return setErr(error.message);setMode('login');setLogin({email:reg.email,password:reg.password});setErr('Đăng ký thành công. Tài khoản đang chờ Admin duyệt.')}return <div className='login'><div className='card'><div className='logo big'>AKC</div><h1>{mode==='login'?'Đăng nhập AKC CRM':'Đăng ký tài khoản'}</h1><p>{mode==='login'?'Tài khoản phải được Admin duyệt mới đăng nhập được.':'Sau khi đăng ký, Admin sẽ phân quyền và kích hoạt tài khoản.'}</p>{mode==='login'?<form onSubmit={inx}><label>Email<input value={login.email} onChange={e=>setLogin({...login,email:e.target.value})} required/></label><label>Mật khẩu<input type='password' value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} required/></label>{err&&<div className={err.includes('thành công')?'success':'error'}>{err}</div>}<button className='primary full'>Đăng nhập</button><button type='button' className='ghost full' onClick={()=>{setMode('register');setErr('')}}>Đăng ký tài khoản mới</button></form>:<form onSubmit={up}><label>Họ tên<input value={reg.name} onChange={e=>setReg({...reg,name:e.target.value})} required/></label><label>SĐT<input value={reg.phone} onChange={e=>setReg({...reg,phone:e.target.value})}/></label><label>Email<input type='email' value={reg.email} onChange={e=>setReg({...reg,email:e.target.value})} required/></label><label>Mật khẩu<input type='password' value={reg.password} onChange={e=>setReg({...reg,password:e.target.value})} required/></label><label>Cơ sở<select value={reg.branch_id} onChange={e=>setReg({...reg,branch_id:e.target.value})}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{err&&<div className='error'>{err}</div>}<button className='primary full'>Gửi đăng ký</button><button type='button' className='ghost full' onClick={()=>{setMode('login');setErr('')}}>Quay lại đăng nhập</button></form>}</div></div>}
function Filters({filter,setFilter,branches,users}){const set=(k,v)=>setFilter({...filter,[k]:v});return <section className='filters'><select value={filter.branch_id} onChange={e=>set('branch_id',e.target.value)}><option value=''>Tất cả cơ sở</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><select value={filter.source} onChange={e=>set('source',e.target.value)}><option value=''>Tất cả nguồn</option>{SOURCES.map(s=><option key={s}>{s}</option>)}</select><select value={filter.owner_id} onChange={e=>set('owner_id',e.target.value)}><option value=''>Tất cả sale</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><input type='date' value={filter.date} onChange={e=>set('date',e.target.value)}/><button onClick={()=>setFilter({branch_id:'',source:'',owner_id:'',date:''})}>Xóa lọc</button></section>}
function Dashboard({leads,branches,users}){const won=leads.filter(l=>l.status==='Đã mua gói'),rev=won.reduce((s,l)=>s+Number(l.value||0),0);return <><div className='cards'><Card t='Tổng Lead' v={leads.length} s='Realtime cloud'/><Card t='Đặt lịch' v={leads.filter(l=>l.status==='Đặt lịch').length} s='Khách hẹn CLB'/><Card t='Đã mua gói' v={won.length} s='Deal chốt'/><Card t='Doanh thu' v={money(rev)} s='Cloud data'/></div><div className='grid'>{['Lead mới','Đã gọi','Đặt lịch','T1','Đã mua gói','Mất lead'].map(st=><div className='panel' key={st}><h3>{st}</h3><b className='bigNum'>{leads.filter(l=>l.status===st).length}</b></div>)}</div><Panel title='Phân tích nhanh' text={`Cơ sở: ${branches.length} · Sale: ${users.length} · Dữ liệu đã chuyển sang Supabase Cloud.`}/></>}
function Card({t,v,s}){return <div className='card'><span>{t}</span><strong>{v}</strong><small>{s}</small></div>}
function Panel({title,text}){return <section className='panel'><h3>{title}</h3><p>{text}</p></section>}
function Lead({leads,branches,users,edit,del,isAdmin}){return <section className='panel'><h3>Danh sách Lead</h3><div className='table'><table><thead><tr><th>Khách</th><th>SĐT</th><th>Nguồn</th><th>Cơ sở</th><th>Sale</th><th>Trạng thái</th><th>Giá trị</th><th>Thao tác</th></tr></thead><tbody>{leads.map(l=><tr key={l.id}><td><b>{l.name}</b><br/><small>{l.note}</small></td><td>{l.phone}</td><td>{l.source}</td><td>{bname(branches,l.branch_id)}</td><td>{uname(users,l.owner_id)}</td><td><span className='badge'>{l.status}</span></td><td>{money(l.value)}</td><td><button onClick={()=>edit(l)}>Sửa</button>{isAdmin&&<button className='danger' onClick={()=>del(l.id)}>Xóa</button>}</td></tr>)}</tbody></table></div></section>}
function Pipeline({leads,branches,users,setStatus}){return <div className='kanban'>{STATUSES.map(s=><div className='stage' key={s}><h3>{s}</h3>{leads.filter(l=>l.status===s).map(l=><div className='deal' key={l.id}><b>{l.name}</b><span>{bname(branches,l.branch_id)}</span><span>{uname(users,l.owner_id)} · {money(l.value)}</span><select value={l.status} onChange={e=>setStatus(l.id,e.target.value)}>{STATUSES.map(x=><option key={x}>{x}</option>)}</select></div>)}</div>)}</div>}
function Calendar({leads,branches,users}){return <section className='panel'><h3>Lịch hẹn</h3>{leads.filter(l=>l.follow_date).map(l=><div className='task' key={l.id}><div><b>{l.name}</b><p>{l.note}</p></div><div>{l.follow_date}<br/>{uname(users,l.owner_id)}</div></div>)}</section>}
function Branches({branches,reload}){const[name,setName]=useState('');async function add(){if(!name.trim())return;const{error}=await supabase.from('branches').insert({name:name.trim()});if(error)alert(error.message);setName('');reload()}async function rename(b){const n=prompt('Tên mới',b.name);if(n){await supabase.from('branches').update({name:n}).eq('id',b.id);reload()}}async function remove(b){if(confirm('Xóa cơ sở?')){const{error}=await supabase.from('branches').delete().eq('id',b.id);if(error)alert(error.message);reload()}}return <section className='panel'><h3>Quản lý cơ sở</h3><div className='add'><input value={name} onChange={e=>setName(e.target.value)} placeholder='Tên cơ sở'/><button className='primary' onClick={add}>+ Thêm</button></div>{branches.map(b=><div className='row' key={b.id}><b>{b.name}</b><span><button onClick={()=>rename(b)}>Sửa</button><button className='danger' onClick={()=>remove(b)}>Xóa</button></span></div>)}</section>}
function Users({users,branches,reload}){const[edit,setEdit]=useState(null);async function save(){const{error}=await supabase.from('profiles').update({full_name:edit.full_name,phone:edit.phone,role:edit.role,branch_id:edit.branch_id||null,owner_name:edit.owner_name||edit.full_name,status:edit.status,active:edit.active}).eq('id',edit.id);if(error)alert(error.message);setEdit(null);reload()}return <section className='panel'><h3>Tài khoản</h3>{edit&&<div className='editor'><input value={edit.full_name||''} onChange={e=>setEdit({...edit,full_name:e.target.value})}/><select value={edit.role} onChange={e=>setEdit({...edit,role:e.target.value})}><option>pending</option><option>sale</option><option>manager</option><option>admin</option></select><select value={edit.branch_id||''} onChange={e=>setEdit({...edit,branch_id:e.target.value})}><option value=''>Tất cả/Không gán</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><select value={edit.status} onChange={e=>setEdit({...edit,status:e.target.value})}><option>pending</option><option>approved</option><option>rejected</option></select><select value={edit.active?'1':'0'} onChange={e=>setEdit({...edit,active:e.target.value==='1'})}><option value='1'>active</option><option value='0'>locked</option></select><button className='primary' onClick={save}>Lưu</button></div>}<div className='table'><table><thead><tr><th>Tên</th><th>Email</th><th>Role</th><th>Cơ sở</th><th>Duyệt</th><th>Active</th><th></th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.full_name}</td><td>{u.email}</td><td>{u.role}</td><td>{bname(branches,u.branch_id)}</td><td>{u.status}</td><td>{u.active?'active':'locked'}</td><td><button onClick={()=>setEdit(u)}>Sửa/Duyệt</button></td></tr>)}</tbody></table></div></section>}
function LeadModal({initial,branches,users,profile,onClose,onSave}){const isSale=profile.role==='sale';const[f,setF]=useState({name:'',phone:'',source:'MKT',branch_id:isSale?profile.branch_id:(branches[0]?.id||''),owner_id:isSale?profile.id:(users[0]?.id||profile.id),status:'Lead mới',package_interest:'Membership',value:0,follow_date:'',note:'',...initial});const set=(k,v)=>setF({...f,[k]:v});return <div className='modal'><form className='modal-card' onSubmit={e=>{e.preventDefault();onSave(f)}}><div className='modal-head'><h3>{f.id?'Sửa lead':'Thêm lead'}</h3><button type='button' onClick={onClose}>×</button></div><label>Tên khách<input value={f.name} onChange={e=>set('name',e.target.value)} required/></label><label>SĐT<input value={f.phone||''} onChange={e=>set('phone',e.target.value)}/></label><label>Nguồn<select value={f.source} onChange={e=>set('source',e.target.value)}>{SOURCES.map(x=><option key={x}>{x}</option>)}</select></label><label>Cơ sở<select disabled={isSale} value={f.branch_id||''} onChange={e=>set('branch_id',e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Sale<select disabled={isSale} value={f.owner_id||''} onChange={e=>set('owner_id',e.target.value)}>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label><label>Trạng thái<select value={f.status} onChange={e=>set('status',e.target.value)}>{STATUSES.map(x=><option key={x}>{x}</option>)}</select></label><label>Gói<input value={f.package_interest||''} onChange={e=>set('package_interest',e.target.value)}/></label><label>Giá trị<input type='number' value={f.value||0} onChange={e=>set('value',e.target.value)}/></label><label>Follow-up<input type='date' value={f.follow_date||''} onChange={e=>set('follow_date',e.target.value)}/></label><label>Ghi chú<textarea value={f.note||''} onChange={e=>set('note',e.target.value)}/></label><button className='primary full'>Lưu</button></form></div>}
createRoot(document.getElementById('root')).render(<App/>);