import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameGovernor} from '../web/js/perf.js';

// Drives the governor like requestAnimationFrame: one tick per vsync, a render whenever it
// agrees, and a GPU that needs `gpuMs` per frame (a frame that misses vsync waits for the next).
function run(gov, {hz, seconds, gpuMs = 1, start = 1000}) {
  const vsync = 1000 / hz;
  let now = start, busyUntil = 0, renders = 0;
  const changes = [];
  for (let i = 0; i < seconds * hz; i++) {
    now += vsync + (i % 7 === 0 ? 0.3 : 0) - (i % 11 === 0 ? 0.3 : 0);
    if (now < busyUntil) continue; // the previous frame is still on the GPU
    if (!gov.tick(now)) continue;
    renders++;
    const change = gov.frame(now);
    if (change !== null) changes.push(change);
    busyUntil = now + gpuMs * (gov.scale * gov.scale);
  }
  return {now, renders, changes};
}

test('detects common refresh rates', () => {
  for (const hz of [60, 90, 120, 144, 240]) {
    const gov = new FrameGovernor();
    run(gov, {hz, seconds: 1});
    assert.equal(gov.refreshHz, hz);
    assert.equal(gov.targetHz, hz);
  }
});

test('renders every vsync at 120 Hz and reports about 120 fps', () => {
  const gov = new FrameGovernor();
  const {renders} = run(gov, {hz: 120, seconds: 3, gpuMs: 4});
  assert.ok(renders > 350, `renders ${renders}`);
  assert.ok(Math.abs(gov.fps - 120) < 4, `fps ${gov.fps}`);
  assert.equal(gov.scale, 1, 'no reason to lower resolution');
});

test('the 60 fps cap paces a 120 Hz and a 144 Hz display', () => {
  for (const hz of [120, 144]) {
    const gov = new FrameGovernor({cap: '60'});
    const {renders} = run(gov, {hz, seconds: 4});
    assert.ok(Math.abs(renders / 4 - 60) < 4, `${hz} Hz -> ${renders / 4} fps`);
    assert.equal(gov.targetHz, 60);
  }
});

test('lowers the render scale when the GPU cannot hold 120 fps, then settles', () => {
  const gov = new FrameGovernor();
  gov.startProbe();
  // 12 ms per frame at full scale: every frame misses a 8.3 ms vsync, so callbacks arrive at
  // 60 Hz; the startup probe is what tells the governor the screen can do 120.
  const {changes} = run(gov, {hz: 120, seconds: 12, gpuMs: 12});
  assert.ok(changes.length > 0 && changes[0] < 1, JSON.stringify(changes));
  assert.ok(gov.scale <= 0.85 && gov.scale >= 0.5, `scale ${gov.scale}`);
  assert.ok(gov.fps > 100, `recovered frame rate ${gov.fps}`);
});

test('climbs back to full resolution once there is headroom', () => {
  const gov = new FrameGovernor();
  gov.scale = 0.6;
  const {changes} = run(gov, {hz: 120, seconds: 30, gpuMs: 3});
  assert.ok(changes.every((s, i) => i === 0 || s >= changes[i - 1]), 'only rises');
  assert.equal(gov.scale, 1);
});

test('stays put when dynamic resolution is off, and never goes below the floor', () => {
  const off = new FrameGovernor({dynamic: false});
  run(off, {hz: 120, seconds: 6, gpuMs: 30});
  assert.equal(off.scale, 1);
  const floor = new FrameGovernor({minScale: 0.5});
  floor.startProbe();
  run(floor, {hz: 120, seconds: 30, gpuMs: 60});
  assert.equal(floor.scale, 0.5);
});

test('the probe skips rendering and can lower the estimate after moving to a 60 Hz screen', () => {
  const gov = new FrameGovernor();
  run(gov, {hz: 144, seconds: 1});
  assert.equal(gov.refreshHz, 144);
  gov.startProbe(24);
  assert.equal(gov.probing, true);
  const {renders} = run(gov, {hz: 60, seconds: 0.5, start: gov.lastTick + 100});
  assert.ok(renders <= 7, `only the frames after the 24-frame probe render (${renders})`);
  assert.equal(gov.refreshHz, 60);
});

test('a tab switch pause does not count as missed frames', () => {
  const gov = new FrameGovernor();
  run(gov, {hz: 120, seconds: 2, gpuMs: 2});
  gov.frame(gov.lastRender + 5000);
  const {changes} = run(gov, {hz: 120, seconds: 2, gpuMs: 2, start: gov.lastRender});
  assert.deepEqual(changes, []);
  assert.equal(gov.scale, 1);
});
