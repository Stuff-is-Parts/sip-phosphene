import { describe, it, expect } from "vitest";
import { parseParams, packUniforms, UNIFORM_FLOATS } from "../src/core/params";
import { ModEngine } from "../src/core/mods";
import { normalizeScene } from "../src/core/types";
import { assemble, countLines } from "../src/gpu/wgsl";
import type { AudioFeatures } from "../src/core/types";

const audio = (over: Partial<AudioFeatures> = {}): AudioFeatures => ({
  beatCount: 3, lastBeat: 0,
  bass: 0.5, mid: 0.25, treble: 0.1, beat: 1, energy: 0.4, bpm: 120,
  spec: new Float32Array(64).fill(0.3),
  wave: new Float32Array(64).fill(-0.2),
  ...over,
});

describe("//@param parser", () => {
  it("parses annotations with slots in order", () => {
    const p = parseParams(`//@param foo 0 2 1\ncode\n//@param bar -1.5 1.5 0.25\n`);
    expect(p).toEqual([
      { name: "foo", min: 0, max: 2, def: 1, slot: 0 },
      { name: "bar", min: -1.5, max: 1.5, def: 0.25, slot: 1 },
    ]);
  });
  it("dedupes names and caps at 16", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `//@param p${i % 18} 0 1 0.5`).join("\n");
    const p = parseParams(lines);
    expect(p.length).toBeLessThanOrEqual(16);
    expect(new Set(p.map((x) => x.name)).size).toBe(p.length);
  });
  it("ignores malformed annotations", () => {
    expect(parseParams("//@param broken 0 1")).toEqual([]);
  });
});

describe("uniform packing", () => {
  it("matches the WGSL struct layout exactly", () => {
    const out = new Float32Array(UNIFORM_FLOATS);
    const custom = new Float32Array(16); custom[2] = 7;
    packUniforms(out, 800, 600, 12.5, audio(), {
      hue: 0.1, speed: 1.5, int: 0.9, fb: 0.4, custom,
    });
    expect(out[0]).toBe(800);       // res.x
    expect(out[1]).toBe(600);       // res.y
    expect(out[2]).toBe(12.5);      // time
    expect(out[3]).toBeCloseTo(0.5); // bass
    expect(out[7]).toBeCloseTo(0.4); // energy
    expect(out[8]).toBeCloseTo(0.1); // hue
    expect(out[11]).toBeCloseTo(0.4); // fb
    expect(out[14]).toBe(1); // image aspect default
    expect(out[16]).toBeCloseTo(0.3); // spec[0]
    expect(out[16 + 63]).toBeCloseTo(0.3); // spec[63]
    expect(out[16 + 64]).toBeCloseTo(-0.2); // wave[0]
    expect(out[16 + 128 + 2]).toBe(7); // custom slot 2
    expect(UNIFORM_FLOATS).toBe(160);
  });
});

describe("mod matrix", () => {
  it("routes a source into a builtin with base+gain", () => {
    const scene = normalizeScene({
      name: "t",
      layers: { bg: { code: "" }, fg: { code: "" }, post: { code: "" } },
      mods: [{ target: "int", source: "bass", gain: 2, base: 0.1 }],
    });
    const eng = new ModEngine();
    // run several frames so smoothing converges
    let p = eng.evaluate(scene, { bg: [], fg: [], post: [] }, audio(), 0);
    for (let i = 0; i < 50; i++) p = eng.evaluate(scene, { bg: [], fg: [], post: [] }, audio(), i * 0.016);
    // int = base param (1) + (0.1 + 0.5*2) = 2.1, clamped to 3 max
    expect(p.int).toBeCloseTo(2.1, 1);
  });
  it("clamps fb into safe range", () => {
    const scene = normalizeScene({
      name: "t",
      layers: { bg: { code: "" }, fg: { code: "" }, post: { code: "" } },
      mods: [{ target: "fb", source: "energy", gain: 10, base: 0 }],
    });
    const eng = new ModEngine();
    let p = eng.evaluate(scene, { bg: [], fg: [], post: [] }, audio(), 0);
    for (let i = 0; i < 50; i++) p = eng.evaluate(scene, { bg: [], fg: [], post: [] }, audio(), i * 0.016);
    expect(p.fb).toBeLessThanOrEqual(0.97);
  });
  it("routes into a custom param slot with clamping", () => {
    const scene = normalizeScene({
      name: "t",
      layers: { bg: { code: "" }, fg: { code: "" }, post: { code: "" } },
      custom: { size: 0.2 },
      mods: [{ target: "size", source: "beat", gain: 5, base: 0 }],
    });
    const eng = new ModEngine();
    const stageParams = {
      bg: [{ name: "size", min: 0, max: 1, def: 0.2, slot: 0 }],
      fg: [], post: [],
    };
    let p = eng.evaluate(scene, stageParams, audio(), 0);
    for (let i = 0; i < 50; i++) p = eng.evaluate(scene, stageParams, audio(), i * 0.016);
    expect(p.custom[0]).toBeLessThanOrEqual(1);
    expect(p.custom[0]).toBeGreaterThan(0.2);
  });
});

describe("beatRand source", () => {
  it("holds a value between beats and resamples on a new beat", () => {
    const scene = normalizeScene({
      name: "t",
      layers: { bg: { code: "" }, fg: { code: "" }, post: { code: "" } },
      mods: [{ target: "hue", source: "beatRand", gain: 1, base: 0 }],
    });
    const eng = new ModEngine();
    const a1 = audio({ beatCount: 1 });
    // converge smoothing on the held value
    let p = eng.evaluate(scene, { bg: [], fg: [], post: [] }, a1, 0);
    for (let i = 0; i < 60; i++) p = eng.evaluate(scene, { bg: [], fg: [], post: [] }, a1, i * 0.016);
    const held1 = p.hue;
    // same beatCount -> unchanged
    p = eng.evaluate(scene, { bg: [], fg: [], post: [] }, a1, 2);
    expect(p.hue).toBeCloseTo(held1, 5);
    // new beat -> converges to a (almost surely) different held value
    const a2 = audio({ beatCount: 2 });
    for (let i = 0; i < 60; i++) p = eng.evaluate(scene, { bg: [], fg: [], post: [] }, a2, 3 + i * 0.016);
    expect(Math.abs(p.hue - held1)).toBeGreaterThan(1e-6);
  });
});

describe("WGSL assembly", () => {
  it("computes a correct body line offset for diagnostics", () => {
    const body = "fn render(c : Ctx) -> vec3f { return vec3f(0.0); }";
    const { code, bodyLineOffset } = assemble("bg", body, []);
    const lines = code.split("\n");
    expect(lines[bodyLineOffset]).toContain("fn render");
  });
  it("adds POST helpers and custom accessors", () => {
    const { code } = assemble("post", "fn render(c : Ctx) -> vec3f { return srcTex(c.uv) * amount(); }",
      [{ name: "amount", min: 0, max: 2, def: 1, slot: 0 }]);
    expect(code).toContain("fn srcTex");
    expect(code).toContain("fn amount() -> f32 { return custSlot(0); }");
  });
  it("countLines counts newlines", () => {
    expect(countLines("a\nb\nc")).toBe(2);
    expect(countLines("")).toBe(0);
  });
});
