import { createClient } from '@supabase/supabase-js';

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
    return res.status(500).json({ ok: false, error: 'Configuración incompleta en el servidor.' });
  }

  const sb = createClient(
    'https://opqyskmpdnijhvcbewkf.supabase.co',
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  /* Si ya existe, actualizar contraseña y confirmar */
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const existing = (list?.users || []).find(u => u.email === email);

  if (existing) {
    const { error } = await sb.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true
    });
    if (error) return res.status(400).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, action: 'updated' });
  }

  /* Crear usuario nuevo ya confirmado */
  const { error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error) return res.status(400).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, action: 'created' });
}
