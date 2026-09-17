import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  server: {
    port: 3100,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    react(),
  ],
});
