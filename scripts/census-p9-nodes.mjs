// Complete structural census of the Plane9 scene corpus: every node type,
// every port (id, value type, sample values), and the connection/link
// encoding, extracted from scene.xml across all .p9c files.
// Output: docs/plane9-node-census.json
// Usage: node scripts/census-p9-nodes.mjs [corpusDir] [outPath]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { TextDecoder } from "node:util";
import { join, relative } from "node:path";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

const root = process.argv[2] ?? "scenes/plane9/scenes";
const outPath = process.argv[3] ?? "docs/plane9-node-census.json";

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(".p9c")) files.push(p);
  }
})(root);
files.sort();

// Keep ALL attributes and children so nothing is silently dropped.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  isArray: (tag) => ["Node", "Port", "Link", "Connection", "Input", "Output"].includes(tag),
});

const nodeTypes = new Map(); // type -> { count, sceneCount, ports: Map<portId, {count, valueKinds:Set, samples:[]}> }
const topLevelKeys = new Map(); // scene.xml root child keys -> count
const linkShapes = new Map(); // JSON shape signature of link entries -> { count, sample }
const perScene = [];
let parseErrors = 0;

const valueKind = (v) => {
  if (v === undefined || v === null) return "none";
  if (typeof v === "number") return "number";
  if (typeof v === "string") {
    if (/^-?\d+(\.\d+)?([;, ]-?\d+(\.\d+)?)*$/.test(v.trim())) return "numeric-string";
    if (v.length > 200) return "long-text";
    return "string";
  }
  if (typeof v === "object" && v["#text"] !== undefined) return "cdata";
  return typeof v;
};

for (const f of files) {
  let doc;
  try {
    const raw = readFileSync(f);
    const zip = unzipSync(new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
    const key = Object.keys(zip).find((k) => k.toLowerCase().endsWith("scene.xml"));
    if (!key) { parseErrors++; continue; }
    doc = parser.parse(new TextDecoder().decode(zip[key]));
  } catch { parseErrors++; continue; }
  const sceneRoot = doc.Plane9Scene;
  if (!sceneRoot) { parseErrors++; continue; }

  for (const k of Object.keys(sceneRoot)) {
    topLevelKeys.set(k, (topLevelKeys.get(k) ?? 0) + 1);
  }

  const rel = relative(root, f);
  const sceneNodeTypes = new Set();
  const nodes = sceneRoot.Nodes?.Node ?? [];
  for (const n of nodes) {
    const t = String(n["@Type"] ?? "?");
    sceneNodeTypes.add(t);
    let entry = nodeTypes.get(t);
    if (!entry) { entry = { count: 0, sceneCount: 0, scenes: new Set(), attrs: new Set(), ports: new Map() }; nodeTypes.set(t, entry); }
    entry.count++;
    entry.scenes.add(rel);
    for (const a of Object.keys(n)) if (a.startsWith("@")) entry.attrs.add(a);
    for (const p of n.Port ?? []) {
      const pid = String(p["@Id"] ?? "?");
      let pe = entry.ports.get(pid);
      if (!pe) { pe = { count: 0, valueKinds: new Set(), attrs: new Set(), samples: [] }; entry.ports.set(pid, pe); }
      pe.count++;
      for (const a of Object.keys(p)) if (a.startsWith("@")) pe.attrs.add(a);
      const vk = valueKind(p.Value);
      pe.valueKinds.add(vk);
      if (pe.samples.length < 3 && p.Value !== undefined && vk !== "long-text" && vk !== "cdata") {
        pe.samples.push(String(typeof p.Value === "object" ? p.Value["#text"] : p.Value).slice(0, 80));
      }
    }
  }

  // Links / connections: capture whatever encodings exist
  for (const linkKey of ["Links", "Connections", "Link", "Connection"]) {
    const l = sceneRoot[linkKey] ?? sceneRoot.Nodes?.[linkKey];
    if (!l) continue;
    const entries = Array.isArray(l) ? l : (l.Link ?? l.Connection ?? [l]);
    for (const e of (Array.isArray(entries) ? entries : [entries])) {
      const shape = JSON.stringify(Object.keys(typeof e === "object" ? e : {}).sort());
      let ls = linkShapes.get(shape);
      if (!ls) { ls = { count: 0, sample: e }; linkShapes.set(shape, ls); }
      ls.count++;
    }
  }
  perScene.push({ scene: rel, nodeCount: nodes.length, nodeTypes: [...sceneNodeTypes].sort() });
}

const census = {
  corpus: root,
  sceneCount: files.length,
  parseErrors,
  topLevelXmlKeys: Object.fromEntries([...topLevelKeys.entries()].sort((a, b) => b[1] - a[1])),
  linkEncodings: Object.fromEntries([...linkShapes.entries()].map(([shape, v]) => [shape, { count: v.count, sample: v.sample }])),
  nodeTypes: Object.fromEntries(
    [...nodeTypes.entries()].sort((a, b) => b[1].scenes.size - a[1].scenes.size).map(([t, e]) => [t, {
      instances: e.count,
      scenes: e.scenes.size,
      attrs: [...e.attrs].sort(),
      ports: Object.fromEntries([...e.ports.entries()].map(([pid, pe]) => [pid, {
        count: pe.count,
        valueKinds: [...pe.valueKinds],
        attrs: [...pe.attrs].sort(),
        samples: pe.samples,
      }])),
    }]),
  ),
  perScene,
};

writeFileSync(outPath, JSON.stringify(census, null, 2));
console.log(`scenes: ${files.length}, parse errors: ${parseErrors}`);
console.log(`node types: ${nodeTypes.size}`);
console.log(`top-level xml keys: ${[...topLevelKeys.keys()].join(", ")}`);
console.log(`link encodings found: ${linkShapes.size}`);
console.log(`census: ${outPath}`);
