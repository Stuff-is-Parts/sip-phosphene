import { compile, type Program } from "./expr";
import type { AudioFeatures, Scene, SceneParticles } from "./types";

/**
 * Stateful CPU particle system. Each particle carries x/y/z, vx/vy/vz, size;
 * the scene's EEL program runs per particle per frame and may read/write all
 * of them (plus idx/count/time/dt and audio vars). Velocity integrates after
 * the program runs. Output packs xyz+size for the billboard instance buffer.
 */
export class ParticleSystem {
  private readonly state: Float32Array<ArrayBuffer>; // x y z vx vy vz size
  private readonly out: Float32Array<ArrayBuffer>;   // x y z size
  private readonly prog: Program | null;
  readonly error: string | null;
  readonly count: number;
  private lastTime: number | null = null;
  private readonly env: Record<string, number> = {};

  constructor(def: SceneParticles) {
    this.count = def.count;
    this.state = new Float32Array(this.count * 7);
    this.out = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      const o = i * 7;
      this.state[o] = (Math.random() - 0.5) * 3;
      this.state[o + 1] = (Math.random() - 0.5) * 3;
      this.state[o + 2] = (Math.random() - 0.5) * 3;
      this.state[o + 6] = 0.02;
    }
    let prog: Program | null = null;
    let error: string | null = null;
    try {
      prog = compile(def.code);
    } catch (err) {
      error = (err as Error).message;
    }
    this.prog = prog;
    this.error = error;
  }

  update(audio: AudioFeatures, time: number): Float32Array<ArrayBuffer> {
    const dt = this.lastTime === null ? 1 / 60 : Math.min(0.1, Math.max(0.001, time - this.lastTime));
    this.lastTime = time;
    const e = this.env;
    e.time = time; e.dt = dt; e.count = this.count;
    e.bass = audio.bass; e.mid = audio.mid; e.treb = audio.treble;
    e.beat = audio.beat; e.energy = audio.energy; e.bpm = audio.bpm;
    for (let i = 0; i < this.count; i++) {
      const o = i * 7;
      e.idx = i;
      e.x = this.state[o]; e.y = this.state[o + 1]; e.z = this.state[o + 2];
      e.vx = this.state[o + 3]; e.vy = this.state[o + 4]; e.vz = this.state[o + 5];
      e.size = this.state[o + 6];
      this.prog?.run(e);
      this.state[o] = e.x + e.vx * dt;
      this.state[o + 1] = e.y + e.vy * dt;
      this.state[o + 2] = e.z + e.vz * dt;
      this.state[o + 3] = e.vx; this.state[o + 4] = e.vy; this.state[o + 5] = e.vz;
      this.state[o + 6] = e.size;
      const q = i * 4;
      this.out[q] = this.state[o];
      this.out[q + 1] = this.state[o + 1];
      this.out[q + 2] = this.state[o + 2];
      this.out[q + 3] = this.state[o + 6];
    }
    return this.out;
  }
}

const cache = new WeakMap<Scene, ParticleSystem | null>();

/** Per-scene particle system, cached; null when the scene has none. */
export function particlesFor(scene: Scene): ParticleSystem | null {
  if (!scene.particles) return null;
  let ps = cache.get(scene);
  if (ps === undefined) {
    ps = new ParticleSystem(scene.particles);
    cache.set(scene, ps);
  }
  return ps;
}
