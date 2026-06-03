import { allowCors, json } from './_supabaseAdmin.js';

// Kiot credentials (stored here for Vercel serverless, ideally use env vars)
const KIOT_CLIENT_ID = process.env.KIOT_CLIENT_ID || 'c939167c-5ff1-4dd4-b4a8-b15487afc49e';
const KIOT_CLIENT_SECRET = process.env.KIOT_CLIENT_SECRET || '947DF8F0855A5C4B5F05BEA847280E5FB56C18F8';
const KIOT_RETAILER = process.env.KIOT_RETAILER || 'akcfitness';
const KIOT_BASE_URL = 'https://public.kiotapi.com';
const KIOT_TOKEN_URL = 'https://id.kiotviet.vn/connect/token';

// Cache token in memory (serverless may reuse instance)
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
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // refresh 60s early
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

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Method not allowed' });

  try {
    const { type, q } = req.query || {};

    if (!type || !q) {
      return json(res, 400, { success: false, error: 'Missing type and q params. type=customer|employee|product' });
    }

    if (type === 'customer') {
      // Search customers by name or phone or code
      const data = await kiotGet('/customers', {
        orderBy: 'name',
        pageSize: '10',
        includeTotal: 'true',
        // KiotViet search uses contactNumber or name
        ...(q.match(/^\d/) ? { contactNumber: q } : { name: q })
      });
      const results = (data.data || []).map(c => ({
        id: c.id,
        code: c.code,
        name: c.name,
        phone: c.contactNumber || '',
        debt: c.debt || 0
      }));
      return json(res, 200, { success: true, results });
    }

    if (type === 'employee') {
      // Search employees (users in Kiot) - fetch all pages
      let allUsers = [];
      let currentItem = 0;
      const pageSize = 100;
      while (true) {
        const data = await kiotGet('/users', { pageSize: String(pageSize), currentItem: String(currentItem) });
        const batch = data.data || [];
        allUsers = allUsers.concat(batch);
        if (batch.length < pageSize || allUsers.length >= (data.total || 0)) break;
        currentItem += pageSize;
      }
      const q_lower = q.toLowerCase();
      // If q is generic (like 'PT' or 'all'), return all; otherwise filter by name
      const filtered = (q_lower === 'pt' || q_lower === 'all' || q_lower === '')
        ? allUsers
        : allUsers.filter(u => u.givenName && u.givenName.toLowerCase().includes(q_lower));
      const results = filtered.map(u => ({
        id: u.id,
        code: u.code || String(u.id),
        name: u.givenName || u.userName,
        isActive: u.isActive
      }));
      return json(res, 200, { success: true, results });
    }

    if (type === 'product') {
      // Search service products by name or code
      const data = await kiotGet('/products', {
        productType: '3', // services only
        pageSize: '50',
        name: q
      });
      const results = (data.data || []).map(p => ({
        id: p.id,
        code: p.code,
        name: p.name,
        price: p.basePrice || 0
      }));
      return json(res, 200, { success: true, results });
    }

    if (type === 'branch') {
      // Get all branches from Kiot
      const data = await kiotGet('/branches', { pageSize: '100' });
      const results = (data.data || []).map(b => ({
        id: b.id,
        name: b.branchName,
        address: b.address || ''
      }));
      return json(res, 200, { success: true, results });
    }

    return json(res, 400, { success: false, error: 'Invalid type. Use: customer, employee, product, branch' });
  } catch (e) {
    return json(res, 500, { success: false, error: e.message || String(e) });
  }
}
