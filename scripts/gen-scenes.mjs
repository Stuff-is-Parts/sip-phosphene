// Exports the built-in scenes as .phos.json seed content + regenerates manifest.json.
import { writeFileSync, readdirSync } from "node:fs";
import { builtinScenes } from "../src/shaders/library.ts";

for (const s of builtinScenes()) {
  const file = s.name.toLowerCase().replace(/\s+/g, "-") + ".phos.json";
  writeFileSync(new URL("../scenes/" + file, import.meta.url), JSON.stringify(s, null, 2) + "\n");
  console.log("wrote", file);
}
const files = readdirSync(new URL("../scenes/", import.meta.url))
  .filter((f) => f.endsWith(".phos.json")).sort();
writeFileSync(new URL("../scenes/manifest.json", import.meta.url), JSON.stringify(files, null, 2) + "\n");
console.log("manifest:", files.length, "scenes");
