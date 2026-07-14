import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { normalizeScene, type Scene } from "../core/types";

/** Parsed metadata + payload of a Plane9 .p9c container. */
export interface P9Scene {
  name: string;
  author: string;
  desc: string;
  licenseType: string;
  nodeTypes: string[];
  /** Raw GLSL of the first Shader node, if any. */
  glsl: string | null;
  usesFileTexture: boolean;
  /** Node types outside the directly-portable set. */
  unsupported: string[];
}

/** Node types the importer can map onto PHOSPHENE's pipeline directly. */
const PORTABLE = new Set(["Screen", "Clear", "RenderRect", "Shader", "FileTexture"]);

export function parseP9c(buf: ArrayBuffer, filename: string): P9Scene {
  const files = unzipSync(new Uint8Array(buf));
  const xmlEntry = Object.keys(files).find((k) => k.toLowerCase().endsWith("scene.xml"));
  if (!xmlEntry) throw new Error("no scene.xml in container — not a Plane9 scene file?");
  const xml = new TextDecoder().decode(files[xmlEntry]);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    isArray: (tag) => tag === "Node" || tag === "Port",
  });
  const doc = parser.parse(xml);
  const root = doc.Plane9Scene;
  if (!root) throw new Error("no Plane9Scene root element");

  const nodes: Array<Record<string, unknown>> = root.Nodes?.Node ?? [];
  const nodeTypes = nodes.map((n) => String(n["@Type"] ?? "?"));

  let glsl: string | null = null;
  for (const n of nodes) {
    if (n["@Type"] !== "Shader" || glsl) continue;
    const ports: Array<Record<string, unknown>> = (n as { Port?: [] }).Port ?? [];
    for (const p of ports) {
      if (p["@Id"] === "Shader") {
        const v = (p as { Value?: unknown }).Value;
        glsl = typeof v === "string" ? v : String((v as { "#text"?: string })?.["#text"] ?? "");
      }
    }
  }

  const lic = root.License;
  return {
    name: filename.replace(/\.p9c$/i, "").replace(/_/g, " "),
    author: String(root.Author ?? "unknown"),
    desc: String(root.Desc ?? ""),
    licenseType: String(lic?.["@Type"] ?? "unspecified"),
    nodeTypes,
    glsl,
    usesFileTexture: nodeTypes.includes("FileTexture"),
    unsupported: [...new Set(nodeTypes.filter((t) => !PORTABLE.has(t)))],
  };
}

/* ------------------- GLSL (Plane9 dialect) -> WGSL -------------------- */

export interface TranspileResult {
  wgsl: string;
  warnings: string[];
}

function extractSections(glsl: string): { helpers: string; body: string } {
  let src = glsl.replace(/\r\n/g, "\n");
  // strip VERTEXOUTPUT { ... }
  src = src.replace(/VERTEXOUTPUT\s*\{[^}]*\}/, "");
  // strip vertex block
  src = src.replace(/#ifdef\s+VERTEX[\s\S]*?#endif/, "");
  // pull fragment block
  const fm = /#ifdef\s+FRAGMENT([\s\S]*?)#endif/.exec(src);
  if (!fm) throw new Error("no FRAGMENT section found");
  const frag = fm[1];
  const helpers = src.replace(/#ifdef\s+FRAGMENT[\s\S]*?#endif/, "").trim();
  // unwrap void main() { ... }  (take everything after its opening brace to the last brace)
  const mm = /void\s+main\s*\(\s*\)\s*\{([\s\S]*)\}\s*$/.exec(frag.trim());
  if (!mm) throw new Error("no void main() in FRAGMENT section");
  return { helpers, body: mm[1] };
}

function convertCommon(code: string, warnings: string[]): string {
  let s = code;
  // constants and Plane9 stdlib
  s = s.replace(/\bPI2\b/g, "6.2831853");
  s = s.replace(/\bPI\b/g, "3.14159265");
  s = s.replace(/\b_noise\s*\(/g, "noise(");
  s = s.replace(/\b_tolinear\s*\(([^;]*?)\)/g, "pow($1, vec3f(2.2))");
  // engine inputs
  s = s.replace(/\bsi\.tex\b/g, "__uv");
  s = s.replace(/\bsi\.diffuse\b/g, "vec4f(1.0)");
  s = s.replace(/\bgTime\b/g, "__t");
  s = s.replace(/\bgColor1\b/g, "vec4f(1.0)");
  s = s.replace(/\bgColor2\b/g, "vec4f(1.0)");
  s = s.replace(/\bgColor\b/g, "vec4f(1.0)");
  s = s.replace(/\bgFrameNr\b/g, "(__t * 60.0)");
  // gIn1..3: Plane9 animates these from the node graph; fixed defaults + note
  for (const g of ["gIn1", "gIn2", "gIn3"]) {
    if (new RegExp("\\b" + g + "\\b").test(s)) {
      warnings.push(g + " was animated by the node graph — imported as a constant; tune or route via the mod matrix");
      s = s.replace(new RegExp("\\b" + g + "\\b", "g"), "__" + g);
    }
  }
  // texture sampling -> scene image
  s = s.replace(/\btextureLod\s*\(\s*gTexture\d\s*,\s*/g, "img(").replace(/\btexture(2D)?\s*\(\s*gTexture\d\s*,\s*/g, "img(");
  // strip a trailing LOD argument that textureLod left behind: img(x, 6.0) -> img(x)
  s = s.replace(/img\(([^;]*?),\s*[\d.]+\s*\)/g, "img($1)");
  // atan(y,x) -> atan2
  s = s.replace(/\batan\s*\(([^,()]+(?:\([^()]*\))?[^,()]*),/g, "atan2($1,");
  // vector constructors
  s = s.replace(/\bvec([234])\s*\(/g, "vec$1f(");
  s = s.replace(/\bmat2\s*\(/g, "mat2x2f(").replace(/\bmat3\s*\(/g, "mat3x3f(").replace(/\bmat4\s*\(/g, "mat4x4f(");
  // swizzle l-values (illegal in WGSL): x.rgb op= expr;  /  x.rgb = expr;
  s = s.replace(/(\w+)\.(rgb|xyz)\s*\*=\s*([^;]+);/g, "$1 = vec4f($1.$2 * ($3), $1.w);");
  s = s.replace(/(\w+)\.(rgb|xyz)\s*\+=\s*([^;]+);/g, "$1 = vec4f($1.$2 + ($3), $1.w);");
  s = s.replace(/(\w+)\.(rgb|xyz)\s*=\s*([^;]+);/g, "$1 = vec4f(($3), $1.w);");
  // declarations at statement starts
  s = s.replace(/(^|[;{]|\n)(\s*)float\s+(\w+)\s*=/g, "$1$2var $3 : f32 =");
  s = s.replace(/(^|[;{]|\n)(\s*)vec([234])\s+(\w+)\s*=/g, "$1$2var $4 : vec$3f =");
  s = s.replace(/(^|[;{]|\n)(\s*)int\s+(\w+)\s*=/g, "$1$2var $3 : i32 =");
  // output
  s = s.replace(/\boColor\b/g, "__out");
  if (s.includes("?")) warnings.push("ternary operator present — WGSL needs select(); review the marked lines");
  return s;
}

function convertHelpers(helpers: string, warnings: string[]): string {
  let s = convertCommon(helpers, warnings);
  // function signatures: float name(vec2 p, float a) { -> fn name(p : vec2f, a : f32) -> f32 {
  s = s.replace(
    /\b(float|vec2|vec3|vec4)\s+(\w+)\s*\(([^)]*)\)\s*\{/g,
    (_m, ret: string, name: string, args: string) => {
      const retT = ret === "float" ? "f32" : "vec" + ret.slice(3) + "f";
      const argList = args.trim() === "" ? "" : args.split(",").map((a) => {
        const parts = a.trim().split(/\s+/);
        const t = parts[0] === "float" ? "f32" : parts[0] === "int" ? "i32" : "vec" + parts[0].slice(3) + "f";
        return parts[1] + " : " + t;
      }).join(", ");
      return `fn ${name}(${argList}) -> ${retT} {`;
    });
  return s;
}

export function translateP9Glsl(glsl: string): TranspileResult {
  const warnings: string[] = [];
  const { helpers, body } = extractSections(glsl);
  const h = convertHelpers(helpers, warnings);
  const b = convertCommon(body, warnings);
  const gInDecls = ["gIn1", "gIn2", "gIn3"]
    .filter((g) => b.includes("__" + g) || h.includes("__" + g))
    .map((g) => `  let __${g} : vec3f = vec3f(0.4, 0.0, 0.3); // was node-animated in Plane9`)
    .join("\n");
  const wgsl =
    (h.trim() ? h.trim() + "\n\n" : "") +
    `fn render(c : Ctx) -> vec3f {
  let __uv = c.uv;
  let __t = c.t;
${gInDecls ? gInDecls + "\n" : ""}  var __out : vec4f = vec4f(0.0);
${b.trimEnd()}
  return __out.rgb * c.intensity;
}`;
  return { wgsl, warnings };
}

/* ------------------------- scene construction ------------------------- */

export function p9ToScene(p9: P9Scene): { scene: Scene; report: string[] } {
  const report: string[] = [];
  if (p9.unsupported.length) {
    report.push("unsupported nodes (scene will differ from the original): " + p9.unsupported.join(", "));
  }
  if (!p9.glsl) throw new Error("no Shader node — this scene is built entirely from engine nodes and must be re-authored");
  const { wgsl, warnings } = translateP9Glsl(p9.glsl);
  report.push(...warnings);
  if (p9.usesFileTexture) {
    report.push("original sampled a texture file — attach an image to this scene (SCENE IMAGE panel) for img() to sample");
  }
  const scene = normalizeScene({
    name: p9.name.toUpperCase(),
    layers: {
      bg: { code: wgsl },
      fg: { code: "fn render(c : Ctx) -> vec3f { return vec3f(0.0); }" },
      post: {
        code: "fn render(c : Ctx) -> vec3f {\n  var col = srcTex(c.uv);\n  col = max(col, prevTex(c.uv) * c.fb);\n  return col;\n}",
      },
    },
    credit: `Ported from Plane9 '${p9.name}' by ${p9.author}` + (p9.desc ? ` (${p9.desc})` : ""),
    license: p9.licenseType,
  });
  return { scene, report };
}
