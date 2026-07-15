// First differing STATEMENT for a pair under the statement-level proof.
// Usage: node scripts/diag-corr-stmt.mjs "<preset name>" <corpus file>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { eelStatements } from "./lib/eel-compare.mjs";

const [name, file] = process.argv.slice(2);
const require2 = createRequire(import.meta.url);
const p = require2("butterchurn-presets/lib/butterchurnPresets.min.js").getPresets()[name];

const lines = [];
for (const raw of readFileSync(file, "latin1").split(/\r?\n/)) {
  const m = /^per_frame_(\d+)=(.*)$/.exec(raw.trim());
  if (m) lines[parseInt(m[1], 10) - 1] = m[2];
}
const sa = eelStatements(lines.filter((s) => s !== undefined).join(""));
const sb = eelStatements(p.frame_eqs_str);
console.log("statement counts:", sa.length, "vs", sb.length);
const n = Math.max(sa.length, sb.length);
for (let i = 0; i < n; i++) {
  const a = sa[i], b = sb[i];
  if (!a || !b || a.lhs !== b.lhs || a.rhs !== b.rhs) {
    console.log(`first diff at statement ${i}:`);
    console.log("  corpus :", JSON.stringify(a));
    console.log("  fixture:", JSON.stringify(b));
    break;
  }
}
