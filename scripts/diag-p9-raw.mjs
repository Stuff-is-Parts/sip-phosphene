// Print the raw GLSL from a .p9c Shader node.
import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
const [, , path] = process.argv;
const raw = readFileSync(path);
const files = unzipSync(new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
const xmlEntry = Object.keys(files).find((k) => k.toLowerCase().endsWith("scene.xml"));
const xml = new TextDecoder().decode(files[xmlEntry]);
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
if (!glsl) { console.error("no Shader node"); process.exit(1); }
const lines = String(glsl).replace(/\r\n/g, "\n").split("\n");
for (let i = 0; i < lines.length; i++) console.log(String(i + 1).padStart(4) + ": " + lines[i]);
