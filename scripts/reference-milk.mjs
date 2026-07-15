// Render MilkDrop reference fixtures via Butterchurn under headless Edge.
// For each selected preset: drive TOTAL_FRAMES frames with the shared
// deterministic audio (scripts/lib/ref-audio.mjs) and save PNG screenshots
// at CAPTURE_FRAMES to reference/milk/<slug>/frame-<n>.png.
//
// These images are the validation oracle for converted presets per
// COMPATIBILITY-GOAL.md: PHOSPHENE renders the same preset with the same
// audio bytes at the same frame times and compares.
//
// Usage: node scripts/reference-milk.mjs [maxPresets] [width] [height]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { audioFrame, CAPTURE_FRAMES, TOTAL_FRAMES, FPS } from "./lib/ref-audio.mjs";

const maxPresets = parseInt(process.argv[2] ?? "10", 10);
const W = parseInt(process.argv[3] ?? "800", 10);
const H = parseInt(process.argv[4] ?? "600", 10);

const EDGE_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browserPath = EDGE_PATHS.find((p) => existsSync(p));
if (!browserPath) { console.error("no Edge found"); process.exit(1); }

const slug = (name) => name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 80);

const browser = await puppeteer.launch({
  executablePath: browserPath, headless: true,
  args: ["--headless=new", "--enable-gpu", "--use-angle=default", `--window-size=${W},${H}`,
         "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  page.on("pageerror", (e) => console.error("pageerror:", String(e).slice(0, 200)));
  const url = pathToFileURL("reference/butterchurn-ref.html").href;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });

  const all = await page.evaluate(() => window.__refList());
  console.log(`butterchurn presets available: ${all.length}`);
  const selected = all.slice(0, maxPresets);

  const manifest = [];
  for (const name of selected) {
    const s = slug(name);
    const dir = `reference/milk/${s}`;
    mkdirSync(dir, { recursive: true });
    const init = await page.evaluate((n, w, h) => window.__refInit(n, w, h), name, W, H);
    if (!init.ok) { console.error(`init failed: ${name}: ${init.error}`); continue; }
    const captures = [];
    for (let f = 0; f <= TOTAL_FRAMES; f++) {
      const { c, l, r } = audioFrame(f);
      await page.evaluate(
        (t, ca, la, ra) => window.__refFrame(t, ca, la, ra),
        f / FPS, Array.from(c), Array.from(l), Array.from(r),
      );
      if (CAPTURE_FRAMES.includes(f)) {
        const shot = await page.screenshot({ type: "png" });
        const file = `${dir}/frame-${f}.png`;
        writeFileSync(file, shot);
        captures.push(file);
      }
    }
    manifest.push({ preset: name, slug: s, frames: CAPTURE_FRAMES, size: [W, H] });
    console.log(`captured: ${name} -> ${dir} (${captures.length} frames)`);
  }
  writeFileSync("reference/milk/manifest.json", JSON.stringify({
    renderer: "butterchurn 2.6.7 (MIT) — validation oracle per COMPATIBILITY-GOAL.md",
    audio: "scripts/lib/ref-audio.mjs (deterministic)",
    fps: FPS, captureFrames: CAPTURE_FRAMES, presets: manifest,
  }, null, 2));
  console.log(`manifest: reference/milk/manifest.json (${manifest.length} presets)`);
} finally {
  await browser.close();
}
