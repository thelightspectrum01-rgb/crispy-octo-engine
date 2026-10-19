// Renderer, camera, post-processing, reflections and render resolution.
import * as THREE from 'three';
import {EffectComposer} from '../vendor/three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from '../vendor/three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from '../vendor/three/addons/postprocessing/OutputPass.js';
import {PlanarReflection} from './reflection.js';

// renderPixels: Ultra renders 3840x2160 internally (supersampled on smaller screens), or the
// screen's native resolution when that is higher. reflection: board mirror resolution scale.
export const QUALITY = {
  low: {label: 'Low', pixelRatio: 1, shadows: false, shadowSize: 0, bloom: false, msaa: 0, segments: 28, texture: 512, detail: 1,
    dust: 120, fragments: 0.6, reflection: 0, clearcoat: false, envSize: 128, anisotropy: 4},
  medium: {label: 'Medium', pixelRatio: 1.5, shadows: true, shadowSize: 1024, bloom: true, msaa: 0, segments: 40, texture: 512, detail: 1,
    dust: 260, fragments: 0.85, reflection: 0.3, clearcoat: false, envSize: 256, anisotropy: 8},
  high: {label: 'High', pixelRatio: 2, shadows: true, shadowSize: 2048, bloom: true, msaa: 4, segments: 52, texture: 1024, detail: 1,
    dust: 420, fragments: 1, reflection: 0.5, clearcoat: true, envSize: 256, anisotropy: 8},
  ultra: {label: 'Ultra 4K', renderPixels: 3840 * 2160, maxRatio: 3, shadows: true, shadowSize: 4096, bloom: true, msaa: 2, segments: 80,
    texture: 2048, detail: 2, dust: 600, fragments: 1.25, reflection: 0.75, clearcoat: true, envSize: 512, anisotropy: 16},
};

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return name;
  } catch {
    return '';
  }
}

export function detectQuality() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile) return cores >= 8 ? 'medium' : 'low';
  const gpu = gpuName();
  if (/SwiftShader|llvmpipe|softpipe|Software/i.test(gpu)) return 'medium';
  if (/RTX|RX\s?[6-9]\d{3}|Radeon Pro W|Arc A7|Apple M\d+ (Pro|Max|Ultra)/i.test(gpu)) return 'ultra';
  if (/Iris Xe|Arc/i.test(gpu)) return 'high';
  if (/Intel|UHD|HD Graphics|Mali|Adreno|PowerVR/i.test(gpu)) return 'medium';
  return 'high';
}

export class Stage {
  constructor(canvas, qualityName) {
    this.canvas = canvas;
    this.qualityName = qualityName;
    this.quality = QUALITY[qualityName];
    const q = this.quality;
    const renderer = new THREE.WebGLRenderer({canvas, antialias: !q.bloom && qualityName !== 'low', powerPreference: 'high-performance', alpha: false});
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadows are re-rendered only on frames where something that casts them moved.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.renderer = renderer;
    this.renderScale = 1;
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
    this.bufferSize = new THREE.Vector2();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050407);
    this.scene.fog = new THREE.FogExp2(0x0b0910, 0.021);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 220);
    this.camera.position.set(0, 9, 10);

    if (q.bloom) {
      const target = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: q.msaa});
      this.composer = new EffectComposer(renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.5, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    if (q.reflection > 0) this.reflection = new PlanarReflection(renderer, {scale: q.reflection});
    this.resize();
  }

  // Placeholder probe used for the first light bounce, before the real cathedral is captured.
  buildEnvironment() {
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
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(5, 14), new THREE.MeshBasicMaterial({color: new THREE.Color(windowColors[i % windowColors.length]).multiplyScalar(2.2)}));
      pane.position.set(Math.cos(a) * 40, 12, Math.sin(a) * 40);
      pane.lookAt(0, 6, 0);
      env.add(pane);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const texture = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
    env.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.scene.environment = texture;
    return texture;
  }

  // Captures the finished cathedral from just above the board into a prefiltered environment
  // map, so glossy stone reflects the real windows, candles and vaults.
  captureEnvironment(center = new THREE.Vector3(0, 1.4, 0)) {
    const target = new THREE.WebGLCubeRenderTarget(this.quality.envSize, {type: THREE.HalfFloatType});
    const cubeCamera = new THREE.CubeCamera(0.1, 150, target);
    cubeCamera.position.copy(center);
    cubeCamera.updateMatrixWorld(true);
    this.renderer.shadowMap.needsUpdate = true;
    cubeCamera.update(this.renderer, this.scene);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromCubemap(target.texture).texture;
    pmrem.dispose();
    target.dispose();
    const previous = this.scene.environment;
    this.scene.environment = env;
    if (previous && previous !== env) previous.dispose();
    this.renderer.shadowMap.needsUpdate = true;
  }

  baseRatio() {
    const dpr = window.devicePixelRatio || 1;
    const q = this.quality;
    if (q.renderPixels) return Math.min(q.maxRatio, Math.max(dpr, Math.sqrt(q.renderPixels / Math.max(1, this.width * this.height))));
    return Math.min(dpr, q.pixelRatio);
  }

  resize() {
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;
    this.pixelRatio = Math.max(0.5, this.baseRatio() * this.renderScale);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.getDrawingBufferSize(this.bufferSize);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(this.width, this.height);
      this.bloom.resolution.set(this.bufferSize.x * 0.5, this.bufferSize.y * 0.5);
    }
    if (this.reflection) this.reflection.setSize(this.bufferSize.x, this.bufferSize.y);
  }

  // Compiles every material in the scene, plus `extras` that only appear mid-game, for the target
  // frames are really drawn into (the bloom buffer when there is one), and uploads their textures,
  // so the first capture does not stall on shader compilation or texture uploads.
  warmUp(extras = []) {
    const holder = new THREE.Group();
    for (const object of extras) holder.add(object);
    this.scene.add(holder);
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer ? this.composer.renderTarget1 : null);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    const textures = new Set();
    this.scene.traverse(object => {
      for (const material of [object.material].flat()) {
        if (!material) continue;
        for (const value of [...Object.values(material), ...Object.values(material.uniforms || {}).map(u => u.value)]) {
          if (value && value.isTexture && !value.isRenderTargetTexture) textures.add(value);
        }
      }
    });
    for (const texture of textures) this.renderer.initTexture(texture);
    this.scene.remove(holder);
  }

  // Dynamic resolution: a fraction of the preset's resolution, chosen by the frame governor.
  setRenderScale(scale) {
    this.renderScale = scale;
    this.resize();
  }

  // dynamic: something that casts shadows or appears in the board mirror moved this frame.
  render(dynamic = true) {
    if (this.reflection) this.reflection.update(this.scene, this.camera, dynamic);
    if (dynamic) this.renderer.shadowMap.needsUpdate = true;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
