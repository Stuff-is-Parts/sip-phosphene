import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { normalizeScene, type Scene } from "../core/types";
import { glslToRender } from "../transpile/glsl";

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

export function translateP9Glsl(glsl: string): TranspileResult {
  const { body, warnings } = glslToRender(glsl);
  return { wgsl: body, warnings };
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
