/** Library expansion: 3D raymarched scenes, ported classics, richer posts. */

export const BG_STARFIELD = `// streaming starfield
fn render(c : Ctx) -> vec3f {
  var col = vec3f(0.0);
  for (var l = 0; l < 4; l++) {
    let fl = f32(l);
    let sp = (0.6 + fl * 0.5) * c.speed * (0.4 + c.mid * 1.6 + c.beat * 0.8);
    var p = c.q * (2.0 + fl * 2.5);
    p.y += c.rawT * sp;
    let cell = floor(p);
    let f = fract(p) - vec2f(0.5);
    let h = hash(cell + fl * 7.7);
    if (h > 0.93) {
      let off = vec2f(hash(cell + 1.3), hash(cell + 2.6)) - vec2f(0.5);
      let d = length(f - off * 0.6);
      let tw = 0.6 + 0.4 * sin(c.rawT * (3.0 + h * 8.0) + h * 40.0);
      col += pal(0.55 + h * 0.3) * smoothstep(0.09, 0.0, d) * tw * (0.35 + c.treble * 2.0) * (1.0 - fl * 0.18);
    }
  }
  col += pal(0.66) * fbm(c.q * 2.0 - c.rawT * 0.03) * 0.12 * (0.5 + c.bass);
  return col * c.intensity;
}`;

export const BG_MAGMA = `// ridged magma veins
fn render(c : Ctx) -> vec3f {
  let t = c.rawT * 0.08 * c.speed;
  let n = ridge(c.q * 2.2 + vec2f(t, -t * 0.6) + fbm(c.q * 3.0 + t) * 0.8);
  let veins = pow(clamp(n, 0.0, 1.0), 3.2 - c.bass * 1.4);
  var col = pal(0.02 + n * 0.12) * veins * (0.6 + c.bass * 1.8);
  col += pal(0.09) * pow(clamp(n, 0.0, 1.0), 8.0) * (1.0 + c.beat * 3.0);
  col += pal(0.55) * fbm(c.q * 1.2 - t) * 0.05;
  return col * c.intensity;
}`;

export const BG_CELLS = `// voronoi cells, spectrum-lit nuclei
fn render(c : Ctx) -> vec3f {
  var q = c.q * 3.2 + vec2f(c.rawT * 0.12 * c.speed, sin(c.rawT * 0.07) * 0.4);
  let i = floor(q);
  let f = fract(q);
  var F1 = 8.0;
  var id = vec2f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      var o = vec2f(hash(i + g), hash(i + g + 7.7));
      o = vec2f(0.5) + 0.4 * sin(c.rawT * c.speed * (vec2f(0.5) + o) + o * 6.28);
      let d = length(g + o - f);
      if (d < F1) { F1 = d; id = i + g; }
    }
  }
  let h = hash(id);
  let v = spec(i32(h * 63.0));
  var col = pal(0.3 + h * 0.4) * smoothstep(0.0, 0.9, F1) * (0.25 + v * 1.8);
  col += pal(0.5 + h * 0.3) * smoothstep(0.06, 0.0, F1) * (1.0 + c.beat * 2.0);
  col += pal(0.45) * smoothstep(0.12, 0.02, abs(F1 - 0.45)) * 0.35 * (0.4 + c.mid);
  return col * c.intensity;
}`;

export const BG_AURORA = `// aurora curtains
//@param bands 2.0 8.0 4.0
fn render(c : Ctx) -> vec3f {
  var col = vec3f(0.0);
  for (var k = 0; k < 8; k++) {
    let fk = f32(k);
    if (fk >= bands()) { break; }
    let t = c.rawT * c.speed * (0.15 + fk * 0.04);
    let x = c.q.x * (1.4 + fk * 0.3);
    let curtain = sin(x * 2.2 + t * 2.0 + fbm(vec2f(x * 1.5, t)) * 3.0) * 0.28
                + sin(x * 5.1 - t * 1.3) * 0.07 * (1.0 + c.mid * 2.0);
    let y = c.q.y - curtain + 0.12 - fk * 0.05;
    let fall = exp(-abs(y) * (7.0 - c.bass * 3.0)) * smoothstep(0.6, -0.4, y);
    col += pal(0.38 + fk * 0.06 + curtain * 0.15) * fall * (0.22 + c.energy * 0.9);
  }
  // ground stars
  let sp = c.q * 20.0;
  let cell = floor(sp);
  if (hash(cell) > 0.985) {
    col += vec3f(0.6) * smoothstep(0.07, 0.0, length(fract(sp) - vec2f(0.5))) * (0.3 + c.treble * 2.0);
  }
  return col * c.intensity;
}`;

export const BG_OBSIDIAN = `// 3D: neon corridor — raymarched emission
//@param glow 0.5 3.0 1.4
fn render(c : Ctx) -> vec3f {
  let ro = vec3f(sin(c.rawT * 0.3 * c.speed) * 0.4, cos(c.rawT * 0.23 * c.speed) * 0.3, c.rawT * c.speed * 2.0);
  let rd = camRay(c.q, ro, ro + vec3f(0.0, 0.0, 1.0));
  var col = vec3f(0.0);
  var t = 0.1;
  for (var k = 0; k < 48; k++) {
    let p = ro + rd * t;
    // repeating rings along z
    let seg = floor(p.z * 0.5);
    var lp = vec3f(p.x, p.y, (fract(p.z * 0.5) - 0.5) * 2.0);
    let a = seg * 0.4 + c.rawT * 0.2 * c.speed;
    let xy = rot2(a) * lp.xy;
    lp = vec3f(xy.x, xy.y, lp.z);
    let ring = sdTorus(lp.xzy, vec2f(1.0 + spec(i32(abs(seg) % 64.0)) * 0.4, 0.03 + c.beat * 0.02));
    let bar = sdBox(lp - vec3f(0.0, -1.3, 0.0), vec3f(0.05, 0.05, 0.9));
    let d = min(ring, bar);
    // emission accumulation — neon look, forgiving of step count
    let e = glow() * 0.0018 / (0.002 + d * d);
    col += pal(0.5 + seg * 0.05) * e * (0.4 + c.bass * 1.2);
    t += max(d * 0.7, 0.02);
    if (t > 22.0) { break; }
  }
  return col * 0.05 * c.intensity;
}`;

export const BG_QUICKSILVER = `// 3D: metaballs — raymarched, lit, spectrum-sized
//@param blend 0.2 0.9 0.5
fn render(c : Ctx) -> vec3f {
  let ro = vec3f(0.0, 0.0, -3.2);
  let rd = camRay(c.q, ro, vec3f(0.0));
  var t = 0.0;
  var hit = false;
  var p = vec3f(0.0);
  for (var k = 0; k < 56; k++) {
    p = ro + rd * t;
    var d = 1e4;
    for (var i = 0; i < 5; i++) {
      let fi = f32(i);
      let h = hash(vec2f(fi, 3.7));
      let r = 0.35 + spec(i32(fi * 12.0)) * 0.5 + c.beat * 0.05;
      let ctr = vec3f(
        sin(c.rawT * c.speed * (0.5 + h) + fi * 2.1) * 1.1,
        cos(c.rawT * c.speed * (0.4 + h * 0.6) + fi * 1.3) * 0.8,
        sin(c.rawT * c.speed * 0.3 + fi * 2.6) * 0.7);
      d = smin(d, sdSphere(p - ctr, r), blend());
    }
    if (d < 0.002) { hit = true; break; }
    t += d;
    if (t > 9.0) { break; }
  }
  if (!hit) {
    // dim fbm backdrop
    return pal(0.62) * fbm(c.q * 2.0 + c.rawT * 0.05) * 0.10 * c.intensity;
  }
  // normal via central differences on the same field
  var n = vec3f(0.0);
  let e = 0.01;
  for (var ax = 0; ax < 3; ax++) {
    var o = vec3f(0.0);
    if (ax == 0) { o.x = e; } else if (ax == 1) { o.y = e; } else { o.z = e; }
    var dp = 1e4; var dm = 1e4;
    for (var i = 0; i < 5; i++) {
      let fi = f32(i);
      let h = hash(vec2f(fi, 3.7));
      let r = 0.35 + spec(i32(fi * 12.0)) * 0.5 + c.beat * 0.05;
      let ctr = vec3f(
        sin(c.rawT * c.speed * (0.5 + h) + fi * 2.1) * 1.1,
        cos(c.rawT * c.speed * (0.4 + h * 0.6) + fi * 1.3) * 0.8,
        sin(c.rawT * c.speed * 0.3 + fi * 2.6) * 0.7);
      dp = smin(dp, sdSphere(p + o - ctr, r), blend());
      dm = smin(dm, sdSphere(p - o - ctr, r), blend());
    }
    if (ax == 0) { n.x = dp - dm; } else if (ax == 1) { n.y = dp - dm; } else { n.z = dp - dm; }
  }
  n = normalize(n);
  let l1 = normalize(vec3f(0.6, 0.8, -0.4));
  let l2 = normalize(vec3f(-0.7, -0.2, -0.6));
  let dif = max(dot(n, l1), 0.0) * (0.7 + c.bass * 0.8);
  let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  var col = pal(0.55 + n.y * 0.2) * dif;
  col += pal(0.85) * max(dot(n, l2), 0.0) * 0.35;
  col += pal(0.45) * rim * (1.0 + c.beat * 2.0);
  return col * c.intensity;
}`;

/* ------------------------------ foregrounds --------------------------- */

export const FG_WEAVE = `// waveform weave
fn render(c : Ctx) -> vec3f {
  var col = vec3f(0.0);
  for (var k = 0; k < 5; k++) {
    let fk = f32(k);
    let bin = i32(clamp((c.q.x * 0.5 + 0.5) * 63.0, 0.0, 63.0));
    let w = wav(bin);
    let amp = spec(i32(6.0 + fk * 11.0));
    var y = w * (0.25 + fk * 0.05)
          + sin(c.q.x * (3.0 + fk * 1.7) + c.rawT * c.speed * (1.0 + fk * 0.4) + fk * 2.1) * (0.05 + amp * 0.2);
    y += (fk - 2.0) * 0.13;
    let line = smoothstep(0.013 + amp * 0.01, 0.0, abs(c.q.y - y));
    col += pal(0.35 + fk * 0.13 + c.rawT * 0.015) * line * (0.6 + amp * 2.2);
  }
  return col * (0.5 + c.mid * 1.3 + c.beat * 0.6) * c.intensity;
}`;

export const FG_SCOPE = `// lissajous scope traced from waveform pairs
fn render(c : Ctx) -> vec3f {
  var best = 9.0;
  for (var k = 0; k < 48; k++) {
    let fk = f32(k) / 48.0;
    let i = i32(fk * 63.0);
    let j = i32((fk * 63.0 + 16.0) % 63.0);
    var p = vec2f(wav(i), wav(j)) * 1.4
          + vec2f(cos(fk * 6.2831 + c.rawT * c.speed), sin(fk * 12.566 + c.rawT * c.speed * 0.7)) * 0.12;
    best = min(best, length(c.q - p * 0.55));
  }
  var col = pal(0.42 + c.rawT * 0.02) * smoothstep(0.05, 0.0, best) * (0.8 + c.energy * 1.5);
  col += pal(0.55) * smoothstep(0.014, 0.0, best) * 2.0;
  return col * c.intensity;
}`;

export const FG_BURST = `// beat-triggered radial starburst
fn render(c : Ctx) -> vec3f {
  let a = atan2(c.q.y, c.q.x);
  let r = length(c.q);
  var col = vec3f(0.0);
  for (var k = 0; k < 24; k++) {
    let fk = f32(k);
    let h = hash(vec2f(fk, floor(c.rawT * 0.5)));
    let ang = h * 6.2831 + c.rawT * 0.1 * c.speed;
    let d = abs(sin(a - ang)) * r;
    let len = c.beat * (0.3 + h * 0.5) + c.bass * 0.15;
    let ray = smoothstep(0.006 + h * 0.004, 0.0, d) * smoothstep(len, len * 0.2, r) * step(0.03, r);
    col += pal(0.1 + h * 0.5) * ray * (1.5 + c.beat * 2.0);
  }
  col += pal(0.15) * exp(-r * 14.0) * c.beat * 3.0;
  return col * c.intensity;
}`;

export const FG_COMETS = `// orbiting comets — heads here, tails via post feedback
//@param count 2.0 10.0 6.0
fn render(c : Ctx) -> vec3f {
  var col = vec3f(0.0);
  for (var k = 0; k < 10; k++) {
    let fk = f32(k);
    if (fk >= count()) { break; }
    let h = hash(vec2f(fk * 5.3, 1.1));
    var band = c.treble;
    if (fk < 3.0) { band = c.bass; } else if (fk < 6.0) { band = c.mid; }
    let r1 = 0.15 + h * 0.3;
    let r2 = r1 * (0.5 + hash(vec2f(fk, 9.0)) * 0.8);
    let w1 = (0.7 + h) * c.speed * select(1.0, -1.0, h > 0.5);
    let p = vec2f(cos(c.rawT * w1 + h * 40.0) * r1, sin(c.rawT * w1 * 1.31 + h * 20.0) * r2);
    let d = length(c.q - p);
    let s = 0.008 + band * 0.03 + c.beat * 0.008;
    col += pal(fk * 0.09 + c.rawT * 0.03) * (s * s) / (d * d + s * s * 0.4) * (0.4 + band * 1.6);
  }
  return col * 0.7 * c.intensity;
}`;

/* --------------------------------- posts ------------------------------ */

export const POST_CRT = `// CRT: barrel, mosaic, scanlines
fn render(c : Ctx) -> vec3f {
  let q = c.uv - vec2f(0.5);
  let cq = q * (1.0 + dot(q, q) * 0.22) + vec2f(0.5);
  if (cq.x < 0.0 || cq.x > 1.0 || cq.y < 0.0 || cq.y > 1.0) { return vec3f(0.0); }
  let px = vec2f(200.0, 120.0);
  let m = (floor(cq * px) + vec2f(0.5)) / px;
  var col = srcTex(mix(cq, m, 0.55));
  col *= 0.8 + 0.2 * sin(cq.y * c.res.y * 1.6);
  col = max(col, prevTex(cq) * c.fb);
  return col * 1.1;
}`;

export const POST_DRIFT = `// fbm-displaced drift
fn render(c : Ctx) -> vec3f {
  let t = c.rawT * c.speed;
  let q = c.uv + vec2f(fbm(c.uv * 3.0 + t * 0.3) - 0.5, fbm(c.uv * 3.0 - t * 0.25) - 0.5)
              * (0.02 + c.bass * 0.05 + c.beat * 0.03);
  var col = srcTex(q);
  col = max(col, prevTex(q + vec2f(0.0, 0.002)) * c.fb);
  return col;
}`;

export const POST_RADIAL = `// radial blur streaks from center — bass/beat driven
//@param streak 0.0 0.2 0.07
fn render(c : Ctx) -> vec3f {
  let q = c.uv - vec2f(0.5);
  var col = vec3f(0.0);
  let amt = streak() * (0.4 + c.bass * 1.2 + c.beat * 1.5);
  for (var k = 0; k < 10; k++) {
    let s = 1.0 - amt * f32(k) / 10.0;
    col += srcTex(q * s + vec2f(0.5)) * (1.0 - f32(k) * 0.08);
  }
  col *= 0.14;
  col = max(col, prevTex(c.uv) * c.fb);
  return col;
}`;

export const POST_LIQUID = `// liquid warp feedback — the MilkDrop move: warp PREV, not just src
//@param churn 0.0 0.08 0.03
fn render(c : Ctx) -> vec3f {
  let t = c.rawT * c.speed * 0.4;
  let w = vec2f(
    fbm(c.uv * 4.0 + vec2f(t, 0.0)) - 0.5,
    fbm(c.uv * 4.0 + vec2f(0.0, t)) - 0.5) * (churn() * (1.0 + c.bass * 2.0 + c.beat));
  // slight zoom keeps the fluid flowing outward
  let q = (c.uv - vec2f(0.5)) * (1.0 - 0.006 - c.beat * 0.006) + vec2f(0.5);
  var col = srcTex(c.uv);
  col = max(col, prevTex(q + w) * max(c.fb, 0.72) * 0.985);
  return col;
}`;
