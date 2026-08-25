const SUMUP_API = 'https://api.sumup.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.POS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bendemen-Gateway-Key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (process.env.GATEWAY_SHARED_SECRET && req.headers['x-bendemen-gateway-key'] !== process.env.GATEWAY_SHARED_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const clientTransactionId = String(req.query.clientTransactionId || '');
    if (!clientTransactionId) return res.status(400).json({ success: false, error: 'clientTransactionId is required' });
    const merchantCode = process.env.SUMUP_MERCHANT_CODE;
    if (!merchantCode || !process.env.SUMUP_API_KEY) throw new Error('SumUp credentials are not configured');

    const response = await fetch(`${SUMUP_API}/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions?client_transaction_id=${encodeURIComponent(clientTransactionId)}`, {
      headers: { Authorization: `Bearer ${process.env.SUMUP_API_KEY}` },
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) return res.status(response.status).json({ success: false, error: data?.message || data?.error || `SumUp HTTP ${response.status}` });
    return res.status(200).json({ success: true, transaction: data?.data || data });
  } catch (error) {
    console.error('SumUp gateway status error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Status error' });
  }
}
