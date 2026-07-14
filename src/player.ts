import "./style.css";
import "./player.css";
import { Renderer } from "./gpu/renderer";
import { AudioEngine } from "./audio/sources";
import { ModEngine } from "./core/mods";
import { isScene, normalizeScene, STAGES, type Scene } from "./core/types";
import { builtinScenes } from "./shaders/library";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const COMMUNITY_MANIFEST =
  "https://raw.githubusercontent.com/Stuff-is-Parts/sip-phosphene/main/scenes/manifest.json";
const COMMUNITY_BASE =
  "https://raw.githubusercontent.com/Stuff-is-Parts/sip-phosphene/main/scenes/";

interface Entry { scene: Scene; origin: "BUILT-IN" | "COMMUNITY" }

let entries: Entry[] = builtinScenes().map((scene) => ({ scene, origin: "BUILT-IN" }));
let idx = 0;
let fade = 1;
let fadeTarget = 1;
let pending: number | null = null;
let autoCycle = false;
let autoTimer = 0;
let hudHidden = false;

const audio = new AudioEngine();
const mods = new ModEngine();
const renderer = new Renderer();
const t0 = performance.now();
const nowT = () => (performance.now() - t0) / 1000;

/* ------------------------- community scenes -------------------------- */
async function loadCommunity(): Promise<void> {
  // Live from the repo's main branch — merged PRs appear with no rebuild.
  // Falls back to same-origin copy (bundled at deploy), then silently to built-ins.
  const sources = [COMMUNITY_MANIFEST, "./scenes/manifest.json"];
  for (const url of sources) {
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (!r.ok) continue;
      const manifest: string[] = await r.json();
      const base = url.startsWith("http") ? COMMUNITY_BASE : "./scenes/";
      const loaded = await Promise.allSettled(
        manifest.map(async (file) => {
          const sr = await fetch(base + file, { cache: "no-cache" });
          const j = await sr.json();
          if (!isScene(j)) throw new Error("invalid scene");
          return normalizeScene(j);
        }),
      );
      const ok = loaded
        .filter((x): x is PromiseFulfilledResult<Scene> => x.status === "fulfilled")
        .map((x) => x.value);
      if (ok.length) {
        const names = new Set(entries.map((e) => e.scene.name));
        for (const s of ok) {
          if (!names.has(s.name)) entries.push({ scene: s, origin: "COMMUNITY" });
        }
      }
      return;
    } catch { /* try next source */ }
  }
}

/* ------------------------------ scenes ------------------------------- */
async function applyScene(i: number): Promise<void> {
  idx = ((i % entries.length) + entries.length) % entries.length;
  const e = entries[idx];
  mods.reset();
  for (const s of STAGES) {
    await renderer.compileStage(s, e.scene.layers[s].code);
  }
  $("sceneName").textContent = e.scene.name;
  $("sceneOrigin").textContent = e.origin + " SCENE";
}
function requestScene(i: number): void {
  pending = i;
  fadeTarget = 0;
}
function randomScene(): void {
  if (entries.length < 2) return;
  let r = idx;
  while (r === idx) r = Math.floor(Math.random() * entries.length);
  requestScene(r);
}

/* ------------------------------ render ------------------------------- */
function frame(): void {
  requestAnimationFrame(frame);
  const now = nowT();
  audio.analysis.update(now);

  fade += (fadeTarget - fade) * 0.1;
  if (pending !== null && fade < 0.04) {
    const p = pending;
    pending = null;
    void applyScene(p).then(() => { fadeTarget = 1; });
  }
  if (autoCycle) {
    autoTimer += 1 / 60;
    if (autoTimer > 14) { autoTimer = 0; randomScene(); }
  }

  const e = entries[idx];
  const p = mods.evaluate(e.scene, renderer.stageParams(), audio.analysis, now);
  p.int *= fade; // crossfade through black on scene change

  $("bpm").textContent = (audio.analysis.bpm || "—") + " BPM";
  $("beatDot").style.opacity = String(0.15 + audio.analysis.beat * 0.85);

  renderer.frame(now, audio.analysis, p);
}

/* -------------------------------- ui --------------------------------- */
function dismissSplash(): void {
  $("splash").classList.add("gone");
  $("hud").classList.remove("hidden");
}
function setHidden(h: boolean): void {
  hudHidden = h;
  $("hud").classList.toggle("hidden", h);
}
function fullscreen(): void {
  void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

function wire(): void {
  const startDemo = () => { audio.startDemo(); $("trackLabel").textContent = audio.label; };
  const startMic = async () => {
    try { await audio.startMic(); $("trackLabel").textContent = audio.label; return true; }
    catch (e) {
      $("splashErr").textContent =
        "Microphone unavailable (" + (e as Error).name + ") — demo and file playback still work.";
      return false;
    }
  };
  const pickFile = () => $<HTMLInputElement>("fileAudio").click();

  $("sDemo").addEventListener("click", () => { startDemo(); dismissSplash(); autoCycle = true; $("cAuto").classList.add("on"); });
  $("sMic").addEventListener("click", async () => { if (await startMic()) dismissSplash(); });
  $("sFile").addEventListener("click", pickFile);
  $("cDemo").addEventListener("click", startDemo);
  $("cMic").addEventListener("click", () => void startMic());
  $("cFile").addEventListener("click", pickFile);
  $<HTMLInputElement>("fileAudio").addEventListener("change", async (ev) => {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    try {
      await audio.playFile(f);
      $("trackLabel").textContent = audio.label;
      dismissSplash();
    } catch { $("splashErr").textContent = "Couldn't decode that audio file."; }
  });

  $("cPrev").addEventListener("click", () => requestScene(idx - 1));
  $("cNext").addEventListener("click", () => requestScene(idx + 1));
  $("cRand").addEventListener("click", randomScene);
  $("cAuto").addEventListener("click", (e) => {
    autoCycle = !autoCycle; autoTimer = 0;
    (e.currentTarget as HTMLElement).classList.toggle("on", autoCycle);
  });
  $("cFull").addEventListener("click", fullscreen);

  addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); randomScene(); }
    else if (e.key === "ArrowRight") requestScene(idx + 1);
    else if (e.key === "ArrowLeft") requestScene(idx - 1);
    else if (e.key === "a" || e.key === "A") { autoCycle = !autoCycle; autoTimer = 0; $("cAuto").classList.toggle("on", autoCycle); }
    else if (e.key === "h" || e.key === "H") setHidden(!hudHidden);
    else if (e.key === "f" || e.key === "F") fullscreen();
  });

  let dragDepth = 0;
  addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; $("dropOverlay").style.display = "flex"; });
  addEventListener("dragleave", (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $("dropOverlay").style.display = "none"; } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    $("dropOverlay").style.display = "none";
    const f = [...(e.dataTransfer?.files ?? [])].find(
      (f) => f.type.startsWith("audio") || /\.(mp3|wav|ogg|m4a|flac)$/i.test(f.name));
    if (f) void audio.playFile(f).then(() => { $("trackLabel").textContent = audio.label; dismissSplash(); });
  });
}

/* -------------------------------- boot -------------------------------- */
async function boot(): Promise<void> {
  if (!Renderer.supported()) {
    $("unsupported").hidden = false;
    $("splash").style.display = "none";
    return;
  }
  const stage = $<HTMLCanvasElement>("stage");
  await renderer.init(stage);
  renderer.onDeviceLost = () => {
    void renderer.init(stage).then(() => applyScene(idx));
  };
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    stage.width = Math.max(4, Math.floor(innerWidth * dpr));
    stage.height = Math.max(4, Math.floor(innerHeight * dpr));
    renderer.resize(stage.width, stage.height);
  };
  addEventListener("resize", size);
  size();
  wire();
  await applyScene(0);
  frame();
  void loadCommunity(); // enriches the rotation as it arrives
}

void boot();
