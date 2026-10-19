// DOM user interface: menu, HUD, pause and result screens. Pure presentation – the game drives it.

const $ = (id) => document.getElementById(id);

export function fmtTime(t) {
  if (t == null || !Number.isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export function fmtDelta(d) {
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
}

const MEDAL_COLORS = {
  gold: ['#fff0a0', '#e8a912', '#a8700a'],
  silver: ['#ffffff', '#b8c2d2', '#7b879b'],
  bronze: ['#ffd0a0', '#cd7f46', '#8a4b22'],
};

export function medalSVG(kind) {
  const c = MEDAL_COLORS[kind];
  if (!c) return '';
  return `<svg class="medal" viewBox="0 0 100 100" aria-label="${kind} medal">
    <defs><radialGradient id="mg-${kind}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${c[0]}"/><stop offset=".55" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></radialGradient></defs>
    <path d="M30 2 L50 36 L70 2 Z" fill="#ff5a36"/><path d="M38 2 L50 24 L62 2 Z" fill="#ffb23d"/>
    <circle cx="50" cy="62" r="33" fill="url(#mg-${kind})" stroke="rgba(0,0,0,.25)" stroke-width="2"/>
    <circle cx="50" cy="62" r="26" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/>
    <path d="M50 44 l5.4 11 12 1.7 -8.7 8.5 2 12 -10.7 -5.7 -10.7 5.7 2 -12 -8.7 -8.5 12 -1.7z" fill="rgba(255,255,255,.88)"/></svg>`;
}

export class UI {
  constructor(h) {
    this.h = h; // handlers
    this.el = {
      loading: $('loading'),
      fatal: $('fatal'),
      menu: $('menu'),
      hud: $('hud'),
      pause: $('pause'),
      results: $('results'),
      touch: $('touch'),
      toast: $('toast'),
      count: $('count'),
      lights: $('lights'),
      timer: $('timer'),
      lapNow: $('lap-now'),
      lapTotal: $('lap-total'),
      last: $('t-last'),
      bestLap: $('t-best'),
      delta: $('delta'),
      boostFill: $('boost-fill'),
      boostVal: $('boost-val'),
      boostMeter: $('boost-meter'),
      gripTick: $('grip-tick'),
      gripMeter: $('grip-meter'),
      leanL: $('lh-l'),
      leanR: $('lh-r'),
      brake: $('brake-hint'),
      hintbar: $('hintbar'),
      speedo: $('speedo'),
      minimap: $('minimap'),
      flash: $('flash'),
    };
    this.cache = {};
    this.speedoCtx = this.el.speedo.getContext('2d');
    this.miniCtx = this.el.minimap.getContext('2d');
    this.mini = null;
    this._bind();
  }

  _bind() {
    const h = this.h;
    const click = (id, fn) => {
      const el = $(id);
      el.addEventListener('click', (e) => {
        el.blur();
        fn(e);
      });
    };
    click('btn-start', () => h.start());
    click('btn-retry', () => h.retry());
    click('btn-menu', () => h.menu());
    click('btn-resume', () => h.resume());
    click('btn-restart', () => h.retry());
    click('btn-quit', () => h.menu());
    click('btn-reset', () => h.resetRecords());
    for (const b of document.querySelectorAll('[data-toggle]')) {
      b.addEventListener('click', () => {
        b.blur();
        h.toggle(b.dataset.toggle);
      });
    }
    for (const group of document.querySelectorAll('.chips[data-setting]')) {
      group.addEventListener('click', (e) => {
        const b = e.target.closest('.chip');
        if (!b) return;
        b.blur();
        h.setting(group.dataset.setting, b.dataset.value);
      });
    }
  }

  /* ----------------------------------------------------------- screens */

  hideLoading() {
    this.el.loading.classList.add('done');
    setTimeout(() => this.el.loading.classList.add('hidden'), 700);
  }

  fatal(msg) {
    $('fatal-msg').textContent = msg;
    this.el.fatal.classList.add('show');
    this.el.loading.classList.add('hidden');
  }

  showMenu(on) {
    this.el.menu.classList.toggle('hidden', !on);
  }

  showHUD(on) {
    this.el.hud.classList.toggle('hidden', !on);
    if (!on) {
      this.el.toast.classList.remove('show');
    }
  }

  showTouch(on) {
    this.el.touch.classList.toggle('hidden', !on);
    $('t-pause').classList.toggle('hidden', !on);
    this.el.hud.classList.toggle('touch', !!on);
  }

  showPause(on) {
    this.el.pause.classList.toggle('hidden', !on);
  }

  showResults(on) {
    this.el.results.classList.toggle('hidden', !on);
  }

  syncSettings(s) {
    for (const group of document.querySelectorAll('.chips[data-setting]')) {
      const v = String(s[group.dataset.setting]);
      for (const b of group.querySelectorAll('.chip')) b.classList.toggle('on', b.dataset.value === v);
    }
    for (const b of document.querySelectorAll('[data-toggle]')) b.classList.toggle('on', !!s[b.dataset.toggle]);
  }

  setRecord(best, medal) {
    $('rec-best').textContent = best ? fmtTime(best) : '--:--.---';
    const dot = document.querySelector('#rec-medal .medal-dot');
    const c = MEDAL_COLORS[medal];
    dot.style.background = c ? `linear-gradient(135deg, ${c[0]}, ${c[2]})` : '#556';
    $('rec-medal').lastChild.textContent = c ? medal[0].toUpperCase() + medal.slice(1) : 'None yet';
  }

  /* ----------------------------------------------------------- HUD */

  setLaps(total) {
    this.el.lapTotal.textContent = String(total);
  }

  setText(key, el, text) {
    if (this.cache[key] !== text) {
      this.cache[key] = text;
      el.textContent = text;
    }
  }

  toast(text, kind = 'info', sub = '') {
    const t = this.el.toast;
    t.className = kind;
    t.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
    void t.offsetWidth; // restart the animation
    t.classList.add('show');
  }

  countdown(step) {
    // step: 3,2,1 or 'GO' or null (hide)
    const c = this.el.count;
    const lights = this.el.lights;
    if (step === null) {
      lights.classList.add('hidden');
      c.classList.remove('pop');
      return;
    }
    lights.classList.remove('hidden');
    const dots = lights.querySelectorAll('i');
    lights.classList.toggle('go', step === 'GO');
    dots.forEach((d, i) => d.classList.toggle('on', step === 'GO' || (typeof step === 'number' && i >= 3 - step)));
    c.textContent = String(step);
    c.classList.toggle('go', step === 'GO');
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
  }

  hintBar(on) {
    this.el.hintbar.classList.toggle('show', on);
  }

  flash(color = '#fff', amount = 0.35) {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = String(amount);
    void f.offsetWidth;
    f.style.transition = 'opacity .5s ease-out';
    f.style.opacity = '0';
  }

  /** per-frame HUD refresh */
  hud(d) {
    const e = this.el;
    this.setText('time', e.timer, fmtTime(d.time));
    this.setText('lap', e.lapNow, String(d.lap));
    this.setText('last', e.last, fmtTime(d.last));
    this.setText('bestlap', e.bestLap, fmtTime(d.bestLap));
    // delta
    if (d.delta === null || d.delta === undefined) {
      this.setText('delta', e.delta, '');
      e.delta.className = 'num';
    } else {
      const txt = fmtDelta(d.delta);
      if (this.cache.delta !== txt + d.deltaLabel) {
        this.cache.delta = txt + d.deltaLabel;
        e.delta.innerHTML = `${txt}<small>${d.deltaLabel}</small>`;
      }
      const cls = 'num ' + (d.delta <= 0 ? 'ahead' : 'behind');
      if (e.delta.className !== cls) e.delta.className = cls;
    }
    // boost
    const b = Math.round(d.boost);
    e.boostFill.style.width = `${Math.max(0, Math.min(100, d.boost))}%`;
    this.setText('boost', e.boostVal, `${b}%`);
    e.boostMeter.classList.toggle('active', !!d.boosting);
    e.boostMeter.classList.toggle('full', d.boost >= 99.5);
    // grip
    const u = Math.max(-1.45, Math.min(1.45, d.util));
    e.gripTick.style.left = `${50 + (u / 1.45) * 48}%`;
    e.gripMeter.classList.toggle('edge', !!d.edge);
    e.leanL.style.opacity = d.leanHint < -0.25 ? String(Math.min(1, -d.leanHint)) : '0';
    e.leanR.style.opacity = d.leanHint > 0.25 ? String(Math.min(1, d.leanHint)) : '0';
    e.brake.classList.toggle('on', !!d.brakeHint);
    this.drawSpeedo(d.speed, d.limit, d.boosting);
    this.drawMinimap(d.map);
  }

  drawSpeedo(speed, limit, boosting) {
    const ctx = this.speedoCtx;
    const W = 460;
    const H = 284;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H - 34;
    const R = 188;
    const vmax = 17;
    const kmh = speed * 12;
    const t = Math.min(1, speed / vmax);
    // backdrop disc
    ctx.beginPath();
    ctx.arc(cx, cy, R + 26, Math.PI, 2 * Math.PI);
    ctx.lineTo(cx + R + 26, cy + 26);
    ctx.lineTo(cx - R - 26, cy + 26);
    ctx.closePath();
    ctx.fillStyle = 'rgba(9,12,20,0.62)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();
    // track arc
    ctx.lineCap = 'round';
    ctx.lineWidth = 22;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, 2 * Math.PI);
    ctx.stroke();
    const grad = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    grad.addColorStop(0, '#2fe0cb');
    grad.addColorStop(0.45, '#ffd23d');
    grad.addColorStop(0.75, '#ff8a3d');
    grad.addColorStop(1, '#ff3d5e');
    ctx.strokeStyle = boosting ? '#fff3b0' : grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, Math.PI + t * Math.PI);
    ctx.stroke();
    // ticks
    ctx.lineCap = 'butt';
    for (let k = 0; k <= 17; k += 1) {
      const a = Math.PI + (k / vmax) * Math.PI;
      const major = k % 4 === 0;
      const r0 = R - 22;
      const r1 = R - (major ? 38 : 30);
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.32)';
      ctx.lineWidth = major ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    // limit-ahead marker
    if (limit && limit < vmax) {
      const a = Math.PI + (limit / vmax) * Math.PI;
      const over = speed > limit + 0.4;
      ctx.fillStyle = over ? '#ff4d5e' : '#ffffff';
      ctx.beginPath();
      const rr = R + 18;
      ctx.moveTo(cx + Math.cos(a) * (rr - 2), cy + Math.sin(a) * (rr - 2));
      ctx.lineTo(cx + Math.cos(a - 0.055) * (rr + 18), cy + Math.sin(a - 0.055) * (rr + 18));
      ctx.lineTo(cx + Math.cos(a + 0.055) * (rr + 18), cy + Math.sin(a + 0.055) * (rr + 18));
      ctx.closePath();
      ctx.fill();
    }
    // numbers
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '900 92px ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif';
    ctx.fillText(String(Math.round(kmh)), cx, cy - 8);
    ctx.font = '800 22px ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('KM/H  ·  SCALE', cx, cy + 22);
  }

  /* ----------------------------------------------------------- minimap */

  buildMinimap(track) {
    const c = this.el.minimap;
    const W = c.width;
    const H = c.height;
    const b = track.bounds;
    const pad = 14;
    const sc = Math.min((W - 2 * pad) / (b.max.x - b.min.x), (H - 2 * pad) / (b.max.z - b.min.z));
    const ox = (W - sc * (b.max.x - b.min.x)) / 2 - b.min.x * sc;
    const oy = (H - sc * (b.max.z - b.min.z)) / 2 - b.min.z * sc;
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const g = off.getContext('2d');
    const p = track.piece;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i < p.n; i += 3) {
        const x = p.pos[3 * i] * sc + ox;
        const y = p.pos[3 * i + 2] * sc + oy;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    };
    path();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 11;
    g.stroke();
    path();
    g.strokeStyle = 'rgba(255,255,255,0.88)';
    g.lineWidth = 6;
    g.stroke();
    // start / finish tick
    p.locate(0);
    const sx = p.pos[0] * sc + ox;
    const sy = p.pos[2] * sc + oy;
    g.fillStyle = '#ff5a36';
    g.fillRect(sx - 2.5, sy - 11, 5, 22);
    this.mini = { off, sc, ox, oy, W, H, piece: p };
  }

  drawMinimap(m) {
    if (!this.mini || !m) return;
    const { off, sc, ox, oy, W, H, piece } = this.mini;
    const ctx = this.miniCtx;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(off, 0, 0);
    const dot = (s, color, r) => {
      if (s == null) return;
      piece.locate(s);
      const i = piece._i0;
      const x = piece.pos[3 * i] * sc + ox;
      const y = piece.pos[3 * i + 2] * sc + oy;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    };
    dot(m.ghost, '#59d2ff', 6);
    dot(m.rival, '#ff7a59', 6);
    dot(m.player, '#ffb23d', 8);
  }

  /* ----------------------------------------------------------- results */

  showResultsSheet({ title, total, laps, bestLapIndex, newRecord, medal, targets, penalties, rivalDelta }) {
    $('res-title').textContent = title;
    $('res-total').textContent = fmtTime(total);
    $('res-medal').innerHTML = medal && medal !== 'none' ? medalSVG(medal) : '';
    const badge = $('res-badge');
    badge.classList.toggle('hidden', !newRecord);
    let rows = '<tr><th>Lap</th><th>Time</th><th>vs best</th></tr>';
    const best = Math.min(...laps);
    laps.forEach((t, i) => {
      rows += `<tr class="${i === bestLapIndex ? 'best' : ''}"><td>${i + 1}</td><td>${fmtTime(t)}</td><td>${i === bestLapIndex ? 'best' : fmtDelta(t - best)}</td></tr>`;
    });
    if (penalties > 0) rows += `<tr><td>⚠</td><td>Derail penalties</td><td>+${penalties.toFixed(1)}</td></tr>`;
    $('res-laps').innerHTML = rows;
    const rv = $('res-rival');
    if (rivalDelta === null || rivalDelta === undefined) rv.textContent = '';
    else rv.innerHTML = rivalDelta <= 0 ? `You beat the <b style="color:#ff9b7a">rival</b> by <b>${Math.abs(rivalDelta).toFixed(2)} s</b>` : `The <b style="color:#ff9b7a">rival</b> won by <b>${rivalDelta.toFixed(2)} s</b>`;
    $('res-targets').innerHTML = targets
      ? `<span>🥇 <b>${fmtTime(targets.gold)}</b></span><span>🥈 <b>${fmtTime(targets.silver)}</b></span><span>🥉 <b>${fmtTime(targets.bronze)}</b></span>`
      : '';
    this.showResults(true);
  }
}
