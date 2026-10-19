// Ghost recording / playback. A ghost is just "progress along the circuit sampled at a fixed rate":
//   progress = completedLaps * trackLength + s
// which is tiny to store and independent of the physics implementation.

export const GHOST_HZ = 30;

export class GhostRecorder {
  constructor() {
    this.samples = [];
    this.acc = 0;
    this.maxProgress = 0;
  }

  /** call every physics step with the player's race time and progress */
  record(time, progress, dt) {
    this.acc += dt;
    const period = 1 / GHOST_HZ;
    while (this.acc >= period - 1e-9) {
      this.acc -= period;
      this.samples.push(progress);
    }
  }

  finish() {
    return Float32Array.from(this.samples);
  }
}

export class Ghost {
  /** @param {Float32Array} samples progress sampled at GHOST_HZ from race start */
  constructor(samples, meta = {}) {
    this.samples = samples;
    this.meta = meta;
    this.duration = Math.max(0, (samples.length - 1) / GHOST_HZ);
    // monotone envelope for time <- progress lookups (derail respawns make raw progress dip)
    this.env = new Float32Array(samples.length);
    let m = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      m = Math.max(m, samples[i]);
      this.env[i] = m;
    }
  }

  /** progress at race time t (clamped to the final sample) */
  progressAt(t) {
    const n = this.samples.length;
    if (n === 0) return 0;
    const f = Math.max(0, t) * GHOST_HZ;
    const i = Math.floor(f);
    if (i >= n - 1) return this.samples[n - 1];
    const a = this.samples[i];
    const b = this.samples[i + 1];
    return a + (b - a) * (f - i);
  }

  /** race time at which the ghost reached `progress` (null if it never did) */
  timeAt(progress) {
    const n = this.env.length;
    if (n === 0 || progress > this.env[n - 1]) return null;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.env[mid] < progress) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    const a = this.env[lo - 1];
    const b = this.env[lo];
    const f = b > a ? (progress - a) / (b - a) : 0;
    return (lo - 1 + f) / GHOST_HZ;
  }
}

/* --------------------------------------------------------------- (de)serialisation */

export function encodeGhost(samples) {
  // quantise to 1/64 u, store as int32 deltas, base64
  const n = samples.length;
  const ints = new Int32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const q = Math.round(samples[i] * 64);
    ints[i] = q - prev;
    prev = q;
  }
  const bytes = new Uint8Array(ints.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeGhost(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ints = new Int32Array(bytes.buffer);
  const out = new Float32Array(ints.length);
  let acc = 0;
  for (let i = 0; i < ints.length; i++) {
    acc += ints[i];
    out[i] = acc / 64;
  }
  return out;
}
