// GPU smoke test: renders the real player in headless Edge on this machine's
// GPU and fails unless actual non-black pixels reach the canvas. Catches the
// class of WebGPU failures (bind group mismatches, buffer sizes, pass wiring)
// that static WGSL validation and unit tests cannot see.
// Usage: node scripts/gpu-smoke.mjs   (requires `npm run build` output in dist/)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";

const EDGE_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const CHROME_PATHS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];
const browserPath = [...EDGE_PATHS, ...CHROME_PATHS].find((p) => existsSync(p));
if (!browserPath) {
  console.error("SMOKE FAIL: no Edge or Chrome executable found");
  process.exit(1);
}

const preview = spawn("npx", ["vite", "preview", "--port", "4183", "--strictPort"], {
  shell: true, stdio: "pipe",
});
await new Promise((resolve, reject) => {
  preview.stdout.on("data", (d) => { if (String(d).includes("4183")) resolve(); });
  preview.on("exit", () => reject(new Error("vite preview exited early")));
  setTimeout(() => reject(new Error("vite preview did not start")), 15000);
});

function litRatio(buf) {
  const png = PNG.sync.read(buf);
  let lit = 0;
  const total = png.width * png.height;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (png.data[o] > 16 || png.data[o + 1] > 16 || png.data[o + 2] > 16) lit++;
  }
  return lit / total;
}

let failures = 0;
const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: [
    "--headless=new", "--enable-unsafe-webgpu", "--enable-gpu",
    "--autoplay-policy=no-user-gesture-required", "--window-size=800,600",
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto("http://localhost:4183/", { waitUntil: "networkidle2", timeout: 20000 });
  const hasGpu = await page.evaluate(() => !!navigator.gpu);
  if (!hasGpu) {
    console.error("SMOKE FAIL: headless browser exposes no WebGPU adapter");
    failures++;
  } else {
    await page.click("#sDemo");
    await new Promise((r) => setTimeout(r, 3500));
    const shot = await page.screenshot({ type: "png" });
    const ratio = litRatio(shot);
    console.log(`player lit-pixel ratio: ${(ratio * 100).toFixed(2)}%`);
    if (ratio < 0.005) { console.error("SMOKE FAIL: player canvas is black"); failures++; }
    else console.log("player renders: PASS");
  }
  if (pageErrors.length) {
    console.error("SMOKE FAIL: page errors:\n" + pageErrors.join("\n"));
    failures++;
  }

  const studio = await browser.newPage();
  await studio.setViewport({ width: 800, height: 600 });
  const studioErrors = [];
  studio.on("pageerror", (e) => studioErrors.push(String(e)));
  await studio.goto("http://localhost:4183/studio.html", { waitUntil: "networkidle2", timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  const shot2 = await studio.screenshot({ type: "png" });
  const ratio2 = litRatio(shot2);
  console.log(`studio lit-pixel ratio: ${(ratio2 * 100).toFixed(2)}%`);
  if (ratio2 < 0.005) { console.error("SMOKE FAIL: studio page is black"); failures++; }
  else console.log("studio renders: PASS");
  if (studioErrors.length) {
    console.error("SMOKE FAIL: studio page errors:\n" + studioErrors.join("\n"));
    failures++;
  }
} finally {
  await browser.close();
  preview.kill("SIGKILL");
  spawn("taskkill", ["/F", "/T", "/PID", String(preview.pid)], { shell: true });
}
console.log(failures === 0 ? "GPU SMOKE: ALL PASS" : `GPU SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
