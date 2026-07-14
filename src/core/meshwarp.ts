import { compile, type Program } from "./expr";
import type { Scene } from "./types";

/**
 * MilkDrop per-pixel (per-vertex mesh) warp: the program runs at each point
 * of a coarse grid every frame with x/y/rad/ang inputs and may modify
 * zoom/rot/warp/dx/dy/sx/sy/cx/cy. The resulting UV displacement per vertex
 * is packed as RG float pairs for the POST stage's meshOff() texture.
 */

export const MESH_W = 32;
export const MESH_H = 24;

const OUT_VARS = ["zoom", "rot", "warp", "dx", "dy", "sx", "sy", "cx", "cy", "zoomexp"] as const;

const cache = new WeakMap<Scene, MeshWarp | null>();

/** Per-scene compiled warp mesh, cached; null when the scene has none. */
export function meshWarpFor(scene: Scene): MeshWarp | null {
  if (!scene.warpMesh) return null;
  let mw = cache.get(scene);
  if (mw === undefined) {
    mw = new MeshWarp(scene.warpMesh);
    cache.set(scene, mw);
  }
  return mw;
}

export class MeshWarp {
  private prog: Program | null;
  /** null when the program failed to compile; error carries the reason. */
  readonly error: string | null;
  private readonly data = new Float32Array(MESH_W * MESH_H * 2);
  private readonly env: Record<string, number> = {};

  constructor(source: string) {
    let prog: Program | null = null;
    let error: string | null = null;
    try {
      prog = compile(source);
    } catch (err) {
      error = (err as Error).message;
    }
    this.prog = prog;
    this.error = error;
  }

  /**
   * Evaluate one frame. `frameVars` carries the per-frame equation outputs
   * and audio builtins the per-vertex program reads (MilkDrop runs per-pixel
   * after per-frame, with its results in scope).
   */
  evaluate(frameVars: Record<string, number>, time: number): Float32Array {
    const e = this.env;
    for (const k of Object.keys(frameVars)) e[k] = frameVars[k];
    e.time = time;
    for (let gy = 0; gy < MESH_H; gy++) {
      for (let gx = 0; gx < MESH_W; gx++) {
        const u = gx / (MESH_W - 1);
        const v = gy / (MESH_H - 1);
        const x = u * 2 - 1;
        const y = v * 2 - 1;
        e.x = u; e.y = v;
        e.rad = Math.sqrt(x * x + y * y) * 0.7071;
        e.ang = Math.atan2(y, x);
        for (const k of OUT_VARS) e[k] = frameVars[k] ?? (k === "zoom" || k === "sx" || k === "sy" ? 1 : k === "cx" || k === "cy" ? 0.5 : k === "zoomexp" ? 1 : 0);
        this.prog?.run(e);

        // MilkDrop warp transform: zoom about (cx,cy), scale, rotate, warp
        // wobble, translate — output is the sampling displacement in UV space.
        const zoom = Math.pow(e.zoom ?? 1, Math.pow(e.zoomexp ?? 1, e.rad * 2 - 1));
        let u2 = (u - (e.cx ?? 0.5)) / Math.max(0.01, zoom * (e.sx ?? 1));
        let v2 = (v - (e.cy ?? 0.5)) / Math.max(0.01, zoom * (e.sy ?? 1));
        const rot = e.rot ?? 0;
        if (rot !== 0) {
          const c = Math.cos(rot); const s = Math.sin(rot);
          const ru = u2 * c - v2 * s;
          const rv = u2 * s + v2 * c;
          u2 = ru; v2 = rv;
        }
        const w = (e.warp ?? 0) * 0.0035;
        u2 += w * (Math.sin(time * 1.79 + u * 11.68 + v * 4.33) + Math.sin(time * 0.81 + v * 7.42));
        v2 += w * (Math.cos(time * 1.53 + v * 10.54 + u * 3.61) + Math.cos(time * 0.94 + u * 8.11));
        u2 += (e.cx ?? 0.5) - (e.dx ?? 0);
        v2 += (e.cy ?? 0.5) - (e.dy ?? 0);

        const i = (gy * MESH_W + gx) * 2;
        this.data[i] = u2 - u;
        this.data[i + 1] = v2 - v;
      }
    }
    return this.data;
  }
}
