import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS } from '../src/track/layout.js';
import { Race, simulateBot, medalFor, medalTargets } from '../src/game/race.js';
import { Bot } from '../src/game/bot.js';
import { GAME } from '../src/config.js';

const track = buildTrack(DESK_RAILS);
const dt = GAME.PHYS_DT;

function runRace(laps, input) {
  const race = new Race(track, { laps });
  race.start();
  const events = [];
  let guard = 0;
  while (race.state !== 'done' && guard++ < 120 * 400) events.push(...race.step(dt, input(race.sim)).map((e) => ({ ...e })));
  return { race, events };
}

test('a bot run produces laps, splits, a finish and a stop', () => {
  const bot = new Bot(track);
  const { race, events } = runRace(2, (s) => bot.decide(s));
  assert.equal(race.lapTimes.length, 2);
  assert.ok(events.some((e) => e.type === 'finish'));
  assert.ok(events.filter((e) => e.type === 'checkpoint').length >= 6);
  assert.ok(Math.abs(race.finishTime - race.lapTimes.reduce((a, b) => a + b, 0)) < 1e-6, 'laps add up to the total');
  assert.equal(race.state, 'done');
  assert.ok(race.sim.v < 0.1, 'cart stops after the finish line');
});

test('derailing costs the time penalty and respawns on the track', () => {
  const race = new Race(track, { laps: 1 });
  race.start();
  let derailed = false;
  let respawned = false;
  for (let i = 0; i < 120 * 60 && !respawned; i++) {
    for (const e of race.step(dt, { lean: 0, brake: 0, boost: true })) {
      if (e.type === 'derail') derailed = true;
      if (e.type === 'respawn') respawned = true;
    }
  }
  assert.ok(derailed && respawned);
  assert.ok(race.penalties >= GAME.DERAIL_PENALTY - 1e-9);
  assert.ok(race.sim.v > 0 && !race.sim.derailed);
});

test('medal thresholds are ordered around the reference time', () => {
  const ref = simulateBot(track, 3, { skill: 1 }).total;
  const t = medalTargets(ref);
  assert.ok(t.gold < t.silver && t.silver < t.bronze);
  assert.equal(medalFor(ref, ref), 'gold');
  assert.equal(medalFor(t.silver - 0.01, ref), 'silver');
  assert.equal(medalFor(t.bronze + 1, ref), 'none');
});

test('the rival (skill 0.88) is slower than the reference but finishes', () => {
  const ref = simulateBot(track, 3, { skill: 1 });
  const rival = simulateBot(track, 3, { skill: 0.88 });
  assert.ok(rival.total > ref.total);
  assert.ok(rival.total < ref.total * 1.15, `${rival.total} vs ${ref.total}`);
});
