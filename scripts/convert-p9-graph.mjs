// SOURCE-NODE DISPOSITION report for the Plane9 corpus: run every .p9c
// through the graph importer and report, per scene, how each source node
// was dispositioned (lowered / consumed-by / unsupported). "Disposition-
// clean" means every node has a disposition and none is currently labeled
// unsupported — it does NOT mean executable structural completeness
// (connections and required behaviors are not yet proven executable) and
// it is NOT fidelity (COMPATIBILITY-GOAL.md: only reference-validated
// conversion counts as compatibility progress).
// Usage: npx vite-node scripts/convert-p9-graph.mjs [dir] [out]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseP9SceneXml, p9ToGraph } from "../src/import/p9-graph";

const root = process.argv[2] ?? "scenes/plane9/scenes";
const out = process.argv[3] ?? "docs/p9-graph-conversion.json";

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(".p9c")) files.push(p);
  }
})(root);
files.sort();

let dispositionClean = 0, withUnsupported = 0, failed = 0;
const featureCounts = new Map();
const scenes = [];
for (const f of files) {
  const rel = relative(root, f);
  try {
    const raw = readFileSync(f);
    const src = parseP9SceneXml(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), rel);
    const { graph, dispositions, dispositionCleanImport: complete } = p9ToGraph(src);
    const unsupported = dispositions.filter((d) => d.disposition === "unsupported");
    for (const u of unsupported) featureCounts.set(u.feature, (featureCounts.get(u.feature) ?? 0) + 1);
    if (complete) dispositionClean++;
    else withUnsupported++;
    // Accounting invariant: every source node dispositioned, source record
    // carries every node + connection.
    const srcNodeCount = graph.source.nodes.length;
    if (dispositions.length !== srcNodeCount) {
      throw new Error(`accounting hole: ${dispositions.length} dispositions for ${srcNodeCount} source nodes`);
    }
    scenes.push({
      scene: rel,
      sourceNodes: srcNodeCount,
      sourceConnections: graph.source.connections.length,
      lowered: dispositions.filter((d) => d.disposition === "lowered").length,
      consumed: dispositions.filter((d) => d.disposition === "consumed-by").length,
      unsupported: unsupported.map((u) => u.feature),
    });
  } catch (err) {
    failed++;
    scenes.push({ scene: rel, error: String(err.message).slice(0, 200) });
  }
}
const report = {
  measures: "source-node disposition accounting only (every node dispositioned; count of scenes with zero currently-labeled unsupported nodes) — NOT executable structural completeness and NOT fidelity; see COMPATIBILITY-GOAL.md",
  corpus: root, total: files.length,
  dispositionCleanScenes: dispositionClean,
  scenesWithUnsupportedFeatures: withUnsupported,
  importFailures: failed,
  unsupportedFeatureCounts: Object.fromEntries([...featureCounts.entries()].sort((a, b) => b[1] - a[1])),
  scenes,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`total ${files.length} | disposition-clean ${dispositionClean} | with-unsupported ${withUnsupported} | failed ${failed}`);
console.log("top unsupported features:");
[...featureCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  .forEach(([k, v]) => console.log(` ${String(v).padStart(4)}  ${k}`));
console.log(`report: ${out}`);
