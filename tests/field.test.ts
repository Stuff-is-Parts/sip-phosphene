import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { makeGeometry, assembleMesh, PARTICLE_WGSL } from "../src/gpu/mesh";
import { assemble } from "../src/gpu/wgsl";
import { parseParams } from "../src/core/params";
import { ParticleSystem } from "../src/core/particles";
import { renderTextImage } from "../src/core/text";
import { normalizeScene, type MeshPrimitive, type Scene } from "../src/core/types";

const PRIMS: MeshPrimitive[] = ["cube", "sphere", "plane", "cylinder", "torus"];

describe("mesh geometry", () => {
  for (const prim of PRIMS) {
    it(`${prim}: interleaved layout and in-range indices`, () => {
      const g = makeGeometry(prim);
      expect(g.vertices.length % 6).toBe(0);
      expect(g.indices.length % 3).toBe(0);
      const vertexCount = g.vertices.length / 6;
      for (const i of g.indices) expect(i).toBeLessThan(vertexCount);
      // normals are unit-ish
      const nx = g.vertices[3], ny = g.vertices[4], nz = g.vertices[5];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 1);
    });
  }
});

const DEMO: Scene = normalizeScene(
  JSON.parse(readFileSync("scenes/prism-rig.phos.json", "utf8")));

describe("field-parity WGSL through the real assembly paths", () => {
  it("demo mesh code assembles as valid WGSL", () => {
    expect(DEMO.mesh).toBeDefined();
    const code = assembleMesh((DEMO.mesh as NonNullable<Scene["mesh"]>).code);
    expect(() => new WgslReflect(code)).not.toThrow();
  });
  it("particle billboard module is valid WGSL", () => {
    expect(() => new WgslReflect(PARTICLE_WGSL)).not.toThrow();
  });
  it("demo pass code assembles through the post contract", () => {
    const pass = (DEMO.passes as NonNullable<Scene["passes"]>)[0];
    const params = parseParams(pass.code);
    const { code } = assemble("post", pass.code, params);
    expect(() => new WgslReflect(code)).not.toThrow();
  });
  it("demo scene layers assemble", () => {
    for (const stage of ["bg", "fg", "post"] as const) {
      const body = DEMO.layers[stage].code;
      const { code } = assemble(stage, body, parseParams(body));
      expect(() => new WgslReflect(code), stage).not.toThrow();
    }
  });
});

describe("particle system", () => {
  it("integrates velocity and honors the update program", () => {
    const ps = new ParticleSystem({ count: 8, code: "vx = 1; vy = 0; vz = 0; size = 0.5;" });
    expect(ps.error).toBeNull();
    const audio = {
      beatCount: 0, lastBeat: 0, bass: 0, mid: 0, treble: 0, beat: 0,
      energy: 0, bpm: 0, spec: new Float32Array(64), wave: new Float32Array(64),
    };
    const a = ps.update(audio, 0);
    const x0 = a[0];
    const b = ps.update(audio, 0.05);
    expect(b[0] - x0).toBeCloseTo(0.05, 3); // 1 unit/sec for the 50ms step
    expect(b[3]).toBeCloseTo(0.5, 5);       // size channel
  });
  it("reports compile errors instead of throwing", () => {
    const ps = new ParticleSystem({ count: 4, code: "vx = (;" });
    expect(ps.error).not.toBeNull();
  });
});

describe("scene format passthrough", () => {
  it("normalizeScene carries and caps the new fields", () => {
    const s = normalizeScene({
      name: "t",
      layers: { bg: { code: "" }, fg: { code: "" }, post: { code: "" } },
      passes: [{ id: "p", code: "x" }],
      mesh: { primitive: "cube", count: 9999, code: "m" },
      particles: { count: 99999, code: "p" },
      text: { value: "HI" },
      bloom: 0.5,
    });
    expect(s.passes?.length).toBe(1);
    expect(s.mesh?.count).toBe(1024);
    expect(s.particles?.count).toBe(4096);
    expect(s.text?.value).toBe("HI");
    expect(s.bloom).toBe(0.5);
  });
});

describe("text rendering", () => {
  it("returns null without a DOM canvas (node)", () => {
    expect(renderTextImage(DEMO)).toBeNull();
  });
});
