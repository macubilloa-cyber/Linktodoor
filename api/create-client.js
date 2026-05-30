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

  /* 1. Intentar crear usuario nuevo ya confirmado */
  const createRes  = await fetch(`${BASE}/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const createData = await createRes.json();

  /* Éxito en creación */
  if (createRes.ok && createData.id) {
    return res.status(200).json({ ok: true, action: 'created' });
  }

  /* Si ya existe, buscar y actualizar */
  const alreadyExists =
    createData?.msg?.includes('already') ||
    createData?.error_description?.includes('already') ||
    createData?.message?.includes('already') ||
    createRes.status === 422;

  if (alreadyExists) {
    /* Listar usuarios y encontrar por email */
    const listRes  = await fetch(`${BASE}/users?per_page=1000&page=1`, { headers });
    const listData = await listRes.json();
    const user = (listData?.users || []).find(u => u.email === email);

    if (!user) {
      return res.status(400).json({ ok: false, error: 'Usuario no encontrado. Intentá de nuevo.' });
    }

    const upRes  = await fetch(`${BASE}/users/${user.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ password, email_confirm: true })
    });
    const upData = await upRes.json();

    if (!upRes.ok) {
      return res.status(400).json({ ok: false, error: upData?.msg || upData?.message || 'Error al actualizar.' });
    }
    return res.status(200).json({ ok: true, action: 'updated' });
  }

  /* Otro error */
  const errMsg = createData?.msg || createData?.message || createData?.error_description || JSON.stringify(createData);
  return res.status(400).json({ ok: false, error: errMsg });
}
