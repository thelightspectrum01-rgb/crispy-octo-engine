// Stone shatter: Voronoi fracture of a piece's convex volume approximation into chunks,
// then rigid-body physics (gravity, tumbling, ground/step contacts with friction,
// chunk-chunk and chunk-piece collisions, sleeping) until the rubble crumbles away.
import * as THREE from 'three';
import {groundHeight} from './board.js';
import {REFLECT_LAYER} from './reflection.js';

const EPS = 1e-6;
const tmpV = new THREE.Vector3(), tmpR = new THREE.Vector3(), tmpW = new THREE.Vector3();
const tmpQ = new THREE.Quaternion(), tmpN = new THREE.Vector3(), tmpT = new THREE.Vector3();

// ---------- Convex polyhedron clipping ----------

function frustumPoly(v, sides = 10) {
  const bottom = [], top = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    bottom.push(new THREE.Vector3(Math.sin(a) * v.r0, v.y0, Math.cos(a) * v.r0));
    top.push(new THREE.Vector3(Math.sin(a) * v.r1, v.y1, Math.cos(a) * v.r1));
  }
  const faces = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faces.push({verts: [bottom[i], bottom[j], top[j], top[i]], outer: true});
  }
  faces.push({verts: [...bottom].reverse(), outer: v.y0 < 0.01});
  faces.push({verts: [...top], outer: v.top});
  return faces;
}

function boxPoly(v) {
  const [cx, cy, cz] = v.center, [sx, sy, sz] = v.size.map(s => s / 2);
  const P = (x, y, z) => new THREE.Vector3(cx + x * sx, cy + y * sy, cz + z * sz);
  const c = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  return quads.map(q => ({verts: q.map(i => c[i].clone()), outer: true}));
}

// Keeps the half-space n·p <= d; the cut becomes a new (inner, fresh-fracture) face.
function clip(faces, n, d) {
  const out = [], cap = [];
  for (const f of faces) {
    const vs = f.verts, res = [];
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      const da = n.dot(a) - d, db = n.dot(b) - d;
      if (da <= EPS) res.push(a);
      if (Math.abs(da) <= EPS) cap.push(a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        const p = a.clone().lerp(b, da / (da - db));
        res.push(p);
        cap.push(p);
      }
    }
    if (res.length >= 3) out.push({verts: res, outer: f.outer});
  }
  if (cap.length >= 3) {
    const unique = [];
    for (const p of cap) if (!unique.some(q => q.distanceToSquared(p) < 1e-10)) unique.push(p);
    if (unique.length >= 3) {
      const center = new THREE.Vector3();
      unique.forEach(p => center.add(p));
      center.divideScalar(unique.length);
      const u = new THREE.Vector3().subVectors(unique[0], center).normalize();
      const w = new THREE.Vector3().crossVectors(n, u);
      unique.sort((a, b) => {
        const pa = tmpV.subVectors(a, center), aa = Math.atan2(pa.dot(w), pa.dot(u));
        const pb = tmpR.subVectors(b, center), ab = Math.atan2(pb.dot(w), pb.dot(u));
        return aa - ab;
      });
      out.push({verts: unique, outer: false});
    }
  }
  return out;
}

function polyVolumeAndCentroid(faces) {
  // Tetrahedra fan from an interior reference point.
  const ref = new THREE.Vector3();
  let count = 0;
  for (const f of faces) for (const v of f.verts) { ref.add(v); count++; }
  ref.divideScalar(count);
  let vol = 0;
  const centroid = new THREE.Vector3();
  for (const f of faces) {
    for (let i = 1; i < f.verts.length - 1; i++) {
      const a = f.verts[0], b = f.verts[i], c = f.verts[i + 1];
      const v = Math.abs(tmpV.subVectors(a, ref).dot(tmpR.subVectors(b, ref).cross(tmpW.subVectors(c, ref)))) / 6;
      vol += v;
      centroid.x += v * (ref.x + a.x + b.x + c.x) / 4;
      centroid.y += v * (ref.y + a.y + b.y + c.y) / 4;
      centroid.z += v * (ref.z + a.z + b.z + c.z) / 4;
    }
  }
  if (vol > 0) centroid.divideScalar(vol); else centroid.copy(ref);
  return {vol, centroid};
}

function volumeSize(v) {
  if (v.type === 'box') return v.size[0] * v.size[1] * v.size[2];
  return Math.PI * (v.y1 - v.y0) * (v.r0 * v.r0 + v.r0 * v.r1 + v.r1 * v.r1) / 3;
}

function sampleIn(v) {
  if (v.type === 'box') {
    return new THREE.Vector3(v.center[0] + (Math.random() - 0.5) * v.size[0] * 0.9, v.center[1] + (Math.random() - 0.5) * v.size[1] * 0.9,
      v.center[2] + (Math.random() - 0.5) * v.size[2] * 0.9);
  }
  for (let k = 0; k < 30; k++) {
    const y = v.y0 + Math.random() * (v.y1 - v.y0);
    const r = (v.r0 + (v.r1 - v.r0) * ((y - v.y0) / (v.y1 - v.y0))) * 0.9;
    const x = (Math.random() * 2 - 1) * r, z = (Math.random() * 2 - 1) * r;
    if (x * x + z * z <= r * r) return new THREE.Vector3(x, y, z);
  }
  return new THREE.Vector3(0, (v.y0 + v.y1) / 2, 0);
}

// Builds chunk geometries (in piece-local space, centred on each chunk's centroid).
// Each seed's Voronoi cell is intersected with every convex volume of the piece, and the
// pieces of one cell are welded into a single rigid chunk, so the chunks tile the whole piece.
export function fracture(model, count, localImpact) {
  const volumes = model.volumes.map((v, i, all) => ({...v, top: v.type === 'frustum' && i === all.length - 1}));
  const total = volumes.reduce((s, v) => s + volumeSize(v), 0);
  const seeds = [];
  volumes.forEach(v => {
    const n = Math.max(1, Math.round(count * volumeSize(v) / total));
    let placed = 0, guard = 0;
    while (placed < n && guard++ < n * 40) {
      const p = sampleIn(v);
      const near = localImpact ? Math.exp(-p.distanceToSquared(localImpact) / 0.05) : 0;
      if (Math.random() > 0.3 + 0.7 * near && guard < n * 30) continue;
      seeds.push(p);
      placed++;
    }
  });
  const chunks = [];
  const n = new THREE.Vector3(), mid = new THREE.Vector3();
  for (const seed of seeds) {
    const parts = [];
    for (const v of volumes) {
      let faces = v.type === 'box' ? boxPoly(v) : frustumPoly(v);
      for (const other of seeds) {
        if (other === seed) continue;
        n.subVectors(other, seed);
        const len = n.length();
        if (len < 1e-5) continue;
        n.divideScalar(len);
        mid.addVectors(other, seed).multiplyScalar(0.5);
        faces = clip(faces, n, n.dot(mid));
        if (faces.length < 4) break;
      }
      if (faces.length < 4) continue;
      const {vol, centroid} = polyVolumeAndCentroid(faces);
      if (vol > 1e-6) parts.push({faces, centroid, vol});
    }
    const vol = parts.reduce((s, p) => s + p.vol, 0);
    if (vol < 2e-5) continue;
    const centroid = new THREE.Vector3();
    for (const p of parts) centroid.addScaledVector(p.centroid, p.vol / vol);
    chunks.push(buildChunk(parts, centroid, vol));
  }
  return chunks;
}

// Group 0 is the polished outer skin, group 1 the fresh fracture faces (a matte material).
function buildChunk(parts, centroid, vol) {
  const lists = [0, 1].map(() => ({positions: [], normals: [], uvs: [], colors: []}));
  const hull = [];
  const shadeOuter = 0.85 + Math.random() * 0.15;
  const normal = new THREE.Vector3(), center = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const part of parts) for (const f of part.faces) {
    const vs = f.verts;
    // Newell normal, flipped outward if needed.
    normal.set(0, 0, 0);
    center.set(0, 0, 0);
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      normal.x += (a.y - b.y) * (a.z + b.z);
      normal.y += (a.z - b.z) * (a.x + b.x);
      normal.z += (a.x - b.x) * (a.y + b.y);
      center.add(a);
    }
    center.divideScalar(vs.length);
    if (normal.lengthSq() < 1e-14) continue;
    normal.normalize();
    let ordered = vs;
    if (normal.dot(e1.subVectors(center, part.centroid)) < 0) { normal.negate(); ordered = [...vs].reverse(); }
    const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
    const shade = f.outer ? shadeOuter : 1.25 + Math.random() * 0.1;
    const {positions, normals, uvs, colors} = lists[f.outer ? 0 : 1];
    for (let i = 1; i < ordered.length - 1; i++) {
      for (const p of [ordered[0], ordered[i], ordered[i + 1]]) {
        positions.push(p.x - centroid.x, p.y - centroid.y, p.z - centroid.z);
        normals.push(normal.x, normal.y, normal.z);
        if (ax >= ay && ax >= az) uvs.push(p.z * 1.4, p.y * 1.4);
        else if (ay >= az) uvs.push(p.x * 1.4, p.z * 1.4);
        else uvs.push(p.x * 1.4, p.y * 1.4);
        colors.push(shade, shade, shade);
      }
    }
    for (const p of vs) {
      e2.subVectors(p, centroid);
      if (!hull.some(h => h.distanceToSquared(e2) < 1e-8)) hull.push(e2.clone());
    }
  }
  const geometry = new THREE.BufferGeometry();
  const join = key => [...lists[0][key], ...lists[1][key]];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(join('positions'), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(join('normals'), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(join('uvs'), 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(join('colors'), 3));
  const skin = lists[0].positions.length / 3, broken = lists[1].positions.length / 3;
  geometry.addGroup(0, skin, 0);
  geometry.addGroup(skin, broken, 1);
  let radius = 0;
  for (const h of hull) radius = Math.max(radius, h.length());
  return {geometry, centroid, vol, hull, radius};
}

// ---------- Physics ----------

class Chunk {
  constructor(mesh, data, mass) {
    this.mesh = mesh;
    this.hull = data.hull;
    this.radius = data.radius;
    this.invMass = 1 / mass;
    // Solid-sphere inertia approximation.
    this.invInertia = 1 / (0.4 * mass * Math.max(0.0004, data.radius * data.radius * 0.6));
    this.v = new THREE.Vector3();
    this.w = new THREE.Vector3();
    this.age = 0;
    this.rest = 0;
    this.sleeping = false;
    this.dissolve = -1;
    this.lifetime = 4.5 + Math.random() * 2.5;
  }
}

export class Shatter {
  constructor(scene, {quality = 1, onImpact = null, onDissolve = null} = {}) {
    this.scene = scene;
    this.quality = quality;
    this.onImpact = onImpact;
    this.onDissolve = onDissolve;
    this.chunks = [];
    this.gravity = -9.5;
    this.accumulator = 0;
    this.prepared = new WeakMap();
  }

  get active() { return this.chunks.length; }

  fragmentCount(piece) {
    const base = {1: 14, 2: 18, 3: 18, 4: 20, 5: 22, 6: 24}[piece.type] || 16;
    return Math.max(6, Math.round(base * this.quality));
  }

  // Fractures a piece ahead of time (as a duel begins, while the board is still), so the frame of
  // impact only places the shards. localImpact: expected point of impact in the piece's own space.
  prepare(piece, localImpact = null) {
    this.prepared.set(piece, fracture(piece.model, this.fragmentCount(piece), localImpact));
  }

  // Breaks a piece apart. impact: {point (world), dir (world, unit), strength, up, radial, spin, crumble}
  shatter(piece, impact) {
    const model = piece.model;
    piece.pose.updateMatrixWorld(true);
    const matrix = piece.pose.matrixWorld;
    const inverse = matrix.clone().invert();
    const localImpact = impact.point ? impact.point.clone().applyMatrix4(inverse) : null;
    const pieces = this.prepared.get(piece) || fracture(model, this.fragmentCount(piece), localImpact);
    this.prepared.delete(piece);
    const quat = new THREE.Quaternion(), scale = new THREE.Vector3(), position = new THREE.Vector3();
    matrix.decompose(position, quat, scale);
    const center = new THREE.Vector3(0, model.height * 0.45, 0).applyMatrix4(matrix);
    const materials = [piece.body.material, piece.factory.fractureMaterials[piece.color]];
    const created = [];
    for (const data of pieces) {
      const mesh = new THREE.Mesh(data.geometry, materials);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.enable(REFLECT_LAYER);
      mesh.position.copy(data.centroid).applyMatrix4(matrix);
      mesh.quaternion.copy(quat);
      this.scene.add(mesh);
      const chunk = new Chunk(mesh, data, Math.max(0.02, data.vol * 30));
      const offset = tmpV.subVectors(mesh.position, impact.point || center);
      const dist = offset.length();
      const fall = 1 / (1 + dist * 2.6);
      const radial = tmpR.set(mesh.position.x - center.x, 0, mesh.position.z - center.z);
      if (radial.lengthSq() < 1e-6) radial.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      radial.normalize();
      const k = 0.65 + Math.random() * 0.6;
      if (impact.crumble) {
        chunk.v.set(radial.x * (0.4 + Math.random() * 0.8), -0.2 + Math.random() * 0.8, radial.z * (0.4 + Math.random() * 0.8));
        chunk.v.multiplyScalar(impact.strength || 1);
      } else {
        chunk.v.copy(impact.dir).multiplyScalar(impact.strength * fall * k);
        chunk.v.addScaledVector(radial, (impact.radial ?? 1.2) * (0.5 + Math.random()));
        chunk.v.y += (impact.up ?? 1.2) * (0.4 + Math.random() * 0.9) + (mesh.position.y - center.y) * 1.5;
        chunk.v.x += (Math.random() - 0.5) * 0.6;
        chunk.v.z += (Math.random() - 0.5) * 0.6;
      }
      const spin = (impact.spin ?? 9) * (0.3 + fall);
      chunk.w.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
      this.chunks.push(chunk);
      created.push(chunk);
    }
    return created;
  }

  // obstacles: [{x, z, r, h}] standing pieces (vertical cylinders) that rubble bounces off.
  update(dt, obstacles = []) {
    if (!this.chunks.length) return;
    // 240 Hz steps keep rubble moving on every frame of a 120-240 Hz display.
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    const step = 1 / 240;
    while (this.accumulator >= step) {
      this.step(step, obstacles);
      this.accumulator -= step;
    }
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.age += dt;
      if (c.dissolve < 0 && (c.age > c.lifetime || (c.sleeping && c.rest > 2.2))) {
        c.dissolve = 0;
        if (this.onDissolve) this.onDissolve(c.mesh.position, c.radius);
      }
      if (c.dissolve >= 0) {
        c.dissolve += dt;
        const s = Math.max(0.001, 1 - c.dissolve / 0.9);
        c.mesh.scale.setScalar(s);
        c.mesh.position.y -= dt * 0.04;
        if (s <= 0.001) {
          c.mesh.removeFromParent();
          c.mesh.geometry.dispose();
          this.chunks.splice(i, 1);
        }
      }
    }
  }

  step(dt, obstacles) {
    const chunks = this.chunks;
    for (const c of chunks) {
      if (c.dissolve >= 0) continue;
      const m = c.mesh;
      if (!c.sleeping) {
        c.v.y += this.gravity * dt;
        c.v.multiplyScalar(1 - 0.05 * dt);
        c.w.multiplyScalar(1 - 0.35 * dt);
        m.position.addScaledVector(c.v, dt);
        tmpQ.set(c.w.x * dt * 0.5, c.w.y * dt * 0.5, c.w.z * dt * 0.5, 0).multiply(m.quaternion);
        m.quaternion.set(m.quaternion.x + tmpQ.x, m.quaternion.y + tmpQ.y, m.quaternion.z + tmpQ.z, m.quaternion.w + tmpQ.w).normalize();
        this.ground(c, dt);
      }
      // Standing pieces are vertical cylinders; a walking piece shoves rubble aside.
      for (const o of obstacles) {
        const moving = (o.vx || 0) !== 0 || (o.vz || 0) !== 0;
        if (c.sleeping && !moving) continue;
        const dx = m.position.x - o.x, dz = m.position.z - o.z;
        const min = o.r + c.radius * 0.6;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || m.position.y > o.h || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        m.position.x += nx * (min - d);
        m.position.z += nz * (min - d);
        const ovn = (o.vx || 0) * nx + (o.vz || 0) * nz;
        const vn = c.v.x * nx + c.v.z * nz;
        if (vn < ovn) {
          const push = ovn - vn;
          c.v.x += nx * push * 1.35;
          c.v.z += nz * push * 1.35;
          c.v.y += push * 0.3;
          c.w.x += (Math.random() - 0.5) * 6;
          c.w.z += (Math.random() - 0.5) * 6;
          c.sleeping = false;
          c.rest = 0;
        }
      }
    }
    // Chunk-chunk separation with a light restitution impulse.
    for (let i = 0; i < chunks.length; i++) {
      const a = chunks[i];
      if (a.dissolve >= 0) continue;
      for (let j = i + 1; j < chunks.length; j++) {
        const b = chunks[j];
        if (b.dissolve >= 0 || (a.sleeping && b.sleeping)) continue;
        tmpN.subVectors(b.mesh.position, a.mesh.position);
        const min = (a.radius + b.radius) * 0.62;
        const d2 = tmpN.lengthSq();
        if (d2 >= min * min || d2 < 1e-10) continue;
        const d = Math.sqrt(d2);
        tmpN.divideScalar(d);
        const total = a.invMass + b.invMass;
        const corr = (min - d) / total;
        a.mesh.position.addScaledVector(tmpN, -corr * a.invMass);
        b.mesh.position.addScaledVector(tmpN, corr * b.invMass);
        const rel = tmpT.subVectors(b.v, a.v).dot(tmpN);
        if (rel < 0) {
          const j2 = -(1.2 * rel) / total;
          a.v.addScaledVector(tmpN, -j2 * a.invMass);
          b.v.addScaledVector(tmpN, j2 * b.invMass);
          if (Math.abs(rel) > 0.6) { a.sleeping = b.sleeping = false; a.rest = b.rest = 0; }
        }
      }
    }
  }

  // Contacts against the stepped ground height field, with restitution and Coulomb friction.
  ground(c, dt) {
    const m = c.mesh;
    let deepest = 0, contacts = 0;
    let impactSpeed = 0;
    for (const h of c.hull) {
      const p = tmpV.copy(h).applyQuaternion(m.quaternion).add(m.position);
      const g = groundHeight(p.x, p.z);
      const pen = g - p.y;
      if (pen <= 0) continue;
      contacts++;
      if (pen > deepest) deepest = pen;
      const r = tmpR.subVectors(p, m.position);
      const vel = tmpW.crossVectors(c.w, r).add(c.v);
      const vn = vel.y;
      if (vn >= 0) continue;
      impactSpeed = Math.max(impactSpeed, -vn);
      const rn = tmpN.set(-r.z, 0, r.x); // r × up
      const k = c.invMass + c.invInertia * rn.lengthSq();
      const e = -vn > 1.2 ? 0.28 : 0;
      const j = -(1 + e) * vn / k;
      c.v.y += j * c.invMass;
      c.w.addScaledVector(rn, j * c.invInertia);
      const vel2 = tmpW.crossVectors(c.w, r).add(c.v);
      tmpT.set(vel2.x, 0, vel2.z);
      const vt = tmpT.length();
      if (vt > 1e-5) {
        tmpT.divideScalar(vt);
        const rt = tmpN.crossVectors(r, tmpT);
        const kt = c.invMass + c.invInertia * rt.lengthSq();
        const jt = Math.max(-0.65 * j, -vt / kt);
        c.v.addScaledVector(tmpT, jt * c.invMass);
        c.w.addScaledVector(rt, jt * c.invInertia);
      }
    }
    if (deepest > 0) m.position.y += deepest * 0.85;
    if (impactSpeed > 1.1 && this.onImpact) this.onImpact(impactSpeed, m.position, c.radius);
    if (contacts && c.v.lengthSq() < 0.012 && c.w.lengthSq() < 0.09) {
      c.rest += dt;
      if (c.rest > 0.45) { c.sleeping = true; c.v.set(0, 0, 0); c.w.set(0, 0, 0); }
    } else if (!contacts) c.rest = 0;
  }

  clear() {
    for (const c of this.chunks) { c.mesh.removeFromParent(); c.mesh.geometry.dispose(); }
    this.chunks.length = 0;
  }
}
