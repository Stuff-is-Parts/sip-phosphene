// The engine core: takes scene IR, runs per-frame expressions each frame,
// maintains the variable pool + feedback state, produces per-frame render
// state. Headless-capable (no GPU dependency in the core) so it's testable.
// The GPU render pass consumes engine.state; here the core is the graph +
// expression execution, which is the part that must be CORRECT.
import { compileEEL } from './expr-vm.mjs';

export class Engine {
  constructor(scene) {
    this.scene = scene;
    this.pool = { ...scene.vars };           // live variable pool
    this.perFrame = compileEEL(scene.expressions.perFrame);
    this.frame = 0;
    this.time = 0;
  }
  // advance one frame. audio = {bass,mid,treb,...}; time in seconds.
  step(dt, audio = {}) {
    this.time += dt;
    this.frame += 1;
    // inject engine-provided variables (milkdropfs.cpp:471+ sets these pre-eval)
    Object.assign(this.pool, {
      time: this.time, frame: this.frame, fps: dt > 0 ? 1 / dt : 60,
      bass: audio.bass ?? 1, mid: audio.mid ?? 1, treb: audio.treb ?? 1,
      bass_att: audio.bass ?? 1, mid_att: audio.mid ?? 1, treb_att: audio.treb ?? 1,
    });
    // run per-frame equations (the verified expression VM)
    this.perFrame(this.pool);
    // the resulting pool IS the render state: decay, zoom, rot, warp, ib_*, ob_*
    return this.renderState();
  }
  renderState() {
    const p = this.pool;
    return {
      decay: p.fDecay ?? p.decay ?? 0.98,
      zoom: p.zoom ?? 0, rot: p.rot ?? 0, warp: p.warp ?? 0,
      innerBox: { size: p.ib_size ?? 0, r: p.ib_r ?? 0, g: p.ib_g ?? 0, b: p.ib_b ?? 0, a: p.ib_a ?? 0 },
      outerBox: { size: p.ob_size ?? 0, r: p.ob_r ?? 0, g: p.ob_g ?? 0, b: p.ob_b ?? 0, a: p.ob_a ?? 0 },
    };
  }
}
