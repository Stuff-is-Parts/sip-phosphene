// Dump the final bound GLSL the parser sees.
import { readFileSync } from "node:fs";
import { parseP9c } from "../src/import/p9";

const f = process.argv[process.argv.length - 1];
const raw = readFileSync(f);
const p9 = parseP9c(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), f);

// mirror prepare+bindEngine+prelude — the actual bytes handed to parseShader
let src = p9.glsl.replace(/\r\n/g, "\n");
src = src.replace(/\/\*[\s\S]*?\*\//g, "");
src = src.replace(/;\s*\/(?=\s*[a-zA-Z_])/g, "; ");
src = src.replace(/VERTEXOUTPUT\s*\{[^}]*\}/, "");
src = src.replace(/\b(vec2|vec3|vec4|ivec2|ivec3|ivec4|mat2|mat3|mat4)(\s+\w+\s*=\s*)\{([^{}]*)\}/g,
  (_m, ty, mid, body) => `${ty}${mid}${ty}(${body})`);
src = src.replace(/=\s*(int|float)\s*\[\s*(\d+)\s*\]\s*\(/g, "= $1[$2]__ctor(");
src = src.replace(/#ifdef\s+VERTEX[\s\S]*?#endif/g, "");
src = src.replace(/#ifdef\s+VERTEX[\s\S]*?#else([\s\S]*?)#endif/g, "$1");
const fm = /#ifdef\s+FRAGMENT([\s\S]*?)#endif/.exec(src);
if (!fm) { console.log("NO FRAGMENT"); process.exit(1); }
const helpers = src.replace(/#ifdef\s+FRAGMENT[\s\S]*?#endif/, "");
const bound = helpers + "\n" + fm[1];
const lines = bound.split("\n");
const target = parseInt(process.argv[process.argv.length - 2], 10);
if (Number.isFinite(target)) {
  for (let i = Math.max(0, target - 4); i < Math.min(lines.length, target + 4); i++) {
    console.log((i + 1 === target ? "> " : "  ") + (i + 1) + ": " + lines[i]);
  }
} else {
  console.log(bound);
}
