// Render MilkDrop reference fixtures via Butterchurn under headless Edge,
// with INTRINSIC source identity: each oracle preset is converted in-page
// from the exact corpus .milk text (authoritative converter,
// milkdrop-preset-converter) — the fixture and the PHOSPHENE validation
// render share one source file by construction. No name matching.
//
// Per preset (committed determinism protocol):
// - fresh page; seeded Math.random installed before any page script and
//   reset independently per preset (COMMITTED SEED 0x5eed1e55);
// - shared deterministic audio (scripts/lib/ref-audio.mjs) at fixed frame
//   times; screenshots at CAPTURE_FRAMES;
// - per-frame equation-facing globalVars and capture-frame mdVSFrame
//   extracted from the running oracle into <slug>/frames.json — the
//   witnessed frame-context values PHOSPHENE must reproduce
//   (scripts/validate-audio-model.mjs proves the ported audio/time model
//   against these).
//
// Usage: node scripts/reference-milk.mjs [maxPresets] [width] [height]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { audioFrame, CAPTURE_FRAMES, TOTAL_FRAMES, FPS } from "./lib/ref-audio.mjs";

const maxPresets = parseInt(process.argv[2] ?? "100", 10);
const W = parseInt(process.argv[3] ?? "800", 10);
const H = parseInt(process.argv[4] ?? "600", 10);
export const ORACLE_SEED = 0x5eed1e55;

const CORPUS_ROOT = "scenes/projectM/presets-cream-of-the-crop-master";

const EDGE_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browserPath = EDGE_PATHS.find((p) => existsSync(p));
if (!browserPath) { console.error("no Edge found"); process.exit(1); }

// Deterministic diverse selection: sorted corpus, stride-sampled.
const all = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(".milk")) all.push(p);
  }
})(CORPUS_ROOT);
all.sort();
const step = Math.max(1, Math.floor(all.length / Math.min(maxPresets, all.length)));
const files = [];
for (let i = 0; i < all.length && files.length < maxPresets; i += step) files.push(all[i]);
console.log(`corpus .milk files: ${all.length}; selected: ${files.length}`);

const slugOf = (rel) => rel.replace(/\.milk$/i, "").replace(/[^\w\- ]+/g, "").trim()
  .replace(/[\s\\/]+/g, "_").slice(0, 90);

const browser = await puppeteer.launch({
  executablePath: browserPath, headless: true,
  args: ["--headless=new", "--enable-gpu", "--use-angle=default", `--window-size=${W},${H}`,
         "--autoplay-policy=no-user-gesture-required"],
});

const manifest = [];
let ok = 0, failed = 0;
try {
  for (const file of files) {
    const rel = relative(CORPUS_ROOT, file);
    const slug = slugOf(rel);
    const text = readFileSync(file, "latin1");
    const sha256 = createHash("sha256").update(text, "latin1").digest("hex");

    const page = await browser.newPage();
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
      }, ORACLE_SEED);
      page.on("pageerror", (e) => console.error("pageerror:", String(e).slice(0, 160)));
      await page.goto(pathToFileURL("reference/butterchurn-ref.html").href,
        { waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
      // Independent per-preset reseed (the committed protocol): page
      // startup may consume entropy; the preset stream starts here.
      await page.evaluate((seed) => window.__refReseed(seed), ORACLE_SEED);
      // Random-stream instrumentation: reset the trace and tag the
      // upcoming draws as visualizer construction + preset load. When
      // the oracle draws rand_start (4) + rand_preset (4) during the
      // preset-init phase, those go under the "load" context;
      // subsequent per-frame draws (frame/pixel/wave/shape EEL) get
      // re-tagged before __refFrame calls.
      await page.evaluate(() => window.__refResetRandTrace());
      await page.evaluate(() => window.__refSetRandContext("load"));
      const init = await page.evaluate(
        (t, w, h) => window.__refLoadMilkSource(t, w, h), text, W, H);
      if (!init.ok) {
        failed++;
        manifest.push({ file: rel, sha256, slug, error: `convert/load: ${init.error}` });
        console.error(`FAIL ${rel}: ${init.error}`);
        continue;
      }
      const dir = `reference/milk/${slug}`;
      mkdirSync(dir, { recursive: true });
      const perFrameGlobals = [];
      // Full post-per-frame mdVSFrame captured for EVERY frame, not
      // only screenshot frames — the equation-state gate at
      // validate-milk-e2e.mjs compares per-key per-frame, so every
      // frame needs the oracle state to compare against.
      const mdVSFrames = {};
      // Snapshot the random-trace produced during preset load (visualizer
      // construction + preset conversion + rand_start + rand_preset +
      // init_eqs + init-time frame_eqs). This lets a validator compare
      // PHOSPHENE's preset-load draw sequence against the oracle's
      // witnessed order and values. The trace is reset after snapshot
      // so per-frame draws are captured separately.
      const loadRandTrace = await page.evaluate(() => window.__refRandTrace());
      await page.evaluate(() => window.__refResetRandTrace());
      // Per-frame random-trace slices: draws made during frame f
      // (frame_eqs + pixel_eqs + wave frame/point + shape frame). The
      // context tag reflects the frame index so the validator can
      // slice by frame and compare against PHOSPHENE's own draw
      // sequence.
      const frameRandTraces = [];
      for (let f = 0; f <= TOTAL_FRAMES; f++) {
        const { c, l, r } = audioFrame(f);
        await page.evaluate((tag) => window.__refSetRandContext(tag), `frame:${f}`);
        // Frame time (f+1)/FPS: the page derives elapsed = dt from the
        // previous call, so EVERY frame including the first gets elapsed
        // = 1/FPS. An elapsed of 0 is falsy and butterchurn falls back to
        // wall-clock timing (butterchurn.js calcTimeAndFPS `if
        // (elapsedTime)`) — which would make the fps series, and every
        // equation reading time/fps, nondeterministic.
        await page.evaluate(
          (t, ca, la, ra) => window.__refFrame(t, ca, la, ra),
          (f + 1) / FPS, Array.from(c), Array.from(l), Array.from(r),
        );
        const state = await page.evaluate(() => window.__refState());
        perFrameGlobals.push(state.globalVars);
        mdVSFrames[f] = state.mdVSFrame;
        const trace = await page.evaluate(() => window.__refRandTrace());
        if (trace.length) frameRandTraces.push({ frame: f, draws: trace });
        await page.evaluate(() => window.__refResetRandTrace());
        if (CAPTURE_FRAMES.includes(f)) {
          writeFileSync(`${dir}/frame-${f}.png`, await page.screenshot({ type: "png" }));
        }
      }
      writeFileSync(`${dir}/frames.json`, JSON.stringify({
        globalVars: perFrameGlobals, mdVSFrame: mdVSFrames,
        randTrace: { load: loadRandTrace, frames: frameRandTraces },
      }));
      ok++;
      manifest.push({ file: rel, sha256, slug, frames: CAPTURE_FRAMES, size: [W, H] });
      console.log(`captured: ${rel} -> ${dir}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

mkdirSync("reference/milk", { recursive: true });
writeFileSync("reference/milk/manifest.json", JSON.stringify({
  renderer: "butterchurn 2.6.7 (MIT) + milkdrop-preset-converter 0.1.2 — validation oracle per COMPATIBILITY-GOAL.md; source identity intrinsic (converted in-page from the exact corpus file; sha256 recorded)",
  audio: "scripts/lib/ref-audio.mjs (deterministic)",
  seed: ORACLE_SEED,
  sampleRate: 44100,
  corpus: CORPUS_ROOT,
  fps: FPS, captureFrames: CAPTURE_FRAMES, presets: manifest,
}, null, 2));
console.log(`presets captured ${ok}, failed ${failed}; manifest: reference/milk/manifest.json`);
