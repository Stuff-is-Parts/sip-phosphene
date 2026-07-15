// Render-verifies corpus files end to end on the real GPU: import, compile
// every stage, render frames with synthetic audio, screenshot, and bucket
// each file as parse-fail / compile-fail / gpu-error / black / pass.
// Usage: node scripts/verify-corpus.mjs <p9|milk> <dir> [limit] [reportPath]
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";

const [kind, root, limitArg, reportPath] = process.argv.slice(2);
const limit = parseInt(limitArg ?? "0", 10) || Infinity;
const ext = kind === "p9" ? ".p9c" : ".milk";
const nameFilter = process.env.VERIFY_FILTER ?? "";

const all = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith(ext)) all.push(p);
  }
})(root);
all.sort();
if (nameFilter) {
  const filtered = all.filter((f) => f.toLowerCase().includes(nameFilter.toLowerCase()));
  all.length = 0;
  all.push(...filtered);
}
// stratified selection: even spread across the sorted corpus
const files = [];
const step = Math.max(1, Math.floor(all.length / Math.min(limit, all.length)));
for (let i = 0; i < all.length && files.length < limit; i += step) files.push(all[i]);
console.log(`verifying ${files.length}/${all.length} ${kind} files`);

const EDGE_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const browserPath = EDGE_PATHS.find((p) => existsSync(p));
if (!browserPath) { console.error("no Edge found"); process.exit(1); }

const PORT = process.env.VERIFY_PORT ?? "4193";
const preview = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "preview", "--port", PORT, "--strictPort",
], { stdio: "pipe" });
await new Promise((resolve, reject) => {
  preview.stdout.on("data", (d) => { if (String(d).includes(PORT)) resolve(); });
  preview.on("exit", () => reject(new Error("vite preview exited early")));
  setTimeout(() => reject(new Error("vite preview did not start")), 15000);
});

function litRatio(buf) {
  const png = PNG.sync.read(buf);
  let lit = 0;
  const total = png.width * png.height;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (png.data[o] > 12 || png.data[o + 1] > 12 || png.data[o + 2] > 12) lit++;
  }
  return lit / total;
}

const buckets = { pass: 0, black: 0, "compile-fail": 0, "gpu-error": 0, "parse-fail": 0 };
const failures = [];
const browser = await puppeteer.launch({
  executablePath: browserPath, headless: true,
  args: ["--headless=new", "--enable-unsafe-webgpu", "--enable-gpu", "--window-size=800,600"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  let gpuErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) gpuErrors.push(m.text());
  });
  page.on("pageerror", (e) => gpuErrors.push(String(e)));
  // MilkDrop presets share compiled bundle state across page loads in ways
  // that reveal an intermittent renderer bug (~2% of the corpus). A page
  // reload isolates each preset. Default 25 for the milk corpus.
  const isolateEvery = parseInt(process.env.VERIFY_ISOLATE ?? (kind === "milk" ? "25" : "0"), 10);
  let pageAge = 0;
  const openPage = async () => {
    await page.goto(`http://localhost:${PORT}/verify.html`, { waitUntil: "networkidle2", timeout: 20000 });
    await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
    pageAge = 0;
  };
  await openPage();

  let done = 0;
  for (const f of files) {
    const name = relative(root, f);
    gpuErrors = [];
    if (isolateEvery && pageAge >= isolateEvery) await openPage();
    pageAge++;
    let verdict;
    try {
      if (kind === "p9") {
        const b64 = readFileSync(f).toString("base64");
        verdict = await page.evaluate((b, n) => window.__verifyP9(b, n), b64, name);
      } else {
        const text = readFileSync(f, "latin1");
        verdict = await page.evaluate((t, n) => window.__verifyMilk(t, n), text, name);
      }
    } catch (err) {
      buckets["parse-fail"]++;
      failures.push({ file: name, bucket: "parse-fail", detail: String(err).slice(0, 160) });
      done++;
      continue;
    }
    if (!verdict.ok) {
      buckets["compile-fail"]++;
      failures.push({ file: name, bucket: "compile-fail", detail: verdict.errors.join("; ").slice(0, 200) });
    } else if (gpuErrors.length) {
      buckets["gpu-error"]++;
      failures.push({ file: name, bucket: "gpu-error", detail: gpuErrors.join("; ").slice(0, 200) });
    } else {
      const shot = await page.screenshot({ type: "png" });
      if (litRatio(shot) < 0.002) {
        buckets.black++;
        failures.push({ file: name, bucket: "black", detail: "no lit pixels after 8 frames" });
      } else {
        buckets.pass++;
      }
    }
    done++;
    if (done % 50 === 0) console.log(`${done}/${files.length}`, JSON.stringify(buckets));
  }
} finally {
  await browser.close();
  preview.kill("SIGKILL");
}

const report = { kind, total: files.length, buckets, failures };
const out = reportPath ?? `docs/render-verify-${kind}.json`;
writeFileSync(out, JSON.stringify(report, null, 2));
console.log("FINAL", JSON.stringify(buckets));
console.log(`report: ${out} (${failures.length} failures listed)`);
