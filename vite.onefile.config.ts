import { defineConfig } from "vite";
import { resolve } from "path";
import { viteSingleFile } from "vite-plugin-singlefile";

// Portable single-file STUDIO build — a courier format, not the architecture.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    outDir: "dist-portable",
    rollupOptions: { input: resolve(__dirname, "studio.html") },
  },
});
