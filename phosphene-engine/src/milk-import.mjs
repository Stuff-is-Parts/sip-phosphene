// .milk importer: source preset -> ordered source records + derived views.
// Parses the key=value format (milkdrop2 state.cpp:CState::Import model).
// THE RECIPE IS THE UNIT OF ENUMERATION: every nonblank source line becomes
// one ordered record carrying its line number and raw text, and the converter
// (src/phos.mjs milkToPhos) must consume every record explicitly. The vars and
// expressions views are DERIVED from the records for downstream consumers;
// the records are the authoritative converter input.
// REFUSAL DISCIPLINE (compatibility guideline): unsupported source content refuses
// naming the source line — nothing is silently dropped. scanMilk is the ONE
// classification pass: it records refusals as records and continues, so the
// studio's triage view can show every unconvertible line at once; importMilk
// (the only door conversion uses) throws at the FIRST refused record, so no
// partially-supported preset ever reaches the converter.

/** @typedef {{line:number, raw:string, kind:'section', name:string}} SectionRecord */
/** @typedef {{line:number, raw:string, kind:'value', key:string, value:number}} ValueRecord */
/** @typedef {{line:number, raw:string, kind:'equation', stage:'per-frame', key:string, code:string}} EquationRecord */
/** @typedef {{line:number, raw:string, kind:'comment', stage:'per-frame', key:string, text:string}} CommentRecord */
/** @typedef {SectionRecord|ValueRecord|EquationRecord|CommentRecord} SourceRecord */
/** @typedef {{line:number, raw:string, kind:'refused', reason:string}} RefusedRecord */

/** Tolerant per-line scan: one record per nonblank line, refusals included.
 *  @param {string} text @returns {(SourceRecord|RefusedRecord)[]} */
export function scanMilk(text) {
  const lines = text.split(/\r?\n/);
  /** @type {(SourceRecord|RefusedRecord)[]} */
  const records = [];
  /** @type {Map<string,number>} */
  const seenValueKeys = new Map();
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = (lines[i] ?? '').trim();
    if (!line) continue;
    const refuse = (/** @type {string} */ why) => { records.push({ line: lineNo, raw: line, kind: 'refused', reason: `line ${lineNo}: ${why}` }); };
    if (line.startsWith('[')) {
      if (line === '[preset00]') records.push({ line: lineNo, raw: line, kind: 'section', name: 'preset00' });
      else refuse(`unknown section "${line}" — refusing`);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) { refuse(`line without '=' is not supported: "${line}"`); continue; }
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1);
    if (/^per_frame_\d+$/.test(key)) {
      const vt = val.trim();
      const code = vt.replace(/\/\/.*$/, '').trim();
      if (code && code !== vt) {
        // BOTH code and a trailing comment: the expression VM does not yet
        // carry inline comments, and stripping one silently would drop source
        refuse(`"${key}" mixes code and a trailing comment — refusing rather than dropping the comment`);
      } else if (code) records.push({ line: lineNo, raw: line, kind: 'equation', stage: 'per-frame', key, code });
      else if (vt) records.push({ line: lineNo, raw: line, kind: 'comment', stage: 'per-frame', key, text: vt });
      else refuse(`"${key}" carries no content — refusing`);
      continue;
    }
    if (/^per_pixel_\d+$/.test(key) || /^per_vertex_\d+$/.test(key)) {
      // the engine does not yet execute per-vertex programs — refuse the key
      // entirely (code OR comment-only: both are source content)
      refuse(`"${key}" is a per-vertex line, which the engine does not yet execute — refusing`);
      continue;
    }
    if (key.startsWith('per_frame') || key.startsWith('per_pixel') || key.startsWith('per_vertex')) {
      // per_frame_init_N, per_pixel_init_N, malformed indices — real preset
      // content this importer does not yet support. Refuse, never drop.
      refuse(`unsupported equation key "${key}" — extend the importer before converting this preset`);
      continue;
    }
    const vt = val.trim();
    // the COMPLETE value must be a number — parseFloat's prefix parsing would
    // silently accept trailing garbage
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(vt)) {
      refuse(`value for "${key}" is not a complete number (${JSON.stringify(val)}) — refusing`);
      continue;
    }
    const prior = seenValueKeys.get(key);
    if (prior !== undefined) {
      // MilkDrop's reader semantics for duplicate keys are unwitnessed —
      // refuse rather than pick an occurrence (never fill with plausible behavior)
      refuse(`duplicate property "${key}" (first at line ${prior}) — duplicate-key semantics are unwitnessed, refusing`);
      continue;
    }
    seenValueKeys.set(key, lineNo);
    records.push({ line: lineNo, raw: line, kind: 'value', key, value: parseFloat(vt) });
  }
  return records;
}

/** Strict import — the only door conversion uses. Throws at the first refused
 *  record; a partially-supported preset never reaches the converter. */
export function importMilk(/** @type {string} */ text) {
  const all = scanMilk(text);
  const bad = all.find((r) => r.kind === 'refused');
  if (bad) throw new Error(`importMilk: ${/** @type {RefusedRecord} */ (bad).reason}`);
  const records = /** @type {SourceRecord[]} */ (all);
  // Derived views for downstream consumers (runtime IR shape, checks, engine).
  /** @type {Record<string,number>} */
  const vars = {};
  /** @type {string[]} */ const perFrame = [];
  /** @type {string[]} */ const perVertex = [];
  /** @type {string[]} */ const perFrameComments = [];
  for (const r of records) {
    if (r.kind === 'value') vars[r.key] = r.value;
    else if (r.kind === 'equation') perFrame.push(r.code);
    else if (r.kind === 'comment') perFrameComments.push(r.text);
  }
  return {
    format: 'phos/1',
    records,
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
