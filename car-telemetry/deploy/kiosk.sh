#!/usr/bin/env bash
# Open the dashboard full-screen once the backend answers. Started on desktop
# login by ~/.config/autostart/telemetry-kiosk.desktop (see install_autostart.sh).
set -u

URL="http://127.0.0.1:8000"

# Already open (e.g. launched twice by the session): nothing to do.
if pgrep -f -- "--kiosk.*127.0.0.1:8000" >/dev/null; then
  exit 0
fi

# Wait up to ~60 s for the backend service after boot.
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "$URL/api/health" && break
  sleep 1
done

# After a power cut Chromium thinks it crashed and shows a "Restore pages?"
# bar; mark the last session as a clean exit so it doesn't.
prefs="$HOME/.config/chromium/Default/Preferences"
if [ -f "$prefs" ]; then
  sed -i -e 's/"exited_cleanly":false/"exited_cleanly":true/' \
         -e 's/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$prefs"
fi

browser="$(command -v chromium-browser || command -v chromium)"

# No --incognito: the dashboard keeps its theme/layout settings in browser storage.
exec "$browser" --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --check-for-update-interval=31536000 \
  "$URL"
