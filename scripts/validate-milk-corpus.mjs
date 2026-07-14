// Batch-validate a MilkDrop preset corpus through the real import path.
// Reports parse rate, equation-compile rate, feature frequencies, and
// bucketed compile-error classes with sample presets.
// Usage: vite-node scripts/validate-milk-corpus.mjs -- <presets-root>
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseMilk, milkToScene } from "../src/import/milk";
import { compile } from "../src/core/expr";

const root = process.argv[process.argv.length - 1];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(".milk")) files.push(p);
  }
})(root);

const stats = {
  total: files.length,
  parsed: 0,
  withEquations: 0,
  equationsCompile: 0,
  features: { perPixel: 0, warpShader: 0, compShader: 0, waves: 0, shapes: 0, perFrameInit: 0 },
  initCompileFail: 0,
};
const errorBuckets = new Map(); // message-class -> { count, samples[] }

for (const f of files) {
  let m;
  try {
    m = parseMilk(readFileSync(f, "latin1"), f);
  } catch (err) {
    bucket("PARSE: " + err.message, f);
    continue;
  }
  stats.parsed++;
  if (m.perPixel) stats.features.perPixel++;
  if (m.warpShader) stats.features.warpShader++;
  if (m.compShader) stats.features.compShader++;
  if (m.waves.length) stats.features.waves++;
  if (m.shapes.length) stats.features.shapes++;
  if (m.perFrameInit) stats.features.perFrameInit++;
  if (!m.perFrame) continue;
  stats.withEquations++;
  const { report } = milkToScene(m);
  // core skip = the preset's main equations failed; unit skips (a wave or
  // shape falling back to base values) degrade gracefully and are bucketed
  // separately without failing the preset
  const coreSkip = report.find((r) => r.startsWith("per-frame equations skipped"));
  if (coreSkip) {
    bucket(coreSkip.replace(/at \d+/g, "at N"), f);
  } else {
    stats.equationsCompile++;
    for (const r of report) {
      if (r.includes("skipped")) bucket("UNIT: " + r.replace(/at \d+/g, "at N"), f);
    }
  }
  if (m.perFrameInit) {
    try { compile(m.perFrameInit); } catch { stats.initCompileFail++; }
  }
}

function bucket(msg, file) {
  const key = msg.slice(0, 90);
  const b = errorBuckets.get(key) ?? { count: 0, samples: [] };
  b.count++;
  if (b.samples.length < 3) b.samples.push(relative(root, file));
  errorBuckets.set(key, b);
}

const buckets = [...errorBuckets.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .map(([message, b]) => ({ message, ...b }));

const report = { ...stats, errorBuckets: buckets.slice(0, 40) };
writeFileSync("docs/milk-corpus-report.json", JSON.stringify(report, null, 2));
console.log(`parsed ${stats.parsed}/${stats.total}`);
console.log(`with per-frame equations: ${stats.withEquations}`);
console.log(`equations compile: ${stats.equationsCompile} (${(stats.equationsCompile / Math.max(1, stats.withEquations) * 100).toFixed(1)}%)`);
console.log(`init programs failing separately: ${stats.initCompileFail}`);
console.log("features:", JSON.stringify(stats.features));
console.log("top error classes:");
for (const b of buckets.slice(0, 15)) console.log(`  ${String(b.count).padStart(5)}  ${b.message}  e.g. ${b.samples[0]}`);
