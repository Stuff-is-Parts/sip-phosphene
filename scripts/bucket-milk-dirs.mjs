import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync("docs/render-verify-milk.json", "utf8"));
const dirs = {};
for (const f of r.failures) {
  const seg = f.file.split(/[\\/]/)[0];
  dirs[seg] = (dirs[seg] ?? 0) + 1;
}
console.log("MilkDrop pass:", r.buckets.pass, "/", r.total);
Object.entries(dirs).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(3), k));
