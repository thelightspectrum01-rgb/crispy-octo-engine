import { PHYS } from '../config.js';

/**
 * Maximum speed at every sample so that the lateral load stays inside the grip budget
 * (assuming the driver leans optimally).
 */
export function computeSpeedLimits(piece) {
  const { n, kSide, gSide } = piece;
  const lim = new Float32Array(n);
  const total = (PHYS.GRIP + PHYS.LEAN) * PHYS.G;
  for (let i = 0; i < n; i++) {
    const a = kSide[i];
    const b = PHYS.G * gSide[i];
    if (Math.abs(a) < 1e-5) {
      lim[i] = 99;
      continue;
    }
    const num = total - Math.sign(a) * b;
    lim[i] = Math.sqrt(num > 0 ? num / Math.abs(a) : 0.25);
  }
  return lim;
}

function inLaunch(piece, s) {
  for (const z of piece.zones) {
    if (z.type === 'launch' && s >= z.s0 && s <= z.s1) return true;
  }
  return false;
}

/**
 * Best-case speed profile around the lap (classic forward / backward pass over the lateral-grip cap).
 * `boost: true` assumes boost is available everywhere (used for the bot's upper bound).
 * `margin` scales the cornering cap.
 */
export function computeProfile(piece, { boost = false, margin = 0.97, vmax = 14.5 } = {}) {
  const { n, ds, slope } = piece;
  const lim = piece.vLim ?? computeSpeedLimits(piece);
  const cap = new Float64Array(n);
  const top = boost ? PHYS.BOOST_TOP : vmax;
  for (let i = 0; i < n; i++) cap[i] = Math.min(lim[i] * margin, top);

  const accelAt = (i, v) => {
    let a = -PHYS.G * slope[i] - PHYS.DRAG * v * v - PHYS.ROLL;
    a += Math.min(PHYS.MOTOR_MAX, Math.max(0, PHYS.CRUISE_GAIN * (PHYS.CRUISE_V - v)));
    if (inLaunch(piece, i * ds) && v < PHYS.LAUNCH_V) a += PHYS.LAUNCH_ACCEL;
    if (boost) a += PHYS.BOOST_ACCEL * Math.max(0, 1 - v / PHYS.BOOST_TOP);
    return a;
  };

  const fwd = new Float64Array(n);
  let v2 = cap[0] * cap[0];
  for (let lap = 0; lap < 3; lap++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = accelAt(i, Math.sqrt(v2));
      v2 = Math.max(0.36, v2 + 2 * a * ds);
      v2 = Math.min(v2, cap[j] * cap[j]);
      if (lap === 2) fwd[j] = Math.sqrt(v2);
    }
  }
  const bwd = new Float64Array(n);
  v2 = cap[n - 1] * cap[n - 1];
  for (let lap = 0; lap < 3; lap++) {
    for (let i = n - 1; i >= 0; i--) {
      const vNext = Math.sqrt(v2);
      const decel = PHYS.BRAKE + PHYS.DRAG * vNext * vNext + PHYS.ROLL + PHYS.G * slope[i];
      v2 = vNext * vNext + 2 * Math.max(1, decel) * ds;
      v2 = Math.min(v2, cap[i] * cap[i]);
      if (lap === 2) bwd[i] = Math.sqrt(v2);
    }
  }
  const v = new Float32Array(n);
  let time = 0;
  for (let i = 0; i < n; i++) {
    v[i] = Math.min(fwd[i], bwd[i], cap[i]);
    time += ds / Math.max(v[i], 0.5);
  }
  return { v, time, cap: Float32Array.from(cap) };
}
