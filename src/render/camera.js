import { MathUtils, PerspectiveCamera, Vector3, Matrix4, Quaternion } from 'three';

const WORLD_UP = new Vector3(0, 1, 0);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

/**
 * Camera rig with four modes:
 *  - chase:    behind / above the cart, lagging the track tangent a little for a sense of speed
 *  - onboard:  first-person ride camera (rolls with the track)
 *  - overview: tabletop camera that looks over the whole desk
 *  - title:    slow cinematic orbit used behind the menu
 */
export class CameraRig {
  constructor(aspect = 16 / 9) {
    this.camera = new PerspectiveCamera(55, aspect, 0.2, 420);
    this.mode = 'title';
    this.pos = new Vector3(0, 20, 50);
    this.look = new Vector3(0, 2, 0);
    this.up = new Vector3(0, 1, 0);
    this.fov = 40;
    this.tanS = new Vector3(1, 0, 0);
    this.upS = new Vector3(0, 1, 0);
    this.quatS = new Quaternion();
    this.shake = 0;
    this.time = 0;
    this.titleAngle = 0.4;
    this.transition = 0; // seconds of "soft" following after a mode switch
    this.focus = 10;
    this._tmp = new Vector3();
    this._tmp2 = new Vector3();
    this._camUp = new Vector3();
    this._tmp3 = new Vector3();
    this._m = new Matrix4();
    this._q = new Quaternion();
    this.snap = true;
    this.dofScale = 1;
  }

  chaseDistance(speed) {
    return 4.8 + speed * 0.13;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.transition = 1.1;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * target: { pos, tan, up, right } (Vector3s), speed (u/s), lean (-1..1), boosting (bool), center (Vector3)
   */
  update(dt, target, { speed = 0, lean = 0, boosting = false, slip = 0, center = new Vector3(0, 2, 0) } = {}) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 3);
    const cam = this.camera;
    let desiredPos = this._tmp2;
    let desiredLook = this._tmp;
    let desiredFov = 55;
    let k = 12;
    let upBlend = 0;
    let focus = 10;
    this.dofScale = 1;

    if (this.mode === 'title') {
      this.titleAngle += dt * 0.07;
      const a = this.titleAngle;
      desiredPos.set(Math.sin(a) * 60, 24 + Math.sin(a * 0.7) * 5, Math.cos(a) * 46 + 4);
      desiredLook.set(0, 3, 0);
      desiredFov = 42;
      k = 1.6;
      focus = desiredPos.distanceTo(desiredLook);
      this.dofScale = 1.4;
    } else if (this.mode === 'overview') {
      desiredPos.set(target.pos.x * 0.35, 34, 50);
      desiredLook.set(target.pos.x * 0.35, 1.5, 0).lerp(target.pos, 0.18);
      desiredFov = 36;
      k = 3.0;
      focus = desiredPos.distanceTo(target.pos);
      this.dofScale = 1.5;
    } else if (this.mode === 'onboard') {
      desiredPos.copy(target.pos).addScaledVector(target.up, 1.12).addScaledVector(target.tan, 0.05);
      desiredLook.copy(target.pos).addScaledVector(target.up, 0.9).addScaledVector(target.tan, 8);
      desiredFov = 74 + Math.min(14, speed * 0.7) + (boosting ? 5 : 0);
      k = 40;
      upBlend = 1;
      focus = 9;
      this.dofScale = 0.45;
    } else {
      // chase: ride the track path behind the cart (never cuts through other parts of the track)
      this.tanS.lerp(target.tan, damp(4.5, dt)).normalize();
      const dist = this.chaseDistance(speed);
      const height = 2.0 + speed * 0.03;
      const w = target.invW ?? 0; // 0..1 proximity to an inversion (loop)
      const ks = w * w * (3 - 2 * w);
      upBlend = 0.28 * (1 - ks);
      const camUp = this._camUp.copy(WORLD_UP).lerp(target.up, upBlend).normalize();
      if (target.behind) desiredPos.copy(target.behind.pos).addScaledVector(camUp, height);
      else desiredPos.copy(target.pos).addScaledVector(this.tanS, -dist).addScaledVector(camUp, height);
      desiredLook.copy(target.pos).addScaledVector(this.tanS, 2.6 + speed * 0.12).addScaledVector(camUp, 0.5);
      desiredFov = 56 + Math.min(16, speed * 0.85) + (boosting ? 6 : 0);
      k = 22;
      if (ks > 0.001 && target.loopCam) {
        // cinematic side view of the loop, panning with the cart
        desiredPos.lerp(target.loopCam.pos, ks);
        desiredLook.lerp(this._tmp3.copy(target.pos).addScaledVector(WORLD_UP, 0.1), ks);
        desiredFov += (52 - desiredFov) * ks;
        k = 22 - 15 * ks;
      }
      focus = desiredPos.distanceTo(target.pos) + 0.5;
    }

    // soft transitions between modes
    if (this.transition > 0) {
      this.transition -= dt;
      k = Math.min(k, 3.5);
    }
    if (this.snap) {
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
      this.fov = desiredFov;
      this.snap = false;
    } else {
      this.pos.lerp(desiredPos, damp(k, dt));
      this.look.lerp(desiredLook, damp(Math.min(k * 1.4, 60), dt));
      this.fov += (desiredFov - this.fov) * damp(4, dt);
    }
    this.focus += (focus - this.focus) * damp(6, dt);

    // up vector (rolls with the track for onboard, slightly with banking for chase)
    this._tmp.copy(WORLD_UP).lerp(target.up, upBlend);
    if (this.mode === 'onboard') {
      this.upS.lerp(target.up, damp(9, dt)).normalize();
    } else {
      this.upS.lerp(this._tmp.normalize(), damp(4, dt)).normalize();
    }
    cam.up.copy(this.upS);

    cam.position.copy(this.pos);
    if (this.shake > 0 || slip > 0.05) {
      const s = this.shake * 0.12 + slip * 0.05 + (boosting ? 0.012 : 0);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    } else if (boosting) {
      cam.position.x += (Math.random() - 0.5) * 0.012;
      cam.position.y += (Math.random() - 0.5) * 0.012;
    }
    cam.lookAt(this.look);
    if (this.mode === 'chase') {
      // gentle roll into corners
      cam.rotateZ(-lean * 0.035);
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  jolt(amount = 1) {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  forceSnap() {
    this.snap = true;
    this.tanS.set(1, 0, 0);
  }

  dispose() {}
}

export { MathUtils };
