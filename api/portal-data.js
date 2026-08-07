const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
const ANON_KEY     = 'sb_publishable_RReNHAvDRWNst2YTSnAttQ_duV1PJzL';

async function verifyJWT(token, serviceKey) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': serviceKey }
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d?.email ? d : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ANON_KEY;
  const h = { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' };

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ ok: false, error: 'No autorizado.' });

  const user = await verifyJWT(token, SERVICE_KEY);
  if (!user) return res.status(401).json({ ok: false, error: 'Sesión inválida.' });

  const userEmail = user.email;
  const { action, tracking_id, phone, address } = req.body || {};

  try {
    /* ── LOAD: client profile + orders + trackings ── */
    if (action === 'load') {
      const clientResp = await fetch(
        `${SUPABASE_URL}/rest/v1/saved_clients?email=eq.${encodeURIComponent(userEmail)}&limit=1`,
        { headers: h }
      );
      const clientData = await clientResp.json();
      const client = clientData?.[0] || null;

      let lines = [];
      if (client?.name) {
        const linesResp = await fetch(
          `${SUPABASE_URL}/rest/v1/carga_clients?client_name=ilike.${encodeURIComponent(client.name)}&select=*,cargas(reference,date,status),packages(*)&order=created_at.desc`,
          { headers: h }
        );
        const linesData = await linesResp.json();
        lines = Array.isArray(linesData) ? linesData : [];
      }

      const trackResp = await fetch(
        `${SUPABASE_URL}/rest/v1/package_alerts?user_email=eq.${encodeURIComponent(userEmail)}&order=created_at.desc`,
        { headers: h }
      );
      const trackData = await trackResp.json();
      const trackings = Array.isArray(trackData) ? trackData : [];

      return res.status(200).json({ ok: true, client, lines, trackings });
    }

    /* ── LOAD TRACKINGS ONLY ── */
    if (action === 'load-trackings') {
      const trackResp = await fetch(
        `${SUPABASE_URL}/rest/v1/package_alerts?user_email=eq.${encodeURIComponent(userEmail)}&order=created_at.desc`,
        { headers: h }
      );
      const trackData = await trackResp.json();
      return res.status(200).json({ ok: true, trackings: Array.isArray(trackData) ? trackData : [] });
    }

    /* ── SAVE PROFILE ── */
    if (action === 'save-profile') {
      const clientResp = await fetch(
        `${SUPABASE_URL}/rest/v1/saved_clients?email=eq.${encodeURIComponent(userEmail)}&select=id&limit=1`,
        { headers: h }
      );
      const clientData = await clientResp.json();
      const client = clientData?.[0];
      if (!client) return res.status(400).json({ ok: false, error: 'Perfil no encontrado. Contactá al soporte.' });

      const r = await fetch(`${SUPABASE_URL}/rest/v1/saved_clients?id=eq.${client.id}`, {
        method: 'PATCH',
        headers: { ...h, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ phone: phone || '', notes: address || '' })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return res.status(400).json({ ok: false, error: JSON.stringify(d) });
      }
      return res.status(200).json({ ok: true });
    }

    /* ── DELETE TRACKING ── */
    if (action === 'delete-tracking') {
      if (!tracking_id) return res.status(400).json({ ok: false, error: 'ID requerido.' });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/package_alerts?id=eq.${tracking_id}&user_email=eq.${encodeURIComponent(userEmail)}`,
        { method: 'DELETE', headers: h }
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return res.status(400).json({ ok: false, error: JSON.stringify(d) });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Acción no válida.' });
  } catch (err) {
    console.error('[portal-data]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
