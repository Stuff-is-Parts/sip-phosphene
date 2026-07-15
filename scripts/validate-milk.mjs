// FIDELITY validation through the GRAPH MILK PATH (MilkPipeline): render
// the EXACT corpus .milk files the oracle rendered (identity intrinsic —
// the manifest records corpus path + sha256, re-verified here), with the
// oracle's own per-frame globals and the oracle-validated audio arrays,
// and compare screenshots at the shared capture frames.
//
// This is the only metric that counts as compatibility progress per
// COMPATIBILITY-GOAL.md. TOLERANCE (committed before implementation
// tuning, per the Correctness Standard): a frame matches when EVERY RGB
// channel reaches SSIM >= 0.80; a preset is VALIDATED when every capture
// frame matches.
//
// Presets that require MilkDrop 2 warp/comp shaders REFUSE (the pipeline
// names the missing feature) and are reported as unsupported — never
// approximated, never counted as validated.
//
// Prereq: node scripts/reference-milk.mjs  (builds reference/milk)
// Usage: node scripts/validate-milk.mjs [out] [presetFilterSubstring]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, execSync, execFileSync } from "node:child_process";

// Embed the exact HEAD SHA in every report so the evidence is verifiable.
let COMMIT_SHA = "unknown";
try { COMMIT_SHA = execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(); } catch { /* not a repo */ }
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import { OracleAudioProcessor } from "./lib/milk-audio-model.mjs";
import { audioFrame } from "./lib/ref-audio.mjs";
import { ssimColor, meanAbsError } from "./lib/ssim.mjs";

const out = process.argv[2] ?? "docs/fidelity-milk.json";
// Committed tolerance: SSIM >= 0.80 on EVERY RGB channel per capture frame.
const SSIM_TOLERANCE = 0.80;
const SEED = 0x5eed1e55; // same committed seed as the oracle renders

// Build the current source before validating (validation must exercise
// the code as it exists now, not a stale bundle).
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
const PORT = process.env.VALIDATE_PORT ?? "4222";
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
mkdirSync("reference/milk-phosphene", { recursive: true });

// Base globals the executor consumes (regs stay renderer-owned inside
// the pipeline; the fixture's globalVars may carry oracle reg values,
// which must NOT be injected).
const BASE_KEYS = [
  "frame", "time", "fps", "bass", "bass_att", "mid", "mid_att",
  "treb", "treb_att", "meshx", "meshy", "aspectx", "aspecty",
  "pixelsx", "pixelsy",
];

const filter = process.argv[3] ?? "";

const results = [];
let validated = 0, loadFailed = 0, diverged = 0, unsupported = 0, skipped = 0;
try {
  for (const entry of manifest.presets) {
    if (entry.error) { skipped++; continue; }
    if (filter && !entry.file.includes(filter)) continue;
    const corpusPath = join(manifest.corpus, entry.file);
    const text = readFileSync(corpusPath, "latin1");
    const sha256 = createHash("sha256").update(text, "latin1").digest("hex");
    if (sha256 !== entry.sha256) {
      throw new Error(`corpus file changed since fixtures were generated: ${entry.file}`);
    }
    const fixture = JSON.parse(readFileSync(`reference/milk/${entry.slug}/frames.json`, "utf8"));

    // Clean renderer state + committed seed per preset: fresh page.
    const page = await browser.newPage();
    let frames;
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
      // Independent reseed before load (the committed protocol).
      await page.evaluate((seed) => {
        let s = seed | 0;
        Math.random = () => {
          s |= 0; s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }, SEED);
      const load = await page.evaluate((t, n) => window.__milkLoadGraph(t, n), text, entry.file);
      if (load.unsupported) {
        unsupported++;
        results.push({ preset: entry.file, status: "unsupported", features: load.unsupported });
        console.log(`UNSUP ${entry.file.slice(0, 56)}: ${load.unsupported.join("; ").slice(0, 60)}`);
        continue;
      }
      if (!load.ok) {
        loadFailed++;
        results.push({ preset: entry.file, status: "load-failed", errors: load.errors });
        console.log(`LFAIL ${entry.file.slice(0, 60)}: ${(load.errors ?? []).join("; ").slice(0, 80)}`);
        continue;
      }
      const audio = new OracleAudioProcessor();
      frames = [];
      mkdirSync(`reference/milk-phosphene/${entry.slug}`, { recursive: true });
      for (let f = 0; f < fixture.globalVars.length; f++) {
        const { c, l, r } = audioFrame(f);
        audio.updateAudio(c, l, r);
        const globals = {};
        for (const k of BASE_KEYS) globals[k] = fixture.globalVars[f][k];
        await page.evaluate(
          (d) => window.__milkFrameGraph(d),
          {
            globals,
            timeArrayL: Array.from(audio.timeArrayL),
            timeArrayR: Array.from(audio.timeArrayR),
            freqArrayL: Array.from(audio.freqArrayL),
            freqArrayR: Array.from(audio.freqArrayR),
          },
        );
        if (CAPTURE_FRAMES.includes(f)) {
          await page.evaluate(() => new Promise((r2) => {
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => r2(null)));
          }));
          const shot = await page.screenshot({ type: "png" });
          const ours = PNG.sync.read(shot);
          writeFileSync(`reference/milk-phosphene/${entry.slug}/frame-${f}.png`, shot);
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
    } finally {
      await page.close();
    }
    // EVERY RGB channel must reach tolerance on every capture frame.
    const allMatch = frames.every((fr) => fr.ssimMinChannel >= SSIM_TOLERANCE);
    if (allMatch) validated++;
    else diverged++;
    results.push({ preset: entry.file, status: allMatch ? "VALIDATED" : "diverged", frames });
    console.log(`${allMatch ? "VALID" : "  div"} ${frames.map((fr) => fr.ssimMinChannel.toFixed(2)).join(" ")}  ${entry.file.slice(0, 60)}`);
  }
} finally {
  await browser.close();
  preview.kill("SIGKILL");
}

// Group unsupported reasons by exact feature name — not the flattened
// "shader presets" label. The pipeline's UnsupportedGraphError feature
// list carries the concrete refusal (perPixelInit, gmegabuf, warpShader,
// compShader, blur, etc.) so callers see WHY each preset refused.
const unsupportedByFeature = {};
for (const r of results) {
  if (r.status !== "unsupported") continue;
  for (const f of r.features ?? []) {
    // Trim any parenthetical explanation to a stable feature key.
    const key = f.replace(/\s*\(.*$/, "");
    unsupportedByFeature[key] = (unsupportedByFeature[key] || 0) + 1;
  }
}
// Executable = presets that actually ran through the pipeline and produced
// a frame set. `results` already excludes fixture failures (those short-
// circuited at `if (entry.error) skipped++`), so executable is derived
// from the run outcomes, not from subtracting skipped a second time.
const executable = validated + diverged;
const totalCorpusPresets = manifest.presets.length;
const fixtureConvertFailures = skipped;
const presetsTested = results.length;
const refused = unsupported;
// Count-balance assertions — a report cannot be written unless every
// relationship holds. Prevents the mis-accounting the earlier reports had.
const assert = (cond, msg) => { if (!cond) throw new Error(`count balance: ${msg}`); };
assert(totalCorpusPresets === fixtureConvertFailures + presetsTested,
  `total=${totalCorpusPresets} != fixture-failed(${fixtureConvertFailures}) + tested(${presetsTested})`);
assert(presetsTested === refused + loadFailed + executable,
  `tested=${presetsTested} != refused(${refused}) + load-failed(${loadFailed}) + executable(${executable})`);
assert(executable === validated + diverged,
  `executable=${executable} != validated(${validated}) + diverged(${diverged})`);
const report = {
  measures: "reference-validated fidelity of the GRAPH MILK PATH (MilkPipeline on WebGPU) vs the seeded Butterchurn oracle: identical corpus source file (sha256-verified), oracle per-frame globals, oracle audio chain; gate = SSIM >= tolerance on EVERY RGB channel at every capture frame",
  path: "graph milk path (milkToGraph -> MilkPipeline); presets refusing at load carry their exact feature list",
  commitSha: COMMIT_SHA,
  tolerance: { ssim: SSIM_TOLERANCE, metric: "min per-channel color SSIM", rule: "every capture frame, every channel; committed before implementation per COMPATIBILITY-GOAL.md" },
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
    unsupportedByFeature,
  },
  results,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\ncorpus ${totalCorpusPresets} = fixture-failed ${fixtureConvertFailures} + tested ${presetsTested}`);
console.log(`tested ${presetsTested} = refused ${refused} + load-failed ${loadFailed} + executable ${executable}`);
console.log(`executable ${executable} = validated ${validated} + diverged ${diverged}`);
console.log(`report: ${out}`);
