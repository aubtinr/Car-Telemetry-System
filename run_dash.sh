# 1. Build the front end
cd ~/Car-Telemetry-System/car-telemetry && ./scripts/build_frontend.sh

# 2. Start the backend in mock mode
cd ~/Car-Telemetry-System/car-telemetry/backend
source .venv/bin/activate
TELEM_MOCK=1 TELEM_SERIAL_PORT=/dev/ttyACM0 python3 run.py

# 3. In a new terminal, launch the kiosk
~/Car-Telemetry-System/car-telemetry/deploy/kiosk.sh
