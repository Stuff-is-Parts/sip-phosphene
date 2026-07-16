/** Glob match supporting '*' wildcards only. @param {string} pattern @param {string} id @returns {boolean} */
export function matchPattern(pattern, id) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(id);
}
