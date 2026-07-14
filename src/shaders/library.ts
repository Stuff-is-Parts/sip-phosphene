import { defaultParams, type Scene } from "../core/types";

/** Stage bodies implement `fn render(c: Ctx) -> vec3f`. */

export const BG_NEBULA = `// nebula — layered fbm plasma
//@param scale 0.5 5.0 2.4
fn render(c : Ctx) -> vec3f {
  let t = c.rawT * 0.05 * c.speed;
  let w = c.q * scale() + vec2f(fbm(c.q * 1.8 + t), fbm(c.q * 1.8 - t)) * 1.6;
  let n = fbm(w + fbm(w * 1.7 + t) * 1.2);
  let glow = pow(n, 2.4 - c.bass * 1.1);
  var col = pal(0.62 + n * 0.25 + c.rawT * 0.008) * glow * (0.65 + c.bass * 1.4);
  col += pal(0.9 + n * 0.2) * pow(fbm(c.q * 5.0 + t * 2.0), 5.0) * c.treble * 2.2;
  col *= smoothstep(1.5, 0.35, length(c.q));
  return col * c.intensity;
}`;

export const BG_TUNNEL = `// warp tunnel
//@param rings 2.0 10.0 4.0
fn render(c : Ctx) -> vec3f {
  let a = atan2(c.q.y, c.q.x);
  let r = length(c.q) + 1e-4;
  let z = 0.35 / r + c.rawT * c.speed * (1.2 + c.mid * 2.5);
  let seg = floor(z * rings());
  let ring = smoothstep(0.42, 0.0, abs(fract(z * rings()) - 0.5)) * (0.4 + 0.6 * hash(vec2f(seg, 0.0)));
  let spokes = smoothstep(0.35, 0.0, abs(fract(a / 6.2831 * 12.0 + z * 0.3) - 0.5)) * 0.5;
  var col = pal(0.5 + seg * 0.03 + c.beat * 0.15) * (ring + spokes);
  col *= smoothstep(0.02, 0.15, r) * (0.5 + c.bass * 1.6 + c.beat * 1.2) * exp(-r * 1.1);
  return col * c.intensity;
}`;

export const BG_GRID = `// synthwave horizon
fn render(c : Ctx) -> vec3f {
  var col = vec3f(0.0);
  let hor = -0.06;
  if (c.q.y < hor) {
    let pz = 1.0 / (hor - c.q.y);
    let g = vec2f(c.q.x * pz * 2.0, pz * 1.4 + c.rawT * c.speed * 2.0);
    let f = abs(fract(g) - vec2f(0.5));
    let line = smoothstep(0.47, 0.5, max(f.x, f.y));
    let fade = exp(-(pz - 1.0) * 0.25);
    col += pal(0.85) * line * fade * (0.7 + c.bass * 1.6 + c.beat);
    col += pal(0.6) * fade * 0.06;
  } else {
    let s = c.q - vec2f(0.0, 0.18);
    let r = length(s);
    let disc = smoothstep(0.26, 0.25, r) * step(fract((s.y + c.rawT * 0.02) * 24.0), 0.72);
    col += pal(0.02 + s.y * 0.5) * disc * (0.5 + spec(i32(abs(s.y) * 60.0)) * 2.0);
    col += pal(0.08) * exp(-r * 5.0) * (0.4 + c.bass);
    let sp = c.q * 14.0;
    let cell = floor(sp);
    if (hash(cell) > 0.97) {
      col += vec3f(0.5) * smoothstep(0.08, 0.0, length(fract(sp) - vec2f(0.5))) * c.treble * 2.0;
    }
  }
  return col * c.intensity;
}`;

export const FG_RING = `// spectrum ring
//@param radius 0.1 0.45 0.26
fn render(c : Ctx) -> vec3f {
  let a = atan2(c.q.y, c.q.x);
  let r = length(c.q);
  let fi = (a / 6.2831 + 0.5) * 64.0;
  let i = i32(fi);
  let v = mix(spec(i), spec(i + 1), fract(fi));
  let base = radius() + c.beat * 0.03;
  let bar = base + v * 0.22;
  let inR = step(r, bar) * step(base - 0.012, r);
  let edge = smoothstep(0.006, 0.0, abs(r - bar));
  var col = pal(0.45 + v * 0.5 + c.rawT * 0.02) * (inR * 0.7 + edge * 1.6);
  col += pal(0.5) * smoothstep(0.004, 0.0, abs(r - base)) * 0.8;
  return col * (0.6 + c.energy * 1.2) * c.intensity;
}`;

export const FG_ORBS = `// orbiting glow orbs
fn render(c : Ctx) -> vec3f {
  var col = vec3f(0.0);
  for (var k = 0; k < 14; k++) {
    let fk = f32(k);
    let h = hash(vec2f(fk * 3.1, 7.7));
    var band = c.treble;
    if (fk < 5.0) { band = c.bass; } else if (fk < 10.0) { band = c.mid; }
    let rad = 0.12 + h * 0.34 + c.beat * 0.03;
    let sp = ((h - 0.5) * 2.2 + 0.4) * c.speed;
    let ctr = vec2f(cos(c.rawT * sp + h * 40.0), sin(c.rawT * sp * 0.8 + h * 20.0)) * rad;
    let d = length(c.q - ctr);
    let s = 0.015 + band * 0.05;
    col += pal(fk * 0.07 + c.rawT * 0.02) * (s * s) / (d * d + s * s * 0.5) * (0.25 + band * 1.4);
  }
  return col * 0.6 * c.intensity;
}`;

export const FG_BARS = `// classic mirrored bars
fn render(c : Ctx) -> vec3f {
  let fi = c.uv.x * 64.0;
  let i = i32(fi);
  let v = mix(spec(i), spec(i + 1), fract(fi)) * 0.85;
  let gap = smoothstep(0.0, 0.06, fract(fi)) * smoothstep(1.0, 0.94, fract(fi));
  let y = 1.0 - c.uv.y; // screen-up
  let up = step(y, 0.5 + v * 0.5) * step(0.5, y);
  let dn = step(0.5 - v * 0.5, y) * step(y, 0.5);
  let cap = smoothstep(0.008, 0.0, abs(y - (0.5 + v * 0.5))) * gap;
  var col = pal(0.3 + v * 0.6 + c.uv.x * 0.2) * (up + dn * 0.45) * gap * 0.8;
  col += pal(0.5 + v * 0.4) * cap * 2.0;
  return col * (0.5 + c.energy) * c.intensity;
}`;

export const POST_CLEAN = `// pass-through + trails
fn render(c : Ctx) -> vec3f {
  var col = srcTex(c.uv);
  col = max(col, prevTex(c.uv) * c.fb);
  return col;
}`;

export const POST_CHROMA = `// chromatic aberration + bloom + trails
fn render(c : Ctx) -> vec3f {
  let q = c.uv - vec2f(0.5);
  let ab = (0.003 + c.beat * 0.012) * (1.0 + dot(q, q) * 3.0);
  var col = vec3f(
    srcTex(c.uv + q * ab).r,
    srcTex(c.uv).g,
    srcTex(c.uv - q * ab).b);
  var bloom = vec3f(0.0);
  for (var i = 0; i < 8; i++) {
    let fi = f32(i);
    let o = vec2f(cos(fi * 0.785), sin(fi * 0.785)) * (0.008 + c.bass * 0.008);
    bloom += srcTex(c.uv + o);
  }
  col += bloom * 0.09 * (0.6 + c.bass);
  col = max(col, prevTex(c.uv) * c.fb);
  return col;
}`;

export const POST_ECHO = `// zoom-rotate echo trails
//@param rot -0.03 0.03 0.004
fn render(c : Ctx) -> vec3f {
  let q = c.uv - vec2f(0.5);
  let zoom = 1.0 - (0.012 + c.bass * 0.02);
  let rr = rot() + c.beat * 0.01;
  let rp = vec2f(q.x * cos(rr) - q.y * sin(rr), q.x * sin(rr) + q.y * cos(rr)) * zoom + vec2f(0.5);
  let prev = prevTex(rp) * 0.985;
  var col = srcTex(c.uv);
  col = max(col, prev * max(c.fb, 0.5));
  return col;
}`;

export const POST_KALEIDO = `// kaleidoscope
//@param segments 3.0 12.0 6.0
fn render(c : Ctx) -> vec3f {
  let q = c.uv - vec2f(0.5);
  var a = atan2(q.y, q.x);
  let r = length(q);
  let seg = 6.2831 / segments();
  a = a - seg * floor(a / seg);
  a = abs(a - seg * 0.5);
  a += c.rawT * 0.05 * c.speed + c.beat * 0.1;
  let k = vec2f(cos(a), sin(a)) * r + vec2f(0.5);
  var col = srcTex(k);
  col = max(col, prevTex(c.uv) * c.fb);
  return col;
}`;

export const TEMPLATE_BLANK = `// New shader. Contract: fn render(c: Ctx) -> vec3f
// Ctx fields: uv (0..1), q (aspect-corrected centered), t (speed-scaled time),
//   rawT, bass, mid, treble, beat (decaying pulse), energy, hue, speed, intensity
// Helpers: spec(i)/wav(i) 0..63, pal(t) palette, hash/noise/fbm/ridge(vec2f)
// POST stages additionally: srcTex(uv), prevTex(uv), c.fb (trail amount)
// Declare sliders: //@param name min max default  — then read as name()
//@param amount 0.0 2.0 1.0
fn render(c : Ctx) -> vec3f {
  let col = pal(0.5) * amount() * c.bass * smoothstep(0.5, 0.0, length(c.q));
  return col * c.intensity;
}`;

export function builtinScenes(): Scene[] {
  const mk = (name: string, bg: string, fg: string, post: string, over: Partial<Scene> = {}): Scene => ({
    version: 3,
    name,
    layers: { bg: { code: bg }, fg: { code: fg }, post: { code: post } },
    params: defaultParams(),
    custom: {},
    mods: [],
    thumb: null,
    ...over,
  });
  return [
    mk("DEEP FIELD", BG_NEBULA, FG_RING, POST_CLEAN, {
      mods: [{ target: "hue", source: "energy", gain: 0.15, base: 0 }],
    }),
    mk("EVENT HORIZON", BG_TUNNEL, FG_ORBS, POST_ECHO, {
      params: { hue: 0.05, speed: 1.1, int: 1, fb: 0.7 },
    }),
    mk("NEON MERIDIAN", BG_GRID, FG_BARS, POST_CHROMA, {
      params: { hue: 0.9, speed: 1.2, int: 1.2, fb: 0.2 },
      mods: [{ target: "int", source: "beat", gain: 0.4, base: 0 }],
    }),
    mk("CATHEDRAL", BG_NEBULA, FG_ORBS, POST_KALEIDO, {
      params: { hue: 0.15, speed: 0.8, int: 1.1, fb: 0.45 },
    }),
  ];
}
