import { Renderer } from "./gpu/renderer";
import { ModEngine } from "./core/mods";
import { meshWarpFor } from "./core/meshwarp";
import { particlesFor } from "./core/particles";
import { parseMilk, milkToScene } from "./import/milk";
import { parseP9c, p9ToScene } from "./import/p9";
import { STAGES, type AudioFeatures, type Scene } from "./core/types";

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
  }
}

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
