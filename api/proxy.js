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
    headers: {
      Authorization: `Bearer ${process.env.SUMUP_API_KEY}`,
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

async function transaction(merchant, id) {
  return call(`/v2.1/merchants/${encodeURIComponent(merchant)}/transactions?client_transaction_id=${encodeURIComponent(id)}`);
}

async function waitForTransaction(merchant, id, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await transaction(merchant, id);
    const tx = result?.data || result;
    const status = String(tx?.status || tx?.simple_status || '').toUpperCase();
    if (status === 'SUCCESSFUL') return tx;
    if (['FAILED', 'CANCELLED', 'REFUNDED', 'CHARGE_BACK'].includes(status)) {
      throw new Error(`SumUp betaling ${status.toLowerCase()}.`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('SumUp betaling wacht nog op bevestiging. Controleer de Solo voordat je opnieuw probeert te betalen.');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!allowed(req)) return res.status(403).json({ success: false, error: 'Origin not allowed' });

  const action = String(req.query.action || '');
  const readerId = req.query.readerId ? String(req.query.readerId) : '';
  const merchant = process.env.SUMUP_MERCHANT_CODE;
  if (!process.env.SUMUP_API_KEY || !merchant) return res.status(500).json({ success: false, error: 'SumUp credentials are not configured' });

  try {
    if (action === 'readers' && req.method === 'GET') {
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers`);
      return res.status(200).json({ success: true, readers: data.items || [] });
    }

    if (action === 'reader-status' && readerId && req.method === 'GET') {
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(readerId)}/status`);
      return res.status(200).json({ success: true, status: data });
    }

    if (action === 'pair' && req.method === 'POST') {
      const { pairingCode, name, metadata = {} } = req.body || {};
      if (!pairingCode || !name) return res.status(400).json({ success: false, error: 'pairingCode en name zijn verplicht' });
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers`, {
        method: 'POST',
        body: JSON.stringify({ pairing_code: String(pairingCode).trim(), name, metadata }),
      });
      return res.status(200).json({ success: true, reader: data });
    }

    if (action === 'unlink' && readerId && req.method === 'DELETE') {
      await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(readerId)}`, { method: 'DELETE' });
      return res.status(200).json({ success: true });
    }

    if (action === 'pay' && req.method === 'POST') {
      const { totalAmount, readerId: bodyReaderId, foreignTransactionId, description } = req.body || {};
      const targetReaderId = String(bodyReaderId || readerId || '');
      const amount = Number(totalAmount);
      if (!targetReaderId) return res.status(400).json({ success: false, error: 'Geen SumUp Solo gekoppeld aan dit apparaat.' });
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'Ongeldig bedrag' });

      const foreignId = String(foreignTransactionId || `bdm-${Date.now()}-${crypto.randomUUID()}`);
      const affiliate = process.env.SUMUP_APP_ID && process.env.SUMUP_AFFILIATE_KEY
        ? { app_id: process.env.SUMUP_APP_ID, key: process.env.SUMUP_AFFILIATE_KEY, foreign_transaction_id: foreignId }
        : undefined;
      const payload = {
        total_amount: { currency: 'EUR', minor_unit: 2, value: Math.round(amount * 100) },
        description: description || 'Bendemen POS betaling',
        return_url: process.env.SUMUP_WEBHOOK_URL || `${process.env.PUBLIC_GATEWAY_URL || ''}/api/webhook`,
        ...(affiliate ? { affiliate } : {}),
      };
      const checkoutResult = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(targetReaderId)}/checkout`, {
        method: 'POST', body: JSON.stringify(payload),
      });
      const checkout = checkoutResult?.data || checkoutResult;
      const clientTransactionId = checkout?.client_transaction_id;
      if (!clientTransactionId) throw new Error('SumUp gaf geen client_transaction_id terug.');
      const tx = await waitForTransaction(merchant, clientTransactionId);
      return res.status(200).json({ success: true, readerId: targetReaderId, clientTransactionId, transaction: tx, checkout });
    }

    if (action === 'transaction' && req.method === 'GET' && req.query.clientTransactionId) {
      const data = await transaction(merchant, String(req.query.clientTransactionId));
      return res.status(200).json({ success: true, transaction: data?.data || data });
    }

    if (action === 'checkout' && req.method === 'GET' && readerId && req.query.checkoutId) {
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(readerId)}/checkout/${encodeURIComponent(req.query.checkoutId)}`);
      return res.status(200).json({ success: true, checkout: data?.data || data });
    }

    if (action === 'terminate' && req.method === 'POST' && readerId) {
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(readerId)}/terminate`, { method: 'POST', body: '{}' });
      return res.status(200).json({ success: true, result: data });
    }

    if (action === 'receipt' && req.method === 'GET' && req.query.transactionId) {
      const data = await call(`/v1.1/receipts/${encodeURIComponent(req.query.transactionId)}?mid=${encodeURIComponent(merchant)}`);
      return res.status(200).json({ success: true, receipt: data });
    }

    return res.status(400).json({ success: false, error: 'Onbekende of ongeldige SumUp actie' });
  } catch (error) {
    console.error('[SUMUP GATEWAY]', error);
    return res.status(500).json({ success: false, error: error.message || 'SumUp Cloud API fout' });
  }
}
