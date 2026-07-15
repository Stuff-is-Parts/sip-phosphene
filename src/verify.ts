import { Renderer } from "./gpu/renderer";
import { GraphExecutor, UnsupportedGraphError } from "./gpu/graph-executor";
import { MilkPipeline, type MilkFrameData } from "./gpu/milk-pipeline";
import { ModEngine } from "./core/mods";
import { meshWarpFor } from "./core/meshwarp";
import { particlesFor } from "./core/particles";
import { renderTextImage } from "./core/text";
import { compileSceneToGraph } from "./core/graph-compile";
import { parseMilk, milkToScene } from "./import/milk";
import { parseMilkComplete, milkToGraph } from "./import/milk-graph";
import { parseP9c, p9ToScene } from "./import/p9";
import { OracleFrameModel } from "./core/milk-audio";
import { normalizeScene, STAGES, type AudioFeatures, type Scene } from "./core/types";

/**
 * Render-verification harness: the driver (scripts/verify-corpus.mjs) feeds
 * corpus files to window.__verifyMilk / window.__verifyP9; each imports the
 * file through the real importer, compiles every stage on the real GPU,
 * renders frames with synthetic audio, and returns the compile verdicts.
 * Black-frame detection happens driver-side via screenshots.
 */

const renderer = new Renderer();
const mods = new ModEngine();

function syntheticAudio(t: number): AudioFeatures {
  const spec = new Float32Array(64);
  const wave = new Float32Array(64);
  // Richer spectrum: bass/mid/treble bands each carry independent modulation
  // so scenes reading specific spec[i] indices see live signal in every region.
  for (let i = 0; i < 64; i++) {
    const bassMask = Math.exp(-i / 12);
    const trebleMask = Math.exp(-(63 - i) / 20);
    const midShape = Math.exp(-((i - 22) * (i - 22)) / 96);
    spec[i] = 0.15 + 0.55 * bassMask * (0.6 + 0.4 * Math.sin(t * 1.7 + i * 0.15))
           + 0.35 * midShape * (0.5 + 0.5 * Math.sin(t * 3.1 + i * 0.32))
           + 0.25 * trebleMask * (0.5 + 0.5 * Math.sin(t * 7.3 + i * 0.6));
    wave[i] = 0.7 * Math.sin(t * 8 + i * 0.35) + 0.25 * Math.sin(t * 19 + i * 0.9);
  }
  const beatPhase = (t * 2) % 1;
  return {
    beatCount: Math.floor(t * 2),
    lastBeat: Math.floor(t * 2) / 2,
    bass: 0.55 + 0.4 * Math.sin(t * 2.1),
    mid: 0.45 + 0.35 * Math.sin(t * 3.7),
    treble: 0.4 + 0.35 * Math.sin(t * 5.3),
    beat: Math.max(0, 1 - beatPhase * 3),
    energy: 0.6 + 0.3 * Math.sin(t * 0.9),
    bpm: 120,
    spec, wave,
  };
}

interface Verdict {
  ok: boolean;
  errors: string[];
  reports: string[];
}

async function renderScene(scene: Scene, reports: string[], frames: number): Promise<Verdict> {
  const errors: string[] = [];
  mods.reset();
  for (const stage of STAGES) {
    const res = await renderer.compileStage(stage, scene.layers[stage].code, 0);
    if (!res.ok) {
      const d = res.diagnostics[0];
      errors.push(`${stage} L${d?.line ?? "?"}: ${d?.message ?? "compile failed"}`);
    }
  }
  const passResults = await renderer.setPasses(0, scene.passes ?? []);
  passResults.forEach((r, i) => {
    if (!r.ok) {
      const d = r.diagnostics[0];
      errors.push(`pass${i} L${d?.line ?? "?"}: ${d?.message ?? "compile failed"}`);
    }
  });
  const meshRes = await renderer.setMesh(0, scene.mesh ?? null);
  if (meshRes && !meshRes.ok) {
    const d = meshRes.diagnostics[0];
    errors.push(`mesh L${d?.line ?? "?"}: ${d?.message ?? "compile failed"}`);
  }
  renderer.setParticles(0, scene.particles?.count ?? 0);
  if (errors.length) return { ok: false, errors, reports };

  const mw = meshWarpFor(scene);
  const ps = particlesFor(scene);
  if (mw?.error) reports.push(`warp mesh skipped: ${mw.error}`);
  if (ps?.error) reports.push(`particles skipped: ${ps.error}`);
  try {
    // Frame budget is per-kind: MilkDrop presets peak early and fade
    // (trails decay to black over many frames), Plane9 scenes are cold-
    // start-black and need extra warmup to accumulate. Milk uses ~8, P9
    // uses ~12 (see __verifyMilk / __verifyP9 below).
    for (let f = 0; f < frames; f++) {
      const t = 0.15 + f * 0.13;
      const audio = syntheticAudio(t);
      const p = mods.evaluate(scene, renderer.stageParams(0), audio, t);
      renderer.setWarpMesh(0, mw ? mw.evaluate(mods.exprSnapshot(), t) : null);
      if (ps) renderer.writeParticles(0, ps.update(audio, t));
      renderer.frame(t, audio, p);
    }
  } catch (err) {
    const e = err as Error;
    const stack = (e.stack ?? e.message ?? String(e)).split("\n").slice(0, 6).join(" | ");
    return { ok: false, errors: [`frame threw: ${stack}`.slice(0, 400)], reports };
  }
  return { ok: true, errors, reports };
}

declare global {
  interface Window {
    __ready: boolean;
    __verifyMilk(text: string, name: string): Promise<Verdict>;
    __verifyP9(base64: string, name: string): Promise<Verdict>;
    __refLoadMilk(text: string, name: string): Promise<Verdict>;
    __refFrame(t: number, features: AudioFeatures): boolean;
  }
}

/* ------------- reference-validation mode (fidelity harness) ------------ */
// The driver injects EXACT per-frame audio features (computed by the
// documented MilkDrop audio model from the shared deterministic PCM) and
// exact frame times, mirroring the Butterchurn oracle inputs; it
// screenshots at the shared capture frames and compares against the
// reference fixtures. See scripts/validate-milk.mjs.

let refScene: Scene | null = null;
let refMw: ReturnType<typeof meshWarpFor> = null;

window.__refLoadMilk = async (text, name) => {
  let phase = "parse";
  try {
    const preset = parseMilk(text, name);
    phase = "toScene";
    const { scene } = milkToScene(preset);
    phase = "compile";
    mods.reset();
    const errors: string[] = [];
    for (const stage of STAGES) {
      const res = await renderer.compileStage(stage, scene.layers[stage].code, 0);
      if (!res.ok) errors.push(`${stage}: ${res.diagnostics[0]?.message ?? "compile failed"}`);
    }
    const passResults = await renderer.setPasses(0, scene.passes ?? []);
    passResults.forEach((r, i) => {
      if (!r.ok) errors.push(`pass${i}: ${r.diagnostics[0]?.message ?? "compile failed"}`);
    });
    await renderer.setMesh(0, scene.mesh ?? null);
    renderer.setParticles(0, scene.particles?.count ?? 0);
    if (errors.length) return { ok: false, errors, reports: [] };
    refScene = scene;
    refMw = meshWarpFor(scene);
    return { ok: true, errors: [], reports: [] };
  } catch (err) {
    return { ok: false, errors: [`${phase} threw: ${(err as Error).message}`.slice(0, 300)], reports: [] };
  }
};

window.__refFrame = (t, features) => {
  if (!refScene) return false;
  const audio: AudioFeatures = {
    ...features,
    spec: new Float32Array(features.spec),
    wave: new Float32Array(features.wave),
  };
  const p = mods.evaluate(refScene, renderer.stageParams(0), audio, t);
  renderer.setWarpMesh(0, refMw ? refMw.evaluate(mods.exprSnapshot(), t) : null);
  renderer.frame(t, audio, p);
  return true;
};

window.__verifyMilk = async (text, name) => {
  let phase = "parse";
  try {
    const preset = parseMilk(text, name);
    phase = "toScene";
    const { scene, report } = milkToScene(preset);
    phase = "render";
    return await renderScene(scene, report, 8);
  } catch (err) {
    return { ok: false, errors: [`${phase} threw: ${(err as Error).message}`.slice(0, 300)], reports: [] };
  }
};

window.__verifyP9 = async (base64, name) => {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const p9 = parseP9c(bytes.buffer, name);
    const { scene, report } = p9ToScene(p9);
    return await renderScene(scene, report, 12);
  } catch (err) {
    return { ok: false, errors: ["import threw: " + ((err as Error).message ?? String(err)).slice(0, 300)], reports: [] };
  }
};

/* ------------- graph milk path (MilkPipeline; fidelity mode) ----------- */
// The driver injects the oracle-validated frame globals plus the
// processed audio arrays per frame; the pipeline executes the witnessed
// butterchurn stages on WebGPU. Presets requiring MilkDrop 2 shaders
// REFUSE (UnsupportedGraphError) — reported, never approximated.

declare global {
  interface Window {
    __milkLoadGraph(text: string, name: string): Promise<Verdict & { unsupported?: string[] }>;
    __milkFrameGraph(data: {
      globals: Record<string, number>;
      timeArrayL: number[]; timeArrayR: number[];
      freqArrayL: number[]; freqArrayR: number[];
    }): boolean;
  }
}

let milkPipeline: MilkPipeline | null = null;
// The loaded graph is kept alongside the pipeline so per-frame calls
// dispatch through graph.order and each stage reads its own node data.
let milkGraph: import("./core/graph").GraphScene | null = null;

window.__milkLoadGraph = async (text, name) => {
  let phase = "parse";
  try {
    const parsed = parseMilkComplete(text, name);
    phase = "toGraph";
    const { graph } = milkToGraph(parsed);
    phase = "pipeline";
    milkPipeline = new MilkPipeline(renderer);
    const { errors } = await milkPipeline.load(graph);
    milkGraph = graph;
    return { ok: errors.length === 0, errors, reports: [] };
  } catch (err) {
    if (err instanceof UnsupportedGraphError) {
      return { ok: false, errors: [], reports: [], unsupported: err.features };
    }
    return { ok: false, errors: [`${phase} threw: ${(err as Error).message}`.slice(0, 300)], reports: [] };
  }
};

window.__milkFrameGraph = (data) => {
  if (!milkPipeline || !milkGraph) return false;
  const frameData: MilkFrameData = {
    globals: data.globals,
    timeArrayL: data.timeArrayL, timeArrayR: data.timeArrayR,
    freqArrayL: data.freqArrayL, freqArrayR: data.freqArrayR,
  };
  milkPipeline.frame(milkGraph, frameData);
  return true;
};

/* ----------- end-to-end milk fidelity harness ------------------------- */
// Both engines get only the .milk source and the PCM per frame; PHOSPHENE
// derives its own audio levels, integrated time/fps, EEL evaluations, and
// rendering. The single shared audio+time model lives at
// src/core/milk-audio.ts and is the same code the audio-model validation
// script uses to prove parity against the oracle. No handwritten second
// FFT anywhere. The harness exposes PHOSPHENE's post-equation mdVSFrame
// (from MilkPipeline.lastMdVSFrame) plus its derived globals so a driver
// can compare against oracle state on every frame.

declare global {
  interface Window {
    __milkLoadE2E(text: string, name: string): Promise<Verdict & { unsupported?: string[] }>;
    __milkFrameE2E(pcm: { c: number[]; l: number[]; r: number[] }): boolean;
    /** Read PHOSPHENE's derived globals + post-equation mdVSFrame for
     *  the last frame processed. Returns null if no frame ran. */
    __milkE2EState(): {
      globals: Record<string, number>;
      mdVSFrame: Record<string, number>;
    } | null;
    /** Snapshot the accumulated rand()/randint() draws PHOSPHENE has
     *  made since the last snapshot. Cleared on read. Compare position-
     *  by-position against the oracle's __refRandTrace fixture entries
     *  to prove random-expression stream alignment. */
    __milkE2ERandTrace(): { seq: number; context: string; value: number }[];
  }
}

let e2eGraph: import("./core/graph").GraphScene | null = null;
let e2ePipeline: MilkPipeline | null = null;
let e2eModel: OracleFrameModel | null = null;
let e2eLastGlobals: Record<string, number> | null = null;
const E2E_PIXELS_X = 800;
const E2E_PIXELS_Y = 600;
const E2E_GRID_X = 48;
const E2E_GRID_Y = 36;

let e2eFrameCounter = 0;

window.__milkLoadE2E = async (text, name) => {
  let phase = "parse";
  try {
    const parsed = parseMilkComplete(text, name);
    phase = "toGraph";
    const { graph } = milkToGraph(parsed);
    phase = "pipeline";
    e2ePipeline = new MilkPipeline(renderer);
    // Tag the runner's random-stream context so every draw made during
    // load (rand_start + rand_preset + init_eqs + init-time frame_eqs
    // + wave/shape init) is recorded under "load". The driver reads the
    // trace via __milkE2ERandTrace() and compares against the oracle's
    // preset-load randTrace slice.
    e2ePipeline.rng.setContext("load");
    const { errors } = await e2ePipeline.load(graph);
    e2eGraph = graph;
    e2eModel = new OracleFrameModel(); // fresh audio+time state per preset
    e2eLastGlobals = null;
    e2eFrameCounter = 0;
    return { ok: errors.length === 0, errors, reports: [] };
  } catch (err) {
    if (err instanceof UnsupportedGraphError) {
      return { ok: false, errors: [], reports: [], unsupported: err.features };
    }
    return { ok: false, errors: [`${phase} threw: ${(err as Error).message}`.slice(0, 300)], reports: [] };
  }
};

window.__milkFrameE2E = (pcm) => {
  if (!e2ePipeline || !e2eGraph || !e2eModel) return false;
  // Tag the runner's random-stream context so per-frame draws
  // (frame_eqs + pixel_eqs + wave frame/point + shape frame) are
  // recorded under "frame:N" for this frame.
  e2ePipeline.rng.setContext(`frame:${e2eFrameCounter}`);
  e2eFrameCounter++;
  // Step the shared audio+time model with the injected PCM.
  const step = e2eModel.step(pcm.c, pcm.l, pcm.r, 1 / 30);
  // Build the globals PHOSPHENE hands to its runner — same aspect
  // convention as the injection harness, from PHOSPHENE-derived values.
  const invAspectX = E2E_PIXELS_Y > E2E_PIXELS_X ? E2E_PIXELS_X / E2E_PIXELS_Y : 1;
  const invAspectY = E2E_PIXELS_X > E2E_PIXELS_Y ? E2E_PIXELS_Y / E2E_PIXELS_X : 1;
  const globals: Record<string, number> = {
    frame: step.frame, time: step.time, fps: step.fps,
    bass: step.bass, bass_att: step.bass_att,
    mid: step.mid, mid_att: step.mid_att,
    treb: step.treb, treb_att: step.treb_att,
    meshx: E2E_GRID_X, meshy: E2E_GRID_Y,
    aspectx: 1 / invAspectX, aspecty: 1 / invAspectY,
    pixelsx: E2E_PIXELS_X, pixelsy: E2E_PIXELS_Y,
  };
  e2eLastGlobals = globals;
  // Hand the pipeline the same source-of-truth audio arrays the runner
  // reads for wave/spectrum sampling. NO raw 1024-sample custom-wave
  // input: waves consume the smoothed downsampled 512-sample L/R and
  // the 512-bin frequency arrays that the witnessed AudioProcessor
  // produces (butterchurn's customWaveform.js reads timeArrayL/R which
  // are 512 samples).
  e2ePipeline.frame(e2eGraph, {
    globals,
    timeArrayL: e2eModel.audio.timeArrayL,
    timeArrayR: e2eModel.audio.timeArrayR,
    freqArrayL: e2eModel.audio.freqArrayL,
    freqArrayR: e2eModel.audio.freqArrayR,
  });
  return true;
};

window.__milkE2EState = () => {
  if (!e2ePipeline || !e2eLastGlobals || !e2ePipeline.lastMdVSFrame) return null;
  // Serialize only numeric mdVSFrame entries so the driver receives
  // plain JSON — expr.ts pool cells are all numbers by construction.
  const mdVSFrame: Record<string, number> = {};
  for (const [k, v] of Object.entries(e2ePipeline.lastMdVSFrame)) {
    if (typeof v === "number" && Number.isFinite(v)) mdVSFrame[k] = v;
  }
  return { globals: { ...e2eLastGlobals }, mdVSFrame };
};

window.__milkE2ERandTrace = () => {
  if (!e2ePipeline) return [];
  return e2ePipeline.rng.snapshotAndReset();
};

/* -------- native-equivalence mode (legacy path vs graph executor) ------ */
// The driver loads a native scene through ONE of the two paths per page
// session (clean renderer state per path), renders identical frame
// sequences with identical injected audio, and compares screenshots.
// See scripts/equivalence-native.mjs; gate: COMPATIBILITY-GOAL.md /
// continuation assignment completion gate 1.

declare global {
  interface Window {
    __equivLoad(sceneJson: string, path: "legacy" | "graph"): Promise<Verdict>;
    __equivFrame(t: number, features: AudioFeatures): boolean;
  }
}

let equivPath: "legacy" | "graph" = "legacy";
let equivScene: Scene | null = null;
let equivMw: ReturnType<typeof meshWarpFor> = null;
let equivPs: ReturnType<typeof particlesFor> = null;
let equivExecutor: GraphExecutor | null = null;

window.__equivLoad = async (sceneJson, path) => {
  try {
    equivPath = path;
    const raw = JSON.parse(sceneJson);
    const scene = normalizeScene(raw);
    if (path === "graph") {
      equivExecutor = new GraphExecutor(renderer);
      const g = compileSceneToGraph(scene);
      const { errors } = await equivExecutor.load(g);
      if (errors.length) return { ok: false, errors, reports: [] };
      return { ok: true, errors: [], reports: [] };
    }
    // legacy path: the exact flow the product uses, including scene-image
    // loading (src/player.ts loadSceneImage — text rasterizes into the
    // image slot when no image asset is present; absent -> null/white).
    mods.reset();
    if (scene.text && !scene.assets?.image) {
      const textImage = renderTextImage(scene);
      if (textImage) scene.assets = { ...scene.assets, image: textImage };
    }
    const imgData = scene.assets?.image;
    if (imgData) {
      try {
        const blob = await (await fetch(imgData)).blob();
        await renderer.setImage(0, await createImageBitmap(blob));
      } catch { await renderer.setImage(0, null); }
    } else {
      await renderer.setImage(0, null);
    }
    const errors: string[] = [];
    for (const stage of STAGES) {
      const res = await renderer.compileStage(stage, scene.layers[stage].code, 0);
      if (!res.ok) errors.push(`${stage}: ${res.diagnostics[0]?.message ?? "compile failed"}`);
    }
    const passResults = await renderer.setPasses(0, scene.passes ?? []);
    passResults.forEach((r, i) => {
      if (!r.ok) errors.push(`pass${i}: ${r.diagnostics[0]?.message ?? "compile failed"}`);
    });
    const meshRes = await renderer.setMesh(0, scene.mesh ?? null);
    if (meshRes && !meshRes.ok) errors.push(`mesh compile failed`);
    renderer.setParticles(0, scene.particles?.count ?? 0);
    if (errors.length) return { ok: false, errors, reports: [] };
    equivScene = scene;
    equivMw = meshWarpFor(scene);
    equivPs = particlesFor(scene);
    return { ok: true, errors: [], reports: [] };
  } catch (err) {
    return { ok: false, errors: [String((err as Error).message).slice(0, 300)], reports: [] };
  }
};

window.__equivFrame = (t, features) => {
  const audio: AudioFeatures = {
    ...features,
    spec: new Float32Array(features.spec),
    wave: new Float32Array(features.wave),
  };
  if (equivPath === "graph") {
    if (!equivExecutor) return false;
    equivExecutor.frame(t, audio);
    return true;
  }
  if (!equivScene) return false;
  const p = mods.evaluate(equivScene, renderer.stageParams(0), audio, t);
  renderer.setWarpMesh(0, equivMw ? equivMw.evaluate(mods.exprSnapshot(), t) : null);
  if (equivPs) renderer.writeParticles(0, equivPs.update(audio, t));
  renderer.frame(t, audio, p);
  return true;
};

const canvas = document.getElementById("stage") as HTMLCanvasElement;
await renderer.init(canvas);

// Give postprocessing scenes a non-empty source image so filters like Invert
// and BlackAndWhite have varied input to operate on. Synthesized here — a
// gradient with colored bands — so any scene that samples the scene image
// via `img()` renders something recognizable.
{
  const off = new OffscreenCanvas(256, 256);
  const g = off.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0.0, "#f04040");
  grad.addColorStop(0.3, "#ffb040");
  grad.addColorStop(0.55, "#40e080");
  grad.addColorStop(0.8, "#4080ff");
  grad.addColorStop(1.0, "#a040ff");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  // small circles for high-frequency content so edge/emboss filters see edges
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? "#ffffff" : "#101020";
    g.beginPath();
    g.arc((i * 37) % 256, (i * 61 + 20) % 256, 8 + (i % 5) * 3, 0, 6.283);
    g.fill();
  }
  await renderer.setImage(0, off.transferToImageBitmap());
}

window.__ready = true;
