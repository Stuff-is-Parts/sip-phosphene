import { describe, it, expect } from "vitest";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { assemble } from "../src/gpu/wgsl";
import { parseParams } from "../src/core/params";

// Exercises every stdlib helper added for visualizer parity so a signature
// or syntax break in COMMON fails here, not in a browser.
const BODY = `//@param amt 0.0 2.0 0.5
fn render(c : Ctx) -> vec3f {
  let wuv = warpUV(c.uv, 1.02, 0.05, vec2f(0.01, 0.0), amt(), c.t);
  var col = prevTex(wuv) * 0.95;
  col += vec3f(1.0) * waveLine(c.q, -0.8, 0.8, 0.4, 0.0, 0.01);
  let p = opRep(vec3f(c.q, 1.0), vec3f(2.0));
  let d = min(sdCylinder(p, 0.5, 0.2), sdSphere(p, 0.3));
  col += pal(d) * smoothstep(0.1, 0.0, d) * 0.2;
  return col * c.intensity;
}`;

describe("parity stdlib helpers compile through the real assembly path", () => {
  it("warpUV, waveLine, sdCylinder, opRep", () => {
    const params = parseParams(BODY);
    const { code } = assemble("post", BODY, params);
    expect(() => new WgslReflect(code)).not.toThrow();
  });
});
