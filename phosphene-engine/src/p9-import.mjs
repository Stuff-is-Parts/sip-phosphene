// Plane9 .p9c importer — container extraction plus a line-scanner in the
// same record discipline as milk-import.mjs. The scene grammar is the one
// witnessed across the corpus (Plane9Scene root, Node/Port/Connection):
// a zip holding scene.xml, tab-indented single-element XML per line.
// The strict door refuses every scene at its first node until Plane9 node
// operations are implemented as native operations in the shared executor
// (per PHOSPHENE-GOAL.md's "one native execution model, no parallel
// runtimes"). The triage view is the surface for unconverted .p9c drops.
import { unzipSync } from '../vendor/fflate/fflate.mjs';

/** @param {Uint8Array} bytes @returns {string} the archive's scene.xml text */
export function extractSceneXml(bytes) {
  const files = unzipSync(bytes);
  const entry = files['scene.xml'];
  if (!entry) throw new Error('.p9c refused: archive has no scene.xml (members: ' + Object.keys(files).join(', ') + ')');
  return new TextDecoder().decode(entry);
}

/**
 * Tolerant line scanner. Every non-blank line becomes exactly one record;
 * lines outside the witnessed grammar become refused records with reasons.
 * @param {string} xml
 * @returns {{kind:string, line:number, raw:string, type?:string, name?:string, id?:string, value?:string, out?:string, in?:string, reason?:string}[]}
 */
export function scanP9(xml) {
  /** @type {{kind:string, line:number, raw:string, type?:string, name?:string, id?:string, value?:string, out?:string, in?:string, reason?:string}[]} */
  const records = [];
  const lines = xml.split('\n');
  let inValue = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = /** @type {string} */ (lines[i]);
    const line = i + 1;
    const t = raw.trim();
    if (inValue) {
      // multiline <Value> payload (shader/expression text) — raw content
      records.push({ kind: 'value-content', line, raw });
      if (t.endsWith('</Value>')) inValue = false;
      continue;
    }
    if (t === '') { records.push({ kind: 'blank', line, raw }); continue; }
    let m;
    if (t === '<?xml version="1.0" encoding="UTF-8"?>') records.push({ kind: 'decl', line, raw });
    else if ((m = t.match(/^<Plane9Scene (.+)>$/))) records.push({ kind: 'root', line, raw, value: m[1] });
    else if (t === '</Plane9Scene>') records.push({ kind: 'root-close', line, raw });
    else if ((m = t.match(/^<(Author|Desc|Tags|License)(\s[^>]*)?>.*<\/\1>$/))) records.push({ kind: 'meta', line, raw, id: m[1] });
    else if ((m = t.match(/^<(Nodes|Connections|SceneCompatibility|GoodScenes|BadScenes)>$/))) records.push({ kind: 'open', line, raw, id: m[1] });
    else if ((m = t.match(/^<\/(Nodes|Connections|SceneCompatibility|GoodScenes|BadScenes|Node|Port)>$/))) records.push({ kind: 'close', line, raw, id: m[1] });
    else if ((m = t.match(/^<(GoodScenes|BadScenes)\/>$/))) records.push({ kind: 'meta', line, raw, id: m[1] });
    else if ((m = t.match(/^<Scene Name="([^"]*)"\/>$/))) records.push({ kind: 'compat-scene', line, raw, name: m[1] });
    else if ((m = t.match(/^<Node Type="([^"]+)" Name="([^"]+)"\/>$/))) records.push({ kind: 'node', line, raw, type: m[1], name: m[2] });
    else if ((m = t.match(/^<Node Type="([^"]+)" Name="([^"]+)">$/))) records.push({ kind: 'node-open', line, raw, type: m[1], name: m[2] });
    else if ((m = t.match(/^<Port Id="([^"]+)" Value="([^"]*)"\/>$/))) records.push({ kind: 'port', line, raw, id: m[1], value: m[2] });
    else if ((m = t.match(/^<Port Id="([^"]+)">$/))) records.push({ kind: 'port-open', line, raw, id: m[1] });
    else if ((m = t.match(/^<Value>(.*)<\/Value>$/))) records.push({ kind: 'value', line, raw, value: m[1] });
    else if ((m = t.match(/^<Value>(.*)$/))) { records.push({ kind: 'value-open', line, raw, value: m[1] }); inValue = true; }
    else if ((m = t.match(/^<Connection Out="([^".]+\.[^"]+)" In="([^".]+\.[^"]+)"\/>$/))) records.push({ kind: 'connection', line, raw, out: m[1], in: m[2] });
    else records.push({ kind: 'refused', line, raw, reason: 'line outside the witnessed scene.xml grammar' });
  }
  return records;
}

/**
 * Strict import door. Refuses at the first record it cannot faithfully
 * convert — which today is the first node, because no Plane9 node has a
 * native operation implemented in the shared Engine yet.
 * @param {string} xml
 */
export function importP9(xml) {
  const records = scanP9(xml);
  for (const rec of records) {
    if (rec.kind === 'refused') throw new Error('line ' + rec.line + ' refused: ' + rec.reason);
    if (rec.kind === 'node' || rec.kind === 'node-open') {
      throw new Error('line ' + rec.line + ' refused: node type "' + rec.type + '" — no native operation implemented yet');
    }
  }
  throw new Error('refused: scene has no nodes');
}

/**
 * Per-line dispositions for the triage view — same shape the .milk triage
 * consumes: {line, ok, text}.
 * @param {ReturnType<typeof scanP9>} records
 * @returns {{line:number, ok:boolean, text:string}[]}
 */
export function assessP9Records(records) {
  /** @type {{line:number, ok:boolean, text:string}[]} */
  const out = [];
  let node = '';
  for (const rec of records) {
    if (rec.kind === 'blank') continue;
    if (rec.kind === 'refused') { out.push({ line: rec.line, ok: false, text: rec.reason || 'refused' }); continue; }
    if (rec.kind === 'node' || rec.kind === 'node-open') {
      node = rec.name || '';
      out.push({ line: rec.line, ok: false, text: 'node ' + rec.type + ' — no native operation implemented yet' });
      continue;
    }
    if (rec.kind === 'port' || rec.kind === 'port-open') { out.push({ line: rec.line, ok: true, text: 'port ' + rec.id + ' of ' + node + ' (scanned)' }); continue; }
    if (rec.kind === 'value' || rec.kind === 'value-open' || rec.kind === 'value-content') { out.push({ line: rec.line, ok: true, text: 'embedded value text (scanned)' }); continue; }
    if (rec.kind === 'connection') { out.push({ line: rec.line, ok: true, text: 'connection ' + rec.out + ' → ' + rec.in + ' (structural)' }); continue; }
    out.push({ line: rec.line, ok: true, text: 'scene structure / metadata' });
  }
  return out;
}
