// The WGSL shaders for the warp-feedback + composite pipeline.
// Kept as strings so they can be validated headless AND used in-browser.
// The warp math is transcribed from MilkDrop2 @ Doormatty/MilkDrop2 d0670a3,
// milkdropfs.cpp:1877-1918 (per-vertex UV computation) with the per-frame
// oscillators f0..f3 and warpTime computed CPU-side per :1782-1787 and passed
// as uniforms. APPROXIMATION, stated: MilkDrop evaluates this formula at
// finite mesh vertices and linearly interpolates between them; we evaluate it
// per fragment. For a nonlinear field these are NOT equivalent at any mesh
// size — per-fragment smooths interpolation character that is part of the
// source's look. The finite-mesh path is mandated by the exactness standard
// ("the graph and executor must be extended when the source behavior requires
// it"); its trigger is the first warp-exercising content, per the falsifier
// rule in CLAUDE.md. The render targets follow the window per the source's
// DEFAULT texture mode (nTexSize -1 auto-exact: plugin.cpp:949, 1193-1196,
// 1851-1852; 16-block snap :1879-1880), so the aspect factors
// (plugin.cpp:2027-2028) and their apply/undo steps (:1881-1882, :1914-1916)
// are transcribed live rather than assumed identity.

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

export const feedbackWGSL = /* wgsl */`
struct Uniforms {
  decay: f32,
  ib_size: f32, ib_r: f32, ib_g: f32, ib_b: f32, ib_a: f32,
  ob_size: f32, ob_r: f32, ob_g: f32, ob_b: f32, ob_a: f32,
  zoom: f32, zoomexp: f32, rot: f32, warp: f32,
  cx: f32, cy: f32, dx: f32, dy: f32, sx: f32, sy: f32,
  warpTime: f32, warpScaleInv: f32,
  f0: f32, f1: f32, f2: f32, f3: f32,
  aspectX: f32, aspectY: f32, _pad0: f32, _pad1: f32, _pad2: f32,
};
@group(0) @binding(0) var prevTex: texture_2d<f32>;
@group(0) @binding(1) var prevSamp: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>,3>(vec2(-1.0,-3.0), vec2(-1.0,1.0), vec2(3.0,1.0));
  var o: VSOut;
  o.pos = vec4(p[i], 0.0, 1.0);
  o.uv = vec2(0.5*p[i].x+0.5, 0.5 - 0.5*p[i].y); // y-flip (milkdropfs.cpp:1882)
  return o;
}
@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
  // grid coordinates: x,y in [-1,1], y up (verts init; v = -y*0.5+0.5 per :1884)
  let xg = in.uv.x * 2.0 - 1.0;
  let yg = 1.0 - 2.0 * in.uv.y;
  let rad = sqrt(xg*xg*u.aspectX*u.aspectX + yg*yg*u.aspectY*u.aspectY); // plugin.cpp:2281
  // zoom with per-radius exponent — :1877
  let zoom2 = pow(u.zoom, pow(u.zoomexp, rad*2.0 - 1.0));
  let zoom2inv = 1.0 / zoom2;                          // :1880
  var uu =  xg * u.aspectX * 0.5 * zoom2inv + 0.5;     // :1881
  var vv = -yg * u.aspectY * 0.5 * zoom2inv + 0.5;     // :1882
  // stretch — :1890-1891
  uu = (uu - u.cx) / u.sx + u.cx;
  vv = (vv - u.cy) / u.sy + u.cy;
  // warping — :1896-1899 (constants transcribed, not simplified)
  uu += u.warp*0.0035*sin(u.warpTime*0.333 + u.warpScaleInv*(xg*u.f0 - yg*u.f3));
  vv += u.warp*0.0035*cos(u.warpTime*0.375 - u.warpScaleInv*(xg*u.f2 + yg*u.f1));
  uu += u.warp*0.0035*cos(u.warpTime*0.753 - u.warpScaleInv*(xg*u.f1 - yg*u.f2));
  vv += u.warp*0.0035*sin(u.warpTime*0.825 + u.warpScaleInv*(xg*u.f0 + yg*u.f3));
  // rotation about (cx,cy) — :1902-1908
  let u2 = uu - u.cx;
  let v2 = vv - u.cy;
  let cr = cos(u.rot);
  let sr = sin(u.rot);
  uu = u2*cr - v2*sr + u.cx;
  vv = u2*sr + v2*cr + u.cy;
  // translation — :1911-1912
  uu -= u.dx;
  vv -= u.dy;
  // undo aspect ratio fix — :1914-1916
  uu = (uu - 0.5) * (1.0 / u.aspectX) + 0.5;
  vv = (vv - 0.5) * (1.0 / u.aspectY) + 0.5;
  // final half-texel offset — :1918-1920
  let dims = vec2<f32>(textureDimensions(prevTex));
  uu += 0.5 / dims.x;
  vv += 0.5 / dims.y;
  // sample previous frame at the warped coordinate, apply decay (fDecay)
  var prev = textureSample(prevTex, prevSamp, vec2(uu, vv)).rgb * u.decay;
  // border frames — milkdropfs.cpp:3460. Screen edge is radius 1 in max-norm.
  let c = max(abs(in.uv.x - 0.5), abs(in.uv.y - 0.5)) * 2.0;  // 0 center .. 1 edge
  // each ring draws only when its alpha exceeds the source threshold
  // (if (a > 0.001f), milkdropfs.cpp:3451)
  if (u.ob_a > 0.001 && c >= 1.0 - u.ob_size && c <= 1.0) {
    prev = mix(prev, vec3(u.ob_r, u.ob_g, u.ob_b), u.ob_a);
  }
  if (u.ib_a > 0.001 && c >= 1.0 - u.ob_size - u.ib_size && c < 1.0 - u.ob_size) {
    prev = mix(prev, vec3(u.ib_r, u.ib_g, u.ib_b), u.ib_a);
  }
  return vec4(prev, 1.0);
}`;
