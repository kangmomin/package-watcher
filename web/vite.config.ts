/// <reference types="vitest/config" />
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// outDir 과 base 는 server·Dockerfile 과의 인터페이스다. 바꾸지 않는다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  build: { outDir: "dist" },
  server: {
    port: 5173,
    proxy: {
      // server 의 기본 HOST 는 127.0.0.1 이다. localhost 는 ::1 로 풀릴 수 있다.
      "/api": "http://127.0.0.1:3000",
      "/mcp": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
