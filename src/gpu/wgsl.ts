import type { CustomParam, StageId } from "../core/types";

/**
 * Authoring contract: a stage body implements
 *   fn render(c: Ctx) -> vec3f
 * with helpers hash/noise/fbm/ridge/pal/spec/wav available, and for POST
 * stages additionally srcTex(uv)/prevTex(uv) sampling helpers plus c.fb.
 * Custom uniforms are declared with `//@param name min max default` and
 * read via `name()` accessor functions generated here.
 */

export const COMMON = /* wgsl */ `
struct Uniforms {
  resTime : vec4f,            // res.x, res.y, time, bass
  bands   : vec4f,            // mid, treble, beat, energy
  parms   : vec4f,            // hue, speed, intensity, fb
  xtra    : vec4f,            // transition progress, transition mode, image aspect, reserved
  spec    : array<vec4f, 16>, // 64-bin log spectrum, 0..1
  wave    : array<vec4f, 16>, // 64-sample waveform, -1..1
  cust    : array<vec4f, 12>, // custom //@param slots
};
@group(0) @binding(0) var<uniform> U : Uniforms;

struct Ctx {
  uv : vec2f,        // 0..1
  q : vec2f,         // aspect-corrected, centered
  res : vec2f,
  t : f32,           // time, already scaled by speed
  rawT : f32,
  bass : f32, mid : f32, treble : f32, beat : f32, energy : f32,
  hue : f32, speed : f32, intensity : f32, fb : f32,
};

fn spec(i : i32) -> f32 {
  let j = clamp(i, 0, 63);
  return U.spec[j / 4][j % 4];
}
fn wav(i : i32) -> f32 {
  let j = clamp(i, 0, 63);
  return U.wave[j / 4][j % 4];
}
fn custSlot(i : i32) -> f32 {
  let j = clamp(i, 0, 47);
  return U.cust[j / 4][j % 4];
}
fn hash(p : vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn noise(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x),
    mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x),
    u.y);
}
fn fbm(p0 : vec2f) -> f32 {
  var a = 0.5; var s = 0.0; var p = p0;
  for (var k = 0; k < 5; k++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}
fn ridge(p0 : vec2f) -> f32 {
  var a = 0.5; var s = 0.0; var p = p0;
  for (var k = 0; k < 5; k++) { s += a * (1.0 - abs(2.0 * noise(p) - 1.0)); p *= 2.1; a *= 0.5; }
  return s;
}
fn hue3(h : f32) -> vec3f {
  let x = fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0));
  return clamp(abs(x * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
}
fn pal(t : f32) -> vec3f { return hue3(t + U.parms.x); }


// ---- 3D / raymarching helpers ----
fn sdSphere(p : vec3f, r : f32) -> f32 { return length(p) - r; }
fn sdBox(p : vec3f, b : vec3f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}
fn sdTorus(p : vec3f, t : vec2f) -> f32 {
  let q = vec2f(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}
fn smin(a : f32, b : f32, k : f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
fn rot2(a : f32) -> mat2x2f {
  let c = cos(a); let s = sin(a);
  return mat2x2f(c, -s, s, c);
}
// camera ray: origin ro looking at ta, fragment coord q (aspect-corrected)
fn camRay(q : vec2f, ro : vec3f, ta : vec3f) -> vec3f {
  let fw = normalize(ta - ro);
  let rt = normalize(cross(vec3f(0.0, 1.0, 0.0), fw));
  let up = cross(fw, rt);
  return normalize(q.x * rt + q.y * up + 1.4 * fw);
}
fn sdCylinder(p : vec3f, h : f32, r : f32) -> f32 {
  let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}
// signed distance to a regular n-gon at the origin, radius r, rotated ang
fn sdNgon(p0 : vec2f, r : f32, n : f32, ang : f32) -> f32 {
  let p = rot2(-ang) * p0;
  let seg = 6.2831853 / max(n, 3.0);
  let a = atan2(p.y, p.x);
  let b = seg * floor(a / seg + 0.5);
  return length(p) * cos(a - b) - r * cos(seg * 0.5);
}
fn opRep(p : vec3f, c : vec3f) -> vec3f { return p - c * round(p / c); }

// MilkDrop-style feedback warp: zoom toward/away from center, rotate,
// translate, plus the classic sinusoidal warp wobble scaled by amt.
fn warpUV(uv : vec2f, zoom : f32, rot : f32, d : vec2f, amt : f32, t : f32) -> vec2f {
  var p = uv - vec2f(0.5);
  p = rot2(rot) * p;
  p = p / max(zoom, 0.01);
  let w = amt * 0.035;
  p += vec2f(sin(p.y * 7.0 + t * 1.7) + sin(p.x * 11.0 - t * 1.3),
             cos(p.x * 7.0 + t * 1.9) + cos(p.y * 11.0 - t * 1.1)) * w * 0.5;
  return p + vec2f(0.5) - d;
}

// 64-sample waveform drawn as a polyline over q-space x in [x0,x1]:
// returns 0..1 line intensity with the given half-thickness.
fn waveLine(q : vec2f, x0 : f32, x1 : f32, yScale : f32, yOff : f32, thick : f32) -> f32 {
  var d = 1e9;
  for (var k = 0; k < 63; k++) {
    let fa = f32(k) / 63.0;
    let fb = f32(k + 1) / 63.0;
    let a = vec2f(mix(x0, x1, fa), yOff + wav(k) * yScale);
    let b = vec2f(mix(x0, x1, fb), yOff + wav(k + 1) * yScale);
    let pa = q - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    d = min(d, length(pa - ba * h));
  }
  return smoothstep(thick, 0.0, d);
}

@group(1) @binding(0) var uSamp : sampler;
@group(1) @binding(1) var uImg : texture_2d<f32>;
// user image attached to the scene (1x1 white when none); aspect in U.xtra.z
fn img(uv : vec2f) -> vec4f { return textureSampleLevel(uImg, uSamp, uv, 0.0); }

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};
@vertex
fn vmain(@builtin(vertex_index) vi : u32) -> VOut {
  var out : VOut;
  let p = vec2f(f32(i32(vi & 1u) * 4 - 1), f32(i32(vi >> 1u) * 4 - 1));
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

fn makeCtx(uv : vec2f) -> Ctx {
  var c : Ctx;
  c.uv = uv;
  c.res = U.resTime.xy;
  c.q = (uv - vec2f(0.5)) * vec2f(c.res.x / c.res.y, 1.0);
  c.rawT = U.resTime.z;
  c.speed = U.parms.y;
  c.t = c.rawT * c.speed;
  c.bass = U.resTime.w;
  c.mid = U.bands.x; c.treble = U.bands.y; c.beat = U.bands.z; c.energy = U.bands.w;
  c.hue = U.parms.x; c.intensity = U.parms.z; c.fb = U.parms.w;
  return c;
}
`;

export const POST_COMMON = /* wgsl */ `
@group(1) @binding(2) var uTex : texture_2d<f32>;
@group(1) @binding(3) var uPrev : texture_2d<f32>;
@group(1) @binding(4) var uWarpMesh : texture_2d<f32>;
fn srcTex(uv : vec2f) -> vec3f { return textureSampleLevel(uTex, uSamp, uv, 0.0).rgb; }
fn prevTex(uv : vec2f) -> vec3f { return textureSampleLevel(uPrev, uSamp, uv, 0.0).rgb; }
// per-vertex warp displacement (MilkDrop per-pixel mesh), zero when unused
fn meshOff(uv : vec2f) -> vec2f { return textureSampleLevel(uWarpMesh, uSamp, uv, 0.0).rg; }
`;

const FRAG_ENTRY = /* wgsl */ `
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  let c = makeCtx(in.uv);
  return vec4f(render(c), 1.0);
}
`;

export const PRESENT_WGSL = COMMON + /* wgsl */ `
@group(1) @binding(2) var uTexB : texture_2d<f32>;
fn outA(uv : vec2f) -> vec3f { return textureSampleLevel(uImg, uSamp, uv, 0.0).rgb; }
fn outB(uv : vec2f) -> vec3f { return textureSampleLevel(uTexB, uSamp, uv, 0.0).rgb; }

@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  let p = U.xtra.x;          // transition progress 0..1
  let mode = i32(U.xtra.y);  // 0 cross, 1 liquid dissolve, 2 iris, 3 warp slide
  let q = in.uv - vec2f(0.5);
  var col : vec3f;
  if (p <= 0.0001) {
    col = outA(in.uv);
  } else if (p >= 0.9999) {
    col = outB(in.uv);
  } else if (mode == 1) {
    let n = fbm(in.uv * 5.0 + U.resTime.z * 0.1);
    let m = smoothstep(p + 0.12, p - 0.12, n);
    let warp = (n - 0.5) * 0.05 * sin(p * 3.1415);
    col = mix(outB(in.uv + warp), outA(in.uv - warp), m);
  } else if (mode == 2) {
    let r = length(q) * 1.35;
    let m = smoothstep(p + 0.03, p - 0.03, r); // B grows from center
    col = mix(outA(in.uv), outB(in.uv), m);
  } else if (mode == 3) {
    let wob = (fbm(vec2f(in.uv.y * 3.0, U.resTime.z * 0.3)) - 0.5) * 0.15 * sin(p * 3.1415);
    let x = in.uv.x + (1.0 - p) + wob;
    col = select(outB(vec2f(x - 1.0 + wob, in.uv.y)), outA(vec2f(in.uv.x + p * 0.3 + wob, in.uv.y)), x < 1.0);
  } else {
    col = mix(outA(in.uv), outB(in.uv), smoothstep(0.0, 1.0, p));
  }
  col *= 1.0 - dot(q, q) * 0.95;
  col = pow(col, vec3f(0.9));
  return vec4f(col, 1.0);
}
`;

/** Self-contained bloom modules (bright/downsample, blur H+V, composite). */
const BLOOM_HEAD = /* wgsl */ `
struct Uniforms {
  resTime : vec4f, bands : vec4f, parms : vec4f, xtra : vec4f,
  spec : array<vec4f, 16>, wave : array<vec4f, 16>, cust : array<vec4f, 12>,
};
@group(0) @binding(0) var<uniform> U : Uniforms;
@group(1) @binding(0) var uSamp : sampler;
@group(1) @binding(1) var uA : texture_2d<f32>;
struct VOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };
@vertex
fn vmain(@builtin(vertex_index) vi : u32) -> VOut {
  var out : VOut;
  let p = vec2f(f32(i32(vi & 1u) * 4 - 1), f32(i32(vi >> 1u) * 4 - 1));
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}
`;

export const BLOOM_BRIGHT_WGSL = BLOOM_HEAD + /* wgsl */ `
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  let c = textureSampleLevel(uA, uSamp, in.uv, 0.0).rgb;
  let bright = max(c - vec3f(0.6), vec3f(0.0));
  return vec4f(bright * U.xtra.w, 1.0);
}
`;

export const BLOOM_BLUR_WGSL = BLOOM_HEAD + /* wgsl */ `
fn blur(uv : vec2f, dir : vec2f) -> vec3f {
  let px = dir / max(U.resTime.xy * 0.5, vec2f(1.0));
  var s = textureSampleLevel(uA, uSamp, uv, 0.0).rgb * 0.227;
  s += textureSampleLevel(uA, uSamp, uv + px * 1.38, 0.0).rgb * 0.316;
  s += textureSampleLevel(uA, uSamp, uv - px * 1.38, 0.0).rgb * 0.316;
  s += textureSampleLevel(uA, uSamp, uv + px * 3.23, 0.0).rgb * 0.070;
  s += textureSampleLevel(uA, uSamp, uv - px * 3.23, 0.0).rgb * 0.070;
  return s;
}
@fragment
fn fmainH(in : VOut) -> @location(0) vec4f { return vec4f(blur(in.uv, vec2f(1.0, 0.0)), 1.0); }
@fragment
fn fmainV(in : VOut) -> @location(0) vec4f { return vec4f(blur(in.uv, vec2f(0.0, 1.0)), 1.0); }
`;

export const BLOOM_COMPOSITE_WGSL = BLOOM_HEAD + /* wgsl */ `
@group(1) @binding(2) var uB : texture_2d<f32>;
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  let base = textureSampleLevel(uA, uSamp, in.uv, 0.0).rgb;
  let glow = textureSampleLevel(uB, uSamp, in.uv, 0.0).rgb;
  return vec4f(base + glow, 1.0);
}
`;

export function customAccessors(params: CustomParam[]): string {
  return params
    .map((p) => `fn ${p.name}() -> f32 { return custSlot(${p.slot}); }`)
    .join("\n") + (params.length ? "\n" : "");
}

export interface AssembledShader {
  code: string;
  /** Number of lines preceding the user body (for diagnostic mapping). */
  bodyLineOffset: number;
}

export function assemble(stage: StageId, body: string, params: CustomParam[]): AssembledShader {
  const pre =
    COMMON +
    (stage === "post" ? POST_COMMON : "") +
    customAccessors(params);
  const bodyLineOffset = countLines(pre);
  const code = pre + body + "\n" + FRAG_ENTRY;
  return { code, bodyLineOffset };
}

export function countLines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}
