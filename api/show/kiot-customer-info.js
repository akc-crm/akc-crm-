import { allowCors, json } from './_supabaseAdmin.js';

const KIOT_CLIENT_ID = process.env.KIOT_CLIENT_ID || 'c939167c-5ff1-4dd4-b4a8-b15487afc49e';
const KIOT_CLIENT_SECRET = process.env.KIOT_CLIENT_SECRET || '947DF8F0855A5C4B5F05BEA847280E5FB56C18F8';
const KIOT_RETAILER = process.env.KIOT_RETAILER || 'akcfitness';
const KIOT_BASE_URL = 'https://public.kiotapi.com';
const KIOT_TOKEN_URL = 'https://id.kiotviet.vn/connect/token';

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

/**
 * Parse ghi chú hóa đơn để tính buổi tiếp theo
 * Ví dụ: "5/50" -> "6/50", "32/95b" -> "33/95b", "5/5b tặng + 32/95b" -> "33/95b"
 * Với KH nhóm (gói có "tháng nhóm"): luôn trả về "1/1"
 */
function calcNextSession(note, isGroup) {
  if (isGroup) return '1/1';
  if (!note || !note.trim()) return '';

  // Tìm tất cả pattern X/Y hoặc X/Yb trong ghi chú
  // Pattern: số/số hoặc số/số+chữ
  const matches = [...note.matchAll(/(\d+)\s*\/\s*(\d+\s*[a-zA-Zàáảãạăắặẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]*)/gi)];
  if (!matches.length) return '';

  // Lấy match cuối cùng (buổi gần nhất)
  const lastMatch = matches[matches.length - 1];
  const current = parseInt(lastMatch[1]);
  const total = lastMatch[2].trim(); // giữ nguyên phần sau dấu / (kể cả chữ "b", "buổi", v.v.)
  const next = current + 1;
  return `${next}/${total}`;
}

/**
 * Parse ghi chú KH (trường hợp chưa có hóa đơn) để lấy tổng buổi
 * Tìm cụm "TSB: Xb" hoặc "TSB:Xb" -> trả về "1/Xb"
 */
function parseCustomerNote(note) {
  if (!note) return '';
  // Tìm pattern TSB: <số><đơn vị>
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

    // Kiểm tra có phải KH nhóm không (dựa vào tên dịch vụ có chữ 'nhóm')
    const isGroup = service_name && /nhóm/i.test(service_name);

    if (isGroup) {
      return json(res, 200, {
        success: true,
        auto_note: '1/1',
        source: 'group',
        is_group: true
      });
    }

    // Lấy thông tin KH từ Kiot (để lấy ghi chú KH)
    let customerNote = '';
    try {
      const custData = await kiotGet('/customers', {
        code: customer_code,
        pageSize: '1'
      });
      const cust = (custData.data || [])[0];
      if (cust && cust.comments) {
        customerNote = cust.comments;
      }
    } catch (e) {
      console.error('Error fetching customer:', e);
    }

    // Lấy hóa đơn gần nhất của KH từ Kiot
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
        // Lấy hóa đơn gần nhất có ghi chú số buổi (dạng X/Y)
        // Bỏ qua các hóa đơn do hệ thống tạo (ghi chú bắt đầu bằng "Show PT -")
        for (const inv of invoices) {
          const note = (inv.description || inv.note || '').trim();
          if (!note) continue;
          if (/^Show PT\s*-/i.test(note)) continue; // bỏ qua hóa đơn show PT
          // Kiểm tra có pattern số buổi X/Y không
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
      // Phương án 1: Tìm thấy hóa đơn có ghi chú số buổi -> tính buổi tiếp theo
      autoNote = calcNextSession(latestInvoiceNote, false);
      source = 'invoice';
    } else if (customerNote) {
      // Phương án 2: Không có hóa đơn số buổi -> lấy từ ghi chú KH (TSB:...)
      autoNote = parseCustomerNote(customerNote);
      source = 'customer_note';
    }

    return json(res, 200, {
      success: true,
      auto_note: autoNote,
      source,
      has_invoice: hasInvoice,
      latest_invoice_note: latestInvoiceNote,
      customer_note: customerNote,
      is_group: false
    });

  } catch (e) {
    return json(res, 500, { success: false, error: e.message || String(e) });
  }
}
