// Optional Android host integration. The native bridge object is injected only for the
// packaged app's own origin; in a browser every call falls back or does nothing.
const transport = globalThis.WizardNative;
export const isAndroid = Boolean(transport && typeof transport.postMessage === 'function');
let sequence = 0;

if (isAndroid) transport.onmessage = () => {};

function send(type, data = {}) {
  if (!isAndroid) return false;
  try {
    transport.postMessage(JSON.stringify({id: ++sequence, type, data}));
    return true;
  } catch {
    return false;
  }
}

export function haptic(pattern) {
  const list = Array.isArray(pattern) ? pattern : [pattern];
  if (send('haptic', {pattern: list})) return;
  try { if (navigator.vibrate) navigator.vibrate(list); } catch { /* unsupported */ }
}

// Keeps the screen awake while a game is in progress (Android only).
export function setSessionActive(active) { send('session', {active: Boolean(active)}); }

// Asks Android for the display's fastest refresh rate (120 Hz and up), or the default rate.
export function setHighRefresh(enabled) { send('display', {highRefresh: Boolean(enabled)}); }
