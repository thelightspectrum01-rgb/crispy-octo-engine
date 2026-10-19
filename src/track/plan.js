// Plan-view ("turtle") track builder + periodic height profile.
//
// The circuit is described as a list of primitives (straights, eased arcs, one loop module).
// Heading psi: 0 => +x, positive psi turns LEFT (towards -z, i.e. counter-clockwise seen from above).
// Two straights may be flagged as free ('A' / 'B'); their lengths are solved so the circuit closes exactly.

const TAU = Math.PI * 2;

/** Curvature of a primitive at local arc position u (trapezoid profile = eased arc). */
function curvatureAt(prim, u) {
  if (prim.type !== 'arc') return 0;
  const { kappa, len, ease } = prim._g;
  if (u < ease) return (kappa * u) / ease;
  if (u > len - ease) return (kappa * (len - u)) / ease;
  return kappa;
}

function prepare(prims, free) {
  return prims.map((src) => {
    const prim = { ...src };
    if (prim.type === 'line') {
      let len = prim.len;
      if (typeof len === 'string') len = free[len] ?? 0;
      prim._g = { len };
    } else if (prim.type === 'arc') {
      const ang = (prim.deg * Math.PI) / 180;
      const r = prim.r;
      const arcLen = r * Math.abs(ang);
      const ease = Math.min(prim.ease ?? 2.2, arcLen * 0.45);
      prim._g = { kappa: Math.sign(ang) / r, len: arcLen + ease, ease, ang };
    } else if (prim.type === 'loop') {
      prim._g = { len: 0 };
    }
    return prim;
  });
}

function walk(prims, step) {
  let x = 0;
  let z = 0;
  let psi = 0;
  let p = 0;
  const xs = [x];
  const zs = [z];
  const psis = [psi];
  const ps = [p];
  const info = [];
  const loops = [];
  for (const prim of prims) {
    const rec = { id: prim.id, type: prim.type, p0: p, start: { x, z, psi } };
    if (prim.type === 'loop') {
      const nlx = -Math.sin(psi);
      const nlz = -Math.cos(psi);
      loops.push({ id: prim.id, p, x, z, psi, R: prim.R, lateral: prim.lateral, sampleIndex: xs.length - 1 });
      x += nlx * prim.lateral;
      z += nlz * prim.lateral;
      xs.push(x);
      zs.push(z);
      psis.push(psi);
      ps.push(p);
      rec.p1 = p;
      rec.end = { x, z, psi };
      info.push(rec);
      continue;
    }
    const len = prim._g.len;
    if (len > 0) {
      const n = Math.max(1, Math.ceil(len / step));
      const h = len / n;
      const sgn = prim.type === 'arc' ? Math.sign(prim.deg) : 0;
      for (let i = 0; i < n; i++) {
        const u = i * h;
        const k = curvatureAt(prim, u + h / 2);
        const psiN = psi + k * h;
        const pa = (psi + psiN) / 2;
        x += Math.cos(pa) * h;
        z += -Math.sin(pa) * h;
        psi = psiN;
        p += h;
        if (sgn && !rec.centre && u + h >= prim._g.ease) {
          // centre of the constant-radius part (measured after the clothoid ease), for hubs / scenery
          rec.centre = { x: x + sgn * -Math.sin(psi) * prim.r, z: z + sgn * -Math.cos(psi) * prim.r };
        }
        xs.push(x);
        zs.push(z);
        psis.push(psi);
        ps.push(p);
      }
    }
    rec.p1 = p;
    rec.end = { x, z, psi };
    info.push(rec);
  }
  return { xs, zs, psis, ps, info, loops, end: { x, z, psi }, length: p };
}

export function buildPlan(primSpecs, step = 0.04) {
  // pass 1: free straights at zero length, measure the closure error
  let prims = prepare(primSpecs, { A: 0, B: 0 });
  const first = walk(prims, step);
  const iA = prims.findIndex((q) => q.len === 'A');
  const iB = prims.findIndex((q) => q.len === 'B');
  let free = { A: 0, B: 0 };
  if (iA >= 0 && iB >= 0) {
    const dA = { x: Math.cos(first.info[iA].start.psi), z: -Math.sin(first.info[iA].start.psi) };
    const dB = { x: Math.cos(first.info[iB].start.psi), z: -Math.sin(first.info[iB].start.psi) };
    const ex = -first.end.x;
    const ez = -first.end.z;
    const det = dA.x * dB.z - dB.x * dA.z;
    if (Math.abs(det) < 1e-6) throw new Error('plan: free straights are parallel, cannot close the circuit');
    free = {
      A: (ex * dB.z - dB.x * ez) / det,
      B: (dA.x * ez - ex * dA.z) / det,
    };
    if (free.A < 0 || free.B < 0) console.warn('plan: closure needs negative straight lengths', free);
  }
  prims = prepare(primSpecs, free);
  const plan = walk(prims, step);
  const dpsi = plan.end.psi - Math.round(plan.end.psi / TAU) * TAU;
  plan.closure = { dx: plan.end.x, dz: plan.end.z, dpsi, turns: Math.round(plan.end.psi / TAU), free };
  recenter(plan);
  plan.byId = Object.fromEntries(plan.info.map((r) => [r.id, r]));
  return plan;
}

/** Shift the whole plan so its bounding box is centred on the origin (desk centre). */
function recenter(plan) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < plan.xs.length; i++) {
    minX = Math.min(minX, plan.xs[i]);
    maxX = Math.max(maxX, plan.xs[i]);
    minZ = Math.min(minZ, plan.zs[i]);
    maxZ = Math.max(maxZ, plan.zs[i]);
  }
  const ox = (minX + maxX) / 2;
  const oz = (minZ + maxZ) / 2;
  plan.offset = { x: ox, z: oz };
  for (let i = 0; i < plan.xs.length; i++) {
    plan.xs[i] -= ox;
    plan.zs[i] -= oz;
  }
  const sh = (o) => {
    if (!o) return;
    o.x -= ox;
    o.z -= oz;
  };
  for (const r of plan.info) {
    sh(r.start);
    sh(r.end);
    sh(r.centre);
  }
  for (const l of plan.loops) {
    l.x -= ox;
    l.z -= oz;
  }
  plan.end.x -= ox;
  plan.end.z -= oz;
}

/** Periodic Hermite height profile y(p). knots: [{p, y, m?}] with p in [0, P). */
export function makeHeightFn(knots, P) {
  const ks = knots.map((k) => ({ ...k })).sort((a, b) => a.p - b.p);
  const n = ks.length;
  const at = (i) => {
    const w = Math.floor(i / n);
    const k = ks[((i % n) + n) % n];
    return { p: k.p + w * P, y: k.y, m: k.m };
  };
  const ext = [];
  for (let i = -1; i <= n; i++) ext.push(at(i));
  // slopes
  for (let i = 1; i <= n; i++) {
    const k = ext[i];
    if (k.m !== undefined) continue;
    const a = ext[i - 1];
    const b = ext[i + 1];
    const h0 = k.p - a.p;
    const h1 = b.p - k.p;
    const l = (k.y - a.y) / h0;
    const r = (b.y - k.y) / h1;
    // flat-ish if the neighbours are on the same side (avoids overshoot at crests / valleys)
    k.m = l * r <= 0 ? 0 : (l * h1 + r * h0) / (h0 + h1);
  }
  return (pIn) => {
    let p = pIn % P;
    if (p < 0) p += P;
    // binary search on ext[1..n]
    let lo = 1;
    let hi = n;
    // find segment [ext[i], ext[i+1]] containing p, with i in 0..n
    let i = 0;
    for (let j = 0; j <= n; j++) {
      if (ext[j].p <= p && p <= ext[j + 1].p) {
        i = j;
        break;
      }
    }
    void lo;
    void hi;
    const a = ext[i];
    const b = ext[i + 1];
    const h = b.p - a.p;
    const u = (p - a.p) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a.y + (u3 - 2 * u2 + u) * h * a.m + (-2 * u3 + 3 * u2) * b.y + (u3 - u2) * h * b.m;
  };
}

/** Assemble the dense 3D polyline (x,y,z,p) from the plan + height function. */
export function assembleDense(plan, heightFn, loopStep = 0.04) {
  const X = [];
  const Y = [];
  const Z = [];
  const Pp = [];
  const marks = { loops: [] };
  const push = (x, y, z, p) => {
    X.push(x);
    Y.push(y);
    Z.push(z);
    Pp.push(p);
  };
  const loopAt = new Map(plan.loops.map((l) => [l.sampleIndex, l]));
  let skipNext = false;
  for (let i = 0; i < plan.xs.length; i++) {
    const loopHere = loopAt.get(i);
    if (skipNext) {
      skipNext = false;
      // exit sample already emitted by the loop
      continue;
    }
    push(plan.xs[i], heightFn(plan.ps[i]), plan.zs[i], plan.ps[i]);
    if (loopHere) {
      const { R, lateral, psi, x, z, p } = loopHere;
      const y0 = heightFn(p);
      const hx = Math.cos(psi);
      const hz = -Math.sin(psi);
      const nx = -Math.sin(psi);
      const nz = -Math.cos(psi);
      const n = Math.ceil((TAU * R) / loopStep);
      const startIdx = X.length - 1;
      for (let j = 1; j <= n; j++) {
        const th = (j / n) * TAU;
        const f = (th - Math.sin(th)) / TAU;
        const fwd = R * Math.sin(th);
        push(x + hx * fwd + nx * lateral * f, y0 + R * (1 - Math.cos(th)), z + hz * fwd + nz * lateral * f, p);
      }
      marks.loops.push({ id: loopHere.id, start: startIdx, end: X.length - 1, R, lateral });
      skipNext = true; // next plan sample is the exit (identical to last loop point)
    }
  }
  // drop the final point if it coincides with the first (closed circuit)
  const last = X.length - 1;
  const d = Math.hypot(X[last] - X[0], Y[last] - Y[0], Z[last] - Z[0]);
  if (d < 1e-3) {
    X.pop();
    Y.pop();
    Z.pop();
    Pp.pop();
  }
  return { X, Y, Z, P: Pp, marks };
}
