const API = 'https://api.sumup.com';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.POS_ORIGIN || 'https://www.bendemen.com');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SumUp-Gateway-Secret');
}
function originAllowed(req) { return !req.headers.origin || req.headers.origin === (process.env.POS_ORIGIN || 'https://www.bendemen.com'); }
async function call(path, options = {}) {
  const r = await fetch(`${API}${path}`, { ...options, headers: { Authorization: `Bearer ${process.env.SUMUP_API_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const text = await r.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(data?.message || data?.error || `SumUp HTTP ${r.status}`);
  return data;
}
export default async function handler(req, res) {
  cors(res); if (req.method === 'OPTIONS') return res.status(204).end();
  if (!originAllowed(req)) return res.status(403).json({ success: false, error: 'Origin not allowed' });
  if (!process.env.SUMUP_API_KEY || !process.env.SUMUP_MERCHANT_CODE) return res.status(500).json({ success: false, error: 'SumUp credentials are not configured' });
  try {
    const merchant = encodeURIComponent(process.env.SUMUP_MERCHANT_CODE);
    if (req.method === 'GET') {
      if (req.query.readerId) {
        const id = encodeURIComponent(String(req.query.readerId));
        if (req.query.action === 'status') return res.status(200).json({ success: true, status: await call(`/v0.1/merchants/${merchant}/readers/${id}/status`) });
        return res.status(200).json({ success: true, reader: await call(`/v0.1/merchants/${merchant}/readers/${id}`) });
      }
      const data = await call(`/v0.1/merchants/${merchant}/readers`);
      return res.status(200).json({ success: true, readers: data.items || [] });
    }
    if (req.method === 'POST') {
      const { pairingCode, name, metadata = {} } = req.body || {};
      if (!pairingCode || !name) return res.status(400).json({ success: false, error: 'pairingCode en name zijn verplicht' });
      const reader = await call(`/v0.1/merchants/${merchant}/readers`, { method: 'POST', body: JSON.stringify({ pairing_code: String(pairingCode).trim(), name, metadata }) });
      return res.status(200).json({ success: true, reader });
    }
    if (req.method === 'DELETE') {
      const id = String(req.query.readerId || ''); if (!id) return res.status(400).json({ success: false, error: 'readerId is required' });
      await call(`/v0.1/merchants/${merchant}/readers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) { console.error(error); return res.status(500).json({ success: false, error: error.message || 'Reader error' }); }
}
