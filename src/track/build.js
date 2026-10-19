import { Vector3 } from 'three';
import { PHYS, TRACK } from '../config.js';
import { buildPlan, makeHeightFn, assembleDense } from './plan.js';
import { Piece } from './piece.js';
import { computeProfile, computeSpeedLimits } from './profile.js';

const Y = new Vector3(0, 1, 0);

/* ------------------------------------------------------------------ helpers */

function gaussSmooth(arr, sigma) {
  if (sigma < 0.5) return Float64Array.from(arr);
  const n = arr.length;
  const r = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-0.5 * (i / sigma) ** 2);
    k.push(w);
    sum += w;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += k[j + r] * arr[(((i + j) % n) + n) % n];
    out[i] = acc / sum;
  }
  return out;
}

function rotateAbout(v, axis, ang, out) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const cx = axis.clone().cross(v).multiplyScalar(s);
  return out.copy(v).multiplyScalar(c).add(cx);
}

/** Uniform arc-length resampling of the (closed) dense polyline. */
function resampleClosed(dense, planLength, ds) {
  const n0 = dense.X.length;
  const cum = new Float64Array(n0 + 1);
  for (let i = 0; i < n0; i++) {
    const j = (i + 1) % n0;
    cum[i + 1] = cum[i] + Math.hypot(dense.X[j] - dense.X[i], dense.Y[j] - dense.Y[i], dense.Z[j] - dense.Z[i]);
  }
  const L = cum[n0];
  const N = Math.round(L / ds);
  const dsx = L / N;
  const pos = new Float64Array(3 * N);
  const pp = new Float64Array(N);
  let seg = 0;
  for (let k = 0; k < N; k++) {
    const t = k * dsx;
    while (seg < n0 - 1 && cum[seg + 1] <= t) seg++;
    const a = seg;
    const b = (seg + 1) % n0;
    const span = cum[a + 1] - cum[a];
    const f = span > 1e-12 ? (t - cum[a]) / span : 0;
    pos[3 * k] = dense.X[a] + (dense.X[b] - dense.X[a]) * f;
    pos[3 * k + 1] = dense.Y[a] + (dense.Y[b] - dense.Y[a]) * f;
    pos[3 * k + 2] = dense.Z[a] + (dense.Z[b] - dense.Z[a]) * f;
    const pa = dense.P[a];
    const pb = b === 0 ? planLength : dense.P[b];
    pp[k] = pa + (pb - pa) * f;
  }
  // arc length of each inversion (loop) in the resampled domain
  const inversions = dense.marks.loops.map((l) => ({ id: l.id, s0: cum[l.start] * (N * dsx) / L, s1: cum[l.end] * (N * dsx) / L }));
  return { N, ds: dsx, L: N * dsx, pos, p: pp, inversions };
}

/** Rotate the resampled arrays so that sample i0 becomes sample 0 (the finish line). */
function rotateBase(base, i0) {
  const { N, ds } = base;
  const pos = new Float64Array(3 * N);
  const pp = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const src = (k + i0) % N;
    pos[3 * k] = base.pos[3 * src];
    pos[3 * k + 1] = base.pos[3 * src + 1];
    pos[3 * k + 2] = base.pos[3 * src + 2];
    pp[k] = base.p[src];
  }
  base.pos = pos;
  base.p = pp;
  const shift = i0 * ds;
  const L = base.L;
  for (const iv of base.inversions) {
    iv.s0 = (((iv.s0 - shift) % L) + L) % L;
    iv.s1 = (((iv.s1 - shift) % L) + L) % L;
  }
}

/* ------------------------------------------------------------------ frames */

function buildFrames(base, designSpeed) {
  const { N, ds, pos, inversions } = base;
  const P = (i) => new Vector3(pos[3 * ((i + N) % N)], pos[3 * ((i + N) % N) + 1], pos[3 * ((i + N) % N) + 2]);

  const T = new Array(N);
  for (let i = 0; i < N; i++) T[i] = P(i + 1).sub(P(i - 1)).normalize();

  // curvature vector dT/ds (smoothed a touch to remove sampling noise)
  const dTx = new Float64Array(N);
  const dTy = new Float64Array(N);
  const dTz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = T[(i + 1) % N];
    const b = T[(i - 1 + N) % N];
    dTx[i] = (a.x - b.x) / (2 * ds);
    dTy[i] = (a.y - b.y) / (2 * ds);
    dTz[i] = (a.z - b.z) / (2 * ds);
  }
  const sx = gaussSmooth(dTx, 0.35 / ds);
  const sy = gaussSmooth(dTy, 0.35 / ds);
  const sz = gaussSmooth(dTz, 0.35 / ds);
  const dT = new Array(N);
  for (let i = 0; i < N; i++) dT[i] = new Vector3(sx[i], sy[i], sz[i]);

  // inversion mask (with margin)
  const inv = new Uint8Array(N);
  const near = new Uint8Array(N);
  for (const iv of inversions) {
    for (let i = 0; i < N; i++) {
      const s = i * ds;
      if (s >= iv.s0 && s <= iv.s1) inv[i] = 1;
      if (s >= iv.s0 - 2.5 && s <= iv.s1 + 2.5) near[i] = 1;
    }
  }

  // world-up reference frame
  const Uref = new Array(N);
  const Rref = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = T[i];
    let u = Y.clone().addScaledVector(t, -t.y);
    if (u.lengthSq() < 1e-4) u = i > 0 ? Uref[i - 1].clone() : new Vector3(0, 1, 0);
    u.normalize();
    Uref[i] = u;
    Rref[i] = new Vector3().crossVectors(t, u);
  }

  // design bank angle: balance lateral load at the design speed
  const phiRaw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (near[i]) continue;
    const kRef = dT[i].dot(Rref[i]);
    const kUp = dT[i].dot(Uref[i]);
    const v2 = designSpeed[i] * designSpeed[i];
    const den = Math.max(0.3 * PHYS.G, PHYS.G * Uref[i].y + v2 * kUp);
    phiRaw[i] = Math.atan2(v2 * kRef, den);
  }
  const phi = gaussSmooth(phiRaw, 1.1 / ds);
  for (let i = 0; i < N; i++) phi[i] = near[i] ? 0 : Math.max(-TRACK.MAX_BANK, Math.min(TRACK.MAX_BANK, phi[i]));

  // Frames: world-up + bank everywhere, except inside inversions (loops) where the cart's up vector
  // is the curve's principal normal (it points at the loop centre, so lateral load stays ~0).
  const U = new Array(N);
  const R = new Array(N);
  const tmp = new Vector3();
  for (let i = 0; i < N; i++) {
    const t = T[i];
    let u;
    if (inv[i]) {
      u = dT[i].clone().addScaledVector(t, -dT[i].dot(t));
      if (u.lengthSq() < 1e-8) u = Uref[i].clone();
    } else {
      u = rotateAbout(Uref[i], t, phi[i], tmp).clone();
    }
    u.addScaledVector(t, -u.dot(t)).normalize();
    U[i] = u;
    R[i] = new Vector3().crossVectors(t, u);
  }

  // pack
  const f32 = (len) => new Float32Array(len);
  const out = {
    pos: f32(3 * N),
    tan: f32(3 * N),
    up: f32(3 * N),
    right: f32(3 * N),
    slope: f32(N),
    kSide: f32(N),
    kUp: f32(N),
    gSide: f32(N),
    gUp: f32(N),
    bank: f32(N),
    inv,
  };
  for (let i = 0; i < N; i++) {
    out.pos.set([pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], 3 * i);
    out.tan.set([T[i].x, T[i].y, T[i].z], 3 * i);
    out.up.set([U[i].x, U[i].y, U[i].z], 3 * i);
    out.right.set([R[i].x, R[i].y, R[i].z], 3 * i);
    out.slope[i] = T[i].y;
    out.kSide[i] = dT[i].dot(R[i]);
    out.kUp[i] = dT[i].dot(U[i]);
    out.gSide[i] = R[i].y;
    out.gUp[i] = U[i].y;
    out.bank[i] = phi[i];
  }
  return out;
}

/* ------------------------------------------------------------------ public */

/**
 * Build the baked track from a layout description.
 * Returns { piece, plan, anchors... } – everything the game, the bot and the renderer need.
 */
export function buildTrack(layout) {
  const plan = buildPlan(layout.plan);
  const P = plan.length;

  const resolveP = (a) => {
    if (typeof a === 'number') return a;
    const r = plan.byId[a.id];
    return a.d === 'end' ? r.p1 : r.p0 + (a.d ?? 0);
  };
  const knots = layout.heights.map(([anchor, y, m]) => ({ p: ((resolveP(anchor) % P) + P) % P, y, m }));
  const heightFn = makeHeightFn(knots, P);
  const dense = assembleDense(plan, heightFn);
  const base = resampleClosed(dense, P, TRACK.DS);
  const { N, ds } = base;

  // index (in plan order) of the sample where the lap starts, so s = 0 is the finish line
  const planP = base.p; // monotonic plan parameter per (unrotated) sample
  const findIndex = (p) => {
    p = ((p % P) + P) % P;
    let lo = 0;
    let hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (planP[mid] < p) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const i0 = layout.startAt ? findIndex(resolveP(layout.startAt)) : 0;
  const sOfP = (p) => ((findIndex(p) - i0 + N) % N) * ds;
  if (i0 !== 0) rotateBase(base, i0);
  const sOf = (a) => sOfP(resolveP(a));

  let design = new Float64Array(N).fill(7.2);
  let frames;
  let piece;
  for (let iter = 0; iter < 3; iter++) {
    frames = buildFrames(base, design);
    piece = new Piece({
      n: N,
      ds,
      length: base.L,
      closed: true,
      ...frames,
      p: Float32Array.from(base.p),
      zones: [],
      inversions: base.inversions,
    });
    piece.vLim = computeSpeedLimits(piece);
    piece.zones = (layout.zones ?? []).map((z) => ({ type: z.type, s0: sOf(z.from), s1: sOf(z.to), ...(z.extra ?? {}) }));
    const prof = computeProfile(piece);
    for (let i = 0; i < N; i++) design[i] = Math.min(10.5, Math.max(3.8, 0.7 * prof.v[i]));
    piece.profile = prof;
  }
  piece.profile = computeProfile(piece);
  piece.profileBoost = computeProfile(piece, { boost: true });

  const anchors = {};
  for (const [name, a] of Object.entries(layout.anchors ?? {})) anchors[name] = sOf(a);

  const track = {
    layout,
    plan,
    piece,
    length: piece.length,
    ds,
    anchors,
    pickups: (layout.pickups ?? []).map(sOf).sort((a, b) => a - b),
    checkpoints: (layout.checkpoints ?? []).map(sOf).sort((a, b) => a - b),
    sOf,
    referenceTime: piece.profile.time,
  };
  // bounding box
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < N; i++) {
    min.x = Math.min(min.x, piece.pos[3 * i]);
    min.y = Math.min(min.y, piece.pos[3 * i + 1]);
    min.z = Math.min(min.z, piece.pos[3 * i + 2]);
    max.x = Math.max(max.x, piece.pos[3 * i]);
    max.y = Math.max(max.y, piece.pos[3 * i + 1]);
    max.z = Math.max(max.z, piece.pos[3 * i + 2]);
  }
  track.bounds = { min, max };
  return track;
}
