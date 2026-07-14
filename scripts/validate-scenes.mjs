// CI gate for community scene PRs: schema + static WGSL validation of every layer,
// through the same assembly path the app uses.
import { readdirSync, readFileSync } from "node:fs";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { assemble } from "../src/gpu/wgsl.ts";
import { parseParams } from "../src/core/params.ts";
import { isScene } from "../src/core/types.ts";

const dir = new URL("../scenes/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".phos.json"));
let failed = 0;
for (const f of files) {
  try {
    const j = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    if (!isScene(j)) throw new Error("does not match PHOSPHENE scene schema (layers.bg/fg/post required)");
    for (const stage of ["bg", "fg", "post"]) {
      const body = j.layers[stage].code;
      const { code } = assemble(stage, body, parseParams(body));
      const r = new WgslReflect(code);
      if (r.entry.fragment.length !== 1) throw new Error(stage + ": no fragment entry after assembly");
    }
    console.log("✓", f);
  } catch (e) {
    console.error("✕", f, "—", e.message);
    failed++;
  }
}
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
const missing = files.filter((f) => !manifest.includes(f));
if (missing.length) { console.error("✕ manifest.json missing:", missing.join(", "), "— run: npm run scenes"); failed++; }
if (failed) { console.error(failed + " problem(s)"); process.exit(1); }
console.log("all scenes valid");
