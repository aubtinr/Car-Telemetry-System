# Start on boot (Pi kiosk)

One command, after the backend venv is set up and the UI is built:

```bash
bash deploy/install_autostart.sh            # or pass the serial port explicitly
```

It installs the backend as a systemd service (`car-telemetry`), turns on desktop
auto-login, disables screen blanking, and adds
`~/.config/autostart/telemetry-kiosk.desktop`, which runs `deploy/kiosk.sh`:
that waits for the backend, then opens Chromium full-screen on the dashboard.

Day to day:
- Exit the kiosk: **Alt+F4**. Reopen: `bash deploy/kiosk.sh`.
- Backend logs: `journalctl -u car-telemetry -f`; restart: `sudo systemctl restart car-telemetry`.
- After `git pull` + `bash scripts/build_frontend.sh`, restart the service and the
  kiosk (or just reboot).
- Turn it off: `sudo systemctl disable --now car-telemetry` and delete
  `~/.config/autostart/telemetry-kiosk.desktop`.

Notes:
- Chromium runs without `--incognito` on purpose: the dashboard keeps its
  theme/layout/units in browser storage, which incognito wipes on every launch.
- The autostart entry works with the X11 and labwc desktops. On an older
  Bookworm install using **wayfire**, add instead to `~/.config/wayfire.ini`:
  ```ini
  [autostart]
  telemetry_kiosk = bash /home/<you>/Car-Telemetry-System/car-telemetry/deploy/kiosk.sh
  ```
- Verify touch orientation matches screen rotation; calibrate if a swap is needed.
- Local operation needs no Wi-Fi.
