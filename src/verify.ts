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
  for (let i = 0; i < 64; i++) {
    spec[i] = 0.3 + 0.3 * Math.sin(t * 3 + i * 0.4);
    wave[i] = 0.6 * Math.sin(t * 8 + i * 0.35);
  }
  const beatPhase = (t * 2) % 1;
  return {
    beatCount: Math.floor(t * 2),
    lastBeat: Math.floor(t * 2) / 2,
    bass: 0.5 + 0.4 * Math.sin(t * 2.1),
    mid: 0.4 + 0.3 * Math.sin(t * 3.7),
    treble: 0.35 + 0.3 * Math.sin(t * 5.3),
    beat: Math.max(0, 1 - beatPhase * 3),
    energy: 0.5,
    bpm: 120,
    spec, wave,
  };
}

interface Verdict {
  ok: boolean;
  errors: string[];
  reports: string[];
}

async function renderScene(scene: Scene, reports: string[]): Promise<Verdict> {
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
    for (let f = 0; f < 8; f++) {
      const t = 0.4 + f * 0.18;
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
    return await renderScene(scene, report);
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
    return await renderScene(scene, report);
  } catch (err) {
    return { ok: false, errors: ["import threw: " + ((err as Error).message ?? String(err)).slice(0, 300)], reports: [] };
  }
};

const canvas = document.getElementById("stage") as HTMLCanvasElement;
await renderer.init(canvas);
window.__ready = true;
