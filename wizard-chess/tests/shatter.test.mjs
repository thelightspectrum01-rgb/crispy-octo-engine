import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PieceFactory} from '../web/js/pieces.js';
import {fracture, Shatter} from '../web/js/shatter.js';
import {PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE} from '../web/js/chess.js';

const dummy = new THREE.Texture();
const factory = new PieceFactory({textures: {whiteMarble: dummy, blackMarble: dummy, stoneNormal: dummy}, segments: 24});
const prismVolume = v => {
  // Fracture cells use 10-sided prisms; their cross-section is 93.5% of the circle.
  const k = (10 / (2 * Math.PI)) * Math.sin((2 * Math.PI) / 10);
  return k * Math.PI * (v.y1 - v.y0) * (v.r0 * v.r0 + v.r0 * v.r1 + v.r1 * v.r1) / 3;
};

test('every piece model has geometry, glow parts and fracture volumes', () => {
  for (const type of [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING]) {
    const model = factory.models[type];
    assert.ok(model.stone.attributes.position.count > 1000, 'detailed body');
    assert.ok(model.glow.attributes.position.count > 0, 'eyes or windows');
    for (const key of ['position', 'normal', 'uv', 'color']) assert.ok(model.stone.attributes[key], key);
    assert.ok(model.volumes.length >= 3);
    model.stone.computeBoundingBox();
    const box = model.stone.boundingBox;
    assert.ok(Math.abs(box.max.y - model.height) < 0.03, `height matches for type ${type}: ${box.max.y}`);
    assert.ok(box.min.y > -0.001, 'rests on the board');
  }
});

test('glossy pieces get a clear-coated finish and shards a matte fracture material', () => {
  const glossy = new PieceFactory({textures: {whiteMarble: dummy, blackMarble: dummy, stoneNormal: dummy}, segments: 16, glossy: true});
  for (const m of glossy.stoneMaterials) {
    assert.equal(m.type, 'MeshPhysicalMaterial');
    assert.equal(m.clearcoat, 1);
    assert.ok(m.clearcoatRoughness < 0.1 && m.roughness < 0.35);
  }
  for (const m of glossy.fractureMaterials) assert.ok(m.roughness > 0.7, 'fresh breaks are matte');
  assert.equal(factory.stoneMaterials[0].type, 'MeshStandardMaterial', 'lower presets keep the cheaper material');
  const [chunk] = fracture(glossy.models[QUEEN], 12, null);
  const groups = chunk.geometry.groups;
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(g => g.materialIndex), [0, 1]);
  assert.equal(groups[0].count + groups[1].count, chunk.geometry.attributes.position.count);
});

test('Voronoi chunks tile each lathe piece without gaps', () => {
  for (const type of [PAWN, BISHOP, ROOK, QUEEN, KING]) {
    const model = factory.models[type];
    const expected = model.volumes.reduce((s, v) => s + prismVolume(v), 0);
    const chunks = fracture(model, 20, new THREE.Vector3(0, model.height * 0.6, 0.2));
    assert.ok(chunks.length >= 10, `chunk count for type ${type}: ${chunks.length}`);
    const total = chunks.reduce((s, c) => s + c.vol, 0);
    assert.ok(Math.abs(total - expected) / expected < 0.02, `volume ${total} vs ${expected}`);
    for (const c of chunks) {
      const pos = c.geometry.attributes.position.array;
      assert.ok(pos.length >= 36 && pos.every(Number.isFinite));
      assert.ok(c.radius > 0 && c.radius < model.height);
    }
  }
  const knight = fracture(factory.models[KNIGHT], 18, null);
  assert.ok(knight.length >= 10);
});

test('rubble falls, settles on the board and dissolves', () => {
  const scene = new THREE.Scene();
  const impacts = [];
  let dissolved = 0;
  const shatter = new Shatter(scene, {onImpact: s => impacts.push(s), onDissolve: () => dissolved++});
  const piece = factory.create(QUEEN, WHITE);
  piece.root.position.set(0.5, 0, 0.5);
  scene.add(piece.root);
  const chunks = shatter.shatter(piece, {point: new THREE.Vector3(0.5, 0.7, 0.8), dir: new THREE.Vector3(0, 0, -1), strength: 3});
  assert.ok(chunks.length > 10);
  for (let t = 0; t < 3; t += 1 / 60) shatter.update(1 / 60, [{x: 0.5, z: -0.5, r: 0.3, h: 1}]);
  assert.ok(impacts.length > 0, 'ground impacts reported');
  for (const c of shatter.chunks) {
    assert.ok(c.mesh.position.y > -1.0, 'no chunk fell through the floor');
    assert.ok(Number.isFinite(c.mesh.position.x) && Number.isFinite(c.mesh.quaternion.w));
  }
  const resting = shatter.chunks.filter(c => c.sleeping).length;
  assert.ok(resting > shatter.chunks.length / 2, `most chunks at rest: ${resting}/${shatter.chunks.length}`);
  for (let t = 0; t < 10; t += 1 / 60) shatter.update(1 / 60);
  assert.equal(shatter.active, 0, 'all rubble dissolved');
  assert.ok(dissolved >= chunks.length);
});

test('a fracture prepared as the duel begins is the one used at impact', () => {
  const scene = new THREE.Scene();
  const shatter = new Shatter(scene);
  const piece = factory.create(KING, WHITE);
  scene.add(piece.root);
  shatter.prepare(piece, new THREE.Vector3(0, 0.8, 0.2));
  const prepared = shatter.prepared.get(piece);
  assert.ok(prepared.length >= 10);
  const chunks = shatter.shatter(piece, {point: new THREE.Vector3(0, 0.8, -0.2), dir: new THREE.Vector3(0, 0, 1), strength: 2});
  assert.deepEqual(chunks.map(c => c.mesh.geometry), prepared.map(p => p.geometry));
  assert.equal(shatter.prepared.has(piece), false, 'a prepared fracture is used once');
});
