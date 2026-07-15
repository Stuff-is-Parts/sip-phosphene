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

/** Per-level (H target ratio, V target ratio) pairs relative to the
 *  main texture resolution. Source: rendering_renderer.js:102
 *  `blurRatios = [[0.5, 0.25], [0.125, 0.125], [0.0625, 0.0625]]`.
 *
 *  Read as: level N's H-pass writes at `pair[0]` of main, level N's
 *  V-pass writes at `pair[1]` of main. Level N+1's H-pass READS from
 *  level N's V output — its source ratio equals `blurRatios[N-1][1]`
 *  (butterchurn's blur.js:3143 `srcBlurRatios = blurRatios[level-1]`
 *  and `getTextureSize(srcBlurRatios[1])`).
 *
 *  Six textures per cascade: three H intermediates (one per level)
 *  plus three V outputs (shader-visible as sampler_blur1/2/3). */
export const BLUR_LEVEL_RATIOS: readonly [readonly [number, number],
                                          readonly [number, number],
                                          readonly [number, number]] = [
  [0.5, 0.25],
  [0.125, 0.125],
  [0.0625, 0.0625],
];

/** Source-exact texture-size rounding for one blur-target dimension
 *  pair. Ports butterchurn's blur.js:3132-3139 `getTextureSize`
 *  verbatim.
 *
 *    sizeX = max(mainW * ratio, 16);
 *    sizeX = floor((sizeX + 3) / 16) * 16
 *    sizeY = max(mainH * ratio, 16);
 *    sizeY = floor((sizeY + 3) / 4) * 4
 *
 *  Minimum size: both axes clamp up to 16 texels. Rounding: X rounds
 *  to the next multiple of 16 (with 3 texels of padding before the
 *  divide), Y rounds to the next multiple of 4 (same padding). The
 *  asymmetric rounding matches the source; an executor that uses
 *  power-of-two rounding or exact-fractional sizes will diverge from
 *  butterchurn's per-texel offsets and blur output. */
export function getBlurTargetSize(
  mainW: number, mainH: number, ratio: number,
): [number, number] {
  let sizeX = Math.max(mainW * ratio, 16);
  sizeX = Math.floor((sizeX + 3) / 16) * 16;
  let sizeY = Math.max(mainH * ratio, 16);
  sizeY = Math.floor((sizeY + 3) / 4) * 4;
  return [sizeX, sizeY];
}

/** Convenience: the six target sizes for a full three-level cascade
 *  at the given main resolution. Returns
 *  `{ h: [level1H, level2H, level3H], v: [level1V, level2V, level3V] }`
 *  where each entry is `[w, h]` after the source rounding. Handy for
 *  executor allocation and for asserting the source-correct sizes in
 *  tests. */
export function getBlurCascadeSizes(mainW: number, mainH: number): {
  h: [[number, number], [number, number], [number, number]];
  v: [[number, number], [number, number], [number, number]];
} {
  return {
    h: [
      getBlurTargetSize(mainW, mainH, BLUR_LEVEL_RATIOS[0][0]),
      getBlurTargetSize(mainW, mainH, BLUR_LEVEL_RATIOS[1][0]),
      getBlurTargetSize(mainW, mainH, BLUR_LEVEL_RATIOS[2][0]),
    ],
    v: [
      getBlurTargetSize(mainW, mainH, BLUR_LEVEL_RATIOS[0][1]),
      getBlurTargetSize(mainW, mainH, BLUR_LEVEL_RATIOS[1][1]),
      getBlurTargetSize(mainW, mainH, BLUR_LEVEL_RATIOS[2][1]),
    ],
  };
}

/** Source ratios flattened as (H input ratio, H target ratio, V target
 *  ratio) per level. Level 1's H input is the main canvas at ratio 1.
 *  Level 2 reads level 1's V output; level 3 reads level 2's V output.
 *  These ratios drive both texture allocation (via `getBlurTargetSize`)
 *  and the horizontal texel-offset scale in the H shader. */
export const BLUR_LEVEL_TRIPLES: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [1.0, BLUR_LEVEL_RATIOS[0][0], BLUR_LEVEL_RATIOS[0][1]],
  [BLUR_LEVEL_RATIOS[0][1], BLUR_LEVEL_RATIOS[1][0], BLUR_LEVEL_RATIOS[1][1]],
  [BLUR_LEVEL_RATIOS[1][1], BLUR_LEVEL_RATIOS[2][0], BLUR_LEVEL_RATIOS[2][1]],
] as const;

/** Uniform-buffer byte layout for the horizontal blur pass shader
 *  (BLUR_H_WGSL). Struct fields align to 16-byte boundaries per WGSL
 *  std140-ish alignment; the total is padded to 16-byte multiples. */
export const BLUR_H_UNIFORM_SIZE = 64; // 4x vec4f + scalars packed

/** Uniform-buffer byte layout for the vertical blur pass shader
 *  (BLUR_V_WGSL). */
export const BLUR_V_UNIFORM_SIZE = 48;

const TARGET_FORMAT: GPUTextureFormat = "rgba8unorm";

/** Six-texture blur cascade — the GPU pipeline that renders
 *  butterchurn's blurShader1/2/3 chain. Owns three horizontal
 *  intermediates and three vertical outputs; caller allocates via
 *  `allocate(mainW, mainH)` after construction and calls
 *  `render(commandEncoder, sourceView, mainW, mainH, mdVSFrame,
 *  numLevels)` each frame to update the cascade. The three vertical
 *  outputs are exposed via `blurVViews` as the shader-visible
 *  `sampler_blur1/2/3` textures.
 *
 *  Uniform layout is per BLUR_H_WGSL and BLUR_V_WGSL. Each level has
 *  its own H uniform buffer and V uniform buffer so the cascade can
 *  be rendered in one encoder pass without buffer reuse hazards.
 *
 *  This class does NOT depend on MilkPipeline; it is a standalone
 *  render helper the pipeline instantiates when a MilkDrop 2 shader
 *  preset requires the cascade. */
export class MilkBlurCascade {
  private hPipeline!: GPURenderPipeline;
  private vPipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;

  /** Horizontal intermediates. Populated by allocate(). */
  hTextures: GPUTexture[] = [];
  /** Vertical outputs — the shader-visible textures. Populated by
   *  allocate(). */
  vTextures: GPUTexture[] = [];
  hViews: GPUTextureView[] = [];
  vViews: GPUTextureView[] = [];
  /** Per-level uniform buffers. */
  private hUnis: GPUBuffer[] = [];
  private vUnis: GPUBuffer[] = [];
  private width = 0;
  private height = 0;

  constructor(private readonly device: GPUDevice) {
    this.buildPipelines();
    this.sampler = device.createSampler({
      magFilter: "linear", minFilter: "linear", mipmapFilter: "linear",
      addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
    });
  }

  private buildPipelines(): void {
    const dev = this.device;
    const hModule = dev.createShaderModule({ code: BLUR_H_WGSL });
    const vModule = dev.createShaderModule({ code: BLUR_V_WGSL });
    this.hPipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: { module: hModule, entryPoint: "vmain" },
      fragment: {
        module: hModule, entryPoint: "fmain",
        targets: [{ format: TARGET_FORMAT }],
      },
      primitive: { topology: "triangle-strip" },
    });
    this.vPipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: { module: vModule, entryPoint: "vmain" },
      fragment: {
        module: vModule, entryPoint: "fmain",
        targets: [{ format: TARGET_FORMAT }],
      },
      primitive: { topology: "triangle-strip" },
    });
  }

  /** (Re)allocate the six textures for the given main resolution. Safe
   *  to call whenever the main resolution changes; destroys previous
   *  textures. Uniform buffers are created lazily and reused. */
  allocate(mainW: number, mainH: number): void {
    if (this.width === mainW && this.height === mainH && this.hTextures.length > 0) {
      return;
    }
    for (const t of this.hTextures) t.destroy();
    for (const t of this.vTextures) t.destroy();
    this.hTextures = []; this.vTextures = [];
    this.hViews = []; this.vViews = [];
    const dev = this.device;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    for (let level = 0; level < 3; level++) {
      const [hR, vR] = [BLUR_LEVEL_RATIOS[level][0], BLUR_LEVEL_RATIOS[level][1]];
      const [hW, hH] = getBlurTargetSize(mainW, mainH, hR);
      const [vW, vH] = getBlurTargetSize(mainW, mainH, vR);
      const hTex = dev.createTexture({ size: [hW, hH], format: TARGET_FORMAT, usage });
      const vTex = dev.createTexture({ size: [vW, vH], format: TARGET_FORMAT, usage });
      this.hTextures.push(hTex);
      this.vTextures.push(vTex);
      this.hViews.push(hTex.createView());
      this.vViews.push(vTex.createView());
      if (!this.hUnis[level]) {
        this.hUnis[level] = dev.createBuffer({
          size: BLUR_H_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.vUnis[level] = dev.createBuffer({
          size: BLUR_V_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      }
    }
    this.width = mainW; this.height = mainH;
  }

  /** Compute uniform bytes for the H pass at a given level. The
   *  buffer layout matches BLUR_H_WGSL's struct U declaration:
   *  texsize:vec4f, ws:vec4f, ds:vec4f, scale:f32, bias:f32, wdiv:f32,
   *  pad:f32. Total 64 bytes. */
  private writeHUniform(
    level: number, srcSize: [number, number],
    scale: number, bias: number,
  ): void {
    const { ws, ds, wDiv } = horizontalUniforms();
    const data = new Float32Array(BLUR_H_UNIFORM_SIZE / 4);
    // texsize (w, h, 1/w, 1/h)
    data[0] = srcSize[0]; data[1] = srcSize[1];
    data[2] = 1 / srcSize[0]; data[3] = 1 / srcSize[1];
    // ws
    data[4] = ws[0]; data[5] = ws[1]; data[6] = ws[2]; data[7] = ws[3];
    // ds
    data[8] = ds[0]; data[9] = ds[1]; data[10] = ds[2]; data[11] = ds[3];
    // scale, bias, wdiv, pad
    data[12] = scale; data[13] = bias; data[14] = wDiv; data[15] = 0;
    this.device.queue.writeBuffer(this.hUnis[level], 0, data);
  }

  /** Compute uniform bytes for the V pass at a given level. Layout
   *  matches BLUR_V_WGSL's struct U: texsize:vec4f, wds:vec4f,
   *  ed1:f32, ed2:f32, ed3:f32, wdiv:f32. Total 48 bytes. */
  private writeVUniform(
    level: number, srcSize: [number, number], b1ed: number,
  ): void {
    const { wds, wDiv } = verticalUniforms();
    const data = new Float32Array(BLUR_V_UNIFORM_SIZE / 4);
    data[0] = srcSize[0]; data[1] = srcSize[1];
    data[2] = 1 / srcSize[0]; data[3] = 1 / srcSize[1];
    data[4] = wds[0]; data[5] = wds[1]; data[6] = wds[2]; data[7] = wds[3];
    // ed1 = 1 - b1ed on level 0, else 1; ed2 = b1ed on level 0, else 0.
    const active = level === 0;
    data[8] = active ? (1 - b1ed) : 1;
    data[9] = active ? b1ed : 0;
    data[10] = 5.0;
    data[11] = wDiv;
    this.device.queue.writeBuffer(this.vUnis[level], 0, data);
  }

  /** Render the blur cascade for `numLevels` levels using the current
   *  main texture as the level-1 input. `mdVSFrame` provides the
   *  preset's `b1n/b1x/b2n/b2x/b3n/b3x` values and `b1ed` for edge
   *  darken; the caller has already applied any per-frame equation
   *  updates. Blur ranges are clamped via `getBlurValues`.
   *
   *  This method issues render passes into the provided command
   *  encoder; the caller submits the encoder. */
  render(
    encoder: GPUCommandEncoder,
    sourceView: GPUTextureView,
    numLevels: 1 | 2 | 3,
    blurRanges: { blurMins: readonly number[]; blurMaxs: readonly number[] },
    b1ed: number,
  ): void {
    const dev = this.device;
    const { blurMins, blurMaxs } = blurRanges;
    let hInput = sourceView;
    for (let level = 0; level < numLevels; level++) {
      const [hInputRatio] = BLUR_LEVEL_TRIPLES[level];
      const srcHSize: [number, number] = getBlurTargetSize(this.width, this.height, hInputRatio);
      const { scale, bias } = getScaleAndBias(level as 0 | 1 | 2, blurMins, blurMaxs);
      this.writeHUniform(level, srcHSize, scale, bias);
      const hBind = dev.createBindGroup({
        layout: this.hPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.hUnis[level] } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: hInput },
        ],
      });
      const hPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.hViews[level], loadOp: "clear", storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      hPass.setPipeline(this.hPipeline);
      hPass.setBindGroup(0, hBind);
      hPass.draw(4);
      hPass.end();

      // Vertical pass: sample the H intermediate, write the V output.
      const [, hTargetRatio] = BLUR_LEVEL_TRIPLES[level];
      const srcVSize: [number, number] = getBlurTargetSize(this.width, this.height, hTargetRatio);
      this.writeVUniform(level, srcVSize, b1ed);
      const vBind = dev.createBindGroup({
        layout: this.vPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.vUnis[level] } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: this.hViews[level] },
        ],
      });
      const vPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.vViews[level], loadOp: "clear", storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      vPass.setPipeline(this.vPipeline);
      vPass.setBindGroup(0, vBind);
      vPass.draw(4);
      vPass.end();

      // Next level reads THIS level's V output.
      hInput = this.vViews[level];
    }
  }

  destroy(): void {
    for (const t of this.hTextures) t.destroy();
    for (const t of this.vTextures) t.destroy();
    this.hTextures = []; this.vTextures = [];
    this.hViews = []; this.vViews = [];
    this.width = 0; this.height = 0;
  }
}
