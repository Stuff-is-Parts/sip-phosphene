// Structural-conversion report for the MilkDrop corpus: run every .milk
// through the graph importer and report data completeness (equations,
// waves incl. per-point, shapes, shaders, blur levels). Structural
// diagnostic only — fidelity is reference validation (COMPATIBILITY-GOAL.md).
// Usage: npx vite-node scripts/convert-milk-graph.mjs [dir] [limit] [out]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseMilkComplete, milkToGraph } from "../src/import/milk-graph";

const root = process.argv[2] ?? "scenes/projectM/presets-cream-of-the-crop-master";
const limit = parseInt(process.argv[3] ?? "0", 10) || Infinity;
const out = process.argv[4] ?? "docs/milk-graph-conversion.json";

const all = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(".milk")) all.push(p);
  }
})(root);
all.sort();
const step = Math.max(1, Math.floor(all.length / Math.min(limit, all.length)));
const files = [];
for (let i = 0; i < all.length && files.length < limit; i += step) files.push(all[i]);

let ok = 0, failed = 0;
let totWaves = 0, totPerPoint = 0, totShapes = 0, withWarp = 0, withComp = 0, withBlur = 0;
const presets = [];
for (const f of files) {
  const rel = relative(root, f);
  try {
    const parsed = parseMilkComplete(readFileSync(f, "latin1"), rel);
    const { graph, stats } = milkToGraph(parsed);
    ok++;
    totWaves += stats.waves; totPerPoint += stats.wavesWithPerPoint;
    totShapes += stats.shapes;
    if (parsed.warpShader) withWarp++;
    if (parsed.compShader) withComp++;
    if (stats.blurLevels > 0) withBlur++;
    presets.push({ preset: rel, nodes: graph.nodes.length, ...stats,
      warpShader: !!parsed.warpShader, compShader: !!parsed.compShader });
  } catch (err) {
    failed++;
    presets.push({ preset: rel, error: String(err.message).slice(0, 200) });
  }
}

const report = {
  measures: "structural import completeness only — NOT fidelity; see COMPATIBILITY-GOAL.md",
  corpus: root, total: files.length, structurallyImported: ok, failed,
  aggregate: {
    customWaves: totWaves, wavesWithPerPointEquations: totPerPoint,
    customShapes: totShapes, presetsWithWarpShader: withWarp,
    presetsWithCompShader: withComp, presetsUsingBlur: withBlur,
  },
  presets,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`total ${files.length} | imported ${ok} | failed ${failed}`);
console.log(`waves ${totWaves} (with per-point: ${totPerPoint}) | shapes ${totShapes}`);
console.log(`warp shaders ${withWarp} | comp shaders ${withComp} | blur users ${withBlur}`);
console.log(`report: ${out}`);
