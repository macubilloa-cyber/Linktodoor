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

const LOOKBACK_DAYS = 60;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/* Returns the Box2Box package if it is registered at the Consolidada warehouse, else null */
async function box2boxLookup(trackingNumber, apiKey) {
  try {
    const r = await fetch(`https://box2boxcr.us/api/v1/tracking/${encodeURIComponent(trackingNumber)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    });
    if (!r.ok) return null;
    const data = await r.json();
    const pkgs = data?.data?.paquetes || [];
    if (!data?.ok || data?.data?.vacio || !pkgs.length) return null;
    return pkgs[0];
  } catch (e) {
    console.error('[check-trackings] box2box error:', trackingNumber, e.message);
    return null;
  }
}

export default async function handler(req, res) {
  const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const TRACK17_KEY  = process.env.TRACK17_API_KEY;
  const B2B_KEY      = process.env.BOX2BOX_API_KEY;

  if (!SUPABASE_KEY) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_KEY no configurado.' });
  }

  const sbHeaders = { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' };
  const patchAlert = (id, patch) => fetch(`${SUPABASE_URL}/rest/v1/package_alerts?id=eq.${id}`, {
    method: 'PATCH', headers: sbHeaders, body: JSON.stringify(patch)
  });

  /* Recent trackings not yet received in Miami and not set by hand in the panel.
     'entregado' stays in the list: the carrier delivered it, but Box2Box may not have registered it yet. */
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/package_alerts?status=neq.en_bodega&status_manual=not.is.true` +
    `&created_at=gte.${since}&select=id,tracking_number,status`,
    { headers: sbHeaders }
  );
  const trackings = await listRes.json();

  if (!Array.isArray(trackings) || !trackings.length) {
    return res.status(200).json({ ok: true, checked: 0, updated: 0 });
  }

  const now = new Date().toISOString();
  let updated = 0;
  let receivedInMiami = 0;

  /* 1) Bodega Consolidada (Box2Box): if the warehouse has it, it's received in Miami */
  const inWarehouse = new Set();
  if (B2B_KEY) {
    const found = await mapLimit(trackings, 5, t => box2boxLookup(t.tracking_number, B2B_KEY));
    for (let i = 0; i < trackings.length; i++) {
      const pkg = found[i];
      if (!pkg) continue;
      const t = trackings[i];
      inWarehouse.add(t.id);
      const label = (pkg.estadoActual && typeof pkg.estadoActual === 'object')
        ? pkg.estadoActual.label : (pkg.estadoActual || '');
      await patchAlert(t.id, {
        status:          'en_bodega',
        status_es:       'Recibido en Miami',
        last_event:      label ? `Bodega Consolidada: ${label}` : 'Recibido en la bodega Consolidada',
        carrier:         'Bodega Consolidada',
        last_checked_at: now,
        needs_notify:    true
      });
      updated++;
      receivedInMiami++;
    }
  }

  /* 2) The rest: carrier status from 17track (skips ones the carrier already delivered) */
  const pending = trackings.filter(t => !inWarehouse.has(t.id) && t.status !== 'entregado');
  if (TRACK17_KEY && pending.length) {
    const results = {};
    for (let i = 0; i < pending.length; i += 40) {
      const chunk = pending.slice(i, i + 40).map(t => ({ number: t.tracking_number }));
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

    for (const t of pending) {
      const track = results[t.tracking_number];
      if (!track) continue;

      const statusInfo = STATUS_MAP[track.e] || STATUS_MAP[0];
      if (statusInfo.key === t.status) continue;

      await patchAlert(t.id, {
        status:          statusInfo.key,
        status_es:       statusInfo.es,
        last_event:      track.z0?.z  || null,
        last_event_time: track.z0?.a  || null,
        carrier:         track.w1?.b  || null,
        last_checked_at: now,
        needs_notify:    true,
        ...(statusInfo.key === 'entregado' ? { delivered_at: now } : {})
      });
      updated++;
    }
  }

  return res.status(200).json({ ok: true, checked: trackings.length, receivedInMiami, updated });
}
