#!/usr/bin/env bash
# Build the React app and place it where the backend serves it (backend/static).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here/frontend"

echo "==> Installing frontend deps (if needed)…"
[ -d node_modules ] || npm install --no-audit --no-fund

echo "==> Building…"
npm run build

echo "==> Copying dist → backend/static…"
rm -rf "$here/backend/static"
cp -r "$here/frontend/dist" "$here/backend/static"

echo "Done. Start the backend and open http://localhost:8000"
