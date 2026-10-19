import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { glowTexture, numberTexture, blobShadowTexture } from '../render/textures.js';
import { TRACK } from '../config.js';

const rb = (w, h, d, r = 0.08, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);

function mesh(geo, mat, cast = true) {
  const m = new Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = cast;
  return m;
}

/**
 * The cart. Local space: +X right, +Y up (rail-top plane at y≈0.07), -Z forward.
 * `leanGroup` holds everything that rolls with the lean input; wheels stay on the rails.
 */
export function createCart({ ghost = false, color = 0xe5382c, accent = 0xffffff, number = '07', tint = 0x59d2ff } = {}) {
  const root = new Group();
  const lean = new Group();
  lean.position.y = 0.1;
  root.add(lean);
  const inner = new Group();
  inner.position.y = -0.1;
  lean.add(inner);

  const paint = ghost
    ? new MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.38, depthWrite: false })
    : new MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.1 });
  const trim = ghost ? paint : new MeshStandardMaterial({ color: accent, roughness: 0.4 });
  const dark = ghost ? paint : new MeshStandardMaterial({ color: 0x20242c, roughness: 0.6 });
  const metal = ghost ? paint : new MeshStandardMaterial({ color: 0xcfd5dc, roughness: 0.25, metalness: 0.95 });

  // hull: a flattened capsule gives a bullet-shaped toy coaster car
  const hull = mesh(new CapsuleGeometry(0.36, 0.62, 8, 18), paint);
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1.2, 1, 0.64);
  hull.position.set(0, 0.43, 0.02);
  const belt = mesh(new BoxGeometry(0.9, 0.05, 1.1), dark, false);
  belt.position.set(0, 0.25, 0.04);
  const stripeL = mesh(new BoxGeometry(0.02, 0.07, 0.9), trim, false);
  stripeL.position.set(-0.405, 0.44, 0.1);
  stripeL.rotation.z = 0.12;
  const stripeR = stripeL.clone();
  stripeR.position.x = 0.405;
  stripeR.rotation.z = -0.12;
  const fin = mesh(rb(0.5, 0.2, 0.08, 0.03, 2), trim);
  fin.position.set(0, 0.74, 0.55);
  fin.rotation.x = -0.35;
  inner.add(hull, belt, stripeL, stripeR, fin);

  // cockpit
  const tub = mesh(rb(0.58, 0.18, 0.62, 0.06, 2), dark);
  tub.position.set(0, 0.62, 0.1);
  const seatBack = mesh(rb(0.54, 0.38, 0.1, 0.05, 2), dark);
  seatBack.position.set(0, 0.8, 0.42);
  inner.add(tub, seatBack);

  // lap bar
  const bar = mesh(new TorusGeometry(0.2, 0.025, 8, 16, Math.PI), metal);
  bar.rotation.set(0, 0, 0);
  bar.position.set(0, 0.7, -0.2);
  bar.rotation.x = Math.PI / 2 - 0.2;
  inner.add(bar);

  // rider
  const rider = new Group();
  rider.position.set(0, 0.68, 0.14);
  if (!ghost) {
    const skin = new MeshStandardMaterial({ color: 0xf2c29b, roughness: 0.6 });
    const shirt = new MeshStandardMaterial({ color: 0x2aa8a0, roughness: 0.7 });
    const helm = new MeshPhysicalMaterial({ color: 0xffc81f, roughness: 0.25, clearcoat: 1 });
    const torso = mesh(new CapsuleGeometry(0.17, 0.26, 4, 10), shirt);
    torso.position.set(0, 0.27, 0);
    const head = mesh(new SphereGeometry(0.15, 16, 12), skin);
    head.position.set(0, 0.66, -0.02);
    const helmet = mesh(new SphereGeometry(0.19, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), helm);
    helmet.position.set(0, 0.68, -0.02);
    const visor = mesh(rb(0.3, 0.09, 0.1, 0.03, 2), new MeshStandardMaterial({ color: 0x10151c, roughness: 0.1, metalness: 0.4 }), false);
    visor.position.set(0, 0.67, -0.17);
    const legs = mesh(new CapsuleGeometry(0.075, 0.38, 4, 8), new MeshStandardMaterial({ color: 0x2a3f6e, roughness: 0.7 }));
    legs.rotation.x = Math.PI / 2;
    legs.position.set(-0.1, 0.06, -0.26);
    const legs2 = legs.clone();
    legs2.position.x = 0.1;
    rider.add(torso, head, helmet, visor, legs, legs2);
    rider.userData.arms = [];
    for (const sx of [-1, 1]) {
      const arm = new Group();
      arm.position.set(sx * 0.2, 0.42, -0.02);
      const a = mesh(new CapsuleGeometry(0.055, 0.28, 4, 8), shirt);
      a.position.set(0, -0.02, -0.14);
      a.rotation.x = Math.PI / 2 - 0.2;
      arm.add(a);
      rider.add(arm);
      rider.userData.arms.push(arm);
    }
  } else {
    const blob = mesh(new CapsuleGeometry(0.17, 0.3, 4, 8), paint, false);
    blob.position.set(0, 0.35, 0);
    rider.add(blob);
  }
  inner.add(rider);

  // lights
  const head = mesh(new SphereGeometry(0.075, 10, 8), ghost ? paint : new MeshBasicMaterial({ color: 0xfff6d6 }), false);
  head.position.set(0, 0.44, -0.98);
  inner.add(head);
  if (!ghost) {
    for (const sx of [-1, 1]) {
      const tl = mesh(new BoxGeometry(0.12, 0.05, 0.02), new MeshBasicMaterial({ color: 0xff2a2a }), false);
      tl.position.set(sx * 0.3, 0.5, 0.605);
      inner.add(tl);
    }
    // number plates
    const plateMat = new MeshBasicMaterial({ map: numberTexture(number, { color: '#1c1f26', bg: '#ffffff' }), side: DoubleSide });
    for (const sx of [-1, 1]) {
      const plate = new Mesh(new PlaneGeometry(0.3, 0.3), plateMat);
      plate.position.set(sx * 0.432, 0.47, 0.0);
      plate.rotation.y = sx * Math.PI / 2;
      inner.add(plate);
    }
  }

  // boost nozzle + flame
  const nozzle = mesh(new CylinderGeometry(0.1, 0.13, 0.18, 12), metal, false);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.45, 0.66);
  inner.add(nozzle);
  const flameMat = new MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false });
  const flame = new Mesh(new ConeGeometry(0.13, 1.0, 12, 1, true), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.45, 1.2);
  flame.visible = false;
  inner.add(flame);
  const flameCore = new Mesh(new ConeGeometry(0.07, 0.6, 10, 1, true), new MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
  flameCore.rotation.x = -Math.PI / 2;
  flameCore.position.set(0, 0.45, 1.0);
  flameCore.visible = false;
  inner.add(flameCore);
  const glow = new Sprite(new SpriteMaterial({ map: glowTexture({ color: '255,170,70' }), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow.scale.set(1.6, 1.6, 1);
  glow.position.set(0, 0.45, 0.9);
  inner.add(glow);
  let boostLight = null;
  if (!ghost) {
    boostLight = new PointLight(0xff9a3a, 0, 10, 2);
    boostLight.position.set(0, 0.5, 1.0);
    inner.add(boostLight);
  }

  // wheels (stay on the rails, they do not lean)
  const wheelGeo = new CylinderGeometry(0.17, 0.17, 0.13, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new CylinderGeometry(0.08, 0.08, 0.15, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const wheelMat = ghost ? paint : new MeshStandardMaterial({ color: 0x15181d, roughness: 0.8 });
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new Group();
      w.position.set(sx * (TRACK.GAUGE / 2), 0.24, sz * 0.43);
      w.add(mesh(wheelGeo, wheelMat, false), mesh(hubGeo, metal, false));
      root.add(w);
      wheels.push(w);
    }
  }
  // blob shadow (under the chassis) helps the cart read against the mat
  let blob = null;
  if (!ghost) {
    blob = new Mesh(new PlaneGeometry(1.8, 2.2), new MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, opacity: 0.0, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = -0.2;
    root.add(blob);
  }

  const api = {
    root,
    lean,
    rider,
    wheels,
    flame,
    boostLight,
    blob,
    spin: 0,
    setFirstPerson(on) {
      rider.visible = !on;
      fin.visible = !on;
    },
    /** state: { dist, lean, boosting, air, braking } */
    update(state, dt) {
      this.spin += (state.dist ?? 0) / 0.17;
      for (const w of wheels) {
        w.children[0].rotation.x = this.spin;
        w.children[1].rotation.x = this.spin;
      }
      lean.rotation.z = -(state.lean ?? 0) * 0.2;
      const b = state.boosting ? 1 : 0;
      const f = (flame.userData.k ?? 0) + (b - (flame.userData.k ?? 0)) * Math.min(1, dt * 14);
      flame.userData.k = f;
      flame.visible = f > 0.03;
      flameCore.visible = flame.visible;
      flame.material.opacity = 0.7 * f;
      flameCore.material.opacity = 0.95 * f;
      const flick = 0.85 + Math.random() * 0.3;
      flame.scale.set(1, flick * (0.6 + f * 0.6), 1);
      flameCore.scale.set(1, flick * (0.6 + f * 0.6), 1);
      glow.material.opacity = 0.85 * f;
      if (boostLight) boostLight.intensity = 5 * f;
      if (rider.userData.arms) {
        const up = Math.min(1, (state.air ?? 0) * 1.4);
        rider.userData.arms.forEach((a, i) => {
          a.rotation.x += (-up * 2.4 - a.rotation.x) * Math.min(1, dt * 10);
          a.rotation.z += ((i ? -1 : 1) * up * 0.5 - a.rotation.z) * Math.min(1, dt * 10);
        });
        rider.rotation.x += (-(state.air ?? 0) * 0.15 - rider.rotation.x) * Math.min(1, dt * 8);
      }
      if (blob) blob.material.opacity = 0.55 * (1 - Math.min(1, (state.air ?? 0)));
    },
  };
  return api;
}
