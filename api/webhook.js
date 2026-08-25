export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    // SumUp webhook authenticity must be verified using the mechanism configured
    // for the merchant/application. Keep this endpoint deliberately small and
    // never trust the webhook alone as proof of payment; the POS can query /api/status.
    const event = req.body || {};
    console.log('SumUp webhook received', {
      type: event?.type,
      eventId: event?.id,
      clientTransactionId: event?.data?.client_transaction_id || event?.client_transaction_id,
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('SumUp webhook error:', error);
    return res.status(500).json({ received: false });
  }
}
