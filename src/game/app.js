import { Vector3, Quaternion, Euler } from 'three';
import { buildTrack } from '../track/build.js';
import { TRACKS } from '../track/layout.js';
import { makeFrame } from '../track/piece.js';
import { World } from '../world/world.js';
import { Race, simulateBot, medalFor, medalTargets } from './race.js';
import { CartSim } from './sim.js';
import { Bot } from './bot.js';
import { Ghost, decodeGhost, encodeGhost } from './ghost.js';
import { Input } from './input.js';
import * as store from './storage.js';
import { UI, fmtTime, fmtDelta } from '../ui/ui.js';
import { AudioEngine } from '../audio/audio.js';
import { GAME, PHYS } from '../config.js';

const WORLD_UP = new Vector3(0, 1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const CAMERAS = ['chase', 'onboard', 'overview'];
const GHOST_MODES = ['auto', 'pb', 'rival', 'off'];
const RIVAL_SKILL = 0.82;

export class App {
  constructor(root) {
    this.root = root;
    this.settings = store.loadSettings();
    this.state = 'loading'; // loading | menu | countdown | racing | paused | results
    this.resumeState = 'racing';
    this.acc = 0;
    this.last = 0;
    this.time = 0;
    this.fps = 60;
    this.fpsTimer = 0;
    this.frames = 0;
    this.pose = makeFrame();
    this.behindPose = makeFrame();
    this.autopilot = false;
    this.refCache = new Map();
    this.rivalCache = new Map();
    this.splashT = 0;
    this.result = null;
    this.showResultsAt = 0;
    this.countT = 0;
    this.countStep = -1;
    this.crashBody = null;
    this.prevBoosting = false;
    this.prevLaunching = false;
    this.flashK = 0;
    this.sparkAcc = 0;
    this.trailAcc = 0;
    this.confettiT = 0;
    this.resultsShownAt = 0;
    this.goAt = 0;
    this.startChecked = true;
    this.lastBoostPress = -99;
    this.prevBoostKey = false;
    this.edgeFlash = 0;
    this.noRender = false;
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async init() {
    const params = new URLSearchParams(location.search);
    this.params = params;
    this.isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;

    this.ui = new UI({
      start: () => this.startRace(),
      retry: () => this.startRace(),
      menu: () => this.toMenu(),
      resume: () => this.resume(),
      resetRecords: () => this.resetRecords(),
      toggle: (name) => this.toggleSetting(name),
      setting: (k, v) => this.setSetting(k, v),
    });
    this.ui.syncSettings(this.settings);
    await nextFrame();

    this.trackCache = new Map();
    if (!TRACKS.some((t) => t.id === this.settings.track)) this.settings.track = 'classic';
    this.track = this.getTrack(this.settings.track);
    this.trackId = this.track.layout.name;
    await nextFrame();

    const q = this.resolveQuality(this.settings.quality);
    this.world = new World(this.root, this.track, { quality: q });
    this.applyQuality(this.settings.quality);
    await nextFrame();

    this.world.warmup();
    this.input = new Input();
    this.audio = new AudioEngine();
    this.audio.soundOn = this.settings.sound;
    this.audio.musicOn = this.settings.music;
    this.ui.buildMinimap(this.track);
    this.input.bindTouch(document.getElementById('t-left'), 'left');
    this.input.bindTouch(document.getElementById('t-right'), 'right');
    this.input.bindTouch(document.getElementById('t-boost'), 'boost');
    this.input.bindTouch(document.getElementById('t-brake'), 'brake');
    document.getElementById('t-pause').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.togglePause();
    });
    this.bindInput();
    const unlock = () => {
      this.audio.init();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.world.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fatal = true;
      this.ui.fatal('The graphics context was lost (the GPU reset or ran out of memory). Please reload the page.');
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey) this.toggleFullscreen();
    });
    if (!document.documentElement.requestFullscreen) document.getElementById('btn-full').classList.add('hidden');
    document.getElementById('btn-full').addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.toggleFullscreen();
    });
    window.addEventListener('resize', () => this.world.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.world.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'racing') this.pause();
      if (document.hidden) this.audio.suspend();
      else if (this.state !== 'paused') this.audio.resume();
    });

    this.setupTrack(this.track, true);

    this.refreshRecordPanel();
    this.world.rig.reducedMotion = this.reducedMotion;
    this.world.rig.setMode('title');
    this.world.rig.forceSnap();
    this.state = 'menu';
    this.ui.showMenu(true);
    this.ui.showTouch(false);
    this.ui.hideLoading();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));

    // debug / test hooks
    window.__dc = this;
    if (params.has('bot')) {
      this.autopilot = true;
      this.autoBot = new Bot(this.track, { skill: Number(params.get('skill') ?? 1) });
    }
    if (params.has('autostart')) this.startRace();
  }

  /* ------------------------------------------------------------ tracks */

  getTrack(id) {
    if (!this.trackCache.has(id)) {
      const def = TRACKS.find((t) => t.id === id) ?? TRACKS[0];
      this.trackCache.set(id, buildTrack(def.layout));
    }
    return this.trackCache.get(id);
  }

  /** Make `track` the active circuit: world meshes, minimap, loop camera, demo cart, record panel. */
  setupTrack(track, initial = false) {
    this.track = track;
    this.trackId = track.layout.name;
    if (!initial) this.world.setTrack(track);
    this.ui.buildMinimap(track);
    // cinematic loop camera: beside the loop plane, looking at the loop centre
    this.loopCam = null;
    const iv = track.piece.inversions[0];
    const loop = track.plan.loops[0];
    if (iv && loop) {
      const f = track.piece.frame(iv.s0 + 0.2, makeFrame());
      const center = f.pos.clone().addScaledVector(f.up, loop.R).addScaledVector(f.right, -loop.lateral / 2);
      this.loopCam = { pos: center.clone().addScaledVector(f.right, 9.8).add(new Vector3(0, 0.8, 0)), center };
    }
    // demo cart for the title screen
    this.demo = { sim: new CartSim(track), bot: new Bot(track, { skill: 0.93 }), acc: 0 };
    this.demo.sim.reset({ s: 100, v: 9, boost: 60 });
    this.world.rig.titleAngle = 0.4;
    if (!initial) this.refreshRecordPanel();
  }

  selectTrack(id) {
    if (this.state !== 'menu' || this.track === this.getTrack(id)) return;
    this.setupTrack(this.getTrack(id));
  }

  /* ------------------------------------------------------------ settings & quality */

  resolveQuality(q) {
    if (q === 'auto') return this.isTouch ? 'medium' : 'high';
    return q;
  }

  applyQuality(q) {
    const level = this.resolveQuality(q);
    this.qualityLevel = level;
    this.world.setQuality(level);
    // 'auto' starts conservatively and ramps the resolution up while the frame rate allows it
    const cap = level === 'high' ? (q === 'auto' ? 1.5 : 2) : level === 'medium' ? 1.25 : 1;
    this.baseDpr = level === 'high' ? 2 : level === 'medium' ? 1.5 : 1;
    this.world.setPixelRatioCap(cap);
  }

  setSetting(key, value) {
    if (key === 'laps') value = Number(value);
    this.settings[key] = value;
    store.saveSettings(this.settings);
    this.ui.syncSettings(this.settings);
    if (key === 'quality') this.applyQuality(value);
    if (key === 'track') this.selectTrack(value);
    if (key === 'laps') this.refreshRecordPanel();
    if (key === 'camera' && this.state === 'racing') this.world.rig.setMode(value);
    this.audio?.play('ui');
  }

  toggleSetting(name) {
    this.settings[name] = !this.settings[name];
    store.saveSettings(this.settings);
    this.ui.syncSettings(this.settings);
    if (name === 'sound') this.audio.setSound(this.settings.sound);
    if (name === 'music') this.audio.setMusic(this.settings.music);
    this.audio.play('ui');
  }

  toggleFullscreen() {
    try {
      const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
      p?.catch?.(() => {}); // refused (iframes, some browsers): ignore
    } catch {
      /* not allowed here */
    }
  }

  resetRecords() {
    for (const def of TRACKS) {
      for (const l of [1, 3, 5]) store.saveRecord(def.layout.name, l, null);
      store.save(`medals.${def.layout.name}`, {});
    }
    this.refreshRecordPanel();
    this.audio.play('ui');
  }

  refreshRecordPanel() {
    const rec = store.loadRecord(this.trackId, this.settings.laps);
    const medals = store.loadMedals(this.trackId);
    this.ui.setRecord(rec?.total ?? null, medals[this.settings.laps] ?? 'none');
  }

  /* ------------------------------------------------------------ input bindings */

  bindInput() {
    const inp = this.input;
    inp.on('pause', () => {
      if (this.state === 'racing' || this.state === 'countdown') this.pause();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'results') this.toMenu();
    });
    inp.on('restart', () => {
      if (['racing', 'paused', 'results', 'countdown'].includes(this.state)) this.startRace();
    });
    inp.on('confirm', () => {
      if (this.state === 'menu') this.startRace();
      else if (this.state === 'results') {
        if (this.time - this.resultsShownAt > 1.2) this.startRace(); // ignore a boost-key tap as the sheet appears
      } else if (this.state === 'paused') this.resume();
    });
    inp.on('camera', () => {
      const i = CAMERAS.indexOf(this.settings.camera);
      this.setSetting('camera', CAMERAS[(i + 1) % CAMERAS.length]);
      if (this.state === 'racing' || this.state === 'countdown') {
        this.toast(this.settings.camera === 'overview' ? 'DESK CAM' : this.settings.camera.toUpperCase() + ' CAM', 'info');
      }
    });
    inp.on('mute', () => {
      const on = !(this.settings.sound || this.settings.music);
      this.settings.sound = on;
      this.settings.music = on;
      store.saveSettings(this.settings);
      this.ui.syncSettings(this.settings);
      this.audio.setSound(on);
      this.audio.setMusic(on);
    });
    inp.on('ghost', () => {
      const i = GHOST_MODES.indexOf(this.settings.ghost);
      this.setSetting('ghost', GHOST_MODES[(i + 1) % GHOST_MODES.length]);
      if (this.race) this.chooseGhost();
      if (this.state === 'racing') this.toast('GHOST: ' + this.settings.ghost.toUpperCase(), 'info');
    });
    inp.on('hints', () => this.toggleSetting('hints'));
  }

  /* ------------------------------------------------------------ state transitions */

  getReference(laps) {
    const key = `${this.trackId}|${laps}`;
    if (!this.refCache.has(key)) this.refCache.set(key, simulateBot(this.track, laps, { skill: 1 }));
    return this.refCache.get(key);
  }

  getRival(laps) {
    const key = `${this.trackId}|${laps}`;
    if (!this.rivalCache.has(key)) {
      const r = simulateBot(this.track, laps, { skill: RIVAL_SKILL });
      this.rivalCache.set(key, { ...r, ghost: new Ghost(r.samples, { name: 'Rival' }) });
    }
    return this.rivalCache.get(key);
  }

  chooseGhost() {
    const mode = this.settings.ghost;
    const rival = this.rivalData;
    let pick = null;
    let label = '';
    if (mode === 'off') pick = null;
    else if (mode === 'pb') {
      pick = this.pbGhost;
      label = 'BEST';
    } else if (mode === 'rival') {
      pick = rival.ghost;
      label = 'RIVAL';
    } else if (this.pbGhost) {
      pick = this.pbGhost;
      label = 'BEST';
    } else {
      pick = rival.ghost;
      label = 'RIVAL';
    }
    this.activeGhost = pick;
    this.ghostLabel = label;
    this.ghostIsRival = pick === rival.ghost;
    const cart = this.world.ghostCart;
    const rcart = this.world.rivalCart;
    cart.root.visible = false;
    rcart.root.visible = false;
  }

  startRace() {
    this.audio.init();
    this.audio.resume();
    this.audio.setIntensity?.(0);
    this.ui.showMenu(false);
    this.ui.showResults(false);
    this.ui.showPause(false);
    const laps = this.settings.laps;
    this.race = new Race(this.track, { laps });
    this.rivalData = this.getRival(laps);
    const rec = store.loadRecord(this.trackId, laps);
    this.pbRecord = rec;
    try {
      this.pbGhost = rec?.ghost ? new Ghost(decodeGhost(rec.ghost), { name: 'Best' }) : null;
    } catch {
      this.pbGhost = null;
    }
    this.chooseGhost();
    this.bestLapPrev = rec?.bestLap ?? Infinity;
    this.bestLapNow = Infinity;
    this.result = null;
    this.crashBody = null;
    this.acc = 0;
    this.countT = 0;
    this.countStep = -1;
    this.state = 'countdown';
    this.world.sparks.life.fill(0);
    this.world.trail.life.fill(0);
    this.ui.showHUD(true);
    this.ui.showTouch(this.isTouch || this.input.touchMode);
    this.ui.setLaps(laps);
    this.ui.countdown(null);
    this.ui.hintBar(true);
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.ui.hintBar(false), 9000);
    // first start from the menu: let the camera fly in from the orbit shot; restarts snap straight away
    const fromTitle = this.world.rig.mode === 'title';
    this.world.rig.setMode(this.settings.camera);
    if (!fromTitle) this.world.rig.forceSnap();
    this.prevBoosting = false;
    this.prevLaunching = false;
    this.world.post.params.flash = 0;
    this.world.rig.titleAngle = 0.4;
    this.hudDelta = null;
    this.coach = { boost: false, lean: false, usedBoost: false, leanT: 0 };
  }

  toMenu() {
    this.state = 'menu';
    this.race = null;
    this.ui.showHUD(false);
    this.ui.showPause(false);
    this.ui.showResults(false);
    this.ui.showMenu(true);
    this.ui.showTouch(false);
    this.world.rig.setMode('title');
    this.world.ghostCart.root.visible = false;
    this.world.rivalCart.root.visible = false;
    this.world.post.params.flash = 0;
    this.refreshRecordPanel();
    this.audio?.setIntensity?.(0);
  }

  pause() {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    this.resumeState = this.state;
    this.state = 'paused';
    this.ui.showPause(true);
    this.audio.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.resumeState;
    this.ui.showPause(false);
    this.audio.resume();
    this.last = performance.now();
  }

  togglePause() {
    if (this.state === 'paused') this.resume();
    else this.pause();
  }

  toast(text, kind = 'info', sub = '') {
    this.ui.toast(text, kind, sub);
  }

  /* ------------------------------------------------------------ main loop */

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    if (this.fatal) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    try {
      this.tick(dt);
    } catch (err) {
      console.error(err);
      this.errors = (this.errors ?? 0) + 1;
      if (this.errors > 20) {
        this.fatal = true;
        this.ui.fatal('Something went wrong while running the game. Please reload the page.\n' + (err && err.message ? err.message : ''));
      }
    }
  }

  tick(dt) {
    this.time += dt;
    this.updateFps(dt);
    const input = this.autopilot && this.race && this.race.state === 'running' ? this.autoInput() : this.input.poll();
    if (this.autopilot) this.input.poll();

    switch (this.state) {
      case 'menu':
        this.updateMenu(dt);
        break;
      case 'countdown':
        this.updateCountdown(dt);
        this.updateRace(0, input);
        break;
      case 'racing':
        this.updateRace(dt, input);
        break;
      case 'results':
        this.updateRace(dt, input, true);
        break;
      case 'paused':
        this.renderOnly(dt);
        return;
      default:
    }
    if (!this.noRender) this.world.render(dt);
  }

  autoInput() {
    return this.autoBot.decide(this.race.sim);
  }

  renderOnly(dt) {
    this.world.update(dt * 0, this.race?.sim.collected);
    this.world.render(0);
  }

  updateFps(dt) {
    this.fpsTimer += dt;
    this.frames++;
    if (this.fpsTimer >= 1.5) {
      this.fps = this.frames / this.fpsTimer;
      this.frames = 0;
      this.fpsTimer = 0;
      if (this.settings.quality === 'auto' && this.state !== 'paused') this.adaptQuality();
    }
  }

  adaptQuality() {
    const w = this.world;
    if (this.fps < 40 && w.maxPixelRatio > 0.8) {
      w.setPixelRatioCap(Math.max(0.75, w.maxPixelRatio - 0.25));
    } else if (this.fps < 34 && this.qualityLevel !== 'low' && w.maxPixelRatio <= 0.8) {
      this.qualityLevel = this.qualityLevel === 'high' ? 'medium' : 'low';
      w.setQuality(this.qualityLevel);
      w.setPixelRatioCap(this.baseDpr * 0.7);
    } else if (this.fps > 57 && w.maxPixelRatio < this.baseDpr && w.maxPixelRatio < (window.devicePixelRatio || 1)) {
      w.setPixelRatioCap(Math.min(this.baseDpr, w.maxPixelRatio + 0.125));
    }
  }

  /* ------------------------------------------------------------ menu / demo */

  updateMenu(dt) {
    const d = this.demo;
    d.acc += dt;
    let n = 0;
    while (d.acc >= GAME.PHYS_DT && n < 10) {
      const ev = d.sim.step(GAME.PHYS_DT, d.bot.decide(d.sim));
      for (const e of ev) {
        if (e.type === 'derail') {
          d.sim.derailed = false;
          d.sim.slip = 0;
        }
      }
      d.acc -= GAME.PHYS_DT;
      n++;
    }
    if (n === 10) d.acc = 0;
    const sim = d.sim;
    const sVis = sim.s + sim.v * d.acc;
    const f = this.world.placeCart(this.world.cart, sVis, this.pose);
    f.behind = null;
    this.world.cart.update({ dist: sim.v * dt, lean: sim.lean, boosting: sim.boosting, air: sim.air }, dt);
    this.world.rig.update(dt, f, { speed: sim.v, center: this.world.center });
    this.applyCameraFx(dt, sim, 0.6);
    this.emitEffects(dt, sim, f, true);
    this.world.update(dt, sim.collected);
    this.audio.update?.(dt, { active: false });
  }

  /* ------------------------------------------------------------ countdown */

  updateCountdown(dt) {
    this.countT += dt;
    const t = this.countT;
    const steps = [0.8, 1.8, 2.8, 3.8];
    let step = -1;
    for (let i = 0; i < steps.length; i++) if (t >= steps[i]) step = i;
    if (step !== this.countStep) {
      this.countStep = step;
      if (step >= 0 && step < 3) {
        this.countdownShown = true;
        this.ui.countdown(3 - step);
        this.audio.play('beep');
      } else if (step === 3) {
        this.ui.countdown('GO');
        this.audio.play('go');
        this.race.start();
        this.state = 'racing';
        this.world.rig.jolt(0.4);
        this.goAt = this.time;
        this.startChecked = false;
      }
    }
  }

  /* ------------------------------------------------------------ racing */

  updateRace(dt, input, frozen = false) {
    const race = this.race;
    const sim = race.sim;
    // reaction start: a fresh boost press around the green light earns a free kick
    if (input.boost && !this.prevBoostKey) this.lastBoostPress = this.time;
    this.prevBoostKey = !!input.boost;
    if (this.state === 'racing' && !this.startChecked && this.time > this.goAt + 0.4) {
      this.startChecked = true;
      if (this.lastBoostPress >= this.goAt - 0.25 && this.lastBoostPress <= this.goAt + 0.4) {
        sim.boost = Math.min(PHYS.BOOST_MAX, sim.boost + PHYS.START_BOOST);
        this.toast('Great start!', 'good', `+${PHYS.START_BOOST}% boost`);
        this.audio.play('pickup');
        this.world.rig.jolt(0.3);
      }
    }
    if (this.edgeFlash > 0) this.edgeFlash -= dt;
    if (!frozen && this.state !== 'countdown') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= GAME.PHYS_DT && n < 14) {
        const ev = race.step(GAME.PHYS_DT, input);
        for (const e of ev) this.onRaceEvent(e);
        this.acc -= GAME.PHYS_DT;
        n++;
      }
      if (n === 14) this.acc = 0;
    } else if (frozen) {
      // results: keep the (stopped) cart simulation ticking for the finish animation
      this.acc += dt;
      let n = 0;
      while (this.acc >= GAME.PHYS_DT && n < 14) {
        race.step(GAME.PHYS_DT, input);
        this.acc -= GAME.PHYS_DT;
        n++;
      }
      if (n === 14) this.acc = 0;
    }
    const world = this.world;

    // --- pose of the player's cart
    const L = this.track.length;
    let sVis = sim.s + (race.crash || race.state === 'countdown' ? 0 : sim.v * this.acc);
    sVis = ((sVis % L) + L) % L;
    let frame;
    if (race.crash) {
      frame = this.updateCrash(dt, sim);
      frame.behind = null;
    } else {
      this.crashBody = null;
      frame = world.placeCart(world.cart, sVis, this.pose);
      world.cart.root.visible = true;
      frame.behind = this.track.piece.frame(sVis - world.rig.chaseDistance(sim.v), this.behindPose);
      frame.invW = this.inversionWeight(sVis);
      frame.loopCam = this.loopCam;
    }
    world.cart.update({ dist: race.crash ? 0 : sim.v * dt, lean: sim.lean, boosting: sim.boosting, air: sim.air }, dt);

    // --- ghost
    this.updateGhosts(dt);

    // --- camera + post
    world.rig.update(dt, frame, { speed: sim.v, lean: sim.lean, boosting: sim.boosting, slip: sim.slip, center: world.center });
    world.cart.setFirstPerson(world.rig.mode === 'onboard' && !race.crash);
    this.applyCameraFx(dt, sim, 1);
    this.emitEffects(dt, sim, frame, false);
    world.update(dt, sim.collected);

    // --- audio / hud
    this.audio.update(dt, {
      active: !race.crash && race.state !== 'countdown',
      speed: sim.v,
      boosting: sim.boosting,
      braking: sim.braking && race.state === 'running',
      util: sim.util,
      air: sim.air,
    });
    this.audio.setIntensity?.(clamp(sim.v / 14, 0, 1));
    this.updateHud(dt);

    if (this.countdownShown && race.state !== 'countdown' && race.time > 0.9) {
      this.countdownShown = false;
      this.ui.countdown(null);
    }
    if (this.state === 'results') return;
    if (race.state === 'done' && !this.result) this.finalizeResult();
    if (this.result && !this.showResultsAt) this.showResultsAt = this.time + 1.2;
    if (this.result && this.showResultsAt && this.time >= this.showResultsAt && this.state !== 'results') this.showResults();
  }

  /** 0..1: how close the cart is to an inversion (the camera rolls with the track there). */
  inversionWeight(s) {
    let w = 0;
    const L = this.track.length;
    for (const iv of this.track.piece.inversions) {
      let d = 0;
      if (s < iv.s0) d = iv.s0 - s;
      else if (s > iv.s1) d = s - iv.s1;
      d = Math.min(d, L - d + 0);
      const x = Math.min(1, Math.max(0, d / 7));
      w = Math.max(w, 1 - x * x * (3 - 2 * x));
    }
    return w;
  }

  onRaceEvent(e) {
    const race = this.race;
    switch (e.type) {
      case 'lap': {
        const isFinal = e.lap >= race.laps;
        const prevBest = Math.min(this.bestLapPrev, this.bestLapNow);
        const isBest = e.lapTime < prevBest - 1e-6;
        this.bestLapNow = Math.min(this.bestLapNow, e.lapTime);
        if (!isFinal) {
          if (isBest && Number.isFinite(prevBest)) {
            this.toast('New best lap', 'gold', fmtTime(e.lapTime));
            this.audio.play('best');
            this.ui.flash('#ffd23d', 0.18);
          } else {
            this.toast(e.lap === race.laps - 1 ? 'Final lap' : `Lap ${e.lap + 1}`, 'info', fmtTime(e.lapTime));
            this.audio.play('lap');
            this.ui.flash('#ffffff', 0.1);
          }
        }
        break;
      }
      case 'checkpoint': {
        const d = race.deltaAt(this.activeGhost, e.progress, e.time);
        this.audio.play('checkpoint');
        if (d !== null) {
          this.toast(`Split ${e.index + 1}`, d <= 0 ? 'good' : 'bad', `${fmtDelta(d)} vs ${this.ghostLabel}`);
        }
        break;
      }
      case 'pickup': {
        this.audio.play('pickup');
        const g = this.world.pickups.items[e.index];
        if (g) {
          for (let i = 0; i < 26; i++) {
            const v = new Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3);
            this.world.sparks.emit(g.userData.base, v, { life: 0.7, size: 0.22, color: 0xb6ff3c });
          }
        }
        break;
      }
      case 'edge':
        this.audio.play('edge');
        this.edgeFlash = 0.35;
        break;
      case 'derail':
        this.audio.play('derail');
        this.toast('Derailed!', 'bad', `+${GAME.DERAIL_PENALTY.toFixed(1)} s penalty`);
        this.ui.flash('#ff2a3d', 0.35);
        this.world.rig.jolt(1.2);
        this.startCrash(e);
        break;
      case 'stall':
        this.audio.play('derail');
        this.toast('Stalled', 'bad', 'resetting…');
        this.startCrash({ ...e, v: 3, util: 0 });
        break;
      case 'respawn':
        this.audio.play('respawn');
        this.world.rig.forceSnap();
        this.world.cart.root.visible = true;
        this.crashBody = null;
        break;
      case 'finish':
        this.audio.play('finish');
        this.toast('Finish!', 'gold', fmtTime(e.total));
        this.ui.flash('#ffffff', 0.3);
        this.world.rig.setMode('overview');
        this.confettiT = 2.8;
        break;
      case 'done':
        break;
      default:
    }
  }

  /* ------------------------------------------------------------ derail animation */

  startCrash(e) {
    const world = this.world;
    const sim = this.race.sim;
    world.placeCart(world.cart, sim.s, this.pose);
    const f = this.pose;
    const dir = Math.sign(e.util || 1);
    const v = e.v ?? sim.v;
    this.crashBody = {
      pos: f.pos.clone().addScaledVector(f.up, 0.3),
      vel: f.tan.clone().multiplyScalar(v * 0.85).addScaledVector(f.right, dir * (1.5 + v * 0.18)).addScaledVector(WORLD_UP, 2.5 + v * 0.25),
      quat: world.cart.root.quaternion.clone(),
      ang: new Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, -dir * (4 + Math.random() * 6)),
      tan: f.tan.clone(),
      bounces: 0,
    };
    for (let i = 0; i < 40; i++) {
      const vv = new Vector3((Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4);
      world.sparks.emit(f.pos, vv, { life: 0.7, size: 0.2, color: 0xffb04a });
    }
  }

  updateCrash(dt, sim) {
    const world = this.world;
    const b = this.crashBody;
    const frame = this.pose;
    if (!b) return frame;
    const g = -22;
    b.vel.y += g * dt;
    b.pos.addScaledVector(b.vel, dt);
    if (b.pos.y < 0.45) {
      b.pos.y = 0.45;
      if (b.vel.y < -1) {
        b.vel.y *= -0.35;
        b.bounces++;
        for (let i = 0; i < 12; i++) world.sparks.emit(b.pos, new Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4), { life: 0.5, size: 0.18, color: 0xffd08a });
      } else b.vel.y = 0;
      b.vel.x *= 0.92;
      b.vel.z *= 0.92;
      b.ang.multiplyScalar(0.9);
    }
    const q = new Quaternion().setFromEuler(new Euler(b.ang.x * dt, b.ang.y * dt, b.ang.z * dt));
    b.quat.premultiply(q).normalize();
    world.cart.root.position.copy(b.pos);
    world.cart.root.quaternion.copy(b.quat);
    // camera follows the wreck
    frame.pos.copy(b.pos);
    frame.tan.copy(b.tan);
    frame.up.copy(WORLD_UP);
    frame.right.crossVectors(frame.tan, frame.up);
    return frame;
  }

  /* ------------------------------------------------------------ ghosts */

  updateGhosts(dt) {
    const world = this.world;
    const race = this.race;
    const L = this.track.length;
    const ghost = this.activeGhost;
    const gc = world.ghostCart;
    const rc = world.rivalCart;
    gc.root.visible = false;
    rc.root.visible = false;
    if (!ghost || (race.state !== 'running' && race.state !== 'finishing')) return;
    const progress = ghost.progressAt(race.time);
    if (progress > race.laps * L + 14) return;
    const cart = this.ghostIsRival ? rc : gc;
    const s = ((progress % L) + L) % L;
    world.placeCart(cart, s);
    cart.root.visible = true;
    const prev = ghost.progressAt(race.time - 0.05);
    cart.update({ dist: Math.max(0, progress - prev), lean: 0, boosting: false, air: 0 }, dt);
    this.ghostS = s;
  }

  /* ------------------------------------------------------------ effects */

  applyCameraFx(dt, sim, intensity) {
    const post = this.world.post.params;
    const rig = this.world.rig;
    const vn = clamp(sim.v / 15, 0, 1);
    const mode = rig.mode;
    post.focus = rig.focus;
    post.dofStrength = (mode === 'title' ? 1.6 : mode === 'overview' ? 2.0 : 1.0) * rig.dofScale * 0.8;
    post.dofMax = mode === 'overview' || mode === 'title' ? 11 : 6.5;
    post.deadZone = mode === 'overview' || mode === 'title' ? 7 : mode === 'onboard' ? 8 : 4.5;
    post.dof = this.qualityLevel !== 'low';
    post.speedBlur = this.reducedMotion ? 0 : (vn * vn * 0.04 + (sim.boosting ? 0.03 : 0)) * intensity * (mode === 'onboard' ? 1.3 : mode === 'chase' ? 1 : 0.3);
    post.vignette = 0.34 + vn * 0.12 * intensity;
    post.aberration = 0.0004 + vn * 0.0005 * intensity;
    post.grain = 0.016;
  }

  emitEffects(dt, sim, frame, demo) {
    const world = this.world;
    const v = sim.v;
    if (!frame.pos) return;
    const p = new Vector3();
    const vel = new Vector3();
    // boost exhaust trail
    if (sim.boosting) {
      this.trailAcc += dt * 140;
      while (this.trailAcc >= 1) {
        this.trailAcc -= 1;
        p.copy(frame.pos).addScaledVector(frame.up, 0.45).addScaledVector(frame.tan, -0.7);
        vel.copy(frame.tan).multiplyScalar(-(3 + v * 0.35)).addScaledVector(frame.right, (Math.random() - 0.5) * 0.9).addScaledVector(frame.up, (Math.random() - 0.5) * 0.9);
        world.trail.emit(p, vel, { life: 0.5, size: 0.4, color: Math.random() < 0.4 ? 0xfff0b0 : 0xff9b3a });
      }
    }
    // launch sparks
    if (sim.launching) {
      this.sparkAcc += dt * 90;
      while (this.sparkAcc >= 1) {
        this.sparkAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        p.copy(frame.pos).addScaledVector(frame.right, side * 0.37).addScaledVector(frame.up, 0.05).addScaledVector(frame.tan, -0.3);
        vel.copy(frame.tan).multiplyScalar(-v * 0.2).addScaledVector(frame.up, 1 + Math.random() * 2).addScaledVector(frame.right, side * Math.random() * 2);
        world.sparks.emit(p, vel, { life: 0.35, size: 0.14, color: 0x66d8ff });
      }
    }
    // cornering / braking sparks
    const slipping = Math.abs(sim.util) > 0.92 && v > 2;
    const braking = sim.braking && v > 3 && !demo;
    if (slipping || braking) {
      this.sparkAcc += dt * (slipping ? 110 : 60);
      while (this.sparkAcc >= 1) {
        this.sparkAcc -= 1;
        const side = slipping ? Math.sign(sim.util) : Math.random() < 0.5 ? -1 : 1;
        p.copy(frame.pos).addScaledVector(frame.right, side * 0.4).addScaledVector(frame.up, 0.05).addScaledVector(frame.tan, -0.35 + Math.random() * 0.8);
        vel.copy(frame.tan).multiplyScalar(-v * 0.15).addScaledVector(frame.up, 1.2 + Math.random() * 2.5).addScaledVector(frame.right, side * (0.5 + Math.random() * 2.2));
        world.sparks.emit(p, vel, { life: 0.45, size: 0.16, color: braking && !slipping ? 0xffe08a : 0xff9a3a });
      }
    }
    // confetti
    if (this.confettiT > 0 && !demo) {
      this.confettiT -= dt;
      const fp = this.track.piece.frame(0, makeFrame());
      for (let i = 0; i < 5; i++) {
        p.copy(fp.pos).addScaledVector(fp.up, 3.8).addScaledVector(fp.right, (Math.random() - 0.5) * 4).addScaledVector(fp.tan, (Math.random() - 0.5) * 3);
        vel.set((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5);
        const colors = [0xff5a36, 0xffd23d, 0x2fe0cb, 0x59d2ff, 0xffffff, 0xff7ab8];
        world.sparks.emit(p, vel, { life: 1.6, size: 0.3, color: colors[(Math.random() * colors.length) | 0] });
      }
    }
    // transitions → sounds
    if (!demo) {
      if (sim.boosting && !this.prevBoosting) this.audio.play('boost-start');
      if (sim.launching && !this.prevLaunching && v < 12) {
        this.audio.play('launch');
        this.world.rig.jolt(0.5);
      }
      this.prevBoosting = sim.boosting;
      this.prevLaunching = sim.launching;
    }
  }

  /* ------------------------------------------------------------ HUD */

  updateHud(dt) {
    const race = this.race;
    const sim = race.sim;
    const P = this.track.piece;
    const running = race.state === 'running' || race.state === 'finishing';
    const time = race.finishTime ?? race.time;
    const last = race.lapTimes.length ? race.lapTimes[race.lapTimes.length - 1] : null;
    const bestLap = Math.min(this.bestLapPrev, this.bestLapNow);
    // continuous delta vs the ghost (updated ~10 Hz)
    this.hudDelta = this.hudDelta ?? { t: 0, v: null };
    this.hudDelta.t += dt;
    if (this.hudDelta.t > 0.1) {
      this.hudDelta.t = 0;
      this.hudDelta.v = race.state === 'running' && this.settings.ghost !== 'off' ? race.deltaVs(this.activeGhost) : this.hudDelta.v;
    }
    // speed target ahead (what the ideal driver does here)
    const prof = sim.boost > 4 ? P.profileBoost.v : P.profile.v;
    const target = P.sample(P.profile.v, sim.s + 2 + sim.v * 0.5);
    const targetNow = P.sample(prof, sim.s + 0.6 + sim.v * 0.18);
    const brakeHint = this.settings.hints && race.state === 'running' && !race.crash && sim.v > targetNow + 0.45 && sim.v > 4;
    this.runCoach(dt, race, sim);
    this.ui.hud({
      time: running ? time : 0,
      lap: race.currentLap,
      last,
      bestLap: Number.isFinite(bestLap) ? bestLap : null,
      delta: race.state === 'running' ? this.hudDelta.v : null,
      deltaLabel: this.ghostLabel || '',
      speed: sim.v,
      limit: this.settings.hints ? target : null,
      boost: sim.boost,
      boosting: sim.boosting,
      util: sim.util,
      leanHint: clamp(sim.gSideRaw / PHYS.LEAN, -1, 1) * (sim.v > 2 ? 1 : 0),
      brakeHint,
      edge: sim.onEdge || this.edgeFlash > 0,
      map: { player: sim.s, ghost: running && this.activeGhost && !this.ghostIsRival ? this.ghostS : null, rival: running && this.activeGhost && this.ghostIsRival ? this.ghostS : null },
    });
  }

  /** One-time coaching tips for first-time players. */
  runCoach(dt, race, sim) {
    const c = this.coach;
    if (!c || !this.settings.hints || race.state !== 'running' || race.crash) return;
    if (this.input.state.boost) c.usedBoost = true;
    const done = this.settings.tips ?? {};
    if (!done.boost && !c.boost && !c.usedBoost && race.time > 2.2 && sim.boost > 25) {
      c.boost = true;
      this.toast('Boost!', 'blue', this.isTouch ? 'hold the BOOST button' : 'hold SPACE');
      this.settings.tips = { ...done, boost: true };
      store.saveSettings(this.settings);
    }
    if (Math.abs(sim.gSideRaw) > 0.3 && Math.abs(this.input.state.lean) < 0.1 && sim.v > 5) c.leanT += dt;
    else c.leanT = Math.max(0, c.leanT - dt);
    if (!done.lean && !c.lean && c.leanT > 0.5) {
      c.lean = true;
      this.toast('Lean in', 'blue', this.isTouch ? 'use ◀ ▶ through bends' : 'hold A / D through bends');
      this.settings.tips = { ...(this.settings.tips ?? {}), lean: true };
      store.saveSettings(this.settings);
    }
  }

  /* ------------------------------------------------------------ results */

  finalizeResult() {
    const race = this.race;
    const laps = race.laps;
    const total = race.finishTime;
    if (total == null) return;
    const ref = this.getReference(laps).total;
    const medal = medalFor(total, ref);
    const prev = store.loadRecord(this.trackId, laps);
    const lapsArr = race.lapTimes.slice();
    const bestLap = Math.min(...lapsArr);
    const newRecord = !prev || total < prev.total - 1e-6;
    if (newRecord) {
      store.saveRecord(this.trackId, laps, {
        total,
        laps: lapsArr,
        bestLap: Math.min(bestLap, prev?.bestLap ?? Infinity),
        ghost: encodeGhost(race.recorder.finish()),
        date: Date.now(),
      });
    } else if (prev && bestLap < (prev.bestLap ?? Infinity)) {
      store.saveRecord(this.trackId, laps, { ...prev, bestLap });
    }
    store.saveMedal(this.trackId, laps, medal);
    const rival = this.rivalData;
    this.result = {
      total,
      laps: lapsArr,
      bestLapIndex: lapsArr.indexOf(bestLap),
      newRecord,
      medal,
      targets: medalTargets(ref),
      penalties: race.penalties,
      laps_n: laps,
      rivalDelta: rival ? total - rival.total : null,
    };
    if (medal !== 'none') setTimeout(() => this.audio.play('medal'), 300);
  }

  showResults() {
    if (!this.result) return;
    const r = this.result;
    this.state = 'results';
    this.resultsShownAt = this.time;
    const title = r.medal === 'none' ? 'Finished' : `${r.medal[0].toUpperCase()}${r.medal.slice(1)} medal`;
    this.ui.showHUD(false);
    this.ui.showTouch(false);
    this.ui.showResultsSheet({
      title,
      total: r.total,
      laps: r.laps,
      bestLapIndex: r.bestLapIndex,
      newRecord: r.newRecord,
      medal: r.medal,
      targets: r.targets,
      penalties: r.penalties,
      rivalDelta: r.rivalDelta,
    });
    this.showResultsAt = 0;
  }

  /* ------------------------------------------------------------ debug helpers */

  /** Advance the race deterministically without rendering (tests). */
  advance(seconds, inputFn = null) {
    const race = this.race;
    const steps = Math.round(seconds / GAME.PHYS_DT);
    for (let i = 0; i < steps; i++) {
      if (race.state === 'countdown') {
        race.start();
        this.state = 'racing';
      }
      const inp = inputFn ? inputFn(race.sim) : this.autoBot ? this.autoBot.decide(race.sim) : { lean: 0, brake: 0, boost: false };
      const ev = race.step(GAME.PHYS_DT, inp);
      for (const e of ev) this.onRaceEvent(e);
      if (race.state === 'done' && !this.result) this.finalizeResult();
    }
  }
}

