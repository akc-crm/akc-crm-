import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin, isUuid, json, readBody } from '../show/_supabaseAdmin.js';

export function authorized(req) {
  const expected = Buffer.from(process.env.AKC_KIOT_ATTENDANCE_WORKER_KEY || '');
  const supplied = Buffer.from(String(req.headers['x-akc-worker-key'] || ''));
  return expected.length > 20 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) return json(res, 405, { success:false, error:'Method not allowed' });
  if (!authorized(req)) return json(res, 401, { success:false, error:'Worker key không hợp lệ.' });
  try {
    const supabase = getSupabaseAdmin();
    if (req.method === 'GET') {
      const [profiles, branches, attendanceQueue, shiftQueue] = await Promise.all([
        supabase.from('profiles').select('id,full_name,kiot_employee_id').eq('active', true).limit(1000),
        supabase.from('branches').select('id,name').limit(100),
        supabase.from('kiot_attendance_jobs').select('id,employee_id,branch_id,work_date,attendance_type,status').in('status', ['pending','processing','failed']).limit(1000),
        supabase.from('kiot_shift_move_jobs').select('id,employee_id,branch_id,old_rest_date,new_rest_date,status').in('status', ['pending','processing','failed']).limit(1000)
      ]);
      for (const r of [profiles, branches, attendanceQueue, shiftQueue]) if (r.error) throw r.error;
      return json(res, 200, { success:true, enabled:process.env.KIOT_ATTENDANCE_SYNC_ENABLED === 'true',
        employees:profiles.data, branches:branches.data,
        queue:[...(attendanceQueue.data||[]).map(x=>({...x,job_type:'attendance'})),
          ...(shiftQueue.data||[]).map(x=>({...x,job_type:'weekly_rest_change'}))] });
    }
    if (process.env.KIOT_ATTENDANCE_SYNC_ENABLED !== 'true') {
      return json(res, 423, { success:false, disabled:true, error:'Đồng bộ chấm công Kiot đang tắt.' });
    }
    const body = await readBody(req);
    const worker = String(body.worker_name || '').trim().slice(0,100);
    if (!worker) return json(res, 400, { success:false, error:'Thiếu worker_name.' });
    if (req.method === 'PATCH') {
      if (!isUuid(body.job_id) || typeof body.success !== 'boolean' || (body.job_type && !['attendance','weekly_rest_change'].includes(body.job_type))) return json(res, 400, { success:false, error:'job_id, job_type hoặc success không hợp lệ.' });
      const finishRpc=body.job_type==='weekly_rest_change'?'finish_kiot_shift_move_job':'finish_kiot_attendance_job';
      const {error} = await supabase.rpc(finishRpc, {
        target_job:body.job_id, worker_name:worker, was_successful:body.success,
        worker_result:body.result && typeof body.result === 'object' ? body.result : {},
        error_message:body.error ? String(body.error).slice(0,1000) : null
      });
      if (error) throw error;
      return json(res, 200, {success:true});
    }
    const [attendancePurge,shiftPurge] = await Promise.all([
      supabase.rpc('purge_kiot_attendance_jobs', {retain_days:70}),
      supabase.rpc('purge_kiot_shift_move_jobs', {retain_days:70})
    ]);
    if (attendancePurge.error||shiftPurge.error) throw attendancePurge.error||shiftPurge.error;
    let {data, error} = await supabase.rpc('claim_kiot_attendance_jobs', {
      worker_name:worker, batch_size:1, lease_minutes:10
    });
    if (error) throw error;
    let jobType='attendance';
    if (!(data||[]).length) {
      const claimed=await supabase.rpc('claim_kiot_shift_move_jobs', {worker_name:worker,batch_size:1,lease_minutes:10});
      if(claimed.error)throw claimed.error;
      data=claimed.data;jobType='weekly_rest_change';
    }
    const jobs = [];
    for (const job of data || []) {
      const [employee, branch, request] = await Promise.all([
        supabase.from('profiles').select('id,full_name,kiot_employee_id').eq('id',job.employee_id).single(),
        supabase.from('branches').select('id,name').eq('id',job.branch_id).single(),
        jobType==='weekly_rest_change'
          ? supabase.from('weekly_rest_change_requests').select('id,status').eq('id',job.weekly_rest_change_request_id).single()
          : supabase.from('leave_requests').select('id,status').eq('id',job.leave_request_id).single()
      ]);
      const contextError = [employee, branch, request].find(r => r.error)?.error;
      jobs.push({...job,job_type:jobType,employee:employee.data,branch:branch.data,
        ...(jobType==='weekly_rest_change'?{change_status:request.data?.status}:{leave_status:request.data?.status}),
        context_error:contextError ? 'Không đọc được nhân viên/cơ sở/yêu cầu.' : null});
    }
    return json(res, 200, {success:true, jobs});
  } catch (error) {
    return json(res, 500, {success:false, error:error.message || String(error)});
  }
}
