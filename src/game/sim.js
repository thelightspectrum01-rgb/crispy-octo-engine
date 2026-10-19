import { PHYS } from '../config.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * Cart physics on a closed track piece. One-dimensional dynamics along the spine (arc length `s`,
 * speed `v`) driven by gravity, drag, motor / launch / boost / brake, with lateral grip, airtime
 * and slip bookkeeping derived from the baked track curvature.
 *
 * step() returns a (re-used) array of events: {type:'lap'|'pickup'|'checkpoint'|'derail'|'stall'|..., ...}
 */
export class CartSim {
  constructor(track) {
    this.track = track;
    this.piece = track.piece;
    this.q = { slope: 0, kSide: 0, kUp: 0, gSide: 0, gUp: 0 };
    this.events = [];
    this.reset();
  }

  reset({ s = 0.4, v = 0, boost = PHYS.BOOST_START, lap = 0 } = {}) {
    this.s = s;
    this.v = v;
    this.lean = 0;
    this.leanTarget = 0;
    this.boost = boost;
    this.slip = 0;
    this.util = 0; // lateral load / grip budget (signed)
    this.gSideLoad = 0;
    this.gSideRaw = 0;
    this.gUpLoad = 1;
    this.air = 0; // 0..1 airtime intensity
    this.edgeT = 0;
    this.onEdge = false;
    this.boosting = false;
    this.braking = false;
    this.launching = false;
    this.finishing = false;
    this.derailed = false;
    this.stalled = 0;
    this.lap = lap; // completed laps
    this.dist = 0; // total distance travelled since reset
    this.time = 0;
    this.accel = 0;
    this.lastCheckpoint = 0;
    this.collected = new Set();
  }

  /** Advance the simulation by dt seconds. input: { lean: -1..1, brake: 0..1, boost: bool } */
  step(dt, input) {
    const ev = this.events;
    ev.length = 0;
    if (this.derailed) return ev;
    const P = this.piece;
    const q = P.params(this.s, this.q);
    const v = this.v;

    // --- lean (first-order lag)
    this.leanTarget = clamp(input.lean ?? 0, -1, 1);
    this.lean += (this.leanTarget - this.lean) * (1 - Math.exp(-dt / PHYS.LEAN_TAU));

    // --- loads (u/s² → g)
    const fSideRaw = v * v * q.kSide + PHYS.G * q.gSide;
    this.gSideRaw = fSideRaw / PHYS.G; // lateral load before leaning (drives the lean hint)
    const fSide = fSideRaw - PHYS.LEAN * PHYS.G * this.lean;
    this.gSideLoad = fSide / PHYS.G;
    this.util = this.gSideLoad / PHYS.GRIP;
    this.gUpLoad = (v * v * q.kUp + PHYS.G * q.gUp) / PHYS.G;

    // --- edge riding: sustained near-limit cornering tops up the boost meter
    const au = Math.abs(this.util);
    this.onEdge = au >= PHYS.EDGE_MIN && au <= 1 && v > 6 && !this.finishing;
    if (this.onEdge) {
      this.edgeT += dt;
      if (this.edgeT >= PHYS.EDGE_TIME) {
        this.edgeT -= PHYS.EDGE_TIME;
        this.boost = Math.min(PHYS.BOOST_MAX, this.boost + PHYS.EDGE_BOOST);
        ev.push({ type: 'edge' });
      }
    } else this.edgeT = Math.max(0, this.edgeT - dt * 2);

    // --- slip / derail
    const over = Math.abs(this.util) - 1;
    if (over > 0 && v > 1) this.slip += over * PHYS.SLIP_RATE * dt;
    else this.slip = Math.max(0, this.slip - PHYS.SLIP_DECAY * dt);
    if (this.slip >= PHYS.DERAIL_SLIP) {
      this.derailed = true;
      ev.push({ type: 'derail' });
      return ev;
    }

    // --- airtime
    const airNow = clamp((PHYS.AIR_THRESHOLD - this.gUpLoad) / 0.9, 0, 1);
    this.air += (airNow - this.air) * Math.min(1, dt * 12);

    // --- longitudinal acceleration
    let a = -PHYS.G * q.slope - PHYS.DRAG * v * v - (v > 0.05 ? PHYS.ROLL : 0);
    this.launching = false;
    this.boosting = false;
    this.braking = false;
    if (this.finishing) {
      a -= PHYS.FINISH_BRAKE;
      this.braking = true;
    } else {
      a += clamp(PHYS.CRUISE_GAIN * (PHYS.CRUISE_V - v), 0, PHYS.MOTOR_MAX);
      for (const z of P.zones) {
        if (z.type === 'launch' && this.s >= z.s0 && this.s <= z.s1 && v < PHYS.LAUNCH_V) {
          a += PHYS.LAUNCH_ACCEL;
          this.launching = true;
        }
      }
      if (input.boost && this.boost > 0) {
        a += PHYS.BOOST_ACCEL * Math.max(0, 1 - v / PHYS.BOOST_TOP);
        this.boost = Math.max(0, this.boost - PHYS.BOOST_DRAIN * dt);
        this.boosting = true;
      }
      const brake = clamp(input.brake ?? 0, 0, 1);
      if (brake > 0 && v > 0) {
        a -= PHYS.BRAKE * brake;
        this.braking = true;
      }
    }
    if (this.slip > 0 && over > -0.15) a -= PHYS.SLIP_DECEL * Math.min(1, this.slip + 0.25);
    if (this.air > 0.05 && !this.finishing) {
      this.boost = Math.min(PHYS.BOOST_MAX, this.boost + PHYS.AIR_BOOST * this.air * dt);
    }
    this.accel = a;

    // --- integrate
    const vNew = Math.max(0, Math.min(40, v + a * dt));
    const ds = 0.5 * (v + vNew) * dt;
    this.v = vNew;
    const sPrev = this.s;
    let sNew = sPrev + ds;
    this.dist += ds;
    this.time += dt;

    // --- stall detection (cart stuck on a slope)
    if (vNew < 0.25 && !this.finishing && this.time > 1) this.stalled += dt;
    else this.stalled = 0;
    if (this.stalled > PHYS.STALL_TIME) {
      this.stalled = 0;
      ev.push({ type: 'stall' });
    }

    // --- pickups / checkpoints (crossing tests on [sPrev, sNew])
    const L = P.length;
    const crossing = (x) => (sNew >= L ? x > sPrev || x <= sNew - L : x > sPrev && x <= sNew);
    const pk = this.track.pickups;
    for (let i = 0; i < pk.length; i++) {
      if (!this.collected.has(i) && crossing(pk[i])) {
        this.collected.add(i);
        if (!this.finishing) this.boost = Math.min(PHYS.BOOST_MAX, this.boost + PHYS.PICKUP_BOOST);
        ev.push({ type: 'pickup', index: i });
      }
    }
    const cps = this.track.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      if (crossing(cps[i])) {
        this.lastCheckpoint = cps[i];
        const f = ds > 1e-9 ? (cps[i] - sPrev) / ds : 0;
        ev.push({ type: 'checkpoint', index: i, frac: clamp(f, 0, 1) });
      }
    }

    // --- lap wrap
    if (sNew >= L) {
      const f = ds > 1e-9 ? (L - sPrev) / ds : 0;
      sNew -= L;
      this.lap++;
      this.collected.clear();
      ev.push({ type: 'lap', lap: this.lap, frac: clamp(f, 0, 1) });
    }
    this.s = sNew;

    if (this.finishing && this.v < 0.05) ev.push({ type: 'stopped' });
    return ev;
  }
}
