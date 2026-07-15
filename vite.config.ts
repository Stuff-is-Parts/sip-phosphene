import { defineConfig } from "vite";
import { resolve } from "path";

// Multi-page build: player (index) + studio. GitHub Pages serves dist/.
// For a portable one-file studio, use vite.onefile.config.ts (build:portable).
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        studio: resolve(__dirname, "studio.html"),
      },
    },
  },
});
