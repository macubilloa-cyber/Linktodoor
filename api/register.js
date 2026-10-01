export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!KEY) return res.status(500).json({ ok: false });

  const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name  = clean(req.body?.nombre, 80);
  const phone = clean(req.body?.telefono, 30);
  const email = clean(req.body?.email, 120).toLowerCase();
  const notes = clean(req.body?.modalidad, 60);
  if (!name || !phone || !email.includes('@')) return res.status(400).json({ ok: false });

  const headers = { 'Authorization': `Bearer ${KEY}`, 'apikey': KEY, 'Content-Type': 'application/json' };

  // Existing clients are never overwritten from the public form.
  const existing = await fetch(
    `${SUPABASE_URL}/rest/v1/saved_clients?email=ilike.${encodeURIComponent(email)}&select=id&limit=1`,
    { headers }
  ).then(r => r.json()).catch(() => null);
  if (Array.isArray(existing) && existing.length) return res.status(200).json({ ok: true });

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/saved_clients`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, phone, email, notes })
  });
  return res.status(ins.ok ? 200 : 500).json({ ok: ins.ok });
}
