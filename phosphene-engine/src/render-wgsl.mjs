// The WGSL shaders for the warp-feedback + composite pipeline.
// Kept as strings so they can be validated headless AND used in-browser.
// The warp pass renders the source's own finite mesh: warped UVs are computed
// per vertex on the CPU (src/warp-mesh.mjs — milkdropfs.cpp:1877-1926, with
// the oscillators :1782-1787) and the rasterizer interpolates between
// vertices, exactly as WarpedBlit_NoShaders draws them (milkdropfs.cpp:
// 2085-2104). The vertex shader passes the mesh UV through; the fragment
// shader samples, applies decay, and draws the border rings in screen space
// (:3431-3487). The render targets follow the window per the source's DEFAULT
// texture mode (nTexSize -1 auto-exact: plugin.cpp:949, 1193-1196, 1851-1852;
// 16-block snap :1879-1880).

// Composite pass — transcribed from CPlugin::ShowToUser_NoShaders
// (milkdropfs.cpp:4050-4260). The source draws the internal texture as a
// screen quad that is aspect-scaled LARGER than the screen (crop, not
// stretch, :4101-4114, with the 1+1/W overscan at :4089-4090), applies video
// echo as a second zoomed/flipped layer mixed by echo alpha (:4169-4200), and
// applies gammaAdj by iterative additive redraws (:4240-4260) — whose net
// effect, since the adds are non-negative and clamp per channel, is
// min(1, color * gamma). xmult/ymult arrive precomputed per frame from the
// canvas size (the JS mirrors :4089-4114). Previously each page carried its
// own inline blit that divided canvas pixels by TEXTURE dimensions — correct
// only when the canvas happened to equal the texture size; this module is now
// the single audited home for composite state.
export const compositeWGSL = /* wgsl */`
struct CompUniforms {
  gamma: f32, echoAlpha: f32, echoZoom: f32, echoOrient: f32,
  xmult: f32, ymult: f32, _p0: f32, _p1: f32,
};
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var<uniform> cu: CompUniforms;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>,3>(vec2(-1.0,-3.0), vec2(-1.0,1.0), vec2(3.0,1.0));
  var o: VSOut;
  o.pos = vec4(p[i], 0.0, 1.0);
  o.uv = vec2(0.5*p[i].x+0.5, 0.5 - 0.5*p[i].y);
  return o;
}
@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
  // crop: the source quad is scaled up by (xmult,ymult), so the screen shows
  // the central 1/mult region of the texture (:4101-4114)
  let uv = vec2(0.5 + (in.uv.x - 0.5) / cu.xmult, 0.5 + (in.uv.y - 0.5) / cu.ymult);
  let base = textureSample(t, s, uv).rgb;
  // the source BRANCHES AROUND the whole echo operation at the threshold
  // (if (fVideoEchoAlpha > 0.001f), milkdropfs.cpp:4168) — below it, no echo
  // coordinates are computed and no echo sample is taken, so a zero or invalid
  // echoZoom cannot produce a division by zero while echo is disabled
  var mixed = base;
  if (cu.echoAlpha > 0.001) {
    // echo layer UV: centered zoom then orientation flips (:4179-4200)
    var e = vec2(0.5 + (uv.x - 0.5) / cu.echoZoom, 0.5 + (uv.y - 0.5) / cu.echoZoom);
    if (cu.echoOrient % 2.0 >= 1.0) { e.x = 1.0 - e.x; }
    if (cu.echoOrient >= 2.0) { e.y = 1.0 - e.y; }
    let echo = textureSampleLevel(t, s, e, 0.0).rgb; // single-mip texture; level 0 == sample
    mixed = (1.0 - cu.echoAlpha) * base + cu.echoAlpha * echo;
  }
  // gammaAdj via additive redraws nets to a saturating multiply (:4240-4260)
  return vec4(min(vec3(1.0), mixed * cu.gamma), 1.0);
}`;

// Plane9 blur shader (nodedata/blur.glsl in the v2.5.1 install). WGSL
// line-by-line semantic transcription of the four GLSL fragment
// branches — GLSL and WGSL are different shader languages, so this is
// not a byte-for-byte copy; the numeric kernel constants at :9-10 and
// :13-14 are transcribed unchanged, and each sample/weight expression
// is rewritten in WGSL with identical arithmetic. Four fragment entry
// points map to the source file's four #if PASS branches:
//   fs0 — horizontalPass4 (blur.glsl:49-61)
//   fs1 — verticalPass4   (blur.glsl:63-75)
//   fs2 — horizontalPass6 (blur.glsl:77-89)
//   fs3 — verticalPass6   (blur.glsl:91-103)
// `gSourceTextureSize` is UV-per-pixel (i.e. 1/textureWidth,
// 1/textureHeight) since the shader multiplies pixel offsets by it to
// produce UV space steps; the executor supplies that value each frame
// from the actual source texture dimensions. `gBrightness` is a scalar
// multiplier applied to the summed kernel result, defaulting to 1.0 per
// the source line 3 uniform initializer.
export const plane9BlurWGSL = /* wgsl */`
struct BlurUniforms {
  gSourceTextureSize: vec2<f32>,
  gBrightness: f32,
  _pad: f32,
};
@group(0) @binding(0) var gSrcSampler_tex: texture_2d<f32>;
@group(0) @binding(1) var gSrcSampler_samp: sampler;
@group(0) @binding(2) var<uniform> u: BlurUniforms;

struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) tex: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0));
  var o: VSOut;
  o.pos = vec4(p[i], 0.0, 1.0);
  o.tex = vec2(0.5 * p[i].x + 0.5, 0.5 - 0.5 * p[i].y);
  return o;
}

// radius-4 kernel — blur.glsl:9-10
const OFF4_1: f32 = 1.3846153846;
const OFF4_2: f32 = 3.2307692308;
const W4_0:   f32 = 0.2270270270;
const W4_1:   f32 = 0.3162162162;
const W4_2:   f32 = 0.0702702703;

// radius-6 kernel — blur.glsl:13-14
const OFF6_1: f32 = 1.44827586206897;
const OFF6_2: f32 = 3.37931034482759;
const OFF6_3: f32 = 5.31034482758621;
const W6_0:   f32 = 0.151343978258946;
const W6_1:   f32 = 0.256023563221383;
const W6_2:   f32 = 0.130521816544234;
const W6_3:   f32 = 0.03778263110491;

// horizontalPass4 — blur.glsl:49-61
@fragment fn fs0(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex, 0.0) * W4_0;
  let ox1 = OFF4_1 * u.gSourceTextureSize.x;
  let ox2 = OFF4_2 * u.gSourceTextureSize.x;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(ox1, 0.0), 0.0) * W4_1;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(ox1, 0.0), 0.0) * W4_1;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(ox2, 0.0), 0.0) * W4_2;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(ox2, 0.0), 0.0) * W4_2;
  return c * u.gBrightness;
}

// verticalPass4 — blur.glsl:63-75
@fragment fn fs1(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex, 0.0) * W4_0;
  let oy1 = OFF4_1 * u.gSourceTextureSize.y;
  let oy2 = OFF4_2 * u.gSourceTextureSize.y;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(0.0, oy1), 0.0) * W4_1;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(0.0, oy1), 0.0) * W4_1;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(0.0, oy2), 0.0) * W4_2;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(0.0, oy2), 0.0) * W4_2;
  return c * u.gBrightness;
}

// horizontalPass6 — blur.glsl:77-89
@fragment fn fs2(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex, 0.0) * W6_0;
  let ox1 = OFF6_1 * u.gSourceTextureSize.x;
  let ox2 = OFF6_2 * u.gSourceTextureSize.x;
  let ox3 = OFF6_3 * u.gSourceTextureSize.x;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(ox1, 0.0), 0.0) * W6_1;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(ox1, 0.0), 0.0) * W6_1;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(ox2, 0.0), 0.0) * W6_2;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(ox2, 0.0), 0.0) * W6_2;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(ox3, 0.0), 0.0) * W6_3;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(ox3, 0.0), 0.0) * W6_3;
  return c * u.gBrightness;
}

// verticalPass6 — blur.glsl:91-103
@fragment fn fs3(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex, 0.0) * W6_0;
  let oy1 = OFF6_1 * u.gSourceTextureSize.y;
  let oy2 = OFF6_2 * u.gSourceTextureSize.y;
  let oy3 = OFF6_3 * u.gSourceTextureSize.y;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(0.0, oy1), 0.0) * W6_1;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(0.0, oy1), 0.0) * W6_1;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(0.0, oy2), 0.0) * W6_2;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(0.0, oy2), 0.0) * W6_2;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex + vec2(0.0, oy3), 0.0) * W6_3;
  c = c + textureSampleLevel(gSrcSampler_tex, gSrcSampler_samp, in.tex - vec2(0.0, oy3), 0.0) * W6_3;
  return c * u.gBrightness;
}`;

export const feedbackWGSL = /* wgsl */`
struct Uniforms {
  decay: f32,
  ib_size: f32, ib_r: f32, ib_g: f32, ib_b: f32, ib_a: f32, ib_aGate: f32,
  ob_size: f32, ob_r: f32, ob_g: f32, ob_b: f32, ob_a: f32, ob_aGate: f32,
  _p0: f32, _p1: f32, _p2: f32,
};
@group(0) @binding(0) var prevTex: texture_2d<f32>;
@group(0) @binding(1) var prevSamp: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,   // warped mesh UV (src/warp-mesh.mjs, :1877-1926)
  @location(1) suv: vec2<f32>,  // screen-space uv for the border rings
};
@vertex fn vs(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VSOut {
  var o: VSOut;
  o.pos = vec4(pos, 0.0, 1.0);
  o.uv = uv;
  o.suv = vec2(pos.x*0.5 + 0.5, 0.5 - pos.y*0.5);
  return o;
}
@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
  // sample previous frame at the rasterizer-interpolated mesh coordinate,
  // apply decay (fDecay) — the interpolation between vertices IS the source's
  // path (WarpedBlit_NoShaders, milkdropfs.cpp:2085-2104)
  var prev = textureSample(prevTex, prevSamp, in.uv).rgb * u.decay;
  // border frames drawn after the warped blit — milkdropfs.cpp:3431-3487.
  // Screen edge is radius 1 in max-norm; rings live in screen space.
  let c = max(abs(in.suv.x - 0.5), abs(in.suv.y - 0.5)) * 2.0;
  // each ring draws only when its RAW alpha exceeds the source threshold
  // (if (a > 0.001f), milkdropfs.cpp:3451); the blend uses the 8-bit-converted
  // alpha (Diffuse, :3453-3457) carried in ib_a/ob_a
  if (u.ob_aGate > 0.001 && c >= 1.0 - u.ob_size && c <= 1.0) {
    prev = mix(prev, vec3(u.ob_r, u.ob_g, u.ob_b), u.ob_a);
  }
  if (u.ib_aGate > 0.001 && c >= 1.0 - u.ob_size - u.ib_size && c < 1.0 - u.ob_size) {
    prev = mix(prev, vec3(u.ib_r, u.ib_g, u.ib_b), u.ib_a);
  }
  return vec4(prev, 1.0);
}`;
