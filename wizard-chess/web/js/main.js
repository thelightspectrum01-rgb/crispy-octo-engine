// Game controller: boots the cathedral, routes input, runs turns against the AI,
// and keeps the HUD, saves and settings in step with the board.
import * as THREE from 'three';
import {Stage, QUALITY, detectQuality} from './stage.js';
import {createTextures} from './assets.js';
import {Board, worldToSquare} from './board.js';
import {Cathedral} from './cathedral.js';
import {PieceFactory} from './pieces.js';
import {WeaponKit} from './weapons.js';
import {Effects} from './fx.js';
import {Shatter} from './shatter.js';
import {CameraRig} from './camera.js';
import {Director, PieceSet} from './director.js';
import {SoundBoard} from './audio.js';
import {UI} from './ui.js';
import {Engine} from './engine.js';
import {Game, moveDetails, moveFrom, moveTo, movePromo, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN} from './chess.js';
import {haptic, setSessionActive} from './platform.js';

const KEYS = {settings: 'wizard-chess.settings', save: 'wizard-chess.save', newGame: 'wizard-chess.new-game'};
const store = {
  get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULTS = {cinematic: reducedMotion ? 'off' : 'all', quality: 'auto', sfx: 0.8, music: 0.5, hints: true, shake: !reducedMotion, muted: false};
const LEVEL_NAMES = {novice: 'Novice', apprentice: 'Apprentice', adept: 'Adept', archmage: 'Archmage'};
const THINK_TIME = {novice: 300, apprentice: 500, adept: 900, archmage: 2200, hint: 900};
const PROMO = {q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT};
const SIDE = ['White', 'Black'];
const DRAWS = {
  stalemate: ['Stalemate', 'The side to move has no legal move and is not in check.'],
  repetition: ['Threefold repetition', 'The same position appeared three times.'],
  fifty: ['Fifty-move rule', 'Fifty moves passed without a capture or a pawn move.'],
  insufficient: ['Insufficient material', 'Neither side has enough pieces left to deliver checkmate.'],
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

function rayCylinder(ray, cx, cz, r, h) {
  const ox = ray.origin.x - cx, oz = ray.origin.z - cz, dx = ray.direction.x, dz = ray.direction.z;
  let best = Infinity;
  const a = dx * dx + dz * dz, b = 2 * (ox * dx + oz * dz), c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (a > 1e-9 && disc >= 0) {
    for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) {
      const y = ray.origin.y + ray.direction.y * t;
      if (t > 0 && y >= 0 && y <= h) { best = Math.min(best, t); break; }
    }
  }
  if (Math.abs(ray.direction.y) > 1e-9) {
    const t = (h - ray.origin.y) / ray.direction.y;
    const x = ox + dx * t, z = oz + dz * t;
    if (t > 0 && x * x + z * z <= r * r) best = Math.min(best, t);
  }
  return best;
}

class App {
  constructor() {
    this.ui = new UI();
    this.settings = {...DEFAULTS, ...(store.get(KEYS.settings) || {})};
    this.audio = new SoundBoard();
    this.mode = 'loading';
    this.playerColor = WHITE;
    this.level = 'adept';
    this.selected = -1;
    this.targets = [];
    this.token = 0;
    this.thinking = false;
    this.hintsUsed = 0;
    this.time = 0;
    this.last = performance.now();
    this.paused = false;
    this.raycaster = new THREE.Raycaster();
    this.pointer = null;
    this.touches = new Map();
  }

  async boot() {
    const qualityName = this.settings.quality === 'auto' ? detectQuality() : this.settings.quality;
    const canvas = document.getElementById('scene');
    try {
      this.stage = new Stage(canvas, qualityName);
      if (!this.stage.renderer.capabilities.isWebGL2) throw new Error('WebGL 2 unavailable');
    } catch (error) {
      console.error(error);
      this.ui.fatal();
      return;
    }
    const {stage} = this;
    const quality = QUALITY[qualityName];
    this.quality = quality;
    await Promise.race([document.fonts.load('700 40px Cinzel').catch(() => {}), delay(2500)]);
    this.ui.loading('Carving the stone…');
    await nextFrame();
    const textures = createTextures(stage.renderer, quality);
    stage.buildEnvironment();
    this.ui.loading('Raising the nave…');
    await nextFrame();
    this.board = new Board({textures, fontFamily: 'Cinzel, serif'});
    this.cathedral = new Cathedral({textures, quality});
    stage.scene.add(this.board.group, this.cathedral.group);
    this.factory = new PieceFactory({textures, segments: quality.segments});
    this.weapons = new WeaponKit(this.factory);
    this.fx = new Effects(stage.scene);
    this.shatter = new Shatter(stage.scene, {
      quality: quality.fragments,
      onImpact: speed => this.audio.play('click', {speed}),
      onDissolve: (pos) => this.fx.dust.spawn({x: pos.x, y: pos.y + 0.05, z: pos.z, vy: 0.15, life: 1.2, size: 0.1, size1: 0.35, r: 0.6, g: 0.57, b: 0.52, a: 0.35, a1: 0, fadeIn: 0.1}),
    });
    this.rig = new CameraRig(stage.camera);
    this.pieces = new PieceSet(stage.scene, this.factory);
    this.director = new Director({rig: this.rig, fx: this.fx, shatter: this.shatter, weapons: this.weapons, audio: this.audio,
      cathedral: this.cathedral, pieces: this.pieces, ui: this.ui});
    this.director.onImpact = () => haptic(45);
    this.engine = new Engine();
    this.applySettings();
    this.restore();
    this.ui.loading('Lighting the candles…');
    await nextFrame();
    stage.renderer.compile(stage.scene, stage.camera);
    this.bindInput();
    this.bindUI();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.setPaused(document.hidden));
    window.addEventListener('wizard:pause', () => this.setPaused(true));
    window.addEventListener('wizard:foreground', () => this.setPaused(false));
    window.WizardAndroidBack = () => this.back();
    this.resize();
    this.rig.engage();
    this.rig.cineWeight = 1;
    this.updateTitleShot(0);
    requestAnimationFrame(t => this.loop(t));
    this.ui.doneLoading();
    this.showTitle();
  }

  // ---------- persistence ----------

  restore() {
    const saved = store.get(KEYS.save);
    this.game = null;
    if (saved && saved.moves) {
      try {
        this.game = Game.fromJSON(saved);
        this.playerColor = saved.playerColor === BLACK ? BLACK : WHITE;
        this.level = LEVEL_NAMES[saved.level] ? saved.level : 'adept';
        this.hintsUsed = saved.hintsUsed || 0;
        if (this.game.status().over) this.game = null;
      } catch (error) {
        console.warn('Discarding unreadable save', error);
        this.game = null;
      }
    }
    this.hasSave = Boolean(this.game);
    if (!this.game) this.game = new Game();
    this.pieces.build(this.game.position);
    const prefs = store.get(KEYS.newGame);
    if (prefs) this.ui.writeNewGame(prefs);
  }

  save() {
    if (this.mode !== 'play') return;
    store.set(KEYS.save, {...this.game.toJSON(), playerColor: this.playerColor, level: this.level, hintsUsed: this.hintsUsed});
  }

  // ---------- settings ----------

  applySettings() {
    const s = this.settings;
    this.ui.writeSettings(s);
    this.ui.setSound(s.muted);
    this.audio.setVolumes({sfx: s.sfx, music: s.music});
    this.audio.setMuted(s.muted);
    this.director.cinematicMode = s.cinematic;
    this.rig.shakeScale = s.shake ? 1 : 0;
    if (this.selected >= 0) this.select(this.selected, true);
  }

  // ---------- screens ----------

  showTitle() {
    this.mode = this.mode === 'play' ? 'paused' : this.mode === 'over' ? 'over-menu' : 'title';
    this.clearSelection();
    this.ui.showTitle({canContinue: this.hasSave || this.mode === 'paused', inGame: this.mode === 'paused'});
    this.titleTime = 0;
    this.rig.engage(0.6);
    setSessionActive(false);
  }

  resume() {
    this.ui.hideTitle();
    this.ui.closePanels();
    this.mode = 'play';
    this.ui.hud(true);
    this.rig.release(0.8);
    this.rig.frame(this.playerColor);
    this.updateHud();
    this.refreshMarkers();
    setSessionActive(true);
    this.audio.play('start', {volume: 0.6});
    if (this.game.side !== this.playerColor && !this.thinking) this.aiTurn();
  }

  // Lets a running animation finish (quickly) before the board is rebuilt under it.
  async settleDirector() {
    if (this.director.busy) {
      this.director.speed = 4;
      while (this.director.busy) await delay(50);
    }
    this.director.speed = 1;
  }

  async startNewGame() {
    const {side, level} = this.ui.readNewGame();
    store.set(KEYS.newGame, {side, level});
    this.ui.closePanels();
    this.token++;
    this.engine.cancel();
    await this.settleDirector();
    this.token++;
    this.engine.cancel();
    this.thinking = false;
    this.shatter.clear();
    this.playerColor = side === 'random' ? (Math.random() < 0.5 ? WHITE : BLACK) : side === 'black' ? BLACK : WHITE;
    this.level = level;
    this.hintsUsed = 0;
    this.game = new Game();
    this.hasSave = true;
    this.board.showLastMove(-1);
    this.board.showCheck(-1);
    this.board.showHint(-1);
    this.clearSelection();
    this.ui.hideTitle();
    this.ui.closePanels();
    this.ui.hud(true);
    this.mode = 'play';
    this.save();
    this.updateHud();
    this.rig.release(0.7);
    this.rig.frame(this.playerColor);
    setSessionActive(true);
    this.audio.play('start');
    this.pieces.build(this.game.position);
    const token = this.token;
    this.director.busy = true;
    const views = this.pieces.all();
    await Promise.all(views.map((v, i) => {
      const rank = Math.round(3.5 - v.root.position.z);
      const order = v.color === WHITE ? rank : 7 - rank;
      v.root.position.y = -2;
      return delay(order * 120 + (i % 8) * 25).then(() => this.director.rise(v, 0.7));
    }));
    this.director.busy = false;
    if (token !== this.token) return;
    this.ui.banner('You command ' + SIDE[this.playerColor], {sub: LEVEL_NAMES[this.level] + ' opponent', duration: 2.2});
    if (this.game.side !== this.playerColor) this.aiTurn();
  }

  async requestNewGame() {
    if ((this.mode === 'paused' || this.mode === 'play') && this.game.history.length > 0) {
      const ok = await this.ui.confirm('Abandon the current game?', 'Abandon', 'Keep playing');
      if (!ok) return;
    }
    this.ui.panel('newgame-panel');
  }

  // ---------- HUD ----------

  updateHud() {
    if (!this.game) return;
    const g = this.game, me = this.playerColor;
    const status = g.status();
    let text, sub = SIDE[me] + ' · ' + LEVEL_NAMES[this.level] + ' opponent';
    if (status.over) text = status.result === 'checkmate' ? (status.winner === me ? 'Victory' : 'Defeat') : 'Draw';
    else if (this.thinking) text = 'The opponent ponders…';
    else if (g.side === me) text = status.check ? 'Your king is in check' : 'Your move';
    else text = 'Opponent to move';
    this.ui.setTurn({text, sub, side: g.side, thinking: this.thinking, check: Boolean(status.check)});
    this.ui.setMoves(g.history);
    this.ui.setCaptures(g.history.filter(h => moveDetails(h.move).capture).map(h => moveDetails(h.move).captured), me);
    const idle = !this.director.busy && !this.thinking;
    const undoable = g.history.length > (me === BLACK ? 1 : 0);
    this.ui.setControls({undo: idle && undoable && (this.mode === 'play' || this.mode === 'over'), hint: idle && this.mode === 'play' && g.side === me && !status.over});
  }

  refreshMarkers() {
    const g = this.game;
    const last = g.history[g.history.length - 1];
    if (last) this.board.showLastMove(moveFrom(last.move), moveTo(last.move));
    else this.board.showLastMove(-1);
    this.board.showCheck(g.position.inCheck() ? g.position.kings[g.side] : -1);
  }

  // ---------- selection & moves ----------

  select(sq, quiet = false) {
    this.selected = sq;
    const moves = this.game.movesFrom(sq);
    const byTarget = new Map();
    for (const m of moves) {
      const d = moveDetails(m);
      if (!byTarget.has(d.to)) byTarget.set(d.to, {to: d.to, capture: d.capture, captureSquare: d.captureSquare, moves: []});
      byTarget.get(d.to).moves.push(m);
    }
    this.targets = [...byTarget.values()];
    this.board.showSelection(sq, this.settings.hints ? this.targets : []);
    const view = this.pieces.at(sq);
    if (this.levitating && this.levitating !== view) this.levitating.pose.position.y = 0;
    this.levitating = view;
    if (view) view.setGlow(2.2);
    if (!quiet) this.audio.play('select');
  }

  clearSelection() {
    if (this.selected >= 0) {
      const view = this.pieces.at(this.selected);
      if (view) view.setGlow(1);
    }
    if (this.levitating) this.levitating.pose.position.y = 0;
    this.levitating = null;
    this.selected = -1;
    this.targets = [];
    this.board.clearSelection();
  }

  async commit(target) {
    let move = target.moves[0];
    if (target.moves.length > 1) {
      const piece = await this.ui.askPromotion(this.playerColor);
      move = target.moves.find(m => movePromo(m) === PROMO[piece]) || move;
    }
    await this.performMove(move);
  }

  async performMove(move) {
    const token = this.token;
    const d = moveDetails(move);
    if (!this.game.play(move)) return;
    this.clearSelection();
    this.board.showHint(-1);
    this.board.showCheck(-1);
    this.board.showLastMove(-1);
    this.save();
    const status = this.game.status();
    this.director.busy = true;
    this.updateHud();
    await this.director.animateMove(d, {forceCinematic: status.result === 'checkmate'});
    if (token !== this.token) return;
    this.board.showLastMove(d.from, d.to);
    this.updateHud();
    if (status.over) { await this.finish(status); return; }
    if (status.check) {
      const king = this.game.position.kings[this.game.side];
      this.board.showCheck(king);
      const view = this.pieces.at(king);
      if (view) view.setGlow(3);
      this.audio.play('check');
      this.ui.banner('Check', {danger: this.game.side === this.playerColor});
      this.cathedral.pulse(0.6);
    }
    if (this.game.side !== this.playerColor && this.mode === 'play') this.aiTurn();
  }

  async aiTurn() {
    const token = this.token;
    this.thinking = true;
    this.updateHud();
    for (const v of this.pieces.all()) if (v.color !== this.playerColor) v.setGlow(1.5);
    const started = performance.now();
    let result = null;
    try {
      result = await this.engine.think({startFen: this.game.startFen, moves: this.game.uciMoves(), level: this.level}, THINK_TIME[this.level]);
    } catch (error) {
      console.error(error);
    }
    const elapsed = performance.now() - started;
    if (elapsed < 700) await delay(700 - elapsed);
    if (token !== this.token) return;
    while (this.mode === 'paused' && token === this.token) await delay(200);
    if (token !== this.token || this.mode !== 'play') return;
    this.thinking = false;
    for (const v of this.pieces.all()) if (v.color !== this.playerColor) v.setGlow(1);
    let move = result && result.uci ? this.game.position.moveFromUci(result.uci) : 0;
    if (!move) {
      const legal = this.game.legalMoves();
      if (!legal.length) return;
      move = legal[Math.floor(Math.random() * legal.length)];
    }
    await this.performMove(move);
  }

  async hint() {
    if (this.mode !== 'play' || this.thinking || this.director.busy || this.game.side !== this.playerColor) return;
    const token = this.token;
    this.ui.setControls({undo: false, hint: false});
    let result = null;
    try { result = await this.engine.think({startFen: this.game.startFen, moves: this.game.uciMoves(), level: 'hint'}, THINK_TIME.hint); } catch (error) { console.error(error); }
    if (token !== this.token) return;
    this.updateHud();
    const m = result && result.uci ? this.game.position.moveFromUci(result.uci) : 0;
    if (!m) return;
    this.hintsUsed++;
    this.save();
    this.board.showHint(moveFrom(m), moveTo(m));
    this.audio.play('reform', {volume: 0.7});
  }

  async undo() {
    if ((this.mode !== 'play' && this.mode !== 'over') || this.director.busy) return;
    const g = this.game;
    const minimum = this.playerColor === BLACK ? 1 : 0;
    if (g.history.length <= minimum) return;
    let plies = this.thinking || g.side !== this.playerColor ? 1 : 2;
    if (this.mode === 'over') plies = g.side === this.playerColor ? 2 : 1;
    this.token++;
    this.engine.cancel();
    this.thinking = false;
    this.clearSelection();
    this.board.showHint(-1);
    this.board.showCheck(-1);
    this.board.showLastMove(-1);
    if (this.mode === 'over') {
      this.ui.closePanels();
      this.director.wakeAll();
      this.mode = 'play';
      this.ui.hud(true);
      setSessionActive(true);
    }
    for (let i = 0; i < plies && g.history.length > minimum; i++) {
      const entry = g.undo();
      await this.director.revertMove(moveDetails(entry.move));
    }
    const created = this.pieces.reconcile(g.position);
    await Promise.all(created.map(v => this.director.rise(v, 0.6)));
    for (const v of this.pieces.all()) v.setGlow(1);
    this.hasSave = true;
    this.save();
    this.refreshMarkers();
    this.updateHud();
    if (g.side !== this.playerColor) this.aiTurn();
  }

  async finish(status) {
    this.mode = 'over';
    store.remove(KEYS.save);
    this.hasSave = false;
    setSessionActive(false);
    this.updateHud();
    const me = this.playerColor;
    const fullMoves = Math.ceil(this.game.history.length / 2);
    const lost = this.game.history.filter(h => moveDetails(h.move).capture && (moveDetails(h.move).captured >> 3) === me).length;
    const stats = `${LEVEL_NAMES[this.level]} opponent · ${fullMoves} moves · ${lost} of your pieces lost · ${this.hintsUsed} ${this.hintsUsed === 1 ? 'hint' : 'hints'} used`;
    let report;
    if (status.result === 'checkmate') {
      const won = status.winner === me;
      this.ui.banner('Checkmate', {sub: won ? 'The enemy king is broken' : 'Your king has fallen', danger: !won, duration: 2.8});
      await this.director.mateFinale(this.game.position.kings[this.game.side], status.winner);
      this.audio.play(won ? 'victory' : 'defeat');
      report = {eyebrow: 'Checkmate', title: won ? 'Victory' : 'Defeat',
        detail: won ? `Your ${SIDE[me].toLowerCase()} army broke the enemy king in ${fullMoves} moves.` : `The ${LEVEL_NAMES[this.level]} broke your king in ${fullMoves} moves.`, stats};
    } else {
      const [eyebrow, detail] = DRAWS[status.result];
      this.director.dimAll();
      this.audio.play('bell', {volume: 0.8});
      this.ui.banner('Draw', {sub: eyebrow, duration: 2.4});
      await delay(1600);
      report = {eyebrow, title: 'Draw', detail, stats};
    }
    if (this.mode === 'over') this.ui.gameOver(report);
    this.updateHud();
  }

  // ---------- input ----------

  pick(clientX, clientY) {
    const rect = this.stage.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const ray = this.raycaster.ray;
    let best = Infinity, square = -1;
    for (const [sq, view] of this.pieces.map) {
      const p = view.root.position;
      const t = rayCylinder(ray, p.x, p.z, view.radius * 0.9, view.height + p.y);
      if (t < best) { best = t; square = sq; }
    }
    if (Math.abs(ray.direction.y) > 1e-6) {
      const t = -ray.origin.y / ray.direction.y;
      if (t > 0 && t < best) {
        const p = ray.at(t, new THREE.Vector3());
        const sq = worldToSquare(p.x, p.z);
        if (sq >= 0) square = sq;
      }
    }
    return square;
  }

  tap(x, y) {
    this.audio.unlock();
    if (this.director.busy) { this.director.hurry(); return; }
    if (this.mode !== 'play' || this.thinking || this.game.side !== this.playerColor || this.ui.panelOpen) return;
    const sq = this.pick(x, y);
    const target = this.targets.find(t => t.to === sq);
    if (this.selected >= 0 && target) { this.commit(target); return; }
    const p = sq >= 0 ? this.game.position.board[sq] : 0;
    if (p && (p >> 3) === this.playerColor) {
      if (sq === this.selected) { this.audio.play('deselect'); this.clearSelection(); }
      else this.select(sq);
      return;
    }
    if (this.selected >= 0) this.audio.play(sq >= 0 ? 'illegal' : 'deselect');
    this.clearSelection();
  }

  hover(x, y) {
    if (this.mode !== 'play' || this.director.busy || this.thinking || this.game.side !== this.playerColor) {
      this.board.showHover(-1);
      this.stage.canvas.style.cursor = '';
      return;
    }
    const sq = this.pick(x, y);
    const p = sq >= 0 ? this.game.position.board[sq] : 0;
    const actionable = (p && (p >> 3) === this.playerColor) || this.targets.some(t => t.to === sq);
    this.board.showHover(actionable ? sq : -1);
    this.stage.canvas.style.cursor = actionable ? 'pointer' : '';
  }

  bindInput() {
    const canvas = this.stage.canvas;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      this.touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (this.touches.size === 1) this.pointer = {id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, dragged: false};
      else if (this.pointer) this.pointer.dragged = true;
      this.audio.unlock();
    });
    canvas.addEventListener('pointermove', e => {
      const prev = this.touches.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') this.hover(e.clientX, e.clientY);
        return;
      }
      if (this.touches.size >= 2) {
        const pts = [...this.touches.values()];
        const before = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        prev.x = e.clientX; prev.y = e.clientY;
        const after = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (before > 0 && after > 0 && this.mode !== 'title') this.rig.zoom(before / after);
        return;
      }
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      prev.x = e.clientX; prev.y = e.clientY;
      p.x = e.clientX; p.y = e.clientY;
      if (!p.dragged && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 8) p.dragged = true;
      if (p.dragged && !this.rig.engaged && this.mode !== 'title' && this.mode !== 'paused') this.rig.rotate(dx, dy);
    });
    const end = e => {
      const p = this.pointer;
      this.touches.delete(e.pointerId);
      if (p && p.id === e.pointerId) {
        if (!p.dragged && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
        this.pointer = null;
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.board.showHover(-1); });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.mode === 'play' || this.mode === 'over') this.rig.zoom(Math.exp(e.deltaY * 0.0012));
    }, {passive: false});
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.key(e));
  }

  key(e) {
    if (e.target && e.target.tagName === 'INPUT' && e.key !== 'Escape') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); this.back(); return; }
    if (this.director.busy && (k === ' ' || k === 'enter')) { e.preventDefault(); this.director.hurry(); return; }
    if (this.ui.panelOpen || this.ui.titleVisible) return;
    if (k === 'u') this.undo();
    else if (k === 'h') this.hint();
    else if (k === 'v') this.rig.frame(this.playerColor);
    else if (k === 'm') this.toggleSound();
    else if (k === 'l') this.ui.toggleLedger();
  }

  // Back button / Escape: close the top panel, open or leave the menu. Returns true when handled.
  back() {
    const open = this.ui.openPanel();
    if (open === 'promotion-panel') return true;
    if (open === 'confirm-panel') { document.getElementById('confirm-no').click(); return true; }
    if (open === 'gameover-panel') { this.ui.closePanels(); return true; }
    if (open) { this.ui.closePanels(); if (!this.ui.titleVisible && this.mode === 'play') this.updateHud(); return true; }
    if (this.mode === 'play' || this.mode === 'over') { this.showTitle(); return true; }
    if (this.mode === 'paused') { this.resume(); return true; }
    if (this.mode === 'over-menu') { this.leaveMenuAfterGame(); return true; }
    return false;
  }

  leaveMenuAfterGame() {
    this.ui.hideTitle();
    this.mode = 'over';
    this.ui.hud(true);
    this.rig.release(0.8);
    this.rig.frame(this.playerColor);
    this.updateHud();
  }

  toggleSound() {
    this.settings.muted = !this.settings.muted;
    store.set(KEYS.settings, this.settings);
    this.audio.unlock();
    this.audio.setMuted(this.settings.muted);
    this.ui.setSound(this.settings.muted);
  }

  bindUI() {
    const ui = this.ui;
    ui.on('gesture', () => this.audio.unlock())
      .on('uiClick', () => this.audio.play('ui'))
      .on('continue', () => {
        if (this.mode === 'paused') this.resume();
        else if (this.hasSave) { this.mode = 'play'; this.resume(); }
      })
      .on('newGame', () => this.requestNewGame())
      .on('start', () => this.startNewGame())
      .on('settings', () => ui.panel('settings-panel'))
      .on('howto', () => ui.panel('howto-panel'))
      .on('back', () => ui.closePanels())
      .on('settingsDone', () => ui.closePanels())
      .on('settingsChanged', s => {
        const qualityChanged = s.quality !== this.settings.quality;
        this.settings = {...this.settings, ...s};
        store.set(KEYS.settings, this.settings);
        this.applySettings();
        if (qualityChanged) ui.qualityNote(true);
      })
      .on('restart', () => { this.save(); location.reload(); })
      .on('undo', () => this.undo())
      .on('hint', () => this.hint())
      .on('view', () => this.rig.frame(this.playerColor))
      .on('sound', () => this.toggleSound())
      .on('menu', () => { ui.closePanels(); this.showTitle(); })
      .on('viewBoard', () => { ui.closePanels(); this.updateHud(); });
  }

  // ---------- frame loop ----------

  resize() {
    this.stage.resize();
    this.cathedral.setViewportHeight(this.stage.height * this.stage.pixelRatio);
    if (this.mode === 'play' || this.mode === 'over') this.rig.frame(this.playerColor);
    else this.rig.frame(this.playerColor, true);
  }

  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) this.audio.pause();
    else { this.audio.resume(); this.last = performance.now(); }
  }

  updateTitleShot(dt) {
    this.titleTime = (this.titleTime || 0) + dt;
    const t = this.titleTime + 4;
    const a = t * 0.05 + (this.playerColor === BLACK ? Math.PI : 0) + 0.5;
    const cine = this.rig.cine;
    cine.pos.set(Math.sin(a) * 8.4, 2.1 + Math.sin(t * 0.13) * 0.5, Math.cos(a) * 8.4);
    cine.look.set(Math.sin(a + Math.PI) * 2.5, 3.2 + Math.sin(t * 0.09) * 0.6, Math.cos(a + Math.PI) * 2.5);
    cine.fov = 50;
  }

  loop(now) {
    requestAnimationFrame(t => this.loop(t));
    const realDt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.paused || this.manualClock) return;
    this.frame(realDt);
  }

  // Deterministic stepping for automated visual checks: advances the world in fixed steps,
  // yielding between frames so the choreography's promise chains keep pace.
  async step(frames, dt = 1 / 30) {
    this.manualClock = true;
    for (let i = 0; i < frames; i++) {
      this.frame(dt, i === frames - 1);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  frame(realDt, render = true) {
    this.time += realDt;
    const dt = this.director.update(realDt);
    if (this.mode === 'title' || this.mode === 'paused' || this.mode === 'over-menu') {
      if (this.rig.cineGoal === 0) this.rig.engage(0.6);
      this.updateTitleShot(realDt);
    } else this.director.updateShot(realDt);
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 1.7);
    for (const view of this.pieces.map.values()) view.update(realDt, pulse);
    if (this.levitating && !this.director.busy) {
      const y = 0.06 + 0.015 * Math.sin(this.time * 3);
      this.levitating.pose.position.y += (y - this.levitating.pose.position.y) * Math.min(1, realDt * 8);
    }
    this.shatter.update(dt, this.pieces.obstacles(dt));
    this.fx.update(dt);
    this.cathedral.update(realDt);
    this.board.update(realDt);
    this.rig.update(realDt);
    if (!render) return;
    this.stage.render();
    if (!this.manualClock) this.stage.trackFrame(realDt);
    if (this.director.busy !== this.wasBusy) {
      this.wasBusy = this.director.busy;
      if (this.mode === 'play' || this.mode === 'over') this.updateHud();
    }
  }
}

const app = new App();
window.wizardChess = app;
app.boot().catch(error => {
  console.error(error);
  app.ui.fatal('Something went wrong while building the cathedral: ' + (error && error.message ? error.message : error));
});
