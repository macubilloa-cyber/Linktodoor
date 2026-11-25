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
@@WAREHOUSES@@
__WAREHOUSES_EOF__
cat > "$DIR/check-flash.mjs" <<'__CHECKFLASH_EOF__'
@@CHECKFLASH@@
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
