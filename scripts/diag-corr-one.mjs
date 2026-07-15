// First-divergence dump for one fixture/corpus pair under the validator's
// normalizer. Usage: node scripts/diag-corr-one.mjs "<preset name>" <corpus file>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [name, file] = process.argv.slice(2);
const require2 = createRequire(import.meta.url);
const presets = require2("butterchurn-presets/lib/butterchurnPresets.min.js").getPresets();
const p = presets[name];
if (!p) { console.error("unknown preset:", name); process.exit(1); }

const norm = (s) => String(s ?? "")
  .toLowerCase()
  .replace(/\/\/[^\n]*/g, "")
  .replace(/\bmath\./g, "")
  .replace(/\ba\./g, "")
  .replace(/\bvar\s+/g, "")
  .replace(/([a-z_]\w*)\s*\+=/g, "$1=$1+")
  .replace(/([a-z_]\w*)\s*-=/g, "$1=$1-")
  .replace(/([a-z_]\w*)\s*\*=/g, "$1=$1*")
  .replace(/([a-z_]\w*)\s*\/=/g, "$1=$1/")
  .replace(/(^|[^0-9.])\.(\d)/g, "$10.$2")
  .replace(/[\s`;]+/g, "");

const lines = [];
for (const raw of readFileSync(file, "latin1").split(/\r?\n/)) {
  const m = /^per_frame_(\d+)=(.*)$/.exec(raw.trim());
  if (m) lines[parseInt(m[1], 10) - 1] = m[2];
}
const nc = norm(lines.filter((s) => s !== undefined).join(""));
const nf = norm(p.frame_eqs_str);
console.log("lens", nc.length, nf.length, nc === nf ? "EQUAL" : "");
for (let i = 0; i < Math.min(nc.length, nf.length); i++) {
  if (nc[i] !== nf[i]) {
    console.log("diff @" + i);
    console.log(" c:", nc.slice(Math.max(0, i - 35), i + 45));
    console.log(" f:", nf.slice(Math.max(0, i - 35), i + 45));
    break;
  }
}
