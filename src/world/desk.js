import {
  AdditiveBlending,
  BoxGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  HemisphereLight,
  DirectionalLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  CanvasTexture,
  SRGBColorSpace,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  cuttingMatTexture,
  glowTexture,
  mulberry32,
  paperTexture,
  rulerTexture,
  screenTexture,
  stickyTexture,
  woodTexture,
} from '../render/textures.js';

const rb = (w, h, d, r = 0.1, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);

function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

const std = (color, rough = 0.6, metal = 0.0, extra = {}) => new MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

/* ------------------------------------------------------------------ props */

function makeMug(color = 0xf4f1ea) {
  const g = new Group();
  const pts = [
    [0.0, 0.0],
    [0.92, 0.0],
    [1.04, 0.08],
    [1.1, 0.35],
    [1.1, 2.3],
    [1.14, 2.4],
    [1.06, 2.42],
    [0.98, 2.34],
    [0.98, 0.28],
    [0.0, 0.28],
  ].map(([x, y]) => new Vector2(x, y));
  const body = mesh(new LatheGeometry(pts, 40), new MeshPhysicalMaterial({ color, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.15, side: DoubleSide }));
  g.add(body);
  const coffee = mesh(new CircleGeometry(0.99, 32), new MeshPhysicalMaterial({ color: 0x3b2314, roughness: 0.12, clearcoat: 1 }), { cast: false });
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 1.95;
  g.add(coffee);
  const handle = mesh(new TorusGeometry(0.62, 0.13, 10, 24, Math.PI), body.material);
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(1.12, 1.35, 0);
  g.add(handle);
  // logo band
  const band = mesh(new CylinderGeometry(1.115, 1.115, 0.34, 40, 1, true), std(0xe2563b, 0.4), { cast: false });
  band.position.y = 1.2;
  g.add(band);
  // steam
  const steam = [];
  const steamMat = new SpriteMaterial({ map: glowTexture({ color: '230,230,235' }), transparent: true, opacity: 0.0, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const sp = new Sprite(steamMat.clone());
    sp.userData = { phase: i / 7, drift: (i % 2 ? 1 : -1) * (0.2 + (i % 3) * 0.1) };
    g.add(sp);
    steam.push(sp);
  }
  g.userData.update = (t) => {
    for (const sp of steam) {
      const k = (t * 0.22 + sp.userData.phase) % 1;
      sp.position.set(Math.sin(t * 0.7 + sp.userData.phase * 9) * 0.25 + sp.userData.drift * k * 0.6, 2.1 + k * 3.2, Math.cos(t * 0.5 + sp.userData.phase * 7) * 0.2);
      const sc = 0.9 + k * 1.9;
      sp.scale.set(sc, sc, 1);
      sp.material.opacity = Math.sin(k * Math.PI) * 0.2;
    }
  };
  return g;
}

function makePenCup() {
  const g = new Group();
  const pts = [
    [0, 0],
    [0.9, 0],
    [0.95, 0.1],
    [0.95, 2.4],
    [0.88, 2.42],
    [0.84, 2.3],
    [0.84, 0.15],
    [0, 0.15],
  ].map(([x, y]) => new Vector2(x, y));
  g.add(mesh(new LatheGeometry(pts, 28), std(0x2e3a52, 0.45, 0.2, { side: DoubleSide })));
  const colors = [0xe94b3c, 0x2d9cdb, 0xf2c94c, 0x27ae60, 0x9b51e0, 0xf2994a, 0x111111];
  const rnd = mulberry32(11);
  colors.forEach((c, i) => {
    const pen = new Group();
    const len = 3.4 + rnd() * 1.2;
    const body = mesh(new CylinderGeometry(0.075, 0.075, len, 6), std(c, 0.4));
    const tip = mesh(new ConeGeometry(0.075, 0.28, 6), std(0xd8c8a8, 0.7));
    tip.position.y = len / 2 + 0.14;
    tip.rotation.x = 0;
    pen.add(body, tip);
    pen.position.y = len / 2 - 0.3;
    const wrap = new Group();
    wrap.add(pen);
    const ang = (i / colors.length) * Math.PI * 2 + rnd();
    wrap.rotation.set(Math.cos(ang) * 0.22, 0, Math.sin(ang) * 0.22);
    wrap.position.set(Math.cos(ang) * 0.25, 0.3, Math.sin(ang) * 0.25);
    g.add(wrap);
  });
  return g;
}

function makeBookStack(specs, seed = 1) {
  const g = new Group();
  const rnd = mulberry32(seed);
  let y = 0;
  for (const sp of specs) {
    const { w, d, h, color } = sp;
    const book = new Group();
    const cover = mesh(rb(w, h, d, 0.06, 2), std(color, 0.55));
    const pages = mesh(new BoxGeometry(w - 0.18, h - 0.16, d - 0.1), std(0xf0e9d8, 0.9));
    pages.position.set(0.08, 0, 0.0);
    book.add(cover, pages);
    // title band on the spine side
    const band = mesh(new BoxGeometry(0.02, h * 0.55, d * 0.5), std(0xffffff, 0.5), { cast: false });
    band.position.set(-w / 2 - 0.005, 0, 0);
    book.add(band);
    book.position.set((rnd() - 0.5) * 0.5, y + h / 2, (rnd() - 0.5) * 0.4);
    book.rotation.y = (rnd() - 0.5) * 0.28;
    g.add(book);
    y += h;
  }
  return g;
}

function makeNotebook() {
  const g = new Group();
  const pageL = mesh(new BoxGeometry(7.2, 0.16, 9.6), new MeshStandardMaterial({ map: paperTexture({ seed: 3 }), roughness: 0.92 }));
  const pageR = mesh(new BoxGeometry(7.2, 0.16, 9.6), new MeshStandardMaterial({ map: paperTexture({ seed: 4, margin: false, grid: true, lines: false }), roughness: 0.92 }));
  pageL.position.set(-3.65, 0.08, 0);
  pageR.position.set(3.65, 0.08, 0);
  pageL.rotation.z = 0.012;
  pageR.rotation.z = -0.012;
  const cover = mesh(rb(15.4, 0.14, 10.2, 0.05, 2), std(0x2b4d9b, 0.6));
  cover.position.y = -0.02;
  g.add(cover, pageL, pageR);
  const ringMat = std(0xc9ced6, 0.3, 0.9);
  for (let i = 0; i < 14; i++) {
    const ring = mesh(new TorusGeometry(0.2, 0.035, 6, 14), ringMat, { receive: false });
    ring.position.set(0, 0.22, -4.4 + i * 0.68);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
  }
  // pen resting on the page
  const pen = new Group();
  pen.add(mesh(new CylinderGeometry(0.1, 0.1, 4.2, 12), std(0x1e2430, 0.35, 0.2)));
  const tip = mesh(new ConeGeometry(0.1, 0.35, 12), std(0xcbd1d9, 0.3, 0.9));
  tip.position.y = -2.25;
  tip.rotation.z = Math.PI;
  pen.add(tip);
  const clip = mesh(new BoxGeometry(0.03, 1.1, 0.08), std(0xcbd1d9, 0.3, 0.9));
  clip.position.set(0.11, 1.2, 0);
  pen.add(clip);
  pen.rotation.set(Math.PI / 2, 0, 0.9);
  pen.position.set(2.8, 0.42, 1.4);
  g.add(pen);
  return g;
}

function makeKeyboard() {
  const g = new Group();
  const base = mesh(rb(13.2, 0.55, 4.6, 0.22, 3), std(0x2b2f38, 0.5, 0.1));
  base.position.y = 0.27;
  g.add(base);
  const plate = mesh(new BoxGeometry(12.5, 0.12, 3.95), std(0x1a1d23, 0.7), { cast: false });
  plate.position.y = 0.58;
  g.add(plate);
  const keyGeo = rb(0.74, 0.3, 0.74, 0.1, 2);
  const rows = [14, 14, 13, 12, 3];
  const keys = [];
  let z = -1.45;
  rows.forEach((count, r) => {
    let x = -6.0 + (r === 2 ? 0.3 : r === 3 ? 0.6 : 0);
    for (let i = 0; i < count; i++) {
      let w = 0.82;
      if (r === 4) w = i === 1 ? 5.0 : 1.2;
      keys.push({ x: x + w / 2, z, w });
      x += w + 0.1;
    }
    z += 0.92;
  });
  const inst = new InstancedMesh(keyGeo, std(0xffffff, 0.45), keys.length);
  const m = new Matrix4();
  const c = new Color();
  const rnd = mulberry32(5);
  keys.forEach((k, i) => {
    m.compose(new Vector3(k.x, 0.77, k.z), new Quaternion(), new Vector3(k.w / 0.74, 1, 1));
    inst.setMatrixAt(i, m);
    c.set(rnd() < 0.12 ? 0xf08a3c : rnd() < 0.5 ? 0xe6e4dd : 0xd7dae0);
    inst.setColorAt(i, c);
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  g.add(inst);
  g.rotation.x = 0; // flat
  return g;
}

function makeMouse() {
  const g = new Group();
  const body = mesh(new SphereGeometry(1, 24, 16), std(0xe9ebee, 0.3, 0.1));
  body.scale.set(0.8, 0.5, 1.2);
  body.position.y = 0.45;
  g.add(body);
  const line = mesh(new BoxGeometry(0.03, 0.02, 0.9), std(0x30343c, 0.6), { cast: false });
  line.position.set(0, 0.93, -0.55);
  g.add(line);
  const wheel = mesh(new CylinderGeometry(0.1, 0.1, 0.16, 12), std(0xf08a3c, 0.5), { cast: false });
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, 0.92, -0.55);
  g.add(wheel);
  // cable
  const curve = new CatmullRomCurve3([new Vector3(0, 0.15, -1.1), new Vector3(0.2, 0.08, -2.6), new Vector3(-1.2, 0.08, -4.2), new Vector3(-3.5, 0.08, -4.8)]);
  g.add(mesh(new TubeGeometry(curve, 24, 0.07, 6), std(0x20242b, 0.7), { receive: false }));
  return g;
}

function makePlant() {
  const g = new Group();
  const pts = [
    [0, 0],
    [1.15, 0],
    [1.35, 0.15],
    [1.65, 2.2],
    [1.75, 2.3],
    [1.65, 2.34],
    [1.5, 2.2],
    [1.2, 0.3],
    [0, 0.3],
  ].map(([x, y]) => new Vector2(x, y));
  g.add(mesh(new LatheGeometry(pts, 28), std(0xc9663c, 0.8, 0.0, { side: DoubleSide })));
  const soil = mesh(new CircleGeometry(1.5, 24), std(0x3a281c, 0.95), { cast: false });
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 2.1;
  g.add(soil);
  const leafGeo = new SphereGeometry(1, 10, 8);
  const greens = [0x5fa86b, 0x4f9a63, 0x73b97a, 0x3f8a5a];
  const rnd = mulberry32(8);
  for (let ring = 0; ring < 4; ring++) {
    const n = 5 + ring * 2;
    for (let i = 0; i < n; i++) {
      const leaf = mesh(leafGeo, std(greens[(ring + i) % greens.length], 0.55), { receive: false });
      const a = (i / n) * Math.PI * 2 + ring * 0.5 + rnd() * 0.2;
      const tilt = 0.25 + ring * 0.28;
      leaf.scale.set(0.32, 0.18, 1.0 - ring * 0.1);
      const rr = 0.25 + ring * 0.28;
      leaf.position.set(Math.cos(a) * rr, 2.45 + (3 - ring) * 0.2, Math.sin(a) * rr);
      leaf.rotation.set(0, -a + Math.PI / 2, 0);
      leaf.rotateX(-tilt);
      g.add(leaf);
    }
  }
  return g;
}

function makePaperclip(color = 0xc7ccd4) {
  const pts = [
    new Vector3(-0.9, 0, 0.25),
    new Vector3(0.9, 0, 0.25),
    new Vector3(1.0, 0, 0.0),
    new Vector3(0.9, 0, -0.25),
    new Vector3(-0.6, 0, -0.25),
    new Vector3(-0.72, 0, 0.0),
    new Vector3(-0.6, 0, 0.12),
    new Vector3(0.6, 0, 0.12),
    new Vector3(0.7, 0, 0.0),
    new Vector3(0.6, 0, -0.1),
  ];
  const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
  const m = mesh(new TubeGeometry(curve, 48, 0.03, 6), std(color, 0.25, 0.95), { receive: false });
  m.position.y = 0.04;
  return m;
}

function makeRuler() {
  const g = new Group();
  const m = mesh(new BoxGeometry(7.6, 0.07, 0.95), new MeshStandardMaterial({ map: rulerTexture(), roughness: 0.5 }));
  m.position.y = 0.035;
  g.add(m);
  return g;
}

function makePencil() {
  const g = new Group();
  const body = mesh(new CylinderGeometry(0.1, 0.1, 3.6, 6), std(0xffc21a, 0.5));
  body.rotation.z = Math.PI / 2;
  const cone = mesh(new ConeGeometry(0.1, 0.45, 6), std(0xe4c99a, 0.8));
  cone.rotation.z = Math.PI / 2;
  cone.position.x = 2.02;
  cone.scale.set(1, 1, 1);
  const lead = mesh(new ConeGeometry(0.035, 0.14, 6), std(0x2a2a2a, 0.5));
  lead.rotation.z = -Math.PI / 2;
  lead.position.x = 2.3;
  const ferrule = mesh(new CylinderGeometry(0.105, 0.105, 0.28, 10), std(0xb8c0c8, 0.3, 0.9));
  ferrule.rotation.z = Math.PI / 2;
  ferrule.position.x = -1.9;
  const eraser = mesh(new CylinderGeometry(0.1, 0.1, 0.24, 10), std(0xf28aa0, 0.8));
  eraser.rotation.z = Math.PI / 2;
  eraser.position.x = -2.15;
  g.add(body, cone, lead, ferrule, eraser);
  g.position.y = 0.12;
  return g;
}

function makeSticky(color, seed) {
  const g = new Group();
  const stack = mesh(new BoxGeometry(2.2, 0.28, 2.2), std(color, 0.9));
  stack.position.y = 0.14;
  const top = mesh(new PlaneGeometry(2.2, 2.2), new MeshStandardMaterial({ map: stickyTexture('#' + new Color(color).getHexString(), seed), roughness: 0.9 }), { cast: false });
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.285;
  g.add(stack, top);
  return g;
}

function makeHeadphones() {
  const g = new Group();
  const band = mesh(new TorusGeometry(2.4, 0.2, 10, 28, Math.PI), std(0x222831, 0.5, 0.2));
  band.position.y = 1.25;
  g.add(band);
  for (const sd of [-1, 1]) {
    const cup = mesh(new CylinderGeometry(1.25, 1.25, 0.9, 24), std(0x2e3440, 0.4, 0.3));
    cup.rotation.z = Math.PI / 2;
    cup.position.set(sd * 2.4, 1.25, 0);
    const pad = mesh(new CylinderGeometry(1.1, 1.1, 0.4, 24), std(0xe94b3c, 0.8));
    pad.rotation.z = Math.PI / 2;
    pad.position.set(sd * 1.9, 1.25, 0);
    g.add(cup, pad);
  }
  return g;
}

function makePhone() {
  const g = new Group();
  g.add(mesh(rb(3.3, 0.32, 6.5, 0.4, 4), std(0x16181d, 0.25, 0.4)));
  const scr = mesh(new PlaneGeometry(3.0, 6.1), new MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.1, metalness: 0.3, emissive: 0x16304f, emissiveIntensity: 0.55 }), { cast: false });
  scr.rotation.x = -Math.PI / 2;
  scr.position.y = 0.165;
  g.add(scr);
  g.position.y = 0.16;
  return g;
}

function makeDie() {
  const mats = [];
  for (let f = 1; f <= 6; f++) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f7f4ec';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = f === 1 ? '#d33' : '#222';
    const pos = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[f];
    for (const [x, y] of pos) {
      ctx.beginPath();
      ctx.arc(64 + x * 32, 64 + y * 32, f === 1 ? 20 : 11, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    mats.push(new MeshStandardMaterial({ map: tex, roughness: 0.35 }));
  }
  const d = mesh(rb(1.3, 1.3, 1.3, 0.16, 3), mats);
  d.position.y = 0.65;
  return d;
}

function makeMonitor() {
  const g = new Group();
  const base = mesh(rb(7, 0.4, 4.2, 0.15), std(0x20242b, 0.35, 0.5));
  base.position.y = 0.2;
  const neck = mesh(new BoxGeometry(1.1, 6.5, 0.7), std(0x20242b, 0.35, 0.5));
  neck.position.set(0, 3.5, -0.6);
  const panel = mesh(rb(26, 15, 0.9, 0.3), std(0x0e1015, 0.4, 0.3));
  panel.position.set(0, 12.5, 0);
  const screenMat = new MeshBasicMaterial({ map: screenTexture(), toneMapped: false });
  const screen = new Mesh(new PlaneGeometry(24.6, 13.6), screenMat);
  screen.position.set(0, 12.5, 0.47);
  g.add(base, neck, panel, screen);
  g.userData.screenMat = screenMat;
  return g;
}

function makeLamp() {
  const g = new Group();
  const dark = std(0x1c2027, 0.4, 0.5);
  const base = mesh(new CylinderGeometry(2.6, 2.9, 0.7, 32), dark, { cast: false });
  base.position.y = 0.35;
  g.add(base);
  const joint = (x, y, z, r = 0.7) => {
    const j = mesh(new SphereGeometry(r, 14, 10), dark, { cast: false });
    j.position.set(x, y, z);
    g.add(j);
    return new Vector3(x, y, z);
  };
  const seg = (a, b, r = 0.2) => {
    const dir = new Vector3().subVectors(b, a);
    const len = dir.length();
    const m = mesh(new CylinderGeometry(r, r, len, 10), dark, { cast: false });
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    g.add(m);
  };
  const p0 = new Vector3(0, 0.7, 0);
  const p1 = joint(0, 15, -1.5);
  const p2 = joint(8.5, 28.5, -4.5, 0.62);
  seg(p0, p1, 0.4);
  seg(p1, p2, 0.32);
  // head
  const head = new Group();
  head.position.copy(p2);
  head.lookAt(new Vector3(21, 0, 4.5).sub(new Vector3(0, 0, 0)).add(new Vector3(-0, 0, 0)));
  const shade = mesh(new CylinderGeometry(0.9, 3.6, 3.6, 40, 1, true), new MeshStandardMaterial({ color: 0xf2b23c, roughness: 0.35, metalness: 0.3, side: DoubleSide }), { cast: false });
  shade.rotation.x = Math.PI / 2; // axis along +z (head local forward)
  shade.position.z = 1.5;
  const bulb = mesh(new SphereGeometry(1.0, 20, 14), new MeshBasicMaterial({ color: 0xfff1cf, toneMapped: false }), { cast: false });
  bulb.position.z = 2.4;
  const bloom = new Sprite(new SpriteMaterial({ map: glowTexture({ color: '255,214,140' }), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
  bloom.scale.set(9, 9, 1);
  bloom.position.z = 2.6;
  head.add(shade, bulb, bloom);
  g.add(head);
  g.userData.head = head;
  g.userData.headPos = p2.clone();
  return g;
}

/* ------------------------------------------------------------------ desk assembly */

/**
 * Builds the desk environment around the track. Returns { group, update(t), lights }.
 * `bounds` is the track bounding box; props are arranged around / inside the circuit.
 */
export function buildDesk(track, { quality = 'high', renderer = null } = {}) {
  const aniso = renderer ? Math.min(16, renderer.capabilities.getMaxAnisotropy()) : 8;
  const hi = quality === 'high';
  const group = new Group();
  group.name = 'desk';
  const updaters = [];

  const DESK_W = 108;
  const DESK_D = 56;
  const MAT_W = 78;
  const MAT_D = 33;
  const MAT_T = 0.12;

  // --- desk top
  const wood = woodTexture({ size: hi ? 1024 : 512, aniso });
  wood.repeat.set(DESK_W / 26, DESK_D / 26);
  const deskMat = new MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0.0 });
  const desk = mesh(rb(DESK_W, 3.0, DESK_D, 0.7, 4), deskMat, { cast: false });
  desk.position.set(0, -1.5, 0);
  group.add(desk);

  // --- cutting mat
  const matTex = cuttingMatTexture(MAT_W, MAT_D, { pxPerUnit: hi ? 32 : 20, aniso });
  const matMat = new MeshStandardMaterial({ map: matTex, roughness: 0.78, metalness: 0.0 });
  const mat = mesh(rb(MAT_W, MAT_T * 2, MAT_D, 0.1, 2), matMat, { cast: false });
  mat.position.set(0, 0, 0);
  group.add(mat);

  const base = MAT_T; // surface height props stand on when on the mat

  // --- props inside the circuit (mirrored circuits are an exact z-reflection, so the props mirror with them)
  const interior = new Group(); // mirrored (scale.z = -1) together with the circuit
  interior.scale.z = track.layout.mirror ? -1 : 1;
  group.add(interior);
  const place = (obj, x, y, z, ry = 0) => {
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    group.add(obj);
    return obj;
  };
  const placeIn = (obj, x, y, z, ry = 0) => {
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    interior.add(obj);
    return obj;
  };
  placeIn(makeNotebook(), -1.5, base, 0.8, -0.14);
  placeIn(makeRuler(), 13.5, base, 5.6, 0.06);
  placeIn(makePencil(), 14.2, base + 0.1, 3.4, -0.5);
  const mug = placeIn(makeMug(0xf4f1ea), 13.8, base, -1.2, 0.5);
  updaters.push(mug.userData.update);
  placeIn(makeSticky(0xffe66b, 1), -13.2, base, 4.4, 0.35);
  placeIn(makeSticky(0xff9ebd, 2), -11.0, base, 2.4, -0.2).position.y += 0.28;
  placeIn(makeSticky(0x8fe3a8, 3), -14.4, base, -0.8, -0.5);
  placeIn(makePaperclip(), 6.5, base, 6.0, 0.3);
  placeIn(makePaperclip(0xe9b949), 8.0, base, 5.2, 2.2);
  placeIn(makePaperclip(0xd94b4b), -7.8, base, -3.2, 1.1);
  placeIn(makeDie(), 16.5, base, 2.2, 0.7);
  placeIn(makeDie(), 17.9, base, 3.0, 0.2);

  // --- front of the desk: keyboard + mouse + phone
  place(makeKeyboard(), -9, 0, 23.2, 0.04);
  place(makeMouse(), 6.4, 0, 22.8, 0.2);
  place(makePhone(), -31.5, 0, 21.5, 0.5);
  place(makeHeadphones(), 30, 0, 22, -0.4);

  // --- back: monitor, plant, pen cup, books
  place(makeMonitor(), 6, 0, -24, 0);
  place(makePlant(), 36, base, -19.5, 0.4);
  place(makePenCup(), 31.5, base, -18, 0);
  place(makeBookStack([
    { w: 11.5, d: 8.6, h: 1.3, color: 0x2f6f9f },
    { w: 10.8, d: 8.2, h: 1.0, color: 0xc9483b },
    { w: 10.2, d: 7.6, h: 1.5, color: 0x3f8f5a },
    { w: 9.6, d: 7.2, h: 0.9, color: 0xf0b030 },
  ], 4), -43, base - 0.05, -9, 0.35);
  place(makeBookStack([
    { w: 9.5, d: 7, h: 1.2, color: 0x6a4c93 },
    { w: 9.0, d: 6.8, h: 1.0, color: 0xe07a5f },
  ], 9), 43.5, 0, 6, -0.3);

  // --- lamp (key light)
  const lamp = makeLamp();
  lamp.position.set(-45, 0, -21);
  lamp.rotation.y = 0;
  group.add(lamp);

  // --- lights
  const head = lamp.userData.head;
  lamp.updateMatrixWorld(true);
  const headWorld = new Vector3();
  head.getWorldPosition(headWorld);
  const target = new Object3D();
  target.position.set(2, 0, 2);
  group.add(target);

  const key = new SpotLight(0xffe2bd, 165, 0, 1.05, 0.55, 1.2);
  key.position.copy(headWorld).add(new Vector3(0, -1.2, 0));
  key.target = target;
  key.castShadow = true;
  const smap = hi ? 4096 : 2048;
  key.shadow.mapSize.set(smap, smap);
  key.shadow.camera.near = 8;
  key.shadow.camera.far = 150;
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 3;
  group.add(key);

  const fill = new HemisphereLight(0xaac7ff, 0x6a4a30, 1.0);
  group.add(fill);
  const rim = new DirectionalLight(0x9fc0ff, 1.25);
  rim.position.set(30, 22, -40);
  group.add(rim);
  const monitorGlow = new SpotLight(0x6aa6ff, 110, 0, 0.9, 0.9, 1.2);
  monitorGlow.position.set(6, 12.5, -22.5);
  monitorGlow.target.position.set(6, 0, 4);
  group.add(monitorGlow, monitorGlow.target);

  return {
    group,
    lights: { key, fill, rim, monitorGlow },
    size: { w: DESK_W, d: DESK_D, matW: MAT_W, matD: MAT_D },
    setMirror(on) {
      interior.scale.z = on ? -1 : 1;
    },
    update(t) {
      for (const u of updaters) u(t);
    },
  };
}
