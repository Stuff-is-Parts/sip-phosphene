/**
 * MilkShaderInstance — persistent per-shader state that outlives a
 * single frame but is scoped to one preset's warp or composite shader.
 * Ported from docs/evidence/projectm/MilkdropShader.cpp constructor +
 * `LoadVariables`. COMPATIBILITY-GOAL.md §Source-Authority puts projectM
 * above butterchurn for the default execution path, and butterchurn does
 * not upload the 24 rotation matrices at all — projectM does, so
 * PHOSPHENE must, and the state that produces them lives here.
 *
 * Two instances per preset: one for the warp shader, one for the comp
 * shader. Each owns its own `rand_preset` 4-vector and its own 20
 * persistent rotation-state slots. Butterchurn shares one Renderer
 * seed across warp and comp; projectM constructs two `MilkdropShader`
 * objects each with its own `floatRand()` draws. PHOSPHENE follows
 * projectM here.
 *
 * The rotation matrices projectM uploads are laid out as:
 *   slots 0..3   → rot_s1..rot_s4    (uf-slow)
 *   slots 4..7   → rot_d1..rot_d4    (dynamic)
 *   slots 8..11  → rot_f1..rot_f4    (fast)
 *   slots 12..15 → rot_vf1..rot_vf4  (very fast)
 *   slots 16..19 → rot_uf1..rot_uf4  (ultra fast)
 *   slots 20..23 → rot_rand1..rot_rand4  (fully random this call)
 *
 * Slots 0..19 use persistent random translations, rotation centers,
 * and rotation speeds drawn once at construction and combined with
 * `floatTime` at each invocation. Slots 20..23 draw four fresh random
 * numbers per invocation.
 */

import { type MilkRng } from "../core/milk-runner";

/** A row-major 4x4 matrix stored as 16 floats. */
export type Mat4 = Float32Array;

/** The persistent random state one shader instance owns for the 20
 *  non-per-frame rotation slots. */
interface PersistentRotState {
  translation: [number, number, number];
  rotationCenter: [number, number, number];
  rotationSpeed: [number, number, number];
}

function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  }
  return out;
}

function rotateX(angle: number): Mat4 {
  const m = identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m[5] = c;  m[6] = -s;
  m[9] = s;  m[10] = c;
  return m;
}

function rotateY(angle: number): Mat4 {
  const m = identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m[0] = c;  m[2] = s;
  m[8] = -s; m[10] = c;
  return m;
}

function rotateZ(angle: number): Mat4 {
  const m = identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m[0] = c;  m[1] = -s;
  m[4] = s;  m[5] = c;
  return m;
}

function translate(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[3] = x; m[7] = y; m[11] = z;
  return m;
}

/** projectM `MilkdropShader.cpp`'s `floatRand()`: `rand() % 7381 /
 *  7380.0f`. PHOSPHENE takes a MilkRng so the stream is reproducible
 *  and stays under session ownership. */
function floatRand(rng: MilkRng): number {
  return Math.floor(rng.next() * 7381) / 7380.0;
}

/** MilkdropShader instance. Constructor draws all persistent random
 *  state from the provided RNG once; subsequent per-invocation draws
 *  come through `buildRotationMatrices` from the caller's session
 *  shader RNG (a distinct stream from the construction RNG, so
 *  reproducing state across a reload does not shift the per-frame
 *  matrices). */
export class MilkShaderInstance {
  readonly kind: "warp" | "comp";
  /** `rand_preset` — persistent for this instance's lifetime.
   *  Uploaded verbatim by `LoadVariables`. */
  readonly randPreset: readonly [number, number, number, number];
  /** Persistent random state for the 20 non-per-frame rotation slots. */
  private readonly persistent: readonly PersistentRotState[];

  constructor(kind: "warp" | "comp", rng: MilkRng) {
    this.kind = kind;
    this.randPreset = [floatRand(rng), floatRand(rng), floatRand(rng), floatRand(rng)];
    // 20 persistent slots. `rotMult` follows the projectM formula
    // `0.9f * powf(index / 8.0f, 3.2f)` — slower rotation on earlier
    // slots, faster on later ones.
    const slots: PersistentRotState[] = [];
    for (let index = 0; index < 20; index++) {
      const translationMult = 1;
      const rotMult = 0.9 * Math.pow(index / 8.0, 3.2);
      slots.push({
        translation: [
          (floatRand(rng) * 2 - 1) * translationMult,
          (floatRand(rng) * 2 - 1) * translationMult,
          (floatRand(rng) * 2 - 1) * translationMult,
        ],
        rotationCenter: [
          floatRand(rng) * 6.28,
          floatRand(rng) * 6.28,
          floatRand(rng) * 6.28,
        ],
        rotationSpeed: [
          (floatRand(rng) * 2 - 1) * rotMult,
          (floatRand(rng) * 2 - 1) * rotMult,
          (floatRand(rng) * 2 - 1) * rotMult,
        ],
      });
    }
    this.persistent = slots;
  }

  /** Build the 24 rotation matrices this instance uploads to its
   *  shader. Slots 0..19 use persistent state + `floatTime`. Slots
   *  20..23 draw fresh values from `rng` at each invocation, matching
   *  MilkdropShader.cpp's per-invocation `floatRand()` loop.
   *
   *  The `rng` argument is the session's shader RNG — a stream
   *  independent from the construction RNG so an instance reload does
   *  not shift the per-invocation randomness. */
  buildRotationMatrices(floatTime: number, rng: MilkRng): Mat4[] {
    const matrices: Mat4[] = new Array(24);
    // Persistent slots 0..19.
    for (let i = 0; i < 20; i++) {
      const s = this.persistent[i];
      const rx = rotateX(s.rotationCenter[0] + s.rotationSpeed[0] * floatTime);
      const ry = rotateY(s.rotationCenter[1] + s.rotationSpeed[1] * floatTime);
      const rz = rotateZ(s.rotationCenter[2] + s.rotationSpeed[2] * floatTime);
      const t = translate(s.translation[0], s.translation[1], s.translation[2]);
      // projectM: tempMatrices[i] = randomTranslation * rotationX;
      //          tempMatrices[i] = rotationZ * tempMatrices[i];
      //          tempMatrices[i] = rotationY * tempMatrices[i];
      let m = multiply(t, rx);
      m = multiply(rz, m);
      m = multiply(ry, m);
      matrices[i] = m;
    }
    // Fully-random slots 20..23. Each slot draws 3 rotation angles
    // (as `floatRand * 6.28`) plus 3 translations (as raw `floatRand`).
    for (let i = 20; i < 24; i++) {
      const rx = rotateX(floatRand(rng) * 6.28);
      const ry = rotateY(floatRand(rng) * 6.28);
      const rz = rotateZ(floatRand(rng) * 6.28);
      const t = translate(floatRand(rng), floatRand(rng), floatRand(rng));
      let m = multiply(t, rx);
      m = multiply(rz, m);
      m = multiply(ry, m);
      matrices[i] = m;
    }
    return matrices;
  }
}
