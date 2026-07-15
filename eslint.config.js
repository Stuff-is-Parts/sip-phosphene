import js from "@eslint/js";
import ts from "typescript-eslint";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly", process: "readonly", URL: "readonly",
        setTimeout: "readonly",
        // page.evaluate callbacks run in the browser via puppeteer
        navigator: "readonly",
        window: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": ["error", "smart"],
    },
  },
  { ignores: ["dist/", "dist-portable/", "node_modules/", "vite.config.ts", "vite.onefile.config.ts", "docs/evidence/"] },
);
