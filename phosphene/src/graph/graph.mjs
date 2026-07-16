// PHOSPHENE native graph model — seed. A graph is the single native execution
// contract: every behavior (native scenes, MilkDrop presets, Plane9 scenes)
// is represented as typed nodes executed by the native executor
// (PHOSPHENE-GOAL.md Formal Goal: one native execution model).

/** @type {Set<string>} */
export const NODE_TYPES = new Set(['milk-per-frame-expr']);

/**
 * @typedef {{ id: string, type: string, params: Record<string, unknown> }} NodeDef
 * @typedef {{ nodes: NodeDef[] }} GraphDef
 */

/**
 * Validate and construct a native graph from its definition.
 * Unknown node types are refused, never skipped or approximated.
 * @param {GraphDef} def
 * @returns {{ nodes: NodeDef[] }}
 */
export function createGraph(def) {
  if (!def || !Array.isArray(def.nodes) || def.nodes.length === 0) {
    throw new Error('graph definition requires a non-empty nodes array');
  }
  const ids = new Set();
  for (const node of def.nodes) {
    if (!node.id || ids.has(node.id)) throw new Error(`node id missing or duplicate: '${node.id}'`);
    ids.add(node.id);
    if (!NODE_TYPES.has(node.type)) {
      throw new Error(`unsupported node type '${node.type}' — the native graph contract must be extended, not approximated`);
    }
  }
  return { nodes: def.nodes };
}
