// MilkDrop timekeeping, transcribed from CPluginShell::DoTime
// (MilkDrop2 @ Doormatty/MilkDrop2 d0670a3, vis_milk2/pluginshell.cpp:1895-1991,
// high-precision-timer branch; TIME_HIST_SLOTS=128 per pluginshell.h:42).
// Source semantics scene equations depend on: `time` advances by 1/fps where
// fps is damped from a frame-time history — NOT by raw elapsed dt — so
// animation stays smooth under timer jitter (the source's own stated goal at
// :1937-1943). Numerical note: C runs float32; this runs doubles.

const TIME_HIST_SLOTS = 128;

export class Timekeeper {
  fps = 30;
  time = 0;
  #frame = 0;
  #hist = new Array(TIME_HIST_SLOTS).fill(0); // cumulative frame times (zero-init assumption of the member array)
  #histPos = 0;

  // elapsed: seconds since last frame (high-precision timer path)
  tick(/** @type {number} */ elapsed) {
    if (this.#frame === 0) { this.fps = 30; this.time = 0; this.#histPos = 0; }
    let slots = TIME_HIST_SLOTS / 2;                              // :1933 high-perf branch
    this.time += 1.0 / this.fps;                                  // :1935
    if (this.#frame > TIME_HIST_SLOTS) {
      if (this.fps < 60) slots = Math.floor(slots * (0.1 + 0.9 * (this.fps / 60))); // :1947-1948
      if (elapsed > 5 / this.fps || elapsed > 1 || elapsed < 0) elapsed = 1 / 30;   // :1950-1951
      const old = /** @type {number} */ (this.#hist[(this.#histPos - slots + TIME_HIST_SLOTS) % TIME_HIST_SLOTS]);
      const nt = /** @type {number} */ (this.#hist[(this.#histPos - 1 + TIME_HIST_SLOTS) % TIME_HIST_SLOTS]) + elapsed;
      this.#hist[this.#histPos] = nt;
      this.#histPos = (this.#histPos + 1) % TIME_HIST_SLOTS;
      const newFps = slots / (nt - old);                          // :1961
      const damping = 0.87;                                       // :1962 high-perf value
      if (Math.abs(this.fps - newFps) > 3) this.fps = newFps;     // :1964-1967
      else this.fps = damping * this.fps + (1 - damping) * newFps;
    } else {
      const damping = 0.6;                                        // :1971 high-perf value
      if (this.#frame < 2) elapsed = 1 / 30;                      // :1973-1976
      else if (elapsed > 1 || elapsed < 0) elapsed = 1 / this.fps;
      const old = /** @type {number} */ (this.#hist[0]);          // :1978
      const nt = /** @type {number} */ (this.#hist[(this.#histPos - 1 + TIME_HIST_SLOTS) % TIME_HIST_SLOTS]) + elapsed;
      this.#hist[this.#histPos] = nt;
      this.#histPos = (this.#histPos + 1) % TIME_HIST_SLOTS;
      if (this.#frame > 0) {                                      // :1985-1989
        const newFps = this.#frame / (nt - old);
        this.fps = damping * this.fps + (1 - damping) * newFps;
      }
    }
    this.#frame += 1;
  }
  reset() { this.fps = 30; this.time = 0; this.#frame = 0; this.#hist.fill(0); this.#histPos = 0; }
}
