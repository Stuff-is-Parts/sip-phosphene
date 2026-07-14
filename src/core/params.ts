import type { AudioFeatures, BaseParams, CustomParam } from "./types";

/** Max custom params per stage (packed as array<vec4f,4> = 16 floats). */
export const MAX_CUSTOM = 16;

const PARAM_RE = /\/\/\s*@param\s+([A-Za-z_]\w*)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/g;

/** Parse `//@param name min max default` annotations; assign packed slots. */
export function parseParams(code: string): CustomParam[] {
  const out: CustomParam[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  PARAM_RE.lastIndex = 0;
  while ((m = PARAM_RE.exec(code)) && out.length < MAX_CUSTOM) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, min: +m[2], max: +m[3], def: +m[4], slot: out.length });
  }
  return out;
}

/**
 * Uniform buffer layout (matches the WGSL `Uniforms` struct exactly):
 *   resTime : vec4f  (res.x, res.y, time, bass)
 *   bands   : vec4f  (mid, treble, beat, energy)
 *   parms   : vec4f  (hue, speed, intensity, fb)
 *   spec    : array<vec4f,16>   (64 floats)
 *   wave    : array<vec4f,16>   (64 floats)
 *   cust    : array<vec4f,4>    (16 floats)
 * Total: (3 + 16 + 16 + 4) * 4 = 156 floats = 624 bytes.
 */
export const UNIFORM_FLOATS = 156;
export const UNIFORM_BYTES = UNIFORM_FLOATS * 4;

export interface EffectiveParams extends BaseParams {
  custom: Float32Array; // 16 slots
}

export function packUniforms(
  out: Float32Array,
  width: number,
  height: number,
  time: number,
  a: AudioFeatures,
  p: EffectiveParams,
): Float32Array {
  out[0] = width; out[1] = height; out[2] = time; out[3] = a.bass;
  out[4] = a.mid; out[5] = a.treble; out[6] = a.beat; out[7] = a.energy;
  out[8] = p.hue; out[9] = p.speed; out[10] = p.int; out[11] = p.fb;
  out.set(a.spec, 12);
  out.set(a.wave, 12 + 64);
  out.set(p.custom, 12 + 128);
  return out;
}

export const clamp = (v: number, a: number, b: number) =>
  Math.min(b, Math.max(a, v));
