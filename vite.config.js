import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Workbench backend (proxied in dev). Override with WORKBENCH_PORT.
const backend = `http://127.0.0.1:${process.env.WORKBENCH_PORT ?? 4319}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "app"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        // Foyer stays the root entry (/) so the acceptance suite is unaffected.
        main: path.resolve(import.meta.dirname, "index.html"),
        // The Workbench cockpit is a separate entry at /workbench/.
        workbench: path.resolve(import.meta.dirname, "workbench/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/events": { target: backend, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/events": { target: backend, changeOrigin: true },
    },
  },
});
