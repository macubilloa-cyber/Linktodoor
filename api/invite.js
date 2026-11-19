import crypto from 'node:crypto';
import { SUPABASE_URL, verifyUser, isAdmin } from './_credits.js';

const SITE = 'https://linktodoor.co';
const DAYS = 7;

/* Panel (admin): crea el acceso del cliente y devuelve un enlace de un solo uso para que él elija su contraseña. */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!KEY) return res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_KEY no configurado en Vercel.' });

  const me = await verifyUser(req);
  if (!me) return res.status(401).json({ ok: false, error: 'Sesión vencida. Salí y volvé a entrar al panel.' });
  if (!isAdmin(me)) return res.status(403).json({ ok: false, error: 'Solo el administrador puede hacer esto.' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Email no válido.' });

  const H = { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json' };
  const ADMIN = `${SUPABASE_URL}/auth/v1/admin`;

  try {
    /* ¿Ya existe el usuario? */
    const list = await fetch(`${ADMIN}/users?per_page=1000&page=1`, { headers: H }).then(r => r.json());
    let user = (list?.users || []).find(u => (u.email || '').toLowerCase() === email);
    if (user?.app_metadata?.role === 'admin') return res.status(403).json({ ok: false, error: 'Ese email es de una cuenta de administrador.' });

    let created = false;
    if (!user) {
      // Contraseña aleatoria que nadie conoce: el cliente define la suya con el enlace.
      const r = await fetch(`${ADMIN}/users`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ email, password: crypto.randomBytes(24).toString('base64url'), email_confirm: true })
      });
      const d = await r.json();
      if (!r.ok || !d.id) return res.status(400).json({ ok: false, error: d?.msg || d?.message || 'No se pudo crear el acceso.' });
      created = true;
    }

    /* Un solo enlace vigente por cliente: se invalidan los anteriores */
    await fetch(`${SUPABASE_URL}/rest/v1/portal_invites?email=eq.${encodeURIComponent(email)}&used_at=is.null`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: new Date().toISOString() })
    });

    const token = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/portal_invites`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ email, token_hash: hash, expires_at: new Date(Date.now() + DAYS * 86400000).toISOString() })
    });
    if (!ins.ok) return res.status(500).json({ ok: false, error: 'No se pudo guardar el enlace. ¿Ya corriste sql/invites.sql en Supabase?' });

    return res.status(200).json({ ok: true, created, days: DAYS, url: `${SITE}/mi-cuenta?invite=${token}` });
  } catch (e) {
    console.error('[invite]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
