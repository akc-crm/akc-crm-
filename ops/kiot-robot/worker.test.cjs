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
