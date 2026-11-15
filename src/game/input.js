// One thumb, anywhere — and, when wanted, a second.
//
//   touch + drag ........ a stick appears under the thumb. Throw is analog: a nudge reaches
//                         out a pseudopod, a full throw moves the whole body.
//   flick ............... leave the glass while still moving fast: burn mass for a burst.
//   tap ................. a flinch; tap a stray fragment to become it.
//   second finger ....... the dial. Down: you firm up — gather, bead, call your strays home.
//                         Slide it down and you go supple instead — run, wet, spread thin.
//                         Lift it and you are yourself again.
//
// Keyboard and mouse mirror this for the desk: WASD / arrows to move, Space firm, C supple,
// Shift or E burst; right mouse button held is the second finger (drag it down to soften).

const R = 62;            // stick radius, CSS px
const DEAD = 5;
const DIAL = 110;        // how far down the second finger slides to go fully supple, CSS px

export class Input {
  constructor(el, stickEl, dialEl) {
    this.el = el; this.ui = stickEl; this.dialUi = dialEl;
    this.x = 0; this.y = 0;             // stick vector, |v| <= 1
    this.dial = 0;                      // −1 supple … +1 firm (the simulation eases it)
    this.onTap = null; this.onFlick = null; this.onFirst = null;
    this.stickId = -1; this.dialId = -1; this.dialY0 = 0; this.dialX = 0; this.dialY = 0;
    this.ox = 0; this.oy = 0; this.cx = 0; this.cy = 0;
    this.t0 = 0; this.travel = 0; this.hist = [];
    this.keys = new Set(); this.lastDir = [0, -1];
    this.touched = false; this.keyDial = 0;

    const opt = { passive: false };
    el.addEventListener('pointerdown', (e) => this._down(e), opt);
    el.addEventListener('pointermove', (e) => this._move(e), opt);
    el.addEventListener('pointerup', (e) => this._up(e), opt);
    el.addEventListener('pointercancel', (e) => this._up(e, true), opt);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const t of ['touchstart', 'touchmove', 'gesturestart']) el.addEventListener(t, (e) => e.preventDefault(), opt);
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.keyDial = 0; this._releaseAll(); });
  }

  _first() { if (!this.touched) { this.touched = true; this.onFirst && this.onFirst(); } }

  _down(e) {
    e.preventDefault(); this._first();
    try { this.el.setPointerCapture(e.pointerId); } catch {}
    const isMouseDial = e.pointerType === 'mouse' && e.button === 2;
    if (!isMouseDial && this.stickId < 0) {
      this.stickId = e.pointerId;
      this.ox = this.cx = e.clientX; this.oy = this.cy = e.clientY;
      this.t0 = performance.now(); this.travel = 0; this.hist.length = 0;
      this.hist.push(this.t0, e.clientX, e.clientY);
      this._show(true);
    } else if (this.dialId < 0) {
      this.dialId = e.pointerId; this.dialY0 = e.clientY; this.dialX = e.clientX; this.dialY = e.clientY;
      this.dial = 1;
      this._showDial(true);
    }
  }

  _move(e) {
    if (e.pointerId === this.dialId) {
      e.preventDefault();
      this.dialX = e.clientX; this.dialY = e.clientY;
      const t = Math.max(0, Math.min(1, (e.clientY - this.dialY0) / DIAL));
      this.dial = 1 - 2 * t;
      this._placeDial();
      return;
    }
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    // use the freshest sample the browser has, not the one it batched for this frame
    const ev = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    const last = ev && ev.length ? ev[ev.length - 1] : e;
    const x = last.clientX, y = last.clientY;
    this.travel += Math.hypot(x - this.cx, y - this.cy);
    this.cx = x; this.cy = y;
    const now = performance.now(), h = this.hist;
    h.push(now, x, y);
    while (h.length > 6 && now - h[0] > 110) h.splice(0, 3);
    let dx = x - this.ox, dy = y - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {                        // the base trails the thumb, so reversing is always one radius away
      this.ox += dx * (1 - R / d); this.oy += dy * (1 - R / d);
      dx = x - this.ox; dy = y - this.oy;
    }
    this._setStick(dx, dy);
    this._place();
  }

  _setStick(dx, dy) {
    const d = Math.hypot(dx, dy);
    if (d < DEAD) { this.x = 0; this.y = 0; return; }
    const m = Math.min(1, (d - DEAD) / (R - DEAD));
    this.x = (dx / d) * m; this.y = (dy / d) * m;
    this.lastDir = [dx / d, dy / d];
  }

  _up(e, cancelled) {
    if (e.pointerId === this.dialId) { this.dialId = -1; this.dial = 0; this._showDial(false); return; }
    if (e.pointerId !== this.stickId) return;
    const now = performance.now(), h = this.hist;
    if (!cancelled) {
      const held = now - this.t0;
      if (held < 230 && this.travel < 14) {
        this.onTap && this.onTap(e.clientX, e.clientY);
      } else if (h.length >= 6) {
        // release velocity over the last ~70 ms
        let k = h.length - 3;
        while (k > 0 && now - h[k] < 70) k -= 3;
        const dtm = (h[h.length - 3] - h[k]) / 1000;
        if (dtm > 0.012 && now - h[h.length - 3] < 60) {
          const vx = (h[h.length - 2] - h[k + 1]) / dtm, vy = (h[h.length - 1] - h[k + 2]) / dtm;
          const sp = Math.hypot(vx, vy);
          if (sp > 950) this.onFlick && this.onFlick(vx / sp, vy / sp, Math.min(1, (sp - 950) / 1900));
        }
      }
    }
    this.stickId = -1; this.x = 0; this.y = 0;
    this._show(false);
  }

  _releaseAll() { this.stickId = -1; this.x = 0; this.y = 0; this.dialId = -1; this.dial = 0; this._show(false); this._showDial(false); }

  // the dial the simulation should use: a held finger wins over keys
  get dialValue() { return this.dialId >= 0 ? this.dial : this.keyDial; }

  _key(e, down) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const map = { ArrowLeft: 'a', ArrowRight: 'd', ArrowUp: 'w', ArrowDown: 's' };
    const c = map[k] || k;
    if (!['w', 'a', 's', 'd', ' ', 'c', 'Shift', 'e'].includes(c)) return;
    e.preventDefault();
    if (down) this._first();
    if (c === ' ' || c === 'c') {
      if (down) this.keys.add(c); else this.keys.delete(c);
      this.keyDial = (this.keys.has(' ') ? 1 : 0) - (this.keys.has('c') ? 1 : 0);
      return;
    }
    if (c === 'Shift' || c === 'e') { if (down && !e.repeat) this.onFlick && this.onFlick(this.lastDir[0], this.lastDir[1], 0.7); return; }
    if (down) this.keys.add(c); else this.keys.delete(c);
    if (this.stickId >= 0) return;
    let x = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
    let y = (this.keys.has('s') ? 1 : 0) - (this.keys.has('w') ? 1 : 0);
    const d = Math.hypot(x, y);
    if (d > 0) { x /= d; y /= d; this.lastDir = [x, y]; }
    this.x = x; this.y = y;
  }

  _show(on) {
    if (!this.ui) return;
    this.ui.classList.toggle('on', on);
    if (on) this._place();
  }
  _place() {
    if (!this.ui) return;
    this.ui.style.transform = `translate3d(${this.ox}px, ${this.oy}px, 0)`;
    this.ui.firstElementChild.style.transform = `translate3d(${this.cx - this.ox}px, ${this.cy - this.oy}px, 0)`;
  }
  _showDial(on) {
    if (!this.dialUi) return;
    this.dialUi.classList.toggle('on', on);
    if (on) this._placeDial();
  }
  _placeDial() {
    if (!this.dialUi) return;
    // a short track hanging below where the finger landed; the bead marks the setting
    this.dialUi.style.transform = `translate3d(${this.dialX}px, ${this.dialY0}px, 0)`;
    const t = (1 - this.dial) / 2;
    this.dialUi.firstElementChild.style.transform = `translate3d(0, ${t * DIAL}px, 0)`;
    this.dialUi.style.setProperty('--firm', ((this.dial + 1) / 2).toFixed(3));
  }
}
