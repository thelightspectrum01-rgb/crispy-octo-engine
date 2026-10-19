// Unified input: keyboard, touch buttons and gamepad → { lean, brake, boost } plus one-shot actions.

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, boost: false, brake: false };
    this.state = { lean: 0, brake: 0, boost: false };
    this.handlers = new Map(); // action -> callbacks
    this.pad = null;
    this.lastPadButtons = [];
    this.touchMode = false;
    this.enabled = true;
    this._onKeyDown = (e) => this.onKey(e, true);
    this._onKeyUp = (e) => this.onKey(e, false);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => this.reset());
  }

  on(action, cb) {
    if (!this.handlers.has(action)) this.handlers.set(action, []);
    this.handlers.get(action).push(cb);
  }

  fire(action) {
    for (const cb of this.handlers.get(action) ?? []) cb();
  }

  reset() {
    this.keys.clear();
    this.touch.left = this.touch.right = this.touch.boost = this.touch.brake = false;
  }

  onKey(e, down) {
    const code = e.code;
    const game = [
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyS',
      'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyC', 'KeyP', 'Escape', 'KeyM', 'KeyG', 'Enter', 'KeyH',
    ].includes(code);
    if (!game) return;
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
    if (down) {
      if (!e.repeat) {
        if (code === 'KeyR') this.fire('restart');
        else if (code === 'KeyC') this.fire('camera');
        else if (code === 'KeyP' || code === 'Escape') this.fire('pause');
        else if (code === 'KeyM') this.fire('mute');
        else if (code === 'KeyG') this.fire('ghost');
        else if (code === 'KeyH') this.fire('hints');
        else if (code === 'Enter' || code === 'Space') this.fire('confirm');
      }
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
  }

  /** Called once per frame; returns the live input state. */
  poll() {
    const k = this.keys;
    const t = this.touch;
    let lean = 0;
    if (k.has('ArrowLeft') || k.has('KeyA') || t.left) lean -= 1;
    if (k.has('ArrowRight') || k.has('KeyD') || t.right) lean += 1;
    let brake = k.has('ArrowDown') || k.has('KeyS') || k.has('ShiftLeft') || k.has('ShiftRight') || t.brake ? 1 : 0;
    let boost = k.has('Space') || k.has('ArrowUp') || k.has('KeyW') || t.boost;

    // gamepad (first connected)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.15) lean += Math.max(-1, Math.min(1, ax));
      if (pad.buttons[14]?.pressed) lean -= 1;
      if (pad.buttons[15]?.pressed) lean += 1;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.2 || pad.buttons[0]?.pressed || pad.buttons[5]?.pressed) boost = true;
      if (lt > 0.1) brake = Math.max(brake, lt);
      if (pad.buttons[1]?.pressed || pad.buttons[4]?.pressed) brake = 1;
      const pressed = pad.buttons.map((b) => b.pressed);
      const edge = (i) => pressed[i] && !this.lastPadButtons[i];
      if (edge(9)) this.fire('pause');
      if (edge(3)) this.fire('camera');
      if (edge(2)) this.fire('restart');
      if (edge(0)) this.fire('confirm');
      this.lastPadButtons = pressed;
    }
    this.state.lean = Math.max(-1, Math.min(1, lean));
    this.state.brake = brake;
    this.state.boost = boost;
    return this.state;
  }

  /** Bind a DOM element as a press-and-hold touch button. */
  bindTouch(el, key) {
    const set = (v) => {
      this.touch[key] = v;
      el.classList.toggle('down', v);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      set(true);
      this.touchMode = true;
    });
    const up = (e) => {
      e.preventDefault();
      set(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
