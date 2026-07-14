import { describe, it, expect } from "vitest";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { parseMilk, milkToScene } from "../src/import/milk";
import { ModEngine } from "../src/core/mods";
import { parseParams } from "../src/core/params";
import { assemble } from "../src/gpu/wgsl";
import { STAGES, type AudioFeatures } from "../src/core/types";

const FIXTURE = `[preset00]
fRating=4.0
fDecay=0.95
zoom=1.02
rot=0.01
warp=0.35
dx=0.0
dy=0.0
wave_r=0.9
wave_g=0.4
wave_b=0.2
wave_a=1.1
wave_y=0.5
nWaveMode=6
wavecode_0_enabled=1
per_frame_init_1=q1 = 0.5;
per_frame_1=q1 = q1*0.98 + bass*0.02;
per_frame_2=zoom = zoom + 0.015*sin(time*0.7) + q1*0.03;
per_frame_3=rot = rot + 0.02*sin(time*0.31);
per_frame_4=wave_r = 0.5 + 0.5*sin(time*1.1);
`;

function audio(bass: number): AudioFeatures {
  return {
    beatCount: 0, lastBeat: 0, bass, mid: 0, treble: 0, beat: 0, energy: 0,
    bpm: 120, spec: new Float32Array(64), wave: new Float32Array(64),
  };
}

describe("milk preset parsing", () => {
  it("concatenates equation lines with no separator, like MilkDrop", () => {
    const m = parseMilk("[preset00]\nper_frame_1=k1 = is_\nper_frame_2=beat + 1;\n", "s.milk");
    expect(m.perFrame).toBe("k1 = is_beat + 1;");
  });

  it("strips per-line comments before concatenating", () => {
    const m = parseMilk("[preset00]\nper_frame_1=a = 1; // set a\nper_frame_2=b = 2;\n", "s.milk");
    expect(m.perFrame).toBe("a = 1; b = 2;");
  });

  it("collects base values, equations, and enabled waves", () => {
    const m = parseMilk(FIXTURE, "Author - Nice Preset.milk");
    expect(m.name).toBe("Author - Nice Preset");
    expect(m.values.zoom).toBeCloseTo(1.02);
    expect(m.values.fdecay).toBeCloseTo(0.95);
    expect(m.perFrame).toContain("q1*0.03");
    expect(m.perFrameInit).toBe("q1 = 0.5;");
    expect(m.waves.length).toBe(1);
    expect(m.shapes.length).toBe(0);
  });

  it("collects per-shape values and equations", () => {
    const m = parseMilk(FIXTURE +
      "shapecode_1_enabled=1\nshapecode_1_sides=6\nshapecode_1_rad=0.3\n" +
      "shape_1_per_frame1=rad = rad + 0.1*sin(time);\n", "s.milk");
    expect(m.shapes.length).toBe(1);
    expect(m.shapes[0].values.sides).toBe(6);
    expect(m.shapes[0].perFrame).toContain("0.1*sin(time)");
  });

  it("collects MilkDrop 2 shader blocks without treating them as equations", () => {
    const m = parseMilk(FIXTURE + "warp_1=`sampler s;\nwarp_2=`float4 x;\n", "x.milk");
    expect(m.warpShader).toBe("sampler s;\nfloat4 x;");
    expect(m.perFrame).not.toContain("sampler");
  });
});

describe("milk preset to scene mapping", () => {
  const { scene, report } = milkToScene(parseMilk(FIXTURE, "fixture.milk"));

  it("produces expression mod routes for the mapped parameters", () => {
    expect(scene.mods.length).toBeGreaterThan(0);
    expect(scene.mods.every((m) => m.source === "expr")).toBe(true);
    const zoomRoute = scene.mods.find((m) => m.target === "mdZoom");
    expect(zoomRoute?.readVar).toBe("zoom");
    expect(zoomRoute?.init).toBe("q1 = 0.5;");
  });

  it("routes custom-wave equations through a namespaced env", () => {
    const waveRoutes = scene.mods.filter((r) => r.ns === "cw0");
    expect(waveRoutes.length).toBe(4); // r/g/b/a
    expect(waveRoutes[0].expr).toContain("r = ");
    expect(report.length).toBe(0); // clean import: nothing skipped or dropped
  });

  it("emits a warp-mesh program for per-pixel presets", () => {
    const { scene: s2, report: r2 } = milkToScene(parseMilk(
      FIXTURE + "per_pixel_1=zoom = zoom + rad*0.05;\n", "pp.milk"));
    expect(s2.warpMesh).toContain("rad*0.05");
    expect(r2.join(" ")).toContain("warp mesh");
  });

  it("all three stage bodies compile as valid WGSL through the real assembly path", () => {
    for (const stage of STAGES) {
      const body = scene.layers[stage].code;
      const { code } = assemble(stage, body, parseParams(body));
      expect(() => new WgslReflect(code), stage).not.toThrow();
    }
  });

  it("equations drive the params through the ModEngine per frame", () => {
    const engine = new ModEngine();
    const stageParams = Object.fromEntries(
      STAGES.map((s) => [s, parseParams(scene.layers[s].code)]),
    );
    const p1 = engine.evaluate(scene, stageParams, audio(1), 0);
    const zoomSlot = stageParams.post.find((p) => p.name === "mdZoom")?.slot;
    const waveRSlot = stageParams.fg.find((p) => p.name === "mdWaveR")?.slot;
    expect(zoomSlot).toBeDefined();
    // init ran (q1=0.5), then per-frame: zoom = 1.02 + 0 + (0.5*0.98+0.02)*0.03
    const zoom1 = p1.custom[zoomSlot as number]; // engine reuses the buffer per frame
    expect(zoom1).toBeCloseTo(1.02 + 0.51 * 0.03, 5);
    // wave_r = 0.5 + 0.5*sin(0) = 0.5
    expect(p1.custom[waveRSlot as number]).toBeCloseTo(0.5, 5);

    // q1 persists and accumulates across frames
    const p2 = engine.evaluate(scene, stageParams, audio(1), 1);
    expect(p2.custom[zoomSlot as number]).not.toBeCloseTo(zoom1, 8);
  });

  it("skips equations gracefully when they do not compile", () => {
    const broken = milkToScene(parseMilk("[preset00]\nper_frame_1=zoom = (;\n", "b.milk"));
    expect(broken.scene.mods.length).toBe(0);
    expect(broken.report.join(" ")).toContain("skipped");
  });
});
