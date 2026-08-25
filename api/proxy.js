const API = 'https://api.sumup.com';

function cors(res) {
  const origin = process.env.POS_ORIGIN || 'https://www.bendemen.com';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function allowed(req) {
  const origin = req.headers.origin;
  return !origin || origin === (process.env.POS_ORIGIN || 'https://www.bendemen.com');
}

async function call(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.SUMUP_API_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.message || data?.error || `SumUp HTTP ${response.status}`);
  return data;
}

function merchantPath(merchant, suffix) {
  return `/v0.1/merchants/${encodeURIComponent(merchant)}${suffix}`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!allowed(req)) return res.status(403).json({ success: false, error: 'Origin not allowed' });

  const action = String(req.query.action || '');
  const merchant = process.env.SUMUP_MERCHANT_CODE;
  const readerId = req.query.readerId ? String(req.query.readerId) : '';
  if (!process.env.SUMUP_API_KEY || !merchant) return res.status(500).json({ success: false, error: 'SumUp credentials are not configured' });

  try {
    if (action === 'readers' && req.method === 'GET') {
      const data = await call(merchantPath(merchant, '/readers'));
      return res.status(200).json({ success: true, readers: data.items || data.data || [] });
    }

    if (action === 'reader-status' && readerId && req.method === 'GET') {
      const data = await call(merchantPath(merchant, `/readers/${encodeURIComponent(readerId)}/status`));
      return res.status(200).json({ success: true, status: data?.data || data });
    }

    if (action === 'pair' && req.method === 'POST') {
      const { pairingCode, name, metadata = {} } = req.body || {};
      if (!pairingCode || !name) return res.status(400).json({ success: false, error: 'pairingCode en name zijn verplicht' });
      const data = await call(merchantPath(merchant, '/readers'), { method: 'POST', body: JSON.stringify({ pairing_code: String(pairingCode).trim(), name, metadata }) });
      return res.status(200).json({ success: true, reader: data?.data || data });
    }

    if (action === 'unlink' && readerId && req.method === 'DELETE') {
      await call(merchantPath(merchant, `/readers/${encodeURIComponent(readerId)}`), { method: 'DELETE' });
      return res.status(200).json({ success: true });
    }

    if (action === 'sync' && req.method === 'GET') {
      const data = await call(merchantPath(merchant, '/readers'));
      const readers = data.items || data.data || [];
      return res.status(200).json({ success: true, readers, syncedAt: new Date().toISOString() });
    }

    if (action === 'pay' && req.method === 'POST') {
      const body = req.body || {};
      const amount = Number(body.totalAmount ?? body.amount);
      const targetReaderId = String(body.readerId || readerId || '');
      if (!targetReaderId) return res.status(400).json({ success: false, error: 'Geen SumUp Solo gekoppeld aan dit apparaat.' });
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'Ongeldig bedrag' });

      const foreignId = String(body.foreignTransactionId || `bdm-${Date.now()}-${crypto.randomUUID()}`);
      const affiliate = process.env.SUMUP_APP_ID && process.env.SUMUP_AFFILIATE_KEY ? { app_id: process.env.SUMUP_APP_ID, key: process.env.SUMUP_AFFILIATE_KEY, foreign_transaction_id: foreignId } : undefined;
      const payload = { total_amount: { currency: 'EUR', minor_unit: 2, value: Math.round(amount * 100) }, description: body.description || 'Bendemen POS betaling', return_url: process.env.SUMUP_WEBHOOK_URL || `${process.env.PUBLIC_GATEWAY_URL || ''}/api/webhook`, ...(affiliate ? { affiliate } : {}) };
      const checkoutResult = await call(merchantPath(merchant, `/readers/${encodeURIComponent(targetReaderId)}/checkout`), { method: 'POST', body: JSON.stringify(payload) });
      const checkout = checkoutResult?.data || checkoutResult;
      if (!checkout?.client_transaction_id) throw new Error('SumUp gaf geen client_transaction_id terug.');
      return res.status(200).json({ success: true, pending: true, readerId: targetReaderId, clientTransactionId: checkout.client_transaction_id, checkout });
    }

    if (action === 'transaction' && req.method === 'GET' && req.query.clientTransactionId) {
      const id = String(req.query.clientTransactionId);
      const data = await call(`/v2.1/merchants/${encodeURIComponent(merchant)}/transactions?client_transaction_id=${encodeURIComponent(id)}`);
      const tx = data?.data || data;
      const status = String(tx?.status || tx?.simple_status || 'PENDING').toUpperCase();
      return res.status(200).json({ success: true, transaction: tx, status, pending: !['SUCCESSFUL', 'FAILED', 'CANCELLED', 'REFUNDED'].includes(status) });
    }

    if (action === 'checkout' && req.method === 'GET' && readerId && req.query.checkoutId) {
      const data = await call(merchantPath(merchant, `/readers/${encodeURIComponent(readerId)}/checkout/${encodeURIComponent(req.query.checkoutId)}`));
      return res.status(200).json({ success: true, checkout: data?.data || data });
    }

    if (action === 'terminate' && req.method === 'POST' && readerId) {
      const data = await call(merchantPath(merchant, `/readers/${encodeURIComponent(readerId)}/terminate`), { method: 'POST', body: '{}' });
      return res.status(200).json({ success: true, result: data?.data || data });
    }

    return res.status(400).json({ success: false, error: 'Onbekende of ongeldige SumUp actie' });
  } catch (error) {
    console.error('[SUMUP GATEWAY]', error);
    return res.status(500).json({ success: false, error: error.message || 'SumUp Cloud API fout' });
  }
}
