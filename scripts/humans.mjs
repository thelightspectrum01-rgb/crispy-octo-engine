// Rough difficulty calibration: bots with human-like handicaps (reaction lag, coarse inputs, margins).
//   node scripts/humans.mjs
import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS } from '../src/track/layout.js';
import { CartSim } from '../src/game/sim.js';
import { Bot } from '../src/game/bot.js';
import { GAME, PHYS } from '../src/config.js';
import { simulateBot } from '../src/game/race.js';

const track = buildTrack(DESK_RAILS);
const dt = GAME.PHYS_DT;
const ref = simulateBot(track, 3, { skill: 1 }).total;

class Human {
  constructor({ skill, jitter, binaryLean, leanDead, boost = true }) {
    this.bot = new Bot(track, { skill, boostUse: boost ? 1 : 0, jitter });
    this.binaryLean = binaryLean;
    this.leanDead = leanDead;
  }
  decide(sim) {
    const raw = this.bot.decide(sim);
    const inp = { lean: raw.lean, brake: raw.brake, boost: raw.boost };
    if (this.binaryLean) inp.lean = Math.abs(raw.lean) < this.leanDead ? 0 : Math.sign(raw.lean);
    return inp;
  }
}

function run(name, mk, trials = 5) {
  const totals = [];
  const derails = [];
  for (let k = 0; k < trials; k++) {
    const h = mk();
    const sim = new CartSim(track);
    sim.reset({ s: 0.9, v: 0 });
    let t = 0, d = 0;
    while (sim.lap < 3 && t < 300) {
      const ev = sim.step(dt, h.decide(sim));
      t += dt;
      for (const e of ev) if (e.type === 'derail') { d++; sim.derailed = false; sim.slip = 0; sim.v = 6; t += GAME.DERAIL_PENALTY + 1.5; }
    }
    totals.push(t); derails.push(d);
  }
  const avg = totals.reduce((a, b) => a + b, 0) / trials;
  console.log(name.padEnd(30), 'avg', avg.toFixed(1).padStart(6), `(${((avg / ref) * 100).toFixed(0)}% of ref)`, 'min', Math.min(...totals).toFixed(1), 'derails/run', (derails.reduce((a, b) => a + b, 0) / trials).toFixed(1));
}

console.log('reference (perfect bot):', ref.toFixed(2), '| medals: gold <=', (ref * GAME.MEDALS.gold).toFixed(1), 'silver <=', (ref * GAME.MEDALS.silver).toFixed(1), 'bronze <=', (ref * GAME.MEDALS.bronze).toFixed(1));
run('expert  (0.97, jit .05, analog)', () => new Human({ skill: 0.97, jitter: 0.05, binaryLean: false, leanDead: 0 }), 8);
run('good    (0.93, jit .10, binary)', () => new Human({ skill: 0.93, jitter: 0.1, binaryLean: true, leanDead: 0.15 }), 8);
run('decent  (0.88, jit .16, binary)', () => new Human({ skill: 0.88, jitter: 0.16, binaryLean: true, leanDead: 0.2 }), 8);
run('casual  (0.80, jit .26, binary)', () => new Human({ skill: 0.8, jitter: 0.26, binaryLean: true, leanDead: 0.25 }), 8);
run('beginner(0.70, jit .35, noboost)', () => new Human({ skill: 0.7, jitter: 0.35, binaryLean: true, leanDead: 0.3, boost: false }), 8);
run('rival   (0.88 analog)', () => new Human({ skill: 0.88, jitter: 0, binaryLean: false, leanDead: 0 }), 1);
