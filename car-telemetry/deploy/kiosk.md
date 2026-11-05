# Chromium kiosk on the Pi (notes)

After the backend runs as a service (see `car-telemetry.service`) and the desktop
session is up, launch Chromium full-screen pointing at the local backend.

Autostart entry (`~/.config/autostart/telemetry-kiosk.desktop`):

```ini
[Desktop Entry]
Type=Application
Name=Telemetry Kiosk
Exec=bash -lc 'sleep 5; chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --incognito --check-for-update-interval=31536000 http://127.0.0.1:8000'
X-GNOME-Autostart-enabled=true
```

Notes:
- Use `chromium` instead of `chromium-browser` if that's the binary name on your OS.
- The `sleep 5` gives the backend time to bind the port after boot; raise if needed,
  or gate on the service with a proper systemd user unit.
- Verify touch orientation matches screen rotation; calibrate if a swap is needed.
- Read the panel's **actual** resolution and OS scaling before trusting any layout —
  don't assume 1024×600 or 1280×800 from the 10" diagonal (handoff section 6).
- Local operation needs no Wi-Fi.
