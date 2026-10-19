// Frame pacing and dynamic resolution. Detects the display refresh rate from animation-frame
// timestamps, can cap rendering at 60 fps, and lowers the render scale when frames are missed,
// probing back up once there is headroom. Pure logic: no DOM or WebGL access.

const RATES = [30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 180, 240, 360];
const round = x => Math.round(x * 100) / 100;

export class FrameGovernor {
  constructor({cap = 'display', dynamic = true, minScale = 0.5, maxScale = 1} = {}) {
    this.cap = cap; // 'display' renders every vsync; '60' paces to 60 fps
    this.dynamic = dynamic;
    this.minScale = minScale;
    this.maxScale = maxScale;
    this.scale = maxScale;
    this.refreshHz = 60;
    this.fps = 0;
    this.ticks = [];
    this.tickCount = 0;
    this.probe = 0;
    this.lastTick = 0;
    this.lastRender = 0;
    this.due = 0;
    this.window = [];
    this.windowStart = 0;
    this.cooldownUntil = 0;
    this.calm = 0;
    this.probedAt = -Infinity;
    this.ceiling = maxScale;
    this.ceilingUntil = 0;
    this.rendered = [];
  }

  // A slow GPU also slows animation-frame callbacks, so the true refresh rate is measured while
  // nothing heavy renders: a short probe at startup and whenever the page becomes visible again.
  startProbe(frames = 24) {
    this.probe = frames;
    this.ticks.length = 0;
    this.lastTick = 0;
  }

  get probing() { return this.probe > 0; }

  // Call on every animation-frame callback. Returns true when this one should be rendered.
  tick(now) {
    if (this.lastTick) {
      const dt = now - this.lastTick;
      if (dt > 0 && dt < 100) {
        this.ticks.push(dt);
        if (this.ticks.length > 240) this.ticks.shift();
      }
    }
    this.lastTick = now;
    if (this.probe > 0) {
      if (--this.probe === 0) this.refreshHz = this.detectRefresh();
      return false;
    }
    // While rendering, intervals can only stretch, so the estimate is only ever raised.
    if (++this.tickCount % 30 === 0) this.refreshHz = Math.max(this.refreshHz, this.detectRefresh());
    if (this.cap !== '60') return true;
    const period = 1000 / 60;
    const tolerance = Math.min(4, 500 / this.refreshHz);
    if (now < this.due - tolerance) return false;
    this.due = now - this.due > period ? now + period : this.due + period;
    return true;
  }

  // The vsync interval is the floor of the callback intervals; the 10th percentile ignores jitter.
  detectRefresh() {
    if (this.ticks.length < 12) return this.refreshHz;
    const sorted = [...this.ticks].sort((a, b) => a - b);
    const hz = 1000 / sorted[Math.floor(sorted.length * 0.1)];
    let best = RATES[0];
    for (const r of RATES) if (Math.abs(r - hz) < Math.abs(best - hz)) best = r;
    return best;
  }

  get targetHz() { return this.cap === '60' ? Math.min(60, this.refreshHz) : this.refreshHz; }

  setCap(cap) { this.cap = cap; this.due = 0; this.window.length = 0; this.windowStart = 0; }
  setDynamic(dynamic) { this.dynamic = dynamic; if (!dynamic) this.scale = this.maxScale; }

  // Call after each rendered frame. Returns the new render scale when it should change, else null.
  frame(now) {
    const interval = this.lastRender ? now - this.lastRender : 0;
    this.lastRender = now;
    this.rendered.push(now);
    while (this.rendered.length > 2 && now - this.rendered[0] > 500) this.rendered.shift();
    this.fps = this.rendered.length > 1 ? ((this.rendered.length - 1) * 1000) / (now - this.rendered[0]) : 0;
    if (!interval || interval > 250) { this.window.length = 0; this.windowStart = now; return null; }
    this.window.push(interval);
    if (!this.windowStart) this.windowStart = now;
    if (now - this.windowStart < 1000) return null;
    const target = 1000 / this.targetHz;
    const missed = this.window.filter(f => f > target * 1.45).length / this.window.length;
    this.window.length = 0;
    this.windowStart = now;
    if (!this.dynamic || now < this.cooldownUntil) return null;
    if (missed > 0.12 && this.scale > this.minScale) {
      // A probe upward that immediately drops frames teaches us a ceiling for a while.
      if (now - this.probedAt < 2600) { this.ceiling = round(this.scale - 0.05); this.ceilingUntil = now + 20000; }
      this.scale = Math.max(this.minScale, round(this.scale - (missed > 0.4 ? 0.15 : 0.08)));
      this.cooldownUntil = now + 1500;
      this.calm = 0;
      return this.scale;
    }
    this.calm = missed < 0.02 ? this.calm + 1 : 0;
    const ceiling = now < this.ceilingUntil ? this.ceiling : this.maxScale;
    if (this.calm >= 3 && this.scale < ceiling) {
      this.scale = Math.min(ceiling, round(this.scale + 0.05));
      this.probedAt = now;
      this.calm = 0;
      this.cooldownUntil = now + 1000;
      return this.scale;
    }
    return null;
  }
}
