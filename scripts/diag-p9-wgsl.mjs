// Reflect the fully-assembled WGSL to find the browser-side error location.
import { readFileSync } from "node:fs";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { parseP9c } from "../src/import/p9";
import { glslToRender } from "../src/transpile/glsl";
import { assemble } from "../src/gpu/wgsl";
import { parseParams } from "../src/core/params";

const f = process.argv[process.argv.length - 1];
const raw = readFileSync(f);
const p9 = parseP9c(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), f);
const { body } = glslToRender(p9.glsl);
const { code, bodyLineOffset } = assemble("bg", body, parseParams(body));
try {
  new WgslReflect(code);
  console.log("WGSL OK");
} catch (err) {
  const msg = String(err.message ?? err);
  const m = /Line:\s*(\d+)/.exec(msg);
  const lineNum = m ? parseInt(m[1], 10) : -1;
  console.log("ERR:", msg);
  console.log("body line offset:", bodyLineOffset);
  if (lineNum > 0) {
    const lines = code.split("\n");
    for (let i = Math.max(0, lineNum - 3); i < Math.min(lines.length, lineNum + 2); i++) {
      console.log((i + 1 === lineNum ? "> " : "  ") + (i + 1) + ": " + lines[i]);
    }
  }
}
