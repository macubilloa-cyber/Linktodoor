/* Warehouse lookups shared by check-trackings (cron) and add-tracking (at pre-alert time).
   Files starting with _ are not exposed as API routes by Vercel. */

/* Returns the Box2Box package if it is registered at the Consolidada warehouse, else null */
export async function box2boxLookup(trackingNumber, apiKey) {
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

/* Returns { summary, receivedAt } if the tracking is registered at the Flash warehouse (Noblex/Cargotrack, bodega 5414), else null.
   Uses the public search at /m/track.asp, which needs no login. */
export async function noblexLookup(trackingNumber) {
  try {
    const r = await fetch('https://noblex.cargotrack.net/m/track.asp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ track: trackingNumber, action2: 'process' }).toString()
    });
    if (!r.ok) return null;
    const html = new TextDecoder('iso-8859-1').decode(await r.arrayBuffer());
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const m = text.match(/Searching for\s+\S+\s+(.*?)\s+Login\s+Tracking\s+Settings/i);
    const result = (m ? m[1] : '').trim();
    if (!result || /NOT FOUND/i.test(result)) return null;

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
    console.error('[check-trackings] noblex error:', trackingNumber, e.message);
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
