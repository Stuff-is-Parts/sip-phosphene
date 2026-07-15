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
import { CAPTURE_FRAMES, TOTAL_FRAMES, FPS } from "./lib/ref-audio.mjs";
import { MilkAudioModel } from "./lib/milk-audio-model.mjs";
import { ssim, meanAbsError } from "./lib/ssim.mjs";

const out = process.argv[2] ?? "docs/fidelity-milk.json";
const SSIM_TOLERANCE = 0.80;

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
let validated = 0, compileFailed = 0, diverged = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await page.goto(`http://localhost:${PORT}/verify.html`, { waitUntil: "networkidle2", timeout: 20000 });
  await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });

  for (const pair of pairs) {
    const text = readFileSync(pair.corpusFile, "latin1");
    const load = await page.evaluate((t, n) => window.__refLoadMilk(t, n), text, pair.preset);
    if (!load.ok) {
      compileFailed++;
      results.push({ preset: pair.preset, status: "compile-failed", errors: load.errors });
      continue;
    }
    const model = new MilkAudioModel();
    const frames = [];
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
        const shot = await page.screenshot({ type: "png" });
        const ours = PNG.sync.read(shot);
        writeFileSync(`reference/milk-phosphene/${pair.slug}/frame-${f}.png`, shot);
        const refPath = `reference/milk/${pair.slug}/frame-${f}.png`;
        const ref = PNG.sync.read(readFileSync(refPath));
        frames.push({
          frame: f,
          ssim: Number(ssim(ours, ref).toFixed(4)),
          meanAbsError: Number(meanAbsError(ours, ref).toFixed(2)),
        });
      }
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
  measures: "reference-validated fidelity: SSIM vs Butterchurn oracle renders under identical deterministic audio and frame times",
  tolerance: { ssim: SSIM_TOLERANCE, rule: "every capture frame must reach tolerance; committed before implementation per COMPATIBILITY-GOAL.md" },
  captureFrames: CAPTURE_FRAMES,
  pairsTested: pairs.length,
  validated, diverged, compileFailed,
  results,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nVALIDATED ${validated} / ${pairs.length} (diverged ${diverged}, compile-failed ${compileFailed})`);
console.log(`report: ${out}`);
