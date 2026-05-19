import { allowCors, requireApiKey, getSupabaseAdmin, readBody, json } from './_supabaseAdmin.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Method not allowed' });
  if (!requireApiKey(req, res)) return;

  try {
    const body = await readBody(req);
    const showId = body.show_id || body.id;
    if (!showId) return json(res, 400, { success: false, error: 'Missing show_id' });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('pt_checklists')
      .update({
        show_status: 'rejected',
        rejected_by: body.manager_id || null,
        rejected_by_name: body.manager_name || 'Telegram/n8n rejection',
        rejected_at: new Date().toISOString(),
        reject_reason: body.reason || body.reject_reason || 'Từ chối từ Telegram/n8n',
        updated_at: new Date().toISOString()
      })
      .eq('id', showId)
      .select('*')
      .single();

    if (error) throw error;
    return json(res, 200, { success: true, action: 'rejected', show_id: showId, data });
  } catch (e) {
    return json(res, 500, { success: false, error: e.message || String(e) });
  }
}
