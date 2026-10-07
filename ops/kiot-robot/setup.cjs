const fs=require('node:fs');
const path=require('node:path');
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/akc|fitness|[^a-z0-9]/g,'');
const personName=value=>String(value||'').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi-VN');
// Kiot login accounts carry role/branch suffixes, e.g. "Trần Văn Yên - PT BĐ".
// Strip only this explicit format; never accept substring/fuzzy name matches.
const accountPerson=value=>String(value||'').replace(/\s+-\s+(?:PT|HLV|LT|SALE|QL|FM|GS)\s+[\p{L}\p{N} .]{1,50}$/u,'');

async function kiotList(config,type) {
  const response=await fetch(new URL('/api/show/kiot-search?type='+type+'&q=all',config.crm_url),{signal:AbortSignal.timeout(30000),redirect:'error'});
  const body=await response.json();
  if(!response.ok||!body.success||!Array.isArray(body.results)) throw new Error('Không đọc được danh sách '+type+' từ Kiot.');
  return body.results;
}
function matchApiEmployee(employee,users) {
  const id=String(employee.kiot_employee_id||'');
  const matches=users.filter(u=>String(u.id)===id);
  if(!/^\d+$/.test(id)||matches.length!==1) throw new Error('ID nhân viên CRM không khớp duy nhất tài khoản Kiot: '+employee.full_name);
  const user=matches[0];
  if(user.isActive===false||personName(accountPerson(user.name))!==personName(employee.full_name)) throw new Error('Tên/trạng thái tài khoản Kiot không khớp CRM: '+employee.full_name+' / '+user.name);
  if(users.filter(u=>personName(accountPerson(u.name))===personName(employee.full_name)).length!==1) throw new Error('Trùng tên tài khoản Kiot; cần đối chiếu riêng: '+employee.full_name);
  return user;
}
function codeFromOptions(employee,texts) {
  const matches=texts.map(text=>String(text).trim().match(/^(.*?)\s*(NV\d+)$/))
    .filter(m=>m&&personName(m[1])===personName(employee.full_name));
  if(matches.length!==1) throw new Error('Không có duy nhất mã NV chấm công cho '+employee.full_name);
  return matches[0][2];
}
async function resolveStaffCode(config,employee,branchName,deps={}) {
  const users=deps.users||await kiotList(config,'employee');
  const user=matchApiEmployee(employee,users);
  if(!branchName) throw new Error('Chưa ghép cơ sở Kiot.');
  const {chromium}=deps.chromium?{chromium:deps.chromium}:require('playwright');
  const browser=await chromium.launch({headless:true});
  const deadline=setTimeout(()=>browser.close().catch(()=>{}),180000);
  try {
    const context=await browser.newContext({storageState:path.join(__dirname,'session.json'),locale:'vi-VN',timezoneId:'Asia/Ho_Chi_Minh'});
    const page=await context.newPage(); page.setDefaultTimeout(20000);
    const visible=text=>page.getByText(text,{exact:true}).filter({visible:true});
    const loaded=async()=>{
      await visible('Bảng chấm công').first().waitFor({timeout:60000});
      await page.waitForFunction(()=>!Array.from(document.querySelectorAll('*')).some(el=>el.children.length===0&&el.textContent.trim()==='Đang tải dữ liệu'&&el.getClientRects().length>0),null,{timeout:90000});
    };
    await page.goto('https://akcfitness.kiotviet.vn/man/#/TimeSheet',{waitUntil:'domcontentloaded',timeout:60000}); await loaded();
    if(!await visible(branchName).count()) {
      const current=page.getByText(/^AKC Fitness\s/).filter({visible:true});
      if(await current.count()!==1) throw new Error('Không xác định duy nhất cơ sở đang mở.');
      await current.click(); await visible(branchName).last().click();
      await page.waitForTimeout(1500); await loaded();
    }
    await visible(branchName).first().waitFor();
    const search=page.getByPlaceholder('Tìm kiếm nhân viên',{exact:true}).filter({visible:true}).first();
    await search.fill(employee.full_name); await search.press('ArrowDown');
    const options=page.getByRole('option').filter({visible:true});
    await options.first().waitFor();
    // Wait for asynchronous search to settle before deciding uniqueness.
    await page.waitForTimeout(1500);
    const code=codeFromOptions(employee,await options.allTextContents());
    const collision=Object.entries(config.staff_codes||{}).some(([id,value])=>id!==employee.id&&value===code);
    if(collision) throw new Error('Mã NV đã ghép với nhân viên CRM khác: '+code);
    return {code,kiot_user_id:String(user.id),name:employee.full_name};
  } finally { clearTimeout(deadline); await browser.close(); }
}
function saveConfig(config) {
  const p=path.join(__dirname,'robot-config.json');
  const temp=p+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(config,null,2),{mode:0o600});
  fs.chmodSync(temp,0o600); fs.renameSync(temp,p);
}
async function setup() {
  const {api}=require('./worker.cjs');
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'robot-config.json'),'utf8'));
  const data=await api(config,'GET');
  const branches=await kiotList(config,'branch');
  config.branch_names ||= {}; config.staff_codes ||= {}; config.staff_links ||= {};
  for(const branch of data.branches) {
    const matches=branches.filter(k=>normalize(k.name)===normalize(branch.name));
    if(matches.length===1) config.branch_names[branch.id]=matches[0].name;
  }
  saveConfig(config);
  const users=await kiotList(config,'employee');
  const seen=new Set(); let failures=0;
  for(const job of data.queue||[]) {
    if(seen.has(job.employee_id)) continue;
    const employee=data.employees.find(e=>e.id===job.employee_id);
    if(!employee) { failures++; continue; }
    try {
      const link=await resolveStaffCode(config,employee,config.branch_names[job.branch_id],{users});
      config.staff_codes[employee.id]=link.code; config.staff_links[employee.id]=link; saveConfig(config); seen.add(employee.id);
      console.log('DA TU GHEP:',employee.full_name,String(employee.kiot_employee_id),'->',link.code);
    } catch(e) { failures++; console.log('CHUA GHEP:',employee.full_name,e.message); }
  }
  console.log('DA GHEP CO SO:',Object.keys(config.branch_names).length);
  console.log('CHI DOC MA; KHONG CLAIM DON; KHONG LUU CHAM CONG.');
  if(failures) process.exitCode=1;
}
module.exports={resolveStaffCode,matchApiEmployee,codeFromOptions,saveConfig};
if(require.main===module) setup().catch(e=>{console.error('LOI CAU HINH:',e.message);process.exitCode=1;});
