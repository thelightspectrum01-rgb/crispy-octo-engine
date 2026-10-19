import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;   // 0..1 remaining
attribute vec3 aColor;
varying float vLife;
varying vec3 vColor;
uniform float uScale;
void main() {
  vLife = aLife;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale * (1.0 / -mv.z) * step(0.001, aLife);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying float vLife;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  a *= a;
  gl_FragColor = vec4(vColor * (0.6 + 0.8 * vLife), a * vLife);
}
`;

/** A pooled additive point-sprite particle system (sparks, boost trail, confetti). */
export class Particles {
  constructor(max = 600, { gravity = -6, drag = 0.4, blending = AdditiveBlending } = {}) {
    this.max = max;
    this.gravity = gravity;
    this.drag = drag;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.cursor = 0;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.lifeAttr = new BufferAttribute(new Float32Array(max), 1);
    geo.setAttribute('aLife', this.lifeAttr);
    this.sizeAttr = new BufferAttribute(this.size, 1);
    geo.setAttribute('aSize', this.sizeAttr);
    this.colorAttr = new BufferAttribute(this.color, 3);
    geo.setAttribute('aColor', this.colorAttr);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: { uScale: { value: 500 } },
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this._c = new Color();
  }

  setViewportScale(heightPx) {
    this.material.uniforms.uScale.value = heightPx * 0.9;
  }

  emit(p, v, { life = 0.6, size = 0.2, color = 0xffaa44, spread = 0 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[3 * i] = p.x;
    this.pos[3 * i + 1] = p.y;
    this.pos[3 * i + 2] = p.z;
    this.vel[3 * i] = v.x + (Math.random() - 0.5) * spread;
    this.vel[3 * i + 1] = v.y + (Math.random() - 0.5) * spread;
    this.vel[3 * i + 2] = v.z + (Math.random() - 0.5) * spread;
    this.life[i] = 1;
    this.maxLife[i] = life * (0.7 + Math.random() * 0.6);
    this.size[i] = size * (0.7 + Math.random() * 0.6);
    this._c.set(color);
    this.color[3 * i] = this._c.r;
    this.color[3 * i + 1] = this._c.g;
    this.color[3 * i + 2] = this._c.b;
  }

  update(dt) {
    const lifeArr = this.lifeAttr.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        lifeArr[i] = 0;
        continue;
      }
      this.life[i] -= dt / this.maxLife[i];
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        lifeArr[i] = 0;
        continue;
      }
      const k = Math.exp(-this.drag * dt);
      this.vel[3 * i] *= k;
      this.vel[3 * i + 1] = this.vel[3 * i + 1] * k + this.gravity * dt;
      this.vel[3 * i + 2] *= k;
      this.pos[3 * i] += this.vel[3 * i] * dt;
      this.pos[3 * i + 1] += this.vel[3 * i + 1] * dt;
      this.pos[3 * i + 2] += this.vel[3 * i + 2] * dt;
      lifeArr[i] = this.life[i];
    }
    this.lifeAttr.needsUpdate = true;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  burst(origin, count, speed, opts = {}) {
    const v = new Vector3();
    for (let i = 0; i < count; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.emit(origin, v, opts);
    }
  }
}
