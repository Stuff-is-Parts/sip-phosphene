import { describe, it, expect } from "vitest";
// The package's default node entry is a broken CJS/ESM hybrid; use the module build.
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { assemble, PRESENT_WGSL } from "../src/gpu/wgsl";
import { parseParams } from "../src/core/params";
import {
  BG_NEBULA, BG_TUNNEL, BG_GRID,
  FG_RING, FG_ORBS, FG_BARS,
  POST_CLEAN, POST_CHROMA, POST_ECHO, POST_KALEIDO,
  TEMPLATE_BLANK,
  BG_STARFIELD, BG_MAGMA, BG_CELLS, BG_AURORA, BG_OBSIDIAN, BG_QUICKSILVER,
  FG_WEAVE, FG_SCOPE, FG_BURST, FG_COMETS,
  POST_CRT, POST_DRIFT, POST_RADIAL, POST_LIQUID,
} from "../src/shaders/library";
import type { StageId } from "../src/core/types";

const CASES: [string, StageId, string][] = [
  ["BG_NEBULA", "bg", BG_NEBULA],
  ["BG_TUNNEL", "bg", BG_TUNNEL],
  ["BG_GRID", "bg", BG_GRID],
  ["FG_RING", "fg", FG_RING],
  ["FG_ORBS", "fg", FG_ORBS],
  ["FG_BARS", "fg", FG_BARS],
  ["POST_CLEAN", "post", POST_CLEAN],
  ["POST_CHROMA", "post", POST_CHROMA],
  ["POST_ECHO", "post", POST_ECHO],
  ["POST_KALEIDO", "post", POST_KALEIDO],
  ["TEMPLATE_BLANK", "bg", TEMPLATE_BLANK],
  ["BG_STARFIELD", "bg", BG_STARFIELD],
  ["BG_MAGMA", "bg", BG_MAGMA],
  ["BG_CELLS", "bg", BG_CELLS],
  ["BG_AURORA", "bg", BG_AURORA],
  ["BG_OBSIDIAN", "bg", BG_OBSIDIAN],
  ["BG_QUICKSILVER", "bg", BG_QUICKSILVER],
  ["FG_WEAVE", "fg", FG_WEAVE],
  ["FG_SCOPE", "fg", FG_SCOPE],
  ["FG_BURST", "fg", FG_BURST],
  ["FG_COMETS", "fg", FG_COMETS],
  ["POST_CRT", "post", POST_CRT],
  ["POST_DRIFT", "post", POST_DRIFT],
  ["POST_RADIAL", "post", POST_RADIAL],
  ["POST_LIQUID", "post", POST_LIQUID],
];

describe("library shaders parse as valid WGSL through the real assembly path", () => {
  for (const [name, stage, body] of CASES) {
    it(name, () => {
      const params = parseParams(body);
      const { code } = assemble(stage, body, params);
      // WgslReflect throws on syntax errors.
      const reflect = new WgslReflect(code);
      const entries = reflect.entry;
      expect(entries.vertex.length).toBe(1);
      expect(entries.fragment.length).toBe(1);
    });
  }
  it("img() scene-image helper compiles in a bg stage", () => {
    const body = "fn render(c : Ctx) -> vec3f { return img(c.uv).rgb * c.bass; }";
    const { code } = assemble("bg", body, []);
    const reflect = new WgslReflect(code);
    expect(reflect.entry.fragment.length).toBe(1);
  });
  it("present pass parses", () => {
    const reflect = new WgslReflect(PRESENT_WGSL);
    expect(reflect.entry.fragment.length).toBe(1);
  });
});
