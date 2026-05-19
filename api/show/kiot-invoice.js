import { allowCors, requireApiKey, getSupabaseAdmin, readBody, json } from './_supabaseAdmin.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Method not allowed' });
  if (!requireApiKey(req, res)) return;

  try {
    const body = await readBody(req);
    const showId = body.show_id || body.id;
    const invoiceCode = body.invoice_code || body.kiot_invoice_code || body.invoice_id;
    if (!showId) return json(res, 400, { success: false, error: 'Missing show_id' });
    if (!invoiceCode) return json(res, 400, { success: false, error: 'Missing invoice_code' });

    const supabase = getSupabaseAdmin();

    const rpc = await supabase.rpc('mark_pt_show_kiot_invoice_created', {
      show_id: showId,
      invoice_id: body.invoice_id || invoiceCode,
      invoice_code: invoiceCode
    });

    if (rpc.error) {
      const { data, error } = await supabase
        .from('pt_checklists')
        .update({
          show_status: 'kiot_invoice_created',
          kiot_invoice_id: body.invoice_id || invoiceCode,
          kiot_invoice_code: invoiceCode,
          kiot_invoice_created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', showId)
        .select('*')
        .single();
      if (error) throw error;
      return json(res, 200, { success: true, action: 'kiot_invoice_created', show_id: showId, data });
    }

    return json(res, 200, { success: true, action: 'kiot_invoice_created', show_id: showId, data: rpc.data });
  } catch (e) {
    return json(res, 500, { success: false, error: e.message || String(e) });
  }
}
