import { createClient } from '@supabase/supabase-js';

export function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}

export function allowCors(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-akc-api-key');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function requireApiKey(req, res) {
  const expected = process.env.AKC_CRM_API_KEY;
  if (!expected) return true; // nếu chưa khai báo thì tạm mở, nhưng production nên khai báo
  const got = req.headers['x-akc-api-key'];
  if (got !== expected) {
    json(res, 401, { success: false, error: 'Unauthorized: invalid x-akc-api-key' });
    return false;
  }
  return true;
}

export function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE env. Required: VITE_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
