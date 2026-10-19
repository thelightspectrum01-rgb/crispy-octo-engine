// Compare simple driving strategies to judge balance. Usage: node scripts/strategies.mjs
import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS } from '../src/track/layout.js';
import { CartSim } from '../src/game/sim.js';
import { Bot } from '../src/game/bot.js';
import { GAME, PHYS } from '../src/config.js';

const track = buildTrack(DESK_RAILS);
const dt = GAME.PHYS_DT;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function run(name, policy, laps = 3) {
  const sim = new CartSim(track);
  let t = 0, lapStart = 0;
  const lapTimes = [];
  let derails = 0, slipT = 0;
  const derailAt = [];
  while (sim.lap < laps && t < 300) {
    const inp = policy(sim);
    const ev = sim.step(dt, inp);
    t += dt;
    if (sim.slip > 0.02) slipT += dt;
    for (const e of ev) {
      if (e.type === 'lap') { lapTimes.push(t - lapStart); lapStart = t; }
      if (e.type === 'derail') { derails++; derailAt.push(sim.s.toFixed(0)); sim.derailed = false; sim.slip = 0; sim.v *= 0.5; t += 3; }
    }
  }
  console.log(name.padEnd(28), 'total', t.toFixed(1).padStart(6), 'laps', lapTimes.map((x) => x.toFixed(1)).join('/').padEnd(18), 'derails', derails, derailAt.join(','), 'slip', slipT.toFixed(1));
}

const bot1 = new Bot(track, { skill: 1 });
run('bot skill 1.00', (s) => bot1.decide(s));
const bot9 = new Bot(track, { skill: 0.9 });
run('bot skill 0.90', (s) => bot9.decide(s));
const bot8 = new Bot(track, { skill: 0.8 });
run('bot skill 0.80', (s) => bot8.decide(s));
const botNB = new Bot(track, { skill: 1, boostUse: 0 });
run('bot no boost', (s) => botNB.decide(s));

// naive: never brake, spam boost
const P = track.piece;
const lean = (s) => { const q = P.params(s.s + s.v * 0.12, {}); return clamp((s.v * s.v * q.kSide + PHYS.G * q.gSide) / (PHYS.LEAN * PHYS.G), -1, 1); };
run('never brake, boost, ideal lean', (s) => ({ lean: lean(s), brake: 0, boost: true }));
run('never brake, no boost, lean', (s) => ({ lean: lean(s), brake: 0, boost: false }));
run('never brake, no lean', (s) => ({ lean: 0, brake: 0, boost: false }));
run('coast+lean only on corners', (s) => ({ lean: lean(s), brake: s.v > 9 ? 1 : 0, boost: false }));
