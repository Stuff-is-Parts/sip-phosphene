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
  spec    : array<vec4f, 16>, // 64-bin log spectrum, 0..1
  wave    : array<vec4f, 16>, // 64-sample waveform, -1..1
  cust    : array<vec4f, 4>,  // custom //@param slots
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
  let j = clamp(i, 0, 15);
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
@group(1) @binding(0) var uSamp : sampler;
@group(1) @binding(1) var uTex : texture_2d<f32>;
@group(1) @binding(2) var uPrev : texture_2d<f32>;
fn srcTex(uv : vec2f) -> vec3f { return textureSampleLevel(uTex, uSamp, uv, 0.0).rgb; }
fn prevTex(uv : vec2f) -> vec3f { return textureSampleLevel(uPrev, uSamp, uv, 0.0).rgb; }
`;

const FRAG_ENTRY = /* wgsl */ `
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  let c = makeCtx(in.uv);
  return vec4f(render(c), 1.0);
}
`;

export const PRESENT_WGSL = COMMON + POST_COMMON + /* wgsl */ `
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  var col = srcTex(in.uv);
  let q = in.uv - vec2f(0.5);
  col *= 1.0 - dot(q, q) * 0.95;
  col = pow(col, vec3f(0.9));
  return vec4f(col, 1.0);
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
