// Bucket a compile-smoke report's failures into classes for the fix loop.
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[process.argv.length - 1], "utf8"));
const classes = {};
for (const f of r.failures) {
  if (f.bucket === "black") continue;
  const key = f.bucket[0] + ": " + f.detail.replace(/'[^']*'/g, "X").replace(/line \d+/g, "ln").slice(0, 52);
  if (!classes[key]) classes[key] = { c: 0, eg: f.file, d: f.detail.slice(0, 100) };
  classes[key].c++;
}
for (const [k, v] of Object.entries(classes).sort((a, b) => b[1].c - a[1].c).slice(0, 14)) {
  console.log(String(v.c).padStart(3), k, "||", v.eg.split(/[\\/]/).pop());
}
