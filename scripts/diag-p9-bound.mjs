// Dump the fully-bound GLSL source glslToRender passes to parseShader — the exact
// text the transpiler line numbers refer to. Usage:
//   npx vite-node scripts/diag-p9-bound.mjs <p9c-file> [target-line]
import { readFileSync } from "node:fs";
import { parseP9c } from "../src/import/p9";
import { glslPreParseSource } from "../src/transpile/glsl";

const [, , path, targetLineArg] = process.argv;
const target = targetLineArg ? parseInt(targetLineArg, 10) : -1;

const raw = readFileSync(path);
const p9 = parseP9c(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), path);
if (!p9.glsl) { console.error("no Shader node"); process.exit(1); }
const bound = glslPreParseSource(p9.glsl);
const lines = bound.split("\n");
console.log(`total: ${lines.length} lines, target ${target}`);
if (target > 0) {
  const from = Math.max(0, target - 6);
  const to = Math.min(lines.length, target + 4);
  for (let i = from; i < to; i++) {
    console.log((i + 1 === target ? "> " : "  ") + String(i + 1).padStart(4) + ": " + lines[i]);
  }
} else {
  for (let i = 0; i < lines.length; i++) console.log(String(i + 1).padStart(4) + ": " + lines[i]);
}
