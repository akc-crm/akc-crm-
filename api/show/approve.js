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
    const managerId = body.manager_id || null;
    const managerName = body.manager_name || 'Telegram/n8n approval';

    // Ưu tiên RPC nếu đã chạy SQL function approve_pt_show
    const rpc = await supabase.rpc('approve_pt_show', {
      show_id: showId,
      manager_id: managerId,
      manager_name: managerName
    });

    if (rpc.error) {
      // Fallback update trực tiếp nếu RPC chưa tồn tại
      const { data, error } = await supabase
        .from('pt_checklists')
        .update({
          show_status: 'approved',
          approved_by: managerId,
          approved_by_name: managerName,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', showId)
        .select('*')
        .single();
      if (error) throw error;
      return json(res, 200, { success: true, action: 'approved', show_id: showId, data });
    }

    return json(res, 200, { success: true, action: 'approved', show_id: showId, data: rpc.data });
  } catch (e) {
    return json(res, 500, { success: false, error: e.message || String(e) });
  }
}
