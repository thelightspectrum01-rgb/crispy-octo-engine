// The Gothic nave around the board: clustered piers, pointed arcades, ribbed vaults,
// stained glass, rose windows, candelabras, light shafts and drifting dust.
import * as THREE from 'three';
import {mergeGeometries} from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import {FLOOR_Y, STEP2} from './board.js';
import {lancetTexture, roseTexture, cookieTexture, glowTexture, flameTexture, shaftTexture, runeCircleTexture, canvasTexture} from './textures.js';

export const NAVE = {pierX: 10.5, wallX: 17, endZ: 24, bays: [-18, -12, -6, 0, 6, 12, 18], arcadeSpring: 8.6, arcadeTop: 14.5, vaultSpring: 21.5};
const BLOCK = 4.8; // world size of one ashlar texture tile

function scaleUV(geometry, su, sv = su) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geometry;
}

function cylinder(rTop, rBottom, height, radial, x, y, z) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, radial, 1, false);
  scaleUV(g, (Math.PI * 2 * Math.max(rTop, rBottom)) / BLOCK, height / BLOCK);
  g.translate(x, y + height / 2, z);
  return g.toNonIndexed();
}

function latheGeo(points, segments, y = 0) {
  const g = new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), segments);
  scaleUV(g, 1.2, 0.4);
  g.translate(0, y, 0);
  return g.toNonIndexed();
}

// Equilateral-family pointed arch from (x0, y) to (x1, y); 'sharp' >= 1 raises the apex.
function pointedArch(x0, x1, y, sharp = 1, steps = 14) {
  const w = x1 - x0, R = w * sharp, mid = (x0 + x1) / 2;
  const cL = x0 + R, cR = x1 - R;
  const apexY = Math.sqrt(R * R - (mid - cR) * (mid - cR));
  const aL0 = Math.PI, aL1 = Math.acos((mid - cL) / R);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = aL0 + (aL1 - aL0) * (i / steps);
    pts.push(new THREE.Vector2(cL + R * Math.cos(a), y + R * Math.sin(a)));
  }
  const aR0 = Math.acos((mid - cR) / R);
  for (let i = 1; i <= steps; i++) {
    const a = aR0 + (0 - aR0) * (i / steps);
    pts.push(new THREE.Vector2(cR + R * Math.cos(a), y + R * Math.sin(a)));
  }
  return {points: pts, apex: y + apexY};
}

function lancetPath(cx, y0, width, height, sharp = 1.1) {
  const springY = y0 + height - width * 0.95;
  const arch = pointedArch(cx - width / 2, cx + width / 2, springY, sharp, 10).points;
  const path = new THREE.Path();
  path.moveTo(cx - width / 2, y0);
  for (const p of arch) path.lineTo(p.x, p.y);
  path.lineTo(cx + width / 2, y0);
  path.closePath();
  return path;
}

function lancetShape(width, height, sharp = 1.1) {
  const s = new THREE.Shape();
  const springY = height - width * 0.95;
  const arch = pointedArch(-width / 2, width / 2, springY, sharp, 10).points;
  s.moveTo(-width / 2, 0);
  for (const p of arch) s.lineTo(p.x, p.y);
  s.lineTo(width / 2, 0);
  s.closePath();
  return s;
}

// Extrudes a wall drawn in the (z, y) plane, 'thickness' along x, centred on x.
function wallZY(shape, thickness, x) {
  const g = new THREE.ExtrudeGeometry(shape, {depth: thickness, bevelEnabled: false, curveSegments: 6});
  scaleUV(g, 1 / BLOCK);
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  g.translate(x + thickness / 2, 0, 0);
  return g;
}

// Extrudes a wall drawn in the (x, y) plane, 'thickness' along z, centred on z.
function wallXY(shape, thickness, z) {
  const g = new THREE.ExtrudeGeometry(shape, {depth: thickness, bevelEnabled: false, curveSegments: 12});
  scaleUV(g, 1 / BLOCK);
  g.translate(0, 0, z - thickness / 2);
  return g;
}

function tubeAlong(points, radius, segments = 32) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, segments, radius, 6, false);
  scaleUV(g, 6, 0.2);
  return g.toNonIndexed();
}

function pier(x, z) {
  const parts = [];
  const base = FLOOR_Y;
  parts.push(cylinder(1.12, 1.18, 0.55, 8, x, base, z));
  const moulding = latheGeo([[1.0, 0], [1.02, 0.08], [0.92, 0.16], [0.95, 0.24], [0.8, 0.34], [0.74, 0.42]], 24, base + 0.55);
  moulding.translate(x, 0, z);
  parts.push(moulding);
  const shaftY = base + 0.95, shaftH = NAVE.arcadeSpring - 0.75 - shaftY;
  parts.push(cylinder(0.64, 0.64, shaftH, 16, x, shaftY, z));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    parts.push(cylinder(0.15, 0.15, shaftH, 8, x + Math.cos(a) * 0.68, shaftY, z + Math.sin(a) * 0.68));
  }
  const cap = latheGeo([[0.78, 0], [0.84, 0.12], [0.98, 0.42], [1.08, 0.58], [1.12, 0.66]], 16, NAVE.arcadeSpring - 0.75);
  cap.translate(x, 0, z);
  parts.push(cap);
  parts.push(cylinder(1.2, 1.2, 0.18, 8, x, NAVE.arcadeSpring - 0.09, z));
  // Vaulting shaft rising on the nave side up to the vault springing.
  const inward = -Math.sign(x);
  parts.push(cylinder(0.2, 0.2, NAVE.vaultSpring - NAVE.arcadeSpring, 8, x + inward * 0.55, NAVE.arcadeSpring, z));
  parts.push(cylinder(0.34, 0.26, 0.35, 8, x + inward * 0.55, NAVE.vaultSpring - 0.35, z));
  return parts;
}

function stainedMaterial(texture, brightness = 2.4) {
  return new THREE.MeshBasicMaterial({map: texture, color: new THREE.Color(brightness, brightness, brightness), fog: false, toneMapped: true});
}

export class Cathedral {
  constructor({textures, quality}) {
    this.group = new THREE.Group();
    this.quality = quality;
    this.time = 0;
    this.flames = [];
    this.candleLights = [];
    this.stoneMaterial = new THREE.MeshStandardMaterial({map: textures.wallAlbedo, normalMap: textures.wallNormal, roughness: 0.88, envMapIntensity: 0.25});
    this.darkStone = new THREE.MeshStandardMaterial({map: textures.wallAlbedo, normalMap: textures.wallNormal, color: 0x8a8580, roughness: 0.92, envMapIntensity: 0.15, side: THREE.DoubleSide});
    this.waxMaterial = new THREE.MeshStandardMaterial({color: 0xe9dcc0, roughness: 0.6, emissive: 0x2a1404});
    this.flameMaterial = new THREE.SpriteMaterial({map: flameTexture(), color: new THREE.Color(2.2, 1.6, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, fog: false});
    this.buildFloor(textures);
    this.buildPiers();
    this.buildWalls();
    this.buildVaults();
    this.buildWindows();
    this.buildAltar();
    this.buildCandelabras();
    this.buildBanners();
    this.buildFloorRunes();
    this.buildLights();
    this.buildShafts();
    this.buildDust();
  }

  buildFloor(textures) {
    const w = NAVE.wallX * 2, d = NAVE.endZ * 2;
    for (const t of [textures.floorAlbedo, textures.floorNormal, textures.floorORM]) t.repeat.set(w / 6, d / 6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      map: textures.floorAlbedo, normalMap: textures.floorNormal, roughnessMap: textures.floorORM, roughness: 1, metalness: 0, envMapIntensity: 0.6}));
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  buildPiers() {
    const parts = [];
    for (const side of [-1, 1]) for (const z of NAVE.bays) parts.push(...pier(side * NAVE.pierX, z));
    const mesh = new THREE.Mesh(mergeGeometries(parts), this.stoneMaterial);
    parts.forEach(g => g.dispose());
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildWalls() {
    const parts = [];
    const {bays, arcadeSpring, arcadeTop, vaultSpring, pierX, wallX, endZ} = NAVE;
    const z0 = -endZ, z1 = endZ;
    for (const side of [-1, 1]) {
      // Arcade spandrels: one outline following every pointed arch between piers.
      const shape = new THREE.Shape();
      shape.moveTo(z0, arcadeTop);
      shape.lineTo(z0, arcadeSpring);
      const stops = [z0, ...bays, z1];
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i] + (i === 0 ? 0 : 1.05), b = stops[i + 1] - (i === stops.length - 2 ? 0 : 1.05);
        shape.lineTo(a, arcadeSpring);
        for (const p of pointedArch(a, b, arcadeSpring, 1.0, 12).points) shape.lineTo(p.x, p.y);
        shape.lineTo(stops[i + 1], arcadeSpring);
      }
      shape.lineTo(z1, arcadeTop);
      shape.closePath();
      parts.push(wallZY(shape, 1.2, side * pierX));
      // Archivolt mouldings.
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i] + (i === 0 ? 0 : 1.05), b = stops[i + 1] - (i === stops.length - 2 ? 0 : 1.05);
        const arch = pointedArch(a, b, arcadeSpring, 1.0, 12).points.map(p => new THREE.Vector3(side * pierX - side * 0.62, p.y, p.x));
        parts.push(tubeAlong(arch, 0.13, 28));
      }
      // Clerestory wall with lancet openings.
      const clere = new THREE.Shape();
      clere.moveTo(z0, arcadeTop); clere.lineTo(z1, arcadeTop); clere.lineTo(z1, vaultSpring + 1); clere.lineTo(z0, vaultSpring + 1); clere.closePath();
      for (let i = 0; i < bays.length - 1; i++) clere.holes.push(lancetPath((bays[i] + bays[i + 1]) / 2, arcadeTop + 1.3, 2.1, 5.2));
      clere.holes.push(lancetPath((z0 + bays[0]) / 2, arcadeTop + 1.3, 2.1, 5.2), lancetPath((bays[bays.length - 1] + z1) / 2, arcadeTop + 1.3, 2.1, 5.2));
      parts.push(wallZY(clere, 0.9, side * pierX));
      // String course between arcade and clerestory.
      const course = new THREE.BoxGeometry(1.5, 0.3, endZ * 2);
      scaleUV(course, endZ * 2 / BLOCK, 0.1);
      course.translate(side * pierX, arcadeTop, 0);
      parts.push(course.toNonIndexed());
      // Outer aisle wall with tall lancets.
      const outer = new THREE.Shape();
      outer.moveTo(z0, FLOOR_Y); outer.lineTo(z1, FLOOR_Y); outer.lineTo(z1, 13.5); outer.lineTo(z0, 13.5); outer.closePath();
      for (let i = 0; i < bays.length - 1; i++) outer.holes.push(lancetPath((bays[i] + bays[i + 1]) / 2, 1.6, 2.4, 8.4));
      parts.push(wallZY(outer, 1.0, side * wallX));
    }
    // East (apse) and west walls with rose windows and lancets.
    for (const endSide of [-1, 1]) {
      const s = new THREE.Shape();
      s.moveTo(-wallX, FLOOR_Y); s.lineTo(wallX, FLOOR_Y); s.lineTo(wallX, 34); s.lineTo(-wallX, 34); s.closePath();
      const rose = new THREE.Path();
      rose.absarc(0, 19.5, 5, 0, Math.PI * 2, true);
      s.holes.push(rose);
      if (endSide < 0) for (const x of [-3.2, 0, 3.2]) s.holes.push(lancetPath(x, 3.2, 2.0, 9.6, 1.15));
      else s.holes.push(lancetPath(0, FLOOR_Y, 4.2, 8.4, 1.0));
      parts.push(wallXY(s, 1.4, endSide * endZ));
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), this.stoneMaterial);
    parts.forEach(g => g.dispose());
    mesh.receiveShadow = true;
    this.group.add(mesh);
    // West doors.
    const door = new THREE.Mesh(new THREE.ShapeGeometry(lancetShape(4.2, 8.4, 1.0)), new THREE.MeshStandardMaterial({color: 0x1a1009, roughness: 0.8}));
    door.position.set(0, FLOOR_Y, endZ - 0.3);
    door.rotation.y = Math.PI;
    this.group.add(door);
  }

  buildVaults() {
    const parts = [];
    const {pierX, wallX, vaultSpring, endZ, bays} = NAVE;
    // Pointed barrel shell over the nave and lower shells over the aisles.
    const shell = (x0, x1, spring, sharp, zFrom, zTo) => {
      const arch = pointedArch(x0, x1, spring, sharp, 16).points;
      const positions = [], uvs = [];
      for (let i = 0; i < arch.length - 1; i++) {
        const a = arch[i], b = arch[i + 1];
        const quad = [[a.x, a.y, zFrom], [b.x, b.y, zFrom], [b.x, b.y, zTo], [a.x, a.y, zFrom], [b.x, b.y, zTo], [a.x, a.y, zTo]];
        for (const [x, y, z] of quad) { positions.push(x, y, z); uvs.push((x + y) / BLOCK, z / BLOCK); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      return g;
    };
    parts.push(shell(-pierX, pierX, vaultSpring, 0.85, -endZ, endZ));
    parts.push(shell(-wallX, -pierX, 13.0, 0.9, -endZ, endZ), shell(pierX, wallX, 13.0, 0.9, -endZ, endZ));
    const shellMesh = new THREE.Mesh(mergeGeometries(parts), this.darkStone);
    parts.forEach(g => g.dispose());
    this.group.add(shellMesh);
    // Ribs: transverse arches at each pier pair, diagonals across each bay, ridge rib.
    const ribs = [];
    const stops = [-endZ, ...bays, endZ];
    for (const z of bays) {
      ribs.push(tubeAlong(pointedArch(-pierX + 0.55, pierX - 0.55, vaultSpring, 0.85, 16).points.map(p => new THREE.Vector3(p.x, p.y - 0.15, z)), 0.22, 32));
    }
    const ridgeY = pointedArch(-pierX + 0.55, pierX - 0.55, vaultSpring, 0.85).apex - 0.3;
    for (let i = 0; i < stops.length - 1; i++) {
      const za = stops[i], zb = stops[i + 1];
      for (const dir of [1, -1]) {
        const pts = [];
        for (let k = 0; k <= 16; k++) {
          const t = k / 16;
          const x = (-pierX + 0.6) * (1 - t) + (pierX - 0.6) * t;
          const z = dir > 0 ? za + (zb - za) * t : zb + (za - zb) * t;
          const h = Math.sin(Math.PI * t);
          pts.push(new THREE.Vector3(x, vaultSpring + (ridgeY - vaultSpring) * Math.pow(h, 0.75), z));
        }
        ribs.push(tubeAlong(pts, 0.14, 24));
      }
    }
    ribs.push(tubeAlong([new THREE.Vector3(0, ridgeY, -endZ), new THREE.Vector3(0, ridgeY, endZ)], 0.16, 4));
    for (const z of bays) {
      const boss = new THREE.SphereGeometry(0.42, 10, 8);
      boss.translate(0, ridgeY - 0.1, z + 3);
      ribs.push(boss.toNonIndexed());
    }
    const ribMesh = new THREE.Mesh(mergeGeometries(ribs), this.stoneMaterial);
    ribs.forEach(g => g.dispose());
    this.group.add(ribMesh);
  }

  buildWindows() {
    const {bays, arcadeTop, pierX, wallX, endZ} = NAVE;
    const lancetTextures = [lancetTexture(1), lancetTexture(2), lancetTexture(3)];
    const materials = lancetTextures.map(t => stainedMaterial(t, 2.1));
    const add = (mesh) => { mesh.renderOrder = -1; this.group.add(mesh); };
    const mids = [];
    for (let i = 0; i < bays.length - 1; i++) mids.push((bays[i] + bays[i + 1]) / 2);
    mids.push((-endZ + bays[0]) / 2, (bays[bays.length - 1] + endZ) / 2);
    this.windowGlass = [];
    mids.forEach((z, i) => {
      for (const side of [-1, 1]) {
        const clere = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 5.2), materials[(i + (side > 0 ? 1 : 0)) % 3]);
        clere.position.set(side * (pierX + 0.2), arcadeTop + 1.3 + 2.6, z);
        clere.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        add(clere);
        if (i < bays.length - 1) {
          const low = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 8.4), materials[(i + 2) % 3]);
          low.position.set(side * (wallX + 0.3), 1.6 + 4.2, z);
          low.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          add(low);
        }
      }
    });
    const roseMat = stainedMaterial(roseTexture(1024), 2.6);
    for (const endSide of [-1, 1]) {
      const rose = new THREE.Mesh(new THREE.CircleGeometry(5, 48), roseMat);
      rose.position.set(0, 19.5, endSide * (endZ + 0.4));
      rose.rotation.y = endSide < 0 ? 0 : Math.PI;
      add(rose);
    }
    [-3.2, 0, 3.2].forEach((x, i) => {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 9.6), materials[i]);
      l.position.set(x, 3.2 + 4.8, -endZ - 0.4);
      add(l);
    });
  }

  buildAltar() {
    const z = -NAVE.endZ + 3.2;
    const parts = [];
    const step = new THREE.BoxGeometry(8, 0.5, 4.5);
    scaleUV(step, 8 / BLOCK, 0.5 / BLOCK);
    step.translate(0, FLOOR_Y + 0.25, z);
    parts.push(step.toNonIndexed());
    const table = new THREE.BoxGeometry(3.6, 1.2, 1.4);
    table.translate(0, FLOOR_Y + 1.1, z);
    parts.push(table.toNonIndexed());
    const altar = new THREE.Mesh(mergeGeometries(parts), this.stoneMaterial);
    parts.forEach(g => g.dispose());
    altar.receiveShadow = true;
    this.group.add(altar);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.25, 1.42), new THREE.MeshStandardMaterial({color: 0x5a0b12, roughness: 0.9}));
    cloth.position.set(0, FLOOR_Y + 1.11, z);
    this.group.add(cloth);
    for (const x of [-1.4, -0.9, 0.9, 1.4]) this.candle(x, FLOOR_Y + 1.7, z, 0.06, 0.5 + Math.abs(x) * 0.1);
    const light = new THREE.PointLight(0xff9a40, 18, 14, 2);
    light.position.set(0, FLOOR_Y + 2.6, z + 0.6);
    this.group.add(light);
    this.candleLights.push({light, base: 18, phase: 2.1});
  }

  candle(x, y, z, radius, height) {
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.05, height, 10), this.waxMaterial);
    wax.position.set(x, y + height / 2, z);
    this.group.add(wax);
    const flame = new THREE.Sprite(this.flameMaterial);
    flame.scale.set(radius * 2.4, radius * 4.8, 1);
    flame.position.set(x, y + height + radius * 2.1, z);
    flame.userData.base = flame.scale.clone();
    flame.userData.phase = Math.random() * 100;
    this.group.add(flame);
    this.flames.push(flame);
    return flame;
  }

  buildCandelabras() {
    const iron = new THREE.MeshStandardMaterial({color: 0x1d1a17, roughness: 0.45, metalness: 0.85, envMapIntensity: 0.8});
    const stand = latheGeo([[0, 0], [0.55, 0], [0.5, 0.08], [0.18, 0.2], [0.09, 0.35], [0.06, 0.6], [0.08, 0.7], [0.05, 0.8], [0.05, 2.2],
      [0.09, 2.3], [0.05, 2.4], [0.05, 2.55], [0.42, 2.62], [0.45, 2.7], [0.0, 2.7]], 12);
    const s = 7.2;
    for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
      const m = new THREE.Mesh(stand, iron);
      m.position.set(x, FLOOR_Y, z);
      m.castShadow = true;
      this.group.add(m);
      const top = FLOOR_Y + 2.7;
      this.candle(x, top, z, 0.07, 0.42);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        this.candle(x + Math.cos(a) * 0.3, top, z + Math.sin(a) * 0.3, 0.055, 0.3 + (i % 2) * 0.08);
      }
      const light = new THREE.PointLight(0xff9238, 26, 16, 2);
      light.position.set(x, top + 0.75, z);
      this.group.add(light);
      this.candleLights.push({light, base: 26, phase: Math.random() * 10});
    }
    // Votive racks by the piers.
    for (const side of [-1, 1]) {
      for (const z of [-12, 12]) {
        const x = side * (NAVE.pierX - 1.6);
        const rack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 1.6), iron);
        rack.position.set(x, FLOOR_Y + 0.45, z);
        this.group.add(rack);
        for (let i = 0; i < 6; i++) this.candle(x + (i % 2 ? 0.12 : -0.12), FLOOR_Y + 0.9, z - 0.6 + i * 0.24, 0.035, 0.12 + Math.random() * 0.1);
      }
    }
  }

  buildBanners() {
    const make = (base, emblem) => canvasTexture(256, 640, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, base[0]); g.addColorStop(0.5, base[1]); g.addColorStop(1, base[0]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.86); ctx.lineTo(w / 2, h); ctx.lineTo(0, h * 0.86); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#c9a052';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(14, 10); ctx.lineTo(w - 14, 10); ctx.lineTo(w - 14, h * 0.85); ctx.lineTo(w / 2, h - 18); ctx.lineTo(14, h * 0.85); ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = '#d8b062';
      ctx.font = `700 ${Math.round(w * 0.62)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emblem, w / 2, h * 0.45);
    });
    const textures = [make(['#3d070d', '#7a1420'], '♛︎'), make(['#08142e', '#16306a'], '♔︎')];
    this.banners = [];
    const geometry = new THREE.PlaneGeometry(1.8, 4.6, 6, 16);
    for (const side of [-1, 1]) {
      for (const z of [-15, -9, -3, 3, 9, 15]) {
        const material = new THREE.MeshStandardMaterial({map: textures[(side > 0 ? 1 : 0)], side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.85});
        material.onBeforeCompile = shader => {
          shader.uniforms.uTime = {value: 0};
          shader.uniforms.uPhase = {value: z * 0.37 + side};
          material.userData.shader = shader;
          shader.vertexShader = 'uniform float uTime; uniform float uPhase;\n' + shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\nfloat sway = (2.3 - position.y) / 4.6;\ntransformed.z += sin(uTime * 0.7 + uPhase + position.y * 0.9) * 0.12 * sway;');
        };
        const banner = new THREE.Mesh(geometry, material);
        banner.position.set(side * (NAVE.pierX - 0.75), NAVE.arcadeSpring + 0.4, z);
        banner.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        this.group.add(banner);
        this.banners.push(material);
      }
    }
  }

  buildFloorRunes() {
    const texture = runeCircleTexture(1024);
    this.floorRunes = new THREE.Mesh(new THREE.PlaneGeometry(17.5, 17.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: texture, color: new THREE.Color(0.12, 0.25, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    this.floorRunes.position.y = FLOOR_Y + 0.01;
    this.floorRunes.renderOrder = 1;
    this.group.add(this.floorRunes);
    this.runeIntensity = 1;
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0x6d7a9a, 0x2b2017, 0.55);
    this.group.add(hemi);
    // Sunlight through the south clerestory, coloured by the glass it passes through.
    const sun = new THREE.SpotLight(0xffe0b0, 6.2, 0, 0.4, 0.55, 0);
    sun.position.set(-NAVE.pierX - 2, 19, -1.5);
    sun.target.position.set(0.6, 0, 0.4);
    this.group.add(sun, sun.target);
    if (this.quality.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
      sun.shadow.camera.near = 12;
      sun.shadow.camera.far = 42;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.025;
      sun.map = cookieTexture(512);
    }
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0x7f95ff, 0.32);
    fill.position.set(12, 9, 9);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.45);
    rim.position.set(0, 9, -16);
    this.group.add(fill, rim);
  }

  buildShafts() {
    // Crossed planes that fade when seen edge-on or from close by, so they never read as flat sheets.
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {uMap: {value: shaftTexture()}, uColor: {value: new THREE.Color(1.0, 0.82, 0.55)}, uOpacity: {value: 0.085}},
      vertexShader: `
        varying vec2 vUv; varying float vFade;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vec3 n = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
          vec3 toCam = cameraPosition - world.xyz;
          float facing = abs(dot(n, normalize(toCam)));
          vFade = smoothstep(0.12, 0.55, facing) * smoothstep(2.5, 8.0, length(toCam));
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
        varying vec2 vUv; varying float vFade;
        void main() { gl_FragColor = vec4(uColor, texture2D(uMap, vUv).a * uOpacity * vFade); }`,
    });
    const dir = new THREE.Vector3().subVectors(this.sun.target.position, this.sun.position).normalize();
    this.shafts = [];
    const sources = [-9, -3, 3, 9];
    for (const z of sources) {
      const start = new THREE.Vector3(-NAVE.pierX - 0.3, NAVE.arcadeTop + 3.6, z);
      const t = (start.y - FLOOR_Y) / -dir.y;
      const end = start.clone().addScaledVector(dir, t);
      const length = start.distanceTo(end);
      const group = new THREE.Group();
      for (let k = 0; k < 2; k++) {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, length), material);
        plane.rotation.y = k * Math.PI / 2;
        group.add(plane);
      }
      group.position.copy(start).add(end).multiplyScalar(0.5);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
      group.renderOrder = 2;
      this.group.add(group);
      this.shafts.push(group);
    }
    this.shaftMaterial = material;
  }

  buildDust() {
    const count = this.quality.dust;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = FLOOR_Y + Math.random() * 12;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 22;
      seeds[i] = Math.random() * 100;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    this.dustMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {uTime: {value: 0}, uMap: {value: glowTexture(64)}, uScale: {value: 300}, uSun: {value: this.sun.position.clone()}, uSunDir: {value: new THREE.Vector3()}},
      vertexShader: `
        attribute float seed; uniform float uTime, uScale; uniform vec3 uSun, uSunDir; varying float vAlpha;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.11 + seed) * 0.6;
          p.y = mod(p.y + uTime * 0.05 + seed, 12.0) - 0.9;
          p.z += cos(uTime * 0.09 + seed * 1.3) * 0.6;
          vec3 toP = p - uSun;
          float along = dot(toP, uSunDir);
          float off = length(toP - uSunDir * along);
          float lit = smoothstep(5.0, 1.0, off / max(1.0, along * 0.42));
          vAlpha = (0.12 + lit * 0.9) * (0.6 + 0.4 * sin(uTime * 1.3 + seed * 7.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uScale * (0.025 + 0.02 * fract(seed)) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying float vAlpha;
        void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * t.a * vAlpha, 1.0); }`,
    });
    this.dustMaterial.uniforms.uSunDir.value.subVectors(this.sun.target.position, this.sun.position).normalize();
    this.dust = new THREE.Points(geometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  setViewportHeight(px) {
    this.dustMaterial.uniforms.uScale.value = px * 0.9;
  }

  // Brief flare of the floor runes and candles (captures, check, mate).
  pulse(strength = 1) { this.runeIntensity = Math.min(4, this.runeIntensity + strength * 2.5); }

  update(dt) {
    this.time += dt;
    const t = this.time;
    for (const f of this.flames) {
      const k = 0.85 + 0.15 * Math.sin(t * 13 + f.userData.phase) + 0.08 * Math.sin(t * 31 + f.userData.phase * 2);
      f.scale.set(f.userData.base.x * (0.92 + 0.08 * k), f.userData.base.y * k, 1);
    }
    for (const c of this.candleLights) {
      c.light.intensity = c.base * (0.86 + 0.1 * Math.sin(t * 11 + c.phase) + 0.06 * Math.sin(t * 23 + c.phase * 3));
    }
    for (const m of this.banners) if (m.userData.shader) m.userData.shader.uniforms.uTime.value = t;
    this.runeIntensity += (1 - this.runeIntensity) * Math.min(1, dt * 1.5);
    const r = this.runeIntensity * (0.85 + 0.15 * Math.sin(t * 0.9));
    this.floorRunes.material.color.setRGB(0.12 * r, 0.25 * r, 0.5 * r);
    this.floorRunes.rotation.y = t * 0.02;
    this.dustMaterial.uniforms.uTime.value = t;
    this.shaftMaterial.uniforms.uOpacity.value = 0.1 + 0.02 * Math.sin(t * 0.4);
  }
}
