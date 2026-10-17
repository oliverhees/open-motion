import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = "http://localhost:4317";
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": api, "/projects": api } },
  build: { outDir: "dist", emptyOutDir: true },
});
