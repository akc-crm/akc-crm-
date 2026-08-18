import { allowCors, getSupabaseAdmin, json, readBody, requireApiKey } from '../show/_supabaseAdmin.js';

const ALLOWED_CYCLES = new Set(['daily', 'weekly', 'monthly']);

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Method not allowed' });
  if (!requireApiKey(req, res)) return;

  try {
    const body = await readBody(req);
    const cycles = [...new Set(Array.isArray(body.cycles) ? body.cycles : [])]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => ALLOWED_CYCLES.has(value));
    const runKey = String(body.run_key || '').trim();

    if (!cycles.length) return json(res, 400, { success: false, error: 'cycles phải gồm daily, weekly hoặc monthly' });
    if (!/^[a-z0-9:_-]{8,120}$/i.test(runKey)) return json(res, 400, { success: false, error: 'run_key không hợp lệ' });

    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc('reset_recurring_board_checklists', {
      p_cycles: cycles,
      p_run_key: runKey
    });
    if (error) throw error;

    return json(res, 200, data || { success: true, run_key: runKey, cycles, rows_reset: 0, report: [] });
  } catch (error) {
    console.error('Reset recurring Board checklists error:', error);
    return json(res, 500, { success: false, error: error?.message || 'Không thể reset checklist Board' });
  }
}
