// Search Plane9 binaries for UTF-16LE-encoded shader text (Qt string
// storage) — specifically helper definitions absent from the ASCII dump.
// Usage: node scripts/extract-p9-utf16.mjs <needle> [file...]
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

const needle = process.argv[2];
const files = process.argv.slice(3);
if (!needle || !files.length) { console.error("usage: extract-p9-utf16 <needle> <file...>"); process.exit(1); }

const needleBuf = Buffer.from(needle, "utf16le");
for (const f of files) {
  const buf = readFileSync(f);
  let idx = 0, found = 0;
  for (;;) {
    idx = buf.indexOf(needleBuf, idx);
    if (idx < 0) break;
    found++;
    // expand window around the hit and decode as utf16le
    const start = Math.max(0, idx - 200);
    const end = Math.min(buf.length, idx + 1600);
    const text = buf.slice(start, end).toString("utf16le").replace(/[^\x20-\x7e\n\r\t]/g, "·");
    console.log(`=== ${f} @ ${idx} ===`);
    console.log(text);
    idx += needleBuf.length;
    if (found >= 3) break;
  }
  if (!found) console.log(`(no utf16 match in ${f})`);
}
