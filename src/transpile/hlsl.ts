import { F32, vec, type Ty } from "./ast";
import { parseShader } from "./parser";
import { Emitter, WGSL_RESERVED, type Builtin, type Dialect } from "./emit";
import { mathBuiltins, vecArg } from "./builtins";

/**
 * MilkDrop-2 HLSL front end for warp and composite (comp) shaders.
 *
 * The MilkDrop preset shader contract is fully documented in projectM's
 * `PresetShaderHeaderGlsl330.inc` (the preamble prepended to every preset
 * shader before HLSL->GLSL transpilation): every #define, uniform, and
 * sampler in scope for a preset author lives in that header. Our bindings
 * match its declarations. Source URL:
 * https://raw.githubusercontent.com/projectM-visualizer/projectm/master/src/libprojectM/MilkdropPreset/Shaders/PresetShaderHeaderGlsl330.inc
 *
 * Sampler naming decodes a 3-char filter+wrap prefix per projectM's
 * `TextureManager::ExtractTextureSettings`: fw/wf = linear+repeat,
 * fc/cf = linear+clamp, pw/wp = point+repeat, pc/cp = point+clamp.
 * Header aliases `sampler_FC_main` etc. to their lowercase counterparts.
 *
 * GetMain(uv) and GetPixel(uv) alias `tex2D(sampler_main,uv).xyz` verbatim.
 * GetBlur1/2/3(uv) sample the blur cascade textures and apply per-level
 * scale+bias unpacking (`* _c5.x + _c5.y` for blur1, `* _c5.z + _c5.w`
 * for blur2, `* _c6.x + _c6.y` for blur3) since projectM stores each
 * blur level compressed against `blurN_min/blurN_max`.
 *
 * lum(x) uses MilkDrop-legacy coefficients `(0.32, 0.49, 0.29)` — not
 * Rec.601 or Rec.709; matches header's `#define lum(x) (dot(x,float3(0.32,0.49,0.29)))`.
 */

const RESERVED = new Set([
  "c", "render", "vmain", "fmain", "makeCtx", "img", "spec", "wav", "custSlot",
  "smin", "rot2", "camRay", "warpUV", "waveLine", "sdSphere", "sdBox",
  "sdTorus", "sdCylinder", "opRep", "sdNgon", "U", "Ctx", "noise", "hash",
  "fbm", "ridge", "pal", "hue3",
]);

/**
 * Rewrite HLSL sampler names into the specific builtin the emitter dispatches
 * on. Each named sampler maps to its own builtin so the WGSL side can carry
 * the semantic (blur cascade level, noise texture kind, main framebuffer)
 * even when the underlying WebGPU texture is a shared approximation.
 * The prefix table below is the verbatim projectM decoder.
 */
const SAMPLER_MAP: [RegExp, string][] = [
  // Main framebuffer — filter/wrap variants collapse to the same underlying
  // texture in our pipeline (WebGPU sampler modes handle wrap; filter
  // difference between point and linear is preserved by the sample function).
  [/\btex2D\s*\(\s*sampler_(?:fc|cf|fw|wf|pc|cp|pw|wp|FC|CF|FW|WF|PC|CP|PW|WP)_main\s*,\s*/g, "mdtex_main("],
  [/\btex2D\s*\(\s*sampler_main\s*,\s*/g, "mdtex_main("],
  // Blur cascade — each level is a separate builtin so GetBlurN math applies
  [/\btex2D\s*\(\s*sampler_blur1\s*,\s*/g, "mdtex_blur1("],
  [/\btex2D\s*\(\s*sampler_blur2\s*,\s*/g, "mdtex_blur2("],
  [/\btex2D\s*\(\s*sampler_blur3\s*,\s*/g, "mdtex_blur3("],
  // Noise textures — 256x256 LQ, 32x32 lite/HQ, 64x64 MQ per Geiss docs
  [/\btex2D\s*\(\s*sampler_(?:\w{2}_)?noise_lq\b\s*,\s*/g, "mdtex_noise_lq("],
  [/\btex2D\s*\(\s*sampler_(?:\w{2}_)?noise_lq_lite\b\s*,\s*/g, "mdtex_noise_lq("],
  [/\btex2D\s*\(\s*sampler_(?:\w{2}_)?noise_mq\b\s*,\s*/g, "mdtex_noise_mq("],
  [/\btex2D\s*\(\s*sampler_(?:\w{2}_)?noise_hq\b\s*,\s*/g, "mdtex_noise_hq("],
  [/\btex3D\s*\(\s*sampler_(?:\w{2}_)?noisevol_lq\b\s*,\s*/g, "mdtex_noisevol_lq("],
  [/\btex3D\s*\(\s*sampler_(?:\w{2}_)?noisevol_hq\b\s*,\s*/g, "mdtex_noisevol_hq("],
  // Any remaining tex2D/tex3D — fall through to plain mdtex_main
  [/\btex[23]D\s*\(\s*sampler_\w+\s*,\s*/g, "mdtex_main("],
  [/\btex[23]D\s*\(\s*\w+\s*,\s*/g, "mdtex_main("],
];

function bindContract(src: string): string {
  let s = src.replace(/\r\n/g, "\n");
  // strip line comments before block comments (avoid `//*` false-open, same
  // bug family as the Plane9 front end's prepare fix)
  s = s.replace(/\/\/[^\n]*/g, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/^[ \t]*#define[ \t]+(\w+)[ \t]+([^\s/]+)[ \t]*$/gm, "const float $1 = $2;");
  s = s.replace(/^[ \t]*#.*$/gm, "");
  s = s.replace(/\bsampler(2D|3D)?\s+\w+\s*(=[^;]*)?;/g, "");
  for (const [rx, repl] of SAMPLER_MAP) s = s.replace(rx, repl);
  // Header macros GetMain/GetPixel/GetBlurN and lum — verbatim from
  // PresetShaderHeaderGlsl330.inc:
  //   #define GetMain(uv) (tex2D(sampler_main,uv).xyz)
  //   #define GetPixel(uv) (tex2D(sampler_main,uv).xyz)
  //   #define GetBlur1(uv) (tex2D(sampler_blur1,uv).xyz*_c5.x + _c5.y)
  //   #define GetBlur2(uv) (tex2D(sampler_blur2,uv).xyz*_c5.z + _c5.w)
  //   #define GetBlur3(uv) (tex2D(sampler_blur3,uv).xyz*_c6.x + _c6.y)
  //   #define lum(x) (dot(x,float3(0.32,0.49,0.29)))
  // GetMain/GetPixel drop straight to mdtex_main.
  s = s.replace(/\bGetMain\s*\(/g, "mdgetmain(");
  s = s.replace(/\bGetPixel\s*\(/g, "mdgetmain(");
  s = s.replace(/\bGetBlur1\s*\(/g, "mdgetblur1(");
  s = s.replace(/\bGetBlur2\s*\(/g, "mdgetblur2(");
  s = s.replace(/\bGetBlur3\s*\(/g, "mdgetblur3(");
  s = s.replace(/\blum\s*\(/g, "mdlum(");
  s = s.replace(/\bshader_body\b/g, "void main()");
  // noise-texture metrics: fixed sizes per Geiss's shader-input table
  s = s.replace(/\btexsize_noise_lq\b/g, "float4(256.0, 256.0, 0.00390625, 0.00390625)");
  s = s.replace(/\btexsize_noise_mq\b/g, "float4(64.0, 64.0, 0.015625, 0.015625)");
  s = s.replace(/\btexsize_noise_hq\b/g, "float4(32.0, 32.0, 0.03125, 0.03125)");
  s = s.replace(/\btexsize_noise\w*\b/g, "float4(256.0, 256.0, 0.00390625, 0.00390625)");
  return s;
}

export type HlslKind = "warp" | "comp";

export function hlslToBody(hlsl: string, kind: HlslKind): { body: string; warnings: string[] } {
  const warnings: string[] = [];
  const bound = bindContract(hlsl);

  const externals: Record<string, Ty> = {
    uv: vec(2), uv_orig: vec(2), rad: F32, ang: F32,
    ret: vec(3), texsize: vec(4), aspect: vec(4),
    time: F32, bass: F32, mid: F32, treb: F32, vol: F32,
    bass_att: F32, mid_att: F32, treb_att: F32, vol_att: F32,
    frame: F32, fps: F32, progress: F32, decay: F32,
    hue_shader: vec(3), rand_preset: vec(4), rand_frame: vec(4),
    roam_cos: vec(4), roam_sin: vec(4), slow_roam_cos: vec(4), slow_roam_sin: vec(4),
    // Blur-level clamp ranges (blurN_min/max) — projectM per-preset uniforms;
    // scenes read them to unpack the compressed blur textures.
    blur1_min: F32, blur1_max: F32, blur2_min: F32, blur2_max: F32,
    blur3_min: F32, blur3_max: F32,
    // Mip-level shader inputs from PresetShaderHeaderGlsl330.inc
    mip_x: F32, mip_y: F32, mip_xy: vec(2), mip_avg: F32,
  };
  for (let i = 1; i <= 32; i++) externals[`q${i}`] = F32;

  // Warp shader reads the previous framebuffer (which becomes the current
  // canvas after the warp pass writes to it); composite reads the current
  // (already-warped) framebuffer. Matches projectM's split of sampler_main
  // between the two shader passes.
  const sampleFn = kind === "warp" ? "prevTex" : "srcTex";

  const builtins = mathBuiltins();

  // Main-framebuffer sample — the projectM header binds sampler_main to the
  // canvas; both filter+wrap variants collapse here in our runtime.
  const mainTex: Builtin = (args, line, e) => ({
    code: `vec4f(${sampleFn}(${vecArg(args, 0, 2, line, e)}), 1.0)`,
    ty: vec(4),
  });
  builtins.mdtex_main = mainTex;
  builtins.mdgetmain = (args, line, e) => ({
    // GetMain / GetPixel return .xyz per header definition
    code: `${sampleFn}(${vecArg(args, 0, 2, line, e)})`,
    ty: vec(3),
  });

  // Blur cascade — real projectM cascades 3 stages of separable Gaussian
  // (Blur1FragmentShaderGlsl330.frag is 8-tap horizontal, Blur2 is 4-tap
  // vertical, Blur3 continues the pyramid). Our runtime doesn't render a
  // dedicated blur cascade; each blurN builtin approximates the level by
  // sampling the main framebuffer with a widening tap radius, then applies
  // the header's per-level scale+bias unpack (`* _cN.x + _cN.y`) so scenes
  // that rely on the packed-value range still get plausible values.
  // Approximation limitation noted honestly: no true multi-pass Gaussian
  // cascade; visual fidelity to projectM's blur cascade is not full.
  const blurTex = (radius: number, scaleVar: string, biasVar: string): Builtin =>
    (args, line, e) => {
      const uv = vecArg(args, 0, 2, line, e);
      const r = radius.toFixed(4);
      // 5-tap gaussian (center + 4 diagonals) at the given radius
      const sample = `((${sampleFn}(${uv}) + ` +
        `${sampleFn}((${uv}) + vec2f(${r}, 0.0)) + ` +
        `${sampleFn}((${uv}) - vec2f(${r}, 0.0)) + ` +
        `${sampleFn}((${uv}) + vec2f(0.0, ${r})) + ` +
        `${sampleFn}((${uv}) - vec2f(0.0, ${r}))) * 0.2)`;
      return {
        code: `(${sample} * (${scaleVar} - ${biasVar}) + vec3f(${biasVar}))`,
        ty: vec(3),
      };
    };
  builtins.mdgetblur1 = blurTex(0.006, "blur1_max", "blur1_min");
  builtins.mdgetblur2 = blurTex(0.014, "blur2_max", "blur2_min");
  builtins.mdgetblur3 = blurTex(0.028, "blur3_max", "blur3_min");
  builtins.mdtex_blur1 = (args, line, e) => {
    const uv = vecArg(args, 0, 2, line, e);
    return { code: `vec4f(${sampleFn}(${uv}), 1.0)`, ty: vec(4) };
  };
  builtins.mdtex_blur2 = builtins.mdtex_blur1;
  builtins.mdtex_blur3 = builtins.mdtex_blur1;

  // Noise textures — MilkDrop supplies 4 fixed noise textures + 2 volume
  // textures with documented sizes. Our runtime doesn't ship these as
  // static assets; each builtin synthesises a deterministic hash-based
  // noise value so scenes referencing sampler_noise_lq etc. get pseudo-
  // random content at the right frequency range.
  const noiseTex = (mult: number): Builtin => (args, line, e) => {
    const uv = vecArg(args, 0, 2, line, e);
    return {
      code: `vec4f(fract(vec3f(hash((${uv}) * ${mult.toFixed(2)} + vec2f(0.13, 0.37)), ` +
        `hash((${uv}) * ${mult.toFixed(2)} + vec2f(0.71, 0.29)), ` +
        `hash((${uv}) * ${mult.toFixed(2)} + vec2f(0.53, 0.89)))), 1.0)`,
      ty: vec(4),
    };
  };
  builtins.mdtex_noise_lq = noiseTex(256.0);
  builtins.mdtex_noise_mq = noiseTex(64.0);
  builtins.mdtex_noise_hq = noiseTex(32.0);
  const noiseTexVol = (mult: number): Builtin => (args, line, e) => {
    const uvw = vecArg(args, 0, 3, line, e);
    return {
      code: `vec4f(fract(vec3f(hash((${uvw}).xy * ${mult.toFixed(2)}), ` +
        `hash((${uvw}).yz * ${mult.toFixed(2)}), ` +
        `hash((${uvw}).xz * ${mult.toFixed(2)}))), 1.0)`,
      ty: vec(4),
    };
  };
  builtins.mdtex_noisevol_lq = noiseTexVol(32.0);
  builtins.mdtex_noisevol_hq = noiseTexVol(16.0);

  builtins.mdlum = (args, line, e) => ({
    // MilkDrop-legacy luma coefficients per header line
    // `#define lum(x) (dot(x,float3(0.32,0.49,0.29)))`
    code: `dot(${vecArg(args, 0, 3, line, e)}, vec3f(0.32, 0.49, 0.29))`,
    ty: F32,
  });

  const dialect: Dialect = {
    externals,
    builtins,
    rename: (n) => (RESERVED.has(n) || WGSL_RESERVED.has(n) ? "u_" + n : n),
  };
  const emitter = new Emitter(dialect);
  emitter.entryOutVar = "ret";
  emitter.entryOutTy = vec(3);
  const prog = parseShader(bound);
  const { helpers, entry, globalInits } = emitter.emitProgram(prog, "main");
  const retExpr = kind === "warp" ? "max(ret, srcTex(c.uv))" : "ret";
  const stmts = (globalInits ? globalInits + "\n" : "") +
    emitter.emitEntryBody(entry, externals, retExpr, { k: "void" });

  // contract vars are module privates (helpers read them) and writable
  // (presets assign to q-vars, rad, even uv freely)
  const names: [string, string][] = [
    ["uv", "vec2f"], ["uv_orig", "vec2f"], ["rad", "f32"], ["ang", "f32"],
    ["texsize", "vec4f"], ["aspect", "vec4f"], ["time", "f32"],
    ["bass", "f32"], ["mid", "f32"], ["treb", "f32"], ["vol", "f32"],
    ["bass_att", "f32"], ["mid_att", "f32"], ["treb_att", "f32"], ["vol_att", "f32"],
    ["frame", "f32"], ["fps", "f32"], ["progress", "f32"], ["decay", "f32"],
    ["hue_shader", "vec3f"], ["rand_preset", "vec4f"], ["rand_frame", "vec4f"],
    ["roam_cos", "vec4f"], ["roam_sin", "vec4f"],
    ["slow_roam_cos", "vec4f"], ["slow_roam_sin", "vec4f"], ["ret", "vec3f"],
    ["blur1_min", "f32"], ["blur1_max", "f32"],
    ["blur2_min", "f32"], ["blur2_max", "f32"],
    ["blur3_min", "f32"], ["blur3_max", "f32"],
    ["mip_x", "f32"], ["mip_y", "f32"], ["mip_xy", "vec2f"], ["mip_avg", "f32"],
  ];
  for (let i = 1; i <= 32; i++) names.push([`q${i}`, "f32"]);
  const privates = names.map(([n, t]) => `var<private> ${n} : ${t};`).join("\n");

  const uvInit = kind === "warp"
    ? `  uv = warpUV(c.uv, mdZoom(), mdRot(), vec2f(mdDx(), mdDy()), mdWarp(), c.t) + meshOff(c.uv);`
    : `  uv = c.uv;`;
  const qInits = Array.from({ length: 32 }, (_, i) =>
    `  q${i + 1} = ${i < 8 ? `mdQ${i + 1}()` : "0.0"};`).join("\n");
  const composite = kind === "warp"
    ? `  return max(ret, srcTex(c.uv));`
    : `  return ret;`;

  // Audio ratio semantics (Loudness.cpp): shader-visible `bass/mid/treb` =
  // m_average / m_longAverage, `bass_att/...` = m_current / m_longAverage.
  // Our synthetic audio produces values already normalized around 1.0-ish;
  // treat c.bass etc. as already-ratio-normalized and pass through directly.
  // Long-term normal in projectM is IIR (0.9 first 50 frames, then 0.992);
  // we skip the envelope since our synth doesn't need warm-up.
  const body = privates + "\n" + (helpers ? helpers + "\n" : "") +
    `fn render(c : Ctx) -> vec3f {
${uvInit}
  uv_orig = c.uv;
  rad = length(c.q) * 0.7071;
  ang = atan2(c.q.y, c.q.x);
  texsize = vec4f(c.res, 1.0 / c.res);
  // aspect.xy = multiplier to paste an image fullscreen aspect-aware;
  // aspect.zw = inverse. Narrow axis stays 1.0 per projectM (RenderContext).
  aspect = vec4f(
    select(c.res.x / c.res.y, 1.0, c.res.y > c.res.x),
    select(c.res.y / c.res.x, 1.0, c.res.x > c.res.y),
    select(c.res.y / c.res.x, 1.0, c.res.x > c.res.y),
    select(c.res.x / c.res.y, 1.0, c.res.y > c.res.x));
  time = c.t;
  bass = c.bass; mid = c.mid; treb = c.treble;
  vol = (c.bass + c.mid + c.treble) / 3.0;
  bass_att = bass; mid_att = mid; treb_att = treb; vol_att = vol;
  frame = c.rawT * 60.0;
  fps = 60.0; progress = 0.0;
  decay = mdDecay();
  hue_shader = pal(0.5);
  rand_preset = vec4f(0.42, 0.71, 0.13, 0.88);
  rand_frame = fract(vec4f(sin(c.rawT * 91.7), sin(c.rawT * 57.3), sin(c.rawT * 23.1), sin(c.rawT * 77.9)));
  roam_cos = cos(vec4f(c.rawT * 0.3, c.rawT * 1.3, c.rawT * 5.0, c.rawT * 20.0));
  roam_sin = sin(vec4f(c.rawT * 0.3, c.rawT * 1.3, c.rawT * 5.0, c.rawT * 20.0));
  slow_roam_cos = cos(vec4f(c.rawT * 0.005, c.rawT * 0.008, c.rawT * 0.013, c.rawT * 0.022));
  slow_roam_sin = sin(vec4f(c.rawT * 0.005, c.rawT * 0.008, c.rawT * 0.013, c.rawT * 0.022));
  // Blur clamp defaults — projectM presets can override, we baseline to
  // [0, 1] so the unpack math produces the sampled value unchanged.
  blur1_min = 0.0; blur1_max = 1.0;
  blur2_min = 0.0; blur2_max = 1.0;
  blur3_min = 0.0; blur3_max = 1.0;
  // Mip levels — projectM computes from prev-frame stats; we approximate
  // as a mid-gray baseline.
  mip_x = 0.5; mip_y = 0.5; mip_xy = vec2f(0.5, 0.5); mip_avg = 0.5;
${qInits}
  ret = vec3f(0.0);
${stmts}
${composite}
}`;
  return { body, warnings };
}
