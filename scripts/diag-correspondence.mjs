// Count reference-fixture <-> corpus same-source proofs under the
// conversion-aware normalizer used by validate-milk.mjs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require2 = createRequire(import.meta.url);
const presets = require2("butterchurn-presets/lib/butterchurnPresets.min.js").getPresets();

import { eelProofTier } from "./lib/eel-compare.mjs";

const files = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".milk")) files.push(p);
  }
})("scenes/projectM/presets-cream-of-the-crop-master");
const nameNorm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const byName = new Map(files.map((f) => [nameNorm(f.replace(/^.*[\\/]/, "").replace(/\.milk$/i, "")), f]));

const perFrame = (text) => {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^per_frame_(\d+)=(.*)$/.exec(raw.trim());
    if (m) lines[parseInt(m[1], 10) - 1] = m[2];
  }
  return lines.filter((s) => s !== undefined).join("");
};

let proven = 0;
const unprovenList = [];
for (const [name, p] of Object.entries(presets)) {
  const f = byName.get(nameNorm(name));
  if (!f) continue;
  const c = perFrame(readFileSync(f, "latin1"));
  if (eelProofTier(c, p.frame_eqs_str) > 0) proven++;
  else unprovenList.push(name);
}
console.log(`proven: ${proven} | unproven: ${unprovenList.length}`);
unprovenList.slice(0, 6).forEach((n) => console.log("  unproven:", n));
