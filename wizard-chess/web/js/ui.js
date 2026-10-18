// DOM layer: HUD, menus, dialogs, banners and the cinematic letterbox.
import {WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN} from './chess.js';

const $ = id => document.getElementById(id);
const GLYPH = {[PAWN]: '♟', [KNIGHT]: '♞', [BISHOP]: '♝', [ROOK]: '♜', [QUEEN]: '♛', 6: '♚'};
const VALUE = {[PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9, 6: 0};
const PANELS = ['newgame-panel', 'settings-panel', 'howto-panel', 'promotion-panel', 'gameover-panel', 'confirm-panel'];

export class UI {
  constructor() {
    this.handlers = {};
    this.bannerTimer = 0;
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) $('skip-hint').textContent = 'Click to hasten';
    const click = (id, name) => $(id).addEventListener('click', () => this.emit(name));
    click('btn-continue', 'continue');
    click('btn-new', 'newGame');
    click('btn-settings', 'settings');
    click('btn-howto', 'howto');
    click('newgame-back', 'back');
    click('newgame-start', 'start');
    click('settings-done', 'settingsDone');
    click('howto-close', 'back');
    click('btn-undo', 'undo');
    click('btn-hint', 'hint');
    click('btn-view', 'view');
    click('btn-sound', 'sound');
    click('btn-menu', 'menu');
    click('btn-restart', 'restart');
    click('go-new', 'newGame');
    click('go-view', 'viewBoard');
    click('go-menu', 'menu');
    $('btn-moves').addEventListener('click', () => this.toggleLedger());
    for (const el of document.querySelectorAll('#settings-panel input')) el.addEventListener('input', () => this.emit('settingsChanged', this.readSettings()));
    // Any button press gives a soft click and unlocks audio inside the gesture.
    document.addEventListener('pointerdown', () => this.emit('gesture'), {capture: true});
    document.getElementById('ui').addEventListener('click', e => { if (e.target.closest('button')) this.emit('uiClick'); });
  }

  on(name, fn) { this.handlers[name] = fn; return this; }
  emit(name, arg) { if (this.handlers[name]) this.handlers[name](arg); }

  // ---------- screens ----------

  loading(text) { $('loading-text').textContent = text; }
  doneLoading() { $('loading').classList.add('done'); setTimeout(() => { $('loading').hidden = true; }, 900); }
  fatal(text) {
    $('loading').hidden = true;
    if (text) $('fatal-text').textContent = text;
    $('fatal').hidden = false;
  }

  showTitle({canContinue, inGame}) {
    this.closePanels();
    $('title-screen').hidden = false;
    $('btn-continue').hidden = !canContinue;
    $('btn-continue').textContent = inGame ? 'Resume game' : 'Continue game';
    this.hud(false);
  }

  hideTitle() { $('title-screen').hidden = true; }
  get titleVisible() { return !$('title-screen').hidden; }

  panel(id, show = true) {
    if (show) for (const p of PANELS) if (p !== id) $(p).hidden = true;
    $(id).hidden = !show;
    if (show) {
      const focus = $(id).querySelector('input:checked, .btn.primary, button');
      if (focus && window.matchMedia('(hover: hover)').matches) focus.focus({preventScroll: true});
    }
  }

  closePanels() { for (const p of PANELS) $(p).hidden = true; }
  get panelOpen() { return PANELS.some(p => !$(p).hidden); }
  openPanel() { return PANELS.find(p => !$(p).hidden) || null; }

  hud(show) {
    $('hud').hidden = !show;
    $('ledger').hidden = !show;
    if (!show) $('ledger').classList.remove('open');
  }

  toggleLedger(force) {
    const el = $('ledger');
    const open = force ?? !el.classList.contains('open');
    el.classList.toggle('open', open);
    $('btn-moves').classList.toggle('active', open);
  }

  // ---------- HUD ----------

  setTurn({text, sub, side, thinking = false, check = false}) {
    $('turn-text').textContent = text;
    $('turn-sub').textContent = sub;
    const gem = $('turn-gem');
    gem.classList.toggle('black', side === BLACK);
    gem.classList.toggle('thinking', thinking);
    gem.classList.toggle('check', check);
  }

  setControls({undo, hint}) {
    $('btn-undo').disabled = !undo;
    $('btn-hint').disabled = !hint;
  }

  setSound(muted) {
    $('btn-sound').classList.toggle('muted', muted);
    $('btn-sound').setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
  }

  setMoves(history) {
    const list = $('move-list');
    list.textContent = '';
    if (!history.length) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'empty';
      span.textContent = 'No moves yet';
      li.appendChild(span);
      list.appendChild(li);
      return;
    }
    for (let i = 0; i < history.length; i += 2) {
      const li = document.createElement('li');
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = (i / 2 + 1) + '.';
      li.appendChild(num);
      for (let k = i; k < i + 2; k++) {
        const s = document.createElement('span');
        s.className = 'san' + (k === history.length - 1 ? ' last' : '');
        s.textContent = history[k] ? history[k].san : '';
        li.appendChild(s);
      }
      list.appendChild(li);
    }
    list.scrollTop = list.scrollHeight;
  }

  // captured: piece codes taken during the game. The player's losses sit on top.
  setCaptures(captured, playerColor) {
    const lost = captured.filter(p => (p >> 3) === playerColor).sort((a, b) => VALUE[b & 7] - VALUE[a & 7]);
    const won = captured.filter(p => (p >> 3) !== playerColor).sort((a, b) => VALUE[b & 7] - VALUE[a & 7]);
    const score = list => list.reduce((s, p) => s + VALUE[p & 7], 0);
    const diff = score(won) - score(lost);
    const fill = (el, pieces, adv) => {
      el.textContent = '';
      for (const p of pieces) {
        const span = document.createElement('span');
        span.className = 'piece ' + ((p >> 3) === WHITE ? 'white' : 'black');
        span.textContent = GLYPH[p & 7] + '︎';
        el.appendChild(span);
      }
      if (adv > 0) {
        const a = document.createElement('span');
        a.className = 'adv';
        a.textContent = '+' + adv;
        el.appendChild(a);
      }
    };
    fill($('captures-top'), lost, -diff);
    fill($('captures-bottom'), won, diff);
  }

  banner(text, {sub = '', danger = false, duration = 1.8} = {}) {
    const el = $('banner');
    el.textContent = text;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      el.appendChild(s);
    }
    el.classList.toggle('danger', danger);
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.remove('show'), duration * 1000);
  }

  letterbox(on) {
    $('letterbox').classList.toggle('on', on);
    $('ui').classList.toggle('cinematic', on);
  }

  // ---------- dialogs ----------

  askPromotion(color) {
    return new Promise(resolve => {
      const panel = $('promotion-panel');
      panel.querySelector('.promotions').classList.toggle('black', color === BLACK);
      const buttons = [...panel.querySelectorAll('.promo')];
      const pick = e => {
        for (const b of buttons) b.removeEventListener('click', pick);
        this.panel('promotion-panel', false);
        resolve(e.currentTarget.dataset.piece);
      };
      for (const b of buttons) b.addEventListener('click', pick);
      this.panel('promotion-panel');
    });
  }

  confirm(text, yes = 'Abandon', no = 'Keep playing') {
    return new Promise(resolve => {
      $('confirm-text').textContent = text;
      $('confirm-yes').textContent = yes;
      $('confirm-no').textContent = no;
      const done = value => {
        $('confirm-yes').onclick = $('confirm-no').onclick = null;
        this.panel('confirm-panel', false);
        resolve(value);
      };
      $('confirm-yes').onclick = () => done(true);
      $('confirm-no').onclick = () => done(false);
      this.panel('confirm-panel');
    });
  }

  gameOver({eyebrow, title, detail, stats}) {
    $('go-eyebrow').textContent = eyebrow;
    $('go-title').textContent = title;
    $('go-detail').textContent = detail;
    $('go-stats').textContent = stats;
    this.panel('gameover-panel');
  }

  // ---------- forms ----------

  readNewGame() {
    return {side: document.querySelector('input[name=side]:checked').value, level: document.querySelector('input[name=level]:checked').value};
  }

  writeNewGame({side, level}) {
    const s = $('side-' + side), l = $('level-' + level);
    if (s) s.checked = true;
    if (l) l.checked = true;
  }

  readSettings() {
    return {
      cinematic: document.querySelector('input[name=cinematic]:checked').value,
      quality: document.querySelector('input[name=quality]:checked').value,
      sfx: Number($('vol-sfx').value) / 100,
      music: Number($('vol-music').value) / 100,
      hints: $('opt-hints').checked,
      shake: $('opt-shake').checked,
    };
  }

  writeSettings(s) {
    const c = $('cine-' + s.cinematic), q = $('quality-' + s.quality);
    if (c) c.checked = true;
    if (q) q.checked = true;
    $('vol-sfx').value = Math.round(s.sfx * 100);
    $('vol-music').value = Math.round(s.music * 100);
    $('opt-hints').checked = s.hints;
    $('opt-shake').checked = s.shake;
  }

  qualityNote(show) { $('quality-note').hidden = !show; }
}
