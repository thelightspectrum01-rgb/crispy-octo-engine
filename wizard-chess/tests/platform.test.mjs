import test from 'node:test';
import assert from 'node:assert/strict';

const entry = '../web/js/platform.js';

test('in a browser the bridge stays silent and haptics fall back to navigator.vibrate', async () => {
  delete globalThis.WizardNative;
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', {value: {vibrate: p => calls.push(p)}, configurable: true});
  const p = await import(entry + '?browser');
  assert.equal(p.isAndroid, false);
  p.haptic(40);
  p.setSessionActive(true);
  assert.deepEqual(calls, [[40]]);
});

test('inside the Android app messages go to the native bridge as JSON', async () => {
  const sent = [];
  globalThis.WizardNative = {postMessage: text => sent.push(JSON.parse(text))};
  const p = await import(entry + '?android');
  assert.equal(p.isAndroid, true);
  p.haptic([20, 30, 20]);
  p.setSessionActive(1);
  assert.equal(sent[0].type, 'haptic');
  assert.deepEqual(sent[0].data.pattern, [20, 30, 20]);
  assert.deepEqual(sent[1], {id: sent[1].id, type: 'session', data: {active: true}});
  assert.notEqual(sent[0].id, sent[1].id);
});

test('a disconnected bridge never throws into the game', async () => {
  globalThis.WizardNative = {postMessage() { throw new Error('bridge gone'); }};
  Object.defineProperty(globalThis, 'navigator', {value: {}, configurable: true});
  const p = await import(entry + '?disconnected');
  assert.doesNotThrow(() => p.haptic(10));
  assert.doesNotThrow(() => p.setSessionActive(false));
  delete globalThis.WizardNative;
});
