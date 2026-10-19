// Procedural audio: everything is synthesised with the Web Audio API (no asset files).

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

function noiseBuffer(ctx, seconds = 2, pink = false) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (!pink) {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } else {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.soundOn = true;
    this.musicOn = true;
    this.started = false;
    this.clackDist = 0;
    this.lastAir = 0;
    this.lastLaunch = false;
    this.music = { timer: null, step: 0, next: 0, intensity: 0 };
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // wait for a gesture
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.soundOn ? 1.5 : 0;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.55 : 0;
    this.musicBus.connect(this.master);

    this.white = noiseBuffer(ctx, 2, false);
    this.pink = noiseBuffer(ctx, 3, true);
    this._buildLoops();
    this.started = true;
    if (this.musicOn) this.startMusic();
  }

  setSound(on) {
    this.soundOn = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 1.5 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.2);
    if (on) this.startMusic();
    else this.stopMusic();
  }

  suspend() {
    this.ctx?.suspend?.();
  }

  resume() {
    this.ctx?.resume?.();
  }

  /* ------------------------------------------------------------ continuous loops */

  _loop(buffer, { type = 'lowpass', freq = 400, q = 0.7, gain = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
    return { src, f, g };
  }

  _buildLoops() {
    const ctx = this.ctx;
    this.rumble = this._loop(this.pink, { type: 'lowpass', freq: 200, q: 0.9, gain: 0 });
    this.wind = this._loop(this.pink, { type: 'bandpass', freq: 700, q: 0.5, gain: 0 });
    this.jet = this._loop(this.white, { type: 'lowpass', freq: 1800, q: 0.8, gain: 0 });
    this.squeal = this._loop(this.white, { type: 'bandpass', freq: 3300, q: 9, gain: 0 });
    this.screech = this._loop(this.white, { type: 'bandpass', freq: 1500, q: 14, gain: 0 });
    // rail hum: a detuned saw pair that tracks speed
    this.hum = ctx.createOscillator();
    this.hum.type = 'sawtooth';
    this.hum.frequency.value = 70;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 420;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.hum.connect(hf).connect(this.humGain).connect(this.sfx);
    this.hum.start();
    // jet tone
    this.jetTone = ctx.createOscillator();
    this.jetTone.type = 'sawtooth';
    this.jetTone.frequency.value = 140;
    const jf = ctx.createBiquadFilter();
    jf.type = 'lowpass';
    jf.frequency.value = 900;
    this.jetToneGain = ctx.createGain();
    this.jetToneGain.gain.value = 0;
    this.jetTone.connect(jf).connect(this.jetToneGain).connect(this.sfx);
    this.jetTone.start();
  }

  /**
   * Per-frame update of the continuous sounds.
   * s: { speed, boosting, braking, slip, util, air, active }
   */
  update(dt, s) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const k = 0.06;
    const v = s.active ? s.speed : 0;
    const vn = clamp(v / 15, 0, 1);
    this.rumble.g.gain.setTargetAtTime(s.active ? (0.05 + vn * 0.34) * (1 - 0.8 * (s.air ?? 0)) : 0, t, k);
    this.rumble.f.frequency.setTargetAtTime(110 + vn * 900, t, k);
    this.wind.g.gain.setTargetAtTime(vn * vn * 0.3, t, k);
    this.wind.f.frequency.setTargetAtTime(380 + vn * 2600, t, k);
    this.humGain.gain.setTargetAtTime(s.active ? 0.012 + vn * 0.03 : 0, t, k);
    this.hum.frequency.setTargetAtTime(55 + vn * 140, t, k);
    const boost = s.boosting ? 1 : 0;
    this.jet.g.gain.setTargetAtTime(boost * 0.26, t, 0.05);
    this.jet.f.frequency.setTargetAtTime(1200 + vn * 3000, t, 0.1);
    this.jetToneGain.gain.setTargetAtTime(boost * 0.08, t, 0.05);
    this.jetTone.frequency.setTargetAtTime(110 + vn * 260, t, 0.1);
    const brk = s.braking && v > 1.5 ? clamp(v / 12, 0.2, 1) : 0;
    this.squeal.g.gain.setTargetAtTime(brk * 0.09, t, 0.04);
    this.squeal.f.frequency.setTargetAtTime(2400 + v * 110, t, 0.06);
    const over = clamp(((Math.abs(s.util ?? 0) - 0.82) / 0.4), 0, 1) * (v > 2 ? 1 : 0);
    this.screech.g.gain.setTargetAtTime(over * 0.1, t, 0.04);
    this.screech.f.frequency.setTargetAtTime(1100 + over * 900 + v * 30, t, 0.05);

    // rail joint clacks (front + rear wheel set)
    if (s.active && v > 1) {
      this.clackDist += v * dt;
      if (this.clackDist > 3.1) {
        this.clackDist -= 3.1;
        this.clack(v);
      }
    }
    // airtime whoosh edge
    if ((s.air ?? 0) > 0.55 && this.lastAir <= 0.55) this.whoosh(0.7);
    this.lastAir = s.air ?? 0;
  }

  /* ------------------------------------------------------------ one-shots */

  _env(g, t, a, peak, d) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _noiseHit(t, { freq = 1200, q = 1, type = 'bandpass', a = 0.002, d = 0.05, vol = 0.3, out = this.sfx } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, a, vol, d);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5, a + d + 0.05);
  }

  _tone(t, { freq = 440, type = 'sine', a = 0.005, d = 0.2, vol = 0.2, slideTo = null, out = this.sfx, detune = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + a + d);
    o.detune.value = detune;
    const g = ctx.createGain();
    this._env(g, t, a, vol, d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }

  clack(speed) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const vol = clamp(speed / 12, 0.15, 0.9);
    const gap = clamp(0.9 / Math.max(speed, 1), 0.04, 0.2); // wheelbase / speed
    for (let i = 0; i < 2; i++) {
      const tt = t + i * gap;
      this._noiseHit(tt, { freq: 1100 + Math.random() * 500, q: 1.2, a: 0.001, d: 0.035, vol: 0.2 * vol * (i ? 0.8 : 1) });
      this._tone(tt, { freq: 95 + Math.random() * 20, a: 0.001, d: 0.06, vol: 0.12 * vol, slideTo: 60 });
    }
  }

  whoosh(vol = 0.5) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.35);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 2, 1);
  }

  play(name) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'beep':
        this._tone(t, { freq: 523.25, type: 'square', a: 0.004, d: 0.16, vol: 0.09 });
        this._tone(t, { freq: 523.25, type: 'sine', a: 0.004, d: 0.2, vol: 0.18 });
        break;
      case 'go':
        this._tone(t, { freq: 1046.5, type: 'square', a: 0.004, d: 0.5, vol: 0.08 });
        this._tone(t, { freq: 1046.5, type: 'sine', a: 0.004, d: 0.55, vol: 0.2 });
        this._tone(t, { freq: 1568, type: 'sine', a: 0.004, d: 0.4, vol: 0.08 });
        break;
      case 'launch': {
        this._tone(t, { freq: 180, type: 'sawtooth', a: 0.02, d: 0.6, vol: 0.12, slideTo: 1500 });
        this._tone(t, { freq: 90, type: 'sine', a: 0.01, d: 0.5, vol: 0.25, slideTo: 40 });
        this._noiseHit(t, { freq: 2400, q: 0.5, a: 0.03, d: 0.6, vol: 0.16 });
        break;
      }
      case 'pickup':
        this._tone(t, { freq: 880, type: 'sine', a: 0.004, d: 0.12, vol: 0.2 });
        this._tone(t + 0.07, { freq: 1318.5, type: 'sine', a: 0.004, d: 0.22, vol: 0.2 });
        this._tone(t + 0.07, { freq: 2637, type: 'sine', a: 0.004, d: 0.18, vol: 0.05 });
        break;
      case 'checkpoint':
        this._tone(t, { freq: 659.25, type: 'triangle', a: 0.004, d: 0.3, vol: 0.18 });
        this._tone(t + 0.09, { freq: 987.77, type: 'triangle', a: 0.004, d: 0.35, vol: 0.16 });
        break;
      case 'lap':
        [523.25, 659.25, 783.99].forEach((f, i) => this._tone(t + i * 0.08, { freq: f, type: 'triangle', a: 0.004, d: 0.3, vol: 0.2 }));
        break;
      case 'best':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this._tone(t + i * 0.07, { freq: f, type: 'triangle', a: 0.004, d: 0.4, vol: 0.2 }));
        break;
      case 'finish': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
        notes.forEach((f, i) => {
          this._tone(t + i * 0.11, { freq: f, type: 'triangle', a: 0.005, d: 0.5, vol: 0.22 });
          this._tone(t + i * 0.11, { freq: f * 2, type: 'sine', a: 0.005, d: 0.4, vol: 0.05 });
        });
        break;
      }
      case 'medal':
        [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => this._tone(t + 0.5 + i * 0.12, { freq: f, type: 'sine', a: 0.005, d: 0.7, vol: 0.14 }));
        break;
      case 'derail':
        this._noiseHit(t, { freq: 500, q: 0.4, type: 'lowpass', a: 0.002, d: 0.7, vol: 0.5 });
        this._tone(t, { freq: 220, type: 'sawtooth', a: 0.005, d: 0.9, vol: 0.2, slideTo: 40 });
        this._tone(t, { freq: 70, type: 'sine', a: 0.003, d: 0.5, vol: 0.4, slideTo: 30 });
        for (let i = 0; i < 6; i++) this._noiseHit(t + 0.15 + i * 0.12, { freq: 1500 + Math.random() * 2500, q: 2, a: 0.001, d: 0.05, vol: 0.14 });
        break;
      case 'respawn':
        this._tone(t, { freq: 330, type: 'sine', a: 0.01, d: 0.3, vol: 0.14, slideTo: 660 });
        break;
      case 'boost-start':
        this.whoosh(0.35);
        this._tone(t, { freq: 200, type: 'sawtooth', a: 0.01, d: 0.3, vol: 0.07, slideTo: 800 });
        break;
      case 'edge':
        this._tone(t, { freq: 1568, type: 'sine', a: 0.003, d: 0.09, vol: 0.09 });
        this._tone(t + 0.04, { freq: 2093, type: 'sine', a: 0.003, d: 0.1, vol: 0.06 });
        break;
      case 'ui':
        this._tone(t, { freq: 700, type: 'sine', a: 0.003, d: 0.07, vol: 0.12 });
        break;
      case 'start-engine':
        this._tone(t, { freq: 90, type: 'sawtooth', a: 0.05, d: 0.6, vol: 0.06, slideTo: 140 });
        break;
      default:
    }
  }

  /* ------------------------------------------------------------ music */

  startMusic() {
    if (!this.ctx || this.music.timer) return;
    const m = this.music;
    m.step = 0;
    m.next = this.ctx.currentTime + 0.1;
    // delay for the lead
    if (!this.delay) {
      const ctx = this.ctx;
      this.delay = ctx.createDelay(1);
      this.delay.delayTime.value = 0.34;
      const fb = ctx.createGain();
      fb.gain.value = 0.38;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      this.delay.connect(lp).connect(fb).connect(this.delay);
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      lp.connect(wet).connect(this.musicBus);
    }
    m.timer = setInterval(() => this._schedule(), 40);
  }

  stopMusic() {
    if (this.music.timer) {
      clearInterval(this.music.timer);
      this.music.timer = null;
    }
  }

  setIntensity(x) {
    this.music.intensity = clamp(x, 0, 1);
  }

  _schedule() {
    const ctx = this.ctx;
    const m = this.music;
    const bpm = 92 + m.intensity * 18;
    const stepDur = 60 / bpm / 4; // 16th
    while (m.next < ctx.currentTime + 0.25) {
      this._musicStep(m.step, m.next, stepDur);
      m.next += stepDur;
      m.step = (m.step + 1) % 64;
    }
  }

  _musicStep(step, t, dur) {
    const bar = Math.floor(step / 16) % 4;
    const pos = step % 16;
    const chords = [
      [48, 55, 59, 64, 67], // Cmaj7
      [45, 55, 60, 64, 67], // Am7
      [41, 53, 57, 60, 64], // Fmaj7
      [43, 53, 59, 62, 65], // G7
    ];
    const ch = chords[bar];
    const out = this.musicBus;
    const I = this.music.intensity;
    // chords on beats (soft e-piano)
    if (pos === 0 || pos === 6 || pos === 10) {
      for (let i = 1; i < ch.length; i++) {
        this._musicTone(t + i * 0.012, NOTE(ch[i] + 12), 'triangle', dur * 5, 0.045, out);
        this._musicTone(t + i * 0.012, NOTE(ch[i] + 12) * 2.005, 'sine', dur * 3, 0.012, out);
      }
    }
    // bass
    if (pos === 0 || pos === 7 || pos === 10 || (I > 0.4 && pos === 12)) this._musicTone(t, NOTE(ch[0]), 'sine', dur * 3.2, 0.2, out);
    // kick
    if (pos === 0 || pos === 8 || (I > 0.5 && pos === 11)) this._kick(t, 0.28);
    // snare
    if (pos === 4 || pos === 12) this._noiseHit(t, { freq: 1900, q: 0.8, type: 'bandpass', a: 0.001, d: 0.12, vol: 0.09, out });
    // hats
    if (pos % 2 === 0 || I > 0.45) this._noiseHit(t, { freq: 8500, q: 0.7, type: 'highpass', a: 0.001, d: 0.03 + (pos % 4 === 2 ? 0.03 : 0), vol: pos % 4 === 2 ? 0.045 : 0.025, out });
    // sparse pentatonic lead
    if (pos % 4 === 0 && Math.random() < 0.45 + I * 0.25) {
      const scale = [0, 2, 4, 7, 9];
      const root = [72, 69, 65, 67][bar];
      const n = root + scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
      this._musicTone(t, NOTE(n), 'sine', dur * 3, 0.05, out, true);
    }
  }

  _musicTone(t, freq, type, dur, vol, out, echo = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800 + this.music.intensity * 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(out);
    if (echo && this.delay) g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _kick(t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.25);
  }
}
