// Choreography: walking, leaping, castling and the cinematic melee captures, promotions,
// take-backs and the checkmate finale. Written as async sequences over a shared clock.
import * as THREE from 'three';
import {squareToWorld} from './board.js';
import {PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING} from './chess.js';

export const ease = {
  linear: t => t,
  inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  outBack: t => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
};

const UP = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
const angleTo = (from, to) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const STONE_DUST = [new THREE.Color(0.78, 0.74, 0.66), new THREE.Color(0.32, 0.31, 0.3)];
const MAGIC = [new THREE.Color(0.55, 1.4, 2.2), new THREE.Color(2.4, 0.7, 0.2)];
const STYLE = {[PAWN]: 'thrust', [KNIGHT]: 'leap', [BISHOP]: 'smash', [ROOK]: 'crush', [QUEEN]: 'sweep', [KING]: 'chop'};
const REACH = {thrust: 0.92, leap: 0.6, smash: 0.8, crush: 0, sweep: 0.74, chop: 0.84};

// Weapon swing keyframes in the attacker's frame (x right, y up, z toward the victim).
// angle -> blade direction via each style's 'dir'; s = 0 wind-up, 'hit' = impact, 1 = follow-through.
const SWINGS = {
  thrust: {weapon: 'spear', hit: 0.5, plane: 'x', dir: a => new THREE.Vector3(0, Math.sin(a), Math.cos(a)),
    ready: {pos: [0.17, 0.4, 0.02], a: 0.3}, keys: reach => [[0, [0.17, 0.46, -0.3], 0.12], [0.5, [0.15, 0.4, reach - 0.78], -0.04], [1, [0.15, 0.4, reach - 0.68], -0.1]]},
  smash: {weapon: 'staff', hit: 0.55, plane: 'x', dir: a => new THREE.Vector3(0, Math.cos(a), Math.sin(a)),
    ready: {pos: [0.2, 0.55, 0.05], a: 0.12}, keys: () => [[0, [0.16, 0.66, -0.06], -0.95], [0.55, [0.14, 0.62, 0.16], 1.62], [1, [0.14, 0.58, 0.2], 2.25]]},
  sweep: {weapon: 'sword', hit: 0.45, plane: 'y', dir: a => new THREE.Vector3(Math.sin(a), -0.06, Math.cos(a)).normalize(),
    ready: {pos: [0.2, 0.62, 0.04], a: 1.6}, keys: () => [[0, null, 2.5], [0.45, null, 0], [1, null, -1.7]], orbit: 0.2, height: 0.72},
  chop: {weapon: 'greatsword', hit: 0.5, plane: 'x', dir: a => new THREE.Vector3(0, Math.cos(a), Math.sin(a)),
    ready: {pos: [0.2, 0.7, 0.05], a: 0.15}, keys: () => [[0, [0.1, 1.05, -0.06], -0.5], [0.5, [0.08, 0.92, 0.18], 1.74], [1, [0.08, 0.84, 0.22], 2.35]]},
};

// Registry of the pieces standing on the board, keyed by 0x88 square.
export class PieceSet {
  constructor(scene, factory) {
    this.scene = scene;
    this.factory = factory;
    this.map = new Map();
    this.prev = new WeakMap();
  }

  build(position) {
    this.clear();
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = position.board[sq];
      if (p) this.spawn(sq, p & 7, p >> 3);
    }
  }

  spawn(sq, type, color) {
    const view = this.factory.create(type, color);
    squareToWorld(sq, view.root.position);
    this.scene.add(view.root);
    this.map.set(sq, view);
    return view;
  }

  at(sq) { return this.map.get(sq); }
  take(sq) { const v = this.map.get(sq); this.map.delete(sq); return v; }
  put(sq, view) { this.map.set(sq, view); }
  all() { return [...this.map.values()]; }

  clear() {
    for (const v of this.map.values()) v.dispose();
    this.map.clear();
  }

  // Makes the 3D pieces match a position exactly; returns the views it had to create.
  reconcile(position) {
    for (const [sq, view] of [...this.map]) {
      const p = position.board[sq];
      if (!p || (p & 7) !== view.type || (p >> 3) !== view.color) {
        view.dispose();
        this.map.delete(sq);
        continue;
      }
      squareToWorld(sq, view.root.position);
      view.root.rotation.y = view.facing;
      view.pose.position.set(0, 0, 0);
      view.pose.rotation.set(0, 0, 0);
      view.pose.scale.set(1, 1, 1);
    }
    const created = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = position.board[sq];
      if (p && !this.map.has(sq)) created.push(this.spawn(sq, p & 7, p >> 3));
    }
    return created;
  }

  // Standing pieces as cylinders for the rubble physics, with their current velocity.
  obstacles(dt) {
    const out = [];
    for (const v of this.map.values()) {
      if (!v.root.visible) continue;
      const p = v.root.position;
      let last = this.prev.get(v);
      if (!last) { last = {x: p.x, z: p.z}; this.prev.set(v, last); }
      const vx = dt > 0 ? (p.x - last.x) / dt : 0, vz = dt > 0 ? (p.z - last.z) / dt : 0;
      last.x = p.x;
      last.z = p.z;
      out.push({x: p.x, z: p.z, r: v.radius * 0.82, h: v.height + p.y, vx, vz});
    }
    return out;
  }
}

export class Director {
  constructor({rig, fx, shatter, weapons, audio, cathedral, pieces, ui}) {
    Object.assign(this, {rig, fx, shatter, weapons, audio, cathedral, pieces, ui});
    this.tweens = [];
    this.timeScale = 1;
    this.speed = 1;
    this.slow = null;
    this.cinematicMode = 'all';
    this.busy = false;
    this.scratch = new THREE.Vector3();
  }

  // ---------- clock ----------

  tween(duration, fn, easing = ease.inOut) {
    return new Promise(resolve => {
      if (duration <= 0) { fn(1, 1); resolve(); return; }
      this.tweens.push({t: 0, duration, fn, easing, resolve});
    });
  }

  wait(seconds) { return this.tween(seconds, () => {}); }

  // Bullet time: hold 'scale' for 'hold' real seconds, then ease back over 'ramp'.
  slowMotion(scale, hold, ramp) { this.slow = {scale, hold, ramp, t: 0}; }

  update(realDt) {
    if (this.slow) {
      const s = this.slow;
      s.t += realDt;
      if (s.t < s.hold) this.timeScale = s.scale;
      else if (s.t < s.hold + s.ramp) this.timeScale = lerp(s.scale, 1, ease.inOut((s.t - s.hold) / s.ramp));
      else { this.timeScale = 1; this.slow = null; }
    }
    const dt = realDt * this.timeScale * this.speed;
    const list = this.tweens;
    this.tweens = [];
    for (const tw of list) {
      tw.t += dt;
      const raw = Math.min(1, tw.t / tw.duration);
      tw.fn(tw.easing(raw), raw);
      if (raw >= 1) tw.resolve();
      else this.tweens.push(tw);
    }
    return dt;
  }

  hurry() { if (this.busy) this.speed = 3; }

  // ---------- primitives ----------

  faceToward(view, target, duration = 0.35) {
    const p = view.root.position;
    const yaw = Math.atan2(target.x - p.x, target.z - p.z);
    const start = view.root.rotation.y, delta = angleTo(start, yaw);
    return this.tween(duration, t => { view.root.rotation.y = start + delta * t; });
  }

  restoreFacing(view, duration = 0.4) {
    const start = view.root.rotation.y, delta = angleTo(start, view.facing);
    return this.tween(duration, t => { view.root.rotation.y = start + delta * t; });
  }

  walk(view, to, duration, {bob = 1} = {}) {
    const from = view.root.position.clone();
    const dist = from.distanceTo(to);
    if (dist < 0.01) return Promise.resolve();
    const steps = Math.max(2, Math.round(dist / 0.32));
    let lastStep = 0;
    const dust = STONE_DUST[view.color];
    this.audio.play('slide', {duration: duration / Math.max(0.2, this.timeScale * this.speed), volume: 0.5 + 0.1 * view.type});
    return this.tween(duration, (t, raw) => {
      view.root.position.lerpVectors(from, to, t);
      const phase = raw * steps;
      view.pose.position.y = 0.022 * bob * Math.abs(Math.sin(phase * Math.PI));
      view.pose.rotation.z = 0.045 * bob * Math.sin(phase * Math.PI);
      const step = Math.floor(phase);
      if (step > lastStep) {
        lastStep = step;
        this.fx.footDust(view.root.position, dust, 0.6);
        this.audio.play('step', {volume: 0.25 + 0.05 * view.type});
      }
    }, ease.inOut).then(() => { view.pose.position.y = 0; view.pose.rotation.z = 0; });
  }

  leap(view, to, duration, height = 0.9) {
    const from = view.root.position.clone();
    this.audio.play('whoosh', {volume: 0.5, pitch: 0.7});
    return this.tween(duration, (t, raw) => {
      view.root.position.lerpVectors(from, to, t);
      view.root.position.y = Math.sin(Math.PI * raw) * height;
      view.pose.rotation.x = Math.sin(Math.PI * 2 * raw) * -0.25;
    }, ease.inOut).then(() => {
      view.root.position.y = 0;
      view.pose.rotation.x = 0;
      this.fx.dustBurst(to, STONE_DUST[view.color], 0.45, 0.25);
      this.fx.shockwave(to, new THREE.Color(0.3, 0.3, 0.32), 1.4, 0.5);
      this.audio.play('land', {volume: 0.7});
      this.rig.shake(0.15);
      return this.squash(view, 0.9);
    });
  }

  squash(view, amount = 0.88) {
    return this.tween(0.32, (t, raw) => {
      const k = raw < 0.3 ? lerp(1, amount, raw / 0.3) : lerp(amount, 1, ease.outBack((raw - 0.3) / 0.7));
      view.pose.scale.set(1 + (1 - k) * 0.5, k, 1 + (1 - k) * 0.5);
    }, ease.linear);
  }

  // ---------- moves ----------

  async animateMove(d, options = {}) {
    this.busy = true;
    this.speed = 1;
    try {
      const mover = this.pieces.take(d.from);
      if (!mover) return;
      const to = squareToWorld(d.to);
      if (d.capture) {
        const victim = this.pieces.take(d.captureSquare);
        const cine = this.cinematicMode === 'all' || (this.cinematicMode === 'major' && (d.captured & 7) !== PAWN) || options.forceCinematic;
        await this.capture(mover, victim, to, this.cinematicMode !== 'off' && cine);
      } else if (d.castle) {
        const rook = this.pieces.take(d.castle.rookFrom);
        const rookTo = squareToWorld(d.castle.rookTo);
        await Promise.all([
          this.faceToward(mover, to, 0.25).then(() => this.walk(mover, to, 0.75)).then(() => this.restoreFacing(mover)),
          this.wait(0.2).then(() => this.leap(rook, rookTo, 0.7, 1.1)),
        ]);
        this.pieces.put(d.castle.rookTo, rook);
      } else if (mover.type === KNIGHT) {
        await this.faceToward(mover, to, 0.2);
        await this.leap(mover, to, 0.62, 0.85);
        await this.restoreFacing(mover, 0.3);
      } else {
        const dist = mover.root.position.distanceTo(to);
        const turning = Math.abs(angleTo(mover.root.rotation.y, Math.atan2(to.x - mover.root.position.x, to.z - mover.root.position.z))) > 0.2;
        if (turning) await this.faceToward(mover, to, 0.22);
        await this.walk(mover, to, Math.min(1.1, 0.32 + dist * 0.16));
        if (turning) await this.restoreFacing(mover, 0.3);
      }
      this.pieces.put(d.to, mover);
      if (d.promo) await this.promote(d.to, d.promo, mover.color);
    } finally {
      this.speed = 1;
      this.busy = false;
    }
  }

  // ---------- captures ----------

  chooseShot(attacker, victim, style) {
    const A = attacker.root.position, V = victim.root.position;
    const tall = Math.max(attacker.height, victim.height);
    const frame = style === 'crush' ? {heights: [1.4, 2.0, 2.7], dists: [3.4, 4.2], lookY: 0.85, fov: 46}
      : tall > 1.15 ? {heights: [1.0, 1.5, 2.1, 2.7], dists: [2.9, 3.5], lookY: 0.6, fov: 42}
        : {heights: [0.85, 1.3, 1.9, 2.6], dists: [2.3, 3.0], lookY: 0.45, fov: 40};
    const dir = this.scratch.subVectors(V, A).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const mid = new THREE.Vector3().addVectors(A, V).multiplyScalar(0.5);
    const eye = this.rig.orbitEye();
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    const others = this.pieces.all().filter(p => p !== attacker && p !== victim);
    let best = null;
    for (const side of [1, -1]) {
      for (const h of frame.heights) {
        for (const dist of frame.dists) {
          const pos = mid.clone().addScaledVector(right, side * dist).addScaledVector(dir, -0.35);
          pos.y = h;
          let occluders = 0;
          for (const o of others) {
            const c = o.root.position.clone().setY(Math.min(o.height * 0.6, 0.6));
            for (const look of [mid, V]) {
              const seg = new THREE.Line3(pos, look.clone().setY(frame.lookY));
              const closest = seg.closestPointToPoint(c, true, new THREE.Vector3());
              if (closest.distanceTo(c) < 0.36) occluders++;
            }
          }
          const sameSide = Math.sign(right.dot(eye.clone().sub(mid))) === side ? 0 : 1.2;
          const score = occluders * 10 + h * 0.9 + dist * 0.4 + sameSide;
          if (!best || score < best.score) best = {score, pos, side, right: right.clone().multiplyScalar(side)};
        }
      }
    }
    return {...best, dir: dir.clone(), mid, lookY: frame.lookY, fov: frame.fov};
  }

  async capture(attacker, victim, to, cinematic) {
    const style = STYLE[attacker.type];
    const A = attacker.root.position.clone(), V = victim.root.position.clone();
    const dir = new THREE.Vector3().subVectors(V, A).setY(0).normalize();
    const reach = REACH[style];
    const strike = style === 'crush' ? A.clone().lerp(V, Math.max(0, 1 - 1.0 / Math.max(1, A.distanceTo(V)))) : V.clone().addScaledVector(dir, -reach);
    const pace = cinematic ? 1 : 1.45;
    let shot = null;
    if (cinematic) {
      shot = this.chooseShot(attacker, victim, style);
      const cine = this.rig.cine;
      const start = shot.pos.clone();
      cine.pos.copy(start);
      cine.look.copy(shot.mid).setY(shot.lookY);
      cine.fov = shot.fov;
      this.shot = {start, drift: shot.right.clone().multiplyScalar(-0.25).addScaledVector(shot.dir, 0.35), t: 0, attacker, victim: V.clone(), punch: 0,
        lookY: shot.lookY, fov: shot.fov};
      this.rig.engage(1.5);
      this.ui.letterbox(true);
    }
    attacker.setGlow(2.2);
    victim.setGlow(1.8);
    // Approach while the victim turns to face its attacker.
    const approach = A.distanceTo(strike);
    const moves = [this.faceToward(victim, A, 0.45)];
    if (style === 'leap') {
      moves.push(this.faceToward(attacker, V, 0.2).then(() => approach > 0.05 ? this.leap(attacker, strike, 0.55 / pace + approach * 0.05, 0.8) : null));
    } else if (style !== 'crush') {
      moves.push(this.faceToward(attacker, V, 0.25 / pace).then(() => approach > 0.05 ? this.walk(attacker, strike, Math.min(1.3, 0.3 + approach * 0.22) / pace) : null));
    } else {
      moves.push(this.faceToward(attacker, V, 0.25 / pace).then(() => approach > 0.05 ? this.walk(attacker, strike, Math.min(1.0, 0.25 + approach * 0.15) / pace) : null));
    }
    let weapon = null;
    const swing = SWINGS[style];
    if (swing) {
      weapon = this.weapons.create(swing.weapon, attacker.color);
      attacker.root.add(weapon.group);
      this.placeWeapon(weapon, swing, null, reach);
    }
    await Promise.all(moves);
    if (weapon) await this.summonWeapon(weapon, swing, reach, pace);
    victim.setGlow(2.5);
    this.tremble(victim, 0.5 / pace);

    if (style === 'leap') await this.knightStrike(attacker, victim, dir, pace);
    else if (style === 'crush') await this.rookCrush(attacker, victim, V, pace, cinematic);
    else await this.weaponStrike(attacker, victim, weapon, swing, style, dir, reach, pace, cinematic);

    if (weapon) this.dismissWeapon(weapon);
    attacker.setGlow(1);
    await this.wait(cinematic ? 0.55 : 0.25);
    // Step into the conquered square through the rubble.
    if (attacker.root.position.distanceTo(to) > 0.02) await this.walk(attacker, to, 0.55 / pace);
    await this.restoreFacing(attacker, 0.35 / pace);
    if (cinematic) {
      this.rig.release(1.1);
      this.ui.letterbox(false);
      this.shot = null;
    }
  }

  tremble(view, duration) {
    const base = view.pose.position.clone();
    return this.tween(duration, (t, raw) => {
      const k = Math.sin(raw * Math.PI) * 0.012;
      view.pose.position.set(base.x + (Math.random() - 0.5) * k, base.y, base.z + (Math.random() - 0.5) * k);
    }, ease.linear).then(() => view.pose.position.copy(base));
  }

  orientWeapon(weapon, pos, bladeDir, plane) {
    weapon.group.position.copy(pos);
    const y = bladeDir.clone().normalize();
    const n = plane === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const z = n.addScaledVector(y, -n.dot(y));
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
    z.normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    weapon.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  swingPose(swing, s, reach) {
    const keys = swing.keys(reach);
    let i = 0;
    while (i < keys.length - 2 && s > keys[i + 1][0]) i++;
    const [s0, p0, a0] = keys[i], [s1, p1, a1] = keys[i + 1];
    const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0)));
    const a = lerp(a0, a1, t);
    let pos;
    if (swing.orbit) pos = new THREE.Vector3(Math.sin(a) * swing.orbit, swing.height, Math.cos(a) * swing.orbit);
    else pos = new THREE.Vector3(lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t), lerp(p0[2], p1[2], t));
    return {pos, dir: swing.dir(a)};
  }

  placeWeapon(weapon, swing, s, reach) {
    if (s === null) {
      const r = swing.ready;
      const dir = swing.orbit ? new THREE.Vector3(Math.sin(r.a) * 0.3, 1, Math.cos(r.a) * 0.3) : swing.dir(r.a);
      this.orientWeapon(weapon, new THREE.Vector3(...r.pos), dir, swing.plane === 'y' ? 'x' : swing.plane);
      return;
    }
    const pose = this.swingPose(swing, s, reach);
    this.orientWeapon(weapon, pose.pos, pose.dir, swing.plane);
  }

  async summonWeapon(weapon, swing, reach, pace) {
    const color = MAGIC[weapon.color];
    const tip = new THREE.Vector3();
    this.audio.play('summon', {volume: 0.55});
    await this.tween(0.32 / pace, (t, raw) => {
      weapon.group.scale.setScalar(Math.max(0.001, ease.outBack(raw)));
      if (Math.random() < 0.8) this.fx.sparkle(weapon.tip(tip), color, 2);
    }, ease.linear);
    // Raise from the ready pose into the wind-up.
    const ready = {pos: weapon.group.position.clone(), quat: weapon.group.quaternion.clone()};
    const wind = this.swingPose(swing, 0, reach);
    const tmp = {group: new THREE.Object3D()};
    this.orientWeapon(tmp, wind.pos, wind.dir, swing.plane);
    await this.tween(0.38 / pace, t => {
      weapon.group.position.lerpVectors(ready.pos, wind.pos, t);
      weapon.group.quaternion.slerpQuaternions(ready.quat, tmp.group.quaternion, t);
    }, ease.inOut);
  }

  dismissWeapon(weapon) {
    const color = MAGIC[weapon.color];
    const tip = new THREE.Vector3();
    this.fx.trails[weapon.color].active = false;
    this.tween(0.45, (t, raw) => {
      weapon.group.scale.setScalar(Math.max(0.001, 1 - ease.in(raw)));
      if (Math.random() < 0.6) this.fx.sparkle(weapon.tip(tip), color, 1);
    }, ease.linear).then(() => weapon.dispose());
  }

  async weaponStrike(attacker, victim, weapon, swing, style, dir, reach, pace, cinematic) {
    const trail = this.fx.trails[attacker.color];
    const base = new THREE.Vector3(), tip = new THREE.Vector3();
    const lean = {thrust: [-0.1, 0.16], smash: [-0.14, 0.2], sweep: [0, 0.06], chop: [-0.16, 0.22]}[style];
    // Wind-up tension.
    await this.tween(0.32 / pace, t => {
      attacker.pose.rotation.x = lean[0] * t;
      if (style === 'sweep') attacker.pose.rotation.y = 0.45 * t;
    }, ease.out);
    trail.active = true;
    trail.samples.length = 0;
    this.audio.play('whoosh', {volume: 0.8, pitch: style === 'chop' ? 0.7 : style === 'thrust' ? 1.3 : 1});
    const strikeTime = (style === 'chop' ? 0.2 : 0.15) / pace;
    let hit = false;
    const doImpact = () => {
      if (hit) return;
      hit = true;
      weapon.tip(tip);
      const right = new THREE.Vector3(dir.z, 0, -dir.x);
      const impactDir = style === 'sweep' ? right.clone().multiplyScalar(-1).addScaledVector(dir, 0.6).normalize()
        : style === 'thrust' ? dir.clone() : dir.clone().multiplyScalar(0.7).add(new THREE.Vector3(0, -0.6, 0)).normalize();
      this.impact(victim, tip.clone(), impactDir, {
        thrust: {strength: 3.4, up: 0.9, radial: 0.9},
        smash: {strength: 3.0, up: 0.6, radial: 1.5},
        sweep: {strength: 3.6, up: 1.1, radial: 1.0},
        chop: {strength: 3.2, up: 0.5, radial: 2.0},
      }[style], cinematic, attacker.color);
    };
    // Strike to the hit pose.
    await this.tween(strikeTime, t => {
      this.placeWeapon(weapon, swing, swing.hit * t, reach);
      attacker.pose.rotation.x = lerp(lean[0], lean[1], t);
      if (style === 'sweep') attacker.pose.rotation.y = lerp(0.45, -0.1, t);
      trail.push(weapon.base(base), weapon.tip(tip));
    }, ease.in);
    doImpact();
    // Follow-through (plays in slow motion right after impact).
    await this.tween(0.3 / pace, t => {
      this.placeWeapon(weapon, swing, lerp(swing.hit, 1, t), reach);
      if (style === 'sweep') attacker.pose.rotation.y = lerp(-0.1, -0.4, t);
      trail.push(weapon.base(base), weapon.tip(tip));
    }, ease.out);
    trail.active = false;
    await this.tween(0.35 / pace, t => {
      attacker.pose.rotation.x = lerp(lean[1], 0, t);
      if (style === 'sweep') attacker.pose.rotation.y = lerp(-0.4, 0, t);
    }, ease.inOut);
  }

  async knightStrike(attacker, victim, dir, pace) {
    const pose = attacker.pose;
    this.audio.play('neigh', {volume: 0.5});
    await this.tween(0.36 / pace, t => {
      pose.rotation.x = -0.55 * t;
      pose.position.y = 0.2 * t;
      pose.position.z = -0.05 * t;
    }, ease.out);
    this.audio.play('whoosh', {volume: 0.7, pitch: 0.8});
    await this.tween(0.12 / pace, t => {
      pose.rotation.x = lerp(-0.55, 0.42, t);
      pose.position.y = lerp(0.2, 0.04, t);
      pose.position.z = lerp(-0.05, 0.3, t);
    }, ease.in);
    const head = attacker.root.localToWorld(new THREE.Vector3(0, 0.62, 0.42));
    this.impact(victim, head, dir.clone(), {strength: 3.8, up: 1.4, radial: 1.0}, Boolean(this.shot), attacker.color);
    await this.tween(0.45 / pace, t => {
      pose.rotation.x = lerp(0.42, 0, t);
      pose.position.y = lerp(0.04, 0, t);
      pose.position.z = lerp(0.3, 0, t);
    }, ease.inOut);
  }

  async rookCrush(attacker, victim, V, pace, cinematic) {
    await this.tween(0.16 / pace, t => attacker.pose.scale.set(1 + 0.08 * t, 1 - 0.12 * t, 1 + 0.08 * t), ease.out);
    const from = attacker.root.position.clone();
    this.audio.play('whoosh', {volume: 0.7, pitch: 0.6});
    const air = 0.5 / pace;
    let impacted = false;
    await this.tween(air, (t, raw) => {
      attacker.root.position.lerpVectors(from, V, t);
      attacker.root.position.y = Math.sin(Math.PI * raw) * 1.5 * (1 - raw * 0.2);
      attacker.pose.scale.set(lerp(1.08, 1, Math.min(1, raw * 3)), lerp(0.88, 1.05, Math.min(1, raw * 3)), lerp(1.08, 1, Math.min(1, raw * 3)));
      attacker.pose.rotation.x = Math.sin(Math.PI * raw) * 0.2;
      if (!impacted && raw > 0.82) {
        impacted = true;
        this.impact(victim, V.clone().setY(victim.height * 0.8), new THREE.Vector3(0, -1, 0), {strength: 1.2, up: 1.8, radial: 3.4}, cinematic, attacker.color, 1.4);
      }
    }, ease.inOut);
    attacker.root.position.y = 0;
    attacker.pose.rotation.x = 0;
    this.fx.shockwave(V, MAGIC[attacker.color], 3.2, 0.8);
    this.rig.shake(0.5);
    await this.squash(attacker, 0.8);
  }

  // The moment of contact: flash, slow motion, shake, sound and the shatter itself.
  impact(victim, point, dir, params, cinematic, attackerColor, power = 1) {
    const dust = STONE_DUST[victim.color];
    this.shatter.shatter(victim, {point, dir, ...params, spin: 11});
    victim.dispose();
    const ground = victim.root.position.clone().setY(0.05);
    this.fx.dustBurst(ground.clone().setY(0.1), dust, 1.2 * power, 0.35);
    this.fx.chipBurst(point, dir, dust, power);
    this.fx.sparkBurst(point, dir, MAGIC[attackerColor], power);
    this.fx.shockwave(ground, MAGIC[attackerColor], 2.4 * power, 0.7);
    this.fx.flashAt(point.clone().add(new THREE.Vector3(0, 0.3, 0)), MAGIC[attackerColor].clone().multiplyScalar(0.5), power);
    this.cathedral.pulse(power);
    this.audio.play('impact', {volume: 1, power});
    this.audio.play('crumble', {volume: 0.8 * power});
    this.rig.shake(cinematic ? 0.55 * power : 0.25 * power);
    if (cinematic) {
      this.slowMotion(0.18, 0.45, 0.6);
      if (this.shot) this.shot.punch = 1;
    }
    if (this.onImpact) this.onImpact();
  }

  // Cinematic camera path for the current duel, updated every frame.
  updateShot(dt) {
    const s = this.shot;
    if (!s) return;
    s.t += dt;
    const cine = this.rig.cine;
    const k = Math.min(1, s.t / 4);
    cine.pos.copy(s.start).addScaledVector(s.drift, ease.inOut(k));
    const a = s.attacker.root.position;
    const look = new THREE.Vector3().lerpVectors(a, s.victim, 0.55).setY(s.lookY + Math.max(0, a.y) * 0.35);
    cine.look.lerp(look, Math.min(1, dt * 4));
    s.punch = Math.max(0, s.punch - dt * 1.4);
    cine.fov = s.fov - 6 * Math.sin(Math.min(1, s.punch) * Math.PI / 2);
  }

  // ---------- promotion ----------

  async promote(sq, type, color) {
    const pawn = this.pieces.take(sq);
    const at = squareToWorld(sq);
    this.fx.lightPillar(at, true);
    this.audio.play('promote', {volume: 0.9});
    await this.tremble(pawn, 0.45);
    this.shatter.shatter(pawn, {crumble: true, strength: 0.8, point: at.clone().setY(0.4), dir: UP.clone()});
    pawn.dispose();
    this.fx.dustBurst(at, STONE_DUST[color], 0.6, 0.25);
    const view = this.pieces.spawn(sq, type, color);
    await this.rise(view, 0.9);
    this.fx.lightPillar(at, false);
  }

  async rise(view, duration = 0.8) {
    const color = MAGIC[view.color];
    view.root.position.y = -view.height - 0.05;
    view.setGlow(3);
    await this.tween(duration, t => {
      view.root.position.y = lerp(-view.height - 0.05, 0, t);
      if (Math.random() < 0.7) this.fx.magicSwirl(view.root.position.clone().setY(0), color, 0.12, view.height);
      view.root.rotation.y = view.facing + (1 - t) * Math.PI;
    }, ease.out);
    view.root.position.y = 0;
    view.root.rotation.y = view.facing;
    view.setGlow(1);
  }

  // ---------- take-back ----------

  // Reverses one move: slides pieces back and re-forms captured pieces from magic.
  async revertMove(d) {
    this.busy = true;
    this.speed = 1;
    try {
      const fromPos = squareToWorld(d.from);
      let mover = this.pieces.take(d.to);
      if (d.promo && mover) {
        this.fx.magicSwirl(mover.root.position, MAGIC[mover.color], 0.6);
        mover.dispose();
        mover = this.pieces.spawn(d.to, PAWN, d.color);
      }
      const jobs = [];
      if (mover) jobs.push(this.tween(0.45, t => mover.root.position.lerpVectors(squareToWorld(d.to), fromPos, t)));
      if (d.castle) {
        const rook = this.pieces.take(d.castle.rookTo);
        if (rook) {
          jobs.push(this.tween(0.45, t => rook.root.position.lerpVectors(squareToWorld(d.castle.rookTo), squareToWorld(d.castle.rookFrom), t)));
          this.pieces.put(d.castle.rookFrom, rook);
        }
      }
      this.audio.play('reform', {volume: 0.6});
      await Promise.all(jobs);
      if (mover) this.pieces.put(d.from, mover);
      if (d.capture) {
        const view = this.pieces.spawn(d.captureSquare, d.captured & 7, d.captured >> 3);
        await this.rise(view, 0.55);
      }
    } finally {
      this.busy = false;
    }
  }

  // ---------- endings ----------

  async mateFinale(kingSquare, winner) {
    const king = this.pieces.take(kingSquare);
    if (!king) return;
    this.busy = true;
    const at = king.root.position.clone();
    const cine = this.rig.cine;
    // Film the fallen king from the clearest of several angles around it.
    const others = this.pieces.all();
    let bestAngle = 0, bestScore = Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const eye = new THREE.Vector3(at.x + Math.sin(a) * 2.7, 1.7, at.z + Math.cos(a) * 2.7);
      const seg = new THREE.Line3(eye, at.clone().setY(0.7));
      let score = Math.max(0, Math.max(Math.abs(eye.x), Math.abs(eye.z)) - 4.4) * 3;
      for (const o of others) {
        const c = o.root.position.clone().setY(Math.min(0.7, o.height * 0.6));
        if (seg.closestPointToPoint(c, true, new THREE.Vector3()).distanceTo(c) < 0.42) score += 10;
      }
      if (score < bestScore) { bestScore = score; bestAngle = a; }
    }
    const away = new THREE.Vector3(Math.sin(bestAngle), 0, Math.cos(bestAngle));
    cine.pos.copy(at).addScaledVector(away, 2.7).setY(1.7);
    cine.look.copy(at).setY(0.7);
    cine.fov = 40;
    this.rig.engage(1.2);
    this.ui.letterbox(true);
    king.setGlow(4);
    this.audio.play('bell', {volume: 1});
    const orbitStart = Math.atan2(away.x, away.z);
    const orbit = this.tween(3.4, (t, raw) => {
      const a = orbitStart + raw * 0.5;
      cine.pos.set(at.x + Math.sin(a) * (2.7 - raw * 0.4), 1.7 - raw * 0.4, at.z + Math.cos(a) * (2.7 - raw * 0.4));
    }, ease.inOut);
    await this.tremble(king, 1.1);
    this.audio.play('crumble', {volume: 1});
    this.shatter.shatter(king, {point: at.clone().setY(1.0), dir: UP.clone(), strength: 1.6, up: 2.2, radial: 2.2, spin: 7});
    king.dispose();
    this.fx.dustBurst(at, STONE_DUST[king.color], 1.8, 0.4);
    this.fx.sparkBurst(at.clone().setY(1), UP, MAGIC[winner], 1.5);
    this.fx.shockwave(at, MAGIC[winner], 4.5, 1.1);
    this.cathedral.pulse(2);
    this.rig.shake(0.6);
    this.slowMotion(0.3, 0.6, 0.8);
    this.audio.play('impact', {volume: 1, power: 1.3});
    this.wait(0.9).then(() => this.audio.play('bell', {volume: 0.9}));
    await orbit;
    this.rig.release(0.8);
    this.ui.letterbox(false);
    this.busy = false;
  }

  dimAll() { for (const v of this.pieces.all()) v.setGlow(0.35); }
  wakeAll() { for (const v of this.pieces.all()) v.setGlow(1); }
}

