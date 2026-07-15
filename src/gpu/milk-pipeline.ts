/**
 * MilkDrop pipeline executor on WebGPU — a stage-by-stage port of the
 * validation oracle's renderer (butterchurn; verbatim module sources at
 * docs/evidence/butterchurn/), driven by the graph importer's milk-*
 * nodes and the oracle-validated equation runner (core/milk-runner.ts).
 *
 * v1 scope (structural, not approximation): presets WITHOUT MilkDrop 2
 * warp/comp shaders execute through the witnessed fixed pipeline
 * (per-frame/per-pixel equations, default warp+decay, motion vectors,
 * custom shapes, custom waves with per-point equations, basic waveform
 * modes 0-7, darken-center, borders, default composite). Presets carrying
 * warp/comp shader text or blur usage REFUSE with UnsupportedGraphError —
 * nothing is approximated (COMPATIBILITY-GOAL.md Hard Rules).
 *
 * Coordinate convention: all witnessed geometry/UV math is kept in the
 * oracle's WebGL convention; every vertex shader negates NDC y so texel
 * storage/sampling relationships match GL exactly (a GL sample(v) equals
 * a WebGPU sample(v) after the flip); the final composite draws with the
 * same flip, matching the oracle's canvas orientation.
 *
 * Render targets are rgba8unorm with full mip chains (witnessed:
 * texImage2D RGBA/UNSIGNED_BYTE + generateMipmap each frame +
 * LINEAR_MIPMAP_LINEAR + anisotropy) — 8-bit quantization is part of the
 * oracle's decay behavior.
 */

import { Renderer } from "./renderer";
import { MilkPresetRunner, makeMulberry32, REGS, type Pool, type MilkRng } from "../core/milk-runner";
import {
  GraphScene, GraphNode, MilkWaveNode, MilkShapeNode,
  UnsupportedNodeError, unsupportedFeatures, validateGraph,
} from "../core/graph";
import { UnsupportedGraphError } from "./graph-executor";

/** Per-frame injected inputs: the oracle-validated global variables plus
 *  the processed audio arrays (AudioProcessor outputs; witnessed chain
 *  ported in scripts/lib/milk-audio-model.mjs). */
export interface MilkFrameData {
  globals: Pool; // frame,time,fps,bass..treb_att,meshx..pixelsy
  timeArrayL: Int8Array | number[];
  timeArrayR: Int8Array | number[];
  freqArrayL: Float32Array | number[];
  freqArrayR: Float32Array | number[];
}


const GRID_X = 48, GRID_Y = 36;   // witnessed oracle mesh (globalVars meshx/meshy)
const COMP_W = 32, COMP_H = 24;   // witnessed comp grid (comp.js constructor)
const MAX_SAMPLES = 512;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* --------------------------------- WGSL -------------------------------- */

// Warp pass (witnessed shaders/warp.js default path):
// ret = texture(sampler_main, uv).rgb * decay; fragColor = vec4(ret,1)*vColor
const WARP_WGSL = /* wgsl */ `
struct U { decay : f32, pad0 : f32, pad1 : f32, pad2 : f32 };
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var mainTex : texture_2d<f32>;
struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) vColor : vec4f,
};
@vertex
fn vmain(@location(0) aPos : vec2f, @location(1) aWarpUv : vec2f,
         @location(2) aWarpColor : vec4f) -> VOut {
  var o : VOut;
  o.pos = vec4f(aPos.x, -aPos.y, 0.0, 1.0);
  o.uv = aWarpUv;
  o.vColor = aWarpColor;
  return o;
}
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  let ret = textureSample(mainTex, samp, in.uv).rgb * u.decay;
  return vec4f(ret, 1.0) * in.vColor;
}
`;

// Line/point-color pass (witnessed wave/motion/border shaders: plain
// per-vertex color; thickOffset instances become instance-indexed offsets).
const LINE_WGSL = /* wgsl */ `
struct U { texsize : vec2f, thickMode : f32, pad : f32 };
@group(0) @binding(0) var<uniform> u : U;
struct VOut { @builtin(position) pos : vec4f, @location(0) col : vec4f };
@vertex
fn vmain(@location(0) aPos : vec2f, @location(1) aColor : vec4f,
         @builtin(instance_index) inst : u32) -> VOut {
  var off = vec2f(0.0);
  if (u.thickMode > 0.5) {
    let o = 2.0;
    if (inst == 1u) { off = vec2f(o / u.texsize.x, 0.0); }
    else if (inst == 2u) { off = vec2f(0.0, o / u.texsize.y); }
    else if (inst == 3u) { off = vec2f(o / u.texsize.x, o / u.texsize.y); }
  }
  var o2 : VOut;
  let p = aPos + off;
  o2.pos = vec4f(p.x, -p.y, 0.0, 1.0);
  o2.col = aColor;
  return o2;
}
@fragment
fn fmain(in : VOut) -> @location(0) vec4f { return in.col; }
`;

// Dot pass: GL POINTS with gl_PointSize s == s-pixel square centered on
// the position (witnessed uSize 1..3); expanded to instanced quads.
const DOT_WGSL = /* wgsl */ `
struct U { texsize : vec2f, size : f32, pad : f32 };
@group(0) @binding(0) var<uniform> u : U;
struct VOut { @builtin(position) pos : vec4f, @location(0) col : vec4f };
@vertex
fn vmain(@builtin(vertex_index) vi : u32,
         @location(0) center : vec2f, @location(1) aColor : vec4f) -> VOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[vi];
  let halfPx = u.size * 0.5;
  let p = center + corner * vec2f(halfPx * 2.0 / u.texsize.x, halfPx * 2.0 / u.texsize.y);
  var o : VOut;
  o.pos = vec4f(p.x, -p.y, 0.0, 1.0);
  o.col = aColor;
  return o;
}
@fragment
fn fmain(in : VOut) -> @location(0) vec4f { return in.col; }
`;

// Shape fill pass (witnessed shapes/customShape.js shader): per-vertex
// color+uv, optional texture (previous frame), textured flag per vertex.
const SHAPE_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var tex : texture_2d<f32>;
struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) col : vec4f,
  @location(1) uv : vec2f,
  @location(2) textured : f32,
};
@vertex
fn vmain(@location(0) aPos : vec2f, @location(1) aColor : vec4f,
         @location(2) aUv : vec2f, @location(3) aTextured : f32) -> VOut {
  var o : VOut;
  o.pos = vec4f(aPos.x, -aPos.y, 0.0, 1.0);
  o.col = aColor;
  o.uv = aUv;
  o.textured = aTextured;
  return o;
}
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  // textureSample must stay in uniform control flow (WGSL rule) — sample
  // unconditionally, select per the textured flag (same result as the
  // witnessed branch).
  let texel = textureSample(tex, samp, in.uv) * in.col;
  return select(in.col, texel, in.textured != 0.0);
}
`;

// Default composite (witnessed shaders/comp.js zero-shader path),
// rendered as the 32x24 grid with interpolated hue colors.
const COMP_WGSL = /* wgsl */ `
struct U {
  gammaAdj : f32, echo_zoom : f32, echo_alpha : f32, echo_orientation : f32,
  invert : f32, brighten : f32, darken : f32, solarize : f32,
  fShader : f32, pad0 : f32, pad1 : f32, pad2 : f32,
};
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var mainTex : texture_2d<f32>;
struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) vUv : vec2f,
  @location(1) vColor : vec4f,
};
@vertex
fn vmain(@location(0) aPos : vec2f, @location(1) aCompColor : vec4f) -> VOut {
  var o : VOut;
  // Final pass: NO y negation — offscreen passes store the GL-consistent
  // (mirrored) image, and drawing it unmirrored here lands the oracle's
  // screen orientation (verified: flipped output matched the oracle
  // exactly across 300 feedback frames before this fix).
  o.pos = vec4f(aPos, 0.0, 1.0);
  o.vUv = aPos * vec2f(0.5) + vec2f(0.5);
  o.vColor = aCompColor;
  return o;
}
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  var uv = in.vUv;
  uv.y = 1.0 - uv.y;
  let hue_shader = in.vColor.rgb;
  let orient_horiz = uv.x * 0.0 + (u.echo_orientation - 2.0 * floor(u.echo_orientation / 2.0)); // mod(echo_orientation, 2)
  var orient_x = 1.0;
  if (orient_horiz != 0.0) { orient_x = -1.0; }
  var orient_y = 1.0;
  if (u.echo_orientation >= 2.0) { orient_y = -1.0; }
  let uv_echo = ((uv - 0.5) * (1.0 / u.echo_zoom) * vec2f(orient_x, orient_y)) + 0.5;
  var ret = mix(textureSample(mainTex, samp, uv).rgb,
                textureSample(mainTex, samp, uv_echo).rgb,
                u.echo_alpha);
  ret = ret * u.gammaAdj;
  if (u.fShader >= 1.0) {
    ret = ret * hue_shader;
  } else if (u.fShader > 0.001) {
    ret = ret * ((1.0 - u.fShader) + (u.fShader * hue_shader));
  }
  if (u.brighten != 0.0) { ret = sqrt(ret); }
  if (u.darken != 0.0) { ret = ret * ret; }
  if (u.solarize != 0.0) { ret = ret * (1.0 - ret) * 4.0; }
  if (u.invert != 0.0) { ret = 1.0 - ret; }
  return vec4f(ret, in.vColor.a);
}
`;

// Mip blit: linear downsample level i-1 -> i (GL generateMipmap
// equivalent box reduction via linear sampling at half resolution).
const MIP_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var src : texture_2d<f32>;
struct VOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };
@vertex
fn vmain(@builtin(vertex_index) vi : u32) -> VOut {
  var o : VOut;
  let p = vec2f(f32(i32(vi & 1u) * 4 - 1), f32(i32(vi >> 1u) * 4 - 1));
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return o;
}
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  return textureSample(src, samp, in.uv);
}
`;

const TARGET_FORMAT: GPUTextureFormat = "rgba8unorm";

interface MilkTarget { tex: GPUTexture; views: GPUTextureView[]; mipCount: number }

/** True when any EEL program in the graph references gmegabuf. Since
 *  our per-context pools store gmegabuf writes but do not share cells
 *  cross-context within a frame, presets touching gmegabuf cannot be
 *  faithfully executed today. */
/** Syntax-aware, case-insensitive detector for gmegabuf references.
 *  MilkDrop identifiers are case-insensitive — the converter lowercases
 *  them before evaluation, so a preset writing `GMEGABUF(3)` or
 *  `GMegabuf(reg00)` reaches our EEL compiler as `gmegabuf`. The detector
 *  strips comments and quoted strings before scanning so a `//` comment
 *  containing the token cannot false-positive, and requires a word
 *  boundary + optional whitespace + `(` after the identifier so a
 *  variable named `mygmegabuf` (no evidence it exists in the corpus, but
 *  cheap to guard) does not trip it.
 *
 *  Refusal continues until true shared 1M-cell storage across preset,
 *  pixel, wave, and shape contexts is implemented (COMPATIBILITY-GOAL.md
 *  Hard Rules). */
function usesGmegabuf(g: GraphScene): boolean {
  const scan = (src: string | undefined | null): boolean => {
    if (!src) return false;
    // Strip line comments and block comments (MilkDrop EEL uses //).
    const noComments = src
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Case-insensitive with word-boundary + optional whitespace before "(".
    return /\bgmegabuf\s*\(/i.test(noComments);
  };
  for (const n of g.nodes) {
    if (n.kind === "milk-frame" && (scan(n.initCode) || scan(n.perFrame))) return true;
    if (n.kind === "milk-warp" && (scan(n.perPixel) || scan(n.perPixelInit))) return true;
    if (n.kind === "milk-wave") {
      if (scan(n.initCode) || scan(n.perFrame) || scan(n.perPoint)) return true;
    }
    if (n.kind === "milk-shape") {
      if (scan(n.initCode) || scan(n.perFrame)) return true;
    }
  }
  return false;
}

/** A queued primitive draw for the canvas pass. */
interface CanvasDraw {
  kind: "line-strip" | "line-list" | "dots" | "shape-fill";
  blend: "alpha" | "additive";
  first: number;      // first vertex (line/shape: vertex index; dots: instance)
  count: number;
  instances: number;  // thick instances for lines; 1 otherwise
  thick: boolean;
  dotSize?: number;
  texturedShape?: boolean; // shape-fill sampling prev frame
}

export class MilkPipeline {
  private device!: GPUDevice;
  private width = 4;
  private height = 4;
  private aspectx = 1;     // render aspect (witnessed renderer.js)
  private aspecty = 1;
  private invAspectx = 1;
  private invAspecty = 1;

  // MilkPresetRunner exposed as readable state so the E2E harness can
  // inspect PHOSPHENE's post-equation mdVSFrame each frame.
  runner: MilkPresetRunner | null = null;
  /** Most recent post-per-frame mdVSFrame pool (populated after each
   *  frame() call). Read-only for external consumers. */
  lastMdVSFrame: Pool | null = null;
  private regVars: Pool = {};
  private waveNodes: MilkWaveNode[] = [];
  private shapeNodes: MilkShapeNode[] = [];
  private oldWaveMode = 0; // loadPreset: prev preset (blank) wave_mode = 0

  private target!: MilkTarget;
  private prev!: MilkTarget;

  private warpUVs = new Float32Array(new ArrayBuffer((GRID_X + 1) * (GRID_Y + 1) * 2 * 4));
  private warpPositions!: Float32Array<ArrayBuffer>; // GL-convention (x, -y) pairs
  private warpIndices!: Uint16Array<ArrayBuffer>;
  private warpColorOnes!: Float32Array<ArrayBuffer>;

  private sampRepeat!: GPUSampler;
  private sampClamp!: GPUSampler;
  private sampMip!: GPUSampler;

  private warpPipeline!: GPURenderPipeline;
  private linePipelines!: Record<string, GPURenderPipeline>;
  private dotPipelines!: Record<string, GPURenderPipeline>;
  private shapePipelines!: Record<string, GPURenderPipeline>;
  private compPipeline!: GPURenderPipeline;
  private mipPipeline!: GPURenderPipeline;

  private warpUni!: GPUBuffer;
  private lineUni!: GPUBuffer;      // thick
  private lineUniNoThick!: GPUBuffer;
  private dotUnis: GPUBuffer[] = []; // by size 1..3
  private compUni!: GPUBuffer;

  private warpPosBuf!: GPUBuffer;
  private warpUvBuf!: GPUBuffer;
  private warpColBuf!: GPUBuffer;
  private warpIdxBuf!: GPUBuffer;
  private compPosBuf!: GPUBuffer;
  private compColBuf!: GPUBuffer;
  private compIdxBuf!: GPUBuffer;
  private compIndexCount = 0;

  private canvasVertBuf: GPUBuffer | null = null;

  /** RNG stream fed to the runner; committed seed by default so every
   *  preset execution is reproducible without external Math.random
   *  patching. Callers may pass an explicit MilkRng when a specific
   *  seeded stream is required (e.g. E2E validation aligned to the
   *  instrumented oracle). */
  private readonly rng: MilkRng;
  constructor(private readonly renderer: Renderer, rng?: MilkRng) {
    this.rng = rng ?? makeMulberry32(0x5eed1e55);
  }

  /* ------------------------------ loading ------------------------------ */

  async load(g: GraphScene): Promise<{ errors: string[] }> {
    validateGraph(g);
    const unsupported = unsupportedFeatures(g);
    if (unsupported.length) throw new UnsupportedNodeError(unsupported);

    const refused: string[] = [];
    const frameNode = g.nodes.find((n) => n.kind === "milk-frame");
    const warpNode = g.nodes.find((n) => n.kind === "milk-warp");
    const compNode = g.nodes.find((n) => n.kind === "milk-composite");
    if (!frameNode || frameNode.kind !== "milk-frame") refused.push("missing milk-frame node");
    if (!warpNode || warpNode.kind !== "milk-warp") refused.push("missing milk-warp node");
    if (!compNode || compNode.kind !== "milk-composite") refused.push("missing milk-composite node");
    if (warpNode && warpNode.kind === "milk-warp" && warpNode.warpShader) {
      refused.push("milk-warp:warpShader (MilkDrop 2 warp shader translation not yet implemented)");
    }
    if (compNode && compNode.kind === "milk-composite" && compNode.compShader) {
      refused.push("milk-composite:compShader (MilkDrop 2 comp shader translation not yet implemented)");
    }
    if (g.nodes.some((n) => n.kind === "milk-blur")) {
      refused.push("milk-blur (blur cascade consumed only by unimplemented shaders)");
    }
    // Refuse — do not approximate — semantics that are not exact:
    // - perPixelInit: the oracle runs per-pixel init once at preset load
    //   inside a per-vertex context and its outputs feed the very first
    //   per_pixel run (butterchurn presetEquationRunner.js — the current
    //   MilkPresetRunner does not model that init separately, so any
    //   preset carrying non-empty per_pixel_init MUST refuse.
    // - gmegabuf sharing: exact behavior requires a single shared 1M-cell
    //   array visible to preset, pixel, wave, and shape contexts within
    //   a single frame (butterchurn presetEquationRunner.js:
    //   this.gmegabuf = new Array(1048576).fill(0); mdVSBase.gmegabuf =
    //   this.gmegabuf). Current expr.ts stores @gmb keys in per-context
    //   pools that are only merged post-hoc, which is not sharing —
    //   detect and refuse.
    if (warpNode && warpNode.kind === "milk-warp" && warpNode.perPixelInit && warpNode.perPixelInit.trim().length > 0) {
      refused.push("milk-warp:perPixelInit (per-vertex init lifecycle not yet implemented — refused per COMPATIBILITY-GOAL.md Hard Rules)");
    }
    if (usesGmegabuf(g)) {
      refused.push("gmegabuf (cross-context shared 1M-cell buffer not yet implemented — refused per COMPATIBILITY-GOAL.md Hard Rules)");
    }
    if (refused.length) throw new UnsupportedGraphError(refused);
    if (!frameNode || frameNode.kind !== "milk-frame") throw new Error("unreachable");
    if (!warpNode || warpNode.kind !== "milk-warp") throw new Error("unreachable");

    this.device = this.renderer.gpuDevice;
    const { width, height } = this.renderer.pixelSize;
    this.width = width; this.height = height;
    // witnessed: aspectx = ty>tx ? tx/ty : 1 ; aspecty = tx>ty ? ty/tx : 1
    this.aspectx = height > width ? width / height : 1;
    this.aspecty = width > height ? height / width : 1;
    this.invAspectx = 1 / this.aspectx;
    this.invAspecty = 1 / this.aspecty;

    this.waveNodes = g.nodes.filter((n): n is MilkWaveNode => n.kind === "milk-wave" && n.custom);
    this.shapeNodes = g.nodes.filter((n): n is MilkShapeNode => n.kind === "milk-shape");

    // Load-time globals (witnessed renderer.loadPreset: frame 0, time 0,
    // fps 30, AudioLevels initial val=0 / att=1).
    const loadGlobals: Pool = {
      frame: 0, time: 0, fps: 30,
      bass: 0, bass_att: 1, mid: 0, mid_att: 1, treb: 0, treb_att: 1,
      meshx: GRID_X, meshy: GRID_Y,
      aspectx: this.invAspectx, aspecty: this.invAspecty,
      pixelsx: this.width, pixelsy: this.height,
    };
    this.runner = new MilkPresetRunner({
      baseValues: frameNode.baseValues,
      initEel: frameNode.initCode, frameEel: frameNode.perFrame, pixelEel: warpNode.perPixel,
      waves: this.waveNodes.map((w) => ({
        baseValues: w.baseValues, initEel: w.initCode, frameEel: w.perFrame, pointEel: w.perPoint,
      })),
      shapes: this.shapeNodes.map((s) => ({
        baseValues: s.baseValues, initEel: s.initCode, frameEel: s.perFrame,
      })),
    }, loadGlobals, this.rng);
    this.regVars = {};
    this.oldWaveMode = 0;

    this.initResources();
    return { errors: [...this.runner.errors] };
  }

  private makeTarget(): MilkTarget {
    const mipCount = Math.floor(Math.log2(Math.max(this.width, this.height))) + 1;
    const tex = this.device.createTexture({
      size: [this.width, this.height], format: TARGET_FORMAT, mipLevelCount: mipCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const views: GPUTextureView[] = [];
    for (let i = 0; i < mipCount; i++) {
      views.push(tex.createView({ baseMipLevel: i, mipLevelCount: 1 }));
    }
    return { tex, views, mipCount };
  }

  private initResources(): void {
    const dev = this.device;
    this.target?.tex.destroy();
    this.prev?.tex.destroy();
    this.target = this.makeTarget();
    this.prev = this.makeTarget();

    // Samplers (witnessed warp.js mainSampler: LINEAR_MIPMAP_LINEAR/LINEAR
    // + wrap by mdVSFrame.wrap; texture-level anisotropy).
    this.sampRepeat = dev.createSampler({
      magFilter: "linear", minFilter: "linear", mipmapFilter: "linear",
      addressModeU: "repeat", addressModeV: "repeat", maxAnisotropy: 16,
    });
    this.sampClamp = dev.createSampler({
      magFilter: "linear", minFilter: "linear", mipmapFilter: "linear",
      addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", maxAnisotropy: 16,
    });
    this.sampMip = dev.createSampler({ magFilter: "linear", minFilter: "linear" });

    // Warp mesh (witnessed buildPositions: positions (x, -y), two tris per cell).
    const gx1 = GRID_X + 1, gy1 = GRID_Y + 1;
    this.warpPositions = new Float32Array(gx1 * gy1 * 2);
    let vi = 0;
    for (let iy = 0; iy < gy1; iy++) {
      const y = (iy * (2 / GRID_Y)) - 1;
      for (let ix = 0; ix < gx1; ix++) {
        const x = (ix * (2 / GRID_X)) - 1;
        this.warpPositions[vi++] = x;
        this.warpPositions[vi++] = -y;
      }
    }
    const idx: number[] = [];
    for (let iy = 0; iy < GRID_Y; iy++) {
      for (let ix = 0; ix < GRID_X; ix++) {
        const a = ix + gx1 * iy;
        const b = ix + gx1 * (iy + 1);
        const c = ix + 1 + gx1 * (iy + 1);
        const d = ix + 1 + gx1 * iy;
        idx.push(a, b, d, b, c, d);
      }
    }
    this.warpIndices = new Uint16Array(idx);
    this.warpColorOnes = new Float32Array(gx1 * gy1 * 4).fill(1);

    const mkBuf = (data: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>, usage: number) => {
      const buf = dev.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(buf, 0, data as Float32Array<ArrayBuffer>);
      return buf;
    };
    this.warpPosBuf = mkBuf(this.warpPositions, GPUBufferUsage.VERTEX);
    this.warpColBuf = mkBuf(this.warpColorOnes, GPUBufferUsage.VERTEX);
    this.warpIdxBuf = mkBuf(this.warpIndices, GPUBufferUsage.INDEX);
    this.warpUvBuf = dev.createBuffer({
      size: this.warpUVs.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Comp grid (witnessed comp.js buildPositions 32x24).
    const cx1 = COMP_W + 1, cy1 = COMP_H + 1;
    const compPos = new Float32Array(cx1 * cy1 * 2);
    vi = 0;
    for (let iy = 0; iy < cy1; iy++) {
      const y = (iy * (2 / COMP_H)) - 1;
      for (let ix = 0; ix < cx1; ix++) {
        const x = (ix * (2 / COMP_W)) - 1;
        compPos[vi++] = x;
        compPos[vi++] = -y;
      }
    }
    const cIdx: number[] = [];
    for (let iy = 0; iy < COMP_H; iy++) {
      for (let ix = 0; ix < COMP_W; ix++) {
        const a = ix + cx1 * iy;
        const b = ix + cx1 * (iy + 1);
        const c = ix + 1 + cx1 * (iy + 1);
        const d = ix + 1 + cx1 * iy;
        cIdx.push(a, b, d, b, c, d);
      }
    }
    this.compIndexCount = cIdx.length;
    this.compPosBuf = mkBuf(compPos, GPUBufferUsage.VERTEX);
    this.compIdxBuf = mkBuf(new Uint16Array(cIdx), GPUBufferUsage.INDEX);
    this.compColBuf = dev.createBuffer({
      size: cx1 * cy1 * 4 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Uniform buffers.
    const uni = (bytes: number) => dev.createBuffer({
      size: bytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.warpUni = uni(16);
    this.lineUni = uni(16);
    this.lineUniNoThick = uni(16);
    dev.queue.writeBuffer(this.lineUni, 0, new Float32Array([this.width, this.height, 1, 0]));
    dev.queue.writeBuffer(this.lineUniNoThick, 0, new Float32Array([this.width, this.height, 0, 0]));
    this.dotUnis = [1, 2, 3].map((s) => {
      const b = uni(16);
      dev.queue.writeBuffer(b, 0, new Float32Array([this.width, this.height, s, 0]));
      return b;
    });
    this.compUni = uni(48);

    /* pipelines */
    const blendOf = (mode: "alpha" | "additive" | "none"): GPUBlendState | undefined => {
      if (mode === "none") return undefined;
      const dst: GPUBlendFactor = mode === "alpha" ? "one-minus-src-alpha" : "one";
      return {
        color: { srcFactor: "src-alpha", dstFactor: dst, operation: "add" },
        alpha: { srcFactor: "src-alpha", dstFactor: dst, operation: "add" },
      };
    };
    const module = (code: string) => dev.createShaderModule({ code });

    const warpModule = module(WARP_WGSL);
    this.warpPipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: warpModule, entryPoint: "vmain",
        buffers: [
          { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
          { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] },
          { arrayStride: 16, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x4" }] },
        ],
      },
      fragment: {
        module: warpModule, entryPoint: "fmain",
        targets: [{ format: TARGET_FORMAT, blend: blendOf("none") }],
      },
      primitive: { topology: "triangle-list" },
    });

    const lineModule = module(LINE_WGSL);
    this.linePipelines = {};
    for (const topo of ["line-strip", "line-list"] as const) {
      for (const blend of ["alpha", "additive"] as const) {
        this.linePipelines[`${topo}/${blend}`] = dev.createRenderPipeline({
          layout: "auto",
          vertex: {
            module: lineModule, entryPoint: "vmain",
            buffers: [{
              arrayStride: 24, attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x4" },
              ],
            }],
          },
          fragment: {
            module: lineModule, entryPoint: "fmain",
            targets: [{ format: TARGET_FORMAT, blend: blendOf(blend) }],
          },
          primitive: { topology: topo },
        });
      }
    }

    const dotModule = module(DOT_WGSL);
    this.dotPipelines = {};
    for (const blend of ["alpha", "additive"] as const) {
      this.dotPipelines[blend] = dev.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: dotModule, entryPoint: "vmain",
          buffers: [{
            arrayStride: 24, stepMode: "instance", attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x4" },
            ],
          }],
        },
        fragment: {
          module: dotModule, entryPoint: "fmain",
          targets: [{ format: TARGET_FORMAT, blend: blendOf(blend) }],
        },
        primitive: { topology: "triangle-list" },
      });
    }

    const shapeModule = module(SHAPE_WGSL);
    this.shapePipelines = {};
    for (const blend of ["alpha", "additive"] as const) {
      this.shapePipelines[blend] = dev.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: shapeModule, entryPoint: "vmain",
          buffers: [{
            arrayStride: 36, attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x4" },
              { shaderLocation: 2, offset: 24, format: "float32x2" },
              { shaderLocation: 3, offset: 32, format: "float32" },
            ],
          }],
        },
        fragment: {
          module: shapeModule, entryPoint: "fmain",
          targets: [{ format: TARGET_FORMAT, blend: blendOf(blend) }],
        },
        primitive: { topology: "triangle-list" },
      });
    }

    const compModule = module(COMP_WGSL);
    this.compPipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: compModule, entryPoint: "vmain",
        buffers: [
          { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
          { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] },
        ],
      },
      fragment: {
        module: compModule, entryPoint: "fmain",
        targets: [{ format: this.renderer.presentationFormat, blend: blendOf("alpha") }],
      },
      primitive: { topology: "triangle-list" },
    });

    const mipModule = module(MIP_WGSL);
    this.mipPipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: { module: mipModule, entryPoint: "vmain" },
      fragment: { module: mipModule, entryPoint: "fmain", targets: [{ format: TARGET_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
  }

  /* ------------------------------- frame -------------------------------- */

  frame(g: GraphScene, data: MilkFrameData): void {
    const runner = this.runner;
    if (!runner) throw new Error("no preset loaded");
    const dev = this.device;

    const timeL = Array.from(data.timeArrayL as ArrayLike<number>);
    const timeR = Array.from(data.timeArrayR as ArrayLike<number>);
    const freqL = Array.from(data.freqArrayL as ArrayLike<number>);
    const freqR = Array.from(data.freqArrayR as ArrayLike<number>);

    // Per-frame CPU state — populated by the milk-frame case in the
    // dispatch loop below and read by the milk-warp / milk-shape /
    // milk-wave / milk-composite cases. Nothing runs before the loop
    // enters graph.order.
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    let mdVSFrame: Pool | null = null;
    let frameGlobals: Pool | null = null;
    const draws: CanvasDraw[] = [];
    // Per-node dispatch driven by graph.order. Each shape and wave case
    // uses the node's imported index (n.index) rather than an
    // incrementing counter detached from source data. Every stage that
    // needs mdVSFrame or the current audio arrays reads them from the
    // per-frame state assembled by milk-frame.
    const verts: number[] = [];
    const shapeVerts: number[] = [];
    const dotInsts: number[] = [];
    const lineDraw = (
      kind: "line-strip" | "line-list", blend: "alpha" | "additive",
      pts: number[], thick: boolean,
    ) => {
      if (!pts.length) return;
      draws.push({
        kind, blend, thick,
        first: verts.length / 6, count: pts.length / 6,
        instances: thick ? 4 : 1,
      });
      verts.push(...pts);
    };
    for (const id of g.order) {
      const n = byId.get(id) as GraphNode | undefined;
      if (!n) continue;
      switch (n.kind) {
        case "milk-frame": {
          // Frame equations run here — using THIS node's baseValues and
          // EEL programs — not before the dispatch loop. Regs merged
          // from the previous frame's per-pixel pool.
          frameGlobals = { ...data.globals, ...this.regVars };
          mdVSFrame = runner.runFrameEquations(frameGlobals);
          this.lastMdVSFrame = mdVSFrame;
          break;
        }
        case "milk-warp": {
          if (!mdVSFrame) throw new Error("milk-warp reached before milk-frame in graph.order");
          if (n.gridX !== GRID_X || n.gridY !== GRID_Y) {
            throw new UnsupportedGraphError([
              `milk-warp(${n.id}):grid=${n.gridX}x${n.gridY} ` +
              `(pipeline pre-allocated at ${GRID_X}x${GRID_Y})`,
            ]);
          }
          // Per-pixel equations use this node's declared grid dims —
          // read from the node, not a hardcoded constant. Regs picked
          // from the vertex pool for the next frame.
          const vertexPool = runner.runPixelEquations(
            mdVSFrame, n.gridX, n.gridY, this.aspectx, this.aspecty, this.warpUVs);
          this.regVars = {};
          for (const r of REGS) if (r in vertexPool) this.regVars[r] = vertexPool[r];
          dev.queue.writeBuffer(this.warpUvBuf, 0, this.warpUVs);
          // Swap this warp's declared source and target textures. Milk
          // graphs today carry source=target=canvas (feedback), so the
          // swap always rotates the executor's ping-pong pair; a future
          // milk graph with distinct source/target would render into a
          // separate destination and the swap would not fire.
          if (n.source === n.target) {
            const t = this.target; this.target = this.prev; this.prev = t;
          }
          break;
        }
        case "milk-motion-vectors": {
          if (!mdVSFrame) throw new Error("milk-motion-vectors reached before milk-frame");
          this.buildMotionVectors(mdVSFrame, lineDraw);
          break;
        }
        case "milk-shape": {
          if (!frameGlobals) throw new Error("milk-shape reached before milk-frame");
          // Use the node's imported index — the shape's position in the
          // preset's shapecode_N table — not an incrementing counter.
          this.buildShape(n.index, frameGlobals, shapeVerts, draws, verts, lineDraw);
          break;
        }
        case "milk-wave": {
          if (!frameGlobals || !mdVSFrame) throw new Error("milk-wave reached before milk-frame");
          if (n.custom) {
            if (n.index === undefined) {
              throw new UnsupportedGraphError([`milk-wave(${n.id}):custom with no index`]);
            }
            this.buildCustomWave(n.index, frameGlobals, timeL, timeR, freqL, freqR, lineDraw, dotInsts, draws);
          } else {
            this.buildBasicWave(mdVSFrame, timeL, timeR, lineDraw, dotInsts, draws);
          }
          break;
        }
        case "milk-border": {
          if (!mdVSFrame) throw new Error("milk-border reached before milk-frame");
          this.buildDarkenCenterAndBorders(mdVSFrame, draws, shapeVerts, verts);
          break;
        }
        case "milk-blur":
          throw new UnsupportedGraphError([`milk-blur(${n.id}):dispatched (should have refused at load)`]);
        case "milk-composite":
          // composite fires after the canvas pass completes; handled
          // below in the presentation pass.
          break;
        default:
          throw new UnsupportedGraphError([`${n.kind}(${n.id}) unexpected in milk graph`]);
      }
    }
    if (!mdVSFrame) throw new Error("graph.order produced no milk-frame execution");

    const vertData = new Float32Array(verts);
    const shapeData = new Float32Array(shapeVerts);
    const dotData = new Float32Array(dotInsts);
    const need = vertData.byteLength + shapeData.byteLength + dotData.byteLength;
    if (!this.canvasVertBuf || this.canvasVertBuf.size < need) {
      this.canvasVertBuf?.destroy();
      this.canvasVertBuf = dev.createBuffer({
        size: Math.max(1024, need * 2), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    const lineOff = 0;
    const shapeOff = vertData.byteLength;
    const dotOff = shapeOff + shapeData.byteLength;
    if (vertData.length) dev.queue.writeBuffer(this.canvasVertBuf, lineOff, vertData);
    if (shapeData.length) dev.queue.writeBuffer(this.canvasVertBuf, shapeOff, shapeData);
    if (dotData.length) dev.queue.writeBuffer(this.canvasVertBuf, dotOff, dotData);

    // uniforms
    dev.queue.writeBuffer(this.warpUni, 0, new Float32Array([mdVSFrame.decay, 0, 0, 0]));
    dev.queue.writeBuffer(this.compUni, 0, new Float32Array([
      mdVSFrame.gammaadj, mdVSFrame.echo_zoom, mdVSFrame.echo_alpha, mdVSFrame.echo_orient,
      mdVSFrame.invert, mdVSFrame.brighten, mdVSFrame.darken, mdVSFrame.solarize,
      mdVSFrame.fshader, 0, 0, 0,
    ]));
    // comp hue colors (witnessed generateCompColors, non-blending alpha=1)
    dev.queue.writeBuffer(this.compColBuf, 0, this.generateCompColors(mdVSFrame));

    const enc = dev.createCommandEncoder();

    // mips for prev (levels 1..n from level above)
    for (let level = 1; level < this.prev.mipCount; level++) {
      const bg = dev.createBindGroup({
        layout: this.mipPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampMip },
          { binding: 1, resource: this.prev.views[level - 1] },
        ],
      });
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.prev.views[level], loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(this.mipPipeline);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
    }

    const mainSamp = mdVSFrame.wrap !== 0 ? this.sampRepeat : this.sampClamp;
    const prevView = this.prev.tex.createView();

    // 5) canvas pass: clear -> warp -> queued sprite/wave draws
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.target.views[0], loadOp: "clear", storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      // warp
      const warpBg = dev.createBindGroup({
        layout: this.warpPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.warpUni } },
          { binding: 1, resource: mainSamp },
          { binding: 2, resource: prevView },
        ],
      });
      pass.setPipeline(this.warpPipeline);
      pass.setBindGroup(0, warpBg);
      pass.setVertexBuffer(0, this.warpPosBuf);
      pass.setVertexBuffer(1, this.warpUvBuf);
      pass.setVertexBuffer(2, this.warpColBuf);
      pass.setIndexBuffer(this.warpIdxBuf, "uint16");
      pass.drawIndexed(this.warpIndices.length);

      // queued draws in order
      const lineBgs = new Map<GPUBuffer, GPUBindGroup>();
      const lineBg = (uniBuf: GPUBuffer, pipeline: GPURenderPipeline) => {
        const key = uniBuf;
        let bg = lineBgs.get(key);
        if (!bg) {
          bg = dev.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: uniBuf } }],
          });
          lineBgs.set(key, bg);
        }
        return bg;
      };
      for (const d of draws) {
        if (d.kind === "line-strip" || d.kind === "line-list") {
          const pipeline = this.linePipelines[`${d.kind}/${d.blend}`];
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, lineBg(d.thick ? this.lineUni : this.lineUniNoThick, pipeline));
          pass.setVertexBuffer(0, this.canvasVertBuf!, lineOff);
          for (let inst = 0; inst < d.instances; inst++) {
            // line strips must not connect across instances; issue per-
            // instance draws with firstInstance to select the offset
            pass.draw(d.count, 1, d.first, inst);
          }
        } else if (d.kind === "dots") {
          const pipeline = this.dotPipelines[d.blend];
          pass.setPipeline(pipeline);
          const size = clamp(Math.round(d.dotSize ?? 1), 1, 3);
          const bg = dev.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.dotUnis[size - 1] } }],
          });
          pass.setBindGroup(0, bg);
          pass.setVertexBuffer(0, this.canvasVertBuf!, dotOff);
          pass.draw(6, d.count, 0, d.first);
        } else { // shape-fill
          const pipeline = this.shapePipelines[d.blend];
          pass.setPipeline(pipeline);
          const bg = dev.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: mainSamp },
              { binding: 1, resource: prevView },
            ],
          });
          pass.setBindGroup(0, bg);
          pass.setVertexBuffer(0, this.canvasVertBuf!, shapeOff);
          pass.draw(d.count, 1, d.first);
        }
      }
      pass.end();
    }

    // 6) composite to screen (witnessed renderToScreen non-FXAA: clear +
    // alpha blend + comp grid reading targetTexture)
    {
      const view = this.renderer.currentTextureView();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      const bg = dev.createBindGroup({
        layout: this.compPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.compUni } },
          { binding: 1, resource: mainSamp },
          { binding: 2, resource: this.target.tex.createView() },
        ],
      });
      pass.setPipeline(this.compPipeline);
      pass.setBindGroup(0, bg);
      pass.setVertexBuffer(0, this.compPosBuf);
      pass.setVertexBuffer(1, this.compColBuf);
      pass.setIndexBuffer(this.compIdxBuf, "uint16");
      pass.drawIndexed(this.compIndexCount);
      pass.end();
    }

    dev.queue.submit([enc.finish()]);
  }

  /* --------------------------- CPU generators --------------------------- */

  /** Witnessed comp.js generateCompColors (non-blending: alpha 1). */
  private generateCompColors(mdVSFrame: Pool): Float32Array<ArrayBuffer> {
    const runner = this.runner!;
    // witnessed generateHueBase (rand_start-seeded time oscillators)
    const hueBase = new Float32Array(12).fill(1);
    for (let i = 0; i < 4; i++) {
      hueBase[i * 3 + 0] = 0.6 + 0.3 * Math.sin(mdVSFrame.time * 30.0 * 0.0143 + 3 + i * 21 + runner.randStart[3]);
      hueBase[i * 3 + 1] = 0.6 + 0.3 * Math.sin(mdVSFrame.time * 30.0 * 0.0107 + 1 + i * 13 + runner.randStart[1]);
      hueBase[i * 3 + 2] = 0.6 + 0.3 * Math.sin(mdVSFrame.time * 30.0 * 0.0129 + 6 + i * 9 + runner.randStart[2]);
      const maxshade = Math.max(hueBase[i * 3], hueBase[i * 3 + 1], hueBase[i * 3 + 2]);
      for (let k = 0; k < 3; k++) {
        hueBase[i * 3 + k] = 0.5 + 0.5 * (hueBase[i * 3 + k] / maxshade);
      }
    }
    const cx1 = COMP_W + 1, cy1 = COMP_H + 1;
    const out = new Float32Array(cx1 * cy1 * 4);
    let o = 0;
    for (let j = 0; j < cy1; j++) {
      for (let i = 0; i < cx1; i++) {
        const x = i / COMP_W;
        const y = j / COMP_H;
        for (let c = 0; c < 3; c++) {
          out[o + c] = hueBase[0 + c] * x * y + hueBase[3 + c] * (1 - x) * y +
                       hueBase[6 + c] * x * (1 - y) + hueBase[9 + c] * (1 - x) * (1 - y);
        }
        out[o + 3] = 1;
        o += 4;
      }
    }
    return out;
  }

  /** Witnessed motionVectors.js generate + draw (LINES, alpha blend). */
  private buildMotionVectors(
    mdVSFrame: Pool,
    lineDraw: (k: "line-strip" | "line-list", b: "alpha" | "additive", pts: number[], thick: boolean) => void,
  ): void {
    const mvA = mdVSFrame.mv_a;
    let nX = Math.floor(mdVSFrame.mv_x);
    let nY = Math.floor(mdVSFrame.mv_y);
    if (!(mvA > 0.001 && nX > 0 && nY > 0)) return;
    let dx = mdVSFrame.mv_x - nX;
    let dy = mdVSFrame.mv_y - nY;
    const maxX = 64, maxY = 48; // witnessed ctor: this.maxX = 64; this.maxY = 48
    if (nX > maxX) { nX = maxX; dx = 0; }
    if (nY > maxY) { nY = maxY; dy = 0; }
    const dx2 = mdVSFrame.mv_dx;
    const dy2 = mdVSFrame.mv_dy;
    const lenMult = mdVSFrame.mv_l;
    const minLen = 1.0 / this.width;
    const color = [mdVSFrame.mv_r, mdVSFrame.mv_g, mdVSFrame.mv_b, mvA];
    const pts: number[] = [];
    const gridX1 = GRID_X + 1;
    for (let j = 0; j < nY; j++) {
      let fy = (j + 0.25) / (nY + dy + 0.25 - 1.0);
      fy -= dy2;
      if (fy > 0.0001 && fy < 0.9999) {
        for (let i = 0; i < nX; i++) {
          let fx = (i + 0.25) / (nX + dx + 0.25 - 1.0);
          fx += dx2;
          if (fx > 0.0001 && fx < 0.9999) {
            // getMotionDir: bilinear sample of warpUVs, fy2 flipped
            const y0 = Math.floor(fy * GRID_Y);
            const dyy = fy * GRID_Y - y0;
            const x0 = Math.floor(fx * GRID_X);
            const dxx = fx * GRID_X - x0;
            const x1 = x0 + 1, y1 = y0 + 1;
            const w = this.warpUVs;
            let fx2 = w[(y0 * gridX1 + x0) * 2] * (1 - dxx) * (1 - dyy)
                    + w[(y0 * gridX1 + x1) * 2] * dxx * (1 - dyy)
                    + w[(y1 * gridX1 + x0) * 2] * (1 - dxx) * dyy
                    + w[(y1 * gridX1 + x1) * 2] * dxx * dyy;
            let fy2 = w[(y0 * gridX1 + x0) * 2 + 1] * (1 - dxx) * (1 - dyy)
                    + w[(y0 * gridX1 + x1) * 2 + 1] * dxx * (1 - dyy)
                    + w[(y1 * gridX1 + x0) * 2 + 1] * (1 - dxx) * dyy
                    + w[(y1 * gridX1 + x1) * 2 + 1] * dxx * dyy;
            fy2 = 1.0 - fy2;
            let dxi = (fx2 - fx) * lenMult;
            let dyi = (fy2 - fy) * lenMult;
            const fdist = Math.sqrt(dxi * dxi + dyi * dyi);
            if (fdist < minLen && fdist > 0.00000001) {
              const r = minLen / fdist;
              dxi *= r;
              dyi *= r;
            } else {
              // witnessed oracle quirk: the else branch assigns dxi =
              // minLen TWICE and never touches dyi (motionVectors.js) —
              // reproduced as-is so vectors match the oracle.
              dxi = minLen;
            }
            fx2 = fx + dxi;
            fy2 = fy + dyi;
            pts.push(2 * fx - 1, 2 * fy - 1, ...color);
            pts.push(2 * fx2 - 1, 2 * fy2 - 1, ...color);
          }
        }
      }
    }
    lineDraw("line-list", "alpha", pts, false);
  }

  /** Witnessed customShape.js drawCustomShape (per-instance frame eqs,
   *  fan fill, optional texture from prev frame, LINE_STRIP border).
   *  Called PER-NODE from the graph-order dispatch: i is the unit index
   *  the milk-shape node position carries. */
  private buildShape(
    i: number,
    globals: Pool,
    shapeVerts: number[], draws: CanvasDraw[], verts: number[],
    lineDraw: (k: "line-strip" | "line-list", b: "alpha" | "additive", pts: number[], thick: boolean) => void,
  ): void {
    const runner = this.runner!;
    // wrap the original per-index body in an IIFE so the diff stays
    // small; the forEach becomes a single-iteration call
    ((): void => {
      if (!runner.shapeEnabled[i]) return;
      const pool = runner.shapeFramePool(i, globals);
      const base = { ...pool };
      const numInst = clamp(pool.num_inst, 1, 1024);
      let lastPool = pool;
      for (let j = 0; j < numInst; j++) {
        pool.instance = j;
        pool.x = base.x; pool.y = base.y; pool.rad = base.rad; pool.ang = base.ang;
        pool.r = base.r; pool.g = base.g; pool.b = base.b; pool.a = base.a;
        pool.r2 = base.r2; pool.g2 = base.g2; pool.b2 = base.b2; pool.a2 = base.a2;
        pool.border_r = base.border_r; pool.border_g = base.border_g;
        pool.border_b = base.border_b; pool.border_a = base.border_a;
        pool.thickoutline = base.thickoutline; pool.textured = base.textured;
        pool.tex_zoom = base.tex_zoom; pool.tex_ang = base.tex_ang;
        pool.additive = base.additive;
        runner.runShapeFrame(i, pool);
        lastPool = pool;
        const sides = Math.floor(clamp(pool.sides, 3, 100));
        const rad = pool.rad, ang = pool.ang;
        const x = pool.x * 2 - 1;
        const y = pool.y * -2 + 1;
        const isTextured = Math.abs(pool.textured) >= 1;
        const isBorderThick = Math.abs(pool.thickoutline) >= 1;
        const isAdditive = Math.abs(pool.additive) >= 1;
        const borderColor = [pool.border_r, pool.border_g, pool.border_b, pool.border_a];
        const hasBorder = borderColor[3] > 0;
        const quarterPi = Math.PI * 0.25;
        // fan center + rim
        const center = [x, y, pool.r, pool.g, pool.b, pool.a, 0.5, 0.5, isTextured ? 1 : 0];
        const rim: number[][] = [];
        const borderPts: number[] = [];
        for (let k = 1; k <= sides + 1; k++) {
          const p = (k - 1) / sides;
          const pTwoPi = p * 2 * Math.PI;
          const angSum = pTwoPi + ang + quarterPi;
          const px = x + rad * Math.cos(angSum) * this.aspecty;
          const py = y + rad * Math.sin(angSum);
          let u = 0.5, v = 0.5;
          if (isTextured) {
            const texAngSum = pTwoPi + pool.tex_ang + quarterPi;
            u = 0.5 + 0.5 * Math.cos(texAngSum) / pool.tex_zoom * this.aspecty;
            v = 0.5 + 0.5 * Math.sin(texAngSum) / pool.tex_zoom;
          }
          rim.push([px, py, pool.r2, pool.g2, pool.b2, pool.a2, u, v, isTextured ? 1 : 0]);
          if (hasBorder) borderPts.push(px, py, ...borderColor);
        }
        // fan -> triangle list
        const first = shapeVerts.length / 9;
        for (let k = 0; k < sides; k++) {
          shapeVerts.push(...center, ...rim[k], ...rim[k + 1]);
        }
        draws.push({
          kind: "shape-fill", blend: isAdditive ? "additive" : "alpha",
          first, count: sides * 3, instances: 1, thick: false,
          texturedShape: isTextured,
        });
        if (hasBorder) {
          lineDraw("line-strip", "alpha", borderPts, isBorderThick);
        }
      }
      runner.saveShapeFrame(i, lastPool);
    })();
  }

  /** Witnessed customWaveform.js generate + draw. Called PER-NODE for
   *  one custom wave from the graph-order dispatch. */
  private buildCustomWave(
    i: number,
    globals: Pool,
    timeL: number[], timeR: number[], freqL: number[], freqR: number[],
    lineDraw: (k: "line-strip" | "line-list", b: "alpha" | "additive", pts: number[], thick: boolean) => void,
    dotInsts: number[], draws: CanvasDraw[],
  ): void {
    const runner = this.runner!;
    ((): void => {
      if (!runner.waveEnabled[i]) return;
      const pool = runner.waveFramePool(i, globals);
      runner.runWaveFrame(i, pool);
      let samples = "samples" in pool ? pool.samples : MAX_SAMPLES;
      if (samples > MAX_SAMPLES) samples = MAX_SAMPLES;
      samples = Math.floor(samples);
      const sep = Math.floor(pool.sep);
      const scaling = pool.scaling;
      const spectrum = pool.spectrum;
      const smoothing = pool.smoothing;
      const usedots = pool.usedots;
      const frameR = pool.r, frameG = pool.g, frameB = pool.b, frameA = pool.a;
      const waveScale = runner.baseVals.wave_scale;
      samples -= sep;
      if (!(samples >= 2 || (usedots !== 0 && samples >= 1))) { runner.saveWaveFrame(i, pool); return; }
      const useSpectrum = spectrum !== 0;
      const scale = (useSpectrum ? 0.15 : 0.004) * scaling * waveScale;
      const pointsLeft = useSpectrum ? freqL : timeL;
      const pointsRight = useSpectrum ? freqR : timeR;
      const j0 = useSpectrum ? 0 : Math.floor((MAX_SAMPLES - samples) / 2 - sep / 2);
      const j1 = useSpectrum ? 0 : Math.floor((MAX_SAMPLES - samples) / 2 + sep / 2);
      const tStep = useSpectrum ? (MAX_SAMPLES - sep) / samples : 1;
      const mix1 = Math.pow(smoothing * 0.98, 0.5);
      const mix2 = 1 - mix1;
      const pd0 = new Float32Array(samples);
      const pd1 = new Float32Array(samples);
      pd0[0] = pointsLeft[j0];
      pd1[0] = pointsRight[j1];
      for (let j = 1; j < samples; j++) {
        pd0[j] = pointsLeft[Math.floor(j * tStep + j0)] * mix2 + pd0[j - 1] * mix1;
        pd1[j] = pointsRight[Math.floor(j * tStep + j1)] * mix2 + pd1[j - 1] * mix1;
      }
      for (let j = samples - 2; j >= 0; j--) {
        pd0[j] = pd0[j] * mix2 + pd0[j + 1] * mix1;
        pd1[j] = pd1[j] * mix2 + pd1[j + 1] * mix1;
      }
      const positions = new Float32Array(samples * 3);
      const colors = new Float32Array(samples * 4);
      let finalPool = pool;
      for (let j = 0; j < samples; j++) {
        pool.sample = j / (samples - 1);
        pool.value1 = pd0[j] * scale;
        pool.value2 = pd1[j] * scale;
        pool.x = 0.5 + pool.value1;
        pool.y = 0.5 + pool.value2;
        pool.r = frameR; pool.g = frameG; pool.b = frameB; pool.a = frameA;
        runner.runWavePoint(i, pool);
        finalPool = pool;
        positions[j * 3] = (pool.x * 2 - 1) * this.invAspectx;
        positions[j * 3 + 1] = (pool.y * -2 + 1) * this.invAspecty;
        colors[j * 4] = pool.r;
        colors[j * 4 + 1] = pool.g;
        colors[j * 4 + 2] = pool.b;
        colors[j * 4 + 3] = pool.a; // alphaMult = 1 (no blending)
      }
      runner.saveWaveFrame(i, finalPool);
      const waveUseDots = finalPool.usedots !== 0;
      const waveThick = finalPool.thick !== 0;
      const blend = finalPool.additive !== 0 ? "additive" as const : "alpha" as const;
      if (waveUseDots) {
        const size = (waveThick ? 2 : 1) + (this.width >= 1024 ? 1 : 0);
        const first = dotInsts.length / 6;
        for (let j = 0; j < samples; j++) {
          dotInsts.push(positions[j * 3], positions[j * 3 + 1],
            colors[j * 4], colors[j * 4 + 1], colors[j * 4 + 2], colors[j * 4 + 3]);
        }
        draws.push({ kind: "dots", blend, first, count: samples, instances: 1, thick: false, dotSize: size });
      } else {
        // witnessed smoothWaveAndColor -> samples*2-1 vertices
        const pts = smoothWaveAndColor(positions, colors, samples);
        lineDraw("line-strip", blend, pts, waveThick);
      }
    })();
  }

  /** Witnessed basicWaveform.js (modes 0-7; non-blending path). */
  private buildBasicWave(
    mdVSFrame: Pool, timeL: number[], timeR: number[],
    lineDraw: (k: "line-strip" | "line-list", b: "alpha" | "additive", pts: number[], thick: boolean) => void,
    dotInsts: number[], draws: CanvasDraw[],
  ): void {
    let alpha = mdVSFrame.wave_a;
    const vol = (mdVSFrame.bass + mdVSFrame.mid + mdVSFrame.treb) / 3.0;
    if (!(vol > -0.01 && alpha > 0.001 && timeL.length > 0)) return;
    const processWaveform = (timeArray: number[]) => {
      const waveform: number[] = [];
      const scale = mdVSFrame.wave_scale / 128.0;
      const smooth = mdVSFrame.wave_smoothing;
      const smooth2 = scale * (1.0 - smooth);
      waveform.push(timeArray[0] * scale);
      for (let i = 1; i < timeArray.length; i++) {
        waveform.push(timeArray[i] * smooth2 + waveform[i - 1] * smooth);
      }
      return waveform;
    };
    const waveL = processWaveform(timeL);
    const waveR = processWaveform(timeR);
    const waveMode = Math.floor(mdVSFrame.wave_mode) % 8;
    const wavePosX = mdVSFrame.wave_x * 2.0 - 1.0;
    const wavePosY = mdVSFrame.wave_y * 2.0 - 1.0;
    let fWaveParam2 = mdVSFrame.wave_mystery;
    if ((waveMode === 0 || waveMode === 1 || waveMode === 4) && (fWaveParam2 < -1 || fWaveParam2 > 1)) {
      fWaveParam2 = fWaveParam2 * 0.5 + 0.5;
      fWaveParam2 -= Math.floor(fWaveParam2);
      fWaveParam2 = Math.abs(fWaveParam2);
      fWaveParam2 = fWaveParam2 * 2 - 1;
    }
    const modAlpha = () => {
      if (mdVSFrame.modwavealphabyvolume > 0) {
        const d = mdVSFrame.modwavealphaend - mdVSFrame.modwavealphastart;
        alpha *= (vol - mdVSFrame.modwavealphastart) / d;
      }
      alpha = clamp(alpha, 0, 1);
    };
    let numVert = 0;
    let positions: Float32Array;
    let positions2: Float32Array | null = null;
    if (waveMode === 0) {
      modAlpha();
      numVert = Math.floor(waveL.length / 2) + 1;
      const numVertInv = 1.0 / (numVert - 1);
      const sampleOffset = Math.floor((waveL.length - numVert) / 2);
      positions = new Float32Array(numVert * 3);
      for (let i = 0; i < numVert - 1; i++) {
        let rad = 0.5 + 0.4 * waveR[i + sampleOffset] + fWaveParam2;
        const ang = i * numVertInv * 2 * Math.PI + mdVSFrame.time * 0.2;
        if (i < numVert / 10) {
          let mix = i / (numVert * 0.1);
          mix = 0.5 - 0.5 * Math.cos(mix * Math.PI);
          const rad2 = 0.5 + 0.4 * waveR[i + numVert + sampleOffset] + fWaveParam2;
          rad = (1.0 - mix) * rad2 + rad * mix;
        }
        positions[i * 3] = rad * Math.cos(ang) * this.aspecty + wavePosX;
        positions[i * 3 + 1] = rad * Math.sin(ang) * this.aspectx + wavePosY;
      }
      positions[(numVert - 1) * 3] = positions[0];
      positions[(numVert - 1) * 3 + 1] = positions[1];
    } else if (waveMode === 1) {
      alpha *= 1.25;
      modAlpha();
      numVert = Math.floor(waveL.length / 2);
      positions = new Float32Array(numVert * 3);
      for (let i = 0; i < numVert; i++) {
        const rad = 0.53 + 0.43 * waveR[i] + fWaveParam2;
        const ang = waveL[i + 32] * 0.5 * Math.PI + mdVSFrame.time * 2.3;
        positions[i * 3] = rad * Math.cos(ang) * this.aspecty + wavePosX;
        positions[i * 3 + 1] = rad * Math.sin(ang) * this.aspectx + wavePosY;
      }
    } else if (waveMode === 2 || waveMode === 3) {
      if (this.width < 1024) alpha *= waveMode === 2 ? 0.09 : 0.15;
      else if (this.width < 2048) alpha *= waveMode === 2 ? 0.11 : 0.22;
      else alpha *= waveMode === 2 ? 0.13 : 0.33;
      if (waveMode === 3) {
        alpha *= 1.3;
        alpha *= mdVSFrame.treb * mdVSFrame.treb;
      }
      modAlpha();
      numVert = waveL.length;
      positions = new Float32Array(numVert * 3);
      for (let i = 0; i < waveL.length; i++) {
        positions[i * 3] = waveR[i] * this.aspecty + wavePosX;
        positions[i * 3 + 1] = waveL[(i + 32) % waveL.length] * this.aspectx + wavePosY;
      }
    } else if (waveMode === 4) {
      modAlpha();
      numVert = waveL.length;
      if (numVert > this.width / 3) numVert = Math.floor(this.width / 3);
      const numVertInv = 1.0 / numVert;
      const sampleOffset = Math.floor((waveL.length - numVert) / 2);
      const w1 = 0.45 + 0.5 * (fWaveParam2 * 0.5 + 0.5);
      const w2 = 1.0 - w1;
      positions = new Float32Array(numVert * 3);
      for (let i = 0; i < numVert; i++) {
        let x = 2.0 * i * numVertInv + (wavePosX - 1) + waveR[(i + 25 + sampleOffset) % waveL.length] * 0.44;
        let y = waveL[i + sampleOffset] * 0.47 + wavePosY;
        if (i > 1) {
          x = x * w2 + w1 * (positions[(i - 1) * 3] * 2.0 - positions[(i - 2) * 3]);
          y = y * w2 + w1 * (positions[(i - 1) * 3 + 1] * 2.0 - positions[(i - 2) * 3 + 1]);
        }
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
      }
    } else if (waveMode === 5) {
      if (this.width < 1024) alpha *= 0.09;
      else if (this.width < 2048) alpha *= 0.11;
      else alpha *= 0.13;
      modAlpha();
      const cosRot = Math.cos(mdVSFrame.time * 0.3);
      const sinRot = Math.sin(mdVSFrame.time * 0.3);
      numVert = waveL.length;
      positions = new Float32Array(numVert * 3);
      for (let i = 0; i < waveL.length; i++) {
        const ioff = (i + 32) % waveL.length;
        const x0 = waveR[i] * waveL[ioff] + waveL[i] * waveR[ioff];
        const y0 = waveR[i] * waveR[i] - waveL[ioff] * waveL[ioff];
        positions[i * 3] = (x0 * cosRot - y0 * sinRot) * (this.aspecty + wavePosX);
        positions[i * 3 + 1] = (x0 * sinRot + y0 * cosRot) * (this.aspectx + wavePosY);
      }
    } else { // 6 or 7
      modAlpha();
      numVert = Math.floor(waveL.length / 2);
      if (numVert > this.width / 3) numVert = Math.floor(this.width / 3);
      const sampleOffset = Math.floor((waveL.length - numVert) / 2);
      const ang2 = Math.PI * 0.5 * fWaveParam2;
      let dx = Math.cos(ang2);
      let dy = Math.sin(ang2);
      const edgex = [
        wavePosX * Math.cos(ang2 + Math.PI * 0.5) - dx * 3.0,
        wavePosX * Math.cos(ang2 + Math.PI * 0.5) + dx * 3.0,
      ];
      const edgey = [
        wavePosX * Math.sin(ang2 + Math.PI * 0.5) - dy * 3.0,
        wavePosX * Math.sin(ang2 + Math.PI * 0.5) + dy * 3.0,
      ];
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 4; j++) {
          let t = 0;
          let bClip = false;
          switch (j) {
            case 0: if (edgex[i] > 1.1) { t = (1.1 - edgex[1 - i]) / (edgex[i] - edgex[1 - i]); bClip = true; } break;
            case 1: if (edgex[i] < -1.1) { t = (-1.1 - edgex[1 - i]) / (edgex[i] - edgex[1 - i]); bClip = true; } break;
            case 2: if (edgey[i] > 1.1) { t = (1.1 - edgey[1 - i]) / (edgey[i] - edgey[1 - i]); bClip = true; } break;
            case 3: if (edgey[i] < -1.1) { t = (-1.1 - edgey[1 - i]) / (edgey[i] - edgey[1 - i]); bClip = true; } break;
          }
          if (bClip) {
            const dxi = edgex[i] - edgex[1 - i];
            const dyi = edgey[i] - edgey[1 - i];
            edgex[i] = edgex[1 - i] + dxi * t;
            edgey[i] = edgey[1 - i] + dyi * t;
          }
        }
      }
      dx = (edgex[1] - edgex[0]) / numVert;
      dy = (edgey[1] - edgey[0]) / numVert;
      const angB = Math.atan2(dy, dx);
      const perpDx = Math.cos(angB + Math.PI * 0.5);
      const perpDy = Math.sin(angB + Math.PI * 0.5);
      positions = new Float32Array(numVert * 3);
      if (waveMode === 6) {
        for (let i = 0; i < numVert; i++) {
          const sample = waveL[i + sampleOffset];
          positions[i * 3] = edgex[0] + dx * i + perpDx * 0.25 * sample;
          positions[i * 3 + 1] = edgey[0] + dy * i + perpDy * 0.25 * sample;
        }
      } else {
        const sepV = Math.pow(wavePosY * 0.5 + 0.5, 2);
        positions2 = new Float32Array(numVert * 3);
        for (let i = 0; i < numVert; i++) {
          const sample = waveL[i + sampleOffset];
          positions[i * 3] = edgex[0] + dx * i + perpDx * (0.25 * sample + sepV);
          positions[i * 3 + 1] = edgey[0] + dy * i + perpDy * (0.25 * sample + sepV);
        }
        for (let i = 0; i < numVert; i++) {
          const sample = waveR[i + sampleOffset];
          positions2[i * 3] = edgex[0] + dx * i + perpDx * (0.25 * sample - sepV);
          positions2[i * 3 + 1] = edgey[0] + dy * i + perpDy * (0.25 * sample - sepV);
        }
      }
    }

    // color (witnessed: clamp + wave_brighten normalization)
    let r = clamp(mdVSFrame.wave_r, 0, 1);
    let g = clamp(mdVSFrame.wave_g, 0, 1);
    let b = clamp(mdVSFrame.wave_b, 0, 1);
    if (mdVSFrame.wave_brighten !== 0) {
      const maxc = Math.max(r, g, b);
      if (maxc > 0.01) { r /= maxc; g /= maxc; b /= maxc; }
    }
    // y negation before smoothing (witnessed)
    for (let i = 0; i < numVert; i++) positions[i * 3 + 1] = -positions[i * 3 + 1];
    if (positions2) for (let i = 0; i < numVert; i++) positions2[i * 3 + 1] = -positions2[i * 3 + 1];

    const emit = (pos: Float32Array) => {
      const colors = new Float32Array(numVert * 4);
      for (let i = 0; i < numVert; i++) {
        colors[i * 4] = r; colors[i * 4 + 1] = g; colors[i * 4 + 2] = b; colors[i * 4 + 3] = alpha;
      }
      const blend = mdVSFrame.additivewave !== 0 ? "additive" as const : "alpha" as const;
      if (mdVSFrame.wave_dots !== 0) {
        const size = (mdVSFrame.wave_thick !== 0 ? 2 : 1) + (this.width >= 1024 ? 1 : 0);
        const first = dotInsts.length / 6;
        // witnessed: dots draw the SMOOTHED vertex set
        const pts = smoothWaveAndColor(pos, colors, numVert);
        for (let i = 0; i < pts.length / 6; i++) {
          dotInsts.push(pts[i * 6], pts[i * 6 + 1], pts[i * 6 + 2], pts[i * 6 + 3], pts[i * 6 + 4], pts[i * 6 + 5]);
        }
        draws.push({ kind: "dots", blend, first, count: pts.length / 6, instances: 1, thick: false, dotSize: size });
      } else {
        const pts = smoothWaveAndColor(pos, colors, numVert);
        lineDraw("line-strip", blend, pts, mdVSFrame.wave_thick !== 0);
      }
    };
    emit(positions);
    if (positions2) emit(positions2);
    void this.oldWaveMode;
  }

  /** Witnessed darkenCenter.js (triangle fan, fixed colors) +
   *  border.js (two quad frames from ob/ib sizes). */
  private buildDarkenCenterAndBorders(
    mdVSFrame: Pool, draws: CanvasDraw[], shapeVerts: number[], verts: number[],
  ): void {
    void verts;
    if (mdVSFrame.darken_center !== 0) {
      const halfSize = 0.05;
      // fan: center (a=3/32) + 5 rim (a=0); rim order witnessed
      const c = [0, 0, 0, 0, 0, 3 / 32];
      const rim = [
        [-halfSize * this.aspecty, 0], [0, -halfSize], [halfSize * this.aspecty, 0],
        [0, halfSize], [-halfSize * this.aspecty, 0],
      ];
      const first = shapeVerts.length / 9;
      let count = 0;
      for (let k = 0; k < rim.length - 1; k++) {
        shapeVerts.push(c[0], c[1], c[2], c[3], c[4], c[5], 0.5, 0.5, 0);
        shapeVerts.push(rim[k][0], rim[k][1], 0, 0, 0, 0, 0.5, 0.5, 0);
        shapeVerts.push(rim[k + 1][0], rim[k + 1][1], 0, 0, 0, 0, 0.5, 0.5, 0);
        count += 3;
      }
      draws.push({ kind: "shape-fill", blend: "alpha", first, count, instances: 1, thick: false });
    }
    const border = (color: number[], borderSize: number, prevBorderSize: number) => {
      if (!(borderSize > 0 && color[3] > 0)) return;
      const wh = 1, hh = 1;
      const pbw = prevBorderSize / 2;
      const bw = borderSize / 2 + pbw;
      const pw = pbw * 2, ph = pbw * 2;
      const bww = bw * 2, bwh = bw * 2;
      const quads: number[][][] = [
        // 1st side (witnessed triangles p4,p2,p1 / p4,p3,p2)
        [[-wh + pw, -hh + bwh], [-wh + pw, hh - bwh], [-wh + bww, hh - bwh], [-wh + bww, -hh + bwh]],
        [[wh - pw, -hh + bwh], [wh - pw, hh - bwh], [wh - bww, hh - bwh], [wh - bww, -hh + bwh]],
        [[-wh + pw, -hh + ph], [-wh + pw, bwh - hh], [wh - pw, bwh - hh], [wh - pw, -hh + ph]],
        [[-wh + pw, hh - ph], [-wh + pw, hh - bwh], [wh - pw, hh - bwh], [wh - pw, hh - ph]],
      ];
      const first = shapeVerts.length / 9;
      let count = 0;
      const tri = (p: number[][], a: number, b: number, cIdx: number) => {
        for (const idx of [a, b, cIdx]) {
          shapeVerts.push(p[idx][0], p[idx][1], color[0], color[1], color[2], color[3], 0.5, 0.5, 0);
        }
        count += 3;
      };
      // witnessed winding: sides 1/3 use (p4,p2,p1)/(p4,p3,p2); 2/4 use (p1,p2,p4)/(p2,p3,p4)
      tri(quads[0], 3, 1, 0); tri(quads[0], 3, 2, 1);
      tri(quads[1], 0, 1, 3); tri(quads[1], 1, 2, 3);
      tri(quads[2], 3, 1, 0); tri(quads[2], 3, 2, 1);
      tri(quads[3], 0, 1, 3); tri(quads[3], 1, 2, 3);
      draws.push({ kind: "shape-fill", blend: "alpha", first, count, instances: 1, thick: false });
    };
    border([mdVSFrame.ob_r, mdVSFrame.ob_g, mdVSFrame.ob_b, mdVSFrame.ob_a], mdVSFrame.ob_size, 0);
    border([mdVSFrame.ib_r, mdVSFrame.ib_g, mdVSFrame.ib_b, mdVSFrame.ib_a], mdVSFrame.ib_size, mdVSFrame.ob_size);
  }
}

/** Witnessed waveUtils.smoothWaveAndColor: -0.15/1.15 spline midpoints;
 *  returns interleaved (x,y,r,g,b,a) with 2n-1 vertices. */
function smoothWaveAndColor(positions: Float32Array, colors: Float32Array, nVertsIn: number): number[] {
  const c1 = -0.15, c2 = 1.15, c3 = 1.15, c4 = -0.15;
  const invSum = 1.0 / (c1 + c2 + c3 + c4);
  const out: number[] = [];
  let iBelow = 0;
  let iAbove2 = 1;
  for (let i = 0; i < nVertsIn - 1; i++) {
    const iAbove = iAbove2;
    iAbove2 = Math.min(nVertsIn - 1, i + 2);
    out.push(positions[i * 3], positions[i * 3 + 1],
      colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]);
    const sx = (c1 * positions[iBelow * 3] + c2 * positions[i * 3] + c3 * positions[iAbove * 3] + c4 * positions[iAbove2 * 3]) * invSum;
    const sy = (c1 * positions[iBelow * 3 + 1] + c2 * positions[i * 3 + 1] + c3 * positions[iAbove * 3 + 1] + c4 * positions[iAbove2 * 3 + 1]) * invSum;
    out.push(sx, sy, colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]);
    iBelow = i;
  }
  const last = nVertsIn - 1;
  out.push(positions[last * 3], positions[last * 3 + 1],
    colors[last * 4], colors[last * 4 + 1], colors[last * 4 + 2], colors[last * 4 + 3]);
  return out;
}
