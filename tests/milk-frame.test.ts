// Lifecycle tests for the MilkDrop frame-equation engine against the
// documented semantics (docs/milkdrop-execution-model.md §2).
import { describe, expect, it } from "vitest";
import { MilkFrameEngine, MilkUnitContext, inputsFromAudio } from "../src/core/milk-frame";
import type { AudioFeatures } from "../src/core/types";

const audio: AudioFeatures = {
  beatCount: 0, lastBeat: 0, bass: 1, mid: 1, treble: 1, beat: 0,
  energy: 1, bpm: 120, spec: new Float32Array(64), wave: new Float32Array(64),
};
const inputs = (t: number, frame: number) => inputsFromAudio(t, frame, audio, 64, 48, 800, 600);

describe("MilkFrameEngine lifecycle", () => {
  it("resets q to the init snapshot every frame (no accumulation)", () => {
    const e = new MilkFrameEngine({}, "q1 = 5;", "q1 = q1 + 1;");
    e.runFrame(inputs(0, 0));
    expect(e.get("q1")).toBe(6);
    e.runFrame(inputs(1 / 30, 1));
    // Real MilkDrop: q1 resets to 5 then +1 -> 6, NOT 7.
    expect(e.get("q1")).toBe(6);
  });

  it("persists non-q user variables across frames", () => {
    const e = new MilkFrameEngine({}, "", "counter = counter + 1;");
    e.runFrame(inputs(0, 0));
    e.runFrame(inputs(1 / 30, 1));
    e.runFrame(inputs(2 / 30, 2));
    expect(e.get("counter")).toBe(3);
  });

  it("reseeds base values each frame before equations", () => {
    const e = new MilkFrameEngine({ zoom: 1.0 }, "", "zoom = zoom + 0.5;");
    e.runFrame(inputs(0, 0));
    expect(e.get("zoom")).toBe(1.5);
    e.runFrame(inputs(1 / 30, 1));
    // zoom reloads from base 1.0 each frame; per-frame is exact, not additive.
    expect(e.get("zoom")).toBe(1.5);
  });

  it("shares reg variables into unit contexts", () => {
    const e = new MilkFrameEngine({}, "", "reg01 = 42;");
    e.runFrame(inputs(0, 0));
    const unit = new MilkUnitContext(e.shared, {}, "", "myr = reg01;", "");
    const env = unit.runFrame(e.qValues(), inputs(0, 0));
    expect(env.myr).toBe(42);
  });

  it("flows post-per-frame q into units and resets unit t to init snapshot", () => {
    const e = new MilkFrameEngine({}, "q2 = 1;", "q2 = q2 * 3;");
    e.runFrame(inputs(0, 0));
    const unit = new MilkUnitContext(e.shared, {}, "t1 = 10;", "t1 = t1 + q2;", "");
    let env = unit.runFrame(e.qValues(), inputs(0, 0));
    expect(env.t1).toBe(13); // 10 + 3
    e.runFrame(inputs(1 / 30, 1));
    env = unit.runFrame(e.qValues(), inputs(1 / 30, 1));
    expect(env.t1).toBe(13); // t resets to snapshot 10, +3 again
  });

  it("runs per-point code with sample/value1/value2 in scope", () => {
    const e = new MilkFrameEngine({}, "", "");
    e.runFrame(inputs(0, 0));
    const unit = new MilkUnitContext(e.shared, { x: 0.5 }, "", "", "x = sample; y = value1 * 2;");
    unit.runFrame(e.qValues(), inputs(0, 0));
    const env = unit.runPoint(0.25, 0.4, 0);
    expect(env.x).toBe(0.25);
    expect(env.y).toBeCloseTo(0.8);
  });
});
