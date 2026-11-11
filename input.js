// Input: Xbox controller (Gamepad API, standard mapping), keyboard, and on-screen touch sticks as a fallback.
// Axis signs follow Unreal: stick UP = +1 on LY/RY (the Gamepad API reports up as -1, so it is flipped here).

const BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT_btn', 'RT_btn', 'View', 'Menu', 'L3', 'R3', 'DUp', 'DDown', 'DLeft', 'DRight', 'Home'];

export class Input {
  constructor() {
    this.cur = new Set(); this.prev = new Set();
    this.keys = new Set();
    this.axes = { LX: 0, LY: 0, RX: 0, RY: 0, LT: 0, RT: 0 };
    this.touchAxes = { LX: 0, LY: 0, RX: 0, RY: 0, LT: 0, RT: 0 };
    this.touchButtons = new Set();
    this.padName = ''; this.padConnected = false;
    addEventListener('keydown', e => { if (!e.repeat) this.keys.add(e.code); if (['Space', 'Tab', 'Slash', 'Quote', 'Backspace'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  getPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let best = null;
    for (const p of pads) { if (!p || !p.connected) continue; if (!best || (p.mapping === 'standard' && best.mapping !== 'standard')) best = p; }
    return best;
  }
  update() {
    this.prev = this.cur; this.cur = new Set();
    const a = { LX: 0, LY: 0, RX: 0, RY: 0, LT: 0, RT: 0 };
    const pad = this.getPad();
    this.padConnected = !!pad; this.padName = pad ? pad.id : '';
    if (pad) {
      const ax = pad.axes;
      a.LX = ax[0] || 0; a.LY = -(ax[1] || 0); a.RX = ax[2] || 0; a.RY = -(ax[3] || 0);
      const b = pad.buttons;
      a.LT = b[6] ? b[6].value : 0; a.RT = b[7] ? b[7].value : 0;
      for (let i = 0; i < BUTTONS.length && i < b.length; i++) if (b[i] && b[i].pressed) this.cur.add(BUTTONS[i]);
    }
    for (const k in a) if (Math.abs(this.touchAxes[k]) > Math.abs(a[k])) a[k] = this.touchAxes[k];
    for (const t of this.touchButtons) this.cur.add(t);
    for (const k of this.keys) this.cur.add(k);
    this.axes = a;
  }
  axis(n) { return this.axes[n] || 0; }
  down(b) { return this.cur.has(b); }
  pressed(b) { return this.cur.has(b) && !this.prev.has(b); }
  released(b) { return !this.cur.has(b) && this.prev.has(b); }
  anyActivity() { return this.cur.size > 0 || Object.values(this.axes).some(v => Math.abs(v) > 0.2); }
}

/** On-screen twin sticks for touch, used only when no controller is connected. */
export function attachTouchSticks(root, input) {
  const make = (side) => {
    const base = document.createElement('div'); base.className = `tstick ${side}`;
    const knob = document.createElement('div'); knob.className = 'knob'; base.appendChild(knob); root.appendChild(base);
    let id = null, cx = 0, cy = 0; const R = 60;
    const set = (x, y) => {
      knob.style.transform = `translate(${x * R}px, ${-y * R}px)`;
      if (side === 'left') { input.touchAxes.LX = x; input.touchAxes.LY = y; } else { input.touchAxes.RX = x; input.touchAxes.RY = y; }
    };
    base.addEventListener('pointerdown', e => { id = e.pointerId; base.setPointerCapture(id); const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(e); });
    const move = e => { if (e.pointerId !== id) return; let x = (e.clientX - cx) / R, y = -(e.clientY - cy) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } set(x, y); };
    base.addEventListener('pointermove', move);
    const end = e => { if (e.pointerId !== id) return; id = null; set(0, 0); };
    base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
  };
  make('left'); make('right');
  const btn = (label, cls, onDown, onUp) => {
    const b = document.createElement('button'); b.className = `tbtn ${cls}`; b.textContent = label; root.appendChild(b);
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); onDown(); });
    const up = () => onUp && onUp(); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  };
  btn('▲', 'up', () => { input.touchAxes.RT = 1; }, () => { input.touchAxes.RT = 0; });
  btn('▼', 'down', () => { input.touchAxes.LT = 1; }, () => { input.touchAxes.LT = 0; });
  const tap = name => [() => input.touchButtons.add(name), () => setTimeout(() => input.touchButtons.delete(name), 30)];
  btn('MODE', 'mode', ...tap('LB'));
  btn('FLIP', 'flip', ...tap('Y'));
  btn('RESET', 'reset', ...tap('View'));
}
