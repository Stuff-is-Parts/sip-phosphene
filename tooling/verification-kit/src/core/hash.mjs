import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** @param {Buffer | string} data @returns {string} lowercase hex sha256 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** @param {string} absolutePath @returns {{ sha256: string, bytes: number }} */
export function hashFile(absolutePath) {
  const buf = readFileSync(absolutePath);
  return { sha256: sha256Hex(buf), bytes: buf.length };
}

/**
 * Deterministic JSON serialization: object keys sorted at every level.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** @param {unknown} v @returns {unknown} */
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(/** @type {Record<string, unknown>} */ (v)[k]);
    return out;
  }
  return v;
}

/** @param {unknown} value @returns {string} sha256:<hex> over canonical JSON */
export function canonicalJsonHash(value) {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}
