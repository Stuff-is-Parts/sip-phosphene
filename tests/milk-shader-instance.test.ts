// Direct semantic tests for MilkShaderInstance against
// docs/evidence/projectm/MilkdropShader.cpp (retained verbatim at
// pinned SHA 2f244141320f6b97b09bf99964cc72a4efdfcfd3). Every
// assertion cites the projectM behavior it verifies.

import { describe, expect, it } from "vitest";
import {
  MilkShaderInstance, composeRotationMatrix, applyMat3x4ToPoint,
  floatRand,
} from "../src/gpu/milk-shader-instance";
import { makeMulberry32 } from "../src/core/milk-runner";

describe("floatRand — projectM MilkdropShader.cpp lambda", () => {
  it("returns rand() mod 7381 divided by 7380 for reproducible seeds", () => {
    // The lambda is: `rand() % 7381 / 7380.0f`. PHOSPHENE substitutes
    // MilkRng for `rand()`; each draw scales one rng.next() to the
    // 7381 bucket. Verify determinism for a fixed seed.
    const a = floatRand(makeMulberry32(1));
    const b = floatRand(makeMulberry32(1));
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });
});

describe("MilkShaderInstance — construction draws in projectM order", () => {
  it("populates a 4-element rand_preset from four floatRand draws first", () => {
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    expect(inst.randPreset).toHaveLength(4);
    for (const v of inst.randPreset) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("draws distinct rand_preset for two instances constructed on the same RNG stream", () => {
    // projectM constructs one MilkdropShader per kind, each drawing
    // four floatRand values from the process RNG. When PHOSPHENE
    // reuses one MilkRng across two construct calls, the second
    // instance sees the stream advanced past the first's four draws.
    const rng = makeMulberry32(42);
    const warp = new MilkShaderInstance("warp", rng);
    const comp = new MilkShaderInstance("comp", rng);
    expect(warp.randPreset).not.toEqual(comp.randPreset);
  });

  it("stores the shader kind for downstream contract identification", () => {
    const warp = new MilkShaderInstance("warp", makeMulberry32(1));
    const comp = new MilkShaderInstance("comp", makeMulberry32(1));
    expect(warp.kind).toBe("warp");
    expect(comp.kind).toBe("comp");
  });
});

describe("MilkShaderInstance — persistent-slot matrices (slots 0..19)", () => {
  it("returns 20 matrices of 12 floats each", () => {
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    const mats = inst.buildPersistentMatrices(0);
    expect(mats).toHaveLength(20);
    for (const m of mats) {
      expect(m).toBeInstanceOf(Float32Array);
      expect(m.length).toBe(12);
    }
  });

  it("draws no random values (identical output regardless of subsequent RNG usage)", () => {
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    const a = inst.buildPersistentMatrices(5);
    const b = inst.buildPersistentMatrices(5);
    for (let i = 0; i < 20; i++) {
      expect(Array.from(a[i])).toEqual(Array.from(b[i]));
    }
  });

  it("changes across different floatTime values because slot 0..19 rotation animates with time", () => {
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    const at0 = inst.buildPersistentMatrices(0);
    const at5 = inst.buildPersistentMatrices(5);
    let anyDiffer = false;
    for (let i = 0; i < 20; i++) {
      for (let k = 0; k < 12; k++) {
        if (Math.abs(at0[i][k] - at5[i][k]) > 1e-12) { anyDiffer = true; break; }
      }
      if (anyDiffer) break;
    }
    expect(anyDiffer).toBe(true);
  });
});

describe("MilkShaderInstance — random-slot matrices (slots 20..23)", () => {
  it("returns exactly 4 matrices of 12 floats each and draws 24 floatRand values in projectM order", () => {
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    // The buildRandomMatrices call must draw 24 floatRand values per
    // projectM: for each of 4 slots, six draws in order aX, aY, aZ,
    // tX, tY, tZ. Verify by consuming 24 draws with the same seed
    // manually and comparing the RNG advancement.
    const rngA = makeMulberry32(99);
    const rngB = makeMulberry32(99);
    const mats = inst.buildRandomMatrices(rngA);
    for (let i = 0; i < 24; i++) floatRand(rngB);
    expect(rngA.next()).toBe(rngB.next());
    expect(mats).toHaveLength(4);
    for (const m of mats) {
      expect(m).toBeInstanceOf(Float32Array);
      expect(m.length).toBe(12);
    }
  });

  it("produces different matrices across calls with different RNG streams", () => {
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    const a = inst.buildRandomMatrices(makeMulberry32(100));
    const b = inst.buildRandomMatrices(makeMulberry32(200));
    let anyDiffer = false;
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 12; k++) {
        if (a[i][k] !== b[i][k]) { anyDiffer = true; break; }
      }
      if (anyDiffer) break;
    }
    expect(anyDiffer).toBe(true);
  });
});

describe("mat3x4 upload representation matches projectM SetUniformMat3x4", () => {
  // projectM's SetUniformMat3x4(name, glm::mat4) calls
  // glUniformMatrix3x4fv(loc, 1, GL_FALSE, glm::value_ptr(mat4)).
  // glm::value_ptr returns 16 column-major floats; the GL call reads
  // the first 12 as three columns of four rows each. PHOSPHENE
  // stores that same 12-float slice.

  it("stores a pure Z rotation of pi/4 with the projectM column layout", () => {
    const angle = Math.PI / 4;
    const m = composeRotationMatrix(
      [0, 0, angle], [0, 0, 0], [0, 0, 0], 0,
    );
    // Expected first 12 floats of the column-major mat4 for Z rotation:
    //   col0 = (cos, sin, 0, 0)
    //   col1 = (-sin, cos, 0, 0)
    //   col2 = (0, 0, 1, 0)
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    expect(m[0]).toBeCloseTo(c, 6);
    expect(m[1]).toBeCloseTo(s, 6);
    expect(m[2]).toBeCloseTo(0, 6);
    expect(m[3]).toBeCloseTo(0, 6);
    expect(m[4]).toBeCloseTo(-s, 6);
    expect(m[5]).toBeCloseTo(c, 6);
    expect(m[6]).toBeCloseTo(0, 6);
    expect(m[7]).toBeCloseTo(0, 6);
    expect(m[8]).toBeCloseTo(0, 6);
    expect(m[9]).toBeCloseTo(0, 6);
    expect(m[10]).toBeCloseTo(1, 6);
    expect(m[11]).toBeCloseTo(0, 6);
  });

  it("applies a Z rotation of pi/4 to (1, 0, 0) yielding (cos, sin, 0, 0)", () => {
    // Apply the stored mat3x4 to a known vector via applyMat3x4ToPoint
    // and verify the result matches a direct 2D Z rotation.
    const angle = Math.PI / 4;
    const m = composeRotationMatrix(
      [0, 0, angle], [0, 0, 0], [0, 0, 0], 0,
    );
    const out = applyMat3x4ToPoint(m, [1, 0, 0]);
    expect(out[0]).toBeCloseTo(Math.cos(angle), 6);
    expect(out[1]).toBeCloseTo(Math.sin(angle), 6);
    expect(out[2]).toBeCloseTo(0, 6);
    expect(out[3]).toBeCloseTo(0, 6);
  });

  it("applies an X rotation of pi/3 to (0, 1, 0) yielding (0, cos, sin, 0)", () => {
    const angle = Math.PI / 3;
    const m = composeRotationMatrix(
      [angle, 0, 0], [0, 0, 0], [0, 0, 0], 0,
    );
    const out = applyMat3x4ToPoint(m, [0, 1, 0]);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(Math.cos(angle), 6);
    expect(out[2]).toBeCloseTo(Math.sin(angle), 6);
    expect(out[3]).toBeCloseTo(0, 6);
  });
});
