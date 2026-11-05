# Raw frame contract (STM32 → Pi) — CONFIRM WITH FIRMWARE AUTHOR

The STM32 forwards **raw, untranslated** OBD-II responses. The Pi decodes them.
This is the shape the backend currently expects. If the firmware differs, change
only `backend/app/obd.py` (the `PIDS` table and/or `parse_raw_frame`).

## Transport
- Newline-delimited JSON (NDJSON): one compact UTF-8 object per line, terminated by
  a single `\n` (0x0A). A trailing `\r` is tolerated. Keep each line < 2048 bytes.
- 115200 baud, 8 data bits, no parity, 1 stop bit, no flow control.
- STM32 → Pi only in v1.

## Object

```json
{"type":"obd_raw","v":1,"seq":1042,"uptime_ms":208400,
 "pids":{"0C":"218C","0D":"30","05":"7F","10":"0280","11":"38","14":"6F80"},
 "unsupported":[],
 "no_response":[]}
```

| Key | Meaning |
|-----|---------|
| `type` | literal `"obd_raw"` |
| `v` | raw schema version, integer `1` |
| `seq` | unsigned 32-bit counter, +1 per frame, wraps mod 2³² |
| `uptime_ms` | unsigned 32-bit STM tick count since boot (a drop ⇒ reboot) |
| `pids` | map of **Mode-01 PID (2 hex chars) → response DATA bytes as a hex string** (A, B, …; no mode/pid echo, no spaces). Only PIDs that answered this cycle appear. |
| `unsupported` | *(optional)* PIDs the ECU reported as unsupported ⇒ shown as "unsupported", not 0 |
| `no_response` | *(optional)* PIDs polled but silent this cycle ⇒ keep last value, let age grow |

A PID absent from every frame so far is treated as "never seen" (value/age null).

## The six PIDs and the formulas the Pi applies (SAE J1979, Mode 01)

| PID | Field | Bytes | Formula | Unit |
|-----|-------|-------|---------|------|
| `0C` | rpm | A,B | ((A·256)+B)/4 | rpm |
| `0D` | speed_kmh | A | A | km/h |
| `05` | coolant_c | A | A−40 | °C |
| `10` | maf_g_s | A,B | ((A·256)+B)/100 | g/s |
| `11` | throttle_pct | A | A·100/255 | % |
| `14` | o2_v | A,(B) | A/200 | V (Bank 1, Sensor 1; B = STFT, unused) |

Worked example — `"0C":"218C"` → ((0x21·256)+0x8C)/4 = 2147 rpm.

## If the firmware does something different
- **Sends decoded values already** → bypass `parse_raw_frame`; map fields straight through.
- **Echoes the mode byte** (e.g. `"410C218C"`) → strip the first two bytes before decode.
- **Different key/packing** (array, CSV, per-PID objects with status) → adjust
  `parse_raw_frame`; nothing downstream (state machine, API, UI) needs to change.
- **Wideband O₂** → do not relabel it as PID 14 voltage; add a distinct field.
