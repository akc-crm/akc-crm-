import { allowCors, json } from './_supabaseAdmin.js';

const KIOT_CLIENT_ID = process.env.KIOT_CLIENT_ID;
const KIOT_CLIENT_SECRET = process.env.KIOT_CLIENT_SECRET;
const KIOT_RETAILER = process.env.KIOT_RETAILER;
const KIOT_TOKEN_URL = 'https://id.kiotviet.vn/connect/token';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });

  // Check env vars
  const envCheck = {
    KIOT_CLIENT_ID: KIOT_CLIENT_ID ? `set (${KIOT_CLIENT_ID.slice(0,8)}...)` : 'MISSING',
    KIOT_CLIENT_SECRET: KIOT_CLIENT_SECRET ? `set (${KIOT_CLIENT_SECRET.slice(0,8)}...)` : 'MISSING',
    KIOT_RETAILER: KIOT_RETAILER || 'MISSING',
  };

  // Try to get token
  let tokenResult = null;
  try {
    const resp = await fetch(KIOT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `scope=PublicApi.Access&grant_type=client_credentials&client_id=${KIOT_CLIENT_ID}&client_secret=${KIOT_CLIENT_SECRET}`
    });
    const data = await resp.json();
    tokenResult = {
      status: resp.status,
      has_token: !!data.access_token,
      token_preview: data.access_token ? data.access_token.slice(0, 20) + '...' : null,
      error: data.error || null,
      error_description: data.error_description || null,
    };
  } catch (e) {
    tokenResult = { error: e.message };
  }

  return json(res, 200, { envCheck, tokenResult });
}
