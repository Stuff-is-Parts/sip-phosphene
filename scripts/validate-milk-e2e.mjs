// END-TO-END MilkDrop fidelity validation (defect 4): both engines get
// ONLY the .milk source + PCM bytes + committed frame times + committed
// RNG seed + same resolution and initial state. PHOSPHENE derives its
// own audio levels, frame globals, EEL evaluations, and rendering — no
// oracle values are injected.
//
// Reports both SSIM at capture frames AND equation-state divergence
// PER FRAME across every tested frame, not only screenshot frames.
//
// Prereq: node scripts/reference-milk.mjs (builds reference/milk/)
// Usage: node scripts/validate-milk-e2e.mjs [out] [presetSubstring]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, execSync, execFileSync } from "node:child_process";

// Embed HEAD SHA so evidence traces to the exact code that produced it.
let COMMIT_SHA = "unknown";
try { COMMIT_SHA = execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(); } catch { /* not a repo */ }
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import { audioFrame } from "./lib/ref-audio.mjs";
import { ssimColor, meanAbsError } from "./lib/ssim.mjs";

const out = process.argv[2] ?? "docs/fidelity-milk-e2e.json";
const filter = process.argv[3] ?? "";
// Committed acceptance tolerances (COMPATIBILITY-GOAL.md):
// - visual: min per-channel color SSIM >= 0.80 at every capture frame.
// - equation state: per-key relative error <= 1e-6 at every frame for
//   every executable preset. A missing PHOSPHENE key, an unexpected
//   nonfinite value, or a numeric divergence above tolerance FAILS the
//   equation-state gate (the two gates are reported independently — a
//   preset can pass visual and fail equation state or vice versa).
const SSIM_TOLERANCE = 0.80;
const EQ_STATE_TOLERANCE = 1e-6;
const SEED = 0x5eed1e55;

console.log("building current source...");
execSync("npm run build", { stdio: "inherit" });

const manifestPath = "reference/milk/manifest.json";
if (!existsSync(manifestPath)) {
  console.error("reference fixtures missing — run: node scripts/reference-milk.mjs");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const [W, H] = manifest.presets.find((p) => !p.error)?.size ?? [800, 600];
const CAPTURE_FRAMES = manifest.captureFrames;

const EDGE_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browserPath = EDGE_PATHS.find((p) => existsSync(p));
const PORT = process.env.VALIDATE_PORT ?? "4224";
const preview = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "preview", "--port", PORT, "--strictPort",
], { stdio: "pipe" });
await new Promise((resolve, reject) => {
  preview.stdout.on("data", (d) => { if (String(d).includes(PORT)) resolve(); });
  preview.on("exit", () => reject(new Error("vite preview exited early")));
  setTimeout(() => reject(new Error("vite preview did not start")), 15000);
});

const browser = await puppeteer.launch({
  executablePath: browserPath, headless: true,
  args: ["--headless=new", "--enable-unsafe-webgpu", "--enable-gpu", `--window-size=${W},${H}`],
});
mkdirSync("reference/milk-phosphene-e2e", { recursive: true });

const results = [];
let validated = 0, diverged = 0, unsupported = 0, loadFailed = 0, skipped = 0;
try {
  for (const entry of manifest.presets) {
    if (entry.error) { skipped++; continue; }
    if (filter && !entry.file.includes(filter)) continue;
    const corpusPath = join(manifest.corpus, entry.file);
    const text = readFileSync(corpusPath, "latin1");
    const sha256 = createHash("sha256").update(text, "latin1").digest("hex");
    if (sha256 !== entry.sha256) throw new Error(`corpus file changed: ${entry.file}`);
    const fixture = JSON.parse(readFileSync(`reference/milk/${entry.slug}/frames.json`, "utf8"));

    const page = await browser.newPage();
    let frames;
    // Per-preset accumulators — declared here (before the try) so the
    // finally-block cleanup does not close over uninitialized state
    // and the post-try aggregation reads the actual per-preset values.
    let worstDrift = { key: null, frame: -1, err: 0, ours: 0, oracle: 0 };
    let visualPassPersist = false;
    let equationStatePassPersist = false;
    let comparedFramesPersist = 0;
    let comparedKeysPersist = 0;
    let equationStateFailsPersist = 0;
    let missingKeysPersist = [];
    let extraKeysPersist = [];
    let nonfiniteKeysPersist = [];
    let failSamplePersist = [];
    try {
      await page.setViewport({ width: W, height: H });
      await page.evaluateOnNewDocument((seed) => {
        let s = seed | 0;
        Math.random = () => {
          s |= 0; s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }, SEED);
      await page.goto(`http://localhost:${PORT}/verify.html`, { waitUntil: "networkidle2", timeout: 20000 });
      await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
      await page.evaluate((seed) => {
        let s = seed | 0;
        Math.random = () => {
          s |= 0; s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }, SEED);
      const load = await page.evaluate((t, n) => window.__milkLoadE2E(t, n), text, entry.file);
      if (load.unsupported) {
        unsupported++;
        results.push({ preset: entry.file, status: "unsupported", features: load.unsupported });
        console.log(`UNSUP ${entry.file.slice(0, 56)}`);
        continue;
      }
      if (!load.ok) {
        loadFailed++;
        results.push({ preset: entry.file, status: "load-failed", errors: load.errors });
        console.log(`LFAIL ${entry.file.slice(0, 60)}`);
        continue;
      }
      frames = [];
      mkdirSync(`reference/milk-phosphene-e2e/${entry.slug}`, { recursive: true });
      // Per-frame equation-state divergence GATE. For every oracle
      // globalVars key AND every oracle mdVSFrame key we require PHOSPHENE
      // to expose a corresponding value within tolerance. A missing key
      // in PHOSPHENE's state, an unexpected NaN/Infinity, or a numeric
      // divergence above tolerance is recorded as a failure — the state
      // is not considered "equivalent" just because the finite shared
      // keys happened to match.
      const relErr = (a, b) => {
        if (a === b) return 0;
        if (!Number.isFinite(a) && !Number.isFinite(b)) {
          // Both nonfinite: NaN vs NaN is a match, +/-Inf vs +/-Inf is a
          // match, mismatched nonfinite categories diverge.
          if (Number.isNaN(a) && Number.isNaN(b)) return 0;
          if (a === b) return 0; // +Inf===+Inf, -Inf===-Inf
          return Infinity;
        }
        if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
        return Math.abs(a - b) / Math.max(1e-6, Math.abs(b));
      };
      // Per-preset accumulators.
      let comparedFrames = 0;
      let comparedKeys = 0;
      let equationStatePasses = 0;
      let equationStateFailsCount = 0;
      const missingKeys = new Set();
      const extraKeys = new Set();
      const nonfiniteKeys = new Set();
      const perKeyWorst = new Map(); // key -> {frame, err, ours, oracle}
      const failSample = []; // first N per-key failures for diagnosis
      const FAIL_SAMPLE_MAX = 8;
      for (let f = 0; f < fixture.globalVars.length; f++) {
        const { c, l, r } = audioFrame(f);
        await page.evaluate(
          (pcm) => window.__milkFrameE2E(pcm),
          { c: Array.from(c), l: Array.from(l), r: Array.from(r) },
        );
        const state = await page.evaluate(() => window.__milkE2EState());
        if (!state) {
          // PHOSPHENE produced no state for this frame — count the whole
          // frame as an equation-state failure and continue.
          equationStateFailsCount++;
          continue;
        }
        comparedFrames++;
        const oracleGlobals = fixture.globalVars[f];
        const oracleFrame = fixture.mdVSFrame?.[String(f)];
        const compareSurface = (surfaceName, oracle, ours) => {
          if (!oracle) return;
          for (const [k, oracleVal] of Object.entries(oracle)) {
            const key = `${surfaceName}.${k}`;
            comparedKeys++;
            const oursVal = ours?.[k];
            if (oursVal === undefined) {
              missingKeys.add(key);
              equationStateFailsCount++;
              if (failSample.length < FAIL_SAMPLE_MAX) {
                failSample.push({ frame: f, key, reason: "missing", oracle: oracleVal });
              }
              continue;
            }
            if (!Number.isFinite(oursVal) && Number.isFinite(oracleVal)) {
              nonfiniteKeys.add(key);
              equationStateFailsCount++;
              if (failSample.length < FAIL_SAMPLE_MAX) {
                failSample.push({ frame: f, key, reason: "nonfinite", ours: oursVal, oracle: oracleVal });
              }
              continue;
            }
            const err = relErr(oursVal, oracleVal);
            const cur = perKeyWorst.get(key);
            if (!cur || err > cur.err) perKeyWorst.set(key, { frame: f, err, ours: oursVal, oracle: oracleVal });
            if (err > EQ_STATE_TOLERANCE) {
              equationStateFailsCount++;
              if (failSample.length < FAIL_SAMPLE_MAX) {
                failSample.push({ frame: f, key, reason: "tolerance",
                  err: Number(err.toExponential(3)), ours: oursVal, oracle: oracleVal });
              }
            } else {
              equationStatePasses++;
            }
          }
          if (ours) {
            for (const k of Object.keys(ours)) {
              if (!(k in oracle)) extraKeys.add(`${surfaceName}.${k}`);
            }
          }
        };
        compareSurface("globals", oracleGlobals, state.globals);
        compareSurface("mdVSFrame", oracleFrame, state.mdVSFrame);
        // Track worst drift across ALL keys (globals + mdVSFrame).
        for (const [key, entry] of perKeyWorst) {
          if (entry.err > worstDrift.err) {
            worstDrift = { key, frame: entry.frame, err: entry.err, ours: entry.ours, oracle: entry.oracle };
          }
        }
        if (CAPTURE_FRAMES.includes(f)) {
          await page.evaluate(() => new Promise((r2) => {
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => r2(null)));
          }));
          const shot = await page.screenshot({ type: "png" });
          const ours = PNG.sync.read(shot);
          writeFileSync(`reference/milk-phosphene-e2e/${entry.slug}/frame-${f}.png`, shot);
          const ref = PNG.sync.read(readFileSync(`reference/milk/${entry.slug}/frame-${f}.png`));
          const cc = ssimColor(ours, ref);
          frames.push({
            frame: f,
            ssimMinChannel: Number(cc.min.toFixed(4)),
            ssimMean: Number(cc.mean.toFixed(4)),
            meanAbsError: Number(meanAbsError(ours, ref).toFixed(2)),
          });
        }
      }
      // Two independent gates: visual (SSIM) and equation state
      // (per-key tolerance). Each is a hard pass/fail — neither is
      // aggregated into the other, both surface on the report row.
      const visualPass = frames.length > 0 && frames.every((fr) => fr.ssimMinChannel >= SSIM_TOLERANCE);
      const equationStatePass = equationStateFailsCount === 0 &&
                                missingKeys.size === 0 &&
                                nonfiniteKeys.size === 0;
      visualPassPersist = visualPass;
      equationStatePassPersist = equationStatePass;
      comparedFramesPersist = comparedFrames;
      comparedKeysPersist = comparedKeys;
      equationStateFailsPersist = equationStateFailsCount;
      missingKeysPersist = [...missingKeys].slice(0, 32);
      extraKeysPersist = [...extraKeys].slice(0, 32);
      nonfiniteKeysPersist = [...nonfiniteKeys].slice(0, 32);
      failSamplePersist = failSample;
    } finally {
      await page.close();
    }
    const overallPass = visualPassPersist && equationStatePassPersist;
    if (overallPass) validated++;
    else diverged++;
    results.push({
      preset: entry.file,
      status: overallPass ? "VALIDATED" : "diverged",
      gates: {
        visual: visualPassPersist ? "PASS" : "FAIL",
        equationState: equationStatePassPersist ? "PASS" : "FAIL",
      },
      frames,
      equationState: {
        comparedFrames: comparedFramesPersist,
        comparedKeys: comparedKeysPersist,
        failsCount: equationStateFailsPersist,
        missingKeys: missingKeysPersist,
        extraKeys: extraKeysPersist,
        nonfiniteKeys: nonfiniteKeysPersist,
        failSample: failSamplePersist,
        tolerance: EQ_STATE_TOLERANCE,
      },
      worstEquationDrift: worstDrift.err > 0 ? { ...worstDrift, err: Number(worstDrift.err.toExponential(3)) } : null,
    });
    const visTag = visualPassPersist ? "vis" : "VIS";
    const eqTag = equationStatePassPersist ? "eq" : "EQ";
    console.log(`${overallPass ? "VALID" : "  div"} [${visTag}/${eqTag}] ` +
      `${frames.map((fr) => fr.ssimMinChannel.toFixed(2)).join(" ")}  ${entry.file.slice(0, 56)}`);
  }
} finally {
  await browser.close();
  preview.kill("SIGKILL");
}

const unsupportedByFeature = {};
for (const r of results) {
  if (r.status !== "unsupported") continue;
  for (const f of r.features ?? []) {
    const key = f.replace(/\s*\(.*$/, "");
    unsupportedByFeature[key] = (unsupportedByFeature[key] || 0) + 1;
  }
}
// Executable = presets that actually ran the pipeline and produced a
// frame set. `results` already excludes fixture failures (`entry.error`
// short-circuit above increments skipped without pushing to results), so
// executable derives from run outcomes, not from subtracting skipped a
// second time from results.length.
const executable = validated + diverged;
const totalCorpusPresets = manifest.presets.length;
const fixtureConvertFailures = skipped;
const presetsTested = results.length;
const refused = unsupported;
// Two-gate aggregation across the executable set: how many executables
// passed the visual gate independent of equation state, and vice versa.
let visualPassCount = 0, equationStatePassCount = 0;
for (const r of results) {
  if (r.status !== "VALIDATED" && r.status !== "diverged") continue;
  if (r.gates?.visual === "PASS") visualPassCount++;
  if (r.gates?.equationState === "PASS") equationStatePassCount++;
}
// Balance assertions — refuse to write a report that does not add up.
const assert = (cond, msg) => { if (!cond) throw new Error(`count balance: ${msg}`); };
assert(totalCorpusPresets === fixtureConvertFailures + presetsTested,
  `total=${totalCorpusPresets} != fixture-failed(${fixtureConvertFailures}) + tested(${presetsTested})`);
assert(presetsTested === refused + loadFailed + executable,
  `tested=${presetsTested} != refused(${refused}) + load-failed(${loadFailed}) + executable(${executable})`);
assert(executable === validated + diverged,
  `executable=${executable} != validated(${validated}) + diverged(${diverged})`);
const report = {
  measures: "END-TO-END MilkDrop fidelity: PHOSPHENE derives its own audio levels + frame globals + EEL evaluations + rendering from only the .milk source + PCM + committed seed. Two independent gates per executable preset — visual (SSIM per capture frame) and equation state (per-key relative error per frame). Overall status = both gates pass.",
  path: "graph milk path (milkToGraph -> MilkPipeline dispatched per-node from graph.order); no oracle values injected.",
  commitSha: COMMIT_SHA,
  gates: {
    visual: { metric: "min per-channel color SSIM", tolerance: SSIM_TOLERANCE, rule: "every capture frame, every channel" },
    equationState: {
      metric: "relative error per oracle key per frame",
      tolerance: EQ_STATE_TOLERANCE,
      rule: "every executable preset, every frame, every oracle key must be present, finite where oracle is finite, and within tolerance",
    },
  },
  captureFrames: CAPTURE_FRAMES,
  counts: {
    totalCorpusPresets,
    fixtureConvertFailures,
    presetsTested,
    refused,
    loadFailed,
    executable,
    validatedExecutable: validated,
    divergedExecutable: diverged,
    visualGatePassExecutable: visualPassCount,
    equationStateGatePassExecutable: equationStatePassCount,
    unsupportedByFeature,
  },
  results,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\ncorpus ${totalCorpusPresets} = fixture-failed ${fixtureConvertFailures} + tested ${presetsTested}`);
console.log(`tested ${presetsTested} = refused ${refused} + load-failed ${loadFailed} + executable ${executable}`);
console.log(`executable ${executable} = validated ${validated} (both gates) + diverged ${diverged} (either gate)`);
console.log(`gate detail: visual PASS ${visualPassCount}/${executable}, equation-state PASS ${equationStatePassCount}/${executable}`);
console.log(`report: ${out}`);
