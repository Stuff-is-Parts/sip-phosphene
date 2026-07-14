import { compile } from "../core/expr";
import { normalizeScene, type ModRoute, type Scene } from "../core/types";

/**
 * MilkDrop .milk preset importer. Parses the INI-style preset format
 * (format documented in the BSD-released MilkDrop 2 source) and maps it
 * onto a PHOSPHENE scene: preset base values + per-frame equations drive
 * warp/wave parameters through expression mod routes; the classic
 * feedback-warp look renders via the warpUV/waveLine stdlib.
 */

export interface MilkPreset {
  name: string;
  /** Preset base values (zoom, rot, warp, fDecay, wave_r, ...). */
  values: Record<string, number>;
  perFrameInit: string;
  perFrame: string;
  perPixel: string;
  /** Raw HLSL bodies when the preset carries MilkDrop 2 shaders. */
  warpShader: string;
  compShader: string;
  waveCount: number;
  shapeCount: number;
}

export function parseMilk(text: string, filename: string): MilkPreset {
  const name = filename.replace(/\.milk$/i, "").replace(/^.*[\\/]/, "");
  const values: Record<string, number> = {};
  const numbered = new Map<string, string[]>(); // per_frame etc., in order
  const shaderLines = { warp: [] as string[], comp: [] as string[] };
  let waveCount = 0;
  let shapeCount = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1);

    const shader = /^(warp|comp)_(\d+)$/.exec(key);
    if (shader) {
      shaderLines[shader[1] as "warp" | "comp"].push(val.replace(/^`/, ""));
      continue;
    }
    const eqn = /^(per_frame_init|per_frame|per_pixel|per_pixel_init)_(\d+)$/.exec(key);
    if (eqn) {
      const list = numbered.get(eqn[1]) ?? [];
      list[parseInt(eqn[2], 10) - 1] = val;
      numbered.set(eqn[1], list);
      continue;
    }
    const wave = /^wavecode_(\d+)_enabled$/.exec(key);
    if (wave && parseFloat(val) !== 0) { waveCount++; continue; }
    const shape = /^shapecode_(\d+)_enabled$/.exec(key);
    if (shape && parseFloat(val) !== 0) { shapeCount++; continue; }

    const num = parseFloat(val);
    if (Number.isFinite(num)) values[key.toLowerCase()] = num;
  }

  const joined = (k: string): string =>
    (numbered.get(k) ?? []).filter((s) => s !== undefined).join("\n");
  return {
    name,
    values,
    perFrameInit: joined("per_frame_init"),
    perFrame: joined("per_frame"),
    perPixel: joined("per_pixel"),
    warpShader: shaderLines.warp.join("\n"),
    compShader: shaderLines.comp.join("\n"),
    waveCount,
    shapeCount,
  };
}

/** MilkDrop var -> [//@param name, min, max, preset-value key, fallback]. */
const PARAM_MAP: [string, string, number, number, number][] = [
  ["zoom", "mdZoom", 0.8, 1.2, 1.0],
  ["rot", "mdRot", -0.6, 0.6, 0.0],
  ["warp", "mdWarp", 0.0, 3.0, 0.2],
  ["dx", "mdDx", -0.2, 0.2, 0.0],
  ["dy", "mdDy", -0.2, 0.2, 0.0],
  ["decay", "mdDecay", 0.7, 1.0, 0.96],
  ["wave_r", "mdWaveR", 0.0, 1.0, 0.7],
  ["wave_g", "mdWaveG", 0.0, 1.0, 0.7],
  ["wave_b", "mdWaveB", 0.0, 1.0, 0.9],
  ["wave_a", "mdWaveA", 0.0, 2.0, 0.8],
  ["wave_y", "mdWaveY", 0.0, 1.0, 0.5],
];

const BG_BODY = `fn render(c : Ctx) -> vec3f { return vec3f(0.0); }`;

// One custom-uniform buffer serves all stages, so every stage that reads
// these params declares the identical block in the identical order.
const PARAM_BLOCK = `//@param mdZoom 0.8 1.2 1.0
//@param mdRot -0.6 0.6 0.0
//@param mdWarp 0.0 3.0 0.2
//@param mdDx -0.2 0.2 0.0
//@param mdDy -0.2 0.2 0.0
//@param mdDecay 0.7 1.0 0.96
//@param mdWaveR 0.0 1.0 0.7
//@param mdWaveG 0.0 1.0 0.7
//@param mdWaveB 0.0 1.0 0.9
//@param mdWaveA 0.0 2.0 0.8
//@param mdWaveY 0.0 1.0 0.5
`;

const FG_BODY = PARAM_BLOCK + `fn render(c : Ctx) -> vec3f {
  let y = (mdWaveY() - 0.5) * -1.6;
  let w = waveLine(c.q, -0.85, 0.85, 0.4, y, 0.008);
  let col = vec3f(mdWaveR(), mdWaveG(), mdWaveB());
  return col * w * mdWaveA() * c.intensity * (0.8 + c.beat * 0.6);
}`;

const POST_BODY = PARAM_BLOCK + `fn render(c : Ctx) -> vec3f {
  let wuv = warpUV(c.uv, mdZoom(), mdRot(), vec2f(mdDx(), mdDy()), mdWarp(), c.t);
  var col = prevTex(wuv) * mdDecay();
  col = max(col, srcTex(c.uv));
  return col;
}`;

export function milkToScene(m: MilkPreset): { scene: Scene; report: string[] } {
  const report: string[] = [];

  // Preset base values become the defaults each frame; per-frame equations
  // then modify them (MilkDrop resets non-q vars to preset values per frame).
  const defaults = PARAM_MAP
    .map(([mdVar, , , , fallback]) => `${mdVar} = ${m.values[mdVar] ?? m.values["f" + mdVar] ?? fallback};`)
    .join("\n");
  const fDecay = m.values.fdecay;
  const program = `${defaults}\n${fDecay !== undefined ? `decay = ${fDecay};\n` : ""}${m.perFrame}`;

  let compileError = "";
  try {
    compile(program);
  } catch (err) {
    compileError = (err as Error).message;
    report.push(`per-frame equations skipped (${compileError})`);
  }

  const mods: ModRoute[] = compileError ? [] : PARAM_MAP.map(([mdVar, param]) => ({
    target: param,
    source: "expr" as const,
    gain: 1,
    base: 0,
    expr: program,
    readVar: mdVar === "decay" ? "decay" : mdVar,
    ...(m.perFrameInit ? { init: m.perFrameInit } : {}),
  }));

  if (m.perPixel) report.push("per-pixel (per-vertex mesh) equations approximated by the warpUV wobble");
  if (m.warpShader) report.push("MilkDrop 2 warp HLSL present — parametric warp used instead");
  if (m.compShader) report.push("MilkDrop 2 comp HLSL present — direct composite used instead");
  if (m.waveCount) report.push(`${m.waveCount} custom wave(s) mapped to the main waveform draw`);
  if (m.shapeCount) report.push(`${m.shapeCount} custom shape(s) not represented`);

  const custom: Record<string, number> = {};
  if (!compileError) for (const [, param] of PARAM_MAP) custom[param] = 0;

  const scene = normalizeScene({
    name: m.name.toUpperCase(),
    layers: { bg: { code: BG_BODY }, fg: { code: FG_BODY }, post: { code: POST_BODY } },
    custom,
    mods,
    credit: `ported from a MilkDrop preset: ${m.name}`,
    license: "preset equations © original author",
  });
  return { scene, report };
}
