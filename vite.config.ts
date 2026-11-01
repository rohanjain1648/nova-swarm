import { defineConfig } from "vite";

// base: "./" keeps asset URLs relative so the same build works on Vercel,
// Netlify, and GitHub Pages project subpaths without reconfiguration.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
