// Null-hypothesis discriminator for equivalence divergences: render the
// SAME path (legacy) in two separate sessions and compare. Divergence here
// is environment nondeterminism, not graph-lowering behavior.
// Usage: node scripts/equivalence-null.mjs scene1 [scene2...]
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import { FPS } from "./lib/ref-audio.mjs";
import { MilkAudioModel } from "./lib/milk-audio-model.mjs";
import { ssim } from "./lib/ssim.mjs";

const scenes = process.argv.slice(2);
const COMPARE_FRAMES = [5, 20, 45];
const TOTAL = 46;
const W = 800, H = 600;

const EDGE_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browserPath = EDGE_PATHS.find((p) => existsSync(p));
const PORT = process.env.EQUIV_PORT ?? "4224";
const preview = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "preview", "--port", PORT, "--strictPort",
], { stdio: "pipe" });
await new Promise((resolve, reject) => {
  preview.stdout.on("data", (d) => { if (String(d).includes(PORT)) resolve(); });
  setTimeout(() => reject(new Error("preview timeout")), 15000);
});
const browser = await puppeteer.launch({
  executablePath: browserPath, headless: true,
  args: ["--headless=new", "--enable-unsafe-webgpu", "--enable-gpu", `--window-size=${W},${H}`],
});

async function renderLegacy(sceneJson) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: W, height: H });
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
    const load = await page.evaluate((s) => window.__equivLoad(s, "legacy"), sceneJson);
    if (!load.ok) return { error: load.errors.join("; ") };
    const model = new MilkAudioModel();
    const shots = new Map();
    for (let f = 0; f <= TOTAL; f++) {
      const features = model.features(f);
      await page.evaluate(
        (t, feat) => window.__equivFrame(t, { ...feat, spec: Float32Array.from(feat.spec), wave: Float32Array.from(feat.wave) }),
        f / FPS,
        { ...features, spec: Array.from(features.spec), wave: Array.from(features.wave) },
      );
      if (COMPARE_FRAMES.includes(f)) {
        await page.evaluate(() => new Promise((r) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => r(null)))));
        shots.set(f, PNG.sync.read(await page.screenshot({ type: "png" })));
      }
    }
    return { shots };
  } finally { await page.close(); }
}

try {
  for (const s of scenes) {
    const json = readFileSync(`scenes/${s}`, "utf8");
    const a = await renderLegacy(json);
    const b = await renderLegacy(json);
    if (a.error || b.error) { console.log(`${s}: load error`); continue; }
    const line = COMPARE_FRAMES.map((f) => ssim(a.shots.get(f), b.shots.get(f)).toFixed(4)).join(" ");
    console.log(`legacy-vs-legacy ${line}  ${s}`);
  }
} finally {
  await browser.close();
  preview.kill("SIGKILL");
}
