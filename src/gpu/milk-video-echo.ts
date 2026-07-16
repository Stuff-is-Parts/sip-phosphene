/**
 * PHOSPHENE port of projectM's VideoEcho draw at
 * docs/evidence/projectm/VideoEcho.cpp (pinned SHA
 * 2f244141320f6b97b09bf99964cc72a4efdfcfd3). Direct source-defined
 * geometry, shade math, orientation UVs, gamma redraw planning, and
 * persistent hueRandomOffsets seeding — no Butterchurn substitute.
 *
 * VideoEcho draws a 4-vertex triangle strip textured with the previous
 * frame's y-flipped image, tinted by four per-corner shade colors that
 * animate through projectM's persistent hue offsets. When
 * videoEchoAlpha > 0.001, projectM runs a two-pass echo (first
 * overwrite, then additive echo at videoEchoZoom); otherwise it runs a
 * gamma-adjustment path that overwrites once and additively redraws
 * for each integer of gammaAdj plus a final fractional pass.
 */

import { type MilkRng } from "../core/milk-runner";

/** Vertex + fragment WGSL for the projectM textured draw path used by
 *  VideoEcho. Multiplies textureSample by per-vertex color. */
export const VIDEO_ECHO_WGSL = /* wgsl */ `
struct U { transform : mat4x4f };
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex  : texture_2d<f32>;
struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) col : vec4f,
  @location(1) uv  : vec2f,
};
@vertex
fn vmain(@location(0) aPos : vec2f, @location(1) aCol : vec4f, @location(2) aUv : vec2f) -> VOut {
  var o : VOut;
  o.pos = u.transform * vec4f(aPos, 0.0, 1.0);
  o.col = aCol;
  o.uv  = aUv;
  return o;
}
@fragment
fn fmain(in : VOut) -> @location(0) vec4f {
  return textureSample(tex, samp, in.uv) * in.col;
}
`;

/** Column-major 4x4 matrix equivalent of `glm::ortho(-1, 1, 1, -1, -40, 40)`
 *  used by projectM's `PresetState::orthogonalProjection`. Maps world
 *  (x, y) to NDC (x, -y) because bottom (1) is greater than top (-1),
 *  which inverts the y axis at rasterization. */
export function orthogonalProjection(): Float32Array<ArrayBuffer> {
  const nearZ = -40, farZ = 40;
  const zScale = -2 / (farZ - nearZ);
  const zTrans = -(farZ + nearZ) / (farZ - nearZ);
  const out = new Float32Array(new ArrayBuffer(16 * 4));
  out.set([
    1, 0, 0, 0,
    0, -1, 0, 0,
    0, 0, zScale, 0,
    0, 0, zTrans, 1,
  ]);
  return out;
}

/** Four vertex positions for the projectM VideoEcho triangle-strip,
 *  with viewport overscan of (1 + 1/width, 1 + 1/height) and aspect
 *  multipliers derived from the source formula
 *  aspect = width / (height * invAspectY). */
export function computeEchoPositions(
  width: number, height: number, invAspectY: number,
): [number, number][] {
  const aspect = width / (height * invAspectY);
  const aspectMultX = aspect > 1 ? 1 : 1 / aspect;
  const aspectMultY = aspect > 1 ? aspect : 1;
  const fOnePlusInvWidth = 1 + 1 / width;
  const fOnePlusInvHeight = 1 + 1 / height;
  return [
    [-fOnePlusInvWidth * aspectMultX,  fOnePlusInvHeight * aspectMultY],
    [ fOnePlusInvWidth * aspectMultX,  fOnePlusInvHeight * aspectMultY],
    [-fOnePlusInvWidth * aspectMultX, -fOnePlusInvHeight * aspectMultY],
    [ fOnePlusInvWidth * aspectMultX, -fOnePlusInvHeight * aspectMultY],
  ];
}

/** Projectm VideoEcho per-corner shade calculation. For each corner i
 *  in 0..3, projectM computes r/g/b from three time-driven sines,
 *  normalizes by the channel maximum, then blends with 0.5 to soften.
 *  Returns four vec3 shade values. */
export function computeShades(
  time: number, hueRandomOffsets: readonly number[],
): [number, number, number][] {
  const shades: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const idx = i;
    let r = 0.6 + 0.3 * Math.sin(time * 30.0 * 0.0143 + 3 + idx * 21 + hueRandomOffsets[3]);
    let g = 0.6 + 0.3 * Math.sin(time * 30.0 * 0.0107 + 1 + idx * 13 + hueRandomOffsets[1]);
    let b = 0.6 + 0.3 * Math.sin(time * 30.0 * 0.0129 + 6 + idx * 9  + hueRandomOffsets[2]);
    const max = Math.max(r, Math.max(g, b));
    r = 0.5 + 0.5 * (r / max);
    g = 0.5 + 0.5 * (g / max);
    b = 0.5 + 0.5 * (b / max);
    shades.push([r, g, b]);
  }
  return shades;
}

/** Persistent hueRandomOffsets seeded per projectM's
 *  PresetState constructor. Each offset draws once from the RNG,
 *  takes modulo of a projectM constant, and scales by 0.01. Values
 *  hold for the entire preset lifetime; MilkPipeline calls this at
 *  load and never again. */
const HUE_TABLES = [64841, 53751, 42661, 31571] as const;
export function computeHueRandomOffsets(
  rng: MilkRng,
): [number, number, number, number] {
  const draw = (): number => Math.floor(rng.next() * 0x80000000);
  return [
    (draw() % HUE_TABLES[0]) * 0.01,
    (draw() % HUE_TABLES[1]) * 0.01,
    (draw() % HUE_TABLES[2]) * 0.01,
    (draw() % HUE_TABLES[3]) * 0.01,
  ];
}

/** UV corners for one echo pass. `pass` 0 returns the base zoom UVs at
 *  zoom = 1; `pass` 1 returns UVs at `videoEchoZoom` with the
 *  orientation flip applied. Vertex order matches projectM's mesh:
 *  {top-left, top-right, bottom-left, bottom-right}. */
export function computeEchoUvs(
  pass: 0 | 1, videoEchoZoom: number, videoEchoOrientation: number,
): [number, number][] {
  const zoom = pass === 0 ? 1 : videoEchoZoom;
  const tempLow = 0.5 - 0.5 / zoom;
  const tempHigh = 0.5 + 0.5 / zoom;
  const base: [number, number][] = [
    [tempLow, tempLow],
    [tempHigh, tempLow],
    [tempLow, tempHigh],
    [tempHigh, tempHigh],
  ];
  if (pass === 0) return base;
  const orient = ((videoEchoOrientation % 4) + 4) % 4;
  const flipHoriz = orient % 2 === 1;
  const flipVert = orient >= 2;
  return base.map(([u, v]) => [
    flipHoriz ? 1 - u : u,
    flipVert ? 1 - v : v,
  ]);
}

/** Straight identity UVs for the gamma-adjustment path — projectM's
 *  DrawGammaAdjustment initial UV set. */
export function computeGammaAdjustmentUvs(): [number, number][] {
  return [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
}

/** One VideoEcho draw plan. */
export interface EchoDraw {
  /** Blend function selector: "overwrite" is (One, Zero); "additive" is
   *  (One, One). Maps to two source blend transitions. */
  blend: "overwrite" | "additive";
  /** Vertex UVs in the projectM {top-left, top-right, bottom-left,
   *  bottom-right} order. */
  uvs: [number, number][];
  /** Vertex colors — projectM's `mix * shade[vertex]` per RGB, alpha 1. */
  colors: [number, number, number, number][];
  /** Trace label so MilkPipeline can push a stage per draw. */
  label: string;
}

/** Plan the echo-active two-pass lifecycle including gamma redraws.
 *  Matches projectM `VideoEcho::DrawVideoEcho` exactly. */
export function planEchoActiveDraws(
  gammaAdj: number,
  videoEchoAlpha: number,
  videoEchoZoom: number,
  videoEchoOrientation: number,
  shades: readonly (readonly [number, number, number])[],
): EchoDraw[] {
  const draws: EchoDraw[] = [];
  for (let pass = 0 as 0 | 1; pass < 2; pass = (pass + 1) as 0 | 1) {
    const uvs = computeEchoUvs(pass, videoEchoZoom, videoEchoOrientation);
    const mix = pass === 1 ? videoEchoAlpha : 1 - videoEchoAlpha;
    // First draw of each pass: pass 0 starts overwrite, pass 1 additive.
    // After pass 0's first draw, blend flips to additive for redraws.
    const firstBlend: "overwrite" | "additive" = pass === 0 ? "overwrite" : "additive";
    draws.push({
      blend: firstBlend,
      uvs,
      colors: shades.map((s) => [mix * s[0], mix * s[1], mix * s[2], 1]),
      label: `video-echo-pass-${pass}`,
    });
    if (gammaAdj > 0.001) {
      const redrawCount = Math.floor(gammaAdj - 0.0001);
      for (let redraw = 0; redraw < redrawCount; redraw++) {
        const isFinal = redraw === redrawCount - 1;
        const gamma = isFinal ? gammaAdj - Math.floor(gammaAdj - 0.0001) : 1;
        draws.push({
          blend: "additive",
          uvs,
          colors: shades.map((s) => [gamma * mix * s[0], gamma * mix * s[1], gamma * mix * s[2], 1]),
          label: `video-echo-pass-${pass}-gamma-${redraw}`,
        });
      }
    }
  }
  return draws;
}

/** Plan the echo-inactive gamma-adjustment lifecycle. Matches
 *  projectM `VideoEcho::DrawGammaAdjustment` exactly: the first draw
 *  overwrites, then each additional redraw is additive; the final
 *  redraw uses the fractional gamma remainder. */
export function planEchoInactiveDraws(
  gammaAdj: number,
  shades: readonly (readonly [number, number, number])[],
): EchoDraw[] {
  const uvs = computeGammaAdjustmentUvs();
  const redrawCount = Math.floor(gammaAdj - 0.0001) + 1;
  const draws: EchoDraw[] = [];
  for (let redraw = 0; redraw < redrawCount; redraw++) {
    const isFinal = redraw === redrawCount - 1;
    const gamma = isFinal ? gammaAdj - redraw : 1;
    draws.push({
      blend: redraw === 0 ? "overwrite" : "additive",
      uvs,
      colors: shades.map((s) => [gamma * s[0], gamma * s[1], gamma * s[2], 1]),
      label: `gamma-adjustment-${redraw}`,
    });
  }
  return draws;
}
