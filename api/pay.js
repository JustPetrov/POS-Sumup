const SUMUP_API = 'https://api.sumup.com';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function cors(res) {
  const origin = process.env.POS_ORIGIN || 'https://www.bendemen.com';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SumUp-Gateway-Secret');
}

function browserOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === (process.env.POS_ORIGIN || 'https://www.bendemen.com');
}

async function sumup(path, options = {}) {
  const response = await fetch(`${SUMUP_API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${required('SUMUP_API_KEY')}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.message || data?.error || `SumUp HTTP ${response.status}`);
  return data;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!browserOriginAllowed(req)) return res.status(403).json({ success: false, error: 'Origin not allowed' });

  // A server-to-server caller may authenticate with SUMUP_GATEWAY_SECRET.
  // Browser POS calls rely on the strict configured origin; the secret must never be exposed client-side.
  const gatewaySecret = process.env.SUMUP_GATEWAY_SECRET;
  const suppliedSecret = req.headers['x-sumup-gateway-secret'];
  if (gatewaySecret && suppliedSecret && suppliedSecret !== gatewaySecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const { amount, totalAmount, readerId, description, foreignTransactionId } = req.body || {};
    const numericAmount = Number(totalAmount ?? amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return res.status(400).json({ success: false, error: 'Invalid amount' });
    if (!readerId) return res.status(400).json({ success: false, error: 'readerId is required' });

    const merchantCode = required('SUMUP_MERCHANT_CODE');
    const foreignId = String(foreignTransactionId || `bdm-${Date.now()}-${crypto.randomUUID()}`);
    const affiliate = process.env.SUMUP_APP_ID && process.env.SUMUP_AFFILIATE_KEY
      ? { app_id: process.env.SUMUP_APP_ID, key: process.env.SUMUP_AFFILIATE_KEY, foreign_transaction_id: foreignId }
      : undefined;

    const payload = {
      total_amount: { currency: 'EUR', minor_unit: 2, value: Math.round(numericAmount * 100) },
      description: description || 'Bendemen POS betaling',
      return_url: required('SUMUP_WEBHOOK_URL'),
      ...(affiliate ? { affiliate } : {}),
    };

    const result = await sumup(`/v0.1/merchants/${encodeURIComponent(merchantCode)}/readers/${encodeURIComponent(readerId)}/checkout`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const checkout = result?.data || result;
    if (!checkout?.client_transaction_id) throw new Error('SumUp returned no client_transaction_id');

    return res.status(200).json({ success: true, readerId, clientTransactionId: checkout.client_transaction_id, checkout, foreignTransactionId: foreignId });
  } catch (error) {
    console.error('SumUp gateway pay error:', error);
    return res.status(500).json({ success: false, error: error.message || 'SumUp gateway error' });
  }
}
