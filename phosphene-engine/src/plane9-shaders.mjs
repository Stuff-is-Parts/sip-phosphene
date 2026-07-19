// WGSL translations of the Plane9 nodedata shader files. Each export is
// a WGSL module string derived by transcription from the corresponding
// nodedata/*.glsl file at C:\Program Files (x86)\Plane9\nodedata\.
//
// Translation rules used throughout:
//   - GLSL "in" vertex attribute inputs and the varying VERTEXOUTPUT
//     struct are replaced by WGSL @location() attributes and a VSOut
//     struct; iPosition/iTexCoord are generated inline from
//     @builtin(vertex_index) using a three-vertex full-screen triangle
//     (same technique the existing composite pass uses at
//     phosphene-engine/src/render-wgsl.mjs).
//   - GLSL "uniform" declarations become a single @group(0) @binding(2)
//     @uniform<> struct whose fields hold every named g-uniform the
//     source declares, in the same order.
//   - GLSL "sampler2D" uniforms become @group(0) @binding(0)
//     texture_2d<f32> plus @group(0) @binding(1) sampler.
//   - GLSL "textureLod(t, uv, 0.0)" becomes WGSL
//     "textureSampleLevel(t, s, uv, 0.0)".
//   - Each GLSL "#if PASS == N" fragment "main" becomes a WGSL @fragment
//     function fsN so the host picks the entryPoint per pass number.
//   - The vertex shader is one shared @vertex function "vs" per file
//     because the source's #ifdef VERTEX block is the same across passes
//     within any given nodedata file (verified per file).

/**
 * blur.glsl — separable Gaussian blur, four passes.
 * PASS 0 = horizontal 4-radius, PASS 1 = vertical 4-radius,
 * PASS 2 = horizontal 6-radius, PASS 3 = vertical 6-radius.
 * Source: C:\Program Files (x86)\Plane9\nodedata\blur.glsl
 */
const plane9BlurWGSL = /* wgsl */`
struct BlurUniforms {
  sourceTextureSize: vec2<f32>,
  brightness: f32,
  _pad: f32,
};
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;
@group(0) @binding(2) var<uniform> u: BlurUniforms;

struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) tex: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0));
  var o: VSOut;
  o.pos = vec4(p[i], 0.0, 1.0);
  o.tex = vec2(0.5 * p[i].x + 0.5, 0.5 - 0.5 * p[i].y);
  return o;
}

// blur.glsl:9-10 — radius-4 offsets and weights
const OFF4_1: f32 = 1.3846153846;
const OFF4_2: f32 = 3.2307692308;
const W4_0:   f32 = 0.2270270270;
const W4_1:   f32 = 0.3162162162;
const W4_2:   f32 = 0.0702702703;

// blur.glsl:13-14 — radius-6 offsets and weights
const OFF6_1: f32 = 1.44827586206897;
const OFF6_2: f32 = 3.37931034482759;
const OFF6_3: f32 = 5.31034482758621;
const W6_0:   f32 = 0.151343978258946;
const W6_1:   f32 = 0.256023563221383;
const W6_2:   f32 = 0.130521816544234;
const W6_3:   f32 = 0.03778263110491;

// horizontalPass4 (blur.glsl:49-61)
@fragment fn fs0(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSampleLevel(srcTex, srcSamp, in.tex, 0.0) * W4_0;
  let ox1 = OFF4_1 * u.sourceTextureSize.x;
  let ox2 = OFF4_2 * u.sourceTextureSize.x;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(ox1, 0.0), 0.0) * W4_1;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(ox1, 0.0), 0.0) * W4_1;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(ox2, 0.0), 0.0) * W4_2;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(ox2, 0.0), 0.0) * W4_2;
  return c * u.brightness;
}

// verticalPass4 (blur.glsl:63-75)
@fragment fn fs1(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSampleLevel(srcTex, srcSamp, in.tex, 0.0) * W4_0;
  let oy1 = OFF4_1 * u.sourceTextureSize.y;
  let oy2 = OFF4_2 * u.sourceTextureSize.y;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(0.0, oy1), 0.0) * W4_1;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(0.0, oy1), 0.0) * W4_1;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(0.0, oy2), 0.0) * W4_2;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(0.0, oy2), 0.0) * W4_2;
  return c * u.brightness;
}

// horizontalPass6 (blur.glsl:77-89)
@fragment fn fs2(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSampleLevel(srcTex, srcSamp, in.tex, 0.0) * W6_0;
  let ox1 = OFF6_1 * u.sourceTextureSize.x;
  let ox2 = OFF6_2 * u.sourceTextureSize.x;
  let ox3 = OFF6_3 * u.sourceTextureSize.x;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(ox1, 0.0), 0.0) * W6_1;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(ox1, 0.0), 0.0) * W6_1;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(ox2, 0.0), 0.0) * W6_2;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(ox2, 0.0), 0.0) * W6_2;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(ox3, 0.0), 0.0) * W6_3;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(ox3, 0.0), 0.0) * W6_3;
  return c * u.brightness;
}

// verticalPass6 (blur.glsl:91-103)
@fragment fn fs3(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSampleLevel(srcTex, srcSamp, in.tex, 0.0) * W6_0;
  let oy1 = OFF6_1 * u.sourceTextureSize.y;
  let oy2 = OFF6_2 * u.sourceTextureSize.y;
  let oy3 = OFF6_3 * u.sourceTextureSize.y;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(0.0, oy1), 0.0) * W6_1;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(0.0, oy1), 0.0) * W6_1;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(0.0, oy2), 0.0) * W6_2;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(0.0, oy2), 0.0) * W6_2;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex + vec2(0.0, oy3), 0.0) * W6_3;
  c = c + textureSampleLevel(srcTex, srcSamp, in.tex - vec2(0.0, oy3), 0.0) * W6_3;
  return c * u.brightness;
}
`;

/**
 * streak.glsl — single-pass 8-tap weighted-sample filter used for streak
 * accumulation. Uses two array uniforms: gOffsets (8 vec2 sample offsets)
 * and gWeights (8 vec4 sample weights).
 * Source: C:\Program Files (x86)\Plane9\nodedata\streak.glsl
 */
const plane9StreakWGSL = /* wgsl */`
// GLSL "MAX_SAMPLES = 8" and "uniform vec2 gOffsets[8]; uniform vec4 gWeights[8];"
// (streak.glsl:3-6). WGSL uniform arrays require element alignment to 16
// bytes, so gOffsets uses vec4 padded slots (xy = offset, zw ignored).
struct StreakUniforms {
  offsets: array<vec4<f32>, 8>,   // vec2 packed into vec4.xy for alignment
  weights: array<vec4<f32>, 8>,
};
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;
@group(0) @binding(2) var<uniform> u: StreakUniforms;

struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) tex: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0));
  var o: VSOut;
  o.pos = vec4(p[i], 0.0, 1.0);
  o.tex = vec2(0.5 * p[i].x + 0.5, 0.5 - 0.5 * p[i].y);
  return o;
}

// streak.glsl:29-37 — accumulate weighted samples at 8 offsets
@fragment fn fs0(in: VSOut) -> @location(0) vec4<f32> {
  var c = vec4<f32>(0.0);
  for (var i: i32 = 0; i < 8; i = i + 1) {
    let off = u.offsets[i].xy;
    c = c + u.weights[i] * textureSampleLevel(srcTex, srcSamp, in.tex + off, 0.0);
  }
  return c;
}
`;

/**
 * downscale2.glsl — 36-tap downsample filter, two passes.
 * PASS 0 applies a bright-only threshold ((c-t)*scale, clamped to 0),
 * PASS 1 is plain downsampling.
 * Source: C:\Program Files (x86)\Plane9\nodedata\downscale2.glsl
 */
const plane9Downscale2WGSL = /* wgsl */`
struct Downscale2Uniforms {
  sourceTextureSize: vec2<f32>,
  threshold: f32,
  scale: f32,
};
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;
@group(0) @binding(2) var<uniform> u: Downscale2Uniforms;

struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) tex: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0));
  var o: VSOut;
  o.pos = vec4(p[i], 0.0, 1.0);
  o.tex = vec2(0.5 * p[i].x + 0.5, 0.5 - 0.5 * p[i].y);
  return o;
}

// downscale2.glsl:29-49 — 13 bilinear samples building a 36 texel filter
fn downsample36texel(p: vec2<f32>) -> vec4<f32> {
  let ts = u.sourceTextureSize;
  let ts2 = ts * 2.0;
  var c = textureSampleLevel(srcTex, srcSamp, p, 0.0) * (0.125 * 4.0);
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2( ts.x,  ts.y), 0.0) * 0.5;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2(-ts.x,  ts.y), 0.0) * 0.5;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2( ts.x, -ts.y), 0.0) * 0.5;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2(-ts.x, -ts.y), 0.0) * 0.5;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2(  0.0,  ts2.y), 0.0) * 0.25;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2(-ts2.x,   0.0), 0.0) * 0.25;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2( ts2.x,   0.0), 0.0) * 0.25;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2(  0.0, -ts2.y), 0.0) * 0.25;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2( ts2.x,  ts2.y), 0.0) * 0.125;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2(-ts2.x,  ts2.y), 0.0) * 0.125;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2( ts2.x, -ts2.y), 0.0) * 0.125;
  c = c + textureSampleLevel(srcTex, srcSamp, p + vec2(-ts2.x, -ts2.y), 0.0) * 0.125;
  return c * 0.25;
}

// PASS 0 — threshold + scale (downscale2.glsl:52-57)
@fragment fn fs0(in: VSOut) -> @location(0) vec4<f32> {
  let c = downsample36texel(in.tex);
  return max(vec4<f32>(0.0), (c - vec4<f32>(u.threshold)) * vec4<f32>(u.scale));
}

// PASS 1 — plain downsample (downscale2.glsl:60-64)
@fragment fn fs1(in: VSOut) -> @location(0) vec4<f32> {
  return downsample36texel(in.tex);
}
`;

/**
 * Per-shader metadata used by the engine and the render executor.
 * `passes` is the count of valid Pass integer values (0..passes-1).
 * `uniformSize` is the byte size of the WGSL uniform buffer for the shader.
 * `uniformFields` names each g-uniform port the shader declares, in the
 * order the WGSL uniform struct expects them and with their type. The
 * engine reads this to declare NATIVE_OPS ports; the executor reads it
 * to pack the uniform buffer per frame.
 */
/** @type {Record<string, {wgsl: string, passes: number, uniformSize: number, uniformFields: {name: string, type: 'float' | 'vec2' | 'vec3' | 'vec4', offset: number}[]}>} */
export const PLANE9_SHADERS = {
  blur: {
    wgsl: plane9BlurWGSL,
    passes: 4,
    // struct BlurUniforms { sourceTextureSize:vec2, brightness:f32, _pad:f32 }
    // = 16 bytes
    uniformSize: 16,
    uniformFields: [
      { name: 'gSourceTextureSize', type: 'vec2', offset: 0 },
      { name: 'gBrightness',        type: 'float', offset: 8 },
    ],
  },
  streak: {
    wgsl: plane9StreakWGSL,
    passes: 1,
    // struct StreakUniforms { offsets:array<vec4,8>, weights:array<vec4,8> }
    // = 8*16 + 8*16 = 256 bytes
    uniformSize: 256,
    uniformFields: [
      // 8 offset ports, each a vec2 packed into a vec4 slot
      { name: 'gOffsets0', type: 'vec2', offset: 0 },
      { name: 'gOffsets1', type: 'vec2', offset: 16 },
      { name: 'gOffsets2', type: 'vec2', offset: 32 },
      { name: 'gOffsets3', type: 'vec2', offset: 48 },
      { name: 'gOffsets4', type: 'vec2', offset: 64 },
      { name: 'gOffsets5', type: 'vec2', offset: 80 },
      { name: 'gOffsets6', type: 'vec2', offset: 96 },
      { name: 'gOffsets7', type: 'vec2', offset: 112 },
      { name: 'gWeights0', type: 'vec4', offset: 128 },
      { name: 'gWeights1', type: 'vec4', offset: 144 },
      { name: 'gWeights2', type: 'vec4', offset: 160 },
      { name: 'gWeights3', type: 'vec4', offset: 176 },
      { name: 'gWeights4', type: 'vec4', offset: 192 },
      { name: 'gWeights5', type: 'vec4', offset: 208 },
      { name: 'gWeights6', type: 'vec4', offset: 224 },
      { name: 'gWeights7', type: 'vec4', offset: 240 },
    ],
  },
  downscale2: {
    wgsl: plane9Downscale2WGSL,
    passes: 2,
    // struct Downscale2Uniforms { sourceTextureSize:vec2, threshold:f32, scale:f32 }
    // = 16 bytes
    uniformSize: 16,
    uniformFields: [
      { name: 'gSourceTextureSize', type: 'vec2', offset: 0 },
      { name: 'gThreshold',         type: 'float', offset: 8 },
      { name: 'gScale',             type: 'float', offset: 12 },
    ],
  },
};
