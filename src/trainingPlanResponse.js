// n8n may return the last node's item as an array or wrap it in `json`.
// An HTTP 2xx alone only confirms that the webhook answered, not that email was sent.
export function interpretTrainingPlanResponse(status, ok, body) {
 let parsed;
 try { parsed = JSON.parse(body); } catch { parsed = null; }
 const candidates = [parsed, ...(Array.isArray(parsed) ? parsed : [])];
 for (const item of [...candidates]) {
  if (item && typeof item === 'object') {
   candidates.push(item.json, item.data);
  }
 }
 const result = candidates.find(item => item && typeof item === 'object' && !Array.isArray(item) && ('success' in item || 'error' in item));
 const message = result?.message || result?.error;
 if (!ok || result?.success === false || result?.error) {
  return { kind: 'error', message: typeof message === 'string' ? message : `Workflow lỗi (HTTP ${status}).` };
 }
 if (result?.success === true) return { kind: 'success', data: result };
 return { kind: 'accepted' };
}
