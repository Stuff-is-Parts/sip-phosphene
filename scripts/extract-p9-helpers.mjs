// Scan every .p9c scene under scenes/plane9/scenes and grep the extracted
// GLSL for helper definitions (`vec2/3/4 _xxx(...) {`, `float _xxx(...) {`,
// `void _xxx(...) {`, `mat3 _xxx(...) {`). Reports which helper names appear
// as inline definitions and which scenes define them.
//
// Why: Plane9 blog post 104 says the parser "Only injects shader functions
// we actually use" — meaning a scene that defines its own helper wins over
// the internal library. Scene-inlined definitions are authoritative Plane9
// source for the specific helpers they cover.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { TextDecoder } from "node:util";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

const root = process.argv[2] ?? "scenes/plane9/scenes";
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(".p9c")) files.push(p);
  }
})(root);
files.sort();

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", isArray: (t) => t === "Node" || t === "Port" });
const defRegex = /^(?:\s*)(vec[234]|float|int|void|mat[234])\s+(_\w+)\s*\(/gm;
const helpersToScene = new Map(); // helper name -> Set of scene paths
const perScene = []; // { file, helpers: Map<name, defText> }

for (const f of files) {
  let glsl = null;
  try {
    const raw = readFileSync(f);
    const zip = unzipSync(new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
    const key = Object.keys(zip).find((k) => k.toLowerCase().endsWith("scene.xml"));
    if (!key) continue;
    const xml = new TextDecoder().decode(zip[key]);
    const doc = parser.parse(xml);
    const nodes = doc.Plane9Scene?.Nodes?.Node ?? [];
    for (const n of nodes) {
      if (n["@Type"] !== "Shader") continue;
      for (const p of n.Port ?? []) {
        if (p["@Id"] === "Shader") {
          const v = p.Value;
          glsl = typeof v === "string" ? v : String(v?.["#text"] ?? "");
          break;
        }
      }
      if (glsl) break;
    }
  } catch { continue; }
  if (!glsl) continue;
  // strip comments so `//... _foo(` in comments doesn't get counted
  const clean = glsl.replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const sceneHelpers = new Map();
  let m;
  const rx = new RegExp(defRegex.source, "gm");
  while ((m = rx.exec(clean)) !== null) {
    const returnType = m[1];
    const helperName = m[2];
    // capture first line + open brace for signature
    const lineStart = clean.lastIndexOf("\n", m.index) + 1;
    const nextBrace = clean.indexOf("{", m.index);
    const sig = clean.slice(lineStart, nextBrace + 1).trim().replace(/\s+/g, " ");
    sceneHelpers.set(helperName, { returnType, sig });
    if (!helpersToScene.has(helperName)) helpersToScene.set(helperName, new Set());
    helpersToScene.get(helperName).add(f);
  }
  if (sceneHelpers.size) perScene.push({ file: f, helpers: sceneHelpers });
}

console.log(`\nScenes with helper definitions: ${perScene.length}/${files.length}\n`);
console.log("== Helper -> scene count ==");
const sortedByCount = [...helpersToScene.entries()].sort((a, b) => b[1].size - a[1].size);
for (const [name, set] of sortedByCount) {
  console.log(`  ${String(set.size).padStart(3)}  ${name}`);
}

console.log("\n== Scenes defining rare or interesting helpers ==");
const interesting = ["_lightBlinnPhong", "_lightDirectional", "_lightPoint", "_lightHalfLambert",
  "_perturbNormal", "_perturbNormalTexture", "_fresnelRoughness", "_hsv2rgb", "_palette",
  "_cubicpulse", "_brightnessSaturationContrast", "_blendScreen", "_screenSpaceDither",
  "_liftGammaGain", "_blackBody", "_toneMappingUncharted2", "_tonemapACES", "_luminance",
  "_voronoi", "_texturePanoramic", "_rotate", "_bump", "SampleWithBorder", "_tolinear",
  "_tosrgb", "_perm", "_fbm", "_noise", "_fbmfast", "_noisefast", "_turbulencefast",
  "_ridgedmffast", "_saturate", "_stepaa", "_noisegradientfast"];
for (const h of interesting) {
  if (!helpersToScene.has(h)) continue;
  console.log(`\n--- ${h} (defined in ${helpersToScene.get(h).size} scene(s)) ---`);
  const scenes = [...helpersToScene.get(h)];
  const sample = scenes[0];
  const entry = perScene.find((s) => s.file === sample);
  console.log(`  first: ${sample}`);
  console.log(`  sig:   ${entry.helpers.get(h).sig}`);
}
