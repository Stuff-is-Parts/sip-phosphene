import type { AudioFeatures, BaseParams, CustomParam } from "./types";

/** Max custom params per stage (packed as array<vec4f,12> = 48 floats). */
export const MAX_CUSTOM = 48;

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
 *   xtra    : vec4f  (transition progress, transition mode, image aspect, reserved)
 *   spec    : array<vec4f,16>   (64 floats)
 *   wave    : array<vec4f,16>   (64 floats)
 *   cust    : array<vec4f,12>   (48 floats)
 * Total: (4 + 16 + 16 + 12) * 4 = 192 floats = 768 bytes.
 */
export const UNIFORM_FLOATS = 192;
export const UNIFORM_BYTES = UNIFORM_FLOATS * 4;

export interface EffectiveParams extends BaseParams {
  custom: Float32Array; // MAX_CUSTOM slots
  /** Built-in bloom strength 0..1; packed into xtra.w for the bright pass. */
  bloom?: number;
}

export function packUniforms(
  out: Float32Array,
  width: number,
  height: number,
  time: number,
  a: AudioFeatures,
  p: EffectiveParams,
  xtra0 = 0, // transition progress
  xtra1 = 0, // transition mode
  xtra2 = 1, // image aspect
): Float32Array {
  out[0] = width; out[1] = height; out[2] = time; out[3] = a.bass;
  out[4] = a.mid; out[5] = a.treble; out[6] = a.beat; out[7] = a.energy;
  out[8] = p.hue; out[9] = p.speed; out[10] = p.int; out[11] = p.fb;
  out[12] = xtra0; out[13] = xtra1; out[14] = xtra2; out[15] = p.bloom ?? 0;
  out.set(a.spec, 16);
  out.set(a.wave, 16 + 64);
  out.set(p.custom, 16 + 128);
  return out;
}

export const clamp = (v: number, a: number, b: number) =>
  Math.min(b, Math.max(a, v));
