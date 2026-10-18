// Camera rig: an orbit view framing the board, blended with cinematic shots and shake.
import * as THREE from 'three';

const MAX_HORIZONTAL = 9.2; // stay inside the nave piers
const FRAME_POINTS = [];
for (const x of [-4.7, 4.7]) for (const z of [-4.7, 4.7]) for (const y of [0, 1.3]) FRAME_POINTS.push(new THREE.Vector3(x, y, z));

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 0, 0.25);
    this.azimuth = 0;
    this.elevation = 0.85;
    this.radius = 13;
    this.goal = {azimuth: 0, elevation: 0.85, radius: 13};
    this.side = 0;
    this.cine = {pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40};
    this.cineWeight = 0;
    this.cineGoal = 0;
    this.cineSpeed = 1.6;
    this.shakeAmount = 0;
    this.shakeScale = 1;
    this.time = 0;
    this.baseFov = 42;
    this.idleOrbit = 0;
    this.tmpPos = new THREE.Vector3();
    this.tmpLook = new THREE.Vector3();
  }

  // Default framing for the side the player commands; fits the whole board on screen.
  frame(side = this.side, immediate = false) {
    this.side = side;
    const aspect = this.camera.aspect;
    // Portrait screens get a wider lens so the board is not a speck far below.
    this.baseFov = aspect < 0.8 ? 50 : 42;
    const elevation = aspect >= 1.25 ? 0.86 : aspect <= 0.75 ? 1.22 : 1.22 - (aspect - 0.75) / 0.5 * 0.36;
    this.goal.azimuth = this.nearestAngle(side ? Math.PI : 0, this.azimuth);
    this.goal.elevation = elevation;
    this.goal.radius = this.fitRadius(this.goal.azimuth, elevation);
    this.constrain(this.goal);
    if (immediate) Object.assign(this, {azimuth: this.goal.azimuth, elevation: this.goal.elevation, radius: this.goal.radius});
  }

  nearestAngle(angle, reference) {
    let a = angle;
    while (a - reference > Math.PI) a -= Math.PI * 2;
    while (a - reference < -Math.PI) a += Math.PI * 2;
    return a;
  }

  fitRadius(azimuth, elevation) {
    const cam = this.camera.clone();
    cam.fov = this.baseFov;
    cam.updateProjectionMatrix();
    let lo = 4, hi = 40;
    for (let i = 0; i < 24; i++) {
      const r = (lo + hi) / 2;
      this.orbitPosition(azimuth, elevation, r, cam.position);
      cam.lookAt(this.target);
      cam.updateMatrixWorld(true);
      let fits = true;
      for (const p of FRAME_POINTS) {
        const ndc = p.clone().project(cam);
        if (Math.abs(ndc.x) > 0.94 || Math.abs(ndc.y) > 0.86 || ndc.z > 1) { fits = false; break; }
      }
      if (fits) hi = r; else lo = r;
    }
    return hi;
  }

  constrain(state) {
    state.elevation = Math.min(1.42, Math.max(0.2, state.elevation));
    state.radius = Math.min(32, Math.max(4.5, state.radius));
    // Keep the camera inside the nave: raise it if the horizontal distance would pass the piers.
    while (state.radius * Math.cos(state.elevation) > MAX_HORIZONTAL && state.elevation < 1.42) state.elevation += 0.01;
    if (state.radius * Math.cos(state.elevation) > MAX_HORIZONTAL) state.radius = MAX_HORIZONTAL / Math.cos(state.elevation);
  }

  orbitPosition(azimuth, elevation, radius, out) {
    return out.set(
      this.target.x + Math.sin(azimuth) * Math.cos(elevation) * radius,
      this.target.y + Math.sin(elevation) * radius,
      this.target.z + Math.cos(azimuth) * Math.cos(elevation) * radius);
  }

  rotate(dx, dy) {
    this.goal.azimuth -= dx * 0.006;
    this.goal.elevation += dy * 0.005;
    this.constrain(this.goal);
  }

  zoom(factor) {
    this.goal.radius *= factor;
    this.constrain(this.goal);
  }

  // Cinematic control: the director writes cine.pos/look/fov every frame while engaged.
  engage(speed = 1.6) { this.cineGoal = 1; this.cineSpeed = speed; }
  release(speed = 1.2) { this.cineGoal = 0; this.cineSpeed = speed; }
  get engaged() { return this.cineGoal > 0 || this.cineWeight > 0.001; }

  shake(amount) { this.shakeAmount = Math.min(1.2, this.shakeAmount + amount * this.shakeScale); }

  // Current orbit camera position (useful for choosing which side to film a duel from).
  orbitEye(out = new THREE.Vector3()) { return this.orbitPosition(this.azimuth, this.elevation, this.radius, out); }

  update(dt) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 7);
    if (this.idleOrbit) this.goal.azimuth += this.idleOrbit * dt;
    this.azimuth += (this.goal.azimuth - this.azimuth) * k;
    this.elevation += (this.goal.elevation - this.elevation) * k;
    this.radius += (this.goal.radius - this.radius) * k;
    const step = dt * this.cineSpeed;
    this.cineWeight = this.cineGoal > this.cineWeight ? Math.min(this.cineGoal, this.cineWeight + step) : Math.max(this.cineGoal, this.cineWeight - step);
    const w = this.cineWeight * this.cineWeight * (3 - 2 * this.cineWeight);
    const pos = this.orbitPosition(this.azimuth, this.elevation, this.radius, this.tmpPos);
    const look = this.tmpLook.copy(this.target);
    let fov = this.baseFov;
    if (w > 0) {
      pos.lerp(this.cine.pos, w);
      look.lerp(this.cine.look, w);
      fov += (this.cine.fov - fov) * w;
    }
    if (this.shakeAmount > 0.001) {
      const s = this.shakeAmount * this.shakeAmount * 0.12;
      const t = this.time * 38;
      pos.x += Math.sin(t * 1.3) * s; pos.y += Math.sin(t * 1.7 + 1) * s * 0.7; pos.z += Math.sin(t * 1.1 + 2) * s;
      look.x += Math.sin(t * 0.9 + 3) * s * 0.5; look.y += Math.sin(t * 1.5) * s * 0.5;
      this.shakeAmount *= Math.exp(-dt * 5);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
