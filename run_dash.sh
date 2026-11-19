# 1. Build the front end
cd ~/car-telemetry && ./scripts/build_frontend.sh

# 2. Start the backend in mock mode
cd ~/car-telemetry/backend
source .venv/bin/activate
TELEM_MOCK=1 TELEM_SERIAL_PORT=/dev/ttyACM0 python3 run.py

# 3. In a new terminal, launch the kiosk
~/car-telemetry/deploy/kiosk.sh
