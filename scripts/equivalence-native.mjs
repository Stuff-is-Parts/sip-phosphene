// Native equivalence gate (continuation assignment, completion gate 1):
// every shipped native scene renders through the LEGACY path and the
// GRAPH-EXECUTOR path in separate clean page sessions, under identical
// injected audio and frame times; screenshots at shared frames must match.
//
// TOLERANCE (committed before results): mean SSIM >= 0.995 per compared
// frame. The two paths drive the same GPU pipelines with the same
// modulation engine, so near-exactness is the requirement — anything
// lower indicates the lowering or executor changes behavior.
//
// Usage: node scripts/equivalence-native.mjs [out]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import { FPS } from "./lib/ref-audio.mjs";
import { MilkAudioModel } from "./lib/milk-audio-model.mjs";
import { ssim } from "./lib/ssim.mjs";

const out = process.argv[2] ?? "docs/equivalence-native.json";
const SSIM_TOLERANCE = 0.995;
const COMPARE_FRAMES = [5, 20, 45];
const TOTAL = 46;
const W = 800, H = 600;

const sceneFiles = readdirSync("scenes").filter((f) => f.endsWith(".phos.json"));
console.log(`native scenes: ${sceneFiles.length}`);

const EDGE_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browserPath = EDGE_PATHS.find((p) => existsSync(p));
const PORT = process.env.EQUIV_PORT ?? "4223";
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

/** Render a scene through one path in a fresh page; return captures. */
async function renderPath(sceneJson, path) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: W, height: H });
    // Committed seed: identical Math.random streams in both sessions
    // (mulberry32; seed constant is part of the equivalence contract).
    await page.evaluateOnNewDocument(() => {
      let s = 0x9e3779b9;
      Math.random = () => {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
    await page.goto(`http://localhost:${PORT}/verify.html`, { waitUntil: "networkidle2", timeout: 20000 });
    await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
    // Reseed at load time so both paths consume identical entropy streams
    // from this point regardless of startup draw counts.
    await page.evaluate(() => {
      let s = 0x1234abcd;
      Math.random = () => {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
    const load = await page.evaluate((s, p) => window.__equivLoad(s, p), sceneJson, path);
    if (!load.ok) return { error: load.errors.join("; ") };
    const model = new MilkAudioModel();
    const shots = new Map();
    for (let f = 0; f <= TOTAL; f++) {
      const features = model.features(f);
      await page.evaluate(
        (t, feat) => window.__equivFrame(t, {
          ...feat,
          spec: Float32Array.from(feat.spec),
          wave: Float32Array.from(feat.wave),
        }),
        f / FPS,
        { ...features, spec: Array.from(features.spec), wave: Array.from(features.wave) },
      );
      if (COMPARE_FRAMES.includes(f)) {
        // Drain GPU presentation before capturing (double-rAF) so the
        // screenshot shows THIS frame, not a racing previous one.
        await page.evaluate(() => new Promise((r) => {
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => r(null)));
        }));
        shots.set(f, PNG.sync.read(await page.screenshot({ type: "png" })));
      }
    }
    return { shots };
  } finally {
    await page.close();
  }
}

const results = [];
let passCount = 0, failCount = 0, loadFail = 0;
try {
  for (const file of sceneFiles) {
    const sceneJson = readFileSync(`scenes/${file}`, "utf8");
    const legacy = await renderPath(sceneJson, "legacy");
    const graph = await renderPath(sceneJson, "graph");
    if (legacy.error || graph.error) {
      loadFail++;
      results.push({ scene: file, status: "load-failed", legacy: legacy.error, graph: graph.error });
      console.log(`LOAD-FAIL ${file}: legacy=${legacy.error ?? "ok"} graph=${graph.error ?? "ok"}`);
      continue;
    }
    const frames = COMPARE_FRAMES.map((f) => ({
      frame: f,
      ssim: Number(ssim(legacy.shots.get(f), graph.shots.get(f)).toFixed(5)),
    }));
    const pass = frames.every((fr) => fr.ssim >= SSIM_TOLERANCE);
    if (pass) passCount++; else failCount++;
    results.push({ scene: file, status: pass ? "EQUIVALENT" : "DIVERGED", frames });
    console.log(`${pass ? "EQUIV" : " DIVG"} ${frames.map((fr) => fr.ssim.toFixed(3)).join(" ")}  ${file}`);
  }
} finally {
  await browser.close();
  preview.kill("SIGKILL");
}

const report = {
  measures: "pixel equivalence of the graph-executor path against the legacy renderer path under identical inputs",
  tolerance: { ssim: SSIM_TOLERANCE, frames: COMPARE_FRAMES },
  scenes: sceneFiles.length,
  equivalent: passCount, diverged: failCount, loadFailed: loadFail,
  results,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nEQUIVALENT ${passCount}/${sceneFiles.length} (diverged ${failCount}, load-failed ${loadFail})`);
console.log(`report: ${out}`);
