import type { MeshPrimitive } from "../core/types";

/**
 * Rasterized 3D layer: parametric primitives with per-instance placement,
 * drawn depth-tested between BG and FG. The scene's mesh `code` implements:
 *   fn instancePos(idx : f32, t : f32) -> vec4f   // xyz + uniform scale
 *   fn meshColor(idx : f32, n : vec3f, wp : vec3f, t : f32) -> vec3f
 */

export interface MeshGeometry {
  /** Interleaved position(3) + normal(3). */
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
}

function build(pos: number[], norm: number[], idx: number[]): MeshGeometry {
  const vertices = new Float32Array((pos.length / 3) * 6);
  for (let i = 0; i < pos.length / 3; i++) {
    vertices.set(pos.slice(i * 3, i * 3 + 3), i * 6);
    vertices.set(norm.slice(i * 3, i * 3 + 3), i * 6 + 3);
  }
  return { vertices, indices: new Uint32Array(idx) };
}

function latLong(
  rings: number, segs: number,
  point: (u: number, v: number) => [number[], number[]],
): MeshGeometry {
  const pos: number[] = [];
  const norm: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s <= segs; s++) {
      const [p, n] = point(s / segs, r / rings);
      pos.push(...p);
      norm.push(...n);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s;
      const b = a + segs + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return build(pos, norm, idx);
}

export function makeGeometry(primitive: MeshPrimitive): MeshGeometry {
  switch (primitive) {
    case "cube": {
      const pos: number[] = [];
      const norm: number[] = [];
      const idx: number[] = [];
      const faces: [number[], number[], number[]][] = [
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
        [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      ];
      faces.forEach(([n, u, v], f) => {
        const base = f * 4;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          pos.push(
            (n[0] + u[0] * su + v[0] * sv) * 0.5,
            (n[1] + u[1] * su + v[1] * sv) * 0.5,
            (n[2] + u[2] * su + v[2] * sv) * 0.5);
          norm.push(...n);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      return build(pos, norm, idx);
    }
    case "sphere":
      return latLong(16, 24, (u, v) => {
        const th = u * Math.PI * 2;
        const ph = v * Math.PI;
        const n = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
        return [n.map((x) => x * 0.5), n];
      });
    case "plane":
      return build(
        [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5],
        [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
        [0, 1, 2, 0, 2, 3]);
    case "cylinder":
      return latLong(1, 24, (u, v) => {
        const th = u * Math.PI * 2;
        const n = [Math.cos(th), 0, Math.sin(th)];
        return [[n[0] * 0.5, v - 0.5, n[2] * 0.5], n];
      });
    case "torus":
      return latLong(16, 24, (u, v) => {
        const th = u * Math.PI * 2;
        const ph = v * Math.PI * 2;
        const cx = Math.cos(th) * 0.35;
        const cz = Math.sin(th) * 0.35;
        const n = [Math.cos(th) * Math.cos(ph), Math.sin(ph), Math.sin(th) * Math.cos(ph)];
        return [[cx + n[0] * 0.15, n[1] * 0.15, cz + n[2] * 0.15], n];
      });
  }
}

/** Uniforms/ctx head shared with the fullscreen stages, plus the 3D camera. */
export const MESH_WGSL_HEAD = /* wgsl */ `
struct Uniforms {
  resTime : vec4f, bands : vec4f, parms : vec4f, xtra : vec4f,
  spec : array<vec4f, 16>, wave : array<vec4f, 16>, cust : array<vec4f, 12>,
};
@group(0) @binding(0) var<uniform> U : Uniforms;
fn spec(i : i32) -> f32 { let j = clamp(i, 0, 63); return U.spec[j / 4][j % 4]; }
fn wav(i : i32) -> f32 { let j = clamp(i, 0, 63); return U.wave[j / 4][j % 4]; }
fn custSlot(i : i32) -> f32 { let j = clamp(i, 0, 47); return U.cust[j / 4][j % 4]; }
fn hue3(h : f32) -> vec3f {
  let x = fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0));
  return clamp(abs(x * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
}
fn pal(t : f32) -> vec3f { return hue3(t + U.parms.x); }
fn rot2(a : f32) -> mat2x2f {
  let c = cos(a); let s = sin(a);
  return mat2x2f(c, -s, s, c);
}

struct MVOut {
  @builtin(position) pos : vec4f,
  @location(0) n : vec3f,
  @location(1) wp : vec3f,
  @location(2) idx : f32,
};

const CAM_POS = vec3f(0.0, 0.0, 4.33);
const CAM_FOV_SCALE = 1.4; // matches camRay's implicit 70-degree fov

fn project(wp : vec3f) -> vec4f {
  let aspect = U.resTime.x / U.resTime.y;
  let view = wp - CAM_POS;
  // camera looks down -z; standard perspective with near 0.1, far 100
  let z = -view.z;
  let px = view.x * CAM_FOV_SCALE / aspect;
  let py = view.y * CAM_FOV_SCALE;
  let a = 100.0 / (100.0 - 0.1);
  let b = -0.1 * a;
  return vec4f(px, py, z * a + b, z);
}
`;

export const MESH_WGSL_TAIL = /* wgsl */ `
@vertex
fn vmain(
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @builtin(instance_index) inst : u32,
) -> MVOut {
  var out : MVOut;
  let t = U.resTime.z * U.parms.y;
  let ip = instancePos(f32(inst), t);
  let wp = position * ip.w + ip.xyz;
  out.pos = project(wp);
  out.n = normal;
  out.wp = wp;
  out.idx = f32(inst);
  return out;
}

@fragment
fn fmain(in : MVOut) -> @location(0) vec4f {
  let t = U.resTime.z * U.parms.y;
  let col = meshColor(in.idx, normalize(in.n), in.wp, t) * U.parms.z;
  return vec4f(col, 1.0);
}
`;

export function assembleMesh(body: string): string {
  return MESH_WGSL_HEAD + body + "\n" + MESH_WGSL_TAIL;
}

/** Billboard particle rendering: instance buffer of xyz+size, additive. */
export const PARTICLE_WGSL = MESH_WGSL_HEAD + /* wgsl */ `
struct PVOut {
  @builtin(position) pos : vec4f,
  @location(0) q : vec2f,
  @location(1) idx : f32,
};
@vertex
fn vmain(
  @builtin(vertex_index) vi : u32,
  @location(0) part : vec4f, // xyz + size
  @builtin(instance_index) inst : u32,
) -> PVOut {
  var out : PVOut;
  let corner = vec2f(f32(vi & 1u) * 2.0 - 1.0, f32(vi >> 1u) * 2.0 - 1.0);
  let center = project(part.xyz);
  let aspect = U.resTime.x / U.resTime.y;
  out.pos = center + vec4f(corner.x * part.w / aspect, corner.y * part.w, 0.0, 0.0) * center.w;
  out.q = corner;
  out.idx = f32(inst);
  return out;
}
@fragment
fn fmain(in : PVOut) -> @location(0) vec4f {
  let d = dot(in.q, in.q);
  let glow = exp(-d * 4.0);
  let col = pal(in.idx * 0.013 + U.bands.z * 0.2) * glow * U.parms.z;
  return vec4f(col, 1.0);
}
`;
