import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The base path is configurable because judge mode is served from a
 * subdirectory.
 *
 * GitHub Pages publishes a project site at `/<repo>/`, so a build using the
 * default root base emits absolute asset URLs that 404 there. The failure is
 * silent in the worst way: a blank white page with no error a visitor can see.
 * Passing the base at build time keeps local development on `/` while the
 * deployed build knows where it lives.
 */
export default defineConfig({
  base: process.env.SCOPE_BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 5180,
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
