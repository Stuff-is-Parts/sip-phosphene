/**
 * PHOSPHENE port of projectM's Filters draw at
 * docs/evidence/projectm/Filters.cpp (pinned SHA
 * 2f244141320f6b97b09bf99964cc72a4efdfcfd3). Reproduces the
 * source-defined destination-blend draw sequences for brighten, darken,
 * solarize, and invert against the same viewport-overscan quad the
 * VideoEcho stage uses — filters draw AFTER VideoEcho or gamma
 * adjustment writes the composite intermediate.
 */

/** Vertex + fragment WGSL for the projectM untextured draw path used by
 *  Filters. The fragment outputs the vertex color unchanged; blend
 *  state provides the effect. */
export const UNTEXTURED_WGSL = /* wgsl */ `
struct U { transform : mat4x4f };
@group(0) @binding(0) var<uniform> u : U;
struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) col : vec4f,
};
@vertex
fn vmain(@location(0) aPos : vec2f, @location(1) aCol : vec4f) -> VOut {
  var o : VOut;
  o.pos = u.transform * vec4f(aPos, 0.0, 1.0);
  o.col = aCol;
  return o;
}
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  return in.col;
}
`;

/** Named WebGPU blend factor pair identifying one filter blend state. */
export interface FilterBlend {
  src: GPUBlendFactor;
  dst: GPUBlendFactor;
  key: string;
}

/** Enumerate the exact blend factor pairs projectM uses across the four
 *  filters. `key` is used to look up the pipeline. */
export const FILTER_BLENDS = {
  oneMinusDstZero:  { src: "one-minus-dst" as GPUBlendFactor, dst: "zero" as GPUBlendFactor, key: "one-minus-dst--zero" },
  zeroDst:          { src: "zero" as GPUBlendFactor, dst: "dst" as GPUBlendFactor, key: "zero--dst" },
  zeroOneMinusDst:  { src: "zero" as GPUBlendFactor, dst: "one-minus-dst" as GPUBlendFactor, key: "zero--one-minus-dst" },
  dstOne:           { src: "dst" as GPUBlendFactor, dst: "one" as GPUBlendFactor, key: "dst--one" },
} as const;

/** One filter draw plan. */
export interface FilterDraw {
  blend: FilterBlend;
  /** Trace label MilkPipeline pushes when this draw fires. */
  label: string;
}

/** Plan the filter passes in projectM's fixed source order:
 *    brighten → darken → solarize → invert.
 *
 *  Brighten fires three draws in projectM's order:
 *    (OneMinusDst, Zero), (Zero, Dst), (OneMinusDst, Zero).
 *  Darken fires one draw at (Zero, Dst).
 *  Solarize fires two draws at (Zero, OneMinusDst) then (Dst, One).
 *  Invert fires one draw at (OneMinusDst, Zero). */
export function planFilterDraws(flags: {
  brighten: boolean;
  darken: boolean;
  solarize: boolean;
  invert: boolean;
}): FilterDraw[] {
  const draws: FilterDraw[] = [];
  if (flags.brighten) {
    draws.push({ blend: FILTER_BLENDS.oneMinusDstZero, label: "filter-brighten-0" });
    draws.push({ blend: FILTER_BLENDS.zeroDst,         label: "filter-brighten-1" });
    draws.push({ blend: FILTER_BLENDS.oneMinusDstZero, label: "filter-brighten-2" });
  }
  if (flags.darken) {
    draws.push({ blend: FILTER_BLENDS.zeroDst, label: "filter-darken-0" });
  }
  if (flags.solarize) {
    draws.push({ blend: FILTER_BLENDS.zeroOneMinusDst, label: "filter-solarize-0" });
    draws.push({ blend: FILTER_BLENDS.dstOne,          label: "filter-solarize-1" });
  }
  if (flags.invert) {
    draws.push({ blend: FILTER_BLENDS.oneMinusDstZero, label: "filter-invert-0" });
  }
  return draws;
}

/** Vertex color that projectM binds via `glVertexAttrib4f(1, 1, 1, 1, 1)`
 *  for every filter draw. The filters' effect comes entirely from the
 *  blend factors; the color output is pure white. */
export const FILTER_VERTEX_COLOR: readonly [number, number, number, number] = [1, 1, 1, 1];
