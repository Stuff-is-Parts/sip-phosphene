import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The single portable HTML file is a BUILD OUTPUT of a properly
// structured project — not the project's architecture.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    assetsInlineLimit: 100_000_000,
  },
});
