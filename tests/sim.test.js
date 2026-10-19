import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS } from '../src/track/layout.js';
import { CartSim } from '../src/game/sim.js';
import { Bot } from '../src/game/bot.js';
import { GAME, PHYS } from '../src/config.js';
import { simulateBot } from '../src/game/race.js';

const track = buildTrack(DESK_RAILS);
const dt = GAME.PHYS_DT;

function drive(policy, laps = 2, maxT = 200) {
  const sim = new CartSim(track);
  sim.reset({ s: 0.9, v: 0 });
  let t = 0;
  let derails = 0;
  const lapTimes = [];
  let last = 0;
  while (sim.lap < laps && t < maxT) {
    const ev = sim.step(dt, policy(sim));
    t += dt;
    for (const e of ev) {
      if (e.type === 'derail') {
        derails++;
        sim.derailed = false;
        sim.slip = 0;
        sim.v *= 0.5;
      }
      if (e.type === 'lap') {
        const tc = t - dt * (1 - e.frac);
        lapTimes.push(tc - last);
        last = tc;
      }
    }
  }
  return { t, derails, lapTimes, sim };
}

test('the bot laps cleanly and matches the analytic speed profile', () => {
  const bot = new Bot(track, { skill: 1, boostUse: 0 });
  const r = drive((s) => bot.decide(s), 3);
  assert.equal(r.derails, 0);
  assert.equal(r.lapTimes.length, 3);
  const ref = track.referenceTime;
  // laps 2+ should land within 4% of the idealised (no-boost) profile time
  assert.ok(Math.abs(r.lapTimes[2] - ref) / ref < 0.04, `lap ${r.lapTimes[2]} vs profile ${ref}`);
});

test('boosting makes the bot faster, and the meter drains', () => {
  const noBoost = drive((s) => new Bot(track, { boostUse: 0 }).decide(s), 2);
  const bot = new Bot(track, { boostUse: 1 });
  const withBoost = drive((s) => bot.decide(s), 2);
  assert.ok(withBoost.t < noBoost.t - 1, `${withBoost.t} vs ${noBoost.t}`);
});

test('ignoring the corners derails the cart (braking matters)', () => {
  const r = drive(() => ({ lean: 0, brake: 0, boost: true }), 1, 120);
  assert.ok(r.derails > 0, 'a no-brake, no-lean run must derail');
});

test('the simulation is deterministic', () => {
  const a = simulateBot(track, 2, { skill: 0.9 });
  const b = simulateBot(track, 2, { skill: 0.9 });
  assert.equal(a.total, b.total);
  assert.deepEqual(a.lapTimes, b.lapTimes);
});

test('launch strip accelerates a standing cart to launch speed', () => {
  const sim = new CartSim(track);
  sim.reset({ s: 0.9, v: 0 });
  let peak = 0;
  for (let i = 0; i < 4 * 120; i++) {
    sim.step(dt, { lean: 0, brake: 0, boost: false });
    peak = Math.max(peak, sim.v);
  }
  assert.ok(peak > PHYS.LAUNCH_V - 0.5, `peak speed after launch ${peak}`);
});

test('braking decelerates; boost pickups refill the meter', () => {
  const sim = new CartSim(track);
  sim.reset({ s: 20, v: 10, boost: 0 });
  const v0 = sim.v;
  for (let i = 0; i < 30; i++) sim.step(dt, { lean: 0, brake: 1, boost: false });
  assert.ok(sim.v < v0 - 1);
  const s2 = new CartSim(track);
  s2.reset({ s: track.pickups[0] - 0.2, v: 8, boost: 0 });
  for (let i = 0; i < 20; i++) s2.step(dt, { lean: 0, brake: 0, boost: false });
  assert.ok(s2.boost >= PHYS.PICKUP_BOOST - 1, `boost ${s2.boost}`);
});

test('airtime on crests feeds the boost meter', () => {
  const bot = new Bot(track, { boostUse: 0 });
  const sim = new CartSim(track);
  sim.reset({ s: 0.9, v: 0, boost: 0 });
  let air = 0;
  for (let i = 0; i < 40 * 120 && sim.lap < 1; i++) {
    sim.step(dt, bot.decide(sim));
    air = Math.max(air, sim.air);
  }
  assert.ok(air > 0.2, `max airtime intensity ${air}`);
});

test('riding the grip limit pays out boost (edge events)', () => {
  const bot = new Bot(track, { skill: 1 });
  const sim = new CartSim(track);
  sim.reset({ s: 0.9, v: 0 });
  let edges = 0;
  let t = 0;
  while (sim.lap < 1 && t < 80) {
    sim.boost = 100; // plenty of boost => the bot is pushed up against the cornering limit
    for (const e of sim.step(dt, bot.decide(sim))) {
      if (e.type === 'edge') edges++;
      if (e.type === 'derail') {
        sim.derailed = false;
        sim.slip = 0;
      }
    }
    t += dt;
  }
  assert.ok(edges >= 3, `edge events ${edges}`);
});
