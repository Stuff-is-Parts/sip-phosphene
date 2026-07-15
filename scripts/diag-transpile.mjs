// One-off: run fixture GLSL through the new transpiler and show WGSL errors.
import { readFileSync } from "node:fs";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { translateP9Glsl } from "../src/import/p9";
import { assemble } from "../src/gpu/wgsl";
import { parseParams } from "../src/core/params";

const fixtures = JSON.parse(readFileSync("tests/fixtures/p9-shaders.json", "utf8"));
for (const [name, glsl] of Object.entries(fixtures)) {
  try {
    const { wgsl } = translateP9Glsl(glsl);
    const { code } = assemble("bg", wgsl, parseParams(wgsl));
    try {
      new WgslReflect(code);
      console.log(name, "OK");
    } catch (err) {
      console.log("====", name, "WGSL INVALID:", String(err).slice(0, 200));
      console.log(wgsl.slice(0, 1200));
    }
  } catch (err) {
    console.log("====", name, "TRANSPILE THREW:", String(err).slice(0, 200));
  }
}
