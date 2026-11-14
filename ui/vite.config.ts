import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:9000",
      "/ws": {
        target: "ws://127.0.0.1:9000",
        ws: true
      }
    }
  },
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true
  }
});
