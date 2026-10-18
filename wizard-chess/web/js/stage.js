// Renderer, camera, post-processing and the reflection environment.
import * as THREE from 'three';
import {EffectComposer} from '../vendor/three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from '../vendor/three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from '../vendor/three/addons/postprocessing/OutputPass.js';

export const QUALITY = {
  low: {pixelRatio: 1, shadows: false, shadowSize: 0, bloom: false, msaa: false, segments: 28, texture: 512, dust: 120, fragments: 0.6},
  medium: {pixelRatio: 1.5, shadows: true, shadowSize: 1024, bloom: true, msaa: false, segments: 40, texture: 512, dust: 260, fragments: 0.85},
  high: {pixelRatio: 2, shadows: true, shadowSize: 2048, bloom: true, msaa: true, segments: 52, texture: 1024, dust: 420, fragments: 1},
};

export function detectQuality() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile) return cores >= 8 ? 'medium' : 'low';
  return 'high';
}

export class Stage {
  constructor(canvas, qualityName) {
    this.canvas = canvas;
    this.qualityName = qualityName;
    this.quality = QUALITY[qualityName];
    const renderer = new THREE.WebGLRenderer({canvas, antialias: !this.quality.bloom && qualityName !== 'low', powerPreference: 'high-performance', alpha: false});
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050407);
    this.scene.fog = new THREE.FogExp2(0x0b0910, 0.021);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 220);
    this.camera.position.set(0, 9, 10);

    if (this.quality.bloom) {
      const target = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: this.quality.msaa ? 4 : 0});
      this.composer = new EffectComposer(renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.5, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.frameTimes = [];
    this.resize();
  }

  buildEnvironment() {
    // A dim cathedral-like light probe: warm floor glow, coloured windows and candle points.
    const env = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vDir; void main(){ float h = vDir.y; vec3 c = mix(vec3(0.05,0.035,0.025), vec3(0.015,0.014,0.02), smoothstep(-0.3, 0.6, h)); c += vec3(0.09,0.05,0.025) * smoothstep(0.2,-0.4,h); gl_FragColor = vec4(c,1.0); }',
    }));
    env.add(sky);
    const windowColors = [0x3a6cff, 0xff3a3a, 0xffc04a, 0x5a3aff, 0x3affb0, 0xff7a2a];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({color: new THREE.Color(windowColors[i % windowColors.length]).multiplyScalar(2.2)});
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(5, 14), mat);
      pane.position.set(Math.cos(a) * 40, 12, Math.sin(a) * 40);
      pane.lookAt(0, 6, 0);
      env.add(pane);
    }
    for (let i = 0; i < 10; i++) {
      const candle = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({color: new THREE.Color(6, 3, 1)}));
      const a = (i / 10) * Math.PI * 2 + 0.3;
      candle.position.set(Math.cos(a) * 22, 2 + (i % 3), Math.sin(a) * 22);
      env.add(candle);
    }
    const rose = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({color: new THREE.Color(1.6, 1.1, 2.2)}));
    rose.position.set(0, 24, -40);
    rose.lookAt(0, 0, 0);
    env.add(rose);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const texture = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
    env.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.scene.environment = texture;
    return texture;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
      this.bloom.resolution.set(w * this.pixelRatio * 0.5, h * this.pixelRatio * 0.5);
    }
  }

  setPixelRatio(ratio) {
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.resize();
  }

  // Adaptive resolution: trades sharpness for frame rate on slow devices.
  trackFrame(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 1 / 38 && this.pixelRatio > 0.75) this.setPixelRatio(Math.max(0.75, this.pixelRatio - 0.25));
    else if (avg < 1 / 57 && this.pixelRatio < this.maxPixelRatio) this.setPixelRatio(Math.min(this.maxPixelRatio, this.pixelRatio + 0.25));
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
