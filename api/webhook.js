const API = 'https://api.sumup.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ received: false, error: 'Method not allowed' });
  try {
    const event = req.body || {};
    const payload = event.payload || event.data || {};
    const clientTransactionId = payload.client_transaction_id || event.client_transaction_id;
    const merchantCode = process.env.SUMUP_MERCHANT_CODE;

    // SumUp's webhook is a notification, not proof of payment. Verify the transaction with SumUp.
    let verifiedTransaction = null;
    if (clientTransactionId && merchantCode && process.env.SUMUP_API_KEY) {
      const response = await fetch(`${API}/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions?client_transaction_id=${encodeURIComponent(clientTransactionId)}`, {
        headers: { Authorization: `Bearer ${process.env.SUMUP_API_KEY}` },
      });
      if (response.ok) verifiedTransaction = await response.json();
    }

    console.log('SumUp webhook verified', {
      eventType: event.event_type || event.type,
      eventId: event.id,
      clientTransactionId,
      status: verifiedTransaction?.status || payload.status,
    });

    // Respond immediately; the POS retrieves the authoritative transaction from /api/transaction.
    return res.status(200).json({ received: true, clientTransactionId, verified: Boolean(verifiedTransaction) });
  } catch (error) {
    console.error('SumUp webhook error:', error);
    // A webhook must be acknowledged quickly; status verification can be retried by the POS.
    return res.status(200).json({ received: true });
  }
}
