// A player who only follows the on-screen hints (BRAKE prompt + lean chevrons + boost always held),
// with human-ish reaction times. Used to check that following the HUD gives a sane first result.
//   node scripts/hintdriver.mjs
import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS } from '../src/track/layout.js';
import { CartSim } from '../src/game/sim.js';
import { simulateBot } from '../src/game/race.js';
import { GAME, PHYS } from '../src/config.js';

const track = buildTrack(DESK_RAILS);
const P = track.piece;
const dt = GAME.PHYS_DT;
const ref = simulateBot(track, 3, { skill: 1 }).total;

function run({ reactOn, reactOff, boostAlways }) {
  const sim = new CartSim(track);
  sim.reset({ s: 0.9, v: 0 });
  const q = []; // delayed brake commands
  let t = 0, derails = 0, brakeNow = 0;
  while (sim.lap < 3 && t < 300) {
    const prof = sim.boost > 4 ? P.profileBoost.v : P.profile.v;
    const hint = sim.v > P.sample(prof, sim.s + 1.2 + sim.v * 0.4) + 0.3 && sim.v > 4;
    q.push({ t, hint });
    while (q.length && t - q[0].t >= (q[0].hint ? reactOn : reactOff)) brakeNow = q.shift().hint ? 1 : 0;
    const lh = Math.max(-1, Math.min(1, sim.gSideRaw / PHYS.LEAN));
    const lean = Math.abs(lh) > 0.25 ? Math.sign(lh) : 0;
    const boost = boostAlways && sim.boost > 0 && !brakeNow;
    for (const e of sim.step(dt, { lean, brake: brakeNow, boost })) {
      if (e.type === 'derail') { derails++; sim.derailed = false; sim.slip = 0; sim.v = 6; t += GAME.DERAIL_PENALTY + 1.5; }
    }
    t += dt;
  }
  return { t, derails };
}
console.log('reference (perfect bot):', ref.toFixed(1), 's');
for (const [label, cfg] of [
  ['fast reactions (0.2 / 0.15)', { reactOn: 0.2, reactOff: 0.15, boostAlways: true }],
  ['typical (0.3 / 0.25)', { reactOn: 0.3, reactOff: 0.25, boostAlways: true }],
  ['slow (0.45 / 0.35)', { reactOn: 0.45, reactOff: 0.35, boostAlways: true }],
  ['typical, never boosts', { reactOn: 0.3, reactOff: 0.25, boostAlways: false }],
]) {
  const r = run(cfg);
  console.log(label.padEnd(30), `total ${r.t.toFixed(1)} s (${((r.t / ref) * 100).toFixed(0)}% of ref), derails ${r.derails}`);
}
