// Visual effects: instanced billboard particles, weapon slash trails, shockwave rings,
// the promotion light pillar and a pooled impact flash light.
import * as THREE from 'three';
import {glowTexture, dustTexture, chipTexture, shaftTexture} from './textures.js';
import {groundHeight} from './board.js';

const VERT = /* glsl */`
attribute vec3 offset;
attribute vec4 icolor;
attribute vec2 sizeRot;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv;
  vColor = icolor;
  vec4 mv = modelViewMatrix * vec4(offset, 1.0);
  float c = cos(sizeRot.y), s = sin(sizeRot.y);
  vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  mv.xy += corner * sizeRot.x;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.004) discard;
}`;

class ParticleSystem {
  constructor(max, texture, additive) {
    this.max = max;
    this.count = 0;
    this.p = [];
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.attributes.position);
    geometry.setAttribute('uv', quad.attributes.uv);
    this.offsets = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sizes = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('offset', this.offsets);
    geometry.setAttribute('icolor', this.colors);
    geometry.setAttribute('sizeRot', this.sizes);
    geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({vertexShader: VERT, fragmentShader: FRAG, uniforms: {uMap: {value: texture}},
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending});
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 8 : 7;
  }

  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: 0, max: o.life || 1, size: o.size || 0.1, size1: o.size1 ?? o.size ?? 0.1,
      r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1, a: o.a ?? 1, a1: o.a1 ?? 0,
      gravity: o.gravity || 0, drag: o.drag || 0, rot: o.rot ?? Math.random() * 6.28, spin: o.spin || 0,
      bounce: o.bounce || 0, fadeIn: o.fadeIn || 0, swirl: o.swirl || 0,
    });
  }

  update(dt) {
    const list = this.p;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      q.life += dt;
      if (q.life >= q.max) continue;
      const damp = Math.max(0, 1 - q.drag * dt);
      q.vx *= damp; q.vy *= damp; q.vz *= damp;
      q.vy += q.gravity * dt;
      if (q.swirl) { const a = q.swirl * dt; const x = q.vx; q.vx = x * Math.cos(a) - q.vz * Math.sin(a); q.vz = x * Math.sin(a) + q.vz * Math.cos(a); }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.bounce) {
        const g = groundHeight(q.x, q.z);
        if (q.y < g + 0.01) { q.y = g + 0.01; if (q.vy < 0) q.vy = -q.vy * q.bounce; q.vx *= 0.6; q.vz *= 0.6; q.spin *= 0.6; }
      }
      q.rot += q.spin * dt;
      list[n++] = q;
    }
    list.length = n;
    const off = this.offsets.array, col = this.colors.array, siz = this.sizes.array;
    for (let i = 0; i < n; i++) {
      const q = list[i];
      const t = q.life / q.max;
      let a = q.a + (q.a1 - q.a) * t;
      if (q.fadeIn) a *= Math.min(1, q.life / q.fadeIn);
      off[i * 3] = q.x; off[i * 3 + 1] = q.y; off[i * 3 + 2] = q.z;
      col[i * 4] = q.r; col[i * 4 + 1] = q.g; col[i * 4 + 2] = q.b; col[i * 4 + 3] = a;
      siz[i * 2] = q.size + (q.size1 - q.size) * t; siz[i * 2 + 1] = q.rot;
    }
    this.mesh.geometry.instanceCount = n;
    if (n) {
      this.offsets.needsUpdate = true;
      this.colors.needsUpdate = true;
      this.sizes.needsUpdate = true;
    }
  }
}

// Ribbon following a weapon edge: samples base and tip positions, fades with age.
class Trail {
  constructor(color) {
    this.samples = [];
    this.active = false;
    this.maxAge = 0.16;
    const max = 64;
    this.positions = new Float32Array(max * 2 * 3);
    this.alphas = new Float32Array(max * 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const index = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {uColor: {value: color.clone()}},
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, 1.0); }',
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.max = max;
  }

  push(base, tip) {
    if (!this.active) return;
    this.samples.push({base: base.clone(), tip: tip.clone(), age: 0});
    if (this.samples.length > this.max) this.samples.shift();
  }

  update(dt) {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[0].age > this.maxAge) this.samples.shift();
    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const a = Math.max(0, 1 - s.age / this.maxAge);
      this.positions.set([s.base.x, s.base.y, s.base.z], i * 6);
      this.positions.set([s.tip.x, s.tip.y, s.tip.z], i * 6 + 3);
      this.alphas[i * 2] = a * 0.15;
      this.alphas[i * 2 + 1] = a * a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const glow = glowTexture(64);
    this.dust = new ParticleSystem(700, dustTexture(), false);
    this.chips = new ParticleSystem(500, chipTexture(), false);
    this.sparks = new ParticleSystem(700, glow, true);
    this.magic = new ParticleSystem(600, glow, true);
    for (const s of [this.dust, this.chips, this.sparks, this.magic]) scene.add(s.mesh);
    this.trails = [new Trail(new THREE.Color(0.6, 0.95, 1.4)), new Trail(new THREE.Color(1.5, 0.55, 0.2))];
    for (const t of this.trails) scene.add(t.mesh);
    // Constant light count keeps shader programs stable; the flash idles at zero intensity.
    this.flash = new THREE.PointLight(0xffd0a0, 0, 5, 2);
    this.flash.position.set(0, 1, 0);
    scene.add(this.flash);
    this.flashLevel = 0;
    this.rings = [];
    const ringTex = this.makeRingTexture();
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: ringTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
      ring.visible = false;
      ring.renderOrder = 6;
      scene.add(ring);
      this.rings.push({mesh: ring, life: 1, max: 1, size: 1});
    }
    const pillarMat = new THREE.MeshBasicMaterial({map: shaftTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.3, 0.7), toneMapped: false});
    this.pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 6, 24, 1, true), pillarMat);
    this.pillar.visible = false;
    this.pillar.renderOrder = 9;
    scene.add(this.pillar);
    this.pillarLife = 0;
  }

  makeRingTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.88, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Billowing stone dust where a piece shattered or landed.
  dustBurst(pos, color, amount = 1, radius = 0.35) {
    const n = Math.round(26 * amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      const shade = 0.75 + Math.random() * 0.25;
      this.dust.spawn({x: pos.x + Math.cos(a) * r, y: pos.y + Math.random() * 0.5, z: pos.z + Math.sin(a) * r,
        vx: Math.cos(a) * (0.4 + Math.random()) * amount, vy: 0.2 + Math.random() * 0.6, vz: Math.sin(a) * (0.4 + Math.random()) * amount,
        drag: 1.6, life: 1.6 + Math.random() * 1.6, size: 0.25 + Math.random() * 0.25, size1: 0.9 + Math.random() * 0.8,
        r: color.r * shade, g: color.g * shade, b: color.b * shade, a: 0.5, a1: 0, spin: (Math.random() - 0.5) * 0.8, fadeIn: 0.08});
    }
  }

  footDust(pos, color, amount = 1) {
    for (let i = 0; i < 5 * amount; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.18 + Math.random() * 0.12;
      this.dust.spawn({x: pos.x + Math.cos(a) * r, y: 0.03, z: pos.z + Math.sin(a) * r, vx: Math.cos(a) * 0.45, vy: 0.06 + Math.random() * 0.06, vz: Math.sin(a) * 0.45,
        drag: 2.5, life: 0.8 + Math.random() * 0.6, size: 0.08 + Math.random() * 0.08, size1: 0.3 + Math.random() * 0.25, r: color.r, g: color.g, b: color.b,
        a: 0.12 + Math.random() * 0.08, a1: 0, fadeIn: 0.05});
    }
  }

  chipBurst(pos, dir, color, amount = 1) {
    for (let i = 0; i < 40 * amount; i++) {
      const s = 1.5 + Math.random() * 3;
      const shade = 0.6 + Math.random() * 0.5;
      this.chips.spawn({x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * s * 0.7 + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 3, vz: dir.z * s * 0.7 + (Math.random() - 0.5) * 3,
        gravity: -9, drag: 0.3, life: 1.6 + Math.random(), size: 0.02 + Math.random() * 0.035, size1: 0.02,
        r: color.r * shade, g: color.g * shade, b: color.b * shade, a: 1, a1: 0.8, spin: (Math.random() - 0.5) * 20, bounce: 0.3});
    }
  }

  sparkBurst(pos, dir, color, amount = 1) {
    for (let i = 0; i < 36 * amount; i++) {
      const s = 2 + Math.random() * 5;
      this.sparks.spawn({x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * s * 0.5 + (Math.random() - 0.5) * s, vy: (Math.random() - 0.2) * s, vz: dir.z * s * 0.5 + (Math.random() - 0.5) * s,
        gravity: -6, drag: 2.2, life: 0.3 + Math.random() * 0.45, size: 0.03 + Math.random() * 0.04, size1: 0.005,
        r: color.r, g: color.g, b: color.b, a: 1, a1: 0});
    }
  }

  magicSwirl(pos, color, amount = 1, height = 1.2) {
    for (let i = 0; i < 30 * amount; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.25;
      this.magic.spawn({x: pos.x + Math.cos(a) * r, y: pos.y + Math.random() * height * 0.3, z: pos.z + Math.sin(a) * r,
        vx: -Math.sin(a) * 0.8, vy: 0.4 + Math.random() * 0.9, vz: Math.cos(a) * 0.8, swirl: 3, drag: 0.6,
        life: 0.8 + Math.random() * 0.9, size: 0.06 + Math.random() * 0.05, size1: 0, r: color.r, g: color.g, b: color.b, a: 1, a1: 0, fadeIn: 0.1});
    }
  }

  sparkle(pos, color, count = 1) {
    for (let i = 0; i < count; i++) {
      this.magic.spawn({x: pos.x + (Math.random() - 0.5) * 0.06, y: pos.y + (Math.random() - 0.5) * 0.06, z: pos.z + (Math.random() - 0.5) * 0.06,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.3) * 0.3, vz: (Math.random() - 0.5) * 0.3, drag: 1,
        life: 0.3 + Math.random() * 0.3, size: 0.03 + Math.random() * 0.03, size1: 0, r: color.r, g: color.g, b: color.b, a: 1, a1: 0});
    }
  }

  shockwave(pos, color, size = 2.4, life = 0.7) {
    const ring = this.rings.find(r => !r.mesh.visible) || this.rings[0];
    ring.mesh.position.set(pos.x, Math.max(0.01, pos.y) + 0.01, pos.z);
    ring.mesh.material.color.copy(color);
    ring.mesh.visible = true;
    ring.life = 0;
    ring.max = life;
    ring.size = size;
  }

  flashAt(pos, color, strength = 1) {
    this.flash.position.copy(pos);
    this.flash.color.copy(color);
    this.flashLevel = Math.max(this.flashLevel, 9 * strength);
  }

  lightPillar(pos, on = true) {
    this.pillar.position.set(pos.x, 3, pos.z);
    this.pillar.visible = on;
    this.pillarLife = on ? 0 : -1;
  }

  update(dt) {
    for (const s of [this.dust, this.chips, this.sparks, this.magic]) s.update(dt);
    for (const t of this.trails) t.update(dt);
    this.flashLevel *= Math.exp(-dt * 9);
    this.flash.intensity = this.flashLevel < 0.05 ? 0 : this.flashLevel;
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life += dt;
      const t = r.life / r.max;
      if (t >= 1) { r.mesh.visible = false; continue; }
      const s = r.size * (0.2 + 0.8 * (1 - Math.pow(1 - t, 3)));
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 1 - t;
    }
    if (this.pillar.visible) {
      this.pillarLife += dt;
      const k = Math.min(1, this.pillarLife / 0.25);
      this.pillar.scale.set(0.6 + 0.4 * k, 1, 0.6 + 0.4 * k);
      this.pillar.material.opacity = k * (0.8 + 0.2 * Math.sin(this.pillarLife * 18));
      this.pillar.rotation.y += dt * 2;
    }
  }
}
