import {
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const DOF_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float camNear;
uniform float camFar;
uniform float focus;
uniform float strength;
uniform float maxBlur;
uniform float deadZone;

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * camNear * camFar) / (camFar + camNear - z * (camFar - camNear));
}
float cocAt(vec2 uv) {
  float z = linearDepth(texture2D(tDepth, uv).x);
  float diff = max(0.0, abs(z - focus) - deadZone);
  return clamp(strength * diff / max(z, 0.001), 0.0, 1.0) * maxBlur;
}
void main() {
  vec4 center = texture2D(tColor, vUv);
  float coc = cocAt(vUv);
  if (coc < 0.6) { gl_FragColor = center; return; }
  vec3 acc = center.rgb;
  float wsum = 1.0;
  const int TAPS = 22;
  for (int i = 0; i < TAPS; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(TAPS));
    float a = fi * 2.39996323;
    vec2 off = vec2(cos(a), sin(a)) * r * coc;
    vec2 uv = vUv + off * texel;
    float sc = cocAt(uv);
    float dist = r * coc;
    // a sample contributes when its own blur disc reaches us, or when we are blurrier than it
    float w = clamp(sc - dist + 1.5, 0.0, 1.0);
    w = max(w, 0.0) * (0.35 + 0.65 * smoothstep(0.0, 1.5, sc));
    vec3 c = texture2D(tColor, uv).rgb;
    acc += c * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`;

const GRADE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform vec2 texel;
uniform float time;
uniform float vignette;
uniform float grain;
uniform float speedBlur;
uniform float aberration;
uniform float saturation;
uniform float contrast;
uniform vec3 tint;
uniform float flash;
uniform vec3 flashColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 c = vUv - 0.5;
  float r = length(c);
  vec2 dir = c / max(r, 1e-4);
  float edge = smoothstep(0.18, 0.75, r);
  vec3 col;
  if (speedBlur > 0.001) {
    float s = speedBlur * edge;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 7; i++) {
      float t = float(i) / 6.0;
      acc += texture2D(tColor, vUv - dir * s * t).rgb;
    }
    col = acc / 7.0;
  } else {
    col = texture2D(tColor, vUv).rgb;
  }
  if (aberration > 0.0001) {
    vec2 o = dir * aberration * r * r;
    col.r = mix(col.r, texture2D(tColor, vUv + o).r, 0.8);
    col.b = mix(col.b, texture2D(tColor, vUv - o).b, 0.8);
  }
  // grade
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, saturation);
  col = (col - 0.18) * contrast + 0.18;
  col *= tint;
  col *= 1.0 - vignette * smoothstep(0.32, 0.98, r * 1.25);
  col += (hash(vUv * (1.0 / texel) + time) - 0.5) * grain;
  col = mix(col, flashColor, flash);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export class Post {
  constructor(renderer, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.quality = quality;
    this.size = new Vector2(1, 1);
    this.params = {
      focus: 10,
      dofStrength: 1.2,
      dofMax: 9,
      deadZone: 2.5,
      vignette: 0.38,
      grain: 0.018,
      speedBlur: 0,
      aberration: 0.0007,
      saturation: 1.1,
      contrast: 1.06,
      tint: [1.03, 1.0, 0.96],
      flash: 0,
      flashColor: [1, 1, 1],
      bloom: 0.3,
      dof: true,
    };
    this._fs = new FullScreenQuad();
    this.enabled = quality !== 'low';
    this.time = 0;
    this._build();
  }

  _build() {
    const r = this.renderer;
    const depth = new DepthTexture(1, 1, FloatType);
    depth.minFilter = NearestFilter;
    depth.magFilter = NearestFilter;
    const samples = Math.min(4, r.capabilities.maxSamples ?? 0);
    this.sceneRT = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples, depthTexture: depth, minFilter: LinearFilter, magFilter: LinearFilter });
    this.rtA = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    this.rtB = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });

    this.dofMat = new ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: DOF_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: depth },
        texel: { value: new Vector2() },
        camNear: { value: 0.1 },
        camFar: { value: 400 },
        focus: { value: 10 },
        strength: { value: 1 },
        maxBlur: { value: 8 },
        deadZone: { value: 2 },
      },
    });
    this.gradeMat = new ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: GRADE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        texel: { value: new Vector2() },
        time: { value: 0 },
        vignette: { value: 0.4 },
        grain: { value: 0.03 },
        speedBlur: { value: 0 },
        aberration: { value: 0.003 },
        saturation: { value: 1.1 },
        contrast: { value: 1.05 },
        tint: { value: [1, 1, 1] },
        flash: { value: 0 },
        flashColor: { value: [1, 1, 1] },
      },
    });
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.4, 0.5, 1.0);
    this.output = new OutputPass();
    this.output.renderToScreen = true;
  }

  setSize(w, h, pixelRatio = 1) {
    const pw = Math.max(2, Math.floor(w * pixelRatio));
    const ph = Math.max(2, Math.floor(h * pixelRatio));
    this.size.set(pw, ph);
    this.sceneRT.setSize(pw, ph);
    this.rtA.setSize(pw, ph);
    this.rtB.setSize(pw, ph);
    this.bloom.setSize(pw, ph);
    this.dofMat.uniforms.texel.value.set(1 / pw, 1 / ph);
    this.gradeMat.uniforms.texel.value.set(1 / pw, 1 / ph);
  }

  setQuality(q) {
    this.quality = q;
    this.enabled = q !== 'low';
  }

  render(scene, camera, dt) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    this.time += dt;
    const p = this.params;

    // 1. scene -> MSAA target (colour + depth)
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2. depth of field
    let src = this.sceneRT;
    if (p.dof) {
      const u = this.dofMat.uniforms;
      const scale = this.size.y / 1080;
      u.tColor.value = this.sceneRT.texture;
      u.camNear.value = camera.near;
      u.camFar.value = camera.far;
      u.focus.value = p.focus;
      u.strength.value = p.dofStrength;
      u.maxBlur.value = p.dofMax * Math.max(0.6, scale);
      u.deadZone.value = p.deadZone;
      this._fs.material = this.dofMat;
      r.setRenderTarget(this.rtA);
      this._fs.render(r);
      src = this.rtA;
    } else {
      // copy the (resolved) scene into rtA so bloom / grade operate on a plain target
      this.gradeMat.uniforms.tColor.value = this.sceneRT.texture;
    }

    // 3. bloom (adds in place on `src`)
    if (this.quality === 'high' && src === this.rtA && p.bloom > 0.001) {
      this.bloom.strength = p.bloom;
      this.bloom.render(r, null, src, dt, false);
    }

    // 4. grade -> rtB
    const g = this.gradeMat.uniforms;
    g.tColor.value = src.texture;
    g.time.value = (this.time * 60) % 1000;
    g.vignette.value = p.vignette;
    g.grain.value = p.grain;
    g.speedBlur.value = p.speedBlur;
    g.aberration.value = p.aberration;
    g.saturation.value = p.saturation;
    g.contrast.value = p.contrast;
    g.tint.value = p.tint;
    g.flash.value = p.flash;
    g.flashColor.value = p.flashColor;
    this._fs.material = this.gradeMat;
    r.setRenderTarget(this.rtB);
    this._fs.render(r);

    // 5. tone-map + sRGB -> screen
    this.output.render(r, null, this.rtB);
  }

  dispose() {
    this.sceneRT.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.bloom.dispose();
    this.output.dispose();
    this.dofMat.dispose();
    this.gradeMat.dispose();
  }
}
