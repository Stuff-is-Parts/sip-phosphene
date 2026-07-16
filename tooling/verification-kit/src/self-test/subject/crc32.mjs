// Deliberately minimal self-test subject (framework spec §24): a chunked CRC-32
// implementation whose correctness is established ONLY by comparison against the
// independent reference oracle (node:zlib crc32), never by its author.
// Stateful across chunk updates, which gives the stale-state and reordering
// defect classes a real surface.

const TABLE = buildTable();

function buildTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** @returns {number} */
export function crcInit() {
  return 0xffffffff;
}

/** @param {number} state @param {Uint8Array} bytes @returns {number} */
export function crcUpdate(state, bytes) {
  let c = state >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

/** @param {number} state @returns {number} */
export function crcFinalize(state) {
  return (state ^ 0xffffffff) >>> 0;
}
