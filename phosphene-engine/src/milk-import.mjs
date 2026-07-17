// .milk importer: source preset -> PHOSPHENE runtime IR.
// Parses the key=value format (milkdrop2 state.cpp:CState::Import model).
// REFUSAL DISCIPLINE (PHOSPHENE-GOAL.md): unsupported source content throws
// naming the line — nothing is silently dropped. Comment-only equation lines
// are source content and are retained verbatim in expressions.perFrameComments.
export function importMilk(/** @type {string} */ text) {
  const lines = text.split(/\r?\n/);
  const vars = /** @type {Record<string,number>} */ ({});           // baseline preset variables (defaults + literals)
  /** @type {string[]} */ const perFrame = [];       // per_frame_N equations, in order
  /** @type {string[]} */ const perVertex = [];      // per_pixel_N / per_vertex_N equations
  /** @type {string[]} */ const perFrameComments = []; // comment-only per_frame lines, verbatim
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('[')) {
      if (line === '[preset00]') continue; // the one section header the format defines
      throw new Error(`importMilk: unknown section "${line}" — refusing`);
    }
    const eq = line.indexOf('=');
    if (eq < 0) throw new Error(`importMilk: line without '=' is not supported: "${line}"`);
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1);
    if (/^per_frame_\d+$/.test(key)) {
      const code = val.replace(/\/\/.*$/, '').trim();
      if (code) perFrame.push(code);
      else if (val.trim()) perFrameComments.push(val.trim());
    } else if (/^per_pixel_\d+$/.test(key) || /^per_vertex_\d+$/.test(key)) {
      // the engine does not yet execute per-vertex programs — refuse at import
      // rather than carrying code that would never run (design/PHOS-FORMAT.md)
      const code = val.replace(/\/\/.*$/, '').trim();
      if (code) throw new Error(`importMilk: "${key}" carries per-vertex code, which the engine does not yet execute — refusing`);
    } else if (key.startsWith('per_frame') || key.startsWith('per_pixel') || key.startsWith('per_vertex')) {
      // per_frame_init_N, per_pixel_init_N, malformed indices — real preset
      // content this importer does not yet support. Refuse, never drop.
      throw new Error(`importMilk: unsupported equation key "${key}" — extend the importer before converting this preset`);
    } else {
      const vt = val.trim();
      // the COMPLETE value must be a number — parseFloat's prefix parsing would
      // silently accept trailing garbage
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(vt)) {
        throw new Error(`importMilk: value for "${key}" is not a complete number (${JSON.stringify(val)}) — refusing`);
      }
      vars[key] = parseFloat(vt);
    }
  }
  return {
    format: 'phos/1',
    vars,
    expressions: { perFrame, perVertex, perFrameComments },
    // Legacy display descriptor. The .phos scene graph (src/phos.mjs) is the
    // authoritative structure; this remains only for the check's import path.
    pipelineDescriptor: [
      { id: 'warp', stage: 'warp-feedback' },
      { id: 'comp', stage: 'composite' },
    ],
  };
}
