// Dump the *bound* GLSL source the parser sees, around a given line.
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

const file = process.argv[process.argv.length - 2];
const lineNum = parseInt(process.argv[process.argv.length - 1], 10);
const raw = readFileSync(file);
const zip = unzipSync(new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
const xml = new TextDecoder().decode(zip["scene.xml"]);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", isArray: (t) => t === "Node" || t === "Port" });
const doc = parser.parse(xml);
const nodes = doc.Plane9Scene.Nodes.Node;
let glsl = null;
for (const n of nodes) {
  if (n["@Type"] !== "Shader" || glsl) continue;
  for (const p of n.Port ?? []) {
    if (p["@Id"] === "Shader") glsl = typeof p.Value === "string" ? p.Value : p.Value["#text"];
  }
}
// mirror prepare() from glsl.ts
let s = glsl.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
s = s.replace(/VERTEXOUTPUT\s*\{[^}]*\}/, "");
s = s.replace(/#ifdef\s+VERTEX[\s\S]*?#endif/, "");
const fm = /#ifdef\s+FRAGMENT([\s\S]*?)#endif/.exec(s);
const helpers = s.replace(/#ifdef\s+FRAGMENT[\s\S]*?#endif/, "");
const main = fm ? fm[1] : "";
const bound = helpers + "\n" + main;
const lines = bound.split("\n");
for (let i = Math.max(0, lineNum - 4); i < Math.min(lines.length, lineNum + 4); i++) {
  console.log((i + 1 === lineNum ? "> " : "  ") + (i + 1) + ": " + lines[i]);
}
