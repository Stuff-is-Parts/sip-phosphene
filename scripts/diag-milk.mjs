// One-off diagnostic: print exact failing context for sample presets.
import { readFileSync } from "node:fs";
import { parseMilk } from "../src/import/milk";
import { compile } from "../src/core/expr";

const files = process.argv.slice(2).filter((a) => a.endsWith(".milk"));
for (const f of files) {
  const m = parseMilk(readFileSync(f, "latin1"), f);
  try {
    compile(m.perFrame);
    console.log("OK", f);
  } catch (e) {
    const pos = parseInt((/at (\d+)/.exec(e.message) ?? [])[1] ?? "-1", 10);
    console.log("ERR:", e.message, "—", f.split("/").pop());
    console.log("CTX:", JSON.stringify(m.perFrame.slice(Math.max(0, pos - 60), pos + 60)));
  }
}
