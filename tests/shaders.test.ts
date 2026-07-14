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
  it("present pass parses", () => {
    const reflect = new WgslReflect(PRESENT_WGSL);
    expect(reflect.entry.fragment.length).toBe(1);
  });
});
