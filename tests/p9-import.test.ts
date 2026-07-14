import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
// eslint-disable-next-line
// @ts-ignore — module-build import (see wgsl_reflect.d.ts)
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { readFileSync } from "node:fs";
import { parseP9c, translateP9Glsl, p9ToScene } from "../src/import/p9";
import { assemble } from "../src/gpu/wgsl";
import { parseParams } from "../src/core/params";

const fixtures: Record<string, string> = JSON.parse(
  readFileSync(new URL("./fixtures/p9-shaders.json", import.meta.url), "utf8"),
);

describe("Plane9 GLSL -> WGSL transpiler (real corpus fixtures)", () => {
  for (const [name, glsl] of Object.entries(fixtures)) {
    it(`${name} transpiles to valid WGSL through the real assembly path`, () => {
      const { wgsl, warnings } = translateP9Glsl(glsl);
      expect(wgsl).toContain("fn render(c : Ctx) -> vec3f");
      const { code } = assemble("bg", wgsl, parseParams(wgsl));
      const reflect = new WgslReflect(code);
      expect(reflect.entry.fragment.length).toBe(1);
      // gIn warnings should be surfaced, not silently dropped
      if (glsl.includes("gIn1")) {
        expect(warnings.some((w) => w.includes("gIn1"))).toBe(true);
      }
    });
  }

  it("rewrites swizzle l-values (illegal in WGSL)", () => {
    const { wgsl } = translateP9Glsl(fixtures.StarBurst);
    expect(wgsl).not.toMatch(/\.rgb\s*\*=/);
    expect(wgsl).toContain("vec4f(col.rgb *");
  });

  it("maps texture sampling to the scene image", () => {
    const glsl = fixtures.StarBurst.replace(
      "vec4 col = (_noise",
      "vec4 tex = textureLod(gTexture1, vec2(0.5), 6.0);\n\tvec4 col = (_noise",
    );
    const { wgsl } = translateP9Glsl(glsl);
    expect(wgsl).toContain("img(vec2f(0.5))");
    const { code } = assemble("bg", wgsl, []);
    expect(new WgslReflect(code).entry.fragment.length).toBe(1);
  });
});

describe("p9c container parsing", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Plane9Scene FormatVersion="2" SceneType="2">
  <Author>Test Author</Author>
  <Desc>a test</Desc>
  <License Type="CC BY-NC-SA 3.0">...</License>
  <Nodes>
    <Node Type="Screen" Name="Screen1"><Port Id="CamFov" Value="45"/></Node>
    <Node Type="RenderRect" Name="R1"><Port Id="TesselateW" Value="1"/></Node>
    <Node Type="Shader" Name="S1">
      <Port Id="Shader"><Value>${fixtures.Laser_Light.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Value></Port>
    </Node>
  </Nodes>
</Plane9Scene>`;

  it("roundtrips a zip container and classifies tiers", () => {
    const zipped = zipSync({ "scene.xml": strToU8(xml) });
    const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    const p9 = parseP9c(buf as ArrayBuffer, "Test_Scene.p9c");
    expect(p9.name).toBe("Test Scene");
    expect(p9.author).toBe("Test Author");
    expect(p9.licenseType).toBe("CC BY-NC-SA 3.0");
    expect(p9.unsupported).toEqual([]);
    expect(p9.glsl).toContain("makePoint");

    const { scene, report } = p9ToScene(p9);
    expect(scene.name).toBe("TEST SCENE");
    expect(scene.credit).toContain("Test Author");
    expect(scene.license).toContain("CC BY-NC-SA");
    const { code } = assemble("bg", scene.layers.bg.code, parseParams(scene.layers.bg.code));
    expect(new WgslReflect(code).entry.fragment.length).toBe(1);
    expect(Array.isArray(report)).toBe(true);
  });
});
