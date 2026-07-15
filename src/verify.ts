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

/* ----------- end-to-end milk fidelity harness (defect 4) --------------- */
// This harness supplies both engines ONLY the .milk source and the PCM
// bytes per frame at committed times and seed. PHOSPHENE derives its own
// audio levels, frame globals, EEL evaluation, and rendering — no oracle
// values are injected. The oracle-global-injection surface (__milkFrameGraph)
// stays available as a SUBSYSTEM diagnostic; this harness is the true
// end-to-end fidelity test.
//
// Ported audio+time model: scripts/lib/milk-audio-model.mjs -> the same
// FFT/AudioLevels/time-integration chain from butterchurn, exposed
// server-side. Here we import the classes' TS equivalents via a small
// facade that lives in a new file so the driver can reuse them.

declare global {
  interface Window {
    __milkLoadE2E(text: string, name: string): Promise<Verdict & { unsupported?: string[] }>;
    __milkFrameE2E(pcm: { c: number[]; l: number[]; r: number[] }): boolean;
  }
}

// Reuse the graph-loader plumbing; the difference is per-frame PCM input.
let e2eGraph: import("./core/graph").GraphScene | null = null;
let e2ePipeline: MilkPipeline | null = null;
// PHOSPHENE-derived audio+time state (installed by the E2E harness only).
interface E2EState {
  frameNum: number;
  time: number;
  fps: number;
  timeHist: number[];
  audio: {
    freqArray: number[]; freqArrayL: number[]; freqArrayR: number[];
    timeArrayL: number[]; timeArrayR: number[];
  } | null;
  bandStarts: number[]; bandStops: number[];
  val: [number, number, number]; imm: [number, number, number];
  att: [number, number, number]; avg: [number, number, number];
  longAvg: [number, number, number];
  gridX: number; gridY: number;
  pixelsx: number; pixelsy: number;
}
let e2eState: E2EState | null = null;

window.__milkLoadE2E = async (text, name) => {
  let phase = "parse";
  try {
    const parsed = parseMilkComplete(text, name);
    phase = "toGraph";
    const { graph } = milkToGraph(parsed);
    phase = "pipeline";
    e2ePipeline = new MilkPipeline(renderer);
    const { errors } = await e2ePipeline.load(graph);
    e2eGraph = graph;
    // Reset E2E state (fresh audio + time each preset).
    const sampleRate = 44100; // committed with the oracle
    const bucketHz = sampleRate / 1024;
    const clampi = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    const bassLow = clampi(Math.round(20 / bucketHz) - 1, 0, 511);
    const bassHigh = clampi(Math.round(320 / bucketHz) - 1, 0, 511);
    const midHigh = clampi(Math.round(2800 / bucketHz) - 1, 0, 511);
    const trebHigh = clampi(Math.round(11025 / bucketHz) - 1, 0, 511);
    e2eState = {
      frameNum: 0, time: 0, fps: 30, timeHist: [0],
      audio: null,
      bandStarts: [bassLow, bassHigh, midHigh],
      bandStops: [bassHigh, midHigh, trebHigh],
      val: [0, 0, 0], imm: [0, 0, 0], att: [1, 1, 1],
      avg: [1, 1, 1], longAvg: [1, 1, 1],
      gridX: 48, gridY: 36,
      pixelsx: 800, pixelsy: 600,
    };
    return { ok: errors.length === 0, errors, reports: [] };
  } catch (err) {
    if (err instanceof UnsupportedGraphError) {
      return { ok: false, errors: [], reports: [], unsupported: err.features };
    }
    return { ok: false, errors: [`${phase} threw: ${(err as Error).message}`.slice(0, 300)], reports: [] };
  }
};

window.__milkFrameE2E = (pcm) => {
  if (!e2ePipeline || !e2eGraph || !e2eState) return false;
  // 1) FFT the PCM (radix-2 length-1024) — a tiny inline port of the
  //    same math as scripts/lib/milk-audio-model.mjs OracleAudioProcessor.
  const s = e2eState;
  const FFT_SIZE = 1024;
  const timeArray = new Int8Array(FFT_SIZE);
  const timeArrayL = new Int8Array(FFT_SIZE);
  const timeArrayR = new Int8Array(FFT_SIZE);
  const tmpL = new Int8Array(FFT_SIZE);
  const tmpR = new Int8Array(FFT_SIZE);
  for (let i = 0, lastIdx = 0; i < FFT_SIZE; i++) {
    timeArray[i] = pcm.c[i] - 128;
    timeArrayL[i] = pcm.l[i] - 128;
    timeArrayR[i] = pcm.r[i] - 128;
    tmpL[i] = 0.5 * (timeArrayL[i] + timeArrayL[lastIdx]);
    tmpR[i] = 0.5 * (timeArrayR[i] + timeArrayR[lastIdx]);
    lastIdx = i;
  }
  const fft = (input: Int8Array): Float32Array => {
    const N = FFT_SIZE;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    // bit reversal
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = input[i]; real[i] = input[j]; real[j] = tr; }
      else real[i] = input[i];
    }
    real[0] = input[0];
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = Math.PI * 2 / size;
      for (let i = 0; i < N; i += size) {
        for (let j = 0; j < half; j++) {
          const cs = Math.cos(-step * j), sn = Math.sin(-step * j);
          const tRe = cs * real[i + j + half] - sn * imag[i + j + half];
          const tIm = sn * real[i + j + half] + cs * imag[i + j + half];
          real[i + j + half] = real[i + j] - tRe;
          imag[i + j + half] = imag[i + j] - tIm;
          real[i + j] += tRe;
          imag[i + j] += tIm;
        }
      }
    }
    // equalize table + magnitude (samplesOut = 512)
    const out = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const eq = -0.02 * Math.log((512 - i) / 512);
      out[i] = eq * Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    return out;
  };
  const freqArray = fft(timeArray);
  const freqArrayL = fft(timeArrayL);
  const freqArrayR = fft(timeArrayR);
  s.audio = {
    freqArray: Array.from(freqArray),
    freqArrayL: Array.from(freqArrayL),
    freqArrayR: Array.from(freqArrayR),
    timeArrayL: Array.from(timeArrayL), timeArrayR: Array.from(timeArrayR),
  };
  // 2) integrate time + damped fps (witnessed butterchurn calcTimeAndFPS)
  const elapsed = 1 / 30;
  s.time += 1 / s.fps;
  s.timeHist.push(s.timeHist[s.timeHist.length - 1] + elapsed);
  if (s.timeHist.length > 120) s.timeHist.shift();
  const newFPS = s.timeHist.length / (s.timeHist[s.timeHist.length - 1] - s.timeHist[0]);
  s.fps = 0.93 * s.fps + 0.07 * newFPS;
  s.frameNum += 1;
  // 3) audio levels (witnessed AudioLevels.updateAudioLevels)
  const effectiveFPS = Math.min(144, Math.max(15, s.fps));
  const adj = (r: number) => Math.pow(r, 30 / effectiveFPS);
  s.imm = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = s.bandStarts[i]; j < s.bandStops[i]; j++) s.imm[i] += freqArray[j];
  }
  for (let i = 0; i < 3; i++) {
    const shortR = adj(s.imm[i] > s.avg[i] ? 0.2 : 0.5);
    s.avg[i] = s.avg[i] * shortR + s.imm[i] * (1 - shortR);
    const longR = adj(s.frameNum < 50 ? 0.9 : 0.992);
    s.longAvg[i] = s.longAvg[i] * longR + s.imm[i] * (1 - longR);
    if (s.longAvg[i] < 0.001) { s.val[i] = 1; s.att[i] = 1; }
    else { s.val[i] = s.imm[i] / s.longAvg[i]; s.att[i] = s.avg[i] / s.longAvg[i]; }
  }
  // 4) build the globals PHOSPHENE hands to its own runner
  const invAspectX = s.pixelsy > s.pixelsx ? s.pixelsx / s.pixelsy : 1;
  const invAspectY = s.pixelsx > s.pixelsy ? s.pixelsy / s.pixelsx : 1;
  const globals = {
    frame: s.frameNum, time: s.time, fps: s.fps,
    bass: s.val[0], bass_att: s.att[0],
    mid: s.val[1], mid_att: s.att[1],
    treb: s.val[2], treb_att: s.att[2],
    meshx: s.gridX, meshy: s.gridY,
    aspectx: 1 / invAspectX, aspecty: 1 / invAspectY,
    pixelsx: s.pixelsx, pixelsy: s.pixelsy,
  };
  e2ePipeline.frame(e2eGraph, {
    globals,
    timeArrayL: s.audio.timeArrayL,
    timeArrayR: s.audio.timeArrayR,
    freqArrayL: s.audio.freqArrayL,
    freqArrayR: s.audio.freqArrayR,
  });
  return true;
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
