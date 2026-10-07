const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { syncAttendance } = require('./attendance.cjs');
const { resolveStaffCode, saveConfig } = require('./setup.cjs');

function validateJob(job, config, allowUnmapped = false) {
  if (job.context_error) throw new Error(job.context_error);
  if (job.leave_status !== 'Đã duyệt') throw new Error('Đơn nghỉ không còn được duyệt.');
  if (!job.employee?.full_name || job.employee.id !== job.employee_id || job.branch?.id !== job.branch_id) throw new Error('Thiếu thông tin đối chiếu CRM.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(job.work_date)) throw new Error('Ngày nghỉ không hợp lệ.');
  if (!['Nghỉ phép hưởng lương','Nghỉ không lương'].includes(job.attendance_type)) throw new Error('Hình thức nghỉ không hợp lệ.');
  const staffCode = config.staff_codes?.[job.employee_id] ||
    (/^NV\d+$/.test(String(job.employee.kiot_employee_id)) ? String(job.employee.kiot_employee_id) : null);
  const branchName = config.branch_names?.[job.branch_id];
  if (!allowUnmapped && (!staffCode || !/^NV\d+$/.test(staffCode))) throw new Error('Chưa gán mã chấm công NV cho nhân viên ' + job.employee_id);
  if (!branchName) throw new Error('Chưa gán tên cơ sở Kiot cho ' + job.branch_id);
  return {...job, staffCode, branchName, employeeName:job.employee.full_name};
}

async function api(config, method, body) {
  const response = await fetch(new URL('/api/leave/kiot-jobs', config.crm_url), {
    method, headers:{'Content-Type':'application/json','x-akc-worker-key':config.worker_key},
    ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(30000), redirect:'error'
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('CRM chưa có API robot hoặc chưa triển khai: HTTP ' + response.status); }
  if (!response.ok || !data.success) throw new Error('CRM HTTP ' + response.status + ': ' + (data.error || 'Không thành công'));
  return data;
}

async function main(config, mode = 'check', deps = {}) {
  const request = deps.api || api;
  const sync = deps.sync || syncAttendance;
  if (new URL(config.crm_url).protocol !== 'https:' || String(config.worker_key || '').length <= 20) throw new Error('Cấu hình CRM/key chưa hợp lệ.');
  if (mode === 'check') {
    const data = await request(config, 'GET');
    console.log('KET NOI CRM OK; CHO PHEP CLAIM:', data.enabled);
    console.log('HANG DOI:', data.queue?.length || 0);
    console.log('NHAN VIEN:', JSON.stringify(data.employees));
    console.log('CO SO:', JSON.stringify(data.branches));
    return data;
  }
  if (!['run','preview'].includes(mode)) throw new Error('Chỉ dùng check, preview hoặc run.');
  if (mode === 'preview') {
    const job = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const result = await sync(validateJob(job, config), {...config, write_enabled:false});
    console.log('PREVIEW:', JSON.stringify(result));
    return result;
  }
  if (config.write_enabled !== true) throw new Error('Chưa bật write_enabled trên Vultr. Không claim đơn.');
  const worker = 'vultr-' + crypto.randomUUID();
  const {jobs} = await request(config, 'POST', {worker_name:worker, batch_size:1});
  if (!jobs?.length) { console.log('KHONG CO VIEC; KHONG MO TRINH DUYET.'); return; }
  const job = jobs[0];
  let result, error;
  try {
    const candidate=validateJob(job,config,true);
    const link=config.staff_links?.[job.employee_id];
    if (!candidate.staffCode || (link && (link.kiot_user_id!==String(job.employee.kiot_employee_id) || link.name!==job.employee.full_name))) {
      const resolved=await (deps.resolve || resolveStaffCode)(config,job.employee,candidate.branchName);
      if(!/^NV\d+$/.test(resolved.code)) throw new Error('Mã chấm công tự ghép không hợp lệ.');
      config.staff_codes ||= {}; config.staff_links ||= {};
      config.staff_codes[job.employee_id]=resolved.code;
      config.staff_links[job.employee_id]=resolved;
      (deps.saveConfig || saveConfig)(config);
    }
    result = await sync(validateJob(job, config), config);
  }
  catch (e) { error = e.message; }
  // If reporting fails after a save, leave the lease to expire. A retry reads Kiot
  // before writing and recognizes the already-saved status.
  await request(config, 'PATCH', {worker_name:worker, job_id:job.id, success:!error,
    result:result || {}, error:error || null});
  if (error) throw new Error(error);
  console.log('DA DONG BO:', job.id, JSON.stringify(result));
  return result;
}

if (require.main === module) {
  const configPath = path.join(__dirname, 'robot-config.json');
  Promise.resolve().then(() => main(JSON.parse(fs.readFileSync(configPath,'utf8')), process.argv[2] || 'check'))
    .catch(error => { console.error('LOI ROBOT:', error.message); process.exitCode = 1; });
}
module.exports = {main, validateJob, api};
