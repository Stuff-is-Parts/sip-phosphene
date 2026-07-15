// One-off: run one preset through the full import + engine path, print throws.
import { readFileSync } from "node:fs";
import { parseMilk, milkToScene } from "../src/import/milk";
import { ModEngine } from "../src/core/mods";
import { meshWarpFor } from "../src/core/meshwarp";
import { parseParams } from "../src/core/params";
import { STAGES } from "../src/core/types";

const f = process.argv[process.argv.length - 1];
const text = readFileSync(f, "latin1");
try {
  const m = parseMilk(text, f);
  const { scene, report } = milkToScene(m);
  console.log("import OK — mods:", scene.mods.length, "| report:", report.join(" | "));
  const engine = new ModEngine();
  const stageParams = Object.fromEntries(STAGES.map((s) => [s, parseParams(scene.layers[s].code)]));
  const audio = {
    beatCount: 0, lastBeat: 0, bass: 0.5, mid: 0.4, treble: 0.3, beat: 0.2,
    energy: 0.5, bpm: 120, spec: new Float32Array(64), wave: new Float32Array(64),
  };
  for (const t of [0.4, 0.58, 0.76]) {
    engine.evaluate(scene, stageParams, audio, t);
    const mw = meshWarpFor(scene);
    if (mw) mw.evaluate(engine.exprSnapshot(), t);
  }
  console.log("engine OK — exprErrors:", [...engine.exprErrors.values()].join("; ") || "none");
} catch (err) {
  console.log("THREW:", err.stack?.split("\n").slice(0, 6).join("\n"));
}
