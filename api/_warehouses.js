/* Warehouse lookups shared by check-trackings (cron) and add-tracking (at pre-alert time).
   Files starting with _ are not exposed as API routes by Vercel. */

const TIMEOUT_MS = 8000;

/* Problems talking to the warehouses during the current run (reported by check-trackings) */
export const warehouseErrors = [];
/* If Flash keeps failing (down, refusing), stop asking it for the rest of the run so the run doesn't time out */
export const flashState = { failures: 0, disabled: false };
const MAX_FLASH_FAILURES = 3;
export function resetWarehouseRun() {
  warehouseErrors.length = 0;
  flashState.failures = 0;
  flashState.disabled = false;
}

const noteError = (where, tracking, msg) => {
  if (where === 'Flash' && ++flashState.failures >= MAX_FLASH_FAILURES && !flashState.disabled) {
    flashState.disabled = true;
    warehouseErrors.push(`Flash falló ${MAX_FLASH_FAILURES} veces seguidas: se dejó de consultar en esta revisión`);
  }
  console.error(`[warehouses] ${where} error:`, tracking, msg);
  if (warehouseErrors.length < 20) warehouseErrors.push(`${where} ${tracking}: ${msg}`);
};
const norm = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* The warehouses search by partial match ("123" returns someone else's package), so only accept
   the result if it is the same tracking. Allows a prefix/suffix (e.g. USPS 420+ZIP barcodes). */
export function sameTracking(ours, theirs) {
  const a = norm(ours), b = norm(theirs);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 10 && (a.endsWith(b) || b.endsWith(a));
}

/* Returns the Box2Box package if it is registered at the Consolidada warehouse, else null */
export async function box2boxLookup(trackingNumber, apiKey) {
  try {
    const r = await fetch(`https://box2boxcr.us/api/v1/tracking/${encodeURIComponent(trackingNumber)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    /* 404 = not in the warehouse; anything else is a real problem */
    if (!r.ok) { if (r.status !== 404) noteError('Consolidada', trackingNumber, `HTTP ${r.status}`); return null; }
    const data = await r.json();
    const pkgs = data?.data?.paquetes || [];
    if (!data?.ok || data?.data?.vacio || !pkgs.length) return null;
    /* Only the package that really is this tracking */
    const ours = norm(trackingNumber);
    return pkgs.find(p => norm(JSON.stringify(p)).includes(ours)) || null;
  } catch (e) {
    noteError('Consolidada', trackingNumber, e.message);
    return null;
  }
}

/* Returns { summary, receivedAt } if the tracking is registered at the Flash warehouse (Noblex/Cargotrack, bodega 5414), else null.
   Uses the public search at /m/track.asp, which needs no login. */
export async function noblexLookup(trackingNumber) {
  if (flashState.disabled) return null;
  try {
    const r = await fetch('https://noblex.cargotrack.net/m/track.asp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ track: trackingNumber, action2: 'process' }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!r.ok) { noteError('Flash', trackingNumber, `HTTP ${r.status}`); return null; }
    const html = new TextDecoder('iso-8859-1').decode(await r.arrayBuffer());
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const m = text.match(/Searching for\s+\S+\s+(.*?)\s+Login\s+Tracking\s+Settings/i);
    if (!m) { noteError('Flash', trackingNumber, 'respuesta inesperada: ' + text.slice(0, 120)); return null; }
    const result = m[1].trim();
    if (!result || /NOT FOUND/i.test(result)) return null;
    /* Pre-alerted at the warehouse is not physically received yet */
    if (/^PRE-?ALERTED\b/i.test(result)) return null;
    /* "... Received on <date> at <time> AM <WH> <tracking> 1 piece(s) ..." — must be our tracking */
    const shown = result.match(/(?:AM|PM)\s+\d{3,}\s+(\S+)\s+\d+\s+piece\(s\)/i);
    if (!shown || !sameTracking(trackingNumber, shown[1])) return null;

    /* e.g. "IN TRANSIT Received on 11/20/2026 at 10:43:00 AM 2348099 gfus... 1 piece(s) with 1 lbs Tracking Events Recibido 11/20/2026 10:45:54 AM" */
    const rec    = result.match(/Received on\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+at\s+(\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)/i);
    const wh     = result.match(/(?:AM|PM)\s+(\d{5,})\s/i);
    const pieces = result.match(/(\d+)\s+piece\(s\)\s+with\s+([\d.]+)\s*lbs/i);
    const parts = [];
    if (rec)    parts.push(`recibido ${rec[2]}/${rec[1]}/${rec[3]} ${rec[4]} ${rec[5].toUpperCase()}`);
    if (wh)     parts.push(`WH ${wh[1]}`);
    if (pieces) parts.push(`${pieces[1]} pieza(s), ${pieces[2]} lbs`);
    const summary = parts.length ? parts.join(' · ') : result.slice(0, 200);
    const receivedAt = rec
      ? `${rec[3]}-${rec[1].padStart(2, '0')}-${rec[2].padStart(2, '0')} ${rec[4]} ${rec[5].toUpperCase()}`
      : null;
    return { summary, receivedAt };
  } catch (e) {
    noteError('Flash', trackingNumber, e.message);
    return null;
  }
}

/* Looks the tracking up in both warehouses, the one the client picked first.
   Returns the patch that marks it received in Miami, or null if neither warehouse has it. */
export async function warehousePatch(trackingNumber, bodega, b2bKey) {
  const order = bodega === 'flash' ? ['flash', 'consolidada'] : ['consolidada', 'flash'];
  for (const w of order) {
    if (w === 'consolidada' && b2bKey) {
      const pkg = await box2boxLookup(trackingNumber, b2bKey);
      if (pkg) {
        const label = (pkg.estadoActual && typeof pkg.estadoActual === 'object')
          ? pkg.estadoActual.label : (pkg.estadoActual || '');
        return {
          status:     'en_bodega',
          status_es:  'Recibido en Miami',
          last_event: label ? `Bodega Consolidada: ${label}` : 'Recibido en la bodega Consolidada',
          carrier:    'Bodega Consolidada',
          bodega:     'consolidada'
        };
      }
    }
    if (w === 'flash') {
      const info = await noblexLookup(trackingNumber);
      if (info) {
        return {
          status:          'en_bodega',
          status_es:       'Recibido en Miami',
          last_event:      `Bodega Flash: ${info.summary}`,
          last_event_time: info.receivedAt,
          carrier:         'Bodega Flash',
          bodega:          'flash'
        };
      }
    }
  }
  return null;
}
