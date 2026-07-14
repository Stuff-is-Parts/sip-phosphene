// Corpus inventory: parse every installed Plane9 .p9c scene and tally what
// capabilities real content exercises. Output: JSON capability report.
// Usage: vite-node scripts/inventory-p9.mjs -- "C:/Program Files (x86)/Plane9/scenes"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { TextDecoder } from "node:util";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

const root = process.argv[process.argv.length - 1];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(".p9c")) files.push(p);
  }
})(root);

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
const nodeCounts = new Map();
const nodePresence = new Map(); // scenes containing at least one of this node type
const pairCounts = new Map(); // co-occurrence, for pipeline-shape analysis
const licenseCounts = new Map();
const perScene = [];
let unreadable = 0;

for (const f of files) {
  let doc;
  try {
    const zip = unzipSync(new Uint8Array(readFileSync(f)));
    const xmlEntry = Object.keys(zip).find((k) => k.toLowerCase().endsWith("scene.xml"));
    if (!xmlEntry) { unreadable++; continue; }
    doc = parser.parse(new TextDecoder().decode(zip[xmlEntry]));
  } catch {
    unreadable++; // corrupt container or non-zip: count and move on
    continue;
  }
  const nodes = [];
  const licenses = [];
  (function collect(o, parentKey) {
    if (Array.isArray(o)) { o.forEach((x) => collect(x, parentKey)); return; }
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (k === "@Type" && typeof v === "string") {
          if (parentKey === "License") licenses.push(v);
          else nodes.push(v);
        }
        collect(v, k);
      }
    }
  })(doc, "");
  for (const l of licenses) licenseCounts.set(l, (licenseCounts.get(l) ?? 0) + 1);
  const uniq = [...new Set(nodes)];
  for (const n of nodes) nodeCounts.set(n, (nodeCounts.get(n) ?? 0) + 1);
  for (const n of uniq) nodePresence.set(n, (nodePresence.get(n) ?? 0) + 1);
  for (const a of uniq) for (const b of uniq) if (a < b) {
    const key = `${a}+${b}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  perScene.push({ scene: relative(root, f), nodeTypes: uniq });
}

const byPresence = [...nodePresence.entries()].sort((a, b) => b[1] - a[1]);
const report = {
  totalScenes: files.length,
  parsed: perScene.length,
  unreadable,
  nodeTypesByScenePresence: Object.fromEntries(byPresence),
  nodeTypesByTotalCount: Object.fromEntries([...nodeCounts.entries()].sort((a, b) => b[1] - a[1])),
  topPairs: Object.fromEntries([...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)),
  licenses: Object.fromEntries([...licenseCounts.entries()].sort((a, b) => b[1] - a[1])),
};
writeFileSync("p9-corpus-report.json", JSON.stringify(report, null, 2));
console.log(`parsed ${perScene.length}/${files.length} (${unreadable} unreadable)`);
console.log("node types by scene presence:");
for (const [n, c] of byPresence) console.log(`  ${String(c).padStart(4)}  ${n}`);
