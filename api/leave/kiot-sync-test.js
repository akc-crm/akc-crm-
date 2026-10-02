import { allowCors, getSupabaseAdmin, isUuid, json, readBody } from '../show/_supabaseAdmin.js';

const KIOT_TOKEN_URL = 'https://id.kiotviet.vn/connect/token';
const KIOT_BASE_URL = 'https://public.kiotapi.com';

const cleanName = value => String(value || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/akc|fitness|[^a-z0-9]/g, '');

function enumerateDays(start, end) {
  const rows = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last && rows.length < 32) {
    rows.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

async function getKiotToken() {
  const clientId = process.env.KIOT_CLIENT_ID;
  const clientSecret = process.env.KIOT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Vercel chưa có thông tin kết nối KiotViet.');
  const response = await fetch(KIOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ scope: 'PublicApi.Access', grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body.error_description || 'Không lấy được token KiotViet.');
  return body.access_token;
}

async function kiotGet(token, path, params = {}) {
  const response = await fetch(`${KIOT_BASE_URL}${path}?${new URLSearchParams(params)}`, {
    headers: { Retailer: process.env.KIOT_RETAILER || '', Authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.ResponseStatus?.Message || body.message || `KiotViet trả lỗi ${response.status}`);
  return body;
}

async function getAllKiotUsers(token) {
  const users = [];
  for (let currentItem = 0; currentItem < 1000; currentItem += 100) {
    const page = await kiotGet(token, '/users', { pageSize: '100', currentItem: String(currentItem) });
    const batch = page.data || [];
    users.push(...batch);
    if (batch.length < 100 || users.length >= Number(page.total || 0)) break;
  }
  return users;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Method not allowed' });

  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return json(res, 401, { success: false, error: 'Phiên đăng nhập không hợp lệ.' });

    const supabase = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) return json(res, 401, { success: false, error: 'Phiên đăng nhập đã hết hạn.' });

    const [{ data: actor }, body] = await Promise.all([
      supabase.from('profiles').select('id,role,branch_id,extra_branch_ids,active').eq('id', authData.user.id).single(),
      readBody(req)
    ]);
    if (!actor?.active || !['admin', 'manager'].includes(actor.role)) return json(res, 403, { success: false, error: 'Chỉ Admin/Manager được kiểm tra đồng bộ.' });
    if (!isUuid(body.leave_request_id)) return json(res, 400, { success: false, error: 'Mã đơn nghỉ không hợp lệ.' });

    const { data: leave, error: leaveError } = await supabase
      .from('leave_requests')
      .select('id,employee_id,branch_id,start_date,end_date,paid_days,unpaid_days,reason,status')
      .eq('id', body.leave_request_id).single();
    if (leaveError || !leave) return json(res, 404, { success: false, error: 'Không tìm thấy đơn nghỉ phép.' });

    const allowedBranches = [actor.branch_id, ...(actor.extra_branch_ids || [])].filter(Boolean);
    if (actor.role !== 'admin' && !allowedBranches.includes(leave.branch_id)) return json(res, 403, { success: false, error: 'Đơn nghỉ không thuộc cơ sở được quản lý.' });

    const [{ data: employee }, { data: branch }] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email,kiot_employee_id').eq('id', leave.employee_id).single(),
      supabase.from('branches').select('id,name').eq('id', leave.branch_id).single()
    ]);

    const warnings = [];
    let employeeMatch = null;
    let branchMatch = null;
    try {
      const kiotToken = await getKiotToken();
      const [users, branches] = await Promise.all([
        getAllKiotUsers(kiotToken),
        kiotGet(kiotToken, '/branches', { pageSize: '100' })
      ]);
      employeeMatch = users.find(item => String(item.id) === String(employee?.kiot_employee_id || '')) || null;
      branchMatch = (branches.data || []).find(item => cleanName(item.branchName) === cleanName(branch?.name)) || null;
      if (!employee?.kiot_employee_id) warnings.push('Nhân sự chưa có mã nhân viên Kiot trong CRM.');
      else if (!employeeMatch) warnings.push(`Không tìm thấy mã nhân viên Kiot ${employee.kiot_employee_id}.`);
      if (!branchMatch) warnings.push('Chưa đối chiếu được cơ sở CRM với cơ sở KiotViet.');
    } catch (error) {
      warnings.push(`Không kiểm tra được danh mục KiotViet: ${error.message}`);
    }

    const dates = enumerateDays(leave.start_date, leave.end_date);
    const actions = dates.map((workDate, index) => ({
      work_date: workDate,
      attendance_type: index < Number(leave.paid_days || 0) ? 'Nghỉ phép hưởng lương' : 'Nghỉ không lương',
      kiot_employee_id: employee?.kiot_employee_id || null,
      kiot_branch_id: branchMatch?.id || null,
      shift_check: 'Chờ xác minh API ca làm việc',
      will_write_to_kiot: false
    }));
    warnings.push('Bản test không ghi dữ liệu lên KiotViet và chưa loại ngày không có ca làm việc.');

    return json(res, 200, {
      success: true,
      test_mode: true,
      employee: { name: employee?.full_name || employee?.email || 'Nhân sự', kiot_employee_id: employee?.kiot_employee_id || null, matched: !!employeeMatch },
      branch: { name: branch?.name || 'Cơ sở', kiot_branch_id: branchMatch?.id || null, matched: !!branchMatch },
      leave: { ...leave, total_days: dates.length },
      actions,
      warnings
    });
  } catch (error) {
    return json(res, 500, { success: false, error: error.message || String(error) });
  }
}
