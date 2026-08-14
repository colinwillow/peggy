// The game loop.
//
// Two things matter here and nothing else does:
//  1. dt is CLAMPED. A backgrounded tab hands you a 12-second frame; without a
//     clamp the player tunnels through the island and ends up under the map.
//  2. The physics step is FIXED. Locomotion, gravity and collision all run at a
//     constant 1/120s so jump heights and slope behaviour are identical on a
//     60Hz phone and a 144Hz desktop. Rendering still runs once per frame, with
//     an interpolation alpha so motion stays smooth between physics ticks.

const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.25;  // never simulate more than a quarter second of catch-up
const MAX_STEPS = 10;    // ~83ms of sim per frame, i.e. full speed down to 12fps

export class Loop {
  constructor({ update, render }) {
    this.update = update;
    this.render = render;
    this.running = false;
    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this.time = 0;
    /** Wall-clock seconds of the last rendered frame, for FPS readouts. */
    this.frameTime = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now() / 1000;
    this._acc = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _tick(nowMs) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    const now = nowMs / 1000;
    let frame = now - this._last;
    this._last = now;
    this.frameTime = frame;
    if (frame > MAX_FRAME) frame = MAX_FRAME;

    this._acc += frame;
    let steps = 0;
    while (this._acc >= FIXED_DT && steps < MAX_STEPS) {
      this.update(FIXED_DT, this.time);
      this.time += FIXED_DT;
      this._acc -= FIXED_DT;
      steps++;
    }
    // Spiral-of-death guard: if we blew the step budget, drop the backlog
    // rather than falling further behind every frame. The cost is that below
    // ~10fps the game runs in slow motion instead of stuttering — the right
    // trade, but worth knowing when a profile looks sluggish rather than jerky.
    if (steps >= MAX_STEPS) { this._acc = 0; this.starved = true; }
    else this.starved = false;

    this.render(this._acc / FIXED_DT, frame);
  }
}

export { FIXED_DT, MAX_STEPS };
