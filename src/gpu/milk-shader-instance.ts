/**
 * MilkShaderInstance — persistent per-shader state that outlives a
 * single frame but is scoped to one preset's warp or composite shader.
 * Ported from docs/evidence/projectm/MilkdropShader.cpp (retained at
 * pinned SHA 2f244141320f6b97b09bf99964cc72a4efdfcfd3): the constructor
 * that draws `rand_preset` and 20 persistent rotation slots' random
 * translation, rotation center, and rotation speed, and the
 * `LoadVariables` invocation that builds the 24 rotation matrices.
 *
 * projectM constructs two `MilkdropShader` objects per preset (warp +
 * comp) each drawing its own `floatRand()` values in construction
 * order. PHOSPHENE reuses one `MilkSession.shaderRng` stream across
 * both instances' construction plus their per-invocation calls,
 * matching projectM's use of the single process-wide `rand()` stream.
 *
 * Upload representation. projectM's `SetUniformMat3x4("rot_sN",
 * glm::mat4)` calls `glUniformMatrix3x4fv(loc, 1, GL_FALSE,
 * glm::value_ptr(mat4))`. `glm::value_ptr` yields 16 floats in
 * column-major order; `glUniformMatrix3x4fv` reads the first 12 floats
 * as three columns of four rows each. PHOSPHENE stores each uploaded
 * matrix as a `Float32Array(12)` where indices 0-3 hold column 0,
 * 4-7 hold column 1, and 8-11 hold column 2 of the projectM glm::mat4.
 * Column 3 (the translation column) is discarded to match the
 * projectM upload exactly.
 */

import { type MilkRng } from "../core/milk-runner";

/** projectM MilkdropShader.cpp:
 *  `rand() % 7381 / 7380.0f`.
 *  PHOSPHENE takes a MilkRng so the stream is reproducible under
 *  session ownership. Callers use this for every random draw that
 *  projectM would emit through `floatRand()`. */
export function floatRand(rng: MilkRng): number {
  return Math.floor(rng.next() * 7381) / 7380;
}

/** A `mat3x4` — three columns × four rows — stored as 12 floats in
 *  column-major order. Matches what `glUniformMatrix3x4fv` uploads
 *  from the first 12 floats of `glm::value_ptr(mat4)`. */
export type Mat3x4 = Float32Array;

/** Apply a projectM-authored `mat3x4` to a 3-vector using the GLSL
 *  post-multiplication convention `M * v` (M has 3 cols and 4 rows,
 *  v has 3 components, result is a 4-vector). Used in tests to verify
 *  the storage layout matches projectM's upload. */
export function applyMat3x4ToPoint(
  m: Mat3x4, v: readonly [number, number, number],
): [number, number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8]  * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9]  * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2],
  ];
}

/** Build the 3x4 rotation matrix projectM constructs for one of the
 *  20 persistent slots at a given `floatTime`:
 *
 *    angleX = center.x + speed.x * floatTime
 *    angleY = center.y + speed.y * floatTime
 *    angleZ = center.z + speed.z * floatTime
 *    rotX   = glm::rotate(mat4(1), angleX, {1,0,0})
 *    rotY   = glm::rotate(mat4(1), angleY, {0,1,0})
 *    rotZ   = glm::rotate(mat4(1), angleZ, {0,0,1})
 *    tr     = glm::translate(mat4(1), translation)
 *    m      = rotY * rotZ * tr * rotX
 *    upload = first 12 floats of glm::value_ptr(m) in column-major order.
 *
 *  Exported so tests can construct a source-derived matrix from known
 *  inputs and verify the upload layout via applyMat3x4ToPoint. */
export function composeRotationMatrix(
  center: readonly [number, number, number],
  speed: readonly [number, number, number],
  translation: readonly [number, number, number],
  floatTime: number,
): Mat3x4 {
  const ax = center[0] + speed[0] * floatTime;
  const ay = center[1] + speed[1] * floatTime;
  const az = center[2] + speed[2] * floatTime;
  const rotX = mat4RotateX(ax);
  const rotY = mat4RotateY(ay);
  const rotZ = mat4RotateZ(az);
  const tr = mat4Translate(translation[0], translation[1], translation[2]);
  // m = rotY * rotZ * tr * rotX
  let m = mat4Multiply(tr, rotX);
  m = mat4Multiply(rotZ, m);
  m = mat4Multiply(rotY, m);
  return mat4ToMat3x4(m);
}

/** Build the 3x4 rotation matrix projectM constructs for one of the
 *  four fully-random slots at each `LoadVariables` invocation. Slots
 *  20..23 draw six values in this exact order per projectM:
 *
 *    angleX = floatRand() * 6.28
 *    angleY = floatRand() * 6.28
 *    angleZ = floatRand() * 6.28
 *    translation = (floatRand(), floatRand(), floatRand())
 *
 *  Then composes `rotY * rotZ * translation * rotX` and extracts the
 *  first 12 floats. Exposed so the shader-contract builder can draw
 *  the values in the source order. */
export function composeRandomRotationMatrix(rng: MilkRng): Mat3x4 {
  const ax = floatRand(rng) * 6.28;
  const ay = floatRand(rng) * 6.28;
  const az = floatRand(rng) * 6.28;
  const tx = floatRand(rng);
  const ty = floatRand(rng);
  const tz = floatRand(rng);
  const rotX = mat4RotateX(ax);
  const rotY = mat4RotateY(ay);
  const rotZ = mat4RotateZ(az);
  const tr = mat4Translate(tx, ty, tz);
  let m = mat4Multiply(tr, rotX);
  m = mat4Multiply(rotZ, m);
  m = mat4Multiply(rotY, m);
  return mat4ToMat3x4(m);
}

/** MilkdropShader instance state — the persistent members `m_randValues`,
 *  `m_randTranslation`, `m_randRotationCenters`, and
 *  `m_randRotationSpeeds` per docs/evidence/projectm/MilkdropShader.cpp
 *  constructor. All draws come from the shared session shader RNG. */
export class MilkShaderInstance {
  readonly kind: "warp" | "comp";
  readonly randPreset: readonly [number, number, number, number];
  private readonly translations: readonly [number, number, number][];
  private readonly rotationCenters: readonly [number, number, number][];
  private readonly rotationSpeeds: readonly [number, number, number][];

  constructor(kind: "warp" | "comp", rng: MilkRng) {
    this.kind = kind;
    // projectM MilkdropShader constructor:
    //   m_randValues({floatRand(), floatRand(), floatRand(), floatRand()})
    this.randPreset = [floatRand(rng), floatRand(rng), floatRand(rng), floatRand(rng)];
    const t: [number, number, number][] = [];
    const c: [number, number, number][] = [];
    const s: [number, number, number][] = [];
    for (let index = 0; index < 20; index++) {
      const translationMult = 1;
      const rotMult = 0.9 * Math.pow(index / 8.0, 3.2);
      t.push([
        (floatRand(rng) * 2 - 1) * translationMult,
        (floatRand(rng) * 2 - 1) * translationMult,
        (floatRand(rng) * 2 - 1) * translationMult,
      ]);
      c.push([
        floatRand(rng) * 6.28,
        floatRand(rng) * 6.28,
        floatRand(rng) * 6.28,
      ]);
      s.push([
        (floatRand(rng) * 2 - 1) * rotMult,
        (floatRand(rng) * 2 - 1) * rotMult,
        (floatRand(rng) * 2 - 1) * rotMult,
      ]);
    }
    this.translations = t;
    this.rotationCenters = c;
    this.rotationSpeeds = s;
  }

  /** Build the 20 persistent-slot matrices at a given `floatTime`.
   *  Draws no random values. */
  buildPersistentMatrices(floatTime: number): Mat3x4[] {
    const out: Mat3x4[] = new Array(20);
    for (let i = 0; i < 20; i++) {
      out[i] = composeRotationMatrix(
        this.rotationCenters[i], this.rotationSpeeds[i], this.translations[i],
        floatTime,
      );
    }
    return out;
  }

  /** Build the 4 fully-random-per-invocation matrices for slots
   *  20..23. Draws 24 floatRand values from the provided RNG in the
   *  exact projectM order (6 per slot: aX, aY, aZ, tX, tY, tZ). */
  buildRandomMatrices(rng: MilkRng): Mat3x4[] {
    const out: Mat3x4[] = new Array(4);
    for (let i = 0; i < 4; i++) {
      out[i] = composeRandomRotationMatrix(rng);
    }
    return out;
  }
}

/* ------------------------- internal mat4 helpers ---------------------- */
// A glm::mat4 stored as 16 floats in column-major order:
//   [col0[0..3], col1[0..3], col2[0..3], col3[0..3]]

function mat4Identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

function mat4RotateX(angle: number): Float32Array {
  const m = mat4Identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Row form: [1, 0, 0, 0; 0, c, -s, 0; 0, s, c, 0; 0, 0, 0, 1]
  // Column-major memory: col0=(1,0,0,0), col1=(0,c,s,0), col2=(0,-s,c,0), col3=(0,0,0,1)
  m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
  m[4] = 0; m[5] = c; m[6] = s; m[7] = 0;
  m[8] = 0; m[9] = -s; m[10] = c; m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
  return m;
}

function mat4RotateY(angle: number): Float32Array {
  const m = mat4Identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Row form: [c, 0, s, 0; 0, 1, 0, 0; -s, 0, c, 0; 0, 0, 0, 1]
  // Column-major memory: col0=(c,0,-s,0), col1=(0,1,0,0), col2=(s,0,c,0), col3=(0,0,0,1)
  m[0] = c; m[1] = 0; m[2] = -s; m[3] = 0;
  m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
  m[8] = s; m[9] = 0; m[10] = c; m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
  return m;
}

function mat4RotateZ(angle: number): Float32Array {
  const m = mat4Identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Row form: [c, -s, 0, 0; s, c, 0, 0; 0, 0, 1, 0; 0, 0, 0, 1]
  // Column-major memory: col0=(c,s,0,0), col1=(-s,c,0,0), col2=(0,0,1,0), col3=(0,0,0,1)
  m[0] = c; m[1] = s; m[2] = 0; m[3] = 0;
  m[4] = -s; m[5] = c; m[6] = 0; m[7] = 0;
  m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
  return m;
}

function mat4Translate(tx: number, ty: number, tz: number): Float32Array {
  const m = mat4Identity();
  // Column-major memory: col3 = (tx, ty, tz, 1)
  m[12] = tx; m[13] = ty; m[14] = tz; m[15] = 1;
  return m;
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  // Column-major multiply: (a * b)[c][r] = sum_k a[k][r] * b[c][k]
  // where mat[c][r] = memory[c*4 + r].
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[k * 4 + r] * b[c * 4 + k];
      }
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function mat4ToMat3x4(m: Float32Array): Mat3x4 {
  // Extract the first 12 floats of the column-major glm::mat4.
  const out = new Float32Array(12);
  for (let i = 0; i < 12; i++) out[i] = m[i];
  return out;
}
