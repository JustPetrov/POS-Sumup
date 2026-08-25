const API = 'https://api.sumup.com';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.POS_ORIGIN || 'https://www.bendemen.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SumUp-Gateway-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false,error:'Method not allowed' });
  if (req.headers.origin && req.headers.origin !== (process.env.POS_ORIGIN || 'https://www.bendemen.com')) return res.status(403).json({success:false,error:'Origin not allowed'});
  try {
    const readerId = String(req.body?.readerId || req.query.readerId || '');
    if (!readerId) return res.status(400).json({success:false,error:'readerId is required'});
    const r = await fetch(`${API}/v0.1/merchants/${encodeURIComponent(process.env.SUMUP_MERCHANT_CODE)}/readers/${encodeURIComponent(readerId)}/terminate`, { method:'POST', headers:{Authorization:`Bearer ${process.env.SUMUP_API_KEY}`,'Content-Type':'application/json'}, body:'{}' });
    const text = await r.text(); let data={}; try{data=text?JSON.parse(text):{}}catch{data={raw:text}};
    if(!r.ok) return res.status(r.status).json({success:false,error:data?.message||data?.error||`SumUp HTTP ${r.status}`});
    return res.status(200).json({success:true,result:data});
  } catch(e){ return res.status(500).json({success:false,error:e.message||'Terminate error'}); }
}
