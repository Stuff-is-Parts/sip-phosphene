// Equation-layer validation: run the ORIGINAL preset EEL through
// MilkPresetRunner (src/core/milk-runner.ts) + expr.ts with the oracle's
// own per-frame globalVars as inputs, and compare the resulting
// mdVSFrame variable pool against the values extracted from the RUNNING
// Butterchurn oracle at every capture frame. This validates the EEL
// compiler and the preset lifecycle against authoritative behavior with
// no GPU in the loop.
//
// Classification: presets whose equations call rand()/randint() consume
// entropy streams that cannot be aligned across engines (the oracle's
// page RNG serves many other draws), so their values legitimately
// diverge — they are reported as "uses-rand", not as matches or
// mismatches. gmegabuf cross-context sharing is approximated by
// per-frame copy; presets writing gmegabuf are classified too.
//
// TOLERANCE: 1e-9 relative — both engines evaluate in JS doubles on
// identical inputs, so equality is expected up to association order.
//
// Usage: npx vite-node scripts/validate-frame-equations.mjs [out]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseMilkComplete } from "../src/import/milk-graph";
import { MilkPresetRunner, makeMulberry32, REGS } from "../src/core/milk-runner";

const out = process.argv[2] ?? "docs/frame-equation-validation.json";
const REL_TOL = 1e-9;
const GRID_X = 48, GRID_Y = 36;

const manifestPath = "reference/milk/manifest.json";
if (!existsSync(manifestPath)) {
  console.error("reference fixtures missing — run: node scripts/reference-milk.mjs");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const BASE_KEYS = [
  "frame", "time", "fps", "bass", "bass_att", "mid", "mid_att",
  "treb", "treb_att", "meshx", "meshy", "aspectx", "aspecty",
  "pixelsx", "pixelsy",
];
// Keys never compared: engine-internal, entropy-fed, or non-scalar.
const SKIP_KEYS = new Set(["rand_start", "rand_preset", "megabuf", "gmegabuf"]);

const relErr = (a, b) => {
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isNaN(a) && Number.isNaN(b) ? 0 : Infinity;
  return Math.abs(a - b) / Math.max(1, Math.abs(b));
};

const results = [];
let matched = 0, mismatched = 0, usesRand = 0, errored = 0;
for (const entry of manifest.presets) {
  if (entry.error) continue;
  try {
    const text = readFileSync(join(manifest.corpus, entry.file), "latin1");
    const parsed = parseMilkComplete(text, entry.file);
    const fixture = JSON.parse(readFileSync(`reference/milk/${entry.slug}/frames.json`, "utf8"));

    const allEel = [
      parsed.perFrameInit, parsed.perFrame, parsed.perPixel,
      ...parsed.waves.flatMap((w) => [w.initCode, w.perFrame, w.perPoint]),
      ...parsed.shapes.flatMap((s) => [s.initCode, s.perFrame]),
    ].join("\n");
    const randUser = /\brand(int)?\s*\(/.test(allEel);
    const gmegabufUser = /\bgmegabuf\s*\(/.test(allEel);

    const [W, H] = entry.size;
    const invAspectX = H > W ? H / W : 1;
    const invAspectY = W > H ? W / H : W / H === 1 ? 1 : W / H;
    // render aspect (witnessed): ax = H>W ? W/H : 1 ; ay = W>H ? H/W : 1
    const renderAx = H > W ? W / H : 1;
    const renderAy = W > H ? H / W : 1;
    const loadGlobals = {
      frame: 0, time: 0, fps: 30,
      bass: 0, bass_att: 1, mid: 0, mid_att: 1, treb: 0, treb_att: 1,
      meshx: GRID_X, meshy: GRID_Y,
      aspectx: 1 / renderAx, aspecty: 1 / renderAy,
      pixelsx: W, pixelsy: H,
    };
    // Suppress unused warnings for the direct inverse computations above.
    void invAspectX; void invAspectY;

    const runner = new MilkPresetRunner({
      baseValues: parsed.values,
      initEel: parsed.perFrameInit, frameEel: parsed.perFrame, pixelEel: parsed.perPixel,
      waves: parsed.waves.map((w) => ({
        baseValues: w.values, initEel: w.initCode, frameEel: w.perFrame, pointEel: w.perPoint,
      })),
      shapes: parsed.shapes.map((s) => ({
        baseValues: s.values, initEel: s.initCode, frameEel: s.perFrame,
      })),
    }, loadGlobals, makeMulberry32(0x5eed1e55));

    const warpUVs = new Float32Array((GRID_X + 1) * (GRID_Y + 1) * 2);
    let regVars = {};
    let worst = { key: null, frame: -1, err: 0, ours: 0, oracle: 0 };
    let comparedKeys = 0;
    for (let f = 0; f < fixture.globalVars.length; f++) {
      const oracleGlobals = fixture.globalVars[f];
      const globals = {};
      for (const k of BASE_KEYS) globals[k] = oracleGlobals[k];
      Object.assign(globals, regVars);
      const frame = runner.runFrameEquations(globals);
      const vertexPool = runner.runPixelEquations(frame, GRID_X, GRID_Y, renderAx, renderAy, warpUVs);
      regVars = {};
      for (const r of REGS) if (r in vertexPool) regVars[r] = vertexPool[r];

      const oracleFrame = fixture.mdVSFrame[String(f)];
      if (oracleFrame) {
        for (const [k, oracleVal] of Object.entries(oracleFrame)) {
          if (SKIP_KEYS.has(k) || !(k in frame)) continue;
          comparedKeys++;
          const e = relErr(frame[k], oracleVal);
          if (e > worst.err) worst = { key: k, frame: f, err: e, ours: frame[k], oracle: oracleVal };
        }
      }
    }
    const pass = worst.err <= REL_TOL;
    let status;
    if (randUser) { status = "uses-rand (entropy streams not alignable)"; usesRand++; }
    else if (pass) { status = "MATCHES-ORACLE"; matched++; }
    else { status = "diverged"; mismatched++; }
    results.push({
      preset: entry.file, status, comparedKeys,
      gmegabufUser,
      runnerErrors: runner.errors,
      worst: worst.key ? { ...worst, err: Number(worst.err.toExponential(3)) } : null,
    });
    console.log(`${randUser ? " RAND" : pass ? "MATCH" : " DIVG"} keys=${comparedKeys} worst=${worst.key}@${worst.frame} err=${worst.err.toExponential(2)}  ${entry.file.slice(0, 55)}`);
  } catch (err) {
    errored++;
    results.push({ preset: entry.file, status: "harness-error", error: String(err.message).slice(0, 300) });
    console.log(`ERROR ${entry.file.slice(0, 60)}: ${String(err.message).slice(0, 120)}`);
  }
}

const report = {
  measures: "original-EEL frame equations (MilkPresetRunner + expr.ts) vs per-frame mdVSFrame extracted from the running Butterchurn oracle, identical inputs per frame",
  tolerance: { relative: REL_TOL },
  presets: results.length, matched, mismatched, usesRand, harnessErrors: errored,
  results,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nMATCHES ${matched} | diverged ${mismatched} | uses-rand ${usesRand} | errors ${errored} (of ${results.length})`);
console.log(`report: ${out}`);
