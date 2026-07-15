// Same-source proof comparator for MilkDrop equations vs butterchurn's
// converted JavaScript. The preset converter applies mechanical transforms
// that preserve content: a./Math. prefixes, compound-assignment
// canonicalization, decimal formatting (leading/trailing zeros), and
// commutative operand reordering. Exact string equality cannot survive the
// last one, so the proof criterion is:
//   per statement (in order): identical assignment target AND identical
//   token multiset of the right-hand side.
// This proves the fixture and corpus carry the same equations up to
// commutative reordering — a mechanical content check, not a name match.

const clean = (s) => String(s ?? "")
  .toLowerCase()
  .replace(/\/\/[^\n]*/g, "")
  .replace(/\bmath\./g, "")
  .replace(/\ba\./g, "")
  .replace(/\bvar\s+/g, "")
  .replace(/([a-z_]\w*)\s*\+=/g, "$1=$1+")
  .replace(/([a-z_]\w*)\s*-=/g, "$1=$1-")
  .replace(/([a-z_]\w*)\s*\*=/g, "$1=$1*")
  .replace(/([a-z_]\w*)\s*\/=/g, "$1=$1/")
  .replace(/\s+/g, "");

const normNumber = (t) => {
  if (!/^[\d.]+$/.test(t)) return t;
  let n = t;
  if (n.startsWith(".")) n = "0" + n;
  if (n.includes(".")) n = n.replace(/0+$/, "").replace(/\.$/, "");
  return n;
};

/** Statement list -> [{ lhs, rhsTokens (sorted) }]. */
export function eelStatements(text) {
  return clean(text)
    .split(";")
    .filter((s) => s.length > 0)
    .map((stmt) => {
      const eq = stmt.indexOf("=");
      const lhs = eq > 0 ? stmt.slice(0, eq) : "";
      const rhs = eq > 0 ? stmt.slice(eq + 1) : stmt;
      const tokens = (rhs.match(/[a-z_]\w*|[\d.]+|[^\sa-z0-9_.]/g) ?? [])
        .map(normNumber)
        .map((t) => (t === "%" ? "mod" : t))
        .filter((t) => t !== "(" && t !== ")" && t !== ",")
        .sort();
      return { lhs, rhs: tokens.join("") };
    });
}

/** Whole-body token multiset (framing-independent): statement boundaries
 * differ legitimately between MilkDrop line concatenation and the
 * converter's per-line framing, so tier 2 compares ALL tokens including
 * assignment targets, order-free. */
export function eelBodyFingerprint(text) {
  return eelStatements(text)
    .flatMap((s) => [s.lhs, s.rhs])
    .join(String.fromCharCode(1))
    .split(String.fromCharCode(1))
    .join("").split("").sort().join("");
}

/** Proof tiers: 1 = per-statement equality; 2 = whole-body token multiset
 * equality; 0 = unproven. */
export function eelProofTier(a, b) {
  if (eelSameSource(a, b)) return 1;
  if (eelBodyFingerprint(a) === eelBodyFingerprint(b)) return 2;
  return 0;
}

/** True when both texts carry the same statements per the proof criterion. */
export function eelSameSource(a, b) {
  const sa = eelStatements(a), sb = eelStatements(b);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i].lhs !== sb[i].lhs || sa[i].rhs !== sb[i].rhs) return false;
  }
  return true;
}
