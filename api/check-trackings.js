const STATUS_MAP = {
  0:  { key: 'sin_datos',     es: 'Sin datos aún' },
  10: { key: 'info_recibida', es: 'Información recibida' },
  20: { key: 'en_transito',   es: 'En tránsito' },
  25: { key: 'para_entrega',  es: 'En camino para entrega' },
  30: { key: 'entregado',     es: 'Entregado' },
  35: { key: 'recogido',      es: 'Recogido en sucursal' },
  40: { key: 'sin_actividad', es: 'Sin actividad reciente' },
  50: { key: 'no_entregado',  es: 'No entregado' },
  60: { key: 'excepcion',     es: 'Excepción en el envío' }
};

export default async function handler(req, res) {
  const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const TRACK17_KEY  = process.env.TRACK17_API_KEY;

  if (!SUPABASE_KEY) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_KEY no configurado.' });
  }
  if (!TRACK17_KEY) {
    return res.status(200).json({ ok: false, note: 'TRACK17_API_KEY no configurado. Nada que revisar.' });
  }

  /* Fetch all non-delivered trackings */
  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/package_alerts?status=neq.entregado&select=id,tracking_number,status`,
    { headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY } }
  );
  const trackings = await listRes.json();

  if (!Array.isArray(trackings) || !trackings.length) {
    return res.status(200).json({ ok: true, checked: 0, updated: 0 });
  }

  /* Batch query 17track (max 40 per request) */
  const results = {};
  for (let i = 0; i < trackings.length; i += 40) {
    const chunk = trackings.slice(i, i + 40).map(t => ({ number: t.tracking_number }));
    try {
      const r = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
        method: 'POST',
        headers: { '17token': TRACK17_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk)
      });
      const data = await r.json();
      for (const item of (data?.data?.accepted || [])) {
        results[item.number] = item.track;
      }
    } catch (e) {
      console.error('17track gettrackinfo error:', e);
    }
  }

  /* Update each tracking that changed status */
  let updated = 0;
  for (const t of trackings) {
    const track = results[t.tracking_number];
    if (!track) continue;

    const statusCode = track.e;
    const statusInfo = STATUS_MAP[statusCode] || STATUS_MAP[0];

    if (statusInfo.key === t.status) continue;

    const patch = {
      status:          statusInfo.key,
      status_es:       statusInfo.es,
      last_event:      track.z0?.z  || null,
      last_event_time: track.z0?.a  || null,
      carrier:         track.w1?.b  || null,
      last_checked_at: new Date().toISOString(),
      needs_notify:    true,
      ...(statusInfo.key === 'entregado' ? { delivered_at: new Date().toISOString() } : {})
    };

    await fetch(`${SUPABASE_URL}/rest/v1/package_alerts?id=eq.${t.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(patch)
    });
    updated++;
  }

  return res.status(200).json({ ok: true, checked: trackings.length, updated });
}
