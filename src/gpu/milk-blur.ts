/**
 * MilkDrop blur cascade shaders (H + V separable Gaussian) ported
 * verbatim from butterchurn's blurHorizontal.js / blurVertical.js
 * source (docs/evidence/butterchurn/rendering_shaders_blur_blurHorizontal.js
 * and rendering_shaders_blur_blurVertical.js). Every constant, weight,
 * and formula matches the source; anything an implementer changes must
 * cite the source line the change deviates from.
 *
 * The cascade produces three levels (blur1, blur2, blur3) at 0.5x,
 * 0.25x, 0.125x of the main texture resolution (rendering_renderer.js:102
 * `blurRatios = [[0.5, 0.25], [0.125, 0.125], [0.0625, 0.0625]]` — a
 * pair per level of (H target ratio, V target ratio)). Each level runs
 * one horizontal pass and one vertical pass on the previous level's V
 * output; level 1 samples the main texture.
 *
 * Range compression: each level packs its dynamic range into 8-bit
 * storage. The horizontal pass computes `blur = weighted_sum * wdiv;
 * blur = blur * scale + bias` from the source's blurN_min / blurN_max
 * uniforms via `getScaleAndBias`. The vertical pass applies edge-darken
 * only on level 1 (b1ed) and skips it on levels 2 and 3. The shader
 * header (docs/evidence/projectm/PresetShaderHeaderGlsl330.inc lines
 * 149-151) decompresses on read: `GetBlurN(uv) = sample * _cN.x + _cN.y`.
 */

// Weight vector used at both stages (blurHorizontal.js:28, blurVertical.js:28).
export const BLUR_WEIGHTS = [4.0, 3.8, 3.5, 2.9, 1.9, 1.2, 0.7, 0.3] as const;

/** Horizontal-pass per-level weights and offsets — matches
 *  blurHorizontal.js:29-39 verbatim. Result is packed as
 *  (ws4, ds4, wDiv) for shader uniforms. */
export function horizontalUniforms(): {
  ws: [number, number, number, number];
  ds: [number, number, number, number];
  wDiv: number;
} {
  const w = BLUR_WEIGHTS;
  const w1H = w[0] + w[1];
  const w2H = w[2] + w[3];
  const w3H = w[4] + w[5];
  const w4H = w[6] + w[7];
  const d1H = 0 + 2 * w[1] / w1H;
  const d2H = 2 + 2 * w[3] / w2H;
  const d3H = 4 + 2 * w[5] / w3H;
  const d4H = 6 + 2 * w[7] / w4H;
  return {
    ws: [w1H, w2H, w3H, w4H],
    ds: [d1H, d2H, d3H, d4H],
    wDiv: 0.5 / (w1H + w2H + w3H + w4H),
  };
}

/** Vertical-pass per-level weights and offsets — matches
 *  blurVertical.js:29-34 verbatim. */
export function verticalUniforms(): {
  wds: [number, number, number, number];
  wDiv: number;
} {
  const w = BLUR_WEIGHTS;
  const w1V = w[0] + w[1] + w[2] + w[3];
  const w2V = w[4] + w[5] + w[6] + w[7];
  const d1V = 0 + 2 * ((w[2] + w[3]) / w1V);
  const d2V = 2 + 2 * ((w[6] + w[7]) / w2V);
  return {
    wds: [w1V, w2V, d1V, d2V],
    wDiv: 1.0 / ((w1V + w2V) * 2),
  };
}

/** Per-level (scale, bias) for the H-pass range compression — matches
 *  blurHorizontal.js:69-89 verbatim. Level 0 (blur1) uses the
 *  raw [min, max] range; level 1 (blur2) uses the range of blur2's
 *  bounds RELATIVE to blur1's, so the shader can chain decompression
 *  by multiplying decompression factors. Same recurrence for level 2.
 *
 *  Preconditions: blurMins.length === 3, blurMaxs.length === 3,
 *  blurLevel ∈ {0, 1, 2}. Butterchurn asserts these by construction
 *  because the caller always passes exactly 3 elements. */
export function getScaleAndBias(
  blurLevel: 0 | 1 | 2,
  blurMins: readonly number[],
  blurMaxs: readonly number[],
): { scale: number; bias: number } {
  const scale = [1, 1, 1];
  const bias = [0, 0, 0];
  scale[0] = 1.0 / (blurMaxs[0] - blurMins[0]);
  bias[0] = -blurMins[0] * scale[0];
  const tempMin1 = (blurMins[1] - blurMins[0]) / (blurMaxs[0] - blurMins[0]);
  const tempMax1 = (blurMaxs[1] - blurMins[0]) / (blurMaxs[0] - blurMins[0]);
  scale[1] = 1.0 / (tempMax1 - tempMin1);
  bias[1] = -tempMin1 * scale[1];
  const tempMin2 = (blurMins[2] - blurMins[1]) / (blurMaxs[1] - blurMins[1]);
  const tempMax2 = (blurMaxs[2] - blurMins[1]) / (blurMaxs[1] - blurMins[1]);
  scale[2] = 1.0 / (tempMax2 - tempMin2);
  bias[2] = -tempMin2 * scale[2];
  return { scale: scale[blurLevel], bias: bias[blurLevel] };
}

/** WGSL fragment shader for the horizontal blur pass — port of the
 *  GLSL 300 es at blurHorizontal.js:54 verbatim. Reads a source texture,
 *  performs 4 pairs of ± horizontal offset samples weighted by ws[0..3]
 *  and offset by ds[0..3] scaled by texsize.z (= 1/width), multiplies by
 *  wdiv, then applies scale + bias for range compression. Output: RGBA
 *  with alpha = 1. */
export const BLUR_H_WGSL = /* wgsl */ `
struct U {
  texsize : vec4f,   // (w, h, 1/w, 1/h) of the source texture
  ws      : vec4f,   // pair-sum weights
  ds      : vec4f,   // pair-offset positions
  scale   : f32,     // range-compression scale (per level)
  bias    : f32,     // range-compression bias  (per level)
  wdiv    : f32,     // 0.5 / sum(ws)
  pad0    : f32,
};
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var src  : texture_2d<f32>;

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vmain(@builtin(vertex_index) vi : u32) -> VOut {
  var corners = array<vec2f, 4>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0),
    vec2f(-1.0,  1.0), vec2f(1.0,  1.0),
  );
  let p = corners[vi];
  var o : VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  return o;
}

@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  let w1 = u.ws.x;  let w2 = u.ws.y;  let w3 = u.ws.z;  let w4 = u.ws.w;
  let d1 = u.ds.x;  let d2 = u.ds.y;  let d3 = u.ds.z;  let d4 = u.ds.w;
  let uv2 = in.uv;
  let txZ = u.texsize.z;
  var blur =
    ( textureSample(src, samp, uv2 + vec2f( d1 * txZ, 0.0)).xyz
    + textureSample(src, samp, uv2 + vec2f(-d1 * txZ, 0.0)).xyz) * w1 +
    ( textureSample(src, samp, uv2 + vec2f( d2 * txZ, 0.0)).xyz
    + textureSample(src, samp, uv2 + vec2f(-d2 * txZ, 0.0)).xyz) * w2 +
    ( textureSample(src, samp, uv2 + vec2f( d3 * txZ, 0.0)).xyz
    + textureSample(src, samp, uv2 + vec2f(-d3 * txZ, 0.0)).xyz) * w3 +
    ( textureSample(src, samp, uv2 + vec2f( d4 * txZ, 0.0)).xyz
    + textureSample(src, samp, uv2 + vec2f(-d4 * txZ, 0.0)).xyz) * w4;
  blur = blur * u.wdiv;
  blur = blur * u.scale + vec3f(u.bias);
  return vec4f(blur, 1.0);
}
`;

/** WGSL fragment shader for the vertical blur pass — port of the GLSL
 *  300 es at blurVertical.js:49 verbatim. Reads a source texture, does 2
 *  pairs of ± vertical offset samples weighted by wds.xy and offset by
 *  wds.zw scaled by texsize.w (= 1/height), multiplies by wdiv, then
 *  applies edge darken:
 *    t = min(uv.x, uv.y, 1-max(uv.x, uv.y));
 *    t = sqrt(t);
 *    t = ed1 + ed2 * clamp(t * ed3, 0, 1);
 *  where ed1 = 1 - b1ed, ed2 = b1ed, ed3 = 5.0 on level 0; and
 *  ed1 = 1, ed2 = 0, ed3 = 5.0 on levels 1 and 2 (b1ed only affects
 *  the first blur level per blurVertical.js:74). Output: RGBA. */
export const BLUR_V_WGSL = /* wgsl */ `
struct U {
  texsize : vec4f,   // (w, h, 1/w, 1/h)
  wds     : vec4f,   // (w1, w2, d1, d2)
  ed1     : f32,
  ed2     : f32,
  ed3     : f32,
  wdiv    : f32,
};
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var src  : texture_2d<f32>;

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vmain(@builtin(vertex_index) vi : u32) -> VOut {
  var corners = array<vec2f, 4>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0),
    vec2f(-1.0,  1.0), vec2f(1.0,  1.0),
  );
  let p = corners[vi];
  var o : VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  return o;
}

@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  let w1 = u.wds.x;  let w2 = u.wds.y;
  let d1 = u.wds.z;  let d2 = u.wds.w;
  let uv2 = in.uv;
  let txW = u.texsize.w;
  var blur =
    ( textureSample(src, samp, uv2 + vec2f(0.0,  d1 * txW)).xyz
    + textureSample(src, samp, uv2 + vec2f(0.0, -d1 * txW)).xyz) * w1 +
    ( textureSample(src, samp, uv2 + vec2f(0.0,  d2 * txW)).xyz
    + textureSample(src, samp, uv2 + vec2f(0.0, -d2 * txW)).xyz) * w2;
  blur = blur * u.wdiv;
  var t = min(min(in.uv.x, in.uv.y), 1.0 - max(in.uv.x, in.uv.y));
  t = sqrt(t);
  t = u.ed1 + u.ed2 * clamp(t * u.ed3, 0.0, 1.0);
  blur = blur * t;
  return vec4f(blur, 1.0);
}
`;

/** Per-level output-texture resolution ratios relative to the main
 *  texture. rendering_renderer.js:102:
 *    blurRatios = [[0.5, 0.25], [0.125, 0.125], [0.0625, 0.0625]];
 *  Each pair is (H-pass output ratio, V-pass output ratio) — the H
 *  pass writes at 0.5x width for level 1 and the V pass reads that
 *  and writes at 0.25x. Level 2 chains from level 1's V output at
 *  0.125x, and level 3 at 0.0625x. The user-facing blur1/blur2/blur3
 *  textures are the V-pass outputs at each level. */
export const BLUR_LEVEL_RATIOS: readonly [readonly [number, number],
                                          readonly [number, number],
                                          readonly [number, number]] = [
  [0.5, 0.25],
  [0.125, 0.125],
  [0.0625, 0.0625],
];
