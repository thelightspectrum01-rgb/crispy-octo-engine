import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS, TRACKS, mirrorLayout } from '../src/track/layout.js';
import { simulateBot } from '../src/game/race.js';

const classic = buildTrack(DESK_RAILS);
const mirror = buildTrack(mirrorLayout(DESK_RAILS));

test('the registry offers classic and mirror with distinct record names', () => {
  assert.deepEqual(TRACKS.map((t) => t.id), ['classic', 'mirror']);
  assert.notEqual(TRACKS[0].layout.name, TRACKS[1].layout.name);
});

test('the mirrored circuit closes and has the same length and bounds', () => {
  const c = mirror.plan.closure;
  assert.ok(Math.abs(c.dx) < 1e-6 && Math.abs(c.dz) < 1e-6 && Math.abs(c.dpsi) < 1e-3);
  assert.ok(Math.abs(mirror.length - classic.length) < 0.2, `${mirror.length} vs ${classic.length}`);
  assert.ok(Math.abs(mirror.bounds.max.x - classic.bounds.max.x) < 0.1);
  assert.ok(Math.abs(mirror.bounds.max.z - classic.bounds.max.z) < 0.1);
});

test('mirroring flips the turns: lateral curvature and bank change sign', () => {
  let flipped = 0;
  let total = 0;
  for (let i = 0; i < classic.piece.n; i += 20) {
    // the circuits start at the same place; the first turn (horseshoe) is the other way round
    const a = classic.piece.kSide[i];
    const b = mirror.piece.kSide[i];
    if (Math.abs(a) > 0.05 && Math.abs(b) > 0.05) {
      total++;
      if (Math.sign(a) !== Math.sign(b)) flipped++;
    }
  }
  assert.ok(total > 10 && flipped / total > 0.9, `${flipped}/${total}`);
});

test('the bot drives the mirror circuit as fast as the classic one', () => {
  const a = simulateBot(classic, 3, { skill: 1 });
  const b = simulateBot(mirror, 3, { skill: 1 });
  assert.ok(Math.abs(a.total - b.total) / a.total < 0.01, `${a.total} vs ${b.total}`);
});
