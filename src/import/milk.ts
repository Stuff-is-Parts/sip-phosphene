import { compile } from "../core/expr";
import { normalizeScene, type ModRoute, type Scene } from "../core/types";

/**
 * MilkDrop .milk preset importer. Parses the INI-style preset format
 * (documented in the BSD-released MilkDrop 2 source) and maps it onto a
 * PHOSPHENE scene: base values + per-frame equations drive warp, wave,
 * custom-wave, and shape parameters through expression mod routes; per-pixel
 * equations become the scene's warp-mesh program; the render templates use
 * the warpUV/waveLine/sdNgon stdlib.
 */

export interface MilkUnit {
  /** wavecode_N_* / shapecode_N_* base values, lowercased keys. */
  values: Record<string, number>;
  /** wave_N_per_frameM / shape_N_per_frameM equations, concatenated. */
  perFrame: string;
}

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
  waves: MilkUnit[];
  shapes: MilkUnit[];
}

export function parseMilk(text: string, filename: string): MilkPreset {
  const name = filename.replace(/\.milk$/i, "").replace(/^.*[\\/]/, "");
  const values: Record<string, number> = {};
  const numbered = new Map<string, string[]>(); // per_frame etc., in order
  const shaderLines = { warp: [] as string[], comp: [] as string[] };
  const waveVals = new Map<number, Record<string, number>>();
  const shapeVals = new Map<number, Record<string, number>>();
  const waveEqs = new Map<number, string[]>();
  const shapeEqs = new Map<number, string[]>();

  const unitVal = (store: Map<number, Record<string, number>>, idx: number, key: string, v: number) => {
    const u = store.get(idx) ?? {};
    u[key] = v;
    store.set(idx, u);
  };
  const unitEq = (store: Map<number, string[]>, idx: number, n: number, code: string) => {
    const list = store.get(idx) ?? [];
    list[n - 1] = code;
    store.set(idx, list);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1);
    const num = parseFloat(val);

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
    const wv = /^wavecode_(\d+)_(\w+)$/.exec(key);
    if (wv && Number.isFinite(num)) { unitVal(waveVals, +wv[1], wv[2].toLowerCase(), num); continue; }
    const sv = /^shapecode_(\d+)_(\w+)$/.exec(key);
    if (sv && Number.isFinite(num)) { unitVal(shapeVals, +sv[1], sv[2].toLowerCase(), num); continue; }
    const we = /^wave_(\d+)_per_frame(\d+)$/.exec(key);
    if (we) { unitEq(waveEqs, +we[1], +we[2], val); continue; }
    const se = /^shape_(\d+)_per_frame(\d+)$/.exec(key);
    if (se) { unitEq(shapeEqs, +se[1], +se[2], val); continue; }

    if (Number.isFinite(num)) values[key.toLowerCase()] = num;
  }

  // MilkDrop strips per-line comments then concatenates equation lines with
  // no separator: identifiers may split across lines, and ';' is the only
  // statement boundary. Matching that keeps authentic presets compiling and
  // fails the same programs real MilkDrop silently drops.
  const concat = (lines: string[] | undefined): string =>
    (lines ?? [])
      .filter((s) => s !== undefined)
      .map((s) => s.replace(/\/\/.*$/, ""))
      .join("");
  const joined = (k: string): string => concat(numbered.get(k));

  const units = (
    vals: Map<number, Record<string, number>>, eqs: Map<number, string[]>,
  ): MilkUnit[] =>
    [...vals.entries()]
      .filter(([, v]) => v.enabled === 1)
      .sort((a, b) => a[0] - b[0])
      .map(([idx, v]) => ({ values: v, perFrame: concat(eqs.get(idx)) }));

  return {
    name,
    values,
    perFrameInit: joined("per_frame_init"),
    perFrame: joined("per_frame"),
    perPixel: joined("per_pixel"),
    warpShader: shaderLines.warp.join("\n"),
    compShader: shaderLines.comp.join("\n"),
    waves: units(waveVals, waveEqs),
    shapes: units(shapeVals, shapeEqs),
  };
}

/** MilkDrop var -> [//@param name, min, max, value keys tried in order, fallback]. */
const PARAM_MAP: [string, string, number, number, string[], number][] = [
  ["zoom", "mdZoom", 0.8, 1.2, ["zoom"], 1.0],
  ["rot", "mdRot", -0.6, 0.6, ["rot"], 0.0],
  ["warp", "mdWarp", 0.0, 3.0, ["warp"], 0.2],
  ["dx", "mdDx", -0.2, 0.2, ["dx"], 0.0],
  ["dy", "mdDy", -0.2, 0.2, ["dy"], 0.0],
  ["decay", "mdDecay", 0.7, 1.0, ["decay", "fdecay"], 0.96],
  ["wave_r", "mdWaveR", 0.0, 1.0, ["wave_r"], 0.7],
  ["wave_g", "mdWaveG", 0.0, 1.0, ["wave_g"], 0.7],
  ["wave_b", "mdWaveB", 0.0, 1.0, ["wave_b"], 0.9],
  ["wave_a", "mdWaveA", 0.0, 2.0, ["wave_a", "fwavealpha"], 0.8],
  ["wave_x", "mdWaveX", 0.0, 1.0, ["wave_x"], 0.5],
  ["wave_y", "mdWaveY", 0.0, 1.0, ["wave_y"], 0.5],
];

/** Per custom wave: local equation var -> param suffix + value keys. */
const WAVE_UNIT_MAP: [string, string, number, number, string[], number][] = [
  ["r", "R", 0, 1, ["r"], 1],
  ["g", "G", 0, 1, ["g"], 1],
  ["b", "B", 0, 1, ["b"], 1],
  ["a", "A", 0, 2, ["a"], 1],
];

/** Per shape: local equation var -> param suffix + value keys. */
const SHAPE_UNIT_MAP: [string, string, number, number, string[], number][] = [
  ["x", "X", 0, 1, ["x"], 0.5],
  ["y", "Y", 0, 1, ["y"], 0.5],
  ["rad", "Rad", 0, 1.5, ["rad"], 0.1],
  ["ang", "Ang", -6.3, 6.3, ["ang"], 0],
  ["r", "R", 0, 1, ["r"], 1],
  ["g", "G", 0, 1, ["g"], 0],
  ["b", "B", 0, 1, ["b"], 0],
  ["a", "A", 0, 1, ["a"], 1],
];

const MAX_UNITS = 2; // custom waves and shapes each rendered up to this many

function paramLine(name: string, min: number, max: number, def: number): string {
  return `//@param ${name} ${min} ${max} ${def}`;
}

function unitDefaults(
  map: typeof WAVE_UNIT_MAP, unit: MilkUnit,
): string {
  return map
    .map(([v, , , , keys, fallback]) => {
      const val = keys.map((k) => unit.values[k]).find((x) => x !== undefined) ?? fallback;
      return `${v} = ${val};`;
    })
    .join("");
}

export function milkToScene(m: MilkPreset): { scene: Scene; report: string[] } {
  const report: string[] = [];
  const mods: ModRoute[] = [];
  const custom: Record<string, number> = {};
  const paramLines: string[] = [];

  // --- core per-frame program: preset values reset each frame, then equations
  const defaults = PARAM_MAP
    .map(([mdVar, , , , keys, fallback]) => {
      const val = keys.map((k) => m.values[k]).find((x) => x !== undefined) ?? fallback;
      return `${mdVar} = ${val};`;
    })
    .join("");
  const program = defaults + m.perFrame;

  let coreOk = true;
  try {
    compile(program);
  } catch (err) {
    coreOk = false;
    report.push(`per-frame equations skipped (${(err as Error).message})`);
  }
  for (const [mdVar, param, min, max, , fallback] of PARAM_MAP) {
    paramLines.push(paramLine(param, min, max, fallback));
    if (coreOk) {
      custom[param] = 0;
      mods.push({
        target: param, source: "expr", gain: 1, base: 0,
        expr: program, readVar: mdVar,
        ...(m.perFrameInit ? { init: m.perFrameInit } : {}),
      });
    }
  }

  // --- custom waves and shapes: namespaced equation envs, own param sets
  const addUnits = (
    unitsIn: MilkUnit[], map: typeof WAVE_UNIT_MAP, prefix: string, label: string,
  ): number => {
    const active = unitsIn.slice(0, MAX_UNITS);
    active.forEach((unit, i) => {
      const ns = `${prefix}${i}`;
      const unitProgram = unitDefaults(map, unit) + unit.perFrame;
      let ok = true;
      try {
        compile(unitProgram);
      } catch (err) {
        ok = false;
        report.push(`${label} ${i} equations skipped (${(err as Error).message})`);
      }
      for (const [v, suffix, min, max, keys, fallback] of map) {
        const param = `${ns}${suffix}`;
        const def = keys.map((k) => unit.values[k]).find((x) => x !== undefined) ?? fallback;
        paramLines.push(paramLine(param, min, max, def));
        if (ok) {
          custom[param] = 0;
          mods.push({ target: param, source: "expr", gain: 1, base: 0, expr: unitProgram, readVar: v, ns });
        }
      }
    });
    return unitsIn.length - active.length;
  };
  const wavesDropped = addUnits(m.waves, WAVE_UNIT_MAP, "cw", "custom wave");
  const shapesDropped = addUnits(m.shapes, SHAPE_UNIT_MAP, "sh", "shape");
  if (wavesDropped > 0) report.push(`${wavesDropped} custom wave(s) beyond ${MAX_UNITS} dropped`);
  if (shapesDropped > 0) report.push(`${shapesDropped} shape(s) beyond ${MAX_UNITS} dropped`);

  // --- render templates: one shared param block, identical in fg and post
  const paramBlock = paramLines.join("\n") + "\n";
  const waveMode = m.values.nwavemode ?? 0;
  // wave placement by mode family: 6/7 draw angled, 4/5 centered thick, else horizontal
  const waveAngle = waveMode === 6 || waveMode === 7 ? 0.35 : 0.0;
  const waveThick = waveMode === 4 || waveMode === 5 ? 0.014 : 0.008;

  const shapeCount = Math.min(m.shapes.length, MAX_UNITS);
  const waveUnitCount = Math.min(m.waves.length, MAX_UNITS);
  const shapeDraws = Array.from({ length: shapeCount }, (_, i) => {
    const sides = m.shapes[i].values.sides ?? 4;
    return `
  {
    let sp = (vec2f(sh${i}X(), 1.0 - sh${i}Y()) - vec2f(0.5)) * vec2f(c.res.x / c.res.y, 1.0);
    let d = sdNgon(c.q - sp, max(sh${i}Rad(), 0.001) * 0.5, ${sides.toFixed(1)}, sh${i}Ang());
    let fill = smoothstep(0.004, -0.004, d);
    col += vec3f(sh${i}R(), sh${i}G(), sh${i}B()) * fill * sh${i}A();
  }`;
  }).join("");
  const waveDraws = Array.from({ length: waveUnitCount }, (_, i) => `
  {
    let w = waveLine(c.q, -0.8, 0.8, 0.25, ${(0.25 + i * 0.2).toFixed(2)}, 0.006);
    col += vec3f(cw${i}R(), cw${i}G(), cw${i}B()) * w * cw${i}A();
  }`).join("");

  const FG_BODY = paramBlock + `fn render(c : Ctx) -> vec3f {
  var col = vec3f(0.0);
  let wq = rot2(${waveAngle.toFixed(2)}) * (c.q - vec2f((mdWaveX() - 0.5) * 1.6, 0.0));
  let y = (mdWaveY() - 0.5) * -1.6;
  let w = waveLine(wq, -0.85, 0.85, 0.4, y, ${waveThick.toFixed(3)});
  col += vec3f(mdWaveR(), mdWaveG(), mdWaveB()) * w * mdWaveA() * (0.8 + c.beat * 0.6);${waveDraws}${shapeDraws}
  return col * c.intensity;
}`;

  const warpLookup = m.perPixel
    ? `let wuv = c.uv + meshOff(c.uv);`
    : `let wuv = warpUV(c.uv, mdZoom(), mdRot(), vec2f(mdDx(), mdDy()), mdWarp(), c.t);`;
  const POST_BODY = paramBlock + `fn render(c : Ctx) -> vec3f {
  ${warpLookup}
  var col = prevTex(wuv) * mdDecay();
  col = max(col, srcTex(c.uv));
  return col;
}`;

  const BG_BODY = `fn render(c : Ctx) -> vec3f { return vec3f(0.0); }`;

  // --- warp mesh: per-pixel equations run per grid vertex after per-frame
  let warpMesh: string | undefined;
  if (m.perPixel && coreOk) {
    const meshProgram = m.perPixel;
    try {
      compile(meshProgram);
      warpMesh = meshProgram;
      report.push("per-pixel equations drive the warp mesh");
    } catch (err) {
      report.push(`per-pixel equations skipped (${(err as Error).message})`);
    }
  }
  if (m.warpShader) report.push("MilkDrop 2 warp HLSL present — AI translation offered on compile");
  if (m.compShader) report.push("MilkDrop 2 comp HLSL present — direct composite used instead");

  const scene = normalizeScene({
    name: m.name.toUpperCase(),
    layers: { bg: { code: BG_BODY }, fg: { code: FG_BODY }, post: { code: POST_BODY } },
    custom,
    mods,
    ...(warpMesh ? { warpMesh } : {}),
    credit: `ported from a MilkDrop preset: ${m.name}`,
    license: "preset equations © original author",
  });
  return { scene, report };
}
