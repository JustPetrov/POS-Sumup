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

function transactionPath(merchant, clientTransactionId) {
  return `/v2.1/merchants/${encodeURIComponent(merchant)}/transactions?client_transaction_id=${encodeURIComponent(clientTransactionId)}`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!allowed(req)) return res.status(403).json({ success: false, error: 'Origin not allowed' });

  const action = String(req.query.action || '');
  const readerId = req.query.readerId ? String(req.query.readerId) : '';
  const merchant = process.env.SUMUP_MERCHANT_CODE;
  if (!process.env.SUMUP_API_KEY || !merchant) {
    return res.status(500).json({ success: false, error: 'SumUp credentials are not configured' });
  }

  try {
    if (action === 'readers' && req.method === 'GET') {
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers`);
      return res.status(200).json({ success: true, readers: data.items || data.data || [] });
    }

    if (action === 'reader-status' && readerId && req.method === 'GET') {
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(readerId)}/status`);
      return res.status(200).json({ success: true, status: data?.data || data });
    }

    if (action === 'pair' && req.method === 'POST') {
      const { pairingCode, name, metadata = {} } = req.body || {};
      if (!pairingCode || !name) return res.status(400).json({ success: false, error: 'pairingCode en name zijn verplicht' });
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers`, {
        method: 'POST',
        body: JSON.stringify({ pairing_code: String(pairingCode).trim(), name, metadata }),
      });
      return res.status(200).json({ success: true, reader: data?.data || data });
    }

    if (action === 'unlink' && readerId && req.method === 'DELETE') {
      await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(readerId)}`, { method: 'DELETE' });
      return res.status(200).json({ success: true });
    }

    if (action === 'pay' && req.method === 'POST') {
      const body = req.body || {};
      const totalAmount = body.totalAmount ?? body.amount;
      const targetReaderId = String(body.readerId || readerId || '');
      const amount = Number(totalAmount);
      if (!targetReaderId) return res.status(400).json({ success: false, error: 'Geen SumUp Solo gekoppeld aan dit apparaat.' });
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'Ongeldig bedrag' });

      const foreignId = String(body.foreignTransactionId || `bdm-${Date.now()}-${crypto.randomUUID()}`);
      const affiliate = process.env.SUMUP_APP_ID && process.env.SUMUP_AFFILIATE_KEY
        ? {
            app_id: process.env.SUMUP_APP_ID,
            key: process.env.SUMUP_AFFILIATE_KEY,
            foreign_transaction_id: foreignId,
          }
        : undefined;

      const payload = {
        total_amount: { currency: 'EUR', minor_unit: 2, value: Math.round(amount * 100) },
        description: body.description || 'Bendemen POS betaling',
        return_url: process.env.SUMUP_WEBHOOK_URL || `${process.env.PUBLIC_GATEWAY_URL || ''}/api/webhook`,
        ...(affiliate ? { affiliate } : {}),
      };

      // The reader checkout is asynchronous. Never wait for the cardholder here;
      // Vercel functions have execution limits. The POS polls /api/proxy?action=transaction.
      const checkoutResult = await call(
        `/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(targetReaderId)}/checkout`,
        { method: 'POST', body: JSON.stringify(payload) }
      );
      const checkout = checkoutResult?.data || checkoutResult;
      const clientTransactionId = checkout?.client_transaction_id;
      if (!clientTransactionId) throw new Error('SumUp gaf geen client_transaction_id terug.');

      return res.status(200).json({
        success: true,
        pending: true,
        readerId: targetReaderId,
        clientTransactionId,
        checkout,
      });
    }

    if (action === 'transaction' && req.method === 'GET' && req.query.clientTransactionId) {
      const data = await call(transactionPath(merchant, String(req.query.clientTransactionId)));
      const tx = data?.data || data;
      return res.status(200).json({
        success: true,
        transaction: tx,
        status: tx?.status || tx?.simple_status || 'PENDING',
        pending: !['SUCCESSFUL', 'FAILED', 'CANCELLED', 'REFUNDED'].includes(String(tx?.status || '').toUpperCase()),
      });
    }

    if (action === 'checkout' && req.method === 'GET' && readerId && req.query.checkoutId) {
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(readerId)}/checkout/${encodeURIComponent(req.query.checkoutId)}`);
      return res.status(200).json({ success: true, checkout: data?.data || data });
    }

    if (action === 'terminate' && req.method === 'POST' && readerId) {
      const data = await call(`/v0.1/merchants/${encodeURIComponent(merchant)}/readers/${encodeURIComponent(readerId)}/terminate`, { method: 'POST', body: '{}' });
      return res.status(200).json({ success: true, result: data?.data || data });
    }

    return res.status(400).json({ success: false, error: 'Onbekende of ongeldige SumUp actie' });
  } catch (error) {
    console.error('[SUMUP GATEWAY]', error);
    return res.status(500).json({ success: false, error: error.message || 'SumUp Cloud API fout' });
  }
}
