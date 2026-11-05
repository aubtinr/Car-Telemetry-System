import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev`, the Vite server (default :5173) proxies API + WebSocket
// calls to the Python backend on :8000, so the browser talks to one origin.
// For production, `npm run build` emits ./dist, which the backend serves itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
