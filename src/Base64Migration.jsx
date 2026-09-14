import React,{useEffect,useState}from'react';
import{supabase}from'./supabaseClient';

const MIME_EXT={'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp'};

function decodeImage(dataUri){
 const match=String(dataUri||'').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
 if(!match)throw new Error('Dữ liệu ảnh base64 không hợp lệ');
 const mime=match[1].toLowerCase(),binary=atob(match[2]),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return{blob:new Blob([bytes],{type:mime}),mime,ext:MIME_EXT[mime]||mime.split('/')[1].replace(/[^a-z0-9]/g,'')||'jpg'};
}

async function uploadAndReplace({kind,id,value}){
 const raw=kind==='comment'?String(value).slice(7):String(value);
 const{blob,mime,ext}=decodeImage(raw);
 const bucket=kind==='comment'?'card-comments':'card-images';
 const folder=kind==='comment'?'comments':'covers';
 const path=`migrated/base64-20260914/${folder}/${id}.${ext}`;
 const{error:uploadError}=await supabase.storage.from(bucket).upload(path,blob,{upsert:true,contentType:mime,cacheControl:'31536000'});
 if(uploadError)throw new Error(`${kind} ${id}: upload thất bại: ${uploadError.message}`);
 const{data:urlData}=supabase.storage.from(bucket).getPublicUrl(path);
 const url=urlData?.publicUrl;
 if(!url)throw new Error(`${kind} ${id}: không tạo được URL Storage`);
 const query=kind==='comment'
  ?supabase.from('card_comments').update({message:`IMAGE::${url}`}).eq('id',id)
  :supabase.from('board_cards').update({cover_image:url,updated_at:new Date().toISOString()}).eq('id',id);
 const{error:updateError}=await query;
 if(updateError)throw new Error(`${kind} ${id}: đã upload nhưng cập nhật database thất bại: ${updateError.message}`);
}

export default function Base64Migration(){
 const[session,setSession]=useState(null),[profile,setProfile]=useState(null),[state,setState]=useState({status:'loading',done:0,total:0,message:'Đang kiểm tra dữ liệu...'});
 useEffect(()=>{let active=true;supabase.auth.getSession().then(async({data})=>{if(!active)return;const ss=data.session;setSession(ss);if(!ss){setState(s=>({...s,status:'login',message:'Hãy đăng nhập CRM bằng tài khoản Admin trước.'}));return;}const{data:p,error}=await supabase.from('profiles').select('id,role,status,active').eq('id',ss.user.id).single();if(!active)return;if(error){setState(s=>({...s,status:'error',message:error.message}));return;}setProfile(p);setState(s=>({...s,status:'ready',message:'Sẵn sàng chuyển ảnh base64 sang Storage.'}));});return()=>{active=false}},[]);
 async function run(){
  if(profile?.role!=='admin'||profile?.status!=='approved'||!profile?.active)return setState(s=>({...s,status:'error',message:'Chỉ tài khoản Admin đang hoạt động được chạy chuyển đổi.'}));
  setState({status:'running',done:0,total:0,message:'Đang đọc danh sách ảnh base64...'});
  const[{data:cards,error:cardError},{data:comments,error:commentError}]=await Promise.all([
   supabase.from('board_cards').select('id,cover_image').like('cover_image','data:image/%;base64,%'),
   supabase.from('card_comments').select('id,message').like('message','IMAGE::data:image/%;base64,%')
  ]);
  if(cardError||commentError){setState({status:'error',done:0,total:0,message:(cardError||commentError).message});return;}
  const jobs=[...(cards||[]).map(x=>({kind:'card',id:x.id,value:x.cover_image})),...(comments||[]).map(x=>({kind:'comment',id:x.id,value:x.message}))];
  setState({status:'running',done:0,total:jobs.length,message:`Tìm thấy ${jobs.length} ảnh. Đang chuyển...`});
  try{
   for(let i=0;i<jobs.length;i++){
    await uploadAndReplace(jobs[i]);
    setState({status:'running',done:i+1,total:jobs.length,message:`Đã chuyển ${i+1}/${jobs.length} ảnh`});
   }
   const[{count:cardsLeft},{count:commentsLeft}]=await Promise.all([
    supabase.from('board_cards').select('id',{count:'exact',head:true}).like('cover_image','data:image/%;base64,%'),
    supabase.from('card_comments').select('id',{count:'exact',head:true}).like('message','IMAGE::data:image/%;base64,%')
   ]);
   const left=(cardsLeft||0)+(commentsLeft||0);
   setState({status:left?'error':'done',done:jobs.length-left,total:jobs.length,message:left?`Còn ${left} ảnh chưa chuyển.`:`Hoàn tất ${jobs.length}/${jobs.length}. Database không còn ảnh base64.`});
  }catch(error){setState(s=>({...s,status:'error',message:error.message}));}
 }
 if(state.status==='loading')return <div className="login"><div className="card"><h1>Chuyển ảnh CRM</h1><p>{state.message}</p></div></div>;
 if(!session)return <div className="login"><div className="card"><h1>Chuyển ảnh CRM</h1><p>{state.message}</p><a href="/">Về trang đăng nhập</a></div></div>;
 return <div className="login"><div className="card"><h1>Chuyển ảnh base64</h1><p>{state.message}</p>{state.total>0&&<p><b>{state.done}/{state.total}</b></p>}{state.status==='ready'&&<button className="primary full" onClick={run}>Bắt đầu chuyển ảnh</button>}{state.status==='error'&&<button className="primary full" onClick={run}>Chạy tiếp phần còn lại</button>}{state.status==='done'&&<a href="/">Về CRM</a>}</div></div>;
}
