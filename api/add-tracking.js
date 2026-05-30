export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_KEY) {
    return res.status(500).json({ ok: false, error: 'Configuración incompleta.' });
  }

  /* Verify Supabase JWT */
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ ok: false, error: 'No autorizado.' });

  const userRes  = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ ok: false, error: 'Sesión inválida.' });
  const userData = await userRes.json();
  const userEmail = userData.email;
  if (!userEmail) return res.status(401).json({ ok: false, error: 'Sesión inválida.' });

  const { tracking_number, description } = req.body || {};
  if (!tracking_number) {
    return res.status(400).json({ ok: false, error: 'Número de tracking requerido.' });
  }

  const trackingNum = tracking_number.trim().toUpperCase();

  /* Look up client name from saved_clients */
  let clientName = null;
  try {
    const clientRes  = await fetch(
      `${SUPABASE_URL}/rest/v1/saved_clients?email=eq.${encodeURIComponent(userEmail)}&select=name&limit=1`,
      { headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY } }
    );
    const clientData = await clientRes.json();
    if (Array.isArray(clientData) && clientData[0]) clientName = clientData[0].name;
  } catch {}

  /* Register with 17track if API key is configured */
  const TRACK17_KEY = process.env.TRACK17_API_KEY;
  if (TRACK17_KEY) {
    try {
      await fetch('https://api.17track.net/track/v2.2/register', {
        method: 'POST',
        headers: { '17token': TRACK17_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ number: trackingNum }])
      });
    } catch (e) {
      console.error('17track register error:', e);
    }
  }

  /* Insert into Supabase */
  const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/package_alerts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      user_email:      userEmail,
      client_name:     clientName,
      tracking_number: trackingNum,
      description:     description?.trim() || null,
      status:          'registrado',
      status_es:       'Registrado'
    })
  });

  if (!sbRes.ok) {
    return res.status(400).json({ ok: false, error: 'Error al guardar el tracking.' });
  }

  return res.status(200).json({ ok: true });
}
