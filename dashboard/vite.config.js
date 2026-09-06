import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/nodes": "http://localhost:8000",
      "/files": "http://localhost:8000",
      "/activity": "http://localhost:8000",
      "/socket.io": {
        target: "http://localhost:8000",
        ws: true,
      },
    },
  },
});
