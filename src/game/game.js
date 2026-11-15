import { World } from '../sim/world.js';
import { Continuum } from '../sim/continuum.js';
import { SUB, PLAYER, WILD } from '../sim/substances.js';
import { Renderer } from '../gfx/renderer.js';
import { Input } from './input.js';
import { CHAMBERS } from './chambers.js';
import { Sound } from '../sfx/sound.js';

// The minimum loop: arrive, take in what the dish offers, get yourself through it, and seat
// most of yourself in the calyx. Mass is what you are, what you spend to hurry, and what you
// carry into the next dish. Everything you gain or lose is matter that really moves: nutrient
// is a bead of amber gel you have to touch and take in; what you burn leaves as spray.

const AREA0 = 15;            // starting mass, in area units
const SEAT = 0.7;            // share of all your mass that must sit in the calyx
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];

// How fine a body this device can afford: time the real solver, warmed up (a cold JIT would
// make every phone look slow), best of two windows (a background task can steal one), and pick
// the spacing whose full-size body costs a fixed share of a 60 Hz frame (two ticks). Cost goes
// with particle count, and count with 1/d0².
const SIM_BUDGET = 4.5;      // ms of each 60 Hz frame the physics may take
function chooseSpacing() {
  const N = 600, sim = new Continuum(new World({ w: 8, h: 8, prims: [] }), { d0: 0.1, maxN: 1024 });
  sim.spawnBlob(4, 4, N); sim.analyze(1 / 60);
  for (let k = 0; k < 60; k++) { sim.stickX = Math.sin(k * 0.1); sim.step(1 / 120); if (k & 1) sim.analyze(1 / 60); }
  let best = 1e9;
  for (let rep = 0; rep < 2; rep++) {
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) { sim.stickX = Math.sin(k * 0.3); sim.step(1 / 120); if (k & 1) sim.analyze(1 / 60); }
    best = Math.min(best, (performance.now() - t0) / 20);
  }
  const perParticle = best / N;                                   // ms per particle per tick
  const d0 = Math.sqrt((AREA0 * perParticle * 2) / SIM_BUDGET);
  return { d0: Math.max(0.09, Math.min(0.16, d0)), ms: best * (AREA0 / (0.1 * 0.1)) / N };
}

export class Game {
  constructor(dom, opts = {}) {
    this.dom = dom;
    const tier = opts.d0 ? { d0: opts.d0, ms: 0 } : chooseSpacing();
    this.d0 = tier.d0; this.benchMs = tier.ms;
    this.n0 = Math.round(AREA0 / (this.d0 * this.d0));
    this.world = new World(CHAMBERS[0]);
    this.sim = new Continuum(this.world, { d0: this.d0, floorN: Math.round(0.9 / (this.d0 * this.d0)) });
    this.sim.massRef = this.n0;
    // without a canvas the game runs headless (tests, autopilot): same loop, no eyes or ears
    const headless = !dom.canvas;
    this.renderer = headless ? { w: 390, h: 844, dpr: 1, draw() {}, sprite() {}, clearSprites() {} } : new Renderer(dom.canvas, this.sim.maxN);
    this.input = headless ? { x: 0, y: 0, dialValue: 0 } : new Input(dom.canvas, dom.stick, dom.dial);
    this.sound = headless ? new Proxy({}, { get: () => () => {} }) : new Sound();
    this.cam = { x: 8, y: 20, ppu: 40 };
    this.time = 0; this.flash = 0; this.pulse = 0;
    this.index = 0; this.state = 'intro'; this.stateT = 0;
    this.calyx = { x: 0, y: 0, r: 1, progress: 0, inside: 0 };
    this.chamberT = 0; this.hudT = 0; this.combo = 0; this.comboT = 0;

    this.input.onFirst = () => { this.sound.unlock(); dom.title && dom.title.classList.add('gone'); };
    this.input.onFlick = (dx, dy, s) => this._burst(dx, dy, s);
    this.input.onTap = (x, y) => this._tap(x, y);
    this.load(opts.chamber || 0, 0, true);
  }

  // area units → particles at this device's resolution
  _n(area) { return Math.max(3, Math.round(area / (this.d0 * this.d0))); }

  load(index, carry, intro = false) {
    const def = CHAMBERS[index % CHAMBERS.length], sim = this.sim;
    this.index = index;
    this.world = new World(def);
    sim.setWorld(this.world); sim.clear();
    sim.stickX = sim.stickY = 0; sim.dialTarget = sim.dial = 0;
    const [sx, sy] = def.spawn;
    if (intro) {
      // the opening: the body is not there yet. It is dew, scattered, and it finds itself.
      const total = this.n0, parts = [Math.round(total * 0.34)];
      let left = total - parts[0];
      for (let k = 0; k < 8; k++) { const n = k === 7 ? left : Math.round(left * (0.16 + 0.2 * sim.rand())); parts.push(n); left -= n; }
      // find room for each droplet first; whatever finds none stays with the heart of it, so
      // a narrow dish never quietly costs you mass
      const placed = [];
      let core = parts[0];
      for (let k = 1; k < parts.length; k++) {
        const rad = Math.sqrt((parts[k] * sim.a0) / Math.PI);
        let ok = false;
        for (let tries = 0; tries < 40 && parts[k] >= 3; tries++) {
          const a = (k / 8) * 6.2832 + sim.rand() * 0.6, d = 3.6 + 2.6 * sim.rand();
          const x = sx + Math.cos(a) * d, y = sy + Math.sin(a) * d * 1.15;
          if (this.world.dist(x, y) > rad + 0.35 && placed.every(([px, py, pr]) => Math.hypot(px - x, py - y) > pr + rad + 0.3)) {
            placed.push([x, y, rad, parts[k]]); ok = true; break;
          }
        }
        if (!ok) core += parts[k];
      }
      sim.spawnBlob(sx, sy, core);
      for (const [x, y, , n] of placed) sim.spawnBlob(x, y, n);
    } else {
      sim.spawnBlob(sx, sy, Math.max(carry, sim.floor));
    }
    // what lies in the dish: nutrient beads, foreign gel — real matter, there before you are
    for (const [x, y, area] of def.nutrients || []) sim.spawnBlob(x, y, this._n(area), { sub: SUB.amber, kin: WILD });
    for (const [x, y, area, name] of def.matter || []) sim.spawnBlob(x, y, this._n(area), { sub: SUB[name || 'lipid'], kin: WILD });
    // let the lattice relax into matter before anyone sees it
    for (let k = 0; k < 14; k++) { sim.step(1 / 120); if (k % 2) sim.analyze(1 / 60); }
    for (let i = 0; i < sim.hi; i++) { sim.vx[i] = 0; sim.vy[i] = 0; }
    sim.analyze(1 / 60); sim.drainEvents();
    sim.massBurnt = sim.massGained = sim.massEroded = 0;

    this.calyx = { x: def.calyx[0], y: def.calyx[1], r: def.calyx[2], progress: 0, inside: 0 };
    this.cam.x = sx; this.cam.y = sy;
    this.state = intro ? 'intro' : 'enter'; this.stateT = 0; this.chamberT = 0;
    this.massIn = sim.playerMass();
    this._label();
  }

  _label() {
    const d = this.dom;
    if (d.chamber) d.chamber.textContent = `${ROMAN[this.index % ROMAN.length]} · ${CHAMBERS[this.index % CHAMBERS.length].name}`;
  }

  toWorld(cx, cy) {
    const r = this.renderer, c = this.dom.canvas;
    return [this.cam.x + ((cx - c.clientWidth / 2) * r.dpr) / this.cam.ppu, this.cam.y + ((cy - c.clientHeight / 2) * r.dpr) / this.cam.ppu];
  }

  _burst(dx, dy, strength) {
    if (this.state === 'exit') return;
    const sim = this.sim, before = sim.playerMass();
    const paid = sim.burn(dx, dy, 0.03 + 0.07 * strength);
    if (paid > 0) { this.sound.burst((before - sim.playerMass()) / Math.max(1, before)); this.flash = Math.max(this.flash, 0.03); }
    else this.sound.deny();
  }

  _tap(cx, cy) {
    const [x, y] = this.toWorld(cx, cy), sim = this.sim;
    let best = -1, bd = 0.9 * 0.9;
    for (let i = 0; i < sim.hi; i++) {
      if (!sim.alive[i] || sim.kin[i] !== PLAYER) continue;
      const dx = sim.px[i] - x, dy = sim.py[i] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    const b = best >= 0 ? sim.body[best] : -1;
    if (b >= 0 && b !== sim.primary && sim.bCount[b] >= 6 && sim.setPrimary(b)) {
      this.sound.tick(0.5);                                             // become that piece
    } else if (b === sim.primary) {
      sim.poke(x, y, 0.85, 5); this.sound.tick(0.35);                   // a fingertip pressed in
    } else {
      this.pulse = 0.16; sim.startle(0.6); this.sound.tick(0.25);       // a flinch
    }
  }

  // Advance one displayed frame: `ticks` physics ticks of `tickDt`, then everything that only
  // needs to happen once per frame.
  update(frameDt, ticks, tickDt) {
    const sim = this.sim, inp = this.input;
    this.time += frameDt; this.stateT += frameDt;
    this.pulse = Math.max(0, this.pulse - frameDt);
    const locked = this.state === 'exit';
    sim.stickX = locked ? 0 : inp.x; sim.stickY = locked ? 0 : inp.y;
    sim.dialTarget = this.pulse > 0 ? 1 : inp.dialValue;
    for (let k = 0; k < ticks; k++) sim.step(tickDt);
    sim.analyze(frameDt);
    const ev = sim.drainEvents();
    this.sound.feed(ev, sim, frameDt);
    if (ev.assimilated > 0) this._ate(ev.assimilated);
    this.flash *= Math.exp(-frameDt * 5);

    if (this.state === 'intro' && (this.stateT > 2.6 || this._myBodies() <= 2)) { this.state = 'play'; this.stateT = 0; }
    if (this.state === 'enter' && this.stateT > 0.5) { this.state = 'play'; this.stateT = 0; }
    if (this.state !== 'intro') this.chamberT += frameDt;

    this._calyx(frameDt);
    this._camera(frameDt);
    this._hud(frameDt);
  }

  _myBodies() { let n = 0; for (let b = 0; b < this.sim.nBodies; b++) if (this.sim.bKin[b] === PLAYER) n++; return n; }

  // taking matter in: a chime that climbs while you keep eating
  _ate(n) {
    if (this.time - (this._lastAte ?? -9) > 2.5) this.combo = 0;
    if (this.time - (this._lastChime ?? -9) > 0.3) { this.sound.chime(this.combo++); this._lastChime = this.time; }
    this._lastAte = this.time;
    this.sim.startle(Math.min(0.3, n * 0.01));
  }

  _calyx(dt) {
    const sim = this.sim, c = this.calyx, { px, py, alive, kin } = sim;
    let inside = 0;
    const r2 = c.r * c.r;
    for (let i = 0, hi = sim.hi; i < hi; i++) {
      if (!alive[i] || kin[i] !== PLAYER) continue;
      const dx = px[i] - c.x, dy = py[i] - c.y;
      if (dx * dx + dy * dy < r2) inside++;
    }
    c.inside = inside / Math.max(1, sim.playerMass());
    if (this.state === 'play') {
      const was = c.progress;
      c.progress = Math.max(0, Math.min(1, c.progress + (c.inside >= SEAT ? dt / 0.9 : -dt / 0.6)));
      this.sound.seat(c.progress, c.progress > was);
      if (c.progress >= 1) {
        this.state = 'exit'; this.stateT = 0;
        this.world.fields.push({ t: 'well', x: c.x, y: c.y, g: 70, core: 1.4, range: 40, tmp: true });
        this.sound.complete();
        this._summary();
      }
    } else if (this.state === 'exit') {
      this.flash = Math.max(this.flash, Math.min(1, this.stateT / 0.9) ** 2 * 0.9);
      if (this.stateT > 0.95) {
        let carry = 0;
        const R2 = r2 * 2.2;
        for (let i = 0, hi = sim.hi; i < hi; i++) {
          if (!alive[i] || kin[i] !== PLAYER) continue;
          const dx = px[i] - c.x, dy = py[i] - c.y;
          if (dx * dx + dy * dy < R2) carry++;
        }
        this.load(this.index + 1, carry);
        this.flash = 0.9;
      }
    }
  }

  _summary() {
    const d = this.dom.summary;
    if (!d) return;
    const t = this.chamberT, mass = Math.round((100 * this.sim.playerMass()) / this.n0);
    d.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}  ·  mass ${mass}`;
    d.classList.add('on');
    clearTimeout(this._sumT); this._sumT = setTimeout(() => d.classList.remove('on'), 2200);
  }

  _camera(dt) {
    const sim = this.sim, r = this.renderer, cam = this.cam, w = this.world;
    const b = sim.primary;
    let tx = cam.x, ty = cam.y, R = 2.2;
    if (sim.nBodies && sim.bKin[b] === PLAYER) {
      R = sim.bR[b];
      let lx = sim.bVx[b] * 0.2, ly = sim.bVy[b] * 0.2;
      const ll = Math.hypot(lx, ly); if (ll > 1.3) { lx *= 1.3 / ll; ly *= 1.3 / ll; }
      tx = sim.bCx[b] + lx; ty = sim.bCy[b] + ly;
    }
    if (this.state === 'exit') { tx = this.calyx.x; ty = this.calyx.y; }
    const span = 13.2 * (0.7 + 0.3 * (R / 2.19));
    const ppu = Math.min(r.w, r.h) / span;
    cam.ppu += (ppu - cam.ppu) * (1 - Math.exp(-dt * 2.5));
    if (this.stateT === 0 || !isFinite(cam.ppu)) cam.ppu = ppu;
    const hx = r.w / (2 * cam.ppu), hy = r.h / (2 * cam.ppu), m = 0.6;
    tx = hx * 2 >= w.w + 2 * m ? w.w / 2 : Math.max(hx - m, Math.min(w.w - hx + m, tx));
    ty = hy * 2 >= w.h + 2 * m ? w.h / 2 : Math.max(hy - m, Math.min(w.h - hy + m, ty));
    const k = 1 - Math.exp(-dt * 5.5);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  }

  _hud(dt) {
    this.hudT -= dt;
    const d = this.dom, sim = this.sim;
    if (this.hudT <= 0) {
      this.hudT = 0.15;
      if (d.mass) d.mass.textContent = `mass ${Math.round((100 * sim.playerMass()) / this.n0)}`;
      if (d.clock) { const t = this.chamberT; d.clock.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }
    }
    // a mark on the rim of the screen toward the calyx while it is out of sight
    if (d.hint) {
      const r = this.renderer, c = this.calyx, cam = this.cam;
      const sx = ((c.x - cam.x) * cam.ppu) / r.dpr, sy = ((c.y - cam.y) * cam.ppu) / r.dpr;
      const hw = d.canvas.clientWidth / 2, hh = d.canvas.clientHeight / 2;
      const out = Math.abs(sx) > hw - 10 || Math.abs(sy) > hh - 10;
      d.hint.classList.toggle('on', out && this.state === 'play');
      if (out) {
        const s = Math.min((hw - 22) / Math.max(1e-6, Math.abs(sx)), (hh - 22) / Math.max(1e-6, Math.abs(sy)));
        d.hint.style.transform = `translate3d(${hw + sx * s}px, ${hh + sy * s}px, 0) rotate(${Math.atan2(sy, sx)}rad)`;
      }
    }
  }

  render(frameDt) {
    const r = this.renderer, c = this.calyx, t = this.time;
    r.clearSprites();
    for (const f of this.world.fields) if (f.t === 'well' && !f.tmp) {
      const push = f.g < 0;
      r.sprite(f.x, f.y, f.range * 0.55, 2, push ? 0.6 : 0.20, push ? 0.3 : 0.06, push ? 0.2 : 0.34, 0.5);
      r.sprite(f.x, f.y, f.core * 1.1, 2, push ? 1.0 : 0.55, push ? 0.6 : 0.25, push ? 0.4 : 0.9, 0.9);
    }
    const near = c.inside > 0.02 ? 1 : 0.55;
    r.sprite(c.x, c.y, c.r * 1.17, 1, 0.55 * near, 1.0 * near, 0.86 * near, c.progress);
    r.draw(this.sim, this.cam, t, frameDt, { firm: this.sim.dial, flash: this.flash });
  }
}
