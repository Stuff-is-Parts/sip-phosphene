/**
 * Deep comparison producing the path of the first divergence in document order.
 * Paths: arrays as name[i], object fields as name.field, root as ''.
 * @param {unknown} expected @param {unknown} actual @param {string} [path]
 * @returns {{ equal: boolean, firstDivergence: string | null, expectedAt?: unknown, actualAt?: unknown }}
 */
export function deepCompare(expected, actual, path = '') {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return diverge(path, expected, actual);
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      if (i >= expected.length || i >= actual.length) return diverge(`${path}[${i}]`, expected[i], /** @type {unknown[]} */ (actual)[i]);
      const r = deepCompare(expected[i], actual[i], `${path}[${i}]`);
      if (!r.equal) return r;
    }
    return { equal: true, firstDivergence: null };
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return diverge(path, expected, actual);
    const eKeys = Object.keys(expected);
    const aKeys = Object.keys(actual);
    for (const k of eKeys) {
      const childPath = path ? `${path}.${k}` : k;
      if (!(k in /** @type {Record<string, unknown>} */ (actual))) return diverge(childPath, /** @type {Record<string, unknown>} */ (expected)[k], undefined);
      const r = deepCompare(
        /** @type {Record<string, unknown>} */ (expected)[k],
        /** @type {Record<string, unknown>} */ (actual)[k],
        childPath
      );
      if (!r.equal) return r;
    }
    for (const k of aKeys) {
      if (!(k in /** @type {Record<string, unknown>} */ (expected))) {
        const childPath = path ? `${path}.${k}` : k;
        return diverge(childPath, undefined, /** @type {Record<string, unknown>} */ (actual)[k]);
      }
    }
    return { equal: true, firstDivergence: null };
  }
  if (Object.is(expected, actual)) return { equal: true, firstDivergence: null };
  return diverge(path, expected, actual);
}

/** @param {string} path @param {unknown} expectedAt @param {unknown} actualAt @returns {{equal: false, firstDivergence: string, expectedAt: unknown, actualAt: unknown}} */
function diverge(path, expectedAt, actualAt) {
  return { equal: false, firstDivergence: path === '' ? '(root)' : path, expectedAt, actualAt };
}

/**
 * Apply a comparator record to expected/actual values.
 * Exact equality is the default; tolerances apply only to numbers and only when justified.
 * @param {any} comparator @param {unknown} expected @param {unknown} actual
 * @returns {{ equal: boolean, firstDivergence: string | null, expectedAt?: unknown, actualAt?: unknown }}
 */
export function applyComparator(comparator, expected, actual) {
  if (comparator.equalityMode === 'exact') return deepCompare(expected, actual);
  return tolerancedCompare(expected, actual, comparator.tolerance, '');
}

/** @param {unknown} expected @param {unknown} actual @param {number} tolerance @param {string} path @returns {{ equal: boolean, firstDivergence: string | null, expectedAt?: unknown, actualAt?: unknown }} */
function tolerancedCompare(expected, actual, tolerance, path) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(expected - actual) <= tolerance) return { equal: true, firstDivergence: null };
    return diverge(path === '' ? '(root)' : path, expected, actual);
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      if (i >= expected.length || i >= actual.length) return diverge(`${path}[${i}]`, expected[i], actual[i]);
      const r = tolerancedCompare(expected[i], actual[i], tolerance, `${path}[${i}]`);
      if (!r.equal) return r;
    }
    return { equal: true, firstDivergence: null };
  }
  return deepCompare(expected, actual, path);
}
