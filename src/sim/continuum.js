// CONTINUUM — all matter in the dish, however many pieces and however many kinds it is in.
//
// Clear slime is a transient polymer network: long chains held together by crosslinks that keep
// forming, stretching, forgetting and breaking. This solver is that, nearly literally.
//
//   MATTER          equal-area particles, so particle count IS area IS mass.
//   THE NETWORK     neighbours hold each other by bonds. A bond is elastic at once (jiggle, recoil),
//                   forgets its length over a relaxation time τ (wait, and the gel flows), yields
//                   past a strain, snaps when yanked, and when drawn out slowly thins into a strand
//                   until nothing is left of it. Bonds form wherever compatible matter meets — that
//                   is all healing, fusion and re-fusion are — at a rate set by chemistry, kinship,
//                   both skins, the medium, how hard they press and how fast they met.
//   INCOMPRESSIBLE  a density constraint holds every particle's area. It pushes apart everywhere
//                   (contact between pieces is nothing more than that) and pulls together only in
//                   a piece's own bulk, up to a tensile limit past which the bulk cavitates. A wall
//                   counts as matter beside a particle, as far as it is wetted.
//   COHESION        at every scale: bonds pull neighbours; a living body pulls its overflow home;
//                   and an exact body-scale capillary mode (affine, traceless, ω² = 6σ/R³, damped
//                   at a fixed ratio) makes every piece ring like a drop and round up.
//   WALLS           signed-distance geometry with independent axes: tangential (friction) and
//                   normal (tack: anchors that slide along slick glass, or hold fast in a trap),
//                   plus sharp, abrasive, coating, heat and drink.
//   THE WILL        the thumb recruits the leading part of a body, drives it toward a target speed,
//                   pumps room into it and loosens it; the rest grips the medium and is towed.
//   THE MEDIUM      zones rewrite local law; fields are wells, white holes and vortices.
//
// Integration is position-based (XPBD) in substeps: unconditionally stable, so blades, wedges and
// violent input cannot blow it up. The body-scale modes are explicit, exact and recomputed every
// substep (a lagged spring pumps energy in).
//
// Mass changes only through burn(), erosion, drinking surfaces and wells, infuse() and the
// assimilation of wild matter, and no lineage can be taken below its floor.

import { CHEM, WILD, PLAYER, MAXKIN } from './substances.js';
import { SURF } from './surfaces.js';

export const PARAMS = {
  d0: 0.12,           // particle spacing: each particle is d0² of area
  maxN: 8192,
  hK: 2.4,            // kernel radius (× d0)
  substeps: 2,        // per tick (more when something moves fast)
  iters: 1,           // constraint iterations per substep (small steps beat many iterations)
  // incompressibility
  relax: 0.6,         // under-relaxation of each (Jacobi) density correction: past ~0.7 it rings
  cfm: 0.06,          // softening of the density constraint (× its rest-lattice stiffness)
  tensile: 0.35,      // how far below rest density the bulk holds before it cavitates (necks and
                      // strands are the network's business, not this)
  clump: 0.06,        // short-range push that keeps particles from pairing up
  // the network
  bondHz: 11,         // natural frequency of one bond (× √stiff)
  bondDamp: 5,        // extensional viscosity along bonds (1/s)
  formR: 1.3,         // bonds form between neighbours nearer than this (× d0)
  bondRate: 30,       // how fast bonds form inside a piece (1/s)
  // cohesion
  tension: 260,       // σ: sets the body-scale capillary mode, ω² = 6σ/R³
  shapeMax: 0.45,     // the mode's restoring pull saturates past this deformation (beyond it, the
                      // shape is the network's and the local tension's business)
  shapeZeta: 0.16,    // damping ratio of that mode
  modeZeta: 0.09,     // and of the finer ones: ζ_l = modeZeta·l/2 (viscosity damps fine ripples hardest)
  modeMax: 90,        // …and none of them ever pulls harder than this (u/s²)
  gather: 80,         // how hard a living body pulls its overflow home (1/s²)
  surfRate: 40,       // local surface tension: how fast a lump or a dent flattens (1/s)
  fill: 6,            // how hard the lip of a hole or hollow is drawn across it (× gather)
  visc: 26,           // shear smoothing inside a piece (1/s)
  // medium
  drag: 1.5, drag2: 0.03,
  // the will
  accel: 150,         // the most the will can accelerate what it moves
  reach: 5.2,         // the speed it drives toward at full stick (u/s)
  drive: 50,          // how hard it closes the gap to that speed (1/s)
  anchor: 30,         // how hard the unrecruited part grips the medium while reaching (1/s)
  edgeGrip: 30,       // how hard the trailing edge holds back at full throw (1/s)…
  gripMax: 25,        // …up to the most that pinning bears before the edge slips (u/s²)
  fountain: 0.5,      // core faster than flanks at full throw: the body circulates as it goes
  wU0: 0.55, wU1: 1.6,    // where recruitment begins along the stick (body radii): nudge … full throw
  tail: 0.12,         // how much of the will reaches the unrecruited rear at full throw
  pump: 0.16,         // how much room the will makes in the part that reaches
  fluid: 0.75,        // how much the reaching part loosens its network
  relaxT: 0.6,        // while it reaches, a body relaxes its cortex: tension × (1 − relaxT·throw)
  agility: 0.25,      // small bodies are nimble, large ones heavy: accel × (ref/mass)^agility
  homeAccel: 26,      // how hard a stray fragment swims home
  kinG: 2.4, kinSoft: 1.1, kinMax: 12,
  // walls
  wallR: 0.3,         // hard radius (× d0)
  contact: 0.85,      // within this (× d0) a particle touches its wall
  adhesion: 18,       // acceleration scale of wetting (× surface tack × substance tack)
  adhRange: 2.4,      // reach of wetting (× d0)
  frictionK: 6.0,
  gripRate: 1.6,      // how fast dwell builds on a gripping surface (1/s)
  anchorRate: 4,      // how fast tack takes hold (1/s × tack)
  anchorK: 300,       // stiffness of that hold (1/s² × tack): a pull past reach/stiffness frees it
  anchorReach: 1.4,   // how far (× d0 × tack) an anchor can be drawn before it lets go
  // temperature
  heatDiff: 1.5, heatAmbient: 0.12, heatContact: 3.0,
  // mass–energy
  burnC: 56,          // dv = burnC · sqrt(burnt / remaining) · price⁻½
  floorN: 96,         // the survival floor of a lineage, in particles
  // breathing
  breath: 0.045, breathPeriod: 3.6,
  // skin
  skinHeal: 8.0, coatWear: 0.35, snapSkin: 0.3,
  // colour
  dyeDiff: 0.6, dyeRelax: 0.16,
  // fusion between pieces
  fuseRate: 10,       // 1/s at a fully open gate
};

export const MAXB = 48;     // bodies tracked individually (the rest share the last slot)
export const SLOTS = 6;     // bonds a particle can hold at once
const MAX_EX = 1024;

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// Chemistry acts through thresholds, not tiny rates (a trace of affinity, integrated over many
// contacts, would otherwise fuse anything with anything). The medium and pressure push across.
const gateAff = (x) => smooth01((x - 0.25) * 2);
const gateKin = (x) => smooth01((x - 0.3) * 2);

export class Continuum {
  constructor(world, params = {}) {
    const P = (this.P = { ...PARAMS, ...params });
    if (params.dx && !params.d0) P.d0 = params.dx / 2;          // older callers speak in grid cells
    const N = (this.maxN = P.maxN), d0 = (this.d0 = P.d0);
    this.a0 = d0 * d0;
    const h = (this.h = P.hK * d0);
    this.h2 = h * h;
    this.kW = 4 / (Math.PI * h ** 8);                            // poly6 (2D), density
    this.kG = -30 / (Math.PI * h ** 5);                          // spiky gradient (2D)
    this.W0 = this.kW * this.h2 ** 3;
    this.sp = d0 * Math.sqrt(2 / Math.sqrt(3));                  // hex lattice with d0² per particle
    this._calibrate();

    const f32 = (n) => new Float32Array(n), u8 = (n) => new Uint8Array(n), i32 = (n) => new Int32Array(n);
    const keep = (this._keep = []);
    const K = (a) => { keep.push(a); return a; };
    this.n = 0;
    // ── state that travels with a particle
    this.px = K(f32(N)); this.py = K(f32(N)); this.vx = K(f32(N)); this.vy = K(f32(N));
    this.sub = K(u8(N)); this.kin = K(u8(N));
    this.heat = K(f32(N)); this.skin = K(f32(N)); this.snx = K(f32(N)); this.sny = K(f32(N));
    this.coat = K(f32(N)); this.stick = K(f32(N)); this.glow = K(f32(N));
    this.cr = K(f32(N)); this.cg = K(f32(N)); this.cb = K(f32(N));
    this.seed = K(f32(N)); this.spin = K(f32(N)); this.strainS = K(f32(N)); this.will = K(f32(N));
    this.brt = K(f32(N).fill(1)); this.jr = K(f32(N).fill(1));
    this.body = K(new Int16Array(N).fill(-1)); this.piece = K(i32(N).fill(-1)); this.prim = K(u8(N));
    this.phi = K(f32(N).fill(1)); this.bnx = K(f32(N)); this.bny = K(f32(N));
    this.anc = K(u8(N)); this.aX = K(f32(N)); this.aY = K(f32(N)); this.aL = K(f32(N));
    this.nb = K(u8(N));
    this.wd = K(f32(N).fill(9)); this.wnx = K(f32(N)); this.wny = K(f32(N)); this.wm = K(u8(N));
    // ── bonds: SLOTS per particle, each bond held at both of its ends
    this.bj = new Int32Array(N * SLOTS).fill(-1); this.bl = f32(N * SLOTS); this.blam = f32(N * SLOTS);
    // ── scratch
    this.ox = f32(N); this.oy = f32(N); this.dpx = f32(N); this.dpy = f32(N);
    this.rho = f32(N);
    this.ax = f32(N); this.ay = f32(N); this.fx = f32(N); this.fy = f32(N); this.uvx = f32(N); this.uvy = f32(N);
    this._acc = new Float64Array(N * 10); this._cf = new Float64Array(N * 2); this._dp = new Float64Array(N * 2);
    this.strain = this.strainS;
    // ── the effective law, per particle, every tick
    this.eK = f32(N); this.eRel = f32(N); this.eYld = f32(N); this.eBrk = f32(N); this.eLen = f32(N);
    this.eVis = f32(N); this.eDrg = f32(N); this.eTak = f32(N); this.eWet = f32(N); this.eSlp = f32(N);
    this.eSig = f32(N); this.eHea = f32(N); this.eTns = f32(N); this.eFus = f32(N); this.eLnk = u8(N);
    this.alive = u8(N).fill(1);             // compatibility: every index below n is alive
    // ── neighbour pairs (rebuilt every tick; the renderer reads them too)
    const MP = (this.maxPairs = N * 14);
    this.pi = i32(MP); this.pj = i32(MP); this.pw = f32(MP); this.pux = f32(MP); this.puy = f32(MP); this.pph = u8(MP);
    this.nPairs = 0;
    // ── analysis scratch
    this._uf = i32(N); this._root = i32(N); this._csz = i32(N); this._top = i32(MAXB); this._slot = i32(N);
    this._ord = i32(N); this._invo = i32(N); this._tmp = new Float64Array(N);
    this._tmpB = i32(N * SLOTS); this._tmpL = f32(N * SLOTS);
    this._mom = new Float64Array(MAXB * 14); this._bodyA = new Float64Array(MAXB * 8);
    this._rb = new Float64Array(MAXB * 32); this._vb = new Float64Array(MAXB * 32);
    this._modes = new Float64Array(MAXB * 18); this._lmax = new Int32Array(MAXB);
    this._cosT = new Float64Array(9 * 32); this._sinT = new Float64Array(9 * 32);
    for (let l = 0; l < 9; l++) for (let k = 0; k < 32; k++) {
      const th = -Math.PI + ((k + 0.5) * 2 * Math.PI) / 32;
      this._cosT[l * 32 + k] = Math.cos(l * th); this._sinT[l * 32 + k] = Math.sin(l * th);
    }
    this._freshPiece = 1 << 24;

    // ── bodies
    this.nBodies = 0; this.nComps = 0; this.primary = 0;
    this.bCount = i32(MAXB);
    this.bCx = f32(MAXB); this.bCy = f32(MAXB); this.bVx = f32(MAXB); this.bVy = f32(MAXB);
    this.bR = f32(MAXB); this.bVote = i32(MAXB); this.bKin = u8(MAXB);
    this.bKinN = i32(MAXB * MAXKIN); this.bSkin = f32(MAXB); this.bSum = f32(MAXB); this.bAsp = f32(MAXB);
    this.kinCount = i32(MAXKIN);
    this._lossQ = i32(MAXKIN);

    // ── exhaust: mass on its way out of existence (kind 0 burnt, 1 ground away, 2 drunk)
    this.exN = 0;
    this.exX = f32(MAX_EX); this.exY = f32(MAX_EX); this.exVx = f32(MAX_EX); this.exVy = f32(MAX_EX);
    this.exLife = f32(MAX_EX); this.exKind = u8(MAX_EX);
    this.pending = [];
    this._eat = []; this._eatKind = [];

    // ── the owner's will and the state it puts its matter in
    this.stickX = 0; this.stickY = 0; this.reachS = 0; this._full = 0; this._fountain = 0; this._relax = 0;
    this.dialTarget = 0; this.dial = 0;
    this.arousal = 0; this.lastStand = 0; this.massRef = 1500;
    this.time = 0; this.ticks = 0; this.vmax = 0;
    this.massGained = 0; this.massBurnt = 0; this.massEroded = 0;
    this.ev = {
      snaps: 0, snapE: 0, snapX: 0, snapY: 0, breaks: 0,
      fusions: 0, fuseX: 0, fuseY: 0,
      impact: 0, impactN: 0, impactX: 0, impactY: 0, cuts: 0, eroded: 0, drunk: 0, assimilated: 0,
      strainMax: 0, strainN: 0, shear: 0, contact: 0,
    };
    this._rng = 0x2545f491;
    this._law = new Float32Array(16); this._lawTab = new Float32Array(64 * 3 * 16);
    this.setWorld(world);
  }

  get hi() { return this.n; }
  get count() { return this.n; }
  get floor() { return this.P.floorN; }
  get nBonds() { let s = 0; for (let i = 0; i < this.n; i++) s += this.nb[i]; return s >> 1; }
  playerMass() { return this.kinCount[PLAYER]; }
  rand() { let x = this._rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this._rng = x; return (x >>> 0) / 4294967296; }

  // The rest state of the kernel on the very lattice spawned matter sits on: rest density, the
  // stiffness of the density constraint there, how lopsided a particle's neighbourhood is at a
  // flat free surface, and how much density a wall lends a particle at distance d.
  _calibrate() {
    const { h, h2, kW, kG, W0, sp } = this, rowH = (sp * Math.sqrt(3)) / 2;
    let rho = W0, g2 = 0, nx = 0, ny = 0, hw = W0, hy = 0;
    const R = Math.ceil(h / rowH) + 1;
    for (let j = -R; j <= R; j++) for (let i = -R - 1; i <= R + 1; i++) {
      if (i === 0 && j === 0) continue;
      const x = (i + (j & 1) * 0.5) * sp, y = j * rowH, r2 = x * x + y * y;
      if (r2 >= h2) continue;
      const t = h2 - r2, r = Math.sqrt(r2), q = h - r, gm = (kG * q * q) / r, w = kW * t * t * t;
      rho += w; g2 += gm * gm * r2;
      if (j >= 0) { nx += gm * x; ny += gm * y; hw += w; hy += w * y; }
    }
    this.rho0 = rho; this.D0 = g2 / (rho * rho); this.nSurf = Math.hypot(nx, ny);
    // how far inward the neighbourhood's centre sits for a particle on a flat free surface: a
    // bump sits further out than this, a dent less — that difference is the local curvature
    this.cFlat = hy / hw;
    // the wall lends the density of matter filling the far side of it: ρw(d) = ρ0 ∫_{y>d} W
    const NS = 256, line = new Float64Array(NS + 1);
    for (let k = 0; k <= NS; k++) {
      const y = (k / NS) * h, xm = Math.sqrt(Math.max(0, h2 - y * y));
      let s = 0; const M = 64;
      for (let m = 0; m < M; m++) { const x = ((m + 0.5) / M) * xm, t = h2 - x * x - y * y; if (t > 0) s += kW * t * t * t; }
      line[k] = (2 * s * xm) / M;
    }
    const T = (this.wallTab = new Float32Array(65)), G = (this.wallGrad = new Float32Array(65));
    let acc = 0;
    const cum = new Float64Array(NS + 1);
    for (let k = NS - 1; k >= 0; k--) { acc += 0.5 * (line[k] + line[k + 1]) * (h / NS); cum[k] = acc; }
    for (let k = 0; k <= 64; k++) {
      const m = Math.min(NS, Math.round((k / 64) * NS));
      T[k] = this.rho0 * cum[m];
      G[k] = -this.rho0 * line[m];
    }
  }

  // ───────────────────────────────────── the world ─────────────────────────────────────

  setWorld(world) {
    this.world = world;
    const cs = this.h;
    this.ics = 1 / cs;
    this.gw = Math.ceil(world.w / cs) + 3; this.gh = Math.ceil(world.h / cs) + 3;
    this.NG = this.gw * this.gh;
    if (!this.cStart || this.cStart.length < this.NG + 1) { this.cStart = new Int32Array(this.NG + 1); this.cCur = new Int32Array(this.NG + 1); }
    if (!this.cKey) { this.cKey = new Int32Array(this.maxN); this.cSorted = new Int32Array(this.maxN); }
    for (let i = 0; i < this.n; i++) { this.wd[i] = 9; this.anc[i] = 0; }
  }

  // ─────────────────────────────────── particles ───────────────────────────────────

  add(x, y, vx = 0, vy = 0, sub = 0, kin = PLAYER) {
    if (this.n >= this.maxN) return -1;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.sub[i] = sub; this.kin[i] = kin;
    this.heat[i] = 0; this.skin[i] = 0; this.snx[i] = 0; this.sny[i] = 0; this.coat[i] = 0; this.stick[i] = 0;
    this.glow[i] = 0; this.cr[i] = CHEM.absR[sub]; this.cg[i] = CHEM.absG[sub]; this.cb[i] = CHEM.absB[sub];
    this.seed[i] = this.rand(); this.spin[i] = 0; this.strainS[i] = 0; this.will[i] = 0;
    this.brt[i] = 1; this.jr[i] = 1;
    this.body[i] = -1; this.piece[i] = -1; this.prim[i] = 0; this.phi[i] = 1; this.bnx[i] = 0; this.bny[i] = 0;
    this.anc[i] = 0; this.nb[i] = 0; this.wd[i] = 9; this.wnx[i] = 0; this.wny[i] = 0; this.wm[i] = 0;
    const o = i * SLOTS;
    for (let s = 0; s < SLOTS; s++) { this.bj[o + s] = -1; this.bl[o + s] = 0; }
    this.kinCount[kin]++;
    return i;
  }

  _bonded(i, j) { const o = i * SLOTS, bj = this.bj; for (let s = 0; s < SLOTS; s++) if (bj[o + s] === j) return true; return false; }
  _bond(i, j, L) {
    const S = SLOTS, bj = this.bj;
    let si = -1, sj = -1;
    for (let s = 0; s < S; s++) if (bj[i * S + s] < 0) { si = s; break; }
    for (let s = 0; s < S; s++) if (bj[j * S + s] < 0) { sj = s; break; }
    if (si < 0 || sj < 0) return false;
    bj[i * S + si] = j; this.bl[i * S + si] = L; this.blam[i * S + si] = 0;
    bj[j * S + sj] = i; this.bl[j * S + sj] = L; this.blam[j * S + sj] = 0;
    this.nb[i]++; this.nb[j]++;
    return true;
  }
  // break the bond in slot s of particle i
  _unbondSlot(i, s) {
    const S = SLOTS, bj = this.bj, j = bj[i * S + s];
    if (j < 0) return;
    bj[i * S + s] = -1; this.nb[i]--;
    for (let t = 0; t < S; t++) if (bj[j * S + t] === i) { bj[j * S + t] = -1; this.nb[j]--; break; }
  }
  _unbondAll(i) { for (let s = 0; s < SLOTS; s++) this._unbondSlot(i, s); }
  _setRest(i, s, j, L) {
    const S = SLOTS, bj = this.bj;
    this.bl[i * S + s] = L;
    for (let t = 0; t < S; t++) if (bj[j * S + t] === i) { this.bl[j * S + t] = L; break; }
  }

  // Remove particle i by moving the last one into its place (its bonds follow it).
  remove(i) {
    this._unbondAll(i);
    const l = --this.n, S = SLOTS, bj = this.bj, bl = this.bl;
    this.kinCount[this.kin[i]]--;
    if (i !== l) {
      for (const A of this._keep) A[i] = A[l];
      for (let s = 0; s < S; s++) {
        const j = bj[l * S + s];
        bj[i * S + s] = j; bl[i * S + s] = bl[l * S + s]; bj[l * S + s] = -1;
        if (j >= 0) for (let t = 0; t < S; t++) if (bj[j * S + t] === l) { bj[j * S + t] = i; break; }
      }
    }
    for (const p of this.pending) if (p.carrier === l) p.carrier = i; else if (p.carrier === i) p.carrier = -1;
  }

  clear() {
    this.n = 0; this.kinCount.fill(0); this.exN = 0; this.pending.length = 0; this._eat.length = 0; this._eatKind.length = 0;
    this.nBodies = 0; this.nComps = 0; this.primary = 0; this.vmax = 0; this.arousal = 0; this.lastStand = 0; this.nPairs = 0;
  }

  // A relaxed bead of n particles, already a gel. opts: { sub, kin, vx, vy }. Returns its indices.
  spawnBlob(cx, cy, n, opts = {}) {
    const sub = opts.sub ?? 0, kin = opts.kin ?? PLAYER, vx = opts.vx ?? 0, vy = opts.vy ?? 0;
    const sp = this.sp, rowH = (sp * Math.sqrt(3)) / 2, R = Math.ceil(Math.sqrt(n / Math.PI) * 1.25) + 3;
    const pts = [];
    for (let j = -R; j <= R; j++) for (let i = -R - 1; i <= R + 1; i++) {
      const x = (i + (j & 1) * 0.5 + 0.25) * sp, y = (j + 0.5) * rowH;
      pts.push([x * x + y * y + 1e-7 * (i * 7 + j * 13), x, y]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    const out = [], first = this.n, id = this._freshPiece++;
    for (let k = 0; k < n && k < pts.length; k++) {
      const jx = (this.rand() - 0.5) * 0.24 * sp, jy = (this.rand() - 0.5) * 0.24 * sp;   // amorphous, not crystal
      const i = this.add(cx + pts[k][1] + jx, cy + pts[k][2] + jy, vx, vy, sub, kin);
      if (i < 0) break;
      this.piece[i] = id;
      out.push(i);
    }
    this._bondFresh(first, this.n);
    return out;
  }

  // Bond freshly made matter to its own neighbours at once (a new bead is already a gel). Two
  // passes at random, so the network is amorphous rather than combed in one direction.
  _bondFresh(a, b) {
    if (b <= a) return;
    this._pairs();
    const { pi, pj, nPairs, px, py, sub } = this, fr2 = (this.P.formR * this.d0) ** 2, L = CHEM.links;
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < nPairs; k++) {
      const i = pi[k], j = pj[k];
      if (i < a || j < a || i >= b || j >= b) continue;
      if (this.nb[i] >= L[sub[i]] || this.nb[j] >= L[sub[j]]) continue;
      const dx = px[j] - px[i], dy = py[j] - py[i], r2 = dx * dx + dy * dy;
      if (r2 > fr2 || (pass === 0 && this.rand() < 0.5) || this._bonded(i, j)) continue;
      this._bond(i, j, Math.sqrt(r2));
    }
  }

  // ───────────────────────────────────── the tick ─────────────────────────────────────

  // Advance by dt, in more substeps when something moves fast enough to outrun its neighbours.
  step(dt) {
    const lim = 0.35 * this.d0;
    let ns = Math.ceil((this.vmax * dt) / lim);
    if (ns < this.P.substeps) ns = this.P.substeps; else if (ns > 8) ns = 8;
    this._tick(dt, ns);
  }

  _tick(dt, ns) {
    this._dt = dt;
    if ((this.ticks & 15) === 0 && this.n > 0) this._reorder();
    this.dial += (this.dialTarget - this.dial) * Math.min(1, dt * 14);
    const sm = Math.min(1, Math.hypot(this.stickX, this.stickY));
    this.reachS += (sm - this.reachS) * Math.min(1, dt * (sm > this.reachS ? 18 : 5));
    this.arousal *= 1 / (1 + dt * 0.9);
    this._feed();
    this._prepare(dt);
    this._pairs();
    this._willSetup();
    const ds = dt / ns, iters = this.P.iters;
    let vm = 0;
    for (let s = 0; s < ns; s++) {
      this._forces(ds);
      this._predict(ds);
      for (let it = 0; it < iters; it++) {
        this._density(it === iters - 1);
        if (it === iters - 1) this._surface(ds);
        this._solveBonds(ds);
        this._solveAnchors(ds);
        this._solveWalls();
      }
      vm = this._post(ds);
    }
    this.vmax = vm;
    this._network(dt);
    this._walls(dt);
    if ((this.ticks & 3) === 0) this._diffuse(dt * 4);
    this._consume();
    this._exhaust(dt);
    this.time += dt; this.ticks++;
  }

  // The law for one particle — substance, bent by its temperature (hs = sensitivity × heat), the
  // medium around it and, if it is the player's, the dial and its vitality.
  _lawOf(s, mine, hs, mVis, mDrg, mTen, mTak, mHea, dt) {
    const P = this.P, C = CHEM, o = this._law;
    const w = 2 * Math.PI * P.bondHz;
    let k = 0.5 * w * w * C.stiff[s] * Math.exp(-0.7 * hs);
    let tau = C.tau[s] * Math.exp(-1.3 * hs);
    let yld = C.yieldStrain[s] * (hs < 0 ? 1 + 0.4 * hs : 1 - 0.35 * hs);
    let brk = C.breakStrain[s] * (hs < 0 ? 1 + 0.6 * hs : 1 + 0.2 * hs);   // cold turns brittle
    let len = C.strandLen[s] * (hs < 0 ? 1 + 0.5 * hs : 1 + 0.4 * hs);    // warm draws further
    let vis = P.visc * C.visc[s] * Math.exp(-0.9 * hs) * mVis;
    let sig = C.tension[s] * (1 - 0.3 * hs) * mTen;
    let tak = C.tack[s] * (1 + 0.3 * hs) * mTak;
    let wet = C.wet[s];
    let hea = C.heal[s] * mHea;
    let tns = P.tensile * C.tensile[s] * (hs < 0 ? 1 + 0.8 * hs : 1 - 0.3 * hs);
    let lnk = C.links[s];
    if (mine === 2) {
      // a stray of yours, on its way home: loosened so that it can squeeze through what it must
      sig *= 0.55; k *= 0.6; tau *= 0.7; yld *= 0.8;
    } else if (mine) {
      const d = this.dial, dp = d > 0 ? d : 0, dn = d < 0 ? -d : 0, L = this.lastStand;
      // reaching, a body relaxes its cortex (firm holds it; travelling whole, it keeps it)
      sig *= 1 - P.relaxT * this._relax * (1 - 0.7 * dp);
      // firm gathers, holds and beads up; supple runs, wets, reaches and draws out long
      sig *= 1 + 1.0 * dp - 0.7 * dn;
      k *= 1 + 1.5 * dp - 0.5 * dn;
      tau *= 1 + 2.5 * dp - 0.6 * dn;
      yld *= 1 + 1.0 * dp - 0.3 * dn;
      brk *= 1 + 0.5 * dp + 0.2 * dn;
      len *= 1 - 0.2 * dp + 0.6 * dn;
      vis *= 1 + 0.5 * dp - 0.4 * dn;
      tak *= 1 - 0.6 * dp + 2.5 * dn;
      wet += (0 - wet) * 0.7 * dp + (1 - wet) * 0.8 * dn;
      hea *= 1 + 3 * dp;
      tns *= 1 + 0.6 * dp;
      // near the floor, what is left of you holds together like a seed
      if (L > 0) { sig *= 1 + 0.8 * L; k *= 1 + 0.6 * L; tns *= 1 + L; brk *= 1 + L; }
    }
    o[0] = k; o[1] = Math.exp(-dt / tau); o[2] = yld; o[3] = brk; o[4] = len; o[5] = vis;
    o[6] = C.drag[s] * mDrg; o[7] = tak; o[8] = wet < 0 ? 0 : wet > 1 ? 1 : wet; o[9] = C.slip[s];
    o[10] = sig; o[11] = hea; o[12] = tns; o[13] = lnk;
    return o;
  }

  // The effective law for every particle this tick. Most matter is at ambient temperature in
  // open medium, so each substance's law (and owner's) is worked out once and copied.
  _prepare(dt) {
    const C = CHEM, n = this.n, world = this.world, P = this.P;
    const { px, py, sub, kin, heat, coat, ax, ay } = this;
    const { eK, eRel, eYld, eBrk, eLen, eVis, eDrg, eTak, eWet, eSlp, eSig, eHea, eTns, eFus, eLnk } = this;
    const tab = this._lawTab, NS = C.n;
    for (let s = 0; s < NS; s++) for (let m = 0; m < 3; m++) tab.set(this._lawOf(s, m, 0, 1, 1, 1, 1, 1, dt), (s * 3 + m) * 16);
    const prim = this.primary, owned = this.nBodies > 0 && this.bKin[prim] === PLAYER, body = this.body;
    const zones = world.zones, nz = zones.length;
    const G = world.gravity, g0x = G[0], g0y = G[1];
    const amb = 1 - Math.exp(-dt * P.heatAmbient);
    for (let i = 0; i < n; i++) {
      const s = sub[i], mine = kin[i] !== PLAYER ? 0 : owned && body[i] !== prim && body[i] >= 0 ? 2 : 1;
      let mVis = 1, mDrg = 1, mTen = 1, mTak = 1, mFus = 1, mHea = 1, gx = g0x, gy = g0y, zoned = false;
      let T = heat[i];
      if (nz) {
        const x = px[i], y = py[i];
        for (let z = 0; z < nz; z++) {
          const Z = zones[z], w = world.zoneWeight(Z, x, y);
          if (w <= 0) continue;
          zoned = true;
          mVis *= 1 + (Z.visc - 1) * w; mDrg *= 1 + (Z.drag - 1) * w; mTen *= 1 + (Z.tension - 1) * w;
          mTak *= 1 + (Z.tack - 1) * w; mFus *= 1 + (Z.fuse - 1) * w; mHea *= 1 + (Z.heal - 1) * w;
          gx += Z.gx * w; gy += Z.gy * w;
          if (Z.heatRate > 0) T += (Z.heat - T) * (1 - Math.exp(-dt * Z.heatRate * w));
        }
      }
      T -= T * amb;
      if (T < 1e-3 && T > -1e-3) T = 0;
      heat[i] = T;
      ax[i] = gx; ay[i] = gy;
      let o, b = 0;
      if (T === 0 && !zoned) { o = tab; b = (s * 3 + mine) * 16; }
      else o = this._lawOf(s, mine, C.heatSens[s] * (T < -1 ? -1 : T > 1 ? 1 : T), mVis, mDrg, mTen, mTak, mHea, dt);
      eK[i] = o[b]; eRel[i] = o[b + 1]; eYld[i] = o[b + 2]; eBrk[i] = o[b + 3]; eLen[i] = o[b + 4]; eVis[i] = o[b + 5];
      eDrg[i] = o[b + 6];
      const c = coat[i];
      eTak[i] = o[b + 7] * (c > 0 ? 1 - 0.85 * c : 1); eWet[i] = o[b + 8]; eSlp[i] = o[b + 9] * (c > 0 ? 1 - 0.9 * c : 1);
      eSig[i] = o[b + 10]; eHea[i] = o[b + 11]; eTns[i] = o[b + 12]; eLnk[i] = o[b + 13]; eFus[i] = mFus;
    }
  }

  // ── neighbours: a counting-sorted grid of kernel-sized cells, and every pair within reach ──
  // A pair whose straight line passes through a wall is no pair at all: matter does not feel
  // through glass, and a blade truly parts what is driven onto it.
  _pairs() {
    const { n, px, py, gw, gh, ics, cStart, cCur, cKey, cSorted, pi, pj, pph, piece, wd, NG } = this;
    cStart.fill(0, 0, NG + 1);
    for (let p = 0; p < n; p++) {
      let ci = Math.floor(px[p] * ics) + 1, cj = Math.floor(py[p] * ics) + 1;
      ci = ci < 0 ? 0 : ci >= gw ? gw - 1 : ci; cj = cj < 0 ? 0 : cj >= gh ? gh - 1 : cj;
      const c = cj * gw + ci; cKey[p] = c; cStart[c + 1]++;
    }
    for (let c = 0; c < NG; c++) cStart[c + 1] += cStart[c];
    for (let c = 0; c < NG; c++) cCur[c] = cStart[c];
    for (let p = 0; p < n; p++) cSorted[cCur[cKey[p]]++] = p;
    const hb = this.h * 1.1, hb2 = hb * hb, near = this.h, MP = this.maxPairs;
    let np = 0;
    for (let i = 0; i < n; i++) {
      const c = cKey[i], ci = c % gw, cj = (c - ci) / gw;
      const x = px[i], y = py[i], pc = piece[i], nw = wd[i] < near;
      for (let dj = -1; dj <= 1; dj++) {
        const rj = cj + dj;
        if (rj < 0 || rj >= gh) continue;
        for (let di = -1; di <= 1; di++) {
          const ri = ci + di;
          if (ri < 0 || ri >= gw) continue;
          const cc = rj * gw + ri;
          for (let q = cStart[cc], e = cStart[cc + 1]; q < e; q++) {
            const j = cSorted[q];
            if (j <= i) continue;
            const dx = px[j] - x, dy = py[j] - y;
            if (dx * dx + dy * dy >= hb2) continue;
            if ((nw || wd[j] < near) && this._blocked(x, y, px[j], py[j])) continue;
            if (np >= MP) continue;
            pi[np] = i; pj[np] = j; pph[np] = pc >= 0 && pc === piece[j] ? 1 : 0; np++;
          }
        }
      }
    }
    this.nPairs = np;
  }
  // the deepest a straight chord between two points runs inside a wall (and that wall's material)
  _chordDepth(x0, y0, x1, y1) {
    const w = this.world;
    let best = 1, bx = x0, by = y0;
    for (let k = 1; k <= 3; k++) {
      const t = k * 0.25, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, d = w.dist(x, y);
      if (d < best) { best = d; bx = x; by = y; }
    }
    this._chordMat = best < 0 ? w.material(bx, by) : 0;
    return best;
  }
  _blocked(x0, y0, x1, y1) {
    const w = this.world;
    return w.dist(0.5 * (x0 + x1), 0.5 * (y0 + y1)) < 0 || w.dist(0.8 * x0 + 0.2 * x1, 0.8 * y0 + 0.2 * y1) < 0 ||
      w.dist(0.2 * x0 + 0.8 * x1, 0.2 * y0 + 0.8 * y1) < 0;
  }

  // ── which part of "me" the thumb moves, and what it does to that part ──
  _willSetup() {
    const P = this.P, n = this.n;
    const { px, py, body, will, eK, eRel, bCx, bCy, bR, bKin, bCount } = this;
    const nB = this.nBodies, prim = this.primary;
    const sx = this.stickX, sy = this.stickY, sm = Math.min(1, Math.sqrt(sx * sx + sy * sy));
    const sdx = sm > 1e-4 ? sx / sm : 0, sdy = sm > 1e-4 ? sy / sm : 0;
    const dp = this.dial > 0 ? this.dial : 0, dn = this.dial < 0 ? -this.dial : 0;
    const pOwned = nB > 0 && bKin[prim] === PLAYER;
    const reaching = (this._reaching = pOwned && sm > 0.01);
    this._pOwned = pOwned;
    // A gentle stick recruits only a narrow leading cap and reaches out with it while the rest
    // anchors (a pseudopod). A full shove recruits the whole body, like a drop on tilted glass:
    // everything flows forward, only the trailing edge holds back, and it draws into a teardrop.
    let wsum = 0, wn = 0;
    const u0 = P.wU0 - P.wU1 * sm - 0.45 * dp + 0.2 * dn, uInv = 1 / (0.35 + 0.6 * sm + 0.3 * dp);
    const lat = 0.38 + 1.4 * sm * sm + 0.6 * dp - 0.12 * dn, iLat2 = 1 / (lat * lat);
    const pcx = nB ? bCx[prim] : 0, pcy = nB ? bCy[prim] : 0, iR = nB ? 1 / bR[prim] : 0;
    for (let i = 0; i < n; i++) {
      if (!reaching || body[i] !== prim) { will[i] = 0; continue; }
      const rx = (px[i] - pcx) * iR, ry = (py[i] - pcy) * iR;
      const u = rx * sdx + ry * sdy, v = ry * sdx - rx * sdy;
      const w = smooth01((u - u0) * uInv) * Math.exp(-v * v * iLat2);
      will[i] = w; wsum += w; wn++;
    }
    this._wmean = wn ? wsum / wn : 0;
    // what the reaching part is made of: loosened, quicker to forget (a pseudopod; a full throw
    // moves the whole body and keeps it whole)
    const full = (this._full = reaching ? smooth01((sm - 0.3) * 1.8) : 0);
    this._relax = reaching ? smooth01(this.reachS * 5) * (1 - 0.8 * full) : 0;
    const fl = P.fluid * (1 - 0.6 * dp) * (1 - 0.75 * full);
    if (reaching) for (let i = 0; i < n; i++) {
      const w = will[i];
      if (w <= 0) continue;
      eK[i] *= 1 - fl * w;
      eRel[i] = Math.pow(eRel[i], 1 + 3 * fl * w);
    }
    this._pump = reaching ? P.pump * Math.sqrt(sm) * (1 - 0.5 * dp) : 0;
    let agile = pOwned ? Math.pow(this.massRef / Math.max(16, bCount[prim]), P.agility) : 1;
    agile = agile < 0.65 ? 0.65 : agile > 1.6 ? 1.6 : agile;
    this._aWill = reaching ? P.accel * agile * (1 + 0.15 * dn) : 0;
    this._vT = P.reach * sm * agile * (1 + 0.12 * dn - 0.1 * dp);
    this._tail = P.tail * sm * sm + 0.35 * dp * sm;
    // what is not recruited grips the medium (a nudge: the body anchors so the front can reach);
    // a full throw lets go of that and pins only its trailing edge, along the way it travels
    const free = 1 - sm;
    this._anch = reaching ? P.anchor * free * Math.sqrt(free) * (1 - 0.7 * dp) : 0;
    this._edge = reaching ? P.edgeGrip * sm * (1 - 0.5 * dp) * (1 + 0.6 * dn) : 0;
    this._fountain = P.fountain * full * (1 - 0.5 * dp);
    this._sdx = sdx; this._sdy = sdy;
  }

  // ── forces → velocity: cohesion of each body, the will, kin, fields, wetting, the medium ──
  _forces(ds) {
    const P = this.P, n = this.n;
    const { px, py, vx, vy, ax, ay, body, will, jr, brt, eDrg, eTak, eSig, wd, wnx, wny, wm, stick, fx, fy, eFus } = this;
    const { bCx, bCy, bR, bCount, bKin } = this;
    const nB = this.nBodies, prim = this.primary, a0 = this.a0;
    const M = this._mom, A = this._bodyA, NB = nB < MAXB - 1 ? nB : MAXB - 1;
    // 1. every body's moments, from where its matter is right now — of its FREE matter: what the
    // will holds out, or a wall or a hand holds fast, is not part of the shape the body rounds
    // (else a held body bulges sideways instead of necking, and a pseudopod is dragged home)
    M.fill(0, 0, NB * 14);
    const held = 1 - this._full, anc = this.anc;
    for (let i = 0; i < n; i++) {
      const b = body[i];
      if (b < 0 || b >= NB) continue;
      const o = b * 14, fr = (1 - will[i] * held) * (anc[i] ? 0.15 : 1), x = px[i], y = py[i], u = vx[i] * fr, v = vy[i] * fr;
      M[o]++; M[o + 13] += fr; M[o + 1] += fr * x; M[o + 2] += fr * y; M[o + 3] += fr * x * x; M[o + 4] += fr * x * y; M[o + 5] += fr * y * y;
      M[o + 6] += u; M[o + 7] += v; M[o + 8] += u * x; M[o + 9] += u * y; M[o + 10] += v * x; M[o + 11] += v * y;
      M[o + 12] += eSig[i];
    }
    // 2. the body-scale capillary mode: a traceless affine pull back toward the disc of the same
    // area (ω² = 6σ/R³), damped at a fixed ratio through the deformation rate (never the spin)
    const reach = this._reaching, kmax = 0.5 * (1.6 / ds) * (1.6 / ds);
    for (let b = 0; b < NB; b++) {
      const o = b * 14, m = M[o], mf = M[o + 13], q = b * 8;
      A[q] = 0; A[q + 1] = 0; A[q + 2] = 0; A[q + 3] = 0;
      if (m < 6 || mf < 4) { A[q + 7] = 0; continue; }
      const cx = M[o + 1] / mf, cy = M[o + 2] / mf;
      const cxx = M[o + 3] / mf - cx * cx, cxy = M[o + 4] / mf - cx * cy, cyy = M[o + 5] / mf - cy * cy;
      const tr = cxx + cyy;
      if (tr < 1e-9) { A[q + 7] = 0; continue; }
      let D0 = (cxx - cyy) / tr, D1 = (2 * cxy) / tr;
      const dm = Math.sqrt(D0 * D0 + D1 * D1);
      if (dm > P.shapeMax) { D0 *= P.shapeMax / dm; D1 *= P.shapeMax / dm; }
      // (the finer modes read a near-round body only; a big stretch is the l = 2 mode's business)
      A[q + 6] = smooth01(1 - (dm - 0.18) / 0.27) * smooth01((mf / m - 0.45) / 0.4);
      // affine velocity gradient (best fit) → its symmetric, traceless part is the deformation rate
      const ubx = M[o + 6] / mf, uby = M[o + 7] / mf;
      const q00 = M[o + 8] / mf - ubx * cx, q01 = M[o + 9] / mf - ubx * cy, q10 = M[o + 10] / mf - uby * cx, q11 = M[o + 11] / mf - uby * cy;
      const det = cxx * cyy - cxy * cxy, id = det > 1e-12 ? 1 / det : 0;
      const i00 = cyy * id, i01 = -cxy * id, i11 = cxx * id;
      const L00 = q00 * i00 + q01 * i01, L01 = q00 * i01 + q01 * i11, L10 = q10 * i00 + q11 * i01, L11 = q10 * i01 + q11 * i11;
      const E0 = 0.5 * (L00 - L11), E1 = 0.5 * (L01 + L10);
      // a body much of which is held (a hand, a trap, a long reach) has no free shape to ring
      // with: its global modes fade, and its network and local tension shape it (necks, strands)
      const freeShare = smooth01((mf / m - 0.45) / 0.4);
      const R = Math.sqrt((m * a0) / Math.PI), sr = M[o + 12] / m, sig = P.tension * sr * freeShare;
      let K = (3 * sig) / (R * R * R);
      if (K > kmax) K = kmax;
      const gam = 2 * P.shapeZeta * Math.sqrt(2 * K);
      A[q] = -(K * D0 + gam * E0); A[q + 1] = -(K * D1 + gam * E1);
      A[q + 2] = cx; A[q + 3] = cy; A[q + 4] = R;
      // the overflow is drawn home (lumps, tails, a pseudopod let go) — living matter only
      A[q + 5] = bKin[b] !== WILD ? P.gather * sr * (b === prim && reach ? 1 - 0.5 * this._relax : 1) : 0;
      A[q + 7] = 1;
    }
    // 3. capillary modes l = 3…8 — the same law at finer scales. The outer surface is read as a
    // radius function r(θ); each mode relaxes at its own capillary frequency ω² = σ·l(l²−1)/R³,
    // through the harmonic potential flow ∇Re[c·(z/R)^l] (divergence-free: it moves area, never
    // makes it). Small lumps snap flat and shimmer fast; big ones sway slowly; viscosity damps the
    // fine ones hardest.
    const KB = 32, LM = 9, TW = 2 * Math.PI, { phi } = this;
    const rb = this._rb, vb = this._vb, MC = this._modes, lmax = this._lmax, cosT = this._cosT, sinT = this._sinT;
    rb.fill(-1, 0, NB * KB);
    for (let i = 0; i < n; i++) {
      const b = body[i];
      if (b < 0 || b >= NB || phi[i] > 0.8 || !A[b * 8 + 7]) continue;
      const q = b * 8, rx = px[i] - A[q + 2], ry = py[i] - A[q + 3], r = Math.sqrt(rx * rx + ry * ry);
      let k = Math.floor(((Math.atan2(ry, rx) + Math.PI) / TW) * KB);
      k = k >= KB ? KB - 1 : k < 0 ? 0 : k;
      const o = b * KB + k;
      if (r > rb[o]) { const mf = M[b * 14 + 13] || 1; rb[o] = r; vb[o] = r > 1e-9 ? ((vx[i] - M[b * 14 + 6] / mf) * rx + (vy[i] - M[b * 14 + 7] / mf) * ry) / r : 0; }
    }
    const wmax2 = (1.4 / ds) * (1.4 / ds);
    for (let b = 0; b < NB; b++) {
      const q = b * 8, m = M[b * 14];
      lmax[b] = 0;
      if (!A[q + 7] || m < 60 || A[q + 6] <= 0) continue;
      let L = Math.floor(Math.sqrt(m) / 3.5);
      if (L > LM - 1) L = LM - 1;
      if (L < 3) continue;
      const o = b * KB;
      let filled = 0;
      for (let k = 0; k < KB; k++) if (rb[o + k] >= 0) filled++;
      if (filled < KB * 0.6) continue;                       // too ragged to read as r(θ)
      for (let k = 0; k < KB; k++) if (rb[o + k] < 0) {
        let a = k, c = k;
        do a = (a + KB - 1) % KB; while (rb[o + a] < 0 && a !== k);
        do c = (c + 1) % KB; while (rb[o + c] < 0 && c !== k);
        const da = (k - a + KB) % KB || KB, dc = (c - k + KB) % KB || KB;
        rb[o + k] = (rb[o + a] * dc + rb[o + c] * da) / (da + dc); vb[o + k] = (vb[o + a] * dc + vb[o + c] * da) / (da + dc);
      }
      const R = A[q + 4], sr = M[b * 14 + 12] / m;
      const relax = b === prim && reach ? 1 - 0.8 * this._relax : 1;
      // (linear capillary theory is about ripples on a near-round body: past a modest total
      // irregularity the shape is something else — a neck, a wrap, a splat — and is left to the
      // network and the local tension; and no mode may ever pull harder than a ceiling)
      let irr = 0;
      const ca0 = this._mca || (this._mca = new Float64Array(LM * 4));
      for (let l = 3; l <= L; l++) {
        let ca = 0, sa = 0, cv = 0, sv = 0;
        const t = l * KB;
        for (let k = 0; k < KB; k++) { const c = cosT[t + k], s = sinT[t + k], rr = rb[o + k], vv = vb[o + k]; ca += rr * c; sa += rr * s; cv += vv * c; sv += vv * s; }
        const f = 2 / KB;
        ca0[l * 4] = ca * f; ca0[l * 4 + 1] = sa * f; ca0[l * 4 + 2] = cv * f; ca0[l * 4 + 3] = sv * f;
        irr += Math.sqrt(ca * ca + sa * sa) * f;
      }
      const gate = smooth01(1 - (irr / R - 0.12) / 0.18);
      const sig = P.tension * sr * relax * A[q + 6] * gate, iR3 = 1 / (R * R * R), amax = P.modeMax;
      if (gate <= 0) continue;
      for (let l = 3; l <= L; l++) {
        const ca = ca0[l * 4], sa = ca0[l * 4 + 1], cv = ca0[l * 4 + 2], sv = ca0[l * 4 + 3];
        let w2 = sig * l * (l * l - 1) * iR3;
        if (w2 > wmax2) w2 = wmax2;
        const z2 = P.modeZeta * l * Math.sqrt(w2);           // 2ζ_l·ω_l with ζ_l = ζ·l/2
        let re = w2 * ca + z2 * cv, im = -(w2 * sa + z2 * sv);
        const mag = Math.sqrt(re * re + im * im);
        if (mag > amax) { re *= amax / mag; im *= amax / mag; }
        MC[(b * LM + l) * 2] = re; MC[(b * LM + l) * 2 + 1] = im;
      }
      lmax[b] = L;
    }

    // 4. the overflow drawn home and the finer modes, per particle — with their recoil taken back
    // out, so that neither can ever move a body by itself. (What a nudge holds out, it holds: a
    // pseudopod is exempt from being drawn home until let go. A full throw holds nothing out —
    // the whole body travels, and keeps its cortex.)
    const { bnx, bny } = this;
    const gsx = this._gsx || (this._gsx = new Float64Array(MAXB)), gsy = this._gsy || (this._gsy = new Float64Array(MAXB));
    gsx.fill(0, 0, NB); gsy.fill(0, 0, NB);
    for (let i = 0; i < n; i++) {
      fx[i] = 0; fy[i] = 0;
      const b = body[i];
      if (b < 0 || b >= NB) continue;
      const q = b * 8;
      if (!A[q + 7]) continue;
      const rx = px[i] - A[q + 2], ry = py[i] - A[q + 3], R = A[q + 4], wf = 1 - will[i] * held;
      // the body-scale mode moves only what is free: matter the will holds out, or a wall holds
      // fast, is not swept along by it (else a held body bulges sideways instead of necking)
      const free = wf * (anc[i] ? 0.15 : 1);
      let ax0 = free * (A[q] * rx + A[q + 1] * ry), ay0 = free * (A[q + 1] * rx - A[q] * ry);
      const kg = A[q + 5];
      if (kg > 0) {
        const r = Math.sqrt(rx * rx + ry * ry);
        // (what the will holds out, it holds: only matter it has let go of is drawn home)
        if (r > R) { const a = (kg * (r - R) * wf) / (r * R); ax0 -= a * rx; ay0 -= a * ry; }
        // a surface that faces the body's own centre is the lip of a hole or a hollow: it is
        // drawn across the gap (an inner perimeter costs tension too), so voids close and folds heal
        const ph = phi[i];
        if (ph < 0.95 && r > 1e-6) {
          const facing = -(bnx[i] * rx + bny[i] * ry) / r;
          if (facing > 0.2) { let a = kg * P.fill * (facing - 0.2) * (0.95 - ph) * wf; if (a > 150) a = 150; ax0 += a * bnx[i]; ay0 += a * bny[i]; }
        }
      }
      const L = lmax[b];
      if (L >= 3) {
        // Σ_l c_l·Z^(l−1), Z = z/R (held to |Z| ≤ 1.2 so a pseudopod tip is never flung)
        let zr = rx / R, zi = ry / R;
        const zm = zr * zr + zi * zi;
        if (zm > 1.1) { const s = 1.05 / Math.sqrt(zm); zr *= s; zi *= s; }
        let pr = zr * zr - zi * zi, pm = 2 * zr * zi, ar = 0, am = 0;
        const mo = b * 18;
        for (let l = 3; l <= L; l++) {
          const cr = MC[mo + l * 2], cm = MC[mo + l * 2 + 1];
          ar += cr * pr - cm * pm; am += cr * pm + cm * pr;
          const t = pr * zr - pm * zi; pm = pr * zi + pm * zr; pr = t;
        }
        ax0 -= ar * wf; ay0 += am * wf;
      }
      fx[i] = ax0; fy[i] = ay0; gsx[b] += ax0; gsy[b] += ay0;
    }
    for (let b = 0; b < NB; b++) { const m = M[b * 14]; if (m > 0) { gsx[b] /= m; gsy[b] /= m; } }

    const pOwned = this._pOwned, reaching = this._reaching;
    const sdx = this._sdx, sdy = this._sdy, vT = this._vT, aWill = this._aWill, tail = this._tail, anch = this._anch, drive = P.drive;
    const edge = this._edge, gripMax = P.gripMax, fountain = this._fountain, pq = prim * 8, pOk = prim < NB && A[pq + 7];
    const contactD = 1.5 * this.d0, rho = this.rho, ir0 = 1 / this.rho0;
    const pcx0 = pOk ? A[pq + 2] : 0, pcy0 = pOk ? A[pq + 3] : 0, iR0 = pOk ? 1 / A[pq + 4] : 0;
    const dp = this.dial > 0 ? this.dial : 0;
    const G = P.kinG * a0, soft2 = P.kinSoft * P.kinSoft, kinMax = P.kinMax;
    const recall = 1 + 4 * dp, aHome = P.homeAccel * (1 + 1.4 * dp);
    const fields = this.world.fields, nF = fields.length;
    const pcx = nB ? bCx[prim] : 0, pcy = nB ? bCy[prim] : 0;
    const nSrc = nB < 12 ? nB : 12;
    const adhK = P.adhesion, dC = 0.35 * this.d0, dR = P.adhRange * this.d0, adhInv = 1 / (dR - dC);
    const gripK = SURF.grip, tackS = SURF.tack;
    const k1 = P.drag, k2 = P.drag2;
    const pump = this._pump, wmean = this._wmean, jrk = 1 - Math.exp(-ds * 14);

    for (let i = 0; i < n; i++) {
      const b = body[i];
      let gx = ax[i] + fx[i], gy = ay[i] + fy[i];
      const x = px[i], y = py[i];
      if (b >= 0 && b < NB) {
        const q = b * 8;
        if (A[q + 7]) { gx -= gsx[b]; gy -= gsy[b]; }
        const owner = bKin[b];
        if (b === prim && pOwned) {
          if (reaching) {
            let w = will[i];
            const vd = vx[i] * sdx + vy[i] * sdy;
            // matter pressed flat against a wall that stands in the way is not driven into it
            if (wd[i] < contactD) { const block = -(wnx[i] * sdx + wny[i] * sdy); if (block > 0.3) w *= 1 - smooth01((block - 0.3) * 2.5); }
            // fountain flow: the core streams forward faster than the flanks, so a moving body
            // circulates — matter arriving at the front spreads to the sides and drifts back along
            // them (incompressibility does that part) — the way an amoeba moves, never as a block
            const lv = ((y - pcy0) * sdx - (x - pcx0) * sdy) * iR0, l2 = lv * lv;
            const prof = 1 + fountain * (1 - 2.2 * (l2 < 1 ? l2 : 1));
            let a = (vT * prof - vd) * drive;
            a = a <= 0 ? 0 : a > aWill ? aWill : a;
            // the will pushes only until the gel itself pushes back: where it is already squeezed
            // (blocked by a wall, a slit, its own front), it stops adding pressure — no jets
            const sq = rho[i] * jr[i] * ir0 - 1;
            if (sq > 0.015) a *= sq > 0.06 ? 0 : 1 - (sq - 0.015) / 0.045;
            a *= (tail + (1 - tail) * w) * (w > 0 || will[i] <= 0 ? 1 : 0);
            gx += a * sdx; gy += a * sdy;
            const g = anch * (1 - w);
            if (g > 0) { gx -= g * vx[i]; gy -= g * vy[i]; }
            // the trailing edge holds back a little along the way it travels (the pinned rear of
            // a drop running down glass); pinning is friction, so it slips rather than tears
            if (edge > 0 && vd > 0) {
              const u = ((x - pcx0) * sdx + (y - pcy0) * sdy) * iR0;
              const rear = smooth01((-u - 0.45) * 2.0);
              if (rear > 0) { let e = edge * vd; if (e > gripMax) e = gripMax; e *= rear; gx -= e * sdx; gy -= e * sdy; }
            }
          }
        } else if (owner === PLAYER && pOwned) {
          // a stray of yours swims home, leading edge first — the way home around the walls,
          // not the straight line into them (the geodesic field, refreshed every few frames)
          const hd = this._homeDir, ux = hd[b * 2], uy = hd[b * 2 + 1];
          const u = ((x - bCx[b]) * ux + (y - bCy[b]) * uy) / (bR[b] + 1e-6);
          // (home is reached at touching: past that, swimming on would only shove "me" along)
          const gap = Math.hypot(pcx - bCx[b], pcy - bCy[b]) - bR[prim] - bR[b];
          const a = aHome * (0.35 + 0.65 * smooth01((u + 0.9) * 0.6)) * (0.3 + 0.7 * smooth01(gap / 0.5 + 0.2));
          gx += a * ux; gy += a * uy;
        }
        // like kind draws like kind: living bodies of one lineage feel each other from afar — and
        // the medium bends that: a healing bath draws harder, a repellent one turns it into a push
        if (owner !== WILD) {
          const fz = eFus[i], gk = (owner === PLAYER ? G * recall : G) * (fz < 0 ? 6 * fz : fz);
          for (let s = 0; s < nSrc; s++) {
            if (s === b || bKin[s] !== owner) continue;
            const ddx = bCx[s] - x, ddy = bCy[s] - y;
            const r2 = ddx * ddx + ddy * ddy + soft2;
            let a = (gk * bCount[s]) / r2;
            if (a > kinMax) a = kinMax;
            const il = a / Math.sqrt(r2);
            gx += ddx * il; gy += ddy * il;
          }
        }
      }
      for (let f = 0; f < nF; f++) {
        const F = fields[f];
        if (F.t === 'uniform') { gx += F.gx; gy += F.gy; continue; }
        const ddx = F.x - x, ddy = F.y - y, r2 = ddx * ddx + ddy * ddy;
        if (r2 > F.range * F.range) continue;
        const r = Math.sqrt(r2) + 1e-6, fall = 1 - r / F.range;
        if (F.t === 'well') {
          const a = (F.g * fall * fall) / (r2 / (F.core * F.core) + 1);
          gx += (ddx / r) * a; gy += (ddy / r) * a;
          if (F.eat && r < F.core && this.rand() < F.eat * ds * (1 - r / F.core)) this._swallow(i, 2);
        } else if (F.t === 'vortex') {
          const a = F.g * fall * fall * Math.min(1, r / F.core);
          gx += (-ddy / r) * a + (ddx / r) * a * (F.inward || 0);
          gy += (ddx / r) * a + (ddy / r) * a * (F.inward || 0);
        }
      }
      // wetting: a normal-only pull that peaks a little way off the surface, stronger the longer
      // it has rested on a gripping surface
      const d = wd[i];
      if (d < dR && d > dC) {
        const m = wm[i];
        const tack = tackS[m] * eTak[i] * (1 + 3 * gripK[m] * stick[i]);
        if (tack > 0) {
          const t = (d - dC) * adhInv, a = adhK * tack * 4 * t * (1 - t);
          gx -= a * wnx[i]; gy -= a * wny[i];
        }
      }
      let ux = vx[i] + gx * ds, uy = vy[i] + gy * ds;
      const sp = Math.sqrt(ux * ux + uy * uy);
      const f = 1 / (1 + (k1 + k2 * sp) * eDrg[i] * ds);
      vx[i] = ux * f; vy[i] = uy * f;
      // the rest area each particle wants: its breath, plus the will's pump (zero-mean over the
      // body, so room is moved into the reaching part, never made)
      let tj = brt[i];
      if (pump > 0 && b === prim) tj += pump * (will[i] - wmean);
      jr[i] += (tj - jr[i]) * jrk;
    }
  }

  _predict(ds) {
    const { n, px, py, vx, vy, ox, oy, blam } = this;
    for (let i = 0; i < n; i++) { ox[i] = px[i]; oy[i] = py[i]; px[i] += vx[i] * ds; py[i] += vy[i] * ds; }
    blam.fill(0, 0, n * SLOTS);
  }

  // ── incompressibility: one Jacobi pass of the density constraint ──
  // C = ρ/ρt − 1. Over-dense: push apart from every neighbour (that is contact). Under-dense: pull
  // in only from the particle's own piece, only where it is bulk (not at a free surface), and only
  // so far (tensile limit) — so stretching thins a body instead of tearing it full of holes.
  _density(last) {
    const n = this.n, np = this.nPairs, P = this.P;
    const { pi, pj, pph, pw, pux, puy, px, py, rho, jr, wd, wnx, wny, eWet, eTns, phi, bnx, bny } = this;
    const A = this._acc, CF = this._cf, DP = this._dp;   // interleaved: one cache line per particle
    const h = this.h, h2 = this.h2, kW = this.kW, kG = this.kG, W0 = this.W0, rho0 = this.rho0;
    // A: ρ, ∇x, ∇y, Σ|∇|², and the same over the particle's own piece, and its neighbourhood centre
    for (let i = 0, o = 0; i < n; i++, o += 10) {
      A[o] = W0; A[o + 1] = 0; A[o + 2] = 0; A[o + 3] = 0; A[o + 4] = W0; A[o + 5] = 0; A[o + 6] = 0; A[o + 7] = 0; A[o + 8] = 0; A[o + 9] = 0;
    }
    for (let k = 0; k < np; k++) {
      const i = pi[k], j = pj[k];
      const dx = px[i] - px[j], dy = py[i] - py[j], r2 = dx * dx + dy * dy;
      if (r2 >= h2) { pw[k] = 0; continue; }
      const t = h2 - r2, w = kW * t * t * t;
      const r = Math.sqrt(r2) + 1e-9, q = h - r, gm = (kG * q * q) / r;
      const ux = gm * dx, uy = gm * dy, uu = ux * ux + uy * uy;
      pw[k] = w; pux[k] = ux; puy[k] = uy;
      const oi = i * 10, oj = j * 10;
      A[oi] += w; A[oi + 1] += ux; A[oi + 2] += uy; A[oi + 3] += uu;
      A[oj] += w; A[oj + 1] -= ux; A[oj + 2] -= uy; A[oj + 3] += uu;
      if (pph[k]) {
        A[oi + 4] += w; A[oi + 5] += ux; A[oi + 6] += uy; A[oi + 7] += uu; A[oi + 8] -= w * dx; A[oi + 9] -= w * dy;
        A[oj + 4] += w; A[oj + 5] -= ux; A[oj + 6] -= uy; A[oj + 7] += uu; A[oj + 8] += w * dx; A[oj + 9] += w * dy;
      }
    }
    // a wetted wall counts as matter beside the particle
    const tab = this.wallTab, grad = this.wallGrad, it = 64 / h;
    for (let i = 0; i < n; i++) {
      const d = wd[i];
      if (d >= h) continue;
      const u = (d < 0 ? 0 : d) * it, k0 = u | 0, fr = u - k0, k1 = k0 < 64 ? k0 + 1 : 64;
      const rw = tab[k0] + (tab[k1] - tab[k0]) * fr, gw = grad[k0] + (grad[k1] - grad[k0]) * fr;
      const ux = gw * wnx[i], uy = gw * wny[i], uu = ux * ux + uy * uy, we = 0.35 + 0.65 * eWet[i], o = i * 10;
      A[o] += rw; A[o + 1] += ux; A[o + 2] += uy; A[o + 3] += uu;
      A[o + 4] += rw * we; A[o + 5] += ux * we; A[o + 6] += uy * we; A[o + 7] += uu * we * we;
    }
    // λ, as a coefficient on every pair (over-dense: all neighbours) or on own-piece pairs only
    const cfm = P.cfm * this.D0, nS = 1 / this.nSurf, ir0 = 1 / rho0;
    for (let i = 0, o = 0; i < n; i++, o += 10) {
      const ir = jr[i] * ir0;                      // 1/ρt: a particle's own rest area sets its target
      const ra = A[o] * ir;
      rho[i] = A[o];
      let ca = 0, cs = 0;
      if (ra > 1) {
        const den = (A[o + 1] * A[o + 1] + A[o + 2] * A[o + 2] + A[o + 3]) * ir * ir;
        ca = ((1 - ra) / (den + cfm)) * ir;
      } else {
        const gx = A[o + 5], gy = A[o + 6], nn = Math.sqrt(gx * gx + gy * gy) * nS;
        const bulk = 1 - smooth01((nn - 0.22) * 2.4);
        if (bulk > 0) {
          let C = A[o + 4] * ir - 1;
          const tl = -eTns[i];
          if (C < tl) C = tl;
          const den = (gx * gx + gy * gy + A[o + 7]) * ir * ir;
          cs = ((-C * bulk) / (den + cfm)) * ir;
        }
      }
      CF[i * 2] = ca; CF[i * 2 + 1] = cs;
      if (last) {
        // what the eye and the ear read: how full each particle's own neighbourhood is, its normal
        phi[i] = A[o + 4] * ir0;
        const gx = A[o + 5], gy = A[o + 6], gl = Math.sqrt(gx * gx + gy * gy);
        if (gl > 1e-9) { bnx[i] = -gx / gl; bny[i] = -gy / gl; }
      }
    }
    DP.fill(0, 0, n * 2);
    // (in units of a full-strength correction of a particle at rest density)
    const ck = P.clump / (rho0 * this.D0), Wq = kW * (h2 - 0.09 * h2) ** 3, iWq = 1 / Wq;
    const eFus = this.eFus, kr = 0.35 / (rho0 * this.D0 * this.W0);
    for (let k = 0; k < np; k++) {
      const w = pw[k];
      if (w <= 0) continue;
      const i = pi[k], j = pj[k], i2 = i * 2, j2 = j * 2;
      let c = CF[i2] + CF[j2];
      if (pph[k]) c += CF[i2 + 1] + CF[j2 + 1];
      else {
        // a repellent medium pushes separate pieces apart before they can touch
        const f = eFus[i] < eFus[j] ? eFus[i] : eFus[j];
        if (f < 0) c += f * kr * w;
      }
      // keep particles from pairing up (a short-range push, strongest when nearly touching)
      let sq = w * iWq; sq *= sq; c -= ck * sq * sq;
      const ux = pux[k] * c, uy = puy[k] * c;
      DP[i2] += ux; DP[i2 + 1] += uy; DP[j2] -= ux; DP[j2 + 1] -= uy;
    }
    const rl = P.relax, cap = 0.2 * this.d0, cap2 = cap * cap;
    for (let i = 0; i < n; i++) {
      let x = DP[i * 2] * rl, y = DP[i * 2 + 1] * rl;
      const d = wd[i], ca = CF[i * 2];
      if (d < h && ca !== 0) {
        const u = (d < 0 ? 0 : d) * it, k0 = u | 0, fr = u - k0, k1 = k0 < 64 ? k0 + 1 : 64;
        const gw = (grad[k0] + (grad[k1] - grad[k0]) * fr) * ca * rl;
        x += gw * wnx[i]; y += gw * wny[i];
      }
      // (no particle is moved more than a fraction of its spacing in one pass, whatever it is told)
      const m2 = x * x + y * y;
      if (m2 > cap2) { const f = cap / Math.sqrt(m2); x *= f; y *= f; }
      px[i] += x; py[i] += y;
    }
  }

  // ── surface tension, local: mean-curvature flow on each piece's own surface ──
  // A surface particle whose neighbourhood centre sits further inward than on a flat surface is
  // on a bump; less, in a dent. Each is moved a fraction of the way toward flat, along its normal.
  // A projection, so it can never overshoot (explicit capillary forces at this resolution would
  // need a millisecond step); small lumps flatten fast, big ones gently; the density constraint
  // keeps the area. The body-scale mode and the gather do the rest.
  _surface(ds) {
    const n = this.n, P = this.P, { px, py, eSig, wd, eWet, kin, body, dpx, dpy, will } = this, A = this._acc;
    const held = 1 - this._full;
    const nS = 1 / this.nSurf, cF = this.cFlat, lim = 0.4 * this.d0, h = this.h;
    const base = P.surfRate * ds;
    const sx = this._ssx || (this._ssx = new Float64Array(MAXB)), sy = this._ssy || (this._ssy = new Float64Array(MAXB));
    const sc = this._ssc || (this._ssc = new Int32Array(MAXB));
    sx.fill(0); sy.fill(0); sc.fill(0);
    for (let i = 0; i < n; i++) {
      const b = body[i];
      if (b >= 0) sc[b]++;
      dpx[i] = 0; dpy[i] = 0;
      const o = i * 10, gx = A[o + 5], gy = A[o + 6], gl = Math.sqrt(gx * gx + gy * gy);
      if (gl < 1e-9) continue;
      let sw = smooth01((gl * nS - 0.22) * 2.4);
      if (sw <= 0) continue;
      // where it wets a wall, the wall is part of its surroundings: no free surface there
      const d = wd[i];
      if (d < h) sw *= 1 - 0.85 * eWet[i] * (1 - d / h);
      const ix = gx / gl, iy = gy / gl;
      let s = (A[o + 8] * ix + A[o + 9] * iy) / A[o + 4] - cF;
      s = s > lim ? lim : s < -lim ? -lim : s;
      const k = sw * (1 - Math.exp(-base * eSig[i] * (kin[i] === WILD ? 0.6 : 1))) * (1 - will[i] * held);
      const ux = k * s * ix, uy = k * s * iy;
      dpx[i] = ux; dpy[i] = uy;
      if (b >= 0) { sx[b] += ux; sy[b] += uy; }
    }
    // (tension is internal: whatever it moves out here, the body as a whole does not move)
    for (let b = 0; b < MAXB; b++) if (sc[b]) { sx[b] /= sc[b]; sy[b] /= sc[b]; }
    for (let i = 0; i < n; i++) {
      const b = body[i];
      if (b >= 0) { px[i] += dpx[i] - sx[b]; py[i] += dpy[i] - sy[b]; } else { px[i] += dpx[i]; py[i] += dpy[i]; }
    }
  }

  // ── the network: every bond a compliant distance constraint (XPBD) ──
  _solveBonds(ds) {
    const n = this.n, { px, py, bj, bl, blam, eK } = this, S = SLOTS, ids2 = 1 / (ds * ds);
    for (let i = 0; i < n; i++) {
      const o = i * S;
      for (let s = 0; s < S; s++) {
        const j = bj[o + s];
        if (j <= i) continue;
        const dx = px[j] - px[i], dy = py[j] - py[i], r = Math.sqrt(dx * dx + dy * dy) + 1e-9;
        const C = r - bl[o + s];
        let k = 0.5 * (eK[i] + eK[j]);
        if (k < 1) k = 1;
        const at = ids2 / k;
        const dl = (-C - at * blam[o + s]) / (2 + at);
        blam[o + s] += dl;
        const nx = (dx / r) * dl, ny = (dy / r) * dl;
        px[i] -= nx; py[i] -= ny; px[j] += nx; py[j] += ny;
      }
    }
  }

  // ── tack: anchors. A wetting anchor slides along the wall and holds only against leaving it
  // (hyper-slick yet clingy); a gripping anchor holds its very spot ──
  _solveAnchors(ds) {
    const { n, anc, px, py, aX, aY, aL, world, wm, eTak, stick } = this, P = this.P;
    const T = SURF.tack, G = SURF.grip, ids2 = 1 / (ds * ds);
    for (let i = 0; i < n; i++) {
      const a = anc[i];
      if (!a) continue;
      // tack is a spring with a breaking stretch, not a rivet: pulled hard enough, it lets go
      const m = wm[i], k = P.anchorK * T[m] * eTak[i] * (1 + 3 * G[m] * stick[i]);
      const f = k <= 0 ? 0 : 1 / (1 + ids2 / k);
      if (a === 3) {
        // held: a fingertip or a pincer has hold of it — stiff, and it does not let go by itself
        const ex = px[i] - aX[i], ey = py[i] - aY[i];
        px[i] -= 0.5 * ex; py[i] -= 0.5 * ey;
      } else if (a === 1) {
        const d = world.sample(px[i], py[i]), C = d - aL[i];
        if (C > 0) { const c = f * C; px[i] -= c * world.gx; py[i] -= c * world.gy; }
      } else {
        const ex = px[i] - aX[i], ey = py[i] - aY[i], r = Math.sqrt(ex * ex + ey * ey) + 1e-9, C = r - aL[i];
        if (C > 0) { const c = (f * C) / r; px[i] -= c * ex; py[i] -= c * ey; }
      }
    }
  }

  _solveWalls() {
    const { n, px, py, wd, wnx, wny, world } = this, rw = this.P.wallR * this.d0;
    for (let i = 0; i < n; i++) {
      let d = world.sample(px[i], py[i]);
      const nx = world.gx, ny = world.gy;
      if (d < rw) { px[i] += (rw - d) * nx; py[i] += (rw - d) * ny; d = rw; }
      wd[i] = d; wnx[i] = nx; wny[i] = ny;
    }
  }

  // ── positions → velocities, then what acts on velocity alone: friction and rebound at walls,
  // shear smoothing inside a piece, extensional viscosity along bonds ──
  _post(ds) {
    const n = this.n, P = this.P, ids = 1 / ds, S = SURF;
    const { px, py, ox, oy, vx, vy, wd, wnx, wny, wm, eSlp, eVis, uvx, uvy, pi, pj, pph, pw, bj } = this;
    const contact = P.contact * this.d0, fk = P.frictionK * ds, ev = this.ev, dx0 = this.d0;
    for (let i = 0; i < n; i++) {
      let ux = (px[i] - ox[i]) * ids, uy = (py[i] - oy[i]) * ids;
      if (wd[i] < contact) {
        const nx = wnx[i], ny = wny[i], m = wm[i];
        const v0 = vx[i] * nx + vy[i] * ny;                  // how it came at the wall
        let vn = ux * nx + uy * ny, tx = ux - vn * nx, ty = uy - vn * ny;
        const mu = S.friction[m] * eSlp[i];
        if (mu > 0) { const kp = 1 - mu * fk; const kk = kp < 0 ? 0 : kp; tx *= kk; ty *= kk; }
        if (v0 < -0.8) { ev.impact += -v0; ev.impactN++; ev.impactX += px[i]; ev.impactY += py[i]; }
        const e = S.restitution[m];
        if (e > 0 && v0 < -0.6 && vn < -v0 * e) vn = -v0 * e;
        // a wall gives back only what came at it (and its restitution): being projected out of a
        // wall is not a push away from it
        const vcap = (v0 > 0 ? v0 : 0) + (e > 0 && v0 < -0.6 ? -v0 * e : 0) + 0.25;
        if (vn > vcap) vn = vcap;
        ux = tx + vn * nx; uy = ty + vn * ny;
      }
      vx[i] = ux; vy[i] = uy;
    }
    // shear smoothing (XSPH) within a piece: the body moves as one, never as a sack of beads;
    // separate pieces slide freely past each other
    const np = this.nPairs, ir0 = 1 / this.rho0;
    uvx.fill(0, 0, n); uvy.fill(0, 0, n);
    for (let k = 0; k < np; k++) {
      if (!pph[k]) continue;
      const w = pw[k];
      if (w <= 0) continue;
      const i = pi[k], j = pj[k], c = w * ir0;
      const du = (vx[j] - vx[i]) * c, dv = (vy[j] - vy[i]) * c;
      uvx[i] += du; uvy[i] += dv; uvx[j] -= du; uvy[j] -= dv;
    }
    let vm = 0;
    for (let i = 0; i < n; i++) {
      const c = 1 - Math.exp(-ds * eVis[i]);
      vx[i] += uvx[i] * c; vy[i] += uvy[i] * c;
    }
    // extensional viscosity: a strand being drawn resists the drawing a moment before it gives
    const cb = 0.5 * (1 - Math.exp(-ds * P.bondDamp)), Sl = SLOTS;
    for (let i = 0; i < n; i++) {
      const o = i * Sl;
      for (let s = 0; s < Sl; s++) {
        const j = bj[o + s];
        if (j <= i) continue;
        const dx = px[j] - px[i], dy = py[j] - py[i], r = Math.sqrt(dx * dx + dy * dy) + 1e-9;
        const nx = dx / r, ny = dy / r, vr = ((vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny) * cb;
        vx[i] += vr * nx; vy[i] += vr * ny; vx[j] -= vr * nx; vy[j] -= vr * ny;
      }
    }
    for (let i = 0; i < n; i++) { const s = vx[i] * vx[i] + vy[i] * vy[i]; if (s > vm) vm = s; }
    void dx0;
    return Math.sqrt(vm);
  }

  // ── the network lives: bonds forget their length, yield, snap, are cut; new ones form ──
  _network(dt) {
    const n = this.n, P = this.P, d0 = this.d0, S = SLOTS;
    const { px, py, bj, bl, eRel, eYld, eBrk, eLen, strainS, skin, snx, sny, wd, vx, vy } = this;
    const ev = this.ev, near = this.h, world = this.world;
    const relieved = this._relieved || (this._relieved = new Int32Array(this.maxN).fill(-1)), tick = this.ticks;
    const { phi, nb, anc } = this, turn = 2.3 * d0, Lmax = 1.6 * d0, Lmin = 0.6 * d0;
    const sdec = Math.exp(-dt * 5);
    for (let i = 0; i < n; i++) strainS[i] *= sdec;
    let smax = 0, sn = 0, shear = 0;
    for (let i = 0; i < n; i++) {
      const o = i * S;
      for (let s = 0; s < S; s++) {
        const j = bj[o + s];
        if (j <= i) continue;
        const dx = px[j] - px[i], dy = py[j] - py[i], r = Math.sqrt(dx * dx + dy * dy);
        let L = bl[o + s];
        const strain = (r - L) / L;
        // a blade between them parts them and skins both faces; a blunt wall only if the matter
        // really lies on its two sides (a bond's chord grazing a rounded corner is no cut)
        let depth = 1;
        if ((wd[i] < near || wd[j] < near) && (depth = this._chordDepth(px[i], py[i], px[j], py[j])) < 0 &&
          (SURF.sharp[this._chordMat] > 0 || depth < -0.45 * d0)) {
          const m = this._chordMat;
          this._unbondSlot(i, s);
          const sk = SURF.sharp[m];
          if (sk > 0) {
            ev.cuts++;
            if (skin[i] < sk) { skin[i] = sk; snx[i] = -dx / (r + 1e-9); sny[i] = -dy / (r + 1e-9); }
            if (skin[j] < sk) { skin[j] = sk; snx[j] = dx / (r + 1e-9); sny[j] = dy / (r + 1e-9); }
          }
          continue;
        }
        const brk = 0.5 * (eBrk[i] + eBrk[j]), len = 0.5 * (eLen[i] + eLen[j]) * d0;
        // turnover: in the flowing bulk, neighbours drift apart and their link simply lets go —
        // quietly; each has nearer neighbours to hold now (only a surface or a strand snaps)
        if (r > turn && phi[i] > 0.82 && phi[j] > 0.82) { this._unbondSlot(i, s); continue; }
        // (once a link in a chain lets go, the tension in its neighbours drops: a strand parts at
        // one place and both ends recoil — it does not shatter into beads)
        // (and a strand's last link to a particle holds: the ends retract into their bodies, they
        // are not left behind as dust — unless a wall holds that particle, or it is torn far)
        const last = (nb[i] === 1 && !anc[i]) || (nb[j] === 1 && !anc[j]);
        if ((strain > brk || r > len) && relieved[i] !== tick && relieved[j] !== tick && (!last || r > 2 * len)) {
          relieved[i] = tick; relieved[j] = tick;
          // a snap: yanked past what it bears, or drawn out until nothing was left of it
          this._unbondSlot(i, s);
          ev.snaps++; ev.snapE += strain; ev.snapX += 0.5 * (px[i] + px[j]); ev.snapY += 0.5 * (py[i] + py[j]);
          if (r > 2 * d0) { const k = P.snapSkin; if (skin[i] < k) skin[i] = k; if (skin[j] < k) skin[j] = k; }
          continue;
        }
        // the bond forgets its length (the network flows) and gives way past its yield strain —
        // but a crosslink has a natural size: it never forgets its way past that
        const rel = 0.5 * (eRel[i] + eRel[j]);
        L = r + (L - r) * rel;
        const yl = 0.5 * (eYld[i] + eYld[j]);
        if (r > L * (1 + yl)) L = r / (1 + yl); else if (r < L * (1 - yl)) L = r / (1 - yl);
        if (L > Lmax) L = Lmax; else if (L < Lmin) L = Lmin;
        this._setRest(i, s, j, L);
        if (strain > 0) {
          if (strain > strainS[i]) strainS[i] = strain;
          if (strain > strainS[j]) strainS[j] = strain;
          // what the ear and the thumb are told: how near a strand or a skin is to letting go —
          // as a share of its own breaking strain (the bulk's working shear is not news)
          if (phi[i] < 0.75 || phi[j] < 0.75) {
            const f = strain / brk;
            if (f > smax) smax = f;
            if (f > 0.55) sn++;
          }
        }
        const rvx = vx[j] - vx[i], rvy = vy[j] - vy[i];
        shear += (rvx * rvx + rvy * rvy) / (r * r + 1e-6);
      }
    }
    if (smax > ev.strainMax) ev.strainMax = smax;
    ev.strainN += sn;
    ev.shear += Math.sqrt(shear / Math.max(1, n)) * dt;
    this._form(dt);
  }

  // New bonds wherever compatible matter meets. Inside a piece: healing, fast. Between pieces: a
  // rate, never a rule — affinity, kinship, both skins, the medium, pressure, closing speed.
  _form(dt) {
    const { pi, pj, nPairs, px, py, vx, vy, nb, eLnk, piece, sub, kin, skin, eFus, rho } = this;
    const P = this.P, fr2 = (P.formR * this.d0) ** 2, ev = this.ev;
    const AFF = CHEM.AFF, KX = CHEM.KX, NS = CHEM.n, rho0 = this.rho0;
    const pIn = 1 - Math.exp(-dt * P.bondRate);
    for (let k = 0; k < nPairs; k++) {
      const i = pi[k], j = pj[k];
      // a piece's own network keeps to its coordination; a link reaching across to another piece
      // may take a spare slot (fusion is crosslink exchange at the interface: a saturated surface
      // must still be able to take hold)
      const across = piece[i] !== piece[j], li = across ? SLOTS : eLnk[i], lj = across ? SLOTS : eLnk[j];
      if (nb[i] >= li || nb[j] >= lj) continue;
      const dx = px[j] - px[i], dy = py[j] - py[i], r2 = dx * dx + dy * dy;
      if (r2 > fr2 || this._bonded(i, j)) continue;
      const si = sub[i], sj = sub[j], ki = kin[i], kj = kin[j];
      const sk = skin[i] > skin[j] ? skin[i] : skin[j];
      const skinGate = smooth01(1 - (sk - 0.08) * 3.5);          // fresh skins hold apart
      let p, cross = false;
      const rvn = ((vx[j] - vx[i]) * dx + (vy[j] - vy[i]) * dy) / Math.sqrt(r2 + 1e-12);
      // (a slam does not fuse: matter that meets fast bounces off first)
      const slam = rvn < -4 ? smooth01(1 + (rvn + 4) * 0.4) : 1;
      if (si === sj && ki === kj && ki !== WILD && eFus[i] > 0 && eFus[j] > 0) {
        // the same gel of the same body, never cut (or healed): it re-knits as fast as it heals,
        // whether or not the network happened to be whole a moment ago
        p = pIn * skinGate;
        cross = piece[i] !== piece[j];
      } else if (piece[i] === piece[j] && si === sj && ki === kj) p = pIn * skinGate;
      else {
        const zone = 0.5 * (eFus[i] + eFus[j]);
        if (zone <= 0) continue;
        const press = (rho[i] + rho[j]) / (2 * rho0) - 1;
        const boost = (1 + Math.min(2, (press > 0 ? press : 0) * 25)) * zone;
        const sameKin = ki === kj || ki === WILD || kj === WILD;
        const gate = gateAff(AFF[si * NS + sj] * boost) * (sameKin ? 1 : gateKin(KX[si * NS + sj] * boost)) * skinGate * slam;
        if (gate <= 0) continue;
        p = 1 - Math.exp(-dt * P.fuseRate * gate);
        cross = piece[i] !== piece[j];
      }
      if (p > 0 && this.rand() < p && this._bond(i, j, Math.sqrt(r2)) && cross) {
        ev.fusions++; ev.fuseX += 0.5 * (px[i] + px[j]); ev.fuseY += 0.5 * (py[i] + py[j]);
      }
    }
  }

  // ── what walls do to the particles that touch them ──
  _walls(dt) {
    const P = this.P, S = SURF, n = this.n, world = this.world, d0 = this.d0;
    const { px, py, vx, vy, wd, wnx, wny, wm, skin, snx, sny, coat, stick, heat, anc, aX, aY, aL, eTak, kin } = this;
    const contact = P.contact * d0, cutDepth = 1.4 * d0;
    const hc = 1 - Math.exp(-dt * P.heatContact), grip = 1 - Math.exp(-dt * P.gripRate), unstick = 1 - Math.exp(-dt * 2.5);
    const ev = this.ev, dp = this.dial > 0 ? this.dial : 0;
    for (let i = 0; i < n; i++) {
      const d = wd[i];
      if (d < 2.4 * this.h) wm[i] = world.material(px[i] - wnx[i] * d, py[i] - wny[i] * d);
      let st = stick[i];
      const m = wm[i];
      if (d < contact) {
        const vn = vx[i] * wnx[i] + vy[i] * wny[i];
        const tx = vx[i] - vn * wnx[i], ty = vy[i] - vn * wny[i];
        const slide = Math.sqrt(tx * tx + ty * ty);
        // grit grinds what is pushed across it (keyed to attempted slide: friction kills the slide)
        if (S.abrade[m] > 0 && slide + Math.abs(vn) * 0.5 > 0.12 && this.rand() < (slide + 0.6) * dt * 0.9 * S.abrade[m]) this._swallow(i, 1);
        if (S.drink[m] > 0 && this.rand() < dt * S.drink[m] * 0.5) this._swallow(i, 2);
        if (S.heat[m] !== 0) heat[i] += (S.heat[m] - heat[i]) * hc;
        if (S.coat[m] > 0) { const c = coat[i] + S.coat[m] * dt * 4; coat[i] = c > 1 ? 1 : c; }
        if (S.grip[m] > 0) st += (1 - st) * grip;
        // tack takes hold
        if (!anc[i]) {
          const tk = S.tack[m] * eTak[i];
          if (tk > 0.05 && this.rand() < 1 - Math.exp(-dt * P.anchorRate * tk)) {
            anc[i] = S.grip[m] > 0 ? 2 : 1;
            aX[i] = px[i] - d * wnx[i]; aY[i] = py[i] - d * wny[i]; aL[i] = d;
          }
        }
      } else st -= st * unstick;
      stick[i] = st;
      if (coat[i] > 0) { coat[i] -= P.coatWear * dt; if (coat[i] < 0) coat[i] = 0; }
      // an anchor drawn past what the tack bears lets go (firm lets go sooner: it beads up)
      if (anc[i] && anc[i] !== 3) {
        const tk = S.tack[m] * eTak[i] * (kin[i] === PLAYER ? 1 - 0.7 * dp : 1);
        const reach = P.anchorReach * d0 * (0.4 + 0.6 * tk) * (1 + 2.5 * S.grip[m] * st);
        let C;
        if (anc[i] === 1) C = d - aL[i];
        else { const ex = px[i] - aX[i], ey = py[i] - aY[i]; C = Math.sqrt(ex * ex + ey * ey) - aL[i]; }
        if (C > reach || tk <= 0.05 || d > 3 * this.h) {
          anc[i] = 0;
          if (C > 0.5 * reach) { ev.snaps++; ev.snapE += C / d0; ev.snapX += px[i]; ev.snapY += py[i]; }
        }
      }
      // a sharp edge skins what it parts: which face of the cut this is, is the wall normal with
      // the direction of travel taken out (so the two sides are told apart even at the tip)
      if (d < cutDepth && S.sharp[m] > 0) {
        const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        let cx = wnx[i], cy = wny[i];
        if (sp > 0.3) { const along = (cx * vx[i] + cy * vy[i]) / (sp * sp); cx -= along * vx[i]; cy -= along * vy[i]; }
        const cl = Math.sqrt(cx * cx + cy * cy);
        if (cl > 0.12) {
          const sk = S.sharp[m];
          if (skin[i] < 0.5 * sk) ev.cuts++;
          if (skin[i] < sk) skin[i] = sk;
          snx[i] = cx / cl; sny[i] = cy / cl;
        }
      }
    }
  }

  // ── heat and dye travel through the network ──
  _diffuse(dt) {
    const { n, heat, cr, cg, cb, bj, P } = this, S = SLOTS;
    const kh = 0.5 * (1 - Math.exp(-dt * P.heatDiff * 3)), kd = 0.5 * (1 - Math.exp(-dt * P.dyeDiff * 3));
    for (let i = 0; i < n; i++) {
      const o = i * S;
      for (let s = 0; s < S; s++) {
        const j = bj[o + s];
        if (j <= i) continue;
        let d = (heat[j] - heat[i]) * kh; heat[i] += d; heat[j] -= d;
        d = (cr[j] - cr[i]) * kd; cr[i] += d; cr[j] -= d;
        d = (cg[j] - cg[i]) * kd; cg[i] += d; cg[j] -= d;
        d = (cb[j] - cb[i]) * kd; cb[i] += d; cb[j] -= d;
      }
    }
  }

  // Re-sort storage by cell so that neighbours sit near each other in memory. Bonds follow.
  _reorder() {
    const n = this.n, { px, py, gw, gh, ics } = this;
    const key = this.cKey, cnt = this.cStart, NG = this.NG, o = this._ord, invo = this._invo;
    cnt.fill(0, 0, NG + 1);
    for (let p = 0; p < n; p++) {
      let X = Math.floor(px[p] * ics) + 1, Y = Math.floor(py[p] * ics) + 1;
      X = X < 0 ? 0 : X >= gw ? gw - 1 : X; Y = Y < 0 ? 0 : Y >= gh ? gh - 1 : Y;
      const c = Y * gw + X; key[p] = c; cnt[c + 1]++;
    }
    for (let c = 0; c < NG; c++) cnt[c + 1] += cnt[c];
    for (let p = 0; p < n; p++) o[cnt[key[p]]++] = p;
    for (let m = 0; m < n; m++) invo[o[m]] = m;
    const tmp = this._tmp;
    for (const A of this._keep) {
      for (let m = 0; m < n; m++) tmp[m] = A[o[m]];
      for (let m = 0; m < n; m++) A[m] = tmp[m];
    }
    const S = SLOTS, bj = this.bj, bl = this.bl, tb = this._tmpB, tl = this._tmpL;
    for (let m = 0; m < n; m++) {
      const src = o[m] * S, dst = m * S;
      for (let s = 0; s < S; s++) { const j = bj[src + s]; tb[dst + s] = j >= 0 ? invo[j] : -1; tl[dst + s] = bl[src + s]; }
    }
    bj.set(tb.subarray(0, n * S)); bl.set(tl.subarray(0, n * S));
    for (const p of this.pending) if (p.carrier >= 0 && p.carrier < n) p.carrier = invo[p.carrier];
  }

  // ─────────────────────────── bodies (once per frame) ───────────────────────────

  // Label connected pieces (what the network holds together), measure them, decide whose each is
  // and which one is "me", and let the living breathe.
  analyze(dt) {
    const n = this.n, S = SLOTS, { bj, piece, body, prim, px, py, vx, vy, kin, skin } = this;
    const uf = this._uf;
    for (let i = 0; i < n; i++) uf[i] = i;
    const find = (a) => { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; };
    for (let i = 0; i < n; i++) {
      const o = i * S;
      for (let s = 0; s < S; s++) { const j = bj[o + s]; if (j > i) { const a = find(i), b = find(j); if (a !== b) uf[a] = b; } }
    }
    const root = this._root, csz = this._csz;
    root.fill(-1, 0, n);
    let nc = 0;
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (root[r] < 0) { root[r] = nc; csz[nc] = 0; nc++; }
      const c = root[r]; piece[i] = c; csz[c]++;
    }
    // the largest MAXB−1 get slots of their own, largest first; the rest share the last
    const top = this._top, slot = this._slot, KK = MAXB - 1;
    let nTop = 0;
    for (let c = 0; c < nc; c++) {
      const s = csz[c];
      if (nTop === KK && s <= csz[top[KK - 1]]) continue;
      let k = nTop < KK ? nTop++ : KK - 1;
      while (k > 0 && csz[top[k - 1]] < s) { top[k] = top[k - 1]; k--; }
      top[k] = c;
    }
    for (let c = 0; c < nc; c++) slot[c] = KK;
    for (let k = 0; k < nTop; k++) slot[top[k]] = k;
    const nB = (this.nBodies = nc > KK ? MAXB : nc);
    this.nComps = nc;
    const { bCount, bCx, bCy, bVx, bVy, bR, bVote, bKin, bKinN, bSkin } = this;
    bCount.fill(0); bCx.fill(0); bCy.fill(0); bVx.fill(0); bVy.fill(0); bVote.fill(0); bKinN.fill(0); bSkin.fill(0);
    for (let i = 0; i < n; i++) {
      const b = slot[piece[i]];
      body[i] = b; bCount[b]++;
      bCx[b] += px[i]; bCy[b] += py[i]; bVx[b] += vx[i]; bVy[b] += vy[i];
      bKinN[b * MAXKIN + kin[i]]++; bSkin[b] += skin[i];
      if (prim[i]) bVote[b]++;
    }
    let best = -1, bestV = 0, biggest = -1;
    for (let b = 0; b < nB; b++) {
      const m = bCount[b] || 1;
      bCx[b] /= m; bCy[b] /= m; bVx[b] /= m; bVy[b] /= m; bSkin[b] /= m;
      bR[b] = Math.sqrt((m * this.a0) / Math.PI);
      let owner = WILD, on = 0;
      for (let k = 1; k < MAXKIN; k++) { const c = bKinN[b * MAXKIN + k]; if (c > on) { on = c; owner = k; } }
      bKin[b] = owner;
      if (owner === PLAYER && b < MAXB - 1) {
        if (bVote[b] > bestV) { bestV = bVote[b]; best = b; }
        if (biggest < 0) biggest = b;
      }
    }
    // "me" is whichever piece holds most of what was me — unless it has dwindled to a crumb
    // and a far bigger piece of mine exists
    let pr = best >= 0 ? best : biggest >= 0 ? biggest : 0;
    if (best >= 0 && biggest >= 0 && bCount[best] * 6 < bCount[biggest]) pr = biggest;
    this.primary = pr;
    for (let i = 0; i < n; i++) prim[i] = body[i] === pr ? 1 : 0;
    this._shape();
    if ((this._homeT = (this._homeT || 0) + 1) % 4 === 1 || this._homeB !== this.primary) this._homeField();
    this._homeDirs();
    const mine = this.kinCount[PLAYER], fl = this.P.floorN;
    const target = mine <= 0 ? 0 : Math.max(0, Math.min(1, (2.2 * fl - mine) / (1.2 * fl)));
    this.lastStand += (target - this.lastStand) * Math.min(1, dt * 3);
    this._assimilate(dt);
    this._skins(dt);
    this._breathe(dt);
  }

  // The way home: geodesic distance from "me" across open dish (a breadth-first flood on a coarse
  // grid, eight-connected, walls closed), so a stray finds its way round a wall instead of
  // pressing into it. Cheap: a few thousand cells, a few times a second.
  _homeField() {
    const w = this.world, cs = 0.25, gw = Math.ceil(w.w / cs) + 1, gh = Math.ceil(w.h / cs) + 1, NG = gw * gh;
    if (!this._hd || this._hd.length < NG || this._hWorld !== w) {
      this._hd = new Float32Array(NG); this._hq = new Int32Array(NG); this._hOpen = new Uint8Array(NG);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) this._hOpen[j * gw + i] = w.dist(i * cs, j * cs) > 0.12 ? 1 : 0;
      this._hWorld = w;
    }
    this._hgw = gw; this._hgh = gh; this._hcs = cs; this._homeB = this.primary;
    const D = this._hd, Q = this._hq, open = this._hOpen;
    D.fill(1e9, 0, NG);
    let qh = 0, qt = 0;
    const b = this.primary, { px, py, body } = this;
    if (!this.nBodies || this.bKin[b] !== PLAYER) return;
    for (let i = 0; i < this.n; i += 3) {
      if (body[i] !== b) continue;
      const ci = Math.round(px[i] / cs), cj = Math.round(py[i] / cs);
      if (ci < 0 || cj < 0 || ci >= gw || cj >= gh) continue;
      const c = cj * gw + ci;
      if (D[c] > 0) { D[c] = 0; Q[qt++] = c; }
    }
    // a two-bucket flood: straight steps cost 1, diagonals √2 (close enough for a sense of home)
    while (qh < qt) {
      const c = Q[qh++], d = D[c], ci = c % gw, cj = (c - ci) / gw;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const k = nj * gw + ni;
        if (!open[k]) continue;
        const nd = d + (di && dj ? 1.4142 : 1);
        if (nd < D[k] - 1e-4) { D[k] = nd; Q[qt++] = k; if (qt >= NG) qt = NG - 1; }
      }
    }
  }
  // each stray's heading home: down the field from where it is (or straight, if the field has no
  // word for it)
  _homeDirs() {
    const hd = (this._homeDir = this._homeDir || new Float32Array(MAXB * 2)), nB = this.nBodies, prim = this.primary;
    const D = this._hd, gw = this._hgw, gh = this._hgh, cs = this._hcs;
    for (let b = 0; b < nB && b < MAXB; b++) {
      let ux = this.bCx[prim] - this.bCx[b], uy = this.bCy[prim] - this.bCy[b];
      if (D && b !== prim) {
        const ci = Math.round(this.bCx[b] / cs), cj = Math.round(this.bCy[b] / cs);
        if (ci > 0 && cj > 0 && ci < gw - 1 && cj < gh - 1) {
          let best = D[cj * gw + ci], bx = 0, by = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const d = D[(cj + dj) * gw + ci + di];
            if (d < best) { best = d; bx = di; by = dj; }
          }
          if (bx || by) { ux = bx; uy = by; }
        }
      }
      const l = Math.sqrt(ux * ux + uy * uy) + 1e-9;
      hd[b * 2] = ux / l; hd[b * 2 + 1] = uy / l;
    }
  }

  // second moments of each body (aspect ratio, for the eye and for tests)
  _shape() {
    const { n, body, px, py, bCx, bCy, nBodies, bAsp } = this;
    const m = (this._mom2 = this._mom2 || new Float64Array(MAXB * 3));
    m.fill(0);
    for (let p = 0; p < n; p++) {
      const b = body[p]; if (b < 0) continue;
      const x = px[p] - bCx[b], y = py[p] - bCy[b];
      m[b * 3] += x * x; m[b * 3 + 1] += y * y; m[b * 3 + 2] += x * y;
    }
    for (let b = 0; b < nBodies; b++) {
      const xx = m[b * 3], yy = m[b * 3 + 1], xy = m[b * 3 + 2], tr = xx + yy, det = xx * yy - xy * xy;
      const d = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      bAsp[b] = Math.sqrt((tr / 2 + d) / Math.max(1e-12, tr / 2 - d));
    }
  }

  // Wild matter held inside a living body becomes that body: its kin, its substance. The colour
  // it brought lingers, swirls with the flow and fades.
  _assimilate(dt) {
    const { n, kin, sub, body, bKin, glow, cr, cg, cb } = this;
    const C = CHEM, relax = 1 - Math.exp(-dt * this.P.dyeRelax), gfade = 1 - Math.exp(-dt * 1.5);
    const absR = C.absR, absG = C.absG, absB = C.absB, cglow = C.glow, assim = C.assimilate;
    for (let i = 0; i < n; i++) {
      const s = sub[i];
      if (kin[i] === WILD && assim[s] > 0) {
        const b = body[i];
        if (b >= 0 && bKin[b] !== WILD && this.rand() < C.assimilate[s] * dt) {
          const owner = bKin[b];
          this.kinCount[WILD]--; this.kinCount[owner]++;
          kin[i] = owner;
          const into = C.becomes[s];
          sub[i] = into >= 0 ? into : 0;
          glow[i] = 1;
          this.ev.assimilated++;
          if (owner === PLAYER) this.massGained++;
        }
      }
      const t = sub[i];
      cr[i] += (absR[t] - cr[i]) * relax; cg[i] += (absG[t] - cg[i]) * relax; cb[i] += (absB[t] - cb[i]) * relax;
      glow[i] += (cglow[t] - glow[i]) * gfade;
    }
  }

  // Skins heal: slowly alone, faster in a healing medium or when the owner holds firm.
  _skins(dt) {
    const { n, skin, kin, eHea } = this;
    const heal = dt / this.P.skinHeal, dp = this.dial > 0 ? this.dial : 0;
    for (let i = 0; i < n; i++) {
      if (skin[i] <= 0) continue;
      const own = kin[i] === PLAYER ? 1 + 2 * dp : 1;
      skin[i] -= heal * (eHea[i] || 1) * own;
      if (skin[i] < 0) skin[i] = 0;
    }
  }

  setPrimary(b) {
    if (b < 0 || b >= this.nBodies || this.bKin[b] !== PLAYER) return false;
    this.primary = b;
    for (let i = 0; i < this.n; i++) this.prim[i] = this.body[i] === b ? 1 : 0;
    return true;
  }

  // Multi-scale Gaussian lobes drift through each living body and modulate the rest area each
  // particle wants. Zero-mean per body, so breathing moves area and never makes it. Calm: slow and
  // deep. Startled: quick and shallow. Holding firm: breath held. Near the floor: fast, faint.
  _breathe(dt) {
    const P = this.P, n = this.n;
    const { px, py, body, bCx, bCy, bR, bCount, bSum, bKin } = this;
    const ar = this.arousal, hold = this.dial > 0 ? this.dial : 0, L = this.lastStand;
    const amp = P.breath * (1 - 0.8 * hold) * (1 + 1.4 * ar) * (1 - 0.5 * L);
    this._bphase = (this._bphase || 0) + dt * ((2 * Math.PI) / P.breathPeriod) * (1 + 2.2 * ar + 1.5 * L);
    const ph = this._bphase, nB = this.nBodies, narrow = 1 - 0.45 * ar;
    const Lb = (this._lobes = this._lobes || new Float32Array(MAXB * 12));
    for (let b = 0; b < nB; b++) {
      const R = bR[b], o = b * 12, k = b * 1.7;
      const s0 = 0.95 * R * narrow, s1 = 0.5 * R * narrow, s2 = 0.24 * R * narrow;
      Lb[o] = bCx[b] + 0.35 * R * Math.cos(ph * 0.31 + k); Lb[o + 1] = bCy[b] + 0.35 * R * Math.sin(ph * 0.31 + k);
      Lb[o + 2] = 0.5 / (s0 * s0); Lb[o + 3] = Math.sin(ph + k);
      Lb[o + 4] = bCx[b] + 0.62 * R * Math.cos(-ph * 0.53 + 2.1 + k); Lb[o + 5] = bCy[b] + 0.62 * R * Math.sin(-ph * 0.53 + 2.1 + k);
      Lb[o + 6] = 0.5 / (s1 * s1); Lb[o + 7] = 0.8 * Math.sin(ph * 1.7 + 1.3 + k);
      Lb[o + 8] = bCx[b] + 0.8 * R * Math.cos(ph * 1.9 + 4.0 + k); Lb[o + 9] = bCy[b] + 0.8 * R * Math.sin(ph * 1.9 + 4.0 + k);
      Lb[o + 10] = 0.5 / (s2 * s2); Lb[o + 11] = (0.35 + 1.4 * ar) * Math.sin(ph * 4.3 + 0.4 + k);
      bSum[b] = b >= MAXB - 1 || bCount[b] < 24 || bKin[b] === WILD ? NaN : 0;
    }
    const brt = this.brt;
    for (let i = 0; i < n; i++) {
      const b = body[i];
      if (b < 0 || !(bSum[b] === bSum[b])) { brt[i] = 0; continue; }
      const o = b * 12, x = px[i], y = py[i];
      let s = 0;
      for (let l = 0; l < 12; l += 4) {
        const dx = x - Lb[o + l], dy = y - Lb[o + l + 1];
        let g = 1 - (dx * dx + dy * dy) * Lb[o + l + 2] * 0.16667;   // (1 − x/6)⁶ ≈ e^(−x)
        if (g > 0) { g *= g * g; s += Lb[o + l + 3] * g * g; }
      }
      brt[i] = s; bSum[b] += s;
    }
    for (let i = 0; i < n; i++) {
      const b = body[i];
      brt[i] = b >= 0 && bSum[b] === bSum[b] ? 1 + amp * (brt[i] - bSum[b] / bCount[b]) : 1;
    }
  }

  // ───────────────────────────── mass in, mass out ─────────────────────────────

  _emit(x, y, vx, vy, life, kind) {
    if (this.exN >= MAX_EX) return;
    const k = this.exN++;
    this.exX[k] = x; this.exY[k] = y; this.exVx[k] = vx; this.exVy[k] = vy; this.exLife[k] = life; this.exKind[k] = kind;
  }
  _exhaust(dt) {
    const { exX, exY, exVx, exVy, exLife, exKind } = this;
    const f = 1 / (1 + 3.2 * dt);
    for (let k = this.exN - 1; k >= 0; k--) {
      exLife[k] -= dt;
      if (exLife[k] <= 0) {
        const l = --this.exN;
        exX[k] = exX[l]; exY[k] = exY[l]; exVx[k] = exVx[l]; exVy[k] = exVy[l]; exLife[k] = exLife[l]; exKind[k] = exKind[l];
        continue;
      }
      exX[k] += exVx[k] * dt; exY[k] += exVy[k] * dt; exVx[k] *= f; exVy[k] *= f;
    }
  }

  // Mass taken mid-tick is only marked; it leaves at the end of the tick (nothing may keep naming
  // a particle that has gone). No lineage goes below its floor.
  _swallow(i, kind) {
    const k = this.kin[i];
    if (k !== WILD) {
      if (this.kinCount[k] - this._lossQ[k] <= this.P.floorN) return;
      if (k === PLAYER && this.lastStand > 0.5) return;
    }
    this._lossQ[k]++;
    this._eat.push(i); this._eatKind.push(kind);
  }
  _consume() {
    const q = this._eat, kq = this._eatKind;
    this._lossQ.fill(0);
    if (!q.length) return;
    // remove from the highest index down so that swap-removal never moves a marked particle
    const ord = q.map((i, k) => [i, kq[k]]).sort((a, b) => b[0] - a[0]);
    let last = -1;
    for (const [i, kind] of ord) {
      if (i === last || i >= this.n) continue;
      last = i;
      const k = this.kin[i];
      this._emit(this.px[i], this.py[i], this.vx[i] * 0.3, this.vy[i] * 0.3, 0.5 + this.rand() * 0.4, kind);
      this.remove(i);
      if (k === PLAYER) this.massEroded++;
      if (kind === 2) this.ev.drunk++; else this.ev.eroded++;
    }
    q.length = 0; kq.length = 0;
  }

  burnPrice() {
    const w = this.world, b = this.primary;
    if (!this.nBodies) return 1;
    let m = 1;
    for (const z of w.zones) { const k = w.zoneWeight(z, this.bCx[b], this.bCy[b]); if (k > 0) m *= 1 + (z.burn - 1) * k; }
    return m;
  }

  // Mass–energy: spend a fraction of the primary body and buy kinetic energy with it.
  //   ½ (n−k) v² = c² k  →  dv = burnC · sqrt(k / (n − k))
  // The spent mass leaves from the trailing surface. Returns particles burnt (0 = refused).
  burn(dirx, diry, fraction) {
    const b = this.primary;
    if (this.nBodies === 0 || this.bKin[b] !== PLAYER) return 0;
    const nb = this.bCount[b];
    const dl = Math.hypot(dirx, diry);
    if (dl < 1e-6) return 0;
    dirx /= dl; diry /= dl;
    const price = this.burnPrice();
    let k = Math.round(nb * fraction * price);
    k = Math.min(k, this.kinCount[PLAYER] - this.floor, nb - 8);
    const free = price < 0.05;
    if (free) k = 0; else if (k < 3) return 0;
    const { px, py, vx, vy, body, phi, kin } = this;
    const cx = this.bCx[b], cy = this.bCy[b], R = this.bR[b];
    const cand = [];
    for (let i = 0; i < this.n; i++) {
      if (body[i] !== b) continue;
      const u = ((px[i] - cx) * dirx + (py[i] - cy) * diry) / R;
      cand.push([u + (phi[i] - 0.6) * 0.8 + this.rand() * 0.25 + (kin[i] === PLAYER ? 0 : 9), i]);
    }
    cand.sort((a, c) => a[0] - c[0]);
    const dead = cand.slice(0, k).map((c) => c[1]).sort((a, c) => c - a);
    const kk = free ? Math.round(nb * fraction) : k / price;
    const dv = this.P.burnC * Math.sqrt(kk / Math.max(1, nb - k));
    for (let m = k; m < cand.length; m++) {
      const i = cand[m][1];
      const u = ((px[i] - cx) * dirx + (py[i] - cy) * diry) / R;
      const w = 1 + 0.22 * (u < -1 ? -1 : u > 1 ? 1 : u);       // the front leaves first: it squashes
      vx[i] += dirx * dv * w; vy[i] += diry * dv * w;
    }
    for (const i of dead) {
      const sp = 18 + this.rand() * 26, a = (this.rand() - 0.5) * 1.3, ca = Math.cos(a), sa = Math.sin(a);
      this._emit(px[i], py[i], vx[i] - (dirx * ca - diry * sa) * sp, vy[i] - (diry * ca + dirx * sa) * sp, 0.35 + this.rand() * 0.45, 0);
      this.remove(i);
    }
    this.vmax = Math.max(this.vmax, dv * 1.3);
    this.massBurnt += k; this.arousal = Math.min(1, this.arousal + 0.8);
    return Math.max(k, free ? 1 : 0);
  }

  // Well n particles of substance `sub` up inside the body that particle `carrier` belongs to.
  infuse(carrier, n, sub = 0) { this.pending.push({ carrier, n, sub }); }
  _feed() {
    const pend = this.pending;
    for (let k = pend.length - 1; k >= 0; k--) {
      const p = pend[k];
      let c = p.carrier;
      if (c < 0 || c >= this.n) { c = -1; for (let i = 0; i < this.n; i++) if (this.prim[i]) { c = i; break; } }
      if (c < 0) { pend.splice(k, 1); continue; }
      p.carrier = c;
      for (let m = 0; m < 2 && p.n > 0; m++) {
        const a = this.rand() * 6.2832, r = this.d0 * (0.3 + 0.5 * this.rand());
        const i = this.add(this.px[c] + Math.cos(a) * r, this.py[c] + Math.sin(a) * r, this.vx[c], this.vy[c], p.sub, this.kin[c]);
        if (i < 0) { p.n = 0; break; }
        this.body[i] = this.body[c]; this.piece[i] = this.piece[c]; this.prim[i] = this.prim[c];
        p.n--; if (this.kin[c] === PLAYER) this.massGained++;
      }
      if (p.n <= 0) pend.splice(k, 1);
    }
  }

  startle(amount) { this.arousal = Math.min(1, this.arousal + amount); }

  // Hold matter: every particle within r of (x, y) is taken hold of (a fingertip, a pincer). Returns
  // a handle; moveHold drags what is held, releaseHold lets it go. What is held is exempt from the
  // body's own urge to round itself — so pulling it draws a neck and a strand, as it should.
  hold(x, y, r = 0.35) {
    const id = (this._holdId = (this._holdId || 0) + 1), held = (this._holds = this._holds || new Map());
    const set = [];
    for (let i = 0; i < this.n; i++) {
      const dx = this.px[i] - x, dy = this.py[i] - y;
      if (dx * dx + dy * dy < r * r) { this.anc[i] = 3; this.aX[i] = this.px[i]; this.aY[i] = this.py[i]; this.aL[i] = 0; set.push(this.seed[i]); }
    }
    held.set(id, { seeds: new Set(set), x, y });
    return set.length ? id : 0;
  }
  moveHold(id, x, y) {
    const h = this._holds && this._holds.get(id);
    if (!h) return;
    const dx = x - h.x, dy = y - h.y;
    h.x = x; h.y = y;
    for (let i = 0; i < this.n; i++) if (this.anc[i] === 3 && h.seeds.has(this.seed[i])) { this.aX[i] += dx; this.aY[i] += dy; }
  }
  releaseHold(id) {
    const h = this._holds && this._holds.get(id);
    if (!h) return;
    for (let i = 0; i < this.n; i++) if (this.anc[i] === 3 && h.seeds.has(this.seed[i])) this.anc[i] = 0;
    this._holds.delete(id);
  }

  // A fingertip pressed into matter at (x, y): everything within r is pushed radially away,
  // hardest at the centre. The dimple fills back in — and the body rings with it.
  poke(x, y, r = 0.9, strength = 6) {
    const { px, py, vx, vy } = this, r2 = r * r;
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = px[i] - x, dy = py[i] - y, d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      const d = Math.sqrt(d2) + 1e-6, f = 1 - d2 / r2;
      vx[i] += (dx / d) * strength * f * f; vy[i] += (dy / d) * strength * f * f;
      c++;
    }
    if (c) this.startle(0.35);
    return c;
  }

  drainEvents() {
    const e = this.ev, out = (this._evOut = this._evOut || { ...e });
    for (const k in e) { out[k] = e[k]; e[k] = 0; }
    return out;
  }

  // Diagnostics: mean and worst over-compression as a fraction of rest density.
  compression() {
    let sum = 0, worst = 0, m = 0;
    for (let i = 0; i < this.n; i++) { const c = this.rho[i] / this.rho0 - 1; if (this.phi[i] > 0.8) { m++; if (c > 0) sum += c; if (c > worst) worst = c; } }
    return { mean: m ? sum / m : 0, worst };
  }
}
