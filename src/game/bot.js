import { PHYS } from '../config.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * Autopilot. Follows the track's best-case speed profile: brakes when above it, boosts when well below
 * the boost profile, leans to cancel lateral load. `skill` (0..1) scales how close to the limit it drives.
 * Used for the title-screen demo, the rival ghost, medal reference times and automated tests.
 */
export class Bot {
  constructor(track, { skill = 1, boostUse = 1, jitter = 0 } = {}) {
    this.track = track;
    this.piece = track.piece;
    this.skill = skill;
    this.boostUse = boostUse;
    this.jitter = jitter; // random +/- variation of the braking point (seconds of travel)
    this.aheadK = 0.1;
    this.jitterT = 0;
    this.q = { slope: 0, kSide: 0, kUp: 0, gSide: 0, gUp: 0 };
    this.input = { lean: 0, brake: 0, boost: false };
  }

  decide(sim) {
    const P = this.piece;
    const v = sim.v;
    if (this.jitter > 0) {
      this.jitterT -= 1 / 120;
      if (this.jitterT <= 0) {
        this.jitterT = 0.5 + Math.random() * 0.8;
        this.aheadK = 0.1 + (Math.random() * 2 - 1) * this.jitter;
      }
    }
    const ahead = v * this.aheadK;
    const plain = P.sample(P.profile.v, sim.s + ahead) * this.skill;
    const boosted = P.sample(P.profileBoost.v, sim.s + ahead) * this.skill;
    const canBoost = this.boostUse > 0 && sim.boost > 4;
    const target = canBoost ? boosted : plain;

    const inp = this.input;
    inp.brake = v > target + 0.12 ? clamp((v - target) * 1.2, 0.4, 1) : 0;
    inp.boost = canBoost && inp.brake === 0 && v < boosted - 0.5 && sim.s > 4 && !sim.launching;

    // lean against the predicted lateral load
    const q = P.params(sim.s + v * 0.12, this.q);
    const f = v * v * q.kSide + PHYS.G * q.gSide;
    inp.lean = clamp(f / (PHYS.LEAN * PHYS.G), -1, 1);
    return inp;
  }
}
