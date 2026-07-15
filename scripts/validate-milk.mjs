// FIDELITY validation: render corpus presets through PHOSPHENE with the
// SAME deterministic audio and frame times the Butterchurn oracle used,
// compare screenshots at the shared capture frames via SSIM, and report.
//
// This is the only metric that counts as compatibility progress per
// COMPATIBILITY-GOAL.md. TOLERANCE (committed here, before any
// implementation tuning, per the Correctness Standard): a frame matches
// at SSIM >= 0.80; a preset is VALIDATED when every capture frame
// matches. Everything below is measured divergence, reported per frame.
//
// Prereq: node scripts/reference-milk.mjs 100  (builds reference/milk)
// Usage: node scripts/validate-milk.mjs [out]
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { CAPTURE_FRAMES, TOTAL_FRAMES, FPS } from "./lib/ref-audio.mjs";
import { MilkAudioModel } from "./lib/milk-audio-model.mjs";
import { ssimColor, meanAbsError } from "./lib/ssim.mjs";
import { eelProofTier } from "./lib/eel-compare.mjs";

const out = process.argv[2] ?? "docs/fidelity-milk.json";
// Tolerance committed at harness creation (SSIM >= 0.80 per capture frame);
// now measured on MEAN PER-CHANNEL COLOR SSIM — a stricter, color-aware
// application of the same committed threshold.
const SSIM_TOLERANCE = 0.80;

// Build the current source before validating (assignment: validation must
// exercise the code as it exists now, not a stale bundle).
console.log("building current source...");
execSync("npm run build", { stdio: "inherit" });

// Correspondence proof: butterchurn's converted preset JSON carries the
// converter's JavaScript form of the ORIGINAL equations (frame_eqs_str).
// A pair validates only when the corpus file's per_frame text proves
// same-source under the tiered comparator (scripts/lib/eel-compare.mjs):
// tier 1 = per-statement equality under conversion-aware normalization,
// tier 2 = whole-body token-multiset equality (framing-independent).
// Name matching alone is never accepted.
const require2 = createRequire(import.meta.url);
const butterchurnPresets = require2("butterchurn-presets/lib/butterchurnPresets.min.js").getPresets();
const corpusPerFrame = (text) => {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^per_frame_(\d+)=(.*)$/.exec(raw.trim());
    if (m) lines[parseInt(m[1], 10) - 1] = m[2];
  }
  return lines.filter((s) => s !== undefined).join("");
};

const manifestPath = "reference/milk/manifest.json";
if (!existsSync(manifestPath)) {
  console.error("reference fixtures missing — run: node scripts/reference-milk.mjs 100");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const [W, H] = manifest.presets[0]?.size ?? [800, 600];

// Match reference presets to corpus .milk files by normalized name.
const corpusRoot = "scenes/projectM/presets-cream-of-the-crop-master";
const corpusFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(".milk")) corpusFiles.push(p);
  }
})(corpusRoot);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const corpusByName = new Map(corpusFiles.map((f) => [
  norm(f.replace(/^.*[\\/]/, "").replace(/\.milk$/i, "")), f,
]));

const pairs = manifest.presets
  .map((p) => ({ ...p, corpusFile: corpusByName.get(norm(p.preset)) }))
  .filter((p) => p.corpusFile);
console.log(`reference presets with corpus sources: ${pairs.length}/${manifest.presets.length}`);

// Serve the built app for verify.html.
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
let validated = 0, compileFailed = 0, diverged = 0, unproven = 0;
try {
  for (const pair of pairs) {
    const text = readFileSync(pair.corpusFile, "latin1");

    // Same-source proof: corpus per_frame text must equal the butterchurn
    // fixture's original equation text after normalization.
    const bcPreset = butterchurnPresets[pair.preset];
    const proofTier = eelProofTier(corpusPerFrame(text), bcPreset?.frame_eqs_str);
    const proof = proofTier > 0;
    if (!proof) {
      unproven++;
      results.push({ preset: pair.preset, status: "correspondence-unproven",
        detail: "corpus per_frame text does not match the fixture's frame_eqs_str" });
      console.log(`UNPRV ${pair.preset.slice(0, 60)}`);
      continue;
    }

    // Clean renderer state per preset: fresh page.
    const page = await browser.newPage();
    let frames;
    try {
      await page.setViewport({ width: W, height: H });
      await page.goto(`http://localhost:${PORT}/verify.html`, { waitUntil: "networkidle2", timeout: 20000 });
      await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
      const load = await page.evaluate((t, n) => window.__refLoadMilk(t, n), text, pair.preset);
      if (!load.ok) {
        compileFailed++;
        results.push({ preset: pair.preset, status: "compile-failed", errors: load.errors });
        continue;
      }
      const model = new MilkAudioModel();
      frames = [];
      mkdirSync(`reference/milk-phosphene/${pair.slug}`, { recursive: true });
      for (let f = 0; f <= TOTAL_FRAMES; f++) {
        const features = model.features(f);
        await page.evaluate(
          (t, feat) => window.__refFrame(t, {
            ...feat,
            spec: Float32Array.from(feat.spec),
            wave: Float32Array.from(feat.wave),
          }),
          f / FPS,
          { ...features, spec: Array.from(features.spec), wave: Array.from(features.wave) },
        );
        if (CAPTURE_FRAMES.includes(f)) {
          await page.evaluate(() => new Promise((r) => {
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => r(null)));
          }));
          const shot = await page.screenshot({ type: "png" });
          const ours = PNG.sync.read(shot);
          writeFileSync(`reference/milk-phosphene/${pair.slug}/frame-${f}.png`, shot);
          const ref = PNG.sync.read(readFileSync(`reference/milk/${pair.slug}/frame-${f}.png`));
          const c = ssimColor(ours, ref);
          frames.push({
            frame: f,
            ssim: Number(c.mean.toFixed(4)),
            ssimMinChannel: Number(c.min.toFixed(4)),
            meanAbsError: Number(meanAbsError(ours, ref).toFixed(2)),
          });
        }
      }
    } finally {
      await page.close();
    }
    const allMatch = frames.every((fr) => fr.ssim >= SSIM_TOLERANCE);
    if (allMatch) validated++;
    else diverged++;
    results.push({ preset: pair.preset, status: allMatch ? "VALIDATED" : "diverged", frames });
    console.log(`${allMatch ? "VALID" : "  div"} ${frames.map((fr) => fr.ssim.toFixed(2)).join(" ")}  ${pair.preset.slice(0, 60)}`);
  }
} finally {
  await browser.close();
  preview.kill("SIGKILL");
}

const report = {
  measures: "reference-validated fidelity: mean per-channel color SSIM vs seeded Butterchurn oracle renders under identical deterministic audio and frame times; correspondence proven by equation-text match",
  tolerance: { ssim: SSIM_TOLERANCE, metric: "mean per-channel color SSIM", rule: "every capture frame must reach tolerance; committed before implementation per COMPATIBILITY-GOAL.md" },
  captureFrames: CAPTURE_FRAMES,
  pairsTested: pairs.length,
  validated, diverged, compileFailed, correspondenceUnproven: unproven,
  results,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nVALIDATED ${validated} / ${pairs.length} (diverged ${diverged}, compile-failed ${compileFailed}, unproven ${unproven})`);
console.log(`report: ${out}`);
