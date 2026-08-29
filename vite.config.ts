import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/valhalla": {
        target: "http://127.0.0.1:8002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/valhalla/, ""),
      },
      "/api/evidence": {
        target: "http://127.0.0.1:8003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/evidence/, ""),
      },
    },
  },
});
