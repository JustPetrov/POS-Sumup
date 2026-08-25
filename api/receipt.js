const API = 'https://api.sumup.com';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.POS_ORIGIN || 'https://www.bendemen.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SumUp-Gateway-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({success:false,error:'Method not allowed'});
  if (req.headers.origin && req.headers.origin !== (process.env.POS_ORIGIN || 'https://www.bendemen.com')) return res.status(403).json({success:false,error:'Origin not allowed'});
  try {
    const transactionId = String(req.query.transactionId || '');
    if (!transactionId) return res.status(400).json({success:false,error:'transactionId is required'});
    const r = await fetch(`${API}/v1.1/receipts/${encodeURIComponent(transactionId)}?mid=${encodeURIComponent(process.env.SUMUP_MERCHANT_CODE)}`, {headers:{Authorization:`Bearer ${process.env.SUMUP_API_KEY}`}});
    const text = await r.text(); let data={}; try{data=text?JSON.parse(text):{}}catch{data={raw:text}};
    if(!r.ok) return res.status(r.status).json({success:false,error:data?.message||data?.error||`SumUp HTTP ${r.status}`});
    return res.status(200).json({success:true,receipt:data});
  } catch(e){ return res.status(500).json({success:false,error:e.message||'Receipt error'}); }
}
