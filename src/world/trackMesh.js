import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  Color,
  AdditiveBlending,
  DoubleSide,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK } from '../config.js';
import { makeFrame } from '../track/piece.js';
import { bannerTexture, glowTexture, numberTexture, signTexture } from '../render/textures.js';

const GAUGE = TRACK.GAUGE;
const RAIL_R = 0.07;
const SPINE_DROP = 0.4;

/* ------------------------------------------------------------------ geometry helpers */

function circleProfile(ra, rb, segs) {
  const prof = [];
  for (let k = 0; k < segs; k++) {
    const phi = (k / segs) * Math.PI * 2;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const nl = Math.hypot(c / ra, s / rb) || 1;
    prof.push({ a: ra * c, b: rb * s, na: c / ra / nl, nb: s / rb / nl });
  }
  return prof;
}

/** Sweep a closed 2D profile (in the track's right/up plane) along the whole closed piece. */
function sweep(piece, profile, { offR = 0, offU = 0, stride = 1 } = {}) {
  const n = piece.n;
  const rings = Math.floor(n / stride);
  const m = profile.length;
  const pos = new Float32Array(rings * m * 3);
  const nor = new Float32Array(rings * m * 3);
  const uv = new Float32Array(rings * m * 2);
  for (let r = 0; r < rings; r++) {
    const i = r * stride;
    const px = piece.pos[3 * i];
    const py = piece.pos[3 * i + 1];
    const pz = piece.pos[3 * i + 2];
    const rx = piece.right[3 * i];
    const ry = piece.right[3 * i + 1];
    const rz = piece.right[3 * i + 2];
    const ux = piece.up[3 * i];
    const uy = piece.up[3 * i + 1];
    const uz = piece.up[3 * i + 2];
    for (let k = 0; k < m; k++) {
      const { a, b, na, nb } = profile[k];
      const rr = offR + a;
      const uu = offU + b;
      const o = (r * m + k) * 3;
      pos[o] = px + rx * rr + ux * uu;
      pos[o + 1] = py + ry * rr + uy * uu;
      pos[o + 2] = pz + rz * rr + uz * uu;
      nor[o] = rx * na + ux * nb;
      nor[o + 1] = ry * na + uy * nb;
      nor[o + 2] = rz * na + uz * nb;
      const u = (r * m + k) * 2;
      uv[u] = i * piece.ds;
      uv[u + 1] = k / m;
    }
  }
  const idx = [];
  for (let r = 0; r < rings; r++) {
    const r2 = (r + 1) % rings;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const a = r * m + k;
      const b = r * m + k2;
      const c = r2 * m + k;
      const d = r2 * m + k2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const _up = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _m = new Matrix4();
const _s = new Vector3(1, 1, 1);

function cylinderBetween(a, b, radius, segs = 6, radiusB = radius) {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new CylinderGeometry(radiusB, radius, len, segs, 1, false);
  _q.setFromUnitVectors(_up, dir.normalize());
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  _m.compose(mid, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

function boxAt(w, h, d, pos, quat) {
  const g = new BoxGeometry(w, h, d);
  _m.compose(pos, quat ?? _q.identity(), _s);
  g.applyMatrix4(_m);
  return g;
}

/* ------------------------------------------------------------------ supports */

function planSupports(piece, { spacing = 3.3, minTop = 0.3 } = {}) {
  const out = [];
  const fr = makeFrame();
  const L = piece.length;
  for (let s = spacing * 0.5; s < L; s += spacing) {
    piece.frame(s, fr);
    const top = fr.pos.y + fr.up.y * -SPINE_DROP - 0.2;
    if (top < minTop) continue;
    // skip when part of the track (not adjacent to this sample) lies directly underneath
    let blocked = false;
    const x = fr.pos.x + fr.up.x * -SPINE_DROP;
    const z = fr.pos.z + fr.up.z * -SPINE_DROP;
    for (let i = 0; i < piece.n; i += 2) {
      const ds = Math.abs(i * piece.ds - s);
      const wrap = Math.min(ds, L - ds);
      if (wrap < 6) continue;
      const dx = piece.pos[3 * i] - x;
      const dz = piece.pos[3 * i + 2] - z;
      if (dx * dx + dz * dz < 1.1 * 1.1 && piece.pos[3 * i + 1] < top + 0.2) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    out.push({ s, x, z, top, tilt: fr });
  }
  return out;
}

function buildSupportGeometry(piece, supports, plan, helixCentre, helixRange) {
  const parts = [];
  const a = new Vector3();
  const b = new Vector3();
  const fr = makeFrame();
  for (const sp of supports) {
    const h = sp.top;
    const r = Math.min(0.2, 0.1 + h * 0.012);
    // column
    const col = new CylinderGeometry(r * 0.85, r, h, 10, 1);
    col.translate(sp.x, h / 2, sp.z);
    parts.push(col);
    // base plate
    const base = new CylinderGeometry(r * 2.4, r * 2.6, 0.07, 16);
    base.translate(sp.x, 0.035, sp.z);
    parts.push(base);
    // cradle under the spine
    piece.frame(sp.s, fr);
    a.copy(fr.pos).addScaledVector(fr.up, -SPINE_DROP - 0.16);
    const cr = boxAt(0.5, 0.1, 0.34, a.clone(), new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(fr.right, fr.up, fr.tan.clone().negate())));
    parts.push(cr);
    // short stub connecting the cradle to the column top
    if (Math.abs(a.y - h) > 0.02 || Math.hypot(a.x - sp.x, a.z - sp.z) > 0.02) {
      b.set(sp.x, h, sp.z);
      parts.push(cylinderBetween(b, a, r * 0.7, 8));
    }
    // collars on tall columns
    for (let y = 2.2; y < h - 0.6; y += 2.2) {
      const c = new CylinderGeometry(r * 1.35, r * 1.35, 0.12, 12);
      c.translate(sp.x, y, sp.z);
      parts.push(c);
    }
  }
  // lattice bracing between neighbouring tall columns
  for (let i = 0; i + 1 < supports.length; i++) {
    const p = supports[i];
    const q = supports[i + 1];
    if (q.s - p.s > 4.2) continue;
    const hmin = Math.min(p.top, q.top);
    if (hmin < 3.2) continue;
    const dist = Math.hypot(p.x - q.x, p.z - q.z);
    if (dist > 4.5) continue;
    for (let y = 0.5; y + 2.1 < hmin - 0.4; y += 2.2) {
      a.set(p.x, y, p.z);
      b.set(q.x, y + 2.1, q.z);
      parts.push(cylinderBetween(a, b, 0.045, 5));
      a.set(q.x, y, q.z);
      b.set(p.x, y + 2.1, p.z);
      parts.push(cylinderBetween(a, b, 0.045, 5));
    }
  }
  // helix hub: central tower with arms reaching the track
  if (helixCentre) {
    const [s0, s1] = helixRange;
    let maxTop = 0;
    for (let s = s0; s <= s1; s += 3.6) {
      piece.frame(s, fr);
      maxTop = Math.max(maxTop, fr.pos.y);
    }
    const tower = new CylinderGeometry(0.34, 0.46, maxTop + 0.2, 14);
    tower.translate(helixCentre.x, (maxTop + 0.2) / 2, helixCentre.z);
    parts.push(tower);
    const base = new CylinderGeometry(1.1, 1.2, 0.1, 24);
    base.translate(helixCentre.x, 0.05, helixCentre.z);
    parts.push(base);
    for (let s = s0 + 1.5; s <= s1; s += 5.2) {
      piece.frame(s, fr);
      const y = fr.pos.y - SPINE_DROP - 0.12;
      a.set(helixCentre.x, y, helixCentre.z);
      b.copy(fr.pos).addScaledVector(fr.up, -SPINE_DROP - 0.12);
      parts.push(cylinderBetween(a, b, 0.055, 6));
      const collar = new CylinderGeometry(0.46, 0.46, 0.08, 14);
      collar.translate(helixCentre.x, y, helixCentre.z);
      parts.push(collar);
    }
  }
  return parts.length ? mergeGeometries(parts.map((g) => stripToBasic(g))) : null;
}

function stripToBasic(g) {
  const out = g.index ? g : g.toNonIndexed();
  for (const name of Object.keys(out.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name);
  }
  return out;
}

/* ------------------------------------------------------------------ main builder */

export function buildTrackMeshes(track, { quality = 'high' } = {}) {
  const piece = track.piece;
  const group = new Group();
  group.name = 'track';
  const fr = makeFrame();
  const mats = {
    rail: new MeshStandardMaterial({ color: 0xcfd4db, metalness: 0.8, roughness: 0.36 }),
    spine: new MeshStandardMaterial({ color: 0xe5382c, metalness: 0.1, roughness: 0.36 }),
    tie: new MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.2, roughness: 0.6 }),
    support: new MeshStandardMaterial({ color: 0xf2efe8, metalness: 0.05, roughness: 0.5 }),
    platform: new MeshStandardMaterial({ color: 0x6f7c8d, metalness: 0.05, roughness: 0.82 }),
    accent: new MeshStandardMaterial({ color: 0xffc933, metalness: 0.1, roughness: 0.5 }),
    glowBlue: new MeshBasicMaterial({ color: 0x59d2ff }),
  };

  // --- rails + spine
  const railProfile = circleProfile(RAIL_R, RAIL_R, 8);
  const railGeo = mergeGeometries([
    sweep(piece, railProfile, { offR: -GAUGE / 2 }),
    sweep(piece, railProfile, { offR: GAUGE / 2 }),
  ]);
  const rails = new Mesh(railGeo, mats.rail);
  rails.castShadow = true;
  rails.receiveShadow = false;
  group.add(rails);

  const spineGeo = sweep(piece, circleProfile(0.15, 0.13, 12), { offU: -SPINE_DROP, stride: 1 });
  const spine = new Mesh(spineGeo, mats.spine);
  spine.castShadow = true;
  spine.receiveShadow = true;
  group.add(spine);

  // --- ties (instanced boxes across the rails)
  const tieSpacing = 0.62;
  const tieCount = Math.floor(piece.length / tieSpacing);
  const ties = new InstancedMesh(new BoxGeometry(1, 1, 1), mats.tie, tieCount);
  const basis = new Matrix4();
  const tq = new Quaternion();
  const tp = new Vector3();
  const ts = new Vector3(GAUGE + 0.34, 0.055, 0.15);
  const tn = new Vector3();
  for (let i = 0; i < tieCount; i++) {
    piece.frame(i * tieSpacing + 0.1, fr);
    tn.copy(fr.tan).negate();
    basis.makeBasis(fr.right, fr.up, tn);
    tq.setFromRotationMatrix(basis);
    tp.copy(fr.pos).addScaledVector(fr.up, -0.13);
    _m.compose(tp, tq, ts);
    ties.setMatrixAt(i, _m);
  }
  ties.castShadow = true;
  ties.receiveShadow = true;
  group.add(ties);

  // --- supports
  const supports = planSupports(piece, { spacing: 3.3 });
  const helix = track.plan.byId.helix;
  const helixS0 = track.anchors.helix ?? 0;
  const helixLen = helix.p1 - helix.p0;
  const supGeo = buildSupportGeometry(piece, supports.filter((sp) => !(sp.s > helixS0 - 1 && sp.s < helixS0 + helixLen + 1)), track.plan, helix.centre, [helixS0 + 0.5, helixS0 + helixLen - 0.5]);
  if (supGeo) {
    const sup = new Mesh(supGeo, mats.support);
    sup.castShadow = true;
    sup.receiveShadow = true;
    group.add(sup);
  }

  // --- launch strip LEDs
  const launch = piece.zones.find((z) => z.type === 'launch');
  const leds = { mesh: null, count: 0, s0: 0, spacing: 0.55 };
  if (launch) {
    const count = Math.floor((launch.s1 - launch.s0) / leds.spacing);
    const mesh = new InstancedMesh(new BoxGeometry(0.1, 0.05, 0.26), new MeshBasicMaterial({ color: 0xffffff }), count);
    for (let i = 0; i < count; i++) {
      piece.frame(launch.s0 + i * leds.spacing, fr);
      tn.copy(fr.tan).negate();
      basis.makeBasis(fr.right, fr.up, tn);
      tq.setFromRotationMatrix(basis);
      tp.copy(fr.pos).addScaledVector(fr.up, -0.1);
      _m.compose(tp, tq, new Vector3(1, 1, 1));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, new Color(0x143a52));
    }
    mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    leds.mesh = mesh;
    leds.count = count;
    leds.s0 = launch.s0;
    group.add(mesh);
  }

  // --- station: side platforms, roof, finish gantry
  const station = new Group();
  const platParts = [];
  const sA = -7;
  const sB = 8;
  for (const side of [-1, 1]) {
    // platform decks follow the (straight) station; build from a few segments
    const steps = 9;
    for (let k = 0; k < steps; k++) {
      const s = sA + ((k + 0.5) * (sB - sA)) / steps;
      piece.frame(s + 0 > 0 ? s : s + piece.length, fr);
      const lat = side * (GAUGE / 2 + 1.05);
      const p = fr.pos.clone().addScaledVector(fr.right, lat);
      p.y = 0.34;
      tn.copy(fr.tan).negate();
      basis.makeBasis(fr.right, fr.up, tn);
      const quat = new Quaternion().setFromRotationMatrix(basis);
      platParts.push(boxAt(1.5, 0.68, (sB - sA) / steps + 0.02, p, quat));
    }
  }
  const plat = new Mesh(mergeGeometries(platParts.map(stripToBasic)), mats.platform);
  plat.castShadow = true;
  plat.receiveShadow = true;
  station.add(plat);
  // yellow safety edge
  const edgeParts = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const s = sA + ((k + 0.5) * (sB - sA)) / 9;
      piece.frame(s > 0 ? s : s + piece.length, fr);
      const lat = side * (GAUGE / 2 + 0.42);
      const p = fr.pos.clone().addScaledVector(fr.right, lat);
      p.y = 0.69;
      tn.copy(fr.tan).negate();
      basis.makeBasis(fr.right, fr.up, tn);
      edgeParts.push(boxAt(0.09, 0.012, (sB - sA) / 9 + 0.02, p, new Quaternion().setFromRotationMatrix(basis)));
    }
  }
  station.add(new Mesh(mergeGeometries(edgeParts.map(stripToBasic)), mats.accent));
  // canopy
  {
    piece.frame(piece.length - 4, fr);
    const roofC = fr.pos.clone();
    piece.frame(4, fr);
    roofC.add(fr.pos).multiplyScalar(0.5);
    tn.copy(fr.tan).negate();
    basis.makeBasis(fr.right, fr.up, tn);
    const quat = new Quaternion().setFromRotationMatrix(basis);
    const roofMat = new MeshStandardMaterial({ color: 0x4f8fc0, roughness: 0.95, metalness: 0.0, transparent: true, opacity: 0.42, envMapIntensity: 0.2 });
    const roof = new Mesh(new BoxGeometry(5.0, 0.06, 8), roofMat);
    roof.position.set(roofC.x, 3.25, roofC.z);
    roof.quaternion.copy(quat);
    roof.castShadow = false;
    station.add(roof);
    const postParts = [];
    for (const sd of [-1, 1]) {
      for (const along of [-4.2, 4.2]) {
        piece.frame(along > 0 ? along : piece.length + along, fr);
        const p = fr.pos.clone().addScaledVector(fr.right, sd * 2.3);
        postParts.push(cylinderBetween(new Vector3(p.x, 0, p.z), new Vector3(p.x, 3.25, p.z), 0.09, 8));
      }
    }
    const posts = new Mesh(mergeGeometries(postParts.map(stripToBasic)), mats.support);
    posts.castShadow = true;
    station.add(posts);
  }
  // finish gantry
  {
    piece.frame(0.0, fr);
    const gantry = new Group();
    gantry.position.copy(fr.pos);
    tn.copy(fr.tan).negate();
    basis.makeBasis(fr.right, fr.up, tn);
    gantry.quaternion.setFromRotationMatrix(basis);
    for (const sd of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(0.09, 0.11, 3.9, 8), mats.support);
      post.position.set(sd * 2.0, 1.45, 0);
      post.castShadow = true;
      gantry.add(post);
    }
    const bannerMat = new MeshBasicMaterial({ map: bannerTexture('START · FINISH'), toneMapped: true });
    const banner = new Mesh(new PlaneGeometry(4.0, 0.98), bannerMat);
    banner.position.set(0, 3.35, 0.02);
    const bannerBack = new Mesh(new PlaneGeometry(4.0, 0.98), bannerMat);
    bannerBack.rotation.y = Math.PI;
    bannerBack.position.set(0, 3.35, -0.02);
    gantry.add(banner, bannerBack);
    const bar = new Mesh(new BoxGeometry(4.2, 0.1, 0.14), mats.support);
    bar.position.set(0, 3.9, 0);
    gantry.add(bar);
    station.add(gantry);
  }
  group.add(station);

  // --- checkpoint gates
  const gateMat = new MeshStandardMaterial({ color: 0xffffff, emissive: 0x2cc7ff, emissiveIntensity: 1.2, roughness: 0.4 });
  const gates = [];
  track.checkpoints.forEach((s, i) => {
    piece.frame(s, fr);
    const g = new Group();
    g.position.copy(fr.pos);
    tn.copy(fr.tan).negate();
    basis.makeBasis(fr.right, fr.up, tn);
    g.quaternion.setFromRotationMatrix(basis);
    const half = GAUGE / 2 + 0.75;
    for (const sd of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(0.045, 0.045, 1.7, 6), mats.support);
      post.position.set(sd * half, 0.78, 0);
      g.add(post);
    }
    const top = new Mesh(new BoxGeometry(half * 2, 0.08, 0.08), gateMat);
    top.position.set(0, 1.65, 0);
    g.add(top);
    const tag = new Sprite(new SpriteMaterial({ map: numberTexture(String(i + 1), { color: '#ffffff', bg: '#1b75bc' }), depthWrite: false }));
    tag.scale.set(0.7, 0.7, 1);
    tag.position.set(0, 2.15, 0);
    g.add(tag);
    group.add(g);
    gates.push(g);
  });

  // --- advisory signs next to heavy braking zones (speed limit ahead of tight corners)
  const signs = buildCornerSigns(track, piece, fr, group);

  return { group, mats, leds, gates, signs, supports, stationGroup: station };
}

/* ------------------------------------------------------------------ pickups */

export function buildPickups(track) {
  const piece = track.piece;
  const fr = makeFrame();
  const group = new Group();
  const coreGeo = new CapsuleGeometry(0.15, 0.32, 4, 12);
  const ringGeo = new TorusGeometry(0.44, 0.032, 8, 28);
  const coreMat = new MeshStandardMaterial({ color: 0xb6ff3c, emissive: 0x7dff1a, emissiveIntensity: 1.6, roughness: 0.3 });
  const ringMat = new MeshBasicMaterial({ color: 0xe9ffb0 });
  const glowMat = new SpriteMaterial({ map: glowTexture({ color: '170,255,60' }), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
  const items = [];
  track.pickups.forEach((s, i) => {
    piece.frame(s, fr);
    const g = new Group();
    g.position.copy(fr.pos).addScaledVector(fr.up, 0.78);
    const core = new Mesh(coreGeo, coreMat);
    core.rotation.z = Math.PI / 2;
    const ring = new Mesh(ringGeo, ringMat);
    const glow = new Sprite(glowMat);
    glow.scale.set(1.5, 1.5, 1);
    g.add(core, ring, glow);
    g.userData = { ring, core, base: g.position.clone(), up: fr.up.clone(), phase: i * 1.7, appear: 1 };
    group.add(g);
    items.push(g);
  });
  return {
    group,
    items,
    update(time, collected, dt) {
      items.forEach((g, i) => {
        const u = g.userData;
        const target = collected.has(i) ? 0 : 1;
        u.appear += (target - u.appear) * Math.min(1, dt * (target ? 3 : 14));
        const sc = Math.max(0.0001, u.appear);
        g.scale.setScalar(sc);
        g.visible = u.appear > 0.02;
        g.position.copy(u.base).addScaledVector(u.up, Math.sin(time * 2.4 + u.phase) * 0.08);
        u.ring.rotation.x = time * 1.8 + u.phase;
        u.ring.rotation.y = time * 1.1;
        u.core.rotation.y = time * 2.2;
      });
    },
  };
}

/* ------------------------------------------------------------------ signs */

function buildCornerSigns(track, piece, fr, group) {
  // Place a yellow speed-advisory sign before each cornering-limited section.
  const signs = [];
  const lim = piece.vLim;
  const n = piece.n;
  const ds = piece.ds;
  const threshold = 12.5;
  let i = 0;
  const segs = [];
  while (i < n) {
    if (lim[i] < threshold && !piece.inv[i]) {
      let j = i;
      let minV = lim[i];
      while (j < n && lim[j] < threshold && !piece.inv[j]) {
        minV = Math.min(minV, lim[j]);
        j++;
      }
      if ((j - i) * ds > 4) segs.push({ i0: i, i1: j, minV });
      i = j;
    } else i++;
  }
  const geo = new PlaneGeometry(0.95, 0.95);
  const postGeo = new CylinderGeometry(0.035, 0.035, 1, 6);
  const postMat = new MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.4 });
  for (const sg of segs) {
    const kmh = Math.round((sg.minV * 0.97 * 12) / 5) * 5;
    const s = sg.i0 * ds - 6.5;
    piece.frame(((s % piece.length) + piece.length) % piece.length, fr);
    const side = 1;
    const p = fr.pos.clone().addScaledVector(fr.right, side * (GAUGE / 2 + 1.55));
    p.y = Math.max(0.6, fr.pos.y - 0.2);
    const sign = new Mesh(geo, new MeshStandardMaterial({ map: signTexture(String(kmh), 'KM/H', { bg: '#ffcc1f' }), roughness: 0.55, side: DoubleSide }));
    sign.position.set(p.x, p.y + 1.45, p.z);
    sign.lookAt(sign.position.clone().sub(fr.tan));
    sign.castShadow = true;
    const post = new Mesh(postGeo, postMat);
    post.scale.y = 1.5;
    post.position.set(p.x, p.y + 0.75, p.z);
    group.add(sign, post);
    signs.push({ s, kmh });
  }
  return signs;
}
