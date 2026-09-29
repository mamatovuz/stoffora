import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  server: { port: 3000, proxy: { "/api": "http://localhost:4000" } },
  build: { outDir: "dist" },
});
