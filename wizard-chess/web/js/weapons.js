// Summoned stone weapons with glowing runes. Each points along +Y from its grip (the origin).
import * as THREE from 'three';
import {mergeGeometries} from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import {REFLECT_LAYER} from './reflection.js';

function prep(g, matrix) {
  let out = g.index ? g.toNonIndexed() : g;
  if (matrix) out.applyMatrix4(matrix);
  for (const key of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(key)) out.deleteAttribute(key);
  if (!out.attributes.normal) out.computeVertexNormals();
  const count = out.attributes.position.count;
  const colors = new Float32Array(count * 3).fill(1);
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return out;
}

const at = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));

function bladeGeometry(width, length, base) {
  const shape = new THREE.Shape();
  shape.moveTo(-width, base);
  shape.lineTo(-width * 0.85, base + length * 0.82);
  shape.lineTo(0, base + length);
  shape.lineTo(width * 0.85, base + length * 0.82);
  shape.lineTo(width, base);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {depth: width * 0.25, bevelEnabled: true, bevelThickness: width * 0.22, bevelSize: width * 0.16, bevelSegments: 1, curveSegments: 1});
  g.translate(0, 0, -width * 0.125);
  return g;
}

function build(kind) {
  const stone = [], glow = [];
  let length;
  if (kind === 'spear') {
    stone.push(prep(new THREE.CylinderGeometry(0.011, 0.012, 0.95, 8), at(0, 0.15, 0)));
    stone.push(prep(new THREE.ConeGeometry(0.02, 0.05, 8), at(0, 0.64, 0, Math.PI)));
    const leaf = new THREE.LatheGeometry([[0, 0], [0.03, 0.04], [0.034, 0.07], [0.02, 0.13], [0, 0.18]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
    leaf.scale(1, 1, 0.32);
    stone.push(prep(leaf, at(0, 0.65, 0)));
    glow.push(prep(new THREE.BoxGeometry(0.006, 0.1, 0.03), at(0, 0.73, 0)));
    length = 0.83;
  } else if (kind === 'staff') {
    stone.push(prep(new THREE.CylinderGeometry(0.013, 0.015, 1.05, 8), at(0, 0.03, 0)));
    stone.push(prep(new THREE.SphereGeometry(0.026, 10, 8), at(0, 0.56, 0)));
    const crook = new THREE.CatmullRomCurve3([[0, 0.57], [0, 0.68], [0.025, 0.77], [0.08, 0.8], [0.125, 0.76], [0.12, 0.69], [0.085, 0.67], [0.07, 0.7]]
      .map(([x, y]) => new THREE.Vector3(x, y, 0)));
    stone.push(prep(new THREE.TubeGeometry(crook, 24, 0.014, 6, false)));
    glow.push(prep(new THREE.SphereGeometry(0.024, 10, 8), at(0.065, 0.735, 0)));
    for (let i = 0; i < 3; i++) glow.push(prep(new THREE.TorusGeometry(0.016, 0.003, 4, 12), at(0, 0.2 + i * 0.1, 0, Math.PI / 2)));
    length = 0.8;
  } else {
    const s = kind === 'greatsword' ? 1.4 : 1;
    stone.push(prep(new THREE.CylinderGeometry(0.013 * s, 0.013 * s, 0.13 * s, 8), at(0, -0.015 * s, 0)));
    stone.push(prep(new THREE.SphereGeometry(0.022 * s, 10, 8), at(0, -0.095 * s, 0)));
    stone.push(prep(new THREE.BoxGeometry(0.18 * s * (kind === 'greatsword' ? 1.25 : 1), 0.022 * s, 0.036 * s), at(0, 0.055 * s, 0)));
    stone.push(prep(bladeGeometry(0.026 * s, 0.6 * s, 0.065 * s)));
    glow.push(prep(new THREE.BoxGeometry(0.006 * s, 0.42 * s, 0.022 * s), at(0, 0.33 * s, 0)));
    for (const x of [-0.09, 0.09]) glow.push(prep(new THREE.SphereGeometry(0.009 * s, 6, 6), at(x * s * (kind === 'greatsword' ? 1.25 : 1), 0.055 * s, 0)));
    length = 0.665 * s;
  }
  return {stone: mergeGeometries(stone), glow: mergeGeometries(glow), length};
}

export class WeaponKit {
  constructor(pieceFactory) {
    this.factory = pieceFactory;
    this.models = {};
    for (const kind of ['spear', 'staff', 'sword', 'greatsword']) this.models[kind] = build(kind);
  }

  create(kind, color) {
    return new Weapon(this, kind, color);
  }
}

export class Weapon {
  constructor(kit, kind, color) {
    const model = kit.models[kind];
    this.kind = kind;
    this.color = color;
    this.length = model.length;
    this.group = new THREE.Group();
    this.body = new THREE.Mesh(model.stone, kit.factory.stoneMaterials[color]);
    this.body.castShadow = true;
    this.glowMaterial = kit.factory.glowMaterials[color].clone();
    this.glowMaterial.color.multiplyScalar(1.4);
    this.glow = new THREE.Mesh(model.glow, this.glowMaterial);
    this.body.layers.enable(REFLECT_LAYER);
    this.glow.layers.enable(REFLECT_LAYER);
    this.group.add(this.body, this.glow);
    this.group.scale.setScalar(0.001);
  }

  tip(target = new THREE.Vector3()) { return this.group.localToWorld(target.set(0, this.length, 0)); }
  base(target = new THREE.Vector3()) { return this.group.localToWorld(target.set(0, this.length * 0.3, 0)); }

  dispose() {
    this.group.removeFromParent();
    this.glowMaterial.dispose();
  }
}
