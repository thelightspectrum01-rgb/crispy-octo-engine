// Procedural textures. Stone surfaces are baked on the GPU (tileable noise in a fragment shader),
// so even phones generate 512–1024px marble in milliseconds. Decals and lettering use 2D canvas.
import * as THREE from 'three';

const NOISE = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uSeed;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float hash1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Tileable gradient noise: lattice indices wrap at 'period'.
float gnoise(vec2 p, vec2 period, float seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 s = vec2(seed * 37.0, seed * 91.0);
  float a = dot(hash2(mod(i, period) + s) * 2.0 - 1.0, f);
  float b = dot(hash2(mod(i + vec2(1.0, 0.0), period) + s) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash2(mod(i + vec2(0.0, 1.0), period) + s) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash2(mod(i + vec2(1.0, 1.0), period) + s) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4;
}

float fbm(vec2 uv, float period, int octaves, float seed) {
  float sum = 0.0, amp = 0.5, p = period;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * gnoise(uv * p, vec2(p), seed + float(i) * 1.7);
    p *= 2.0;
    amp *= 0.5;
  }
  return sum;
}

// Tileable cellular noise: x = distance to nearest feature, y = second nearest, z = cell id.
vec3 worley(vec2 p, vec2 period, float seed) {
  vec2 i = floor(p), f = p - i;
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 cell = mod(i + o, period);
      vec2 r = o + hash2(cell + seed * 13.0) - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; id = hash1(cell + seed * 7.0); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
`;

const VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Polished marble: mottled ground, domain-warped ridged veins and fine speckle.
const MARBLE = /* glsl */`
uniform vec3 uBase1, uBase2, uVein, uSpeck;
uniform float uVeinScale, uVeinWidth, uVeinAmount, uWarp, uSpeckAmount, uCloud;
void main() {
  vec2 uv = vUv;
  float n = fbm(uv, 3.0, 6, uSeed);
  float w = fbm(uv + vec2(0.31, 0.17), 2.0, 5, uSeed + 4.0);
  vec3 col = mix(uBase1, uBase2, smoothstep(-0.45, 0.45, n));
  col *= 1.0 + uCloud * fbm(uv, 8.0, 4, uSeed + 9.0);
  float t = fbm(uv + vec2(w, n) * uWarp, uVeinScale, 6, uSeed + 2.0);
  float vein = pow(clamp(1.0 - abs(t) / uVeinWidth, 0.0, 1.0), 3.0);
  float t2 = fbm(uv * 1.0 + vec2(n, w) * uWarp * 0.7, uVeinScale * 2.0, 5, uSeed + 11.0);
  float vein2 = pow(clamp(1.0 - abs(t2) / (uVeinWidth * 0.45), 0.0, 1.0), 4.0) * 0.6;
  float veins = clamp(vein + vein2, 0.0, 1.0) * uVeinAmount;
  veins *= smoothstep(-0.2, 0.25, fbm(uv, 2.0, 3, uSeed + 21.0));
  col = mix(col, uVein, veins);
  float sp = hash1(floor(uv * 512.0) + uSeed);
  col = mix(col, uSpeck, step(1.0 - uSpeckAmount, sp) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Height-derived normal map for carved stone: chisel ripples, pits and grain.
const STONE_NORMAL = /* glsl */`
uniform float uStrength, uPits;
float height(vec2 uv) {
  float h = fbm(uv, 6.0, 6, uSeed) * 0.6;
  h += fbm(uv, 24.0, 3, uSeed + 5.0) * 0.25;
  vec3 c = worley(uv * 18.0, vec2(18.0), uSeed);
  h -= uPits * smoothstep(0.18, 0.02, c.x);
  return h;
}
void main() {
  float e = 1.0 / 1024.0;
  float hx = height(vUv + vec2(e, 0.0)) - height(vUv - vec2(e, 0.0));
  float hy = height(vUv + vec2(0.0, e)) - height(vUv - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx * uStrength, -hy * uStrength, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

// Worn flagstone floor. uMode: 0 albedo, 1 normal, 2 roughness (green channel).
const FLAGSTONES = /* glsl */`
uniform int uMode;
uniform vec3 uStoneA, uStoneB, uMortar;
vec4 stone(vec2 uv) {
  vec2 warped = uv + vec2(fbm(uv, 6.0, 3, uSeed), fbm(uv + 0.5, 6.0, 3, uSeed + 1.0)) * 0.012;
  float rows = 4.0;
  float row = floor(warped.y * rows);
  float offset = hash1(vec2(row, uSeed)) ;
  float cols = 3.0 + floor(hash1(vec2(row, uSeed + 3.0)) * 2.0);
  float x = warped.x * cols + offset * cols;
  float col = floor(x);
  vec2 local = vec2(fract(x), fract(warped.y * rows));
  float id = hash1(vec2(mod(col, cols), row) + uSeed * 3.1);
  vec2 edge = min(local, 1.0 - local) * vec2(1.0 / cols, 1.0 / rows);
  float d = min(edge.x, edge.y);
  float mortar = 1.0 - smoothstep(0.0025, 0.007, d);
  return vec4(id, d, mortar, 0.0);
}
float height(vec2 uv) {
  vec4 s = stone(uv);
  float h = 1.0 - s.z;
  h -= smoothstep(0.03, 0.0, s.y) * 0.25;
  h += fbm(uv, 12.0, 5, uSeed + s.x * 10.0) * 0.18;
  vec3 c = worley(uv * 10.0, vec2(10.0), uSeed + 4.0);
  h -= smoothstep(0.03, 0.0, c.y - c.x) * 0.12 * step(0.7, s.x);
  return h;
}
void main() {
  vec4 s = stone(vUv);
  if (uMode == 0) {
    vec3 col = mix(uStoneA, uStoneB, s.x);
    float n = fbm(vUv, 8.0, 6, uSeed + s.x * 31.0);
    col *= 0.86 + 0.28 * (n + 0.5);
    col *= 1.0 - 0.18 * smoothstep(0.035, 0.0, s.y);
    vec3 c = worley(vUv * 10.0, vec2(10.0), uSeed + 4.0);
    col *= 1.0 - 0.35 * smoothstep(0.03, 0.0, c.y - c.x) * step(0.7, s.x);
    col = mix(col, uMortar, s.z);
    gl_FragColor = vec4(col, 1.0);
  } else if (uMode == 1) {
    float e = 1.0 / 1024.0;
    float hx = height(vUv + vec2(e, 0.0)) - height(vUv - vec2(e, 0.0));
    float hy = height(vUv + vec2(0.0, e)) - height(vUv - vec2(0.0, e));
    gl_FragColor = vec4(normalize(vec3(-hx * 6.0, -hy * 6.0, 1.0)) * 0.5 + 0.5, 1.0);
  } else {
    float wear = fbm(vUv, 4.0, 4, uSeed + 8.0);
    float r = mix(0.42, 0.85, smoothstep(-0.3, 0.4, wear));
    r = mix(r, 0.95, s.z);
    gl_FragColor = vec4(1.0, r, 0.0, 1.0);
  }
}
`;

// Ashlar masonry for piers, walls and arches. uMode: 0 albedo, 1 normal.
const ASHLAR = /* glsl */`
uniform int uMode;
uniform vec3 uStoneA, uStoneB, uMortar;
vec3 block(vec2 uv) {
  float rows = 8.0;
  float row = floor(uv.y * rows);
  float x = uv.x * 4.0 + mod(row, 2.0) * 0.5;
  vec2 local = vec2(fract(x), fract(uv.y * rows));
  float id = hash1(vec2(mod(floor(x), 4.0), row) + uSeed);
  vec2 edge = min(local, 1.0 - local) * vec2(1.0 / 4.0, 1.0 / rows);
  return vec3(id, min(edge.x, edge.y), 0.0);
}
float height(vec2 uv) {
  vec3 b = block(uv);
  float h = smoothstep(0.0015, 0.006, b.y);
  h += fbm(uv, 16.0, 4, uSeed + b.x * 7.0) * 0.12;
  return h;
}
void main() {
  vec3 b = block(vUv);
  if (uMode == 0) {
    vec3 col = mix(uStoneA, uStoneB, b.x);
    col *= 0.85 + 0.3 * (fbm(vUv, 8.0, 6, uSeed + b.x * 13.0) + 0.5);
    col *= 0.9 + 0.1 * smoothstep(0.0, 0.02, b.y);
    col = mix(uMortar, col, smoothstep(0.0015, 0.004, b.y));
    gl_FragColor = vec4(col, 1.0);
  } else {
    float e = 1.0 / 1024.0;
    float hx = height(vUv + vec2(e, 0.0)) - height(vUv - vec2(e, 0.0));
    float hy = height(vUv + vec2(0.0, e)) - height(vUv - vec2(0.0, e));
    gl_FragColor = vec4(normalize(vec3(-hx * 5.0, -hy * 5.0, 1.0)) * 0.5 + 0.5, 1.0);
  }
}
`;

export class TextureBaker {
  constructor(renderer, size = 512) {
    this.renderer = renderer;
    this.size = size;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.targets = [];
  }

  bake(fragment, uniforms = {}, {srgb = false, size = this.size, repeat = 1, seed = Math.random() * 100} = {}) {
    const target = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    const shaderUniforms = {uSeed: {value: seed}};
    for (const [key, value] of Object.entries(uniforms)) shaderUniforms[key] = {value};
    const material = new THREE.ShaderMaterial({vertexShader: VERTEX, fragmentShader: NOISE + fragment, uniforms: shaderUniforms, depthTest: false, depthWrite: false});
    this.quad.material = material;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    material.dispose();
    target.texture.anisotropy = this.anisotropy;
    target.texture.repeat.set(repeat, repeat);
    this.targets.push(target);
    return target.texture;
  }

  marble(params, options) {
    const p = {uVeinScale: 1.5, uVeinWidth: 0.06, uVeinAmount: 0.8, uWarp: 0.9, uSpeckAmount: 0.01, uCloud: 0.12, ...params};
    for (const key of ['uBase1', 'uBase2', 'uVein', 'uSpeck']) p[key] = new THREE.Color(...p[key]);
    return this.bake(MARBLE, p, {srgb: true, ...options});
  }

  stoneNormal(strength = 2.2, pits = 0.25, options) {
    return this.bake(STONE_NORMAL, {uStrength: strength, uPits: pits}, options);
  }

  flagstones(mode, options) {
    return this.bake(FLAGSTONES, {uMode: mode, uStoneA: new THREE.Color(0.22, 0.2, 0.17), uStoneB: new THREE.Color(0.34, 0.31, 0.27),
      uMortar: new THREE.Color(0.06, 0.055, 0.05)}, {srgb: mode === 0, ...options});
  }

  ashlar(mode, options) {
    return this.bake(ASHLAR, {uMode: mode, uStoneA: new THREE.Color(0.3, 0.27, 0.23), uStoneB: new THREE.Color(0.42, 0.38, 0.32),
      uMortar: new THREE.Color(0.12, 0.11, 0.1)}, {srgb: mode === 0, ...options});
  }

  dispose() {
    for (const target of this.targets) target.dispose();
    this.quad.geometry.dispose();
  }
}

// ---------- Canvas textures ----------

export function canvasTexture(width, height, draw, {srgb = true, mipmaps = true} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.generateMipmaps = mipmaps;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return texture;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

export function glowTexture(size = 128) {
  return canvasTexture(size, size, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

export function flameTexture() {
  return canvasTexture(64, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.68, 2, w / 2, h * 0.6, h * 0.5);
    g.addColorStop(0, 'rgba(255,250,235,1)');
    g.addColorStop(0.25, 'rgba(255,214,120,0.95)');
    g.addColorStop(0.55, 'rgba(255,128,32,0.55)');
    g.addColorStop(1, 'rgba(200,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w / 2, 2);
    ctx.bezierCurveTo(w * 0.9, h * 0.45, w * 0.95, h * 0.8, w / 2, h - 4);
    ctx.bezierCurveTo(w * 0.05, h * 0.8, w * 0.1, h * 0.45, w / 2, 2);
    ctx.fill();
  });
}

export function dustTexture() {
  return canvasTexture(128, 128, (ctx, w) => {
    const rand = seeded(91);
    for (let i = 0; i < 26; i++) {
      const x = w / 2 + (rand() - 0.5) * w * 0.45, y = w / 2 + (rand() - 0.5) * w * 0.45;
      const r = w * (0.12 + rand() * 0.2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.16 + rand() * 0.12})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    }
  });
}

export function chipTexture() {
  return canvasTexture(32, 32, (ctx, w) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(w * 0.2, w * 0.15); ctx.lineTo(w * 0.85, w * 0.3); ctx.lineTo(w * 0.7, w * 0.88); ctx.lineTo(w * 0.12, w * 0.7);
    ctx.closePath();
    ctx.fill();
  }, {mipmaps: false});
}

// Vertical light shaft: soft edges across, fading toward both ends.
export function shaftTexture() {
  return canvasTexture(128, 256, (ctx, w, h) => {
    const data = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      const along = Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.15)), 0.8) * (1 - v * 0.55);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const across = Math.pow(Math.sin(Math.PI * u), 2.2);
        const streak = 0.75 + 0.25 * Math.sin(u * 37.0 + Math.sin(u * 13.0) * 2.0);
        const a = Math.max(0, along * across * streak);
        const i = (y * w + x) * 4;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = 255;
        data.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(data, 0, 0);
  });
}

function drawRuneGlyph(ctx, cx, cy, size, rand) {
  // Line-drawn runic glyph; does not depend on font coverage.
  ctx.beginPath();
  const top = cy - size / 2, bottom = cy + size / 2;
  ctx.moveTo(cx, top); ctx.lineTo(cx, bottom);
  const strokes = 1 + Math.floor(rand() * 3);
  for (let s = 0; s < strokes; s++) {
    const y = top + rand() * size * 0.7;
    const dir = rand() < 0.5 ? -1 : 1;
    ctx.moveTo(cx, y);
    ctx.lineTo(cx + dir * size * 0.38, y + size * (0.15 + rand() * 0.25));
  }
  ctx.stroke();
}

// Magic circle used under the selected piece, for check and for hints (tinted by material colour).
export function runeCircleTexture(size = 512) {
  return canvasTexture(size, size, (ctx, w) => {
    const c = w / 2;
    const rand = seeded(7);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = w * 0.012;
    const ring = (r, width) => { ctx.lineWidth = width; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); };
    ring(w * 0.47, w * 0.012);
    ring(w * 0.44, w * 0.005);
    ring(w * 0.33, w * 0.006);
    ring(w * 0.3, w * 0.01);
    ctx.lineWidth = w * 0.006;
    const count = 20;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      ctx.save();
      ctx.translate(c + Math.cos(a) * w * 0.385, c + Math.sin(a) * w * 0.385);
      ctx.rotate(a + Math.PI / 2);
      drawRuneGlyph(ctx, 0, 0, w * 0.06, rand);
      ctx.restore();
    }
    // Eight-pointed star.
    ctx.lineWidth = w * 0.007;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) {
        const a = k * Math.PI / 4 + i * Math.PI / 2;
        const x = c + Math.cos(a) * w * 0.3, y = c + Math.sin(a) * w * 0.3;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ring(w * 0.12, w * 0.006);
  });
}

export function moveDotTexture(size = 256) {
  return canvasTexture(size, size, (ctx, w) => {
    const c = w / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, w * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.16, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.24, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = w * 0.012;
    ctx.beginPath();
    ctx.arc(c, c, w * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  });
}

export function captureRingTexture(size = 256) {
  return canvasTexture(size, size, (ctx, w) => {
    const c = w / 2;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = w * 0.03;
    ctx.lineWidth = w * 0.035;
    ctx.beginPath();
    ctx.arc(c, c, w * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * w * 0.47, c + Math.sin(a) * w * 0.47);
      ctx.lineTo(c + Math.cos(a + 0.12) * w * 0.33, c + Math.sin(a + 0.12) * w * 0.33);
      ctx.lineTo(c + Math.cos(a - 0.12) * w * 0.33, c + Math.sin(a - 0.12) * w * 0.33);
      ctx.closePath();
      ctx.fill();
    }
  });
}

export function squareGlowTexture(size = 128) {
  return canvasTexture(size, size, (ctx, w) => {
    const data = ctx.createImageData(w, w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const dx = Math.abs(x / (w - 1) - 0.5) * 2, dy = Math.abs(y / (w - 1) - 0.5) * 2;
        const d = Math.max(dx, dy);
        const a = Math.max(0, Math.min(1, (d - 0.55) / 0.4)) * (d < 0.97 ? 1 : (1 - d) / 0.03) + 0.18 * (1 - d);
        const i = (y * w + x) * 4;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = 255;
        data.data[i + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    ctx.putImageData(data, 0, 0);
  });
}

const GLASS = ['#1b3fa8', '#2453c9', '#0f2a7a', '#b0182a', '#d12a2a', '#7a0f22', '#e0a11b', '#f0c33c', '#1d7a3f', '#5b2a8f', '#2c8fb0'];

function pointedArchPath(ctx, x, y, w, h) {
  // Lancet: rectangle topped by an equilateral pointed arch.
  const springY = y + w * 0.9;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, springY);
  ctx.arc(x + w, springY, w, Math.PI, Math.PI + Math.PI / 3, false);
  ctx.arc(x, springY, w, -Math.PI / 3, 0, false);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// Tall stained-glass lancet with diamond quarries, medallions and lead lines.
export function lancetTexture(seed = 1, width = 256, height = 768) {
  return canvasTexture(width, height, (ctx, w, h) => {
    const rand = seeded(seed * 977);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    pointedArchPath(ctx, 6, 6, w - 12, h - 12);
    ctx.clip();
    const cell = w / 5;
    for (let y = -cell; y < h + cell; y += cell / 2) {
      for (let x = -cell; x < w + cell; x += cell) {
        const ox = ((y / (cell / 2)) % 2) * (cell / 2);
        const cx = x + ox, cy = y;
        ctx.fillStyle = GLASS[Math.floor(rand() * GLASS.length)];
        ctx.globalAlpha = 0.75 + rand() * 0.25;
        ctx.beginPath();
        ctx.moveTo(cx, cy - cell / 2); ctx.lineTo(cx + cell / 2, cy); ctx.lineTo(cx, cy + cell / 2); ctx.lineTo(cx - cell / 2, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // Medallions.
    for (let i = 0; i < 3; i++) {
      const cy = h * (0.3 + i * 0.24), r = w * 0.3;
      const g = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, r);
      g.addColorStop(0, '#fff2c0');
      g.addColorStop(0.35, GLASS[6 + (i % 2)]);
      g.addColorStop(1, GLASS[i % 2 ? 0 : 3]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(w / 2, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0b0906';
      ctx.lineWidth = w * 0.025;
      ctx.stroke();
      ctx.lineWidth = w * 0.014;
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.arc(w / 2 + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, r * 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Lead lines over the quarries.
    ctx.strokeStyle = '#0b0906';
    ctx.lineWidth = w * 0.014;
    for (let y = -h; y < h * 2; y += cell) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + w); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w, y); ctx.lineTo(0, y + w); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#0b0906';
    ctx.lineWidth = w * 0.05;
    pointedArchPath(ctx, 6, 6, w - 12, h - 12);
    ctx.stroke();
  });
}

// Rose window: radial tracery with petals, foils and a central rosette.
export function roseTexture(size = 1024) {
  return canvasTexture(size, size, (ctx, w) => {
    const c = w / 2, R = w * 0.48;
    const rand = seeded(4242);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, w);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
    for (let i = 0; i < 900; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R;
      ctx.fillStyle = GLASS[Math.floor(rand() * GLASS.length)];
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, w * (0.01 + rand() * 0.025), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const petals = 12;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, R * 0.2, 0, R * 0.68);
      g.addColorStop(0, i % 2 ? '#c91f2e' : '#2a55d0');
      g.addColorStop(1, i % 2 ? '#f0c040' : '#7ab0ff');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, R * 0.2);
      ctx.quadraticCurveTo(R * 0.17, R * 0.42, 0, R * 0.7);
      ctx.quadraticCurveTo(-R * 0.17, R * 0.42, 0, R * 0.2);
      ctx.fill();
      ctx.restore();
    }
    const center = ctx.createRadialGradient(c, c, 0, c, c, R * 0.2);
    center.addColorStop(0, '#fff6d0');
    center.addColorStop(0.5, '#f0b030');
    center.addColorStop(1, '#a01828');
    ctx.fillStyle = center;
    ctx.beginPath(); ctx.arc(c, c, R * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Stone tracery.
    ctx.strokeStyle = '#0d0b08';
    ctx.lineCap = 'round';
    const stroke = (wd, path) => { ctx.lineWidth = wd; ctx.beginPath(); path(); ctx.stroke(); };
    stroke(w * 0.03, () => ctx.arc(c, c, R, 0, Math.PI * 2));
    stroke(w * 0.016, () => ctx.arc(c, c, R * 0.72, 0, Math.PI * 2));
    stroke(w * 0.016, () => ctx.arc(c, c, R * 0.2, 0, Math.PI * 2));
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      stroke(w * 0.012, () => { ctx.moveTo(c + Math.cos(a) * R * 0.2, c + Math.sin(a) * R * 0.2); ctx.lineTo(c + Math.cos(a) * R * 0.72, c + Math.sin(a) * R * 0.72); });
      const a2 = a + Math.PI / petals;
      const fx = c + Math.cos(a2) * R * 0.86, fy = c + Math.sin(a2) * R * 0.86;
      stroke(w * 0.012, () => ctx.arc(fx, fy, R * 0.12, 0, Math.PI * 2));
      stroke(w * 0.008, () => ctx.arc(c + Math.cos(a2) * R * 0.46, c + Math.sin(a2) * R * 0.46, R * 0.1, 0, Math.PI * 2));
    }
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      stroke(w * 0.01, () => ctx.arc(c + Math.cos(a) * R * 0.1, c + Math.sin(a) * R * 0.1, R * 0.1, 0, Math.PI * 2));
    }
  });
}

// Projected stained-glass light (spotlight cookie). The centre, which lands on the board,
// stays clear warm light so squares remain readable; colour and leading live at the rim.
export function cookieTexture(size = 512) {
  return canvasTexture(size, size, (ctx, w) => {
    const rand = seeded(1337);
    const c = w / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, w);
    const g = ctx.createRadialGradient(c, c, w * 0.05, c, c, w * 0.5);
    g.addColorStop(0, '#fff3dc');
    g.addColorStop(0.6, '#ffdcaa');
    g.addColorStop(0.92, '#7a5a3a');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
    const rim = (x, y) => Math.min(1, Math.max(0, (Math.hypot(x - c, y - c) / w - 0.27) / 0.08));
    const palette = ['#ff8a60', '#8ab4ff', '#ffd27a', '#ff6f8f', '#a8ffb0', '#c7a2ff'];
    const cell = w / 9;
    ctx.globalCompositeOperation = 'multiply';
    for (let y = 0; y < w + cell; y += cell / 2) {
      for (let x = 0; x < w + cell; x += cell) {
        const cx = x + ((Math.round(y / (cell / 2))) % 2) * cell / 2, cy = y;
        const k = rim(cx, cy);
        if (k <= 0 || rand() < 0.35) continue;
        ctx.globalAlpha = k * 0.9;
        ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
        ctx.beginPath();
        ctx.moveTo(cx, cy - cell / 2); ctx.lineTo(cx + cell / 2, cy); ctx.lineTo(cx, cy + cell / 2); ctx.lineTo(cx - cell / 2, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // Lead lines fade in toward the rim.
    const lead = ctx.createRadialGradient(c, c, w * 0.22, c, c, w * 0.4);
    lead.addColorStop(0, 'rgba(0,0,0,0.12)');
    lead.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.strokeStyle = lead;
    ctx.lineWidth = w * 0.005;
    for (let i = -w; i < w * 2; i += cell) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + w, w); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - w, w); ctx.stroke();
    }
  });
}

// Board frame lettering: a–h along files and 1–8 along ranks, gold inlaid into dark stone.
// Layout matches the frame's planar UVs: u spans x ∈ [-extent, extent], v spans z ∈ [-extent, extent].
export function frameTexture(extent, inner, fontFamily) {
  const size = 1024;
  return canvasTexture(size, size, (ctx, w) => {
    const toPx = v => ((v + extent) / (2 * extent)) * w;
    const g = ctx.createLinearGradient(0, 0, w, w);
    g.addColorStop(0, '#1c1915');
    g.addColorStop(1, '#2a251f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
    const rand = seeded(5);
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(255,240,220,${rand() * 0.04})`;
      ctx.fillRect(rand() * w, rand() * w, 2 + rand() * 6, 1 + rand() * 3);
    }
    const mid = (inner + extent) / 2;
    ctx.strokeStyle = '#b8924a';
    ctx.lineWidth = w * 0.003;
    for (const r of [inner + 0.06, extent - 0.08]) {
      const a = toPx(-r), b = toPx(r);
      ctx.strokeRect(a, a, b - a, b - a);
    }
    ctx.font = `700 ${Math.round(w * 0.034)}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const letter = (text, x, z, rot) => {
      ctx.save();
      ctx.translate(toPx(x), toPx(z));
      ctx.rotate(rot);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(text, w * 0.002, w * 0.002);
      const lg = ctx.createLinearGradient(0, -w * 0.02, 0, w * 0.02);
      lg.addColorStop(0, '#f6dc96');
      lg.addColorStop(0.5, '#c9a052');
      lg.addColorStop(1, '#8a6427');
      ctx.fillStyle = lg;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    for (let i = 0; i < 8; i++) {
      const c = i - 3.5;
      letter('abcdefgh'[i], c, mid, 0);
      letter('abcdefgh'[i], c, -mid, Math.PI);
      letter(String(i + 1), -mid, 3.5 - i, 0);
      letter(String(i + 1), mid, 3.5 - i, Math.PI);
    }
    for (const [x, z] of [[-mid, -mid], [mid, -mid], [-mid, mid], [mid, mid]]) {
      ctx.save();
      ctx.translate(toPx(x), toPx(z));
      ctx.strokeStyle = '#c9a052';
      ctx.lineWidth = w * 0.004;
      ctx.rotate(Math.PI / 4);
      const s = w * 0.014;
      ctx.strokeRect(-s, -s, 2 * s, 2 * s);
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-s, -s, 2 * s, 2 * s);
      ctx.restore();
    }
  });
}

// Metalness mask for the frame: only the gold inlay is metallic.
export function frameMetalTexture(source) {
  const canvas = source.image;
  return canvasTexture(canvas.width, canvas.height, (ctx, w, h) => {
    const src = canvas.getContext('2d').getImageData(0, 0, w, h);
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < src.data.length; i += 4) {
      const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2];
      const gold = r > 110 && r > b * 1.35 ? 255 : 0;
      out.data[i] = 255; out.data[i + 1] = gold ? 90 : 200; out.data[i + 2] = gold; out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, {srgb: false});
}
