// Direct semantic tests for MilkShaderInstance against projectM
// MilkdropShader.cpp — the persistent per-shader-instance state that
// carries `rand_preset` and the 20 rotation slots' random translation,
// rotation center, and rotation speed.

import { describe, expect, it } from "vitest";
import { MilkShaderInstance } from "../src/gpu/milk-shader-instance";
import { makeMulberry32 } from "../src/core/milk-runner";

describe("MilkShaderInstance — construction (projectM MilkdropShader constructor)", () => {
  it("populates a 4-element rand_preset from four floatRand draws", () => {
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    expect(inst.randPreset).toHaveLength(4);
    for (const v of inst.randPreset) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("draws distinct rand_preset for two instances constructed on the same RNG stream", () => {
    // projectM constructs one MilkdropShader per kind; each draws four
    // floatRand() values from the process RNG. When PHOSPHENE reuses
    // one MilkRng across two construct calls, the second instance
    // sees the RNG stream advanced past the first's four draws.
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

describe("MilkShaderInstance — buildRotationMatrices (projectM LoadVariables)", () => {
  it("returns exactly 24 4x4 matrices", () => {
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    const mats = inst.buildRotationMatrices(0, makeMulberry32(2));
    expect(mats).toHaveLength(24);
    for (const m of mats) {
      expect(m).toBeInstanceOf(Float32Array);
      expect(m.length).toBe(16);
    }
  });

  it("produces identical persistent-slot matrices for the same time and instance", () => {
    // Slots 0..19 depend only on persistent state + floatTime; two
    // calls at the same time must produce identical matrices for
    // those slots regardless of the per-invocation RNG.
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    const a = inst.buildRotationMatrices(5, makeMulberry32(2));
    const b = inst.buildRotationMatrices(5, makeMulberry32(3));
    for (let i = 0; i < 20; i++) {
      expect(Array.from(a[i])).toEqual(Array.from(b[i]));
    }
  });

  it("produces different fully-random matrices (slots 20..23) across calls with different RNGs", () => {
    // projectM MilkdropShader.cpp: slots 20..23 draw fresh floatRand
    // values at every invocation. Two calls with different RNG streams
    // must produce different matrices for those slots.
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    const a = inst.buildRotationMatrices(5, makeMulberry32(100));
    const b = inst.buildRotationMatrices(5, makeMulberry32(200));
    let anyDiffer = false;
    for (let i = 20; i < 24; i++) {
      for (let k = 0; k < 16; k++) {
        if (a[i][k] !== b[i][k]) { anyDiffer = true; break; }
      }
      if (anyDiffer) break;
    }
    expect(anyDiffer).toBe(true);
  });

  it("changes persistent-slot matrices across different floatTime values", () => {
    // Slot 0..19 rotations animate with floatTime via the persistent
    // speed vector: `rotationCenter + rotationSpeed * floatTime`.
    const inst = new MilkShaderInstance("warp", makeMulberry32(1));
    const at0 = inst.buildRotationMatrices(0, makeMulberry32(2));
    const at5 = inst.buildRotationMatrices(5, makeMulberry32(2));
    // At least one persistent slot must differ across time — the
    // rotation speeds are drawn from a non-degenerate distribution so
    // exactly-zero speed on all slots is not a realistic outcome.
    let anyDiffer = false;
    for (let i = 0; i < 20; i++) {
      for (let k = 0; k < 16; k++) {
        if (Math.abs(at0[i][k] - at5[i][k]) > 1e-12) { anyDiffer = true; break; }
      }
      if (anyDiffer) break;
    }
    expect(anyDiffer).toBe(true);
  });
});
