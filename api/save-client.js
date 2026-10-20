const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
const ANON_KEY     = 'sb_publishable_RReNHAvDRWNst2YTSnAttQ_duV1PJzL';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Use service key if available (bypasses RLS), otherwise fall back to anon key
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ANON_KEY;

  const h = {
    'Authorization': `Bearer ${serviceKey}`,
    'apikey': serviceKey,
    'Content-Type': 'application/json'
  };

  const { action, id, name, phone, email, notes } = req.body || {};
  let referred_by = req.body?.referred_by;

  /* Código de referido: debe existir; se guarda normalizado */
  if (referred_by !== undefined && referred_by !== null && String(referred_by).trim() !== '') {
    referred_by = String(referred_by).trim().toUpperCase();
    try {
      const rr = await fetch(`${SUPABASE_URL}/rest/v1/saved_clients?referral_code=eq.${encodeURIComponent(referred_by)}&select=id&limit=1`, { headers: h });
      const found = await rr.json();
      if (!rr.ok || !found.length) return res.status(400).json({ ok: false, error: 'El código de referido no existe: ' + referred_by });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  } else {
    referred_by = undefined;
  }

  try {
    /* ── LIST ── */
    if (action === 'list') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/saved_clients?select=*&order=name`, { headers: h });
      const d = await r.json();
      if (!r.ok) return res.status(400).json({ ok: false, error: JSON.stringify(d) });
      return res.status(200).json({ ok: true, data: d });
    }

    /* ── CREATE ── */
    if (action === 'create') {
      if (!name) return res.status(400).json({ ok: false, error: 'Nombre requerido.' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/saved_clients`, {
        method: 'POST',
        headers: { ...h, 'Prefer': 'return=representation' },
        body: JSON.stringify({ name, phone: phone || '', email: email || '', notes: notes || '', ...(referred_by ? { referred_by } : {}) })
      });
      const d = await r.json();
      if (!r.ok) return res.status(400).json({ ok: false, error: JSON.stringify(d) });
      return res.status(200).json({ ok: true, data: d[0] || d });
    }

    /* ── UPDATE ── */
    if (action === 'update') {
      if (!id) return res.status(400).json({ ok: false, error: 'ID requerido.' });
      const body = {};
      if (name  !== undefined) body.name  = name;
      if (phone !== undefined) body.phone = phone || '';
      if (email !== undefined) body.email = email || '';
      if (notes !== undefined) body.notes = notes || '';
      if (referred_by) body.referred_by = referred_by;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/saved_clients?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...h, 'Prefer': 'return=minimal' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return res.status(400).json({ ok: false, error: JSON.stringify(d) });
      }
      return res.status(200).json({ ok: true });
    }

    /* ── DELETE ── */
    if (action === 'delete') {
      if (!id) return res.status(400).json({ ok: false, error: 'ID requerido.' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/saved_clients?id=eq.${id}`, {
        method: 'DELETE',
        headers: h
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return res.status(400).json({ ok: false, error: JSON.stringify(d) });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Acción no válida.' });
  } catch (err) {
    console.error('[save-client]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
