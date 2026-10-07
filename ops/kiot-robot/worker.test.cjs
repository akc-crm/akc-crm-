const {test}=require('node:test');
const assert=require('node:assert/strict');
const {main,validateJob}=require('./worker.cjs');
const {recordedStatus}=require('./attendance.cjs');
const config={crm_url:'https://crm.kickfits.info',worker_key:'x'.repeat(64),write_enabled:true,
  staff_codes:{staff:'NV2100338'},branch_names:{branch:'AKC Fitness Long Biên'}};
const job={id:'job',employee_id:'staff',branch_id:'branch',leave_status:'Đã duyệt',
  employee:{id:'staff',full_name:'Vũ Đức Cường',kiot_employee_id:'123'},branch:{id:'branch'},
  work_date:'2026-10-08',attendance_type:'Nghỉ phép hưởng lương'};
test('empty queue never launches a browser',async()=>{
  let launched=false;
  await main(config,'run',{api:async()=>({jobs:[]}),sync:async()=>{launched=true;}});
  assert.equal(launched,false);
});
test('disabled local writes never claim a job',async()=>{
  let requested=false;
  await assert.rejects(main({...config,write_enabled:false},'run',{api:async()=>{requested=true;}}));
  assert.equal(requested,false);
});
test('numeric invoice user ID cannot stand in for attendance NV code',()=>{
  assert.throws(()=>validateJob(job,{...config,staff_codes:{}}),/Chưa gán mã/);
});
test('reporting only succeeds after the adapter verifies',async()=>{
  const calls=[];
  await main(config,'run',{api:async(c,method,body)=>{calls.push({method,body});return method==='POST'?{jobs:[job]}:{};},
    sync:async()=>({outcome:'saved_and_verified'})});
  assert.equal(calls[1].body.success,true);
  assert.equal(calls[1].body.result.outcome,'saved_and_verified');
});
test('save/readback uncertainty is reported as failure, not success',async()=>{
  const calls=[];
  await assert.rejects(main(config,'run',{api:async(c,method,body)=>{calls.push({method,body});return method==='POST'?{jobs:[job]}:{};},
    sync:async()=>{throw new Error('readback failed');}}),/readback failed/);
  assert.equal(calls[1].body.success,false);
});
test('unapproved or mismatched identity never reaches browser',()=>{
  assert.throws(()=>validateJob({...job,leave_status:'Từ chối'},config));
  assert.throws(()=>validateJob({...job,employee:{id:'other',full_name:'Vũ Đức Cường'}},config));
});
test('status label is read from heading, not form options',()=>{
  assert.equal(recordedStatus('Chấm công\nNV2100338\nChưa chấm công\nThời gian\nNghỉ phép hưởng lương\nNghỉ không lương'),'Chưa chấm công');
  assert.equal(recordedStatus('Chấm công\nNghỉ phép hưởng lương\nThời gian\nĐi làm\nNghỉ không lương'),'Nghỉ phép hưởng lương');
});
const {matchApiEmployee,codeFromOptions}=require('./setup.cjs');
test('numeric CRM ID must match a unique active Kiot user and exact name',()=>{
  const users=[{id:123,name:'Vũ Đức Cường',isActive:true}];
  assert.equal(matchApiEmployee(job.employee,users).id,123);
  assert.throws(()=>matchApiEmployee(job.employee,[{id:124,name:'Vũ Đức Cường'}]));
  assert.throws(()=>matchApiEmployee(job.employee,[...users,{id:124,name:'Vũ Đức Cường'}]),/Trùng tên/);
  assert.throws(()=>matchApiEmployee(job.employee,[{id:123,name:'Người khác'}]));
  assert.throws(()=>matchApiEmployee(job.employee,[{...users[0],isActive:false}]));
});
test('UI code discovery rejects ambiguous employees and partial names',()=>{
  assert.equal(codeFromOptions(job.employee,['Vũ Đức Cường\nNV2100338']),'NV2100338');
  assert.throws(()=>codeFromOptions(job.employee,['Vũ Đức Cường NV1','Vũ Đức Cường NV2']));
  assert.throws(()=>codeFromOptions(job.employee,['Vũ Đức Cường khác NV1']));
  assert.throws(()=>codeFromOptions(job.employee,['Vũ Đức Cường 123']));
});
test('unmapped employee resolves automatically before attendance adapter',async()=>{
  const c={...config,staff_codes:{}}; let saved=false;
  await main(c,'run',{api:async(c,method)=>method==='POST'?{jobs:[job]}:{},
    resolve:async()=>({code:'NV2100338',kiot_user_id:'123',name:'Vũ Đức Cường'}),
    saveConfig:()=>{saved=true;},sync:async(candidate)=>{assert.equal(candidate.staffCode,'NV2100338');assert.equal(saved,true);return {outcome:'saved_and_verified'};}});
});
test('failed identity resolution never reaches attendance save',async()=>{
  let synced=false; const calls=[];
  await assert.rejects(main({...config,staff_codes:{}},'run',{
    api:async(c,method,body)=>{calls.push({method,body});return method==='POST'?{jobs:[job]}:{};},
    resolve:async()=>{throw new Error('Trùng tên');},sync:async()=>{synced=true;}}),/Trùng tên/);
  assert.equal(synced,false); assert.equal(calls.at(-1).body.success,false);
});
test('changed numeric ID invalidates a previously discovered code',async()=>{
  const c={...config,staff_codes:{staff:'NV1'},staff_links:{staff:{code:'NV1',kiot_user_id:'old',name:'Vũ Đức Cường'}}};
  let resolved=false;
  await main(c,'run',{api:async(c,method)=>method==='POST'?{jobs:[job]}:{},resolve:async()=>{resolved=true;return {code:'NV2',kiot_user_id:'123',name:'Vũ Đức Cường'};},saveConfig:()=>{},sync:async(candidate)=>{assert.equal(candidate.staffCode,'NV2');return {};}});
  assert.equal(resolved,true);
});
