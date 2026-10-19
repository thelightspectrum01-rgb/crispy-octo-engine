// Headless lap simulation with the bot. Usage: node scripts/sim.mjs [laps] [skill] [trace.csv]
import { writeFileSync } from 'node:fs';
import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS } from '../src/track/layout.js';
import { CartSim } from '../src/game/sim.js';
import { Bot } from '../src/game/bot.js';
import { GAME } from '../src/config.js';

const laps = Number(process.argv[2] ?? 3);
const skill = Number(process.argv[3] ?? 1);
const csv = process.argv[4];
const track = buildTrack(DESK_RAILS);
const sim = new CartSim(track);
const bot = new Bot(track, { skill });
const dt = GAME.PHYS_DT;

let t = 0;
let lapStart = 0;
const lapTimes = [];
let maxUtil = 0;
let slipTime = 0;
let derails = 0;
let minV = 99;
let maxV = 0;
let maxSlip = 0;
let airTime = 0;
let boostUsed = 0;
const rows = ['t,s,v,y,util,gUp,boost,slip'];
let steps = 0;
while (sim.lap < laps && t < 200) {
  const inp = bot.decide(sim);
  const boostBefore = sim.boost;
  const ev = sim.step(dt, inp);
  if (sim.boosting) boostUsed += boostBefore - sim.boost;
  t += dt;
  steps++;
  for (const e of ev) {
    if (e.type === 'lap') {
      const tt = t - dt * (1 - e.frac);
      lapTimes.push(tt - lapStart);
      lapStart = tt;
    }
    if (e.type === 'derail') {
      derails++;
      sim.derailed = false;
      sim.slip = 0;
    }
    if (e.type === 'stall') console.log('stall at s=', sim.s.toFixed(1));
  }
  maxUtil = Math.max(maxUtil, Math.abs(sim.util));
  maxSlip = Math.max(maxSlip, sim.slip);
  if (sim.slip > 0.01) slipTime += dt;
  if (sim.air > 0.2) airTime += dt;
  if (t > 3) {
    minV = Math.min(minV, sim.v);
  }
  maxV = Math.max(maxV, sim.v);
  if (csv && steps % 6 === 0) {
    track.piece.locate(sim.s);
    rows.push([t.toFixed(3), sim.s.toFixed(2), sim.v.toFixed(2), track.piece.sample(new Float32Array(track.piece.pos.filter((_, i) => i % 3 === 1)), sim.s).toFixed(2), sim.util.toFixed(2), sim.gUpLoad.toFixed(2), sim.boost.toFixed(0), sim.slip.toFixed(2)].join(','));
  }
}
console.log(`bot skill ${skill}: ${laps} laps in ${t.toFixed(2)} s`);
console.log('lap times:', lapTimes.map((x) => x.toFixed(2)).join(' | '));
console.log(`reference (profile) lap: ${track.referenceTime.toFixed(2)} s, boosted bound ${track.piece.profileBoost.time.toFixed(2)} s`);
console.log(`max |util| ${maxUtil.toFixed(2)}, slip time ${slipTime.toFixed(2)} s, max slip ${maxSlip.toFixed(2)}, derails ${derails}`);
console.log(`speed range ${minV.toFixed(1)}..${maxV.toFixed(1)} u/s, airtime ${airTime.toFixed(2)} s, boost used ${boostUsed.toFixed(0)}%, boost left ${sim.boost.toFixed(0)}%`);
if (csv) writeFileSync(csv, rows.join('\n'));
