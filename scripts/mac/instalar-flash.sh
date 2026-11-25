#!/bin/bash
# Linktodoor · revisión automática de la bodega Flash desde esta Mac.
# Flash (Noblex/Cargotrack) no responde a consultas desde servidores en la nube, así que esta Mac
# la consulta cada hora y marca en el panel los paquetes que ya llegaron.
#
#   Instalar:     bash instalar-flash.sh
#   Desinstalar:  bash instalar-flash.sh --desinstalar
#   Ver registro: open ~/Library/Logs/linktodoor-flash.log
#
# Archivo generado por scripts/mac/build-installer.py — no editar a mano.
set -euo pipefail

LABEL="co.linktodoor.flash"
DIR="$HOME/Library/Application Support/linktodoor-flash"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/linktodoor-flash.log"
SUPABASE_URL="https://opqyskmpdnijhvcbewkf.supabase.co"

if [ "${1:-}" = "--desinstalar" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$DIR"
  echo "✅ Desinstalado. La Mac ya no revisa Flash."
  exit 0
fi

echo "== Linktodoor · revisión automática de Flash =="

# 1) Node.js
NODE="$(command -v node || true)"
[ -z "$NODE" ] && [ -x /opt/homebrew/bin/node ] && NODE=/opt/homebrew/bin/node
[ -z "$NODE" ] && [ -x /usr/local/bin/node ] && NODE=/usr/local/bin/node
if [ -z "$NODE" ]; then
  echo "❌ Falta Node.js. Instalalo desde https://nodejs.org (botón LTS, el instalador .pkg) y volvé a correr este archivo."
  open "https://nodejs.org" 2>/dev/null || true
  exit 1
fi
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "❌ Tu Node.js es muy viejo ($("$NODE" -v)). Instalá la versión LTS desde https://nodejs.org y volvé a correr este archivo."
  exit 1
fi
echo "✓ Node.js $("$NODE" -v)"

# 2) Program files
mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$DIR/warehouses.mjs" <<'__WAREHOUSES_EOF__'
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

/* Flash's server doesn't answer requests from Vercel, so on Vercel Flash is checked by the GitHub
   Action in .github/workflows/check-flash.yml instead. Set FLASH_FROM_VERCEL=1 if that ever changes. */
export const FLASH_ON_VERCEL = process.env.FLASH_FROM_VERCEL === '1';

/* Looks the tracking up in both warehouses, the one the client picked first.
   Returns the patch that marks it received in Miami, or null if neither warehouse has it. */
export async function warehousePatch(trackingNumber, bodega, b2bKey, { flash = true } = {}) {
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
    if (w === 'flash' && flash) {
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
__WAREHOUSES_EOF__
cat > "$DIR/check-flash.mjs" <<'__CHECKFLASH_EOF__'
/* Checks the pre-alerts against the Flash warehouse (Noblex/Cargotrack, 5414) and marks the ones it
   has as received in Miami. Runs on GitHub Actions (.github/workflows/check-flash.yml) because
   Flash's server doesn't answer requests from Vercel.
   Usage: SUPABASE_SERVICE_KEY=... node scripts/check-flash.mjs
          node scripts/check-flash.mjs --test   (only checks that Flash answers, no Supabase) */
import { noblexLookup, warehouseErrors, flashState, resetWarehouseRun } from './warehouses.mjs';

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
__CHECKFLASH_EOF__

# 3) Flash answers from this Mac?
echo "Probando que Flash responde desde esta Mac…"
if ! "$NODE" "$DIR/check-flash.mjs" --test; then
  echo "❌ Flash no respondió desde esta Mac. No se instaló nada que corra solo."
  echo "   Probá de nuevo en unos minutos; si sigue igual, Flash también bloquea esta conexión."
  rm -rf "$DIR"
  exit 1
fi
echo "✓ Flash responde"

# 4) Supabase key (kept only on this Mac, readable only by this user)
KEYFILE="$DIR/supabase-key"
if [ -s "$KEYFILE" ]; then
  echo "✓ Clave de Supabase ya guardada (para cambiarla, desinstalá y volvé a instalar)"
else
  echo
  echo "Pegá la clave 'service_role' de Supabase: la misma que SUPABASE_SERVICE_KEY en Vercel"; echo "(en Supabase: Project Settings → API Keys → Legacy API Keys → service_role → Reveal)."
  echo "No se va a ver mientras la pegás. Después tocá Enter."
  read -rs KEY; echo
  KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$SUPABASE_URL/rest/v1/package_alerts?select=id&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY")"
  if [ "$CODE" != "200" ]; then
    echo "❌ Esa clave no funcionó (Supabase respondió $CODE). Revisá que sea la service_role y volvé a correr este archivo."
    exit 1
  fi
  umask 077
  printf '%s' "$KEY" > "$KEYFILE"
  chmod 600 "$KEYFILE"
  echo "✓ Clave válida y guardada"
fi

# 5) Runner: reads the key, runs the check, notifies when packages arrive
cat > "$DIR/run.sh" <<RUNEOF
#!/bin/bash
LOG="$LOG"
# keep the log small
if [ -f "\$LOG" ] && [ "\$(wc -c < "\$LOG")" -gt 2000000 ]; then tail -n 2000 "\$LOG" > "\$LOG.tmp" && mv "\$LOG.tmp" "\$LOG"; fi
echo "=== \$(date '+%Y-%m-%d %H:%M') ===" >> "\$LOG"
OUT="\$(SUPABASE_SERVICE_KEY="\$(cat "$KEYFILE")" "$NODE" "$DIR/check-flash.mjs" 2>&1)"
STATUS=\$?
echo "\$OUT" >> "\$LOG"
N="\$(printf '%s' "\$OUT" | sed -n 's/^Listo: \([0-9]*\) recibidas.*/\1/p')"
if [ -n "\$N" ] && [ "\$N" -gt 0 ]; then
  osascript -e "display notification \"\$N paquete(s) recibidos en Flash. Revisá Pre-alertas para avisar.\" with title \"Linktodoor\"" >/dev/null 2>&1
fi
exit \$STATUS
RUNEOF
chmod 700 "$DIR/run.sh"

# 6) First run now
echo
echo "Revisando las pre-alertas ahora…"
bash "$DIR/run.sh" || true
tail -n 15 "$LOG"

# 7) Every hour, and when the Mac starts or wakes
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/run.sh</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo
echo "✅ Listo. Esta Mac revisa Flash cada hora mientras esté encendida."
echo "   Registro:     open ~/Library/Logs/linktodoor-flash.log"
echo "   Desinstalar:  bash instalar-flash.sh --desinstalar"
