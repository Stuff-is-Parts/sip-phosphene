// Frame-context validation: prove the ported oracle audio/time model
// (scripts/lib/milk-audio-model.mjs OracleFrameModel) against the
// authoritative behavior witnessed in the RUNNING Butterchurn oracle —
// the per-frame globalVars extracted into reference/milk/<slug>/
// frames.json by scripts/reference-milk.mjs. This is validation against
// the oracle, not against self-authored unit expectations.
//
// Compares frame/time/fps/bass/bass_att/mid/mid_att/treb/treb_att for
// every frame of every captured preset. Tolerance: values must agree to
// 1e-4 relative (float32 storage in the oracle's Float32Array levels vs
// float64 in the port is the only representational difference).
//
// Usage: node scripts/validate-audio-model.mjs [out]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { audioFrame, FPS } from "./lib/ref-audio.mjs";
import { OracleFrameModel } from "./lib/milk-audio-model.mjs";

const out = process.argv[2] ?? "docs/audio-model-validation.json";
const REL_TOLERANCE = 1e-4;

const manifestPath = "reference/milk/manifest.json";
if (!existsSync(manifestPath)) {
  console.error("reference fixtures missing — run: node scripts/reference-milk.mjs");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const KEYS = ["frame", "time", "fps", "bass", "bass_att", "mid", "mid_att", "treb", "treb_att"];

const relErr = (a, b) => Math.abs(a - b) / Math.max(1e-6, Math.abs(b));

const results = [];
let validated = 0, diverged = 0;
for (const p of manifest.presets) {
  if (p.error) continue;
  const fixture = JSON.parse(readFileSync(`reference/milk/${p.slug}/frames.json`, "utf8"));
  const model = new OracleFrameModel(manifest.sampleRate);
  let worst = { key: null, frame: -1, err: 0 };
  for (let f = 0; f < fixture.globalVars.length; f++) {
    const { c, l, r } = audioFrame(f);
    const ours = model.step(c, l, r, 1 / FPS);
    const oracle = fixture.globalVars[f];
    for (const k of KEYS) {
      const e = relErr(ours[k], oracle[k]);
      if (e > worst.err) worst = { key: k, frame: f, err: e, ours: ours[k], oracle: oracle[k] };
    }
  }
  const pass = worst.err <= REL_TOLERANCE;
  if (pass) validated++; else diverged++;
  results.push({
    preset: p.file, frames: fixture.globalVars.length,
    status: pass ? "MATCHES-ORACLE" : "diverged",
    worst: { ...worst, err: Number(worst.err.toExponential(3)) },
  });
  console.log(`${pass ? "MATCH" : " DIVG"} worst ${worst.key}@${worst.frame} err=${worst.err.toExponential(2)}  ${p.file.slice(0, 60)}`);
}

const report = {
  measures: "ported oracle audio/time model (OracleFrameModel) vs per-frame globalVars extracted from the running Butterchurn oracle — frame context validated against authoritative behavior",
  tolerance: { relative: REL_TOLERANCE, keys: KEYS },
  presets: results.length, validated, diverged,
  results,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nMATCHES-ORACLE ${validated}/${results.length} (diverged ${diverged})`);
console.log(`report: ${out}`);
