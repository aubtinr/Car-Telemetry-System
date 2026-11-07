#!/usr/bin/env bash
# One-time Pi setup so power-on goes straight to the dashboard:
#   - backend runs as a systemd service (starts on boot, restarts if it dies),
#   - the desktop logs in automatically and the screen never blanks,
#   - Chromium opens the dashboard full-screen on login.
# Safe to re-run; it overwrites only its own files.
#
# Usage: bash deploy/install_autostart.sh [serial-port]
#   serial-port defaults to the first /dev/serial/by-id/*STM* device, else /dev/ttyACM0.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
user="$(id -un)"

port="${1:-}"
if [ -z "$port" ]; then
  port="$(ls /dev/serial/by-id/*STM* 2>/dev/null | head -n1 || true)"
fi
port="${port:-/dev/ttyACM0}"

if [ ! -x "$here/backend/.venv/bin/python" ]; then
  echo "backend/.venv is missing — set up the backend first (see README)." >&2
  exit 1
fi
if [ ! -f "$here/backend/static/index.html" ]; then
  echo "The UI isn't built — run: bash scripts/build_frontend.sh" >&2
  exit 1
fi

echo "==> Backend service (user: $user, serial port: $port)"
sed -e "s|__USER__|$user|g" -e "s|__DIR__|$here|g" -e "s|__PORT__|$port|g" \
  "$here/deploy/car-telemetry.service" | sudo tee /etc/systemd/system/car-telemetry.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable car-telemetry
sudo systemctl restart car-telemetry

echo "==> Desktop auto-login + no screen blanking"
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_boot_behaviour B4
  sudo raspi-config nonint do_blanking 1
else
  echo "    raspi-config not found; enable desktop auto-login yourself." >&2
fi

echo "==> Kiosk on login"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/telemetry-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Telemetry Kiosk
Exec=bash "$here/deploy/kiosk.sh"
X-GNOME-Autostart-enabled=true
EOF

echo
echo "Done. Reboot to check:  sudo reboot"
echo "Backend logs:           journalctl -u car-telemetry -f"
