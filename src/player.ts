import "./style.css";
import "./player.css";
import { Renderer } from "./gpu/renderer";
import { AudioEngine } from "./audio/sources";
import { ModEngine } from "./core/mods";
import { meshWarpFor } from "./core/meshwarp";
import { isScene, normalizeScene, STAGES, type Scene } from "./core/types";
import { builtinScenes } from "./shaders/library";
import { CanvasRecorder } from "./core/record";
import { startMidi } from "./core/midi";
import { $ } from "./ui/dom";
import { wireAudioButtons, wireAudioDrop } from "./ui/audio-common";

const COMMUNITY_MANIFEST =
  "https://raw.githubusercontent.com/Stuff-is-Parts/sip-phosphene/main/scenes/manifest.json";
const COMMUNITY_BASE =
  "https://raw.githubusercontent.com/Stuff-is-Parts/sip-phosphene/main/scenes/";

interface Entry { scene: Scene; origin: "BUILT-IN" | "COMMUNITY" }

const entries: Entry[] = builtinScenes().map((scene) => ({ scene, origin: "BUILT-IN" }));
let idx = 0;
let incomingIdx: number | null = null;
let queued: number | null = null;
let autoCycle = false;
let autoTimer = 0;
let cycleEvery = 16;
let hudHidden = false;
let silenceSince: number | null = null;

const audio = new AudioEngine();
const mods = new ModEngine();
const modsIncoming = new ModEngine();
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
async function loadSceneImage(scene: Scene, slot: 0 | 1): Promise<void> {
  const data = scene.assets?.image;
  if (!data) { await renderer.setImage(slot, null); return; }
  try {
    const blob = await (await fetch(data)).blob();
    await renderer.setImage(slot, await createImageBitmap(blob));
  } catch { await renderer.setImage(slot, null); }
}
async function compileInto(i: number, slot: 0 | 1): Promise<void> {
  const e = entries[((i % entries.length) + entries.length) % entries.length];
  for (const s of STAGES) {
    await renderer.compileStage(s, e.scene.layers[s].code, slot);
  }
  await loadSceneImage(e.scene, slot);
}
async function applyScene(i: number): Promise<void> {
  idx = ((i % entries.length) + entries.length) % entries.length;
  mods.reset();
  await compileInto(idx, 0);
  const e = entries[idx];
  $("sceneName").textContent = e.scene.name;
  $("sceneOrigin").textContent = e.origin + " SCENE";
}
function requestScene(i: number): void {
  const target = ((i % entries.length) + entries.length) % entries.length;
  if (target === idx && incomingIdx === null) return;
  if (incomingIdx !== null) { queued = target; return; } // finish current morph first
  incomingIdx = target;
  modsIncoming.reset();
  void compileInto(target, 1).then(() => {
    renderer.beginTransition(Math.floor(Math.random() * 4));
  });
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

  // playlist intelligence: on sustained silence, advance once (Plane9 behavior)
  if (audio.source !== "none") {
    if (audio.analysis.energy < 0.035) {
      if (silenceSince === null) silenceSince = now;
      else if (now - silenceSince > 5 && incomingIdx === null) { silenceSince = null; randomScene(); }
    } else silenceSince = null;
  }
  if (autoCycle && incomingIdx === null) {
    autoTimer += 1 / 60;
    if (autoTimer > cycleEvery) {
      autoTimer = 0;
      cycleEvery = 12 + Math.random() * 10;
      randomScene();
    }
  }

  const p = mods.evaluate(entries[idx].scene, renderer.stageParams(0), audio.analysis, now);
  const mw = meshWarpFor(entries[idx].scene);
  renderer.setWarpMesh(0, mw ? mw.evaluate(mods.exprSnapshot(), now) : null);
  let pIn = null;
  if (incomingIdx !== null && renderer.transitionActive) {
    pIn = modsIncoming.evaluate(entries[incomingIdx].scene, renderer.stageParams(1), audio.analysis, now);
    const mwIn = meshWarpFor(entries[incomingIdx].scene);
    renderer.setWarpMesh(1, mwIn ? mwIn.evaluate(modsIncoming.exprSnapshot(), now) : null);
    if (renderer.advanceTransition(1 / (60 * 1.8))) {
      idx = incomingIdx;
      incomingIdx = null;
      mods.reset();
      const e = entries[idx];
      $("sceneName").textContent = e.scene.name;
      $("sceneOrigin").textContent = e.origin + " SCENE";
      if (queued !== null) { const q = queued; queued = null; requestScene(q); }
    }
  }

  $("bpm").textContent = (audio.analysis.bpm || "—") + " BPM";
  $("beatDot").style.opacity = String(0.15 + audio.analysis.beat * 0.85);

  renderer.frame(now, audio.analysis, p, pIn);
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
  const onSource = (label: string) => { $("trackLabel").textContent = label; dismissSplash(); };
  wireAudioButtons(audio,
    { demo: "cDemo", file: "cFile", mic: "cMic", input: "fileAudio" },
    onSource,
    (msg) => { $("splashErr").textContent = msg + " — demo and file playback still work."; });
  $("sDemo").addEventListener("click", () => {
    audio.startDemo();
    onSource(audio.label);
    autoCycle = true;
    $("cAuto").classList.add("on");
  });
  $("sMic").addEventListener("click", () => $("cMic").click());
  $("sFile").addEventListener("click", () => $("cFile").click());

  $("cPrev").addEventListener("click", () => requestScene(idx - 1));
  $("cNext").addEventListener("click", () => requestScene(idx + 1));
  $("cRand").addEventListener("click", randomScene);
  $("cAuto").addEventListener("click", (e) => {
    autoCycle = !autoCycle; autoTimer = 0;
    (e.currentTarget as HTMLElement).classList.toggle("on", autoCycle);
  });
  $("cFull").addEventListener("click", fullscreen);

  const recorder = new CanvasRecorder();
  $("cRec").addEventListener("click", (e) => {
    const b = e.currentTarget as HTMLElement;
    if (recorder.active) {
      recorder.stop("phosphene-" + entries[idx].scene.name.toLowerCase().replace(/\s+/g, "-") + ".webm");
      b.classList.remove("on");
      b.textContent = "● REC";
    } else {
      recorder.start($<HTMLCanvasElement>("stage"));
      b.classList.add("on");
      b.textContent = "■ STOP";
    }
  });

  addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); randomScene(); }
    else if (e.key === "ArrowRight") requestScene(idx + 1);
    else if (e.key === "ArrowLeft") requestScene(idx - 1);
    else if (e.key === "a" || e.key === "A") { autoCycle = !autoCycle; autoTimer = 0; $("cAuto").classList.toggle("on", autoCycle); }
    else if (e.key === "h" || e.key === "H") setHidden(!hudHidden);
    else if (e.key === "f" || e.key === "F") fullscreen();
    else if (e.key === "m" || e.key === "M") {
      void startMidi((cc, slot) => {
        $("trackLabel").textContent = "MIDI CC" + cc + " -> midi" + (slot + 1);
      }).then((ok) => { if (!ok) $("trackLabel").textContent = "WebMIDI unavailable in this browser"; });
    }
  });

  wireAudioDrop(audio, "dropOverlay", onSource);
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
