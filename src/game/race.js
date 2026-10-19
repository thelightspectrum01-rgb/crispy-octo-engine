import { CartSim } from './sim.js';
import { Bot } from './bot.js';
import { GHOST_HZ, GhostRecorder } from './ghost.js';
import { GAME, PHYS } from '../config.js';

const NO_INPUT = Object.freeze({ lean: 0, brake: 0, boost: false });
export const START_S = 0.9;
export const CRASH_TIME = 1.5;

/**
 * One time-trial attempt. Owns the player's cart simulation, lap / split timing, derail handling and
 * the ghost recording. Pure logic – no rendering, no DOM.
 */
export class Race {
  constructor(track, { laps = GAME.LAPS } = {}) {
    this.track = track;
    this.laps = laps;
    this.L = track.length;
    this.sim = new CartSim(track);
    this.sim.reset({ s: START_S, v: 0, boost: PHYS.BOOST_START });
    this.state = 'countdown'; // countdown | running | finishing | done
    this.time = 0; // race clock (includes penalties)
    this.lapStart = 0;
    this.lapTimes = [];
    this.cpTimes = []; // [lap][checkpoint] = race time
    this.penalties = 0;
    this.derails = 0;
    this.finishTime = null;
    this.crash = null; // { t, ... } while a derail animation plays
    this.recorder = new GhostRecorder();
    this.events = [];
    this.finishedAt = 0;
  }

  get progress() {
    return this.sim.lap * this.L + this.sim.s;
  }

  get currentLap() {
    return Math.min(this.laps, this.sim.lap + 1);
  }

  start() {
    this.state = 'running';
    this.time = 0;
    this.lapStart = 0;
  }

  /** advance by dt with the given input; returns the event list (re-used array) */
  step(dt, input) {
    const events = this.events;
    events.length = 0;
    if (this.state === 'countdown' || this.state === 'done') return events;
    const sim = this.sim;
    const running = this.state === 'running';

    // --- derail animation / respawn
    if (this.crash) {
      this.crash.t += dt;
      if (running) this.time += dt;
      if (this.crash.t >= CRASH_TIME) this.respawn(events);
      return events;
    }

    const prevTime = this.time;
    const ev = sim.step(dt, running ? input : NO_INPUT);
    if (running) this.time += dt;
    for (const e of ev) {
      switch (e.type) {
        case 'lap': {
          if (!running) break;
          const tCross = prevTime + e.frac * dt;
          const lapTime = tCross - this.lapStart;
          this.lapTimes.push(lapTime);
          this.lapStart = tCross;
          sim.lastCheckpoint = START_S;
          events.push({ type: 'lap', lap: e.lap, lapTime, time: tCross });
          if (e.lap >= this.laps) {
            this.finishTime = tCross;
            this.state = 'finishing';
            sim.finishing = true;
            events.push({ type: 'finish', total: tCross });
          }
          break;
        }
        case 'checkpoint': {
          if (!running) break;
          const t = prevTime + e.frac * dt;
          const lapIdx = sim.lap;
          (this.cpTimes[lapIdx] ??= [])[e.index] = t;
          events.push({
            type: 'checkpoint',
            index: e.index,
            lap: lapIdx,
            time: t,
            lapTime: t - this.lapStart,
            progress: lapIdx * this.L + this.track.checkpoints[e.index],
          });
          break;
        }
        case 'pickup':
          events.push({ type: 'pickup', index: e.index });
          break;
        case 'edge':
          events.push({ type: 'edge' });
          break;
        case 'derail':
          this.derails++;
          this.crash = { t: 0, s: sim.s, v: sim.v, util: sim.util };
          events.push({ type: 'derail', s: sim.s, v: sim.v, util: sim.util });
          break;
        case 'stall':
          if (!running) break;
          this.crash = { t: 0, s: sim.s, v: 0, util: 0, stall: true };
          sim.derailed = true;
          events.push({ type: 'stall' });
          break;
        case 'stopped':
          if (this.state === 'finishing') {
            this.state = 'done';
            events.push({ type: 'done' });
          }
          break;
        default:
      }
    }
    if (running) this.recorder.record(this.time, this.progress, dt);

    if (this.state === 'finishing') {
      this.finishedAt += dt;
      if (this.finishedAt > 7) {
        this.state = 'done';
        events.push({ type: 'done' });
      }
    }
    return events;
  }

  /** Where a derailed cart is put back: ~14 u behind the crash on a 4 u grid, never inside the loop. */
  respawnPoint() {
    const sim = this.sim;
    const P = this.track.piece;
    if (this.crash.stall) return Math.max(START_S, sim.s - 2);
    let s = Math.floor((this.crash.s - 14) / 4) * 4;
    s = Math.max(s, sim.lastCheckpoint, START_S);
    for (const iv of P.inversions) {
      if (s > iv.s0 - 3 && s < iv.s1 + 3) s = Math.max(START_S, iv.s0 - 8);
    }
    return s;
  }

  respawn(events) {
    const sim = this.sim;
    const P = this.track.piece;
    const s = this.respawnPoint();
    const cp = sim.lastCheckpoint;
    const keepBoost = sim.boost;
    const lap = sim.lap;
    const collected = sim.collected;
    const v = s < 11 ? 0 : Math.min(10, 0.9 * P.sample(P.profile.v, s));
    sim.reset({ s, v, boost: keepBoost, lap });
    sim.collected = collected;
    sim.lastCheckpoint = cp;
    this.time += GAME.DERAIL_PENALTY;
    this.penalties += GAME.DERAIL_PENALTY;
    this.crash = null;
    events.push({ type: 'respawn', penalty: GAME.DERAIL_PENALTY, s });
  }

  /** Time delta (s) of the player versus a ghost at the current progress; null if unknown. */
  deltaVs(ghost) {
    if (!ghost || this.state !== 'running') return null;
    const tg = ghost.timeAt(this.progress);
    return tg === null ? null : this.time - tg;
  }

  deltaAt(ghost, progress, time) {
    if (!ghost) return null;
    const tg = ghost.timeAt(progress);
    return tg === null ? null : time - tg;
  }
}

/**
 * Drive a whole race with the bot. Returns the lap times, the total and the progress samples
 * (a ready-made ghost). Used for medal reference times and the rival.
 */
export function simulateBot(track, laps, { skill = 1 } = {}) {
  const sim = new CartSim(track);
  sim.reset({ s: START_S, v: 0, boost: PHYS.BOOST_START });
  const bot = new Bot(track, { skill });
  const dt = GAME.PHYS_DT;
  const L = track.length;
  const rec = new GhostRecorder();
  let t = 0;
  let lapStart = 0;
  let total = 0;
  const lapTimes = [];
  while (sim.lap < laps && t < 400) {
    const ev = sim.step(dt, bot.decide(sim));
    t += dt;
    rec.record(t, sim.lap * L + sim.s, dt);
    for (const e of ev) {
      if (e.type === 'lap') {
        const tc = t - dt * (1 - e.frac);
        lapTimes.push(tc - lapStart);
        lapStart = tc;
        total = tc;
      }
      if (e.type === 'derail') {
        sim.derailed = false;
        sim.slip = 0;
      }
    }
  }
  // a few trailing samples so the ghost keeps rolling over the line
  for (let i = 0; i < GHOST_HZ; i++) rec.samples.push(sim.lap * L + sim.s + (i + 1) * 0.3);
  return { total, lapTimes, samples: rec.finish() };
}

export function medalFor(total, reference) {
  const m = GAME.MEDALS;
  if (total <= reference * m.gold) return 'gold';
  if (total <= reference * m.silver) return 'silver';
  if (total <= reference * m.bronze) return 'bronze';
  return 'none';
}

export function medalTargets(reference) {
  const m = GAME.MEDALS;
  return { gold: reference * m.gold, silver: reference * m.silver, bronze: reference * m.bronze };
}
