/**
 * MilkDrop structural importer: complete .milk preset -> GraphScene as the
 * documented fixed pipeline (docs/milkdrop-execution-model.md §1), with the
 * COMPLETE preset data preserved: every numeric value, init/per-frame/
 * per-pixel(+init) equations, ALL custom waves (with per-point equations)
 * and shapes (with init equations), warp/comp shader text.
 *
 * Nothing is selected, capped, or approximated at import time
 * (COMPATIBILITY-GOAL.md Hard Rules). The graph carries the full pipeline;
 * the executor implements stages from the execution-model doc or refuses.
 */

import {
  GraphScene, GraphNode, MilkWaveNode, MilkShapeNode, ShaderSource, validateGraph,
} from "../core/graph";

export class MilkImportError extends Error {}

/* ------------------------- complete file parse ------------------------ */

export interface MilkParsed {
  name: string;
  /** EVERY numeric key from the preset file, lowercased, verbatim. */
  values: Record<string, number>;
  perFrameInit: string;
  perFrame: string;
  perPixelInit: string;
  perPixel: string;
  warpShader: string;
  compShader: string;
  waves: {
    index: number;
    values: Record<string, number>;
    initCode: string; perFrame: string; perPoint: string;
  }[];
  shapes: {
    index: number;
    values: Record<string, number>;
    initCode: string; perFrame: string;
  }[];
}

/** MilkDrop equation-line concatenation: strip per-line comments, join with
 *  no separator (';' is the only statement boundary — matches real
 *  MilkDrop's file reader). */
const concat = (lines: (string | undefined)[] | undefined): string =>
  (lines ?? []).filter((s): s is string => s !== undefined)
    .map((s) => s.replace(/\/\/.*$/, "")).join("");

export function parseMilkComplete(text: string, filename: string): MilkParsed {
  const name = filename.replace(/\.milk$/i, "").replace(/^.*[\\/]/, "");
  const values: Record<string, number> = {};
  const numbered = new Map<string, string[]>();
  const shaderLines = { warp: [] as string[], comp: [] as string[] };
  const unit = {
    wave: new Map<number, { values: Record<string, number>; init: string[]; perFrame: string[]; perPoint: string[] }>(),
    shape: new Map<number, { values: Record<string, number>; init: string[]; perFrame: string[] }>(),
  };
  const waveOf = (i: number) => unit.wave.get(i) ??
    unit.wave.set(i, { values: {}, init: [], perFrame: [], perPoint: [] }).get(i)!;
  const shapeOf = (i: number) => unit.shape.get(i) ??
    unit.shape.set(i, { values: {}, init: [], perFrame: [] }).get(i)!;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1);
    const num = parseFloat(val);

    let m: RegExpExecArray | null;
    if ((m = /^(warp|comp)_(\d+)$/.exec(key))) {
      shaderLines[m[1] as "warp" | "comp"][parseInt(m[2], 10) - 1] = val.replace(/^`/, "");
    } else if ((m = /^(per_frame_init|per_frame|per_pixel_init|per_pixel)_(\d+)$/.exec(key))) {
      const list = numbered.get(m[1]) ?? [];
      list[parseInt(m[2], 10) - 1] = val;
      numbered.set(m[1], list);
    } else if ((m = /^wavecode_(\d+)_(\w+)$/.exec(key))) {
      if (Number.isFinite(num)) waveOf(+m[1]).values[m[2].toLowerCase()] = num;
    } else if ((m = /^wave_(\d+)_init(\d+)$/.exec(key))) {
      waveOf(+m[1]).init[+m[2] - 1] = val;
    } else if ((m = /^wave_(\d+)_per_frame(\d+)$/.exec(key))) {
      waveOf(+m[1]).perFrame[+m[2] - 1] = val;
    } else if ((m = /^wave_(\d+)_per_point(\d+)$/.exec(key))) {
      waveOf(+m[1]).perPoint[+m[2] - 1] = val;
    } else if ((m = /^shapecode_(\d+)_(\w+)$/.exec(key))) {
      if (Number.isFinite(num)) shapeOf(+m[1]).values[m[2].toLowerCase()] = num;
    } else if ((m = /^shape_(\d+)_init(\d+)$/.exec(key))) {
      shapeOf(+m[1]).init[+m[2] - 1] = val;
    } else if ((m = /^shape_(\d+)_per_frame(\d+)$/.exec(key))) {
      shapeOf(+m[1]).perFrame[+m[2] - 1] = val;
    } else if (Number.isFinite(num)) {
      values[key.toLowerCase()] = num;
    }
    // Non-numeric, non-equation lines (e.g. stray text) carry no preset
    // semantics in the documented format; MilkDrop's reader skips them too.
  }

  return {
    name, values,
    perFrameInit: concat(numbered.get("per_frame_init")),
    perFrame: concat(numbered.get("per_frame")),
    perPixelInit: concat(numbered.get("per_pixel_init")),
    perPixel: concat(numbered.get("per_pixel")),
    warpShader: shaderLines.warp.filter((s) => s !== undefined).join("\n"),
    compShader: shaderLines.comp.filter((s) => s !== undefined).join("\n"),
    waves: [...unit.wave.entries()].sort((a, b) => a[0] - b[0]).map(([index, w]) => ({
      index, values: w.values,
      initCode: concat(w.init), perFrame: concat(w.perFrame), perPoint: concat(w.perPoint),
    })),
    shapes: [...unit.shape.entries()].sort((a, b) => a[0] - b[0]).map(([index, s]) => ({
      index, values: s.values, initCode: concat(s.init), perFrame: concat(s.perFrame),
    })),
  };
}

/* --------------------------- graph construction ----------------------- */

/** Highest GetBlurN referenced across the preset's shader code. */
function blurLevels(...shaders: string[]): 0 | 1 | 2 | 3 {
  let max = 0;
  for (const s of shaders) {
    for (const m of s.matchAll(/GetBlur([123])/g)) max = Math.max(max, parseInt(m[1], 10));
    if (/sampler_blur3/.test(s)) max = Math.max(max, 3);
    else if (/sampler_blur2/.test(s)) max = Math.max(max, 2);
    else if (/sampler_blur1/.test(s)) max = Math.max(max, 1);
  }
  return max as 0 | 1 | 2 | 3;
}

export interface MilkGraphImport {
  graph: GraphScene;
  stats: { waves: number; shapes: number; wavesWithPerPoint: number; blurLevels: number };
}

export function milkToGraph(p: MilkParsed): MilkGraphImport {
  const nodes: GraphNode[] = [];
  const order: string[] = [];
  const push = (n: GraphNode) => { nodes.push(n); order.push(n.id); };

  // Canvas ping-pong pair is one feedback target in graph terms.
  nodes.push({ kind: "target", id: "canvas", feedback: true });

  // Stage order per docs/milkdrop-execution-model.md §1.
  push({
    kind: "milk-frame", id: "frame",
    initCode: p.perFrameInit, perFrame: p.perFrame, baseValues: p.values,
    origin: { format: "milkdrop", type: "per-frame" },
  });
  push({
    kind: "milk-motion-vectors", id: "motionVectors", target: "canvas",
    origin: { format: "milkdrop", type: "motion-vectors" },
  });
  const warpShader: ShaderSource | undefined = p.warpShader
    ? { lang: "hlsl-md", fragment: p.warpShader } : undefined;
  push({
    kind: "milk-warp", id: "warp",
    perPixel: p.perPixel, perPixelInit: p.perPixelInit,
    // Oracle mesh size: butterchurn's default equation-facing mesh is
    // 48x36 (witnessed in extracted globalVars meshx/meshy; mesh size is
    // a renderer setting, not preset data).
    gridX: 48, gridY: 36,
    ...(warpShader ? { warpShader } : {}),
    source: "canvas", target: "canvas",
    origin: { format: "milkdrop", type: "warp" },
  });
  const levels = blurLevels(p.warpShader, p.compShader);
  if (levels > 0) {
    push({
      kind: "milk-blur", id: "blur", levels, source: "canvas",
      origin: { format: "milkdrop", type: "blur-cascade" },
    });
  }
  // ALL shapes, in index order (enabled flag preserved in values).
  for (const s of p.shapes) {
    const node: MilkShapeNode = {
      kind: "milk-shape", id: `shape${s.index}`, index: s.index,
      initCode: s.initCode, perFrame: s.perFrame, baseValues: s.values,
      canvas: "canvas", target: "canvas",
      origin: { format: "milkdrop", type: `shapecode_${s.index}` },
    };
    push(node);
  }
  // ALL custom waves (per-point equations preserved), then the default wave.
  for (const w of p.waves) {
    const node: MilkWaveNode = {
      kind: "milk-wave", id: `wave${w.index}`, custom: true, index: w.index,
      initCode: w.initCode, perFrame: w.perFrame, perPoint: w.perPoint,
      baseValues: w.values, target: "canvas",
      origin: { format: "milkdrop", type: `wavecode_${w.index}` },
    };
    push(node);
  }
  push({
    kind: "milk-wave", id: "defaultWave", custom: false,
    baseValues: {}, target: "canvas",
    origin: { format: "milkdrop", type: "default-wave" },
  });
  push({
    kind: "milk-border", id: "borders", target: "canvas",
    origin: { format: "milkdrop", type: "borders" },
  });
  push({
    kind: "milk-composite", id: "composite",
    ...(p.compShader ? { compShader: { lang: "hlsl-md" as const, fragment: p.compShader } } : {
      legacy: {
        echoZoom: p.values.fvideoechozoom ?? 1,
        echoAlpha: p.values.fvideoechoalpha ?? 0,
        echoOrient: p.values.nvideoechoorientation ?? 0,
        gammaAdj: p.values.fgammaadj ?? 1,
        brighten: (p.values.bbrighten ?? 0) > 0,
        darken: (p.values.bdarken ?? 0) > 0,
        solarize: (p.values.bsolarize ?? 0) > 0,
        invert: (p.values.binvert ?? 0) > 0,
      },
    }),
    source: "canvas", target: "screen",
    origin: { format: "milkdrop", type: "composite" },
  });

  const graph: GraphScene = {
    version: "graph-1",
    name: p.name.toUpperCase(),
    nodes, data: [], order,
    credit: `ported from a MilkDrop preset: ${p.name}`,
    license: "preset equations © original author",
  };
  validateGraph(graph);
  return {
    graph,
    stats: {
      waves: p.waves.length,
      shapes: p.shapes.length,
      wavesWithPerPoint: p.waves.filter((w) => w.perPoint.length > 0).length,
      blurLevels: levels,
    },
  };
}
