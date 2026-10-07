const fs=require('node:fs');
const path=require('node:path');
const {api}=require('./worker.cjs');
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/akc|fitness|[^a-z0-9]/g,'');
(async()=>{
  const p=path.join(__dirname,'robot-config.json');
  const config=JSON.parse(fs.readFileSync(p,'utf8'));
  const data=await api(config,'GET');
  const response=await fetch(new URL('/api/show/kiot-search?type=branch&q=all',config.crm_url),{signal:AbortSignal.timeout(30000)});
  const body=await response.json();
  if(!response.ok||!body.success) throw new Error('Không đọc được danh sách cơ sở Kiot.');
  config.branch_names ||= {};
  for(const branch of data.branches) {
    const matches=body.results.filter(k=>normalize(k.name)===normalize(branch.name));
    if(matches.length===1) config.branch_names[branch.id]=matches[0].name;
  }
  const staff=data.employees.filter(e=>e.full_name?.trim()==='Vũ Đức Cường');
  config.staff_codes ||= {};
  if(staff.length===1) config.staff_codes[staff[0].id]='NV2100338';
  fs.writeFileSync(p,JSON.stringify(config,null,2),{mode:0o600});
  console.log('DA GHEP CO SO:',Object.keys(config.branch_names).length);
  console.log('DA GHEP CUONG:',staff.length===1);
  console.log('CHUA BAT GHI. Cac nhan vien khac can gan ma NV cham cong.');
})().catch(e=>{console.error('LOI CAU HINH:',e.message);process.exitCode=1;});
