// The board: polished marble squares, a lettered frame, the dais, and the magic markers
// for selection, legal moves, captures, the last move, check and hints.
import * as THREE from 'three';
import {mergeGeometries} from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import {runeCircleTexture, moveDotTexture, captureRingTexture, squareGlowTexture, frameTexture, frameMetalTexture} from './textures.js';

export const FRAME_INNER = 4.03, FRAME_OUTER = 4.62, FRAME_TOP = 0.05;
export const STEP1 = {half: 5.25, top: -0.3}, STEP2 = {half: 6.1, top: -0.6}, FLOOR_Y = -0.9;

export function squareToWorld(sq, target = new THREE.Vector3()) {
  return target.set((sq & 7) - 3.5, 0, 3.5 - (sq >> 4));
}

export function worldToSquare(x, z) {
  const file = Math.floor(x + 4), rank = Math.floor(4 - z);
  return file < 0 || file > 7 || rank < 0 || rank > 7 ? -1 : rank * 16 + file;
}

// Height of the walkable/landing surface used by the debris physics.
export function groundHeight(x, z) {
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (m <= FRAME_INNER) return 0;
  if (m <= FRAME_OUTER) return FRAME_TOP;
  if (m <= STEP1.half) return STEP1.top;
  if (m <= STEP2.half) return STEP2.top;
  return FLOOR_Y;
}

function planarUV(geometry, scale, ox = 0, oz = 0) {
  const p = geometry.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * scale + ox;
    uv[i * 2 + 1] = -p.getZ(i) * scale + oz;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function marker(texture, size, color, opacity = 1) {
  const material = new THREE.MeshBasicMaterial({map: texture, color, transparent: true, opacity, blending: THREE.AdditiveBlending,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false});
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), material);
  mesh.renderOrder = 5;
  mesh.visible = false;
  return mesh;
}

export class Board {
  constructor({textures, fontFamily}) {
    this.group = new THREE.Group();
    this.time = 0;
    this.buildSquares(textures);
    this.buildFrame(textures, fontFamily);
    this.buildDais(textures);
    this.buildMarkers();
  }

  buildSquares(textures) {
    const light = [], dark = [];
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const g = new THREE.BoxGeometry(0.986, 0.1, 0.986);
        g.translate(file - 3.5, -0.05, 3.5 - rank);
        ((file + rank) % 2 ? light : dark).push(g);
      }
    }
    const lightGeo = planarUV(mergeGeometries(light), 0.23, 0.13, 0.41);
    const darkGeo = planarUV(mergeGeometries(dark), 0.23, 0.57, 0.08);
    [...light, ...dark].forEach(g => g.dispose());
    const lightMat = new THREE.MeshStandardMaterial({map: textures.boardLight, normalMap: textures.boardNormal, normalScale: new THREE.Vector2(0.15, 0.15),
      roughness: 0.2, metalness: 0, envMapIntensity: 0.9});
    const darkMat = new THREE.MeshStandardMaterial({map: textures.boardDark, normalMap: textures.boardNormal, normalScale: new THREE.Vector2(0.15, 0.15),
      roughness: 0.16, metalness: 0, envMapIntensity: 1.1});
    this.lightSquares = new THREE.Mesh(lightGeo, lightMat);
    this.darkSquares = new THREE.Mesh(darkGeo, darkMat);
    for (const m of [this.lightSquares, this.darkSquares]) { m.receiveShadow = true; this.group.add(m); }
    const grout = new THREE.Mesh(new THREE.BoxGeometry(8.06, 0.28, 8.06), new THREE.MeshStandardMaterial({color: 0x0b0a09, roughness: 0.9}));
    grout.position.y = -0.16;
    grout.receiveShadow = true;
    this.group.add(grout);
  }

  buildFrame(textures, fontFamily) {
    const shape = new THREE.Shape();
    const o = FRAME_OUTER, i = FRAME_INNER;
    shape.moveTo(-o, -o); shape.lineTo(o, -o); shape.lineTo(o, o); shape.lineTo(-o, o); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-i, -i); hole.lineTo(-i, i); hole.lineTo(i, i); hole.lineTo(i, -i); hole.closePath();
    shape.holes.push(hole);
    const depth = 0.31;
    const geo = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 1});
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, FRAME_TOP - depth - 0.03, 0);
    const extent = o + 0.03;
    const p = geo.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let k = 0; k < p.count; k++) {
      uv[k * 2] = (p.getX(k) + extent) / (2 * extent);
      uv[k * 2 + 1] = 1 - (p.getZ(k) + extent) / (2 * extent);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const map = frameTexture(extent, i, fontFamily);
    map.anisotropy = 8;
    const orm = frameMetalTexture(map);
    const frame = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({map, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1,
      normalMap: textures.stoneNormal, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 1.2}));
    frame.receiveShadow = true;
    frame.castShadow = true;
    this.group.add(frame);
  }

  buildDais(textures) {
    const material = new THREE.MeshStandardMaterial({map: textures.daisAlbedo, normalMap: textures.daisNormal, roughness: 0.55, envMapIntensity: 0.5});
    const steps = [];
    for (const [half, top] of [[STEP1.half, STEP1.top], [STEP2.half, STEP2.top]]) {
      const g = new THREE.BoxGeometry(half * 2, 0.3, half * 2);
      g.translate(0, top - 0.15, 0);
      // World-space UVs on every face so masonry courses line up across the steps.
      const p = g.attributes.position, n = g.attributes.normal;
      const uv = new Float32Array(p.count * 2);
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const ny = Math.abs(n.getY(k)), nx = Math.abs(n.getX(k));
        const u = ny > 0.5 ? x : nx > 0.5 ? z : x;
        const v = ny > 0.5 ? z : y;
        uv[k * 2] = u * 0.18;
        uv[k * 2 + 1] = v * 0.18;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      steps.push(g);
    }
    const dais = new THREE.Mesh(mergeGeometries(steps), material);
    steps.forEach(g => g.dispose());
    dais.receiveShadow = true;
    this.group.add(dais);
  }

  buildMarkers() {
    const rune = runeCircleTexture(), dot = moveDotTexture(), capture = captureRingTexture(), glow = squareGlowTexture();
    this.selectRing = marker(rune, 1.15, new THREE.Color(0.45, 0.85, 1.4));
    this.checkRing = marker(rune, 1.3, new THREE.Color(2.0, 0.25, 0.15));
    this.hintRing = marker(rune, 1.1, new THREE.Color(1.6, 1.15, 0.4));
    this.group.add(this.selectRing, this.checkRing, this.hintRing);
    this.dots = [];
    this.captures = [];
    for (let k = 0; k < 28; k++) {
      const d = marker(dot, 0.62, new THREE.Color(0.55, 0.85, 1.2), 0.85);
      const c = marker(capture, 1.0, new THREE.Color(1.9, 0.45, 0.2));
      this.dots.push(d);
      this.captures.push(c);
      this.group.add(d, c);
    }
    this.lastFrom = marker(glow, 1.0, new THREE.Color(0.9, 0.65, 0.25), 0.55);
    this.lastTo = marker(glow, 1.0, new THREE.Color(0.9, 0.65, 0.25), 0.75);
    this.hover = marker(glow, 1.0, new THREE.Color(0.5, 0.6, 0.7), 0.35);
    this.group.add(this.lastFrom, this.lastTo, this.hover);
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(-0.07, 0); arrowShape.lineTo(0.07, 0); arrowShape.lineTo(0.07, 0.72); arrowShape.lineTo(0.2, 0.72);
    arrowShape.lineTo(0, 1); arrowShape.lineTo(-0.2, 0.72); arrowShape.lineTo(-0.07, 0.72); arrowShape.closePath();
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({color: new THREE.Color(1.8, 1.25, 0.45), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    this.arrow.renderOrder = 6;
    this.arrow.visible = false;
    this.group.add(this.arrow);
  }

  place(mesh, sq, y = 0.004) {
    squareToWorld(sq, mesh.position);
    mesh.position.y = y;
    mesh.visible = true;
  }

  showSelection(sq, moves) {
    this.clearSelection();
    if (sq < 0) return;
    this.place(this.selectRing, sq, 0.006);
    let d = 0, c = 0;
    for (const m of moves) {
      if (m.capture) this.place(this.captures[c++], m.to, 0.007);
      else this.place(this.dots[d++], m.to, 0.007);
    }
  }

  clearSelection() {
    this.selectRing.visible = false;
    for (const m of [...this.dots, ...this.captures]) m.visible = false;
  }

  showLastMove(from, to) {
    if (from < 0) { this.lastFrom.visible = this.lastTo.visible = false; return; }
    this.place(this.lastFrom, from, 0.003);
    this.place(this.lastTo, to, 0.003);
  }

  showCheck(sq) {
    if (sq < 0) this.checkRing.visible = false;
    else this.place(this.checkRing, sq, 0.008);
  }

  showHover(sq) {
    if (sq < 0) this.hover.visible = false;
    else this.place(this.hover, sq, 0.0035);
  }

  showHint(from, to) {
    if (from < 0) { this.hintRing.visible = this.arrow.visible = false; return; }
    this.place(this.hintRing, from, 0.009);
    const a = squareToWorld(from), b = squareToWorld(to);
    const len = a.distanceTo(b);
    this.arrow.position.set(a.x, 0.02, a.z);
    this.arrow.scale.set(1, 1, len);
    this.arrow.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI;
    this.arrow.visible = true;
    this.hintTime = 0;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.selectRing.rotation.y = t * 0.6;
    this.hintRing.rotation.y = -t * 0.5;
    this.checkRing.rotation.y = t * 0.9;
    this.checkRing.material.opacity = 0.65 + 0.35 * Math.sin(t * 5);
    const pulse = 1 + 0.08 * Math.sin(t * 4);
    for (const d of this.dots) if (d.visible) d.scale.setScalar(pulse);
    for (const c of this.captures) if (c.visible) { c.rotation.y = t * 0.8; c.scale.setScalar(1 + 0.05 * Math.sin(t * 6)); }
    if (this.arrow.visible) {
      this.hintTime += dt;
      this.arrow.material.opacity = 0.55 + 0.3 * Math.sin(t * 5);
      if (this.hintTime > 6) this.showHint(-1);
    }
  }
}
