import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS } from '../src/track/layout.js';
import { PHYS } from '../src/config.js';

const track = buildTrack(DESK_RAILS);
const pc = track.piece;

test('circuit closes exactly (position and heading)', () => {
  const c = track.plan.closure;
  assert.ok(Math.abs(c.dx) < 1e-6, `dx ${c.dx}`);
  assert.ok(Math.abs(c.dz) < 1e-6, `dz ${c.dz}`);
  assert.ok(Math.abs(c.dpsi) < 1e-3, `dpsi ${c.dpsi}`);
  assert.ok(c.free.A > 0 && c.free.B > 0, 'free straights must be positive');
});

test('baked samples are a smooth closed loop of the expected size', () => {
  assert.ok(track.length > 150 && track.length < 300, `length ${track.length}`);
  // consecutive samples are one ds apart, including the wrap-around
  for (let i = 0; i < pc.n; i += 37) {
    const j = (i + 1) % pc.n;
    const d = Math.hypot(pc.pos[3 * j] - pc.pos[3 * i], pc.pos[3 * j + 1] - pc.pos[3 * i + 1], pc.pos[3 * j + 2] - pc.pos[3 * i + 2]);
    assert.ok(Math.abs(d - pc.ds) < 0.02, `spacing ${d} at ${i}`);
  }
});

test('frames are orthonormal (tangent / up / right)', () => {
  for (let i = 0; i < pc.n; i += 11) {
    const T = [pc.tan[3 * i], pc.tan[3 * i + 1], pc.tan[3 * i + 2]];
    const U = [pc.up[3 * i], pc.up[3 * i + 1], pc.up[3 * i + 2]];
    const R = [pc.right[3 * i], pc.right[3 * i + 1], pc.right[3 * i + 2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    assert.ok(Math.abs(dot(T, T) - 1) < 1e-3);
    assert.ok(Math.abs(dot(U, U) - 1) < 1e-3);
    assert.ok(Math.abs(dot(R, R) - 1) < 1e-3);
    assert.ok(Math.abs(dot(T, U)) < 1e-3, `T.U ${dot(T, U)} at ${i}`);
    assert.ok(Math.abs(dot(T, R)) < 1e-3);
  }
});

test('the loop is a real inversion and carries no lateral load', () => {
  assert.equal(pc.inversions.length, 1);
  const iv = pc.inversions[0];
  const top = Math.round((iv.s0 + iv.s1) / 2 / pc.ds);
  assert.ok(pc.up[3 * top + 1] < -0.5, 'cart is upside down at the top of the loop');
  let maxSide = 0;
  for (let i = Math.round(iv.s0 / pc.ds) + 10; i < Math.round(iv.s1 / pc.ds) - 10; i++) maxSide = Math.max(maxSide, Math.abs(pc.kSide[i]));
  assert.ok(maxSide < 0.15, `lateral curvature inside the loop ${maxSide}`);
});

test('banking is bounded and the station straight is level', () => {
  let maxBank = 0;
  for (let i = 0; i < pc.n; i++) maxBank = Math.max(maxBank, Math.abs(pc.bank[i]));
  assert.ok(maxBank <= (58 * Math.PI) / 180 + 1e-6);
  for (let s = 0.5; s < 6; s += 0.5) {
    const i = Math.round(s / pc.ds);
    assert.ok(Math.abs(pc.bank[i]) < 0.02, `bank at station ${pc.bank[i]}`);
  }
});

test('speed profile respects the lateral grip budget', () => {
  const total = (PHYS.GRIP + PHYS.LEAN) * PHYS.G;
  for (let i = 0; i < pc.n; i += 3) {
    const v = pc.profile.v[i];
    const f = Math.abs(v * v * pc.kSide[i] + PHYS.G * pc.gSide[i]);
    assert.ok(f <= total * 1.001, `lateral force ${f} > ${total} at s=${i * pc.ds}`);
  }
});

test('zones, pickups and checkpoints are inside the lap', () => {
  assert.ok(pc.zones.some((z) => z.type === 'launch' && z.s0 < z.s1));
  for (const s of [...track.pickups, ...track.checkpoints]) assert.ok(s > 0 && s < track.length);
  assert.equal(track.checkpoints.length, 3);
});
