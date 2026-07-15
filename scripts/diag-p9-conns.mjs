// Dump a scene's full node + connection list from the graph importer's parser.
import { readFileSync } from "node:fs";
import { parseP9SceneXml } from "../src/import/p9-graph";

const f = process.argv[2] ?? "scenes/plane9/scenes/Cube/Flip Flop.p9c";
const raw = readFileSync(f);
const src = parseP9SceneXml(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), f);
console.log("NODES:", [...src.nodes.values()].map((n) => `${n.type}:${n.id}`).join(" | "));
console.log("CONNECTIONS:");
src.connections.forEach((c) => console.log(`  ${c.fromNode}.${c.fromPort} -> ${c.toNode}.${c.toPort}`));
