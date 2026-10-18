// Procedural sound: a synthesised cathedral reverb, an organ-and-choir drone, and stone,
// steel and magic effects. Nothing is sampled; everything is generated with Web Audio.

const CHORDS = [
  [73.42, [146.83, 174.61, 220.0]], // D minor
  [58.27, [116.54, 146.83, 174.61]], // B-flat
  [87.31, [130.81, 174.61, 220.0]], // F
  [65.41, [130.81, 164.81, 196.0]], // C
  [73.42, [146.83, 174.61, 220.0]],
  [55.0, [110.0, 138.59, 164.81]], // A
];

export class SoundBoard {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.5;
    this.muted = false;
    this.clickBudget = 0;
    this.lastClick = 0;
  }

  get ready() { return Boolean(this.ctx); }

  // Must run inside a user gesture the first time.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(4.6, 2.6);
    this.send = ctx.createGain();
    this.send.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.send.connect(this.reverb).connect(wet).connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startAmbience();
  }

  impulse(seconds, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // Darkening tail: progressively heavier low-pass on the noise.
        const k = 0.65 - 0.6 * t;
        low += (Math.random() * 2 - 1 - low) * k;
        const early = i < rate * 0.08 && Math.random() < 0.004 ? 2.5 : 1;
        d[i] = low * Math.pow(1 - t, decay) * early;
      }
    }
    return buffer;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.05);
    this.sfx.gain.setTargetAtTime(this.sfxVolume, now, 0.05);
    this.music.gain.setTargetAtTime(this.musicVolume * 0.9, now, 0.3);
  }

  setVolumes({sfx = this.sfxVolume, music = this.musicVolume}) {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    this.applyVolumes();
  }

  setMuted(muted) { this.muted = muted; this.applyVolumes(); }

  pause() { this.paused = true; if (this.ctx) this.ctx.suspend().catch(() => {}); }
  resume() { this.paused = false; if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  // ---------- building blocks ----------

  out(gain, send) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.sfx);
    if (send) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.send);
    }
    return g;
  }

  env(param, t, attack, peak, hold, release) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    if (hold) param.setValueAtTime(peak, t + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  tone({type = 'sine', freq, to = null, dur = 0.3, attack = 0.005, gain = 0.3, send = 0.3, delay = 0, detune = 0, release = null}) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    osc.detune.value = detune;
    const g = this.out(gain, send);
    this.env(g.gain, t, attack, gain, 0, release ?? dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + attack + (release ?? dur) + 0.05);
    return osc;
  }

  hiss({filter = 'bandpass', freq = 1000, to = null, q = 1, dur = 0.2, attack = 0.005, gain = 0.3, send = 0.3, delay = 0, hold = 0}) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + attack + hold + dur);
    f.Q.value = q;
    const g = this.out(gain, send);
    this.env(g.gain, t, attack, gain, hold, dur);
    src.connect(f).connect(g);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + hold + dur + 0.05);
    return {src, g};
  }

  // ---------- effects ----------

  play(name, o = {}) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const v = o.volume ?? 1;
    switch (name) {
      case 'ui':
        this.tone({freq: 880, to: 620, dur: 0.06, gain: 0.05 * v, send: 0.2});
        break;
      case 'select':
        this.hiss({freq: 2400, q: 2, dur: 0.03, gain: 0.12 * v, send: 0.3});
        this.tone({freq: 1318.5, dur: 0.55, gain: 0.045 * v, send: 0.6});
        this.tone({freq: 1975.5, dur: 0.4, gain: 0.025 * v, send: 0.6, delay: 0.02});
        break;
      case 'deselect':
        this.tone({freq: 987.8, to: 740, dur: 0.18, gain: 0.03 * v, send: 0.4});
        break;
      case 'illegal':
        this.tone({type: 'triangle', freq: 150, to: 120, dur: 0.16, gain: 0.08 * v, send: 0.2});
        break;
      case 'step':
        this.hiss({filter: 'lowpass', freq: 320, dur: 0.07, gain: 0.25 * v, send: 0.15});
        this.tone({freq: 72, to: 44, dur: 0.1, gain: 0.25 * v, send: 0.1});
        break;
      case 'slide': {
        const dur = Math.max(0.2, o.duration || 0.5);
        const {g} = this.hiss({freq: 420, q: 0.7, dur: 0.18, attack: 0.08, hold: Math.max(0, dur - 0.2), gain: 0.16 * v, send: 0.3});
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sawtooth';
        lfo.frequency.value = 9 + Math.random() * 6;
        const depth = this.ctx.createGain();
        depth.gain.value = 0.05 * v;
        lfo.connect(depth).connect(g.gain);
        lfo.start();
        lfo.stop(this.ctx.currentTime + dur + 0.3);
        this.tone({freq: 46, dur: dur, attack: 0.1, gain: 0.08 * v, send: 0.1});
        break;
      }
      case 'land':
        this.tone({freq: 95, to: 38, dur: 0.3, gain: 0.5 * v, send: 0.4});
        this.hiss({filter: 'lowpass', freq: 600, dur: 0.22, gain: 0.35 * v, send: 0.4});
        break;
      case 'whoosh': {
        const p = o.pitch || 1;
        this.hiss({freq: 280 * p, to: 2400 * p, q: 1.4, dur: 0.16, attack: 0.07, gain: 0.32 * v, send: 0.3});
        break;
      }
      case 'summon':
        [659.3, 987.8, 1318.5, 1760].forEach((f, i) => this.tone({freq: f, to: f * 1.5, dur: 0.5, attack: 0.04, gain: 0.05 * v, send: 0.7, delay: i * 0.05}));
        this.hiss({filter: 'highpass', freq: 5000, dur: 0.45, attack: 0.05, gain: 0.08 * v, send: 0.6});
        break;
      case 'impact': {
        const p = o.power || 1;
        this.tone({freq: 120, to: 30, dur: 0.55, gain: 0.85 * v * Math.min(1.3, p), send: 0.7});
        this.tone({freq: 52, dur: 0.7, attack: 0.01, gain: 0.35 * v, send: 0.5});
        this.hiss({filter: 'highpass', freq: 1700, dur: 0.07, gain: 0.7 * v, send: 0.6});
        this.hiss({freq: 850, q: 0.7, dur: 0.38, gain: 0.55 * v, send: 0.8});
        break;
      }
      case 'crumble':
        for (let i = 0; i < 22; i++) {
          const delay = Math.pow(Math.random(), 1.6) * 1.6;
          this.hiss({freq: 1400 + Math.random() * 4200, q: 3, dur: 0.015 + Math.random() * 0.03, gain: (0.04 + Math.random() * 0.18) * v, send: 0.5, delay});
        }
        this.hiss({filter: 'lowpass', freq: 220, dur: 1.2, attack: 0.02, gain: 0.3 * v, send: 0.4});
        break;
      case 'click': {
        const now = this.ctx.currentTime;
        if (now - this.lastClick < 0.03) return;
        this.lastClick = now;
        this.hiss({freq: 1800 + Math.random() * 3500, q: 4, dur: 0.02 + Math.random() * 0.02, gain: Math.min(0.22, 0.03 * (o.speed || 1)) * v, send: 0.45});
        break;
      }
      case 'check':
        for (const f of [98, 146.8]) this.tone({type: 'sawtooth', freq: f, dur: 0.9, attack: 0.15, gain: 0.07 * v, send: 0.7});
        this.bell(196, 0.5 * v, 2.5);
        break;
      case 'bell':
        this.bell(o.freq || 146.8, 0.9 * v, 6);
        break;
      case 'promote':
        [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.bell(f, 0.22 * v, 2.2, i * 0.12));
        this.hiss({filter: 'highpass', freq: 4500, dur: 1.2, attack: 0.3, gain: 0.07 * v, send: 0.8});
        break;
      case 'reform':
        this.hiss({freq: 800, to: 4000, q: 2, dur: 0.5, attack: 0.25, gain: 0.08 * v, send: 0.7});
        [1046.5, 784, 659.3].forEach((f, i) => this.tone({freq: f, dur: 0.4, gain: 0.03 * v, send: 0.7, delay: i * 0.07}));
        break;
      case 'neigh': {
        const ctx = this.ctx, t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(240, t);
        osc.frequency.linearRampToValueAtTime(330, t + 0.18);
        osc.frequency.exponentialRampToValueAtTime(150, t + 0.6);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900;
        f.Q.value = 3;
        const g = this.out(0, 0.6);
        this.env(g.gain, t, 0.08, 0.1 * v, 0.1, 0.45);
        const vib = ctx.createOscillator();
        vib.frequency.value = 11;
        const depth = ctx.createGain();
        depth.gain.value = 18;
        vib.connect(depth).connect(osc.frequency);
        osc.connect(f).connect(g);
        osc.start(t);
        vib.start(t);
        osc.stop(t + 0.7);
        vib.stop(t + 0.7);
        break;
      }
      case 'start':
        [146.83, 220, 293.66, 349.23].forEach((f, i) => this.tone({type: 'triangle', freq: f, dur: 2.6, attack: 0.9, gain: 0.05 * v, send: 0.9, delay: i * 0.08}));
        break;
      case 'victory':
        [261.6, 329.6, 392, 523.3].forEach((f, i) => this.tone({type: 'triangle', freq: f, dur: 3.2, attack: 0.6, gain: 0.06 * v, send: 0.9, delay: i * 0.15}));
        this.bell(261.6, 0.6 * v, 5, 0.3);
        break;
      case 'defeat':
        [110, 130.8, 164.8].forEach((f, i) => this.tone({type: 'triangle', freq: f, dur: 3.6, attack: 1, gain: 0.06 * v, send: 0.9, delay: i * 0.2}));
        this.bell(98, 0.7 * v, 6, 0.4);
        break;
      default:
        break;
    }
  }

  // Church bell from inharmonic partials (hum, prime, tierce, quint, nominal...).
  bell(freq, gain, length, delay = 0) {
    const partials = [[0.5, 0.5, 1], [1, 0.8, 0.85], [1.19, 0.55, 0.7], [1.5, 0.3, 0.6], [2, 0.45, 0.5], [2.52, 0.22, 0.38], [3.01, 0.16, 0.3], [4.17, 0.1, 0.22]];
    for (const [ratio, amp, life] of partials) {
      for (const detune of [-3, 3]) {
        this.tone({freq: freq * ratio, dur: length * life, attack: 0.004, gain: gain * amp * 0.12, send: 0.85, delay, detune});
      }
    }
  }

  // ---------- ambience ----------

  startAmbience() {
    const ctx = this.ctx;
    const pad = ctx.createBiquadFilter();
    pad.type = 'lowpass';
    pad.frequency.value = 820;
    pad.Q.value = 0.4;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.5;
    pad.connect(padGain).connect(this.music);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.8;
    padGain.connect(musicSend).connect(this.send);
    // Breathing swell.
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.07;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.18;
    swell.connect(swellDepth).connect(padGain.gain);
    swell.start();
    this.pedal = ctx.createOscillator();
    this.pedal.type = 'sine';
    const pedalGain = ctx.createGain();
    pedalGain.gain.value = 0.16;
    this.pedal.connect(pedalGain).connect(pad);
    this.pedal.start();
    this.voices = [];
    for (let i = 0; i < 3; i++) {
      const pair = [];
      for (const det of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.022;
        osc.connect(g).connect(pad);
        osc.start();
        pair.push(osc);
      }
      // Choir 'aah' formants an octave up.
      const choir = ctx.createOscillator();
      choir.type = 'sawtooth';
      const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
      f1.type = f2.type = 'bandpass';
      f1.frequency.value = 720; f1.Q.value = 7;
      f2.frequency.value = 1150; f2.Q.value = 8;
      const cg = ctx.createGain();
      cg.gain.value = 0.05;
      choir.connect(f1).connect(cg);
      choir.connect(f2).connect(cg);
      cg.connect(this.music);
      cg.connect(musicSend);
      const vib = ctx.createOscillator();
      vib.frequency.value = 4.8 + i * 0.37;
      const vd = ctx.createGain();
      vd.gain.value = 6;
      vib.connect(vd).connect(choir.detune);
      vib.start();
      choir.start();
      this.voices.push({pair, choir});
    }
    // Air: faint low rumble of the nave.
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airF = ctx.createBiquadFilter();
    airF.type = 'lowpass';
    airF.frequency.value = 180;
    const airG = ctx.createGain();
    airG.gain.value = 0.05;
    air.connect(airF).connect(airG).connect(this.music);
    air.start();
    this.chord = 0;
    this.setChord(0, 0.01);
    this.chordTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      this.chord = (this.chord + 1) % CHORDS.length;
      this.setChord(this.chord, 2.2);
    }, 11000);
  }

  setChord(index, glide) {
    const [root, notes] = CHORDS[index];
    const t = this.ctx.currentTime;
    this.pedal.frequency.setTargetAtTime(root, t, glide / 3);
    this.voices.forEach((v, i) => {
      for (const osc of v.pair) osc.frequency.setTargetAtTime(notes[i], t, glide / 3);
      v.choir.frequency.setTargetAtTime(notes[i] * 2, t, glide / 3);
    });
  }
}
