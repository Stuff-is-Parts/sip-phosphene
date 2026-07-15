import { readFileSync } from "node:fs";
import { parseMilk, milkToScene } from "../src/import/milk";
const f = process.argv[process.argv.length - 2];
const target = parseInt(process.argv[process.argv.length - 1], 10);
const t = readFileSync(f, "latin1");
const { scene } = milkToScene(parseMilk(t, f));
const lines = scene.layers.post.code.split("\n");
// bodyLineOffset for stage 'post' — the assembled prelude length before user body
// approximated by looking for '// user body' or just eyeball; use raw body lines
for (let i = Math.max(0, target - 3); i < Math.min(lines.length, target + 3); i++) {
  console.log((i + 1 === target ? "> " : "  ") + (i + 1) + ": " + lines[i]);
}
