import crypto from 'node:crypto';
import { SUPABASE_URL } from './_credits.js';

/* Público: valida el enlace de un solo uso y deja que el cliente cree su contraseña. */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!KEY) return res.status(500).json({ ok: false, error: 'Configuración incompleta.' });
  const H = { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json' };

  const { action, token, password } = req.body || {};
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) {
    return res.status(400).json({ ok: false, code: 'invalid', error: 'Enlace no válido.' });
  }
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/portal_invites?token_hash=eq.${hash}&select=id,email,expires_at,used_at&limit=1`, { headers: H }
    ).then(r => r.json());
    const inv = Array.isArray(rows) ? rows[0] : null;
    if (!inv)         return res.status(404).json({ ok: false, code: 'invalid', error: 'Este enlace no es válido.' });
    if (inv.used_at)  return res.status(410).json({ ok: false, code: 'used',    error: 'Este enlace ya fue usado.' });
    if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ ok: false, code: 'expired', error: 'Este enlace venció.' });

    /* Nombre para saludar */
    const cl = await fetch(
      `${SUPABASE_URL}/rest/v1/saved_clients?email=ilike.${encodeURIComponent(inv.email)}&select=name&limit=1`, { headers: H }
    ).then(r => r.json()).catch(() => []);
    const name = Array.isArray(cl) && cl[0]?.name ? cl[0].name : '';

    if (action === 'check') return res.status(200).json({ ok: true, email: inv.email, name });

    if (action === 'accept') {
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ ok: false, code: 'weak', error: 'La contraseña debe tener al menos 8 caracteres.' });
      }
      const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=1`, { headers: H }).then(r => r.json());
      const user = (list?.users || []).find(u => (u.email || '').toLowerCase() === inv.email.toLowerCase());
      if (!user || user.app_metadata?.role === 'admin') return res.status(400).json({ ok: false, code: 'invalid', error: 'No se pudo activar esta cuenta.' });

      const up = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT', headers: H, body: JSON.stringify({ password, email_confirm: true })
      });
      if (!up.ok) { const d = await up.json().catch(() => ({})); return res.status(400).json({ ok: false, code: 'weak', error: d?.msg || d?.message || 'No se pudo guardar la contraseña.' }); }

      await fetch(`${SUPABASE_URL}/rest/v1/portal_invites?id=eq.${inv.id}`, {
        method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: new Date().toISOString() })
      });
      return res.status(200).json({ ok: true, email: inv.email });
    }
    return res.status(400).json({ ok: false, error: 'Acción no válida.' });
  } catch (e) {
    console.error('[accept-invite]', e.message);
    return res.status(500).json({ ok: false, error: 'Error del servidor. Intentá de nuevo.' });
  }
}
