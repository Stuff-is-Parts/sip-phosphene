// One-off: print translated WGSL around the failure for sample scenes.
import { readFileSync } from "node:fs";
import { parseP9c, translateP9Glsl } from "../src/import/p9";
const files = process.argv.slice(2).filter((f) => f.endsWith(".p9c"));
for (const f of files) {
  const raw = readFileSync(f);
  const p9 = parseP9c(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), f);
  if (!p9.glsl) continue;
  const { wgsl } = translateP9Glsl(p9.glsl);
  console.log("====", f.split("/").pop());
  console.log(wgsl);
}
