// The WGSL shaders for the warp-feedback + composite pipeline.
// Kept as strings so they can be validated by naga (headless) AND used in-browser.
// This preset (101) has zoom/rot/warp = 0, so the warp pass is an identity
// sample of the feedback texture times decay, with the inner/outer boxes drawn.

export const feedbackWGSL = /* wgsl */`
struct Uniforms {
  decay: f32,
  ib_size: f32, ib_r: f32, ib_g: f32, ib_b: f32, ib_a: f32,
  ob_size: f32, ob_r: f32, ob_g: f32, ob_b: f32, ob_a: f32,
  _pad: f32,
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
  // sample previous frame, apply decay (feedback) — milkdrop fDecay
  var prev = textureSample(prevTex, prevSamp, in.uv).rgb * u.decay;
  // border frames — milkdropfs.cpp:3460. Screen edge is radius 1 in max-norm.
  // outer border: radius [1-ob_size, 1]; inner border: [1-ob_size-ib_size, 1-ob_size].
  let c = max(abs(in.uv.x - 0.5), abs(in.uv.y - 0.5)) * 2.0;  // 0 center .. 1 edge
  // outer border ring
  if (c >= 1.0 - u.ob_size && c <= 1.0) {
    prev = mix(prev, vec3(u.ob_r, u.ob_g, u.ob_b), u.ob_a);
  }
  // inner border ring (just inside the outer)
  if (c >= 1.0 - u.ob_size - u.ib_size && c < 1.0 - u.ob_size) {
    prev = mix(prev, vec3(u.ib_r, u.ib_g, u.ib_b), u.ib_a);
  }
  return vec4(prev, 1.0);
}`;
