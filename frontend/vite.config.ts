import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // API_PROXY lets the Docker dev setup point at the backend container
  server: { port: 5173, proxy: { "/api": process.env.API_PROXY ?? "http://127.0.0.1:8000" } },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: { manualChunks: { charts: ["recharts"] } },
    },
  },
});
