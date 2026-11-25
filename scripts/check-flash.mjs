/* Checks the pre-alerts against the Flash warehouse (Noblex/Cargotrack, 5414) and marks the ones it
   has as received in Miami. Runs on GitHub Actions (.github/workflows/check-flash.yml) because
   Flash's server doesn't answer requests from Vercel.
   Usage: SUPABASE_SERVICE_KEY=... node scripts/check-flash.mjs
          node scripts/check-flash.mjs --test   (only checks that Flash answers, no Supabase) */
import { noblexLookup, warehouseErrors, flashState, resetWarehouseRun } from '../api/_warehouses.js';

const SUPABASE_URL  = 'https://opqyskmpdnijhvcbewkf.supabase.co';
const LOOKBACK_DAYS = 60;
const TEST_TRACKING = 'GFUS01084024072194';

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

resetWarehouseRun();

if (process.argv.includes('--test')) {
  const t0 = Date.now();
  const info = await noblexLookup(TEST_TRACKING);
  console.log(`Flash ${TEST_TRACKING} (${Date.now() - t0} ms):`, info ? info.summary : 'no encontrado', warehouseErrors);
  process.exit(warehouseErrors.length ? 1 : 0);
}

const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) {
  console.error('Falta el secret SUPABASE_SERVICE_KEY en GitHub (Settings → Secrets and variables → Actions).');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json' };

/* Same list as api/check-trackings.js, working whether or not the optional columns exist */
const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
let alerts = null, listError = '';
for (const a of [
  { manual: true,  fields: 'id,tracking_number,bodega' },
  { manual: true,  fields: 'id,tracking_number' },
  { manual: false, fields: 'id,tracking_number,bodega' },
  { manual: false, fields: 'id,tracking_number' }
]) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/package_alerts?status=neq.en_bodega` +
    (a.manual ? '&status_manual=not.is.true' : '') + `&created_at=gte.${since}&select=${a.fields}`, { headers });
  if (r.ok) { alerts = await r.json(); break; }
  listError = `HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`;
}
if (!Array.isArray(alerts)) {
  console.error('No se pudo leer package_alerts:', listError);
  process.exit(1);
}

/* Flash ones first, then the rest (clients sometimes pick the wrong bodega) */
alerts.sort((x, y) => (y.bodega === 'flash') - (x.bodega === 'flash'));
console.log(`Revisando ${alerts.length} pre-alertas en Flash…`);

const hits = await mapLimit(alerts, 4, t => noblexLookup(t.tracking_number));

const patch = async (id, body) => {
  let r;
  for (const drop of [null, 'last_event_time', 'bodega']) {
    if (drop) { if (!(drop in body)) continue; const { [drop]: _omit, ...rest } = body; body = rest; }
    r = await fetch(`${SUPABASE_URL}/rest/v1/package_alerts?id=eq.${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (r.ok) return r;
    console.error(`  patch ${id} falló (${r.status}): ${await r.text()}`);
  }
  return r;
};

const now = new Date().toISOString();
let updated = 0, failed = 0;
for (let i = 0; i < alerts.length; i++) {
  const info = hits[i];
  if (!info) continue;
  const t = alerts[i];
  const r = await patch(t.id, {
    status:          'en_bodega',
    status_es:       'Recibido en Miami',
    last_event:      `Bodega Flash: ${info.summary}`,
    last_event_time: info.receivedAt,
    carrier:         'Bodega Flash',
    last_checked_at: now,
    needs_notify:    true,
    ...('bodega' in t ? { bodega: 'flash' } : {})
  });
  if (r.ok) { updated++; console.log(`  ✅ ${t.tracking_number} → ${info.summary}`); }
  else failed++;
}

console.log(`Listo: ${updated} recibidas en Flash, ${failed} no se pudieron guardar.`);
if (warehouseErrors.length) console.error('Problemas con Flash:\n  ' + warehouseErrors.join('\n  '));
/* Red X in GitHub if Flash didn't answer or Supabase rejected updates */
process.exit(flashState.disabled || failed ? 1 : 0);
