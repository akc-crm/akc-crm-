import { allowCors, json, getSupabaseAdmin } from './_supabaseAdmin.js';

const KIOT_CLIENT_ID = process.env.KIOT_CLIENT_ID || 'c939167c-5ff1-4dd4-b4a8-b15487afc49e';
const KIOT_CLIENT_SECRET = process.env.KIOT_CLIENT_SECRET || '947DF8F0855A5C4B5F05BEA847280E5FB56C18F8';
const KIOT_RETAILER = process.env.KIOT_RETAILER || 'akcfitness';
const KIOT_BASE_URL = 'https://public.kiotapi.com';
const KIOT_TOKEN_URL = 'https://id.kiotviet.vn/connect/token';

// Cache TTL: 10 phút
const CACHE_TTL_SECONDS = 600;

let cachedToken = null;
let tokenExpiry = 0;

async function getKiotToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const resp = await fetch(KIOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `scope=PublicApi.Access&grant_type=client_credentials&client_id=${KIOT_CLIENT_ID}&client_secret=${KIOT_CLIENT_SECRET}`
  });
  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function kiotGet(path, params = {}) {
  const token = await getKiotToken();
  const qs = new URLSearchParams(params).toString();
  const url = `${KIOT_BASE_URL}${path}${qs ? '?' + qs : ''}`;
  const resp = await fetch(url, {
    headers: {
      'Retailer': KIOT_RETAILER,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  return resp.json();
}

// ---- Supabase Cache helpers ----
async function getCached(supabase, key) {
  try {
    const { data, error } = await supabase
      .from('kiot_cache')
      .select('data, expires_at')
      .eq('cache_key', key)
      .single();
    if (error || !data) return null;
    if (new Date(data.expires_at) < new Date()) {
      // Expired - xóa async không chờ
      supabase.from('kiot_cache').delete().eq('cache_key', key).then(() => {});
      return null;
    }
    return data.data;
  } catch (e) {
    return null;
  }
}

async function setCached(supabase, key, value) {
  try {
    const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString();
    await supabase.from('kiot_cache').upsert({
      cache_key: key,
      data: value,
      expires_at: expiresAt
    }, { onConflict: 'cache_key' });
  } catch (e) {
    console.error('Cache write error:', e);
  }
}

/**
 * Parse ghi chú hóa đơn để tính buổi tiếp theo
 * Ví dụ: "5/50" -> "6/50", "32/95b" -> "33/95b", "5/5b tặng + 32/95b" -> "33/95b"
 */
function calcNextSession(note, isGroup) {
  if (isGroup) return '1/1';
  if (!note || !note.trim()) return '';
  const matches = [...note.matchAll(/(\d+)\s*\/\s*(\d+\s*[a-zA-Zàáảãạăắặẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]*)/gi)];
  if (!matches.length) return '';
  const lastMatch = matches[matches.length - 1];
  const current = parseInt(lastMatch[1]);
  const total = lastMatch[2].trim();
  const next = current + 1;
  return `${next}/${total}`;
}

/**
 * Parse ghi chú KH để lấy tổng buổi từ "TSB: Xb"
 */
function parseCustomerNote(note) {
  if (!note) return '';
  const match = note.match(/TSB\s*:\s*(\d+\s*[a-zA-Z]*)/i);
  if (match) {
    const total = match[1].trim();
    return `1/${total}`;
  }
  return '';
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Method not allowed' });

  try {
    const { customer_code, service_name } = req.query || {};
    if (!customer_code) {
      return json(res, 400, { success: false, error: 'Missing customer_code' });
    }

    // KH nhóm: luôn trả về 1/1 ngay lập tức
    const isGroup = service_name && /nhóm/i.test(service_name);
    if (isGroup) {
      return json(res, 200, {
        success: true,
        auto_note: '1/1',
        source: 'group',
        is_group: true,
        cached: false
      });
    }

    // Cache key theo customer_code
    const cacheKey = `kiot_customer_info_${customer_code}`;

    // Khởi tạo Supabase
    let supabase = null;
    try {
      supabase = getSupabaseAdmin();
    } catch (e) {
      console.error('Supabase init error:', e);
    }

    // Kiểm tra cache trước - nếu hit thì trả về ngay (< 50ms)
    if (supabase) {
      const cached = await getCached(supabase, cacheKey);
      if (cached) {
        return json(res, 200, { ...cached, cached: true });
      }
    }

    // Cache miss - gọi KiotViet API
    let customerNote = '';
    try {
      const custData = await kiotGet('/customers', {
        code: customer_code,
        pageSize: '1'
      });
      const cust = (custData.data || [])[0];
      if (cust && cust.comments) customerNote = cust.comments;
    } catch (e) {
      console.error('Error fetching customer:', e);
    }

    let latestInvoiceNote = '';
    let hasInvoice = false;
    try {
      const invoiceData = await kiotGet('/invoices', {
        customerCode: customer_code,
        pageSize: '20',
        orderBy: 'createdDate',
        orderDirection: 'Desc',
        includeTotal: 'true'
      });
      const invoices = invoiceData.data || [];
      if (invoices.length > 0) {
        hasInvoice = true;
        for (const inv of invoices) {
          const note = (inv.description || inv.note || '').trim();
          if (!note) continue;
          if (/^Show PT\s*-/i.test(note)) continue;
          if (/\d+\s*\/\s*\d+/.test(note)) {
            latestInvoiceNote = note;
            break;
          }
        }
      }
    } catch (e) {
      console.error('Error fetching invoices:', e);
    }

    let autoNote = '';
    let source = '';
    if (latestInvoiceNote) {
      autoNote = calcNextSession(latestInvoiceNote, false);
      source = 'invoice';
    } else if (customerNote) {
      autoNote = parseCustomerNote(customerNote);
      source = 'customer_note';
    }

    const result = {
      success: true,
      auto_note: autoNote,
      source,
      has_invoice: hasInvoice,
      latest_invoice_note: latestInvoiceNote,
      customer_note: customerNote,
      is_group: false,
      cached: false
    };

    // Lưu vào cache async (không block response)
    if (supabase) {
      setCached(supabase, cacheKey, result).catch(() => {});
    }

    return json(res, 200, result);

  } catch (e) {
    return json(res, 500, { success: false, error: e.message || String(e) });
  }
}
