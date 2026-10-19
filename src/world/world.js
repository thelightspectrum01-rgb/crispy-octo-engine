import {
  ACESFilmicToneMapping,
  Color,
  Fog,
  Matrix4,
  BackSide,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildDesk } from './desk.js';
import { backdropTexture } from '../render/textures.js';
import { buildTrackMeshes, buildPickups } from './trackMesh.js';
import { createCart } from './cart.js';
import { Particles } from './particles.js';
import { Post } from '../render/post.js';
import { CameraRig } from '../render/camera.js';
import { makeFrame } from '../track/piece.js';

const _basis = new Matrix4();
const _neg = new Vector3();

/** Everything that lives on screen: renderer, scene graph, post-processing and camera. */
export class World {
  constructor(container, track, { quality = 'high' } = {}) {
    this.track = track;
    this.quality = quality;
    this.container = container;
    this.time = 0;

    const renderer = new WebGLRenderer({ antialias: quality === 'low', powerPreference: 'high-performance', stencil: false });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.setClearColor(0x090b12, 1);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    this.renderer = renderer;

    const scene = new Scene();
    scene.background = new Color(0x0a0c13);
    scene.fog = new Fog(0x0a0c13, 120, 320);
    this.scene = scene;

    // reflections for the chrome rails / glossy paint
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.32;
    pmrem.dispose();

    this.desk = buildDesk(track, { quality, renderer });
    scene.add(this.desk.group);

    this.trackMesh = buildTrackMeshes(track, { quality });
    scene.add(this.trackMesh.group);

    this.pickups = buildPickups(track);
    scene.add(this.pickups.group);

    // room backdrop (soft bokeh lights all around)
    const dome = new Mesh(new CylinderGeometry(190, 190, 150, 48, 1, true), new MeshBasicMaterial({ map: backdropTexture(), side: BackSide, fog: false, depthWrite: false }));
    dome.position.y = 25;
    dome.rotation.y = 1.2;
    scene.add(dome);

    // dark floor far below the desk (only seen in orbit shots)
    const floor = new Mesh(new PlaneGeometry(900, 900), new MeshStandardMaterial({ color: 0x151822, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -34;
    floor.receiveShadow = false;
    scene.add(floor);

    // carts
    this.cart = createCart();
    this.ghostCart = createCart({ ghost: true, tint: 0x59d2ff });
    this.rivalCart = createCart({ ghost: true, tint: 0xff7a59 });
    this.ghostCart.root.visible = false;
    this.rivalCart.root.visible = false;
    scene.add(this.cart.root, this.ghostCart.root, this.rivalCart.root);

    this.sparks = new Particles(500, { gravity: -9, drag: 0.6 });
    this.trail = new Particles(500, { gravity: 0.2, drag: 1.8 });
    scene.add(this.sparks.points, this.trail.points);

    this.rig = new CameraRig(1.6);
    this.post = new Post(renderer, { quality });

    this.frame = makeFrame();
    this.center = new Vector3(0, 2, 0);
    this.resize();
  }

  get camera() {
    return this.rig.camera;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const cap = this.maxPixelRatio ?? (this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1);
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.pixelRatio = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.post.setSize(w, h, dpr);
    this.rig.resize(w / h);
    this.sparks.setViewportScale(h * dpr);
    this.trail.setViewportScale(h * dpr);
  }

  setPixelRatioCap(cap) {
    this.maxPixelRatio = cap;
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    this.post.setQuality(q);
    this.renderer.shadowMap.enabled = true;
    this.resize();
  }

  /** Swap in another circuit: rebuild the track meshes + pickups (the desk stays). */
  setTrack(track) {
    for (const part of [this.trackMesh.group, this.pickups.group]) {
      this.scene.remove(part);
      part.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          m.map?.dispose();
          m.dispose();
        }
      });
    }
    this.track = track;
    this.desk.setMirror(!!track.layout.mirror);
    this.trackMesh = buildTrackMeshes(track, { quality: this.quality });
    this.pickups = buildPickups(track);
    this.scene.add(this.trackMesh.group, this.pickups.group);
    this.center.set(0, 2, 0);
  }

  /** Render once with every normally-hidden effect visible so all shader programs are compiled up front. */
  warmup() {
    const hidden = [];
    for (const c of [this.cart, this.ghostCart, this.rivalCart]) {
      hidden.push([c.root, c.root.visible]);
      c.root.visible = true;
      c.root.traverse((o) => {
        if (!o.visible) {
          hidden.push([o, false]);
          o.visible = true;
        }
      });
    }
    this.sparks.emit(new Vector3(0, 1, 0), new Vector3(), { life: 0.1 });
    this.trail.emit(new Vector3(0, 1, 0), new Vector3(), { life: 0.1 });
    this.sparks.update(0.001);
    this.trail.update(0.001);
    let broken = !this.renderer.capabilities.isWebGL2;
    try {
      this.rig.update(0.016, { pos: new Vector3(0, 2, 0), tan: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), right: new Vector3(0, 0, 1) });
      this.post.render(this.scene, this.rig.camera, 0.016);
      // any GL error here means the HDR / MSAA / depth-texture pipeline is not usable on this device
      const gl = this.renderer.getContext();
      for (let err = gl.getError(); err !== gl.NO_ERROR; err = gl.getError()) broken = true;
    } catch (e) {
      console.warn('post-processing warm-up failed', e);
      broken = true;
    }
    if (broken && this.quality !== 'low') {
      console.warn('Post-processing is not supported here; falling back to direct rendering.');
      this.setQuality('low');
      this.fellBack = true;
    }
    for (const [o, v] of hidden.reverse()) o.visible = v;
    this.sparks.life.fill(0);
    this.trail.life.fill(0);
    this.sparks.update(0.001);
    this.trail.update(0.001);
  }

  /** Orient a cart on the track at arc length s (positions it on the rails). Returns the frame. */
  placeCart(cart, s, out = this.frame) {
    this.track.piece.frame(s, out);
    cart.root.position.copy(out.pos);
    _neg.copy(out.tan).negate();
    _basis.makeBasis(out.right, out.up, _neg);
    cart.root.quaternion.setFromRotationMatrix(_basis);
    return out;
  }

  update(dt, collected = new Set()) {
    this.time += dt;
    const t = this.time;
    this.desk.update(t);
    this.pickups.update(t, collected, dt);
    this.sparks.update(dt);
    this.trail.update(dt);
    // gates pulse
    const pulse = 1.0 + Math.sin(t * 3) * 0.35;
    this.trackMesh.mats.accent.emissiveIntensity = pulse * 0.0;
    // launch LEDs chase
    const leds = this.trackMesh.leds;
    if (leds.mesh) {
      const c = new Color();
      for (let i = 0; i < leds.count; i++) {
        const b = Math.max(0, Math.sin(i * 0.9 - t * 16));
        c.setRGB(0.08 + b * 0.35, 0.2 + b * 0.75, 0.35 + b * 0.65);
        leds.mesh.setColorAt(i, c);
      }
      leds.mesh.instanceColor.needsUpdate = true;
    }
  }

  render(dt) {
    this.post.render(this.scene, this.rig.camera, dt);
  }

  dispose() {
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

