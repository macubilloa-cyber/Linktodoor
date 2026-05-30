export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos.' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_KEY no configurado en Vercel.' });
  }

  const BASE = 'https://opqyskmpdnijhvcbewkf.supabase.co/auth/v1/admin';
  const headers = {
    'Authorization': `Bearer ${serviceKey}`,
    'apikey': serviceKey,
    'Content-Type': 'application/json'
  };

  /* Buscar si el usuario ya existe */
  const listRes = await fetch(`${BASE}/users?email=${encodeURIComponent(email)}&per_page=1`, { headers });
  const listData = await listRes.json();
  const existing = listData?.users?.[0];

  if (existing) {
    /* Actualizar contraseña y confirmar email */
    const upRes = await fetch(`${BASE}/users/${existing.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ password, email_confirm: true })
    });
    const upData = await upRes.json();
    if (upData.error) return res.status(400).json({ ok: false, error: upData.error.message || upData.error });
    return res.status(200).json({ ok: true, action: 'updated' });
  }

  /* Crear usuario nuevo ya confirmado */
  const createRes = await fetch(`${BASE}/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const createData = await createRes.json();
  if (createData.error || createData.msg) {
    return res.status(400).json({ ok: false, error: createData.error?.message || createData.msg || 'Error al crear usuario.' });
  }
  return res.status(200).json({ ok: true, action: 'created' });
}
