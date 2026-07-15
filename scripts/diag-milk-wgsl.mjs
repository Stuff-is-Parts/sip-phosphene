// Reflect the WGSL of a preset's transpiled shaders to see the compile error.
import { readFileSync } from "node:fs";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { parseMilk, milkToScene } from "../src/import/milk";
import { assemble } from "../src/gpu/wgsl";
import { parseParams } from "../src/core/params";

const f = process.argv[process.argv.length - 1];
const text = readFileSync(f, "latin1");
const m = parseMilk(text, f);
const { scene, report } = milkToScene(m);
console.log("REPORT:", report.join(" | "));

const tryStage = (stage, body) => {
  const { code } = assemble(stage === "post" ? "post" : stage, body, parseParams(body));
  try { new WgslReflect(code); console.log(stage, "OK"); }
  catch (err) {
    const msg = String(err.message ?? err);
    const lm = /Line:\s*(\d+)/.exec(msg);
    console.log(stage, "FAIL:", msg);
    if (lm) {
      const lines = code.split("\n");
      const L = parseInt(lm[1], 10);
      for (let i = Math.max(0, L - 3); i < Math.min(lines.length, L + 2); i++) {
        console.log((i + 1 === L ? "> " : "  ") + (i + 1) + ": " + lines[i]);
      }
    }
  }
};
tryStage("post", scene.layers.post.code);
for (let i = 0; i < (scene.passes ?? []).length; i++) tryStage(`pass${i}`, scene.passes[i].code);
