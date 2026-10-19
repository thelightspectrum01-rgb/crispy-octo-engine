import test from 'node:test';
import assert from 'node:assert/strict';
import { Ghost, GhostRecorder, GHOST_HZ, encodeGhost, decodeGhost } from '../src/game/ghost.js';

test('ghost samples survive encode / decode', () => {
  const rec = new GhostRecorder();
  let p = 0;
  for (let i = 0; i < 600; i++) {
    p += 0.2 + 0.1 * Math.sin(i / 20);
    rec.record(i / GHOST_HZ, p, 1 / GHOST_HZ);
  }
  const samples = rec.finish();
  const back = decodeGhost(encodeGhost(samples));
  assert.equal(back.length, samples.length);
  for (let i = 0; i < samples.length; i += 17) assert.ok(Math.abs(back[i] - samples[i]) < 1 / 64 + 1e-6);
});

test('timeAt inverts progressAt on a monotone ghost', () => {
  const samples = Float32Array.from({ length: 300 }, (_, i) => i * 0.25 + Math.sin(i / 9));
  const g = new Ghost(samples);
  for (const t of [1, 2.5, 4.2, 7.7]) {
    const p = g.progressAt(t);
    const back = g.timeAt(p);
    assert.ok(Math.abs(back - t) < 0.05, `${t} -> ${back}`);
  }
  assert.equal(g.timeAt(1e6), null);
});

test('a derail rewind does not break the lookup (monotone envelope)', () => {
  const s = [];
  for (let i = 0; i < 100; i++) s.push(i * 0.3);
  for (let i = 0; i < 40; i++) s.push(20 + i * 0.3); // rewound, then recovers
  const g = new Ghost(Float32Array.from(s));
  const t = g.timeAt(25);
  assert.ok(t !== null && Number.isFinite(t));
});
