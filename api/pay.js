const SUMUP_API = 'https://api.sumup.com';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function authorize(req, res) {
  const secret = env('SUMUP_GATEWAY_SECRET');
  const supplied = req.headers['x-sumup-gateway-secret'];
  if (!supplied || supplied !== secret) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function sumup(path, options = {}) {
  const response = await fetch(`${SUMUP_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env('SUMUP_API_KEY')}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.message || data?.error || `SumUp HTTP ${response.status}`);
  return data;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.POS_ORIGIN || 'https://www.bendemen.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SumUp-Gateway-Secret');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!authorize(req, res)) return;

  try {
    const { amount, readerId, description, foreignTransactionId } = req.body || {};
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return res.status(400).json({ success: false, error: 'Invalid amount' });
    if (!readerId) return res.status(400).json({ success: false, error: 'readerId is required' });

    const merchantCode = env('SUMUP_MERCHANT_CODE');
    const affiliateAppId = process.env.SUMUP_APP_ID;
    const affiliateKey = process.env.SUMUP_AFFILIATE_KEY;
    const foreignId = String(foreignTransactionId || `bdm-${Date.now()}-${crypto.randomUUID()}`);
    const affiliate = affiliateAppId && affiliateKey ? { app_id: affiliateAppId, key: affiliateKey, foreign_transaction_id: foreignId } : undefined;

    const payload = {
      total_amount: { currency: 'EUR', minor_unit: 2, value: Math.round(numericAmount * 100) },
      description: description || 'Bendemen POS betaling',
      return_url: process.env.SUMUP_WEBHOOK_URL || `${process.env.PUBLIC_GATEWAY_URL || ''}/api/webhook`,
      ...(affiliate ? { affiliate } : {}),
    };

    const result = await sumup(`/v0.1/merchants/${encodeURIComponent(merchantCode)}/readers/${encodeURIComponent(readerId)}/checkout`, { method: 'POST', body: JSON.stringify(payload) });
    const checkout = result?.data || result;
    if (!checkout?.client_transaction_id) throw new Error('SumUp returned no client_transaction_id');

    return res.status(200).json({ success: true, readerId, clientTransactionId: checkout.client_transaction_id, checkout });
  } catch (error) {
    console.error('SumUp gateway pay error:', error);
    return res.status(500).json({ success: false, error: error.message || 'SumUp gateway error' });
  }
}
