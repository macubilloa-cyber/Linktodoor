import { warehousePatch, warehouseErrors, resetWarehouseRun } from './_warehouses.js';

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

export default async function handler(req, res) {
  /* Stop starting new warehouse lookups after this, so the run always answers before Vercel's 60s limit */
  const deadline = Date.now() + 40000;
  const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const TRACK17_KEY  = process.env.TRACK17_API_KEY;
  const B2B_KEY      = process.env.BOX2BOX_API_KEY;

  if (!SUPABASE_KEY) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_KEY no configurado.' });
  }

  const sbHeaders = { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' };
  const rawPatch = (id, patch) => fetch(`${SUPABASE_URL}/rest/v1/package_alerts?id=eq.${id}`, {
    method: 'PATCH', headers: sbHeaders, body: JSON.stringify(patch)
  });
  /* If an optional column (last_event_time, bodega) is missing or rejects the value, save the rest anyway */
  const patchAlert = async (id, patch) => {
    let r = await rawPatch(id, patch);
    for (const col of ['last_event_time', 'bodega']) {
      if (r.ok || !(col in patch)) continue;
      console.error(`[check-trackings] patch failed, retrying without ${col}:`, r.status, await r.text());
      const { [col]: _omit, ...rest } = patch;
      patch = rest;
      r = await rawPatch(id, patch);
    }
    return r;
  };

  /* Recent trackings not yet received in Miami and not set by hand in the panel.
     'entregado' stays in the list: the carrier delivered it, but Box2Box may not have registered it yet. */
  /* ?tracking=XXX checks just that one (panel "Revisar ahora" on a single row / debugging) */
  const onlyTracking = String(req.query?.tracking || '').trim().toUpperCase();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  /* Works whether or not the optional columns exist yet (supabase/prealertas-manual.sql, prealertas-bodega.sql) */
  const attempts = [
    { manual: true,  fields: 'id,tracking_number,status,bodega' },
    { manual: true,  fields: 'id,tracking_number,status' },
    { manual: false, fields: 'id,tracking_number,status,bodega' },
    { manual: false, fields: 'id,tracking_number,status' }
  ];
  let trackings = null;
  let listError = '';
  for (const a of attempts) {
    const url = `${SUPABASE_URL}/rest/v1/package_alerts?status=neq.en_bodega` +
      (a.manual ? '&status_manual=not.is.true' : '') +
      `&created_at=gte.${since}&select=${a.fields}` +
      (onlyTracking ? `&tracking_number=eq.${encodeURIComponent(onlyTracking)}` : '');
    const r = await fetch(url, { headers: sbHeaders });
    if (r.ok) { trackings = await r.json(); break; }
    listError = `HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`;
    console.error('[check-trackings] list failed:', a, listError);
  }
  if (!Array.isArray(trackings)) {
    return res.status(500).json({ ok: false, error: 'No se pudo leer package_alerts en Supabase. ' + listError });
  }

  if (!trackings.length) {
    return res.status(200).json({ ok: true, checked: 0, receivedInMiami: 0, updated: 0, found: [], failed: [], warehouseErrors: [] });
  }

  const now = new Date().toISOString();
  resetWarehouseRun();
  const skippedIds = new Set();
  let updated = 0;
  let receivedInMiami = 0;

  /* 1) Warehouses: search both, the bodega the client picked first (they sometimes pick the wrong one) */
  const inWarehouse = new Set();
  const found = [];
  const failed = [];
  const hits = await mapLimit(trackings, 6, t => {
    if (Date.now() > deadline) { skippedIds.add(t.id); return null; }
    return warehousePatch(t.tracking_number, t.bodega, B2B_KEY);
  });
  for (let i = 0; i < trackings.length; i++) {
    const hit = hits[i];
    if (!hit) continue;
    const t = trackings[i];
    inWarehouse.add(t.id);
    const { bodega, ...rest } = hit;
    const patch = {
      ...rest,
      last_checked_at: now,
      needs_notify:    true,
      ...(t.bodega === undefined ? {} : { bodega })
    };
    const r = await patchAlert(t.id, patch);
    if (!r.ok) {
      const err = await r.text();
      console.error('[check-trackings] patch failed:', t.tracking_number, r.status, err);
      failed.push({ tracking: t.tracking_number, status: r.status, error: err.slice(0, 200) });
      continue;
    }
    found.push({ tracking: t.tracking_number, bodega, event: rest.last_event });
    updated++;
    receivedInMiami++;
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

      const r = await patchAlert(t.id, {
        status:          statusInfo.key,
        status_es:       statusInfo.es,
        last_event:      track.z0?.z  || null,
        last_event_time: track.z0?.a  || null,
        carrier:         track.w1?.b  || null,
        last_checked_at: now,
        needs_notify:    true,
        ...(statusInfo.key === 'entregado' ? { delivered_at: now } : {})
      });
      if (!r.ok) {
        const err = await r.text();
        console.error('[check-trackings] 17track patch failed:', t.tracking_number, r.status, err);
        failed.push({ tracking: t.tracking_number, status: r.status, error: err.slice(0, 200) });
        continue;
      }
      updated++;
    }
  }

  /* Mark every checked one as checked today, so the panel shows it was looked at */
  const ids = trackings.map(t => t.id).filter(id => !inWarehouse.has(id) && !skippedIds.has(id));
  for (let i = 0; i < ids.length; i += 100) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/package_alerts?id=in.(${ids.slice(i, i + 100).join(',')})`, {
      method: 'PATCH', headers: sbHeaders, body: JSON.stringify({ last_checked_at: now })
    });
    if (!r.ok) console.error('[check-trackings] last_checked_at failed:', r.status, await r.text());
  }

  return res.status(200).json({
    ok: true, checked: trackings.length - skippedIds.size, skipped: skippedIds.size, receivedInMiami, updated, found, failed, warehouseErrors,
    keys: { consolidada: !!B2B_KEY, track17: !!TRACK17_KEY }
  });
}
