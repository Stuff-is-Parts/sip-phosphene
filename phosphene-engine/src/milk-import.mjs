// .milk importer: source preset -> PHOSPHENE scene IR.
// Parses the key=value format (milkdrop2 state.cpp:CState::Import model).
export function importMilk(/** @type {string} */ text) {
  const lines = text.split(/\r?\n/);
  const vars = /** @type {Record<string,number>} */ ({});           // baseline preset variables (defaults + literals)
  const perFrame = [];       // per_frame_N equations, in order
  const perVertex = [];      // per_pixel_N equations
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('[')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1);
    if (/^per_frame_\d+$/.test(key)) {
      const code = val.replace(/\/\/.*$/, '').trim();
      if (code) perFrame.push(code);
    } else if (/^per_pixel_\d+$/.test(key) || /^per_vertex_\d+$/.test(key)) {
      const code = val.replace(/\/\/.*$/, '').trim();
      if (code) perVertex.push(code);
    } else if (!key.startsWith('per_frame') && !key.startsWith('per_pixel')) {
      const num = parseFloat(val);
      if (!Number.isNaN(num)) vars[key] = num;
    }
  }
  // Emit the scene IR: a graph with one warp/feedback pass + composite,
  // driven by the expression programs. (SCENE-ANATOMY structure.)
  return {
    format: 'phos/1',
    vars,
    expressions: { perFrame, perVertex },
    // NOTE: this is a DESCRIPTOR of the fixed MilkDrop pipeline for display in
    // the studio. It is NOT yet an executable graph — the engine currently runs
    // the pipeline directly (engine.mjs), not by traversing these nodes. Making
    // the engine execute the graph is pending work (see PHOSPHENE-GOAL.md).
    pipelineDescriptor: [
      { id: 'warp', stage: 'warp-feedback' },
      { id: 'comp', stage: 'composite' },
    ],
  };
}
