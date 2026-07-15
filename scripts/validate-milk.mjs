// FIDELITY validation: render the EXACT corpus .milk files the oracle
// rendered (identity is intrinsic — the manifest records corpus path +
// sha256, and this harness re-reads and re-hashes the same file), with
// the oracle's own frame times and oracle-validated audio values, and
// compare screenshots at the shared capture frames.
//
// This is the only metric that counts as compatibility progress per
// COMPATIBILITY-GOAL.md. TOLERANCE (committed before implementation
// tuning, per the Correctness Standard): a frame matches when EVERY RGB
// channel reaches SSIM >= 0.80; a preset is VALIDATED when every capture
// frame matches.
//
// PATH LABEL: renders currently go through the LEGACY import path
// (milkToScene approximations). The graph milk path refuses to execute
// until its stage implementations land; results below are labeled with
// the path that produced them.
//
// Prereq: node scripts/reference-milk.mjs  (builds reference/milk)
// Usage: node scripts/validate-milk.mjs [out]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, execSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import { MilkAudioModel } from "./lib/milk-audio-model.mjs";
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

const results = [];
let validated = 0, compileFailed = 0, diverged = 0, skipped = 0;
try {
  for (const entry of manifest.presets) {
    if (entry.error) { skipped++; continue; }
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
      // Independent reseed before load (same protocol as the oracle):
      // startup consumed page-dependent entropy; the preset stream
      // starts here with the committed seed.
      await page.evaluate((seed) => {
        let s = seed | 0;
        Math.random = () => {
          s |= 0; s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }, SEED);
      const load = await page.evaluate((t, n) => window.__refLoadMilk(t, n), text, entry.file);
      if (!load.ok) {
        compileFailed++;
        results.push({ preset: entry.file, status: "compile-failed", errors: load.errors });
        console.log(`CFAIL ${entry.file.slice(0, 60)}`);
        continue;
      }
      const model = new MilkAudioModel();
      frames = [];
      mkdirSync(`reference/milk-phosphene/${entry.slug}`, { recursive: true });
      for (let f = 0; f < fixture.globalVars.length; f++) {
        const features = model.features(f);
        // Frame time: the ORACLE's own integrated time for this frame
        // (globalVars[f].time), so time-driven equations see identical
        // values in both renders.
        const t = fixture.globalVars[f].time;
        await page.evaluate(
          (tt, feat) => window.__refFrame(tt, {
            ...feat,
            spec: Float32Array.from(feat.spec),
            wave: Float32Array.from(feat.wave),
          }),
          t,
          { ...features, spec: Array.from(features.spec), wave: Array.from(features.wave) },
        );
        if (CAPTURE_FRAMES.includes(f)) {
          await page.evaluate(() => new Promise((r) => {
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => r(null)));
          }));
          const shot = await page.screenshot({ type: "png" });
          const ours = PNG.sync.read(shot);
          writeFileSync(`reference/milk-phosphene/${entry.slug}/frame-${f}.png`, shot);
          const ref = PNG.sync.read(readFileSync(`reference/milk/${entry.slug}/frame-${f}.png`));
          const c = ssimColor(ours, ref);
          frames.push({
            frame: f,
            ssimMinChannel: Number(c.min.toFixed(4)),
            ssimMean: Number(c.mean.toFixed(4)),
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

const report = {
  measures: "reference-validated fidelity vs the seeded Butterchurn oracle: identical corpus source file (sha256-verified), oracle frame times, oracle-validated audio values; gate = SSIM >= tolerance on EVERY RGB channel at every capture frame",
  path: "LEGACY import path (milkToScene) — the graph milk path refuses until its stage implementations land; this number is not evidence about the graph executor",
  tolerance: { ssim: SSIM_TOLERANCE, metric: "min per-channel color SSIM", rule: "every capture frame, every channel; committed before implementation per COMPATIBILITY-GOAL.md" },
  captureFrames: CAPTURE_FRAMES,
  presetsTested: results.length,
  validated, diverged, compileFailed, fixtureConvertFailures: skipped,
  results,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nVALIDATED ${validated}/${results.length} (diverged ${diverged}, compile-failed ${compileFailed}, fixture-convert-failed ${skipped})`);
console.log(`report: ${out}`);
