import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  envDir: path.resolve(__dirname, "../../"),
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.resolve(__dirname, "../../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom")
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/auth": "http://127.0.0.1:4000",
      "/alerts": "http://127.0.0.1:4000",
      "/customers": "http://127.0.0.1:4000",
      "/pricing": "http://127.0.0.1:4000",
      "/jobber": "http://127.0.0.1:4000",
      "/management": "http://127.0.0.1:4000",
      "/sites": "http://127.0.0.1:4000",
      "/history": "http://127.0.0.1:4000",
      "/tank-information": "http://127.0.0.1:4000",
      "/allied-transactions": "http://127.0.0.1:4000",
      "/ebols": "http://127.0.0.1:4000",
      "/market": "http://127.0.0.1:4000",
      "/health": "http://127.0.0.1:4000"
    },
    fs: {
      allow: [path.resolve(__dirname, "..")]
    }
  }
});
