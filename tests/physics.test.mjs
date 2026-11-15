// The laws, as tests. Each runs the real solver for a few simulated seconds and checks one thing
// the game promises — measured the way a player would see it, never through a proxy that a broken
// state could satisfy (a test that cannot fail is worse than none). `npm test [filter]`.
import { World, MAT } from '../src/sim/world.js';
import { Continuum } from '../src/sim/continuum.js';
import { SUB, PLAYER, WILD } from '../src/sim/substances.js';
import { visualArea } from './measure.mjs';

const DT = 1 / 120;
const filter = process.argv[2] || '';
let pass = 0, fail = 0;

function test(name, fn) {
  if (filter && !name.includes(filter)) return;
  const t0 = performance.now();
  let line;
  try {
    const note = fn();
    pass++; line = `  ✓ ${name}${note ? `  — ${note}` : ''}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`;
  } catch (e) {
    fail++; line = `  ✗ ${name}\n      ${e.message}`;
  }
  console.log(line);
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

function dish(def = {}, params = {}) { return new Continuum(new World({ w: 20, h: 16, prims: [], ...def }), { d0: 0.12, ...params }); }
function bead(sim, x, y, area, opts) { const n = Math.round(area / sim.a0); const ids = sim.spawnBlob(x, y, n, opts); sim.massRef = n; sim.analyze(DT); return ids; }
// one displayed frame at 60 Hz: two ticks, then the per-frame analysis (exactly as the game does)
function run(sim, seconds, each) {
  const frames = Math.round(seconds * 60);
  for (let f = 0; f < frames; f++) { if (each) each(f / 60); sim.step(DT); sim.step(DT); sim.analyze(1 / 60); }
}
function finite(sim) { for (let i = 0; i < sim.n; i++) if (!(isFinite(sim.px[i]) && isFinite(sim.py[i]) && isFinite(sim.vx[i]) && isFinite(sim.vy[i]))) return false; return true; }
function com(sim, pred) {
  let x = 0, y = 0, n = 0;
  for (let i = 0; i < sim.n; i++) if (!pred || pred(i)) { x += sim.px[i]; y += sim.py[i]; n++; }
  return [x / n, y / n, n];
}
// share of a body's matter lying outside the disc of its own area (a lump, a tail, a pseudopod)
function overflow(sim, b = sim.primary) {
  const cx = sim.bCx[b], cy = sim.bCy[b], R = sim.bR[b];
  let out = 0, n = 0;
  for (let i = 0; i < sim.n; i++) if (sim.body[i] === b) { n++; if (Math.hypot(sim.px[i] - cx, sim.py[i] - cy) > R * 1.04) out++; }
  return out / Math.max(1, n);
}
// the emptiest place near a body's middle: a hollow body has nothing there
function hollow(sim, b = sim.primary) {
  let r = 9;
  for (let i = 0; i < sim.n; i++) if (sim.body[i] === b) r = Math.min(r, Math.hypot(sim.px[i] - sim.bCx[b], sim.py[i] - sim.bCy[b]));
  return r;
}
const areaRatio = (sim) => visualArea(sim) / (sim.n * sim.a0);

// ── area = mass ────────────────────────────────────────────────────────────────────────────
test('area: a bead at rest shows exactly the area its mass is', () => {
  const sim = dish(); bead(sim, 10, 8, 15);
  run(sim, 2);
  expect(finite(sim) && sim.nComps === 1, `not one finite body (${sim.nComps} pieces)`);
  const a = areaRatio(sim);
  expect(Math.abs(a - 1) < 0.03, `visual area / mass = ${a.toFixed(3)}`);
  return `ratio ${a.toFixed(3)}`;
});

test('area: squeezed through a slit narrower than itself, area holds and it gets through', () => {
  const prims = [{ t: 'box', x: 5.2, y: 6, hw: 4.2, hh: 0.6, r: 0.5 }, { t: 'box', x: 14.8, y: 6, hw: 4.2, hh: 0.6, r: 0.5 }];
  const sim = dish({ prims }); bead(sim, 10, 10.5, 15);
  let lo = 9, hi = 0;
  run(sim, 3.5, (t) => {
    sim.stickY = -1;
    if (t > 0.5) { const big = (i) => sim.bCount[sim.body[i]] > 40; let m = 0; for (let i = 0; i < sim.n; i++) if (big(i)) m++; const a = visualArea(sim, 0.025, { filter: big }) / (m * sim.a0); lo = Math.min(lo, a); hi = Math.max(hi, a); }
  });
  expect(lo > 0.92 && hi < 1.07, `area ratio ranged ${lo.toFixed(3)} … ${hi.toFixed(3)}`);
  const [, y] = com(sim, (i) => sim.kin[i] === PLAYER);
  expect(y < 5.2, `its matter did not get through (mean y = ${y.toFixed(2)})`);
  return `ratio ${lo.toFixed(3)} … ${hi.toFixed(3)}`;
});

// ── momentum ───────────────────────────────────────────────────────────────────────────────
test('momentum: with no will and no field, a body cannot move itself', () => {
  const sim = dish(); bead(sim, 10, 8, 15);
  run(sim, 0.5);
  const [x0, y0] = com(sim);
  run(sim, 3);
  const [x1, y1] = com(sim);
  const d = Math.hypot(x1 - x0, y1 - y0);
  expect(d < 0.02, `centre of mass drifted ${d.toFixed(4)}`);
  return `drift ${d.toExponential(1)}`;
});

test('momentum: its own cohesion, rounding a ragged body, moves it nowhere', () => {
  // three lumps fused into one ragged body: every cohesion law works hard to round it
  const sim = dish();
  // (one body from the start — knitted together where the lumps meet — so nothing here is a
  // stray swimming home, which is a force of its own)
  sim.spawnBlob(9, 8, 300); sim.spawnBlob(11.15, 8.2, 250); sim.spawnBlob(10.0, 10.05, 220);
  for (let i = 0; i < sim.n; i++) sim.piece[i] = 5;
  sim._bondFresh(0, sim.n); sim.massRef = 770; sim.analyze(DT);
  run(sim, 0.4);
  const [x0, y0] = com(sim);
  run(sim, 2.5);
  const [x1, y1] = com(sim);
  const d = Math.hypot(x1 - x0, y1 - y0);
  expect(sim.nComps === 1, `the lumps did not become one (${sim.nComps})`);
  expect(d < 0.05, `centre of mass drifted ${d.toFixed(4)} while rounding`);
  expect(overflow(sim) < 0.05, `still ragged: overflow ${(overflow(sim) * 100).toFixed(1)}%`);
  return `drift ${d.toExponential(1)}`;
});

// ── shape ──────────────────────────────────────────────────────────────────────────────────
test('shape: a long slab gathers itself into one bead', () => {
  const sim = dish({ w: 24 });
  const s = sim.sp, rh = (s * Math.sqrt(3)) / 2;
  let k = 0;
  for (let y = 8 - 1.2; y < 8 + 1.2; y += rh, k++) for (let x = 12 - 6 + (k & 1) * s / 2; x < 12 + 6; x += s) sim.add(x, y);
  for (let i = 0; i < sim.n; i++) sim.piece[i] = 3;
  sim._bondFresh(0, sim.n); sim.massRef = sim.n; sim.analyze(DT);
  expect(sim.n > 1500 && finite(sim), 'the slab was not built');
  run(sim, 3);
  const o = overflow(sim);
  expect(sim.nComps === 1, `it came apart into ${sim.nComps} pieces`);
  expect(o < 0.04 && sim.bAsp[sim.primary] < 1.1, `not round: overflow ${(o * 100).toFixed(1)}%, aspect ${sim.bAsp[sim.primary].toFixed(2)}`);
  return `aspect ${sim.bAsp[sim.primary].toFixed(3)}`;
});

test('shape: squashed and let go, it rings like a drop and settles', () => {
  const sim = dish(); bead(sim, 10, 8, 15);
  run(sim, 0.5);
  for (let i = 0; i < sim.n; i++) { sim.vx[i] += (sim.px[i] - 10) * 3; sim.vy[i] -= (sim.py[i] - 8) * 3; }
  const s = [];
  run(sim, 3, () => {
    let xx = 0, yy = 0; const [cx, cy] = com(sim);
    for (let i = 0; i < sim.n; i++) { xx += (sim.px[i] - cx) ** 2; yy += (sim.py[i] - cy) ** 2; }
    s.push(Math.log(xx / yy) / 2);
  });
  const zc = []; for (let k = 1; k < s.length; k++) if ((s[k - 1] > 0) !== (s[k] > 0)) zc.push(k / 60);
  expect(zc.length >= 3, `it did not ring (${zc.length} zero crossings)`);
  const period = zc[2] - zc[0];
  expect(period > 0.25 && period < 0.8, `ring period ${period.toFixed(2)}s`);
  const late = Math.max(...s.slice(-30).map(Math.abs));
  expect(late < 0.02, `still ringing after 3 s (${late.toFixed(3)})`);
  return `period ${period.toFixed(2)}s (${(1 / period).toFixed(1)} Hz)`;
});

test('shape: a hole punched through it heals', () => {
  const sim = dish();
  sim.spawnBlob(10, 8, 700);
  for (let i = sim.n - 1; i >= 0; i--) if (Math.hypot(sim.px[i] - 10, sim.py[i] - 8) < 0.9) sim.remove(i);
  sim.massRef = sim.n; sim.analyze(DT);
  expect(hollow(sim) > 0.8, 'no hole was punched');
  let closed = -1;
  run(sim, 2, (t) => { if (closed < 0 && hollow(sim) < 0.15) closed = t; });
  expect(closed > 0 && closed < 1.2, closed < 0 ? `still hollow after 2 s (${hollow(sim).toFixed(2)})` : `took ${closed.toFixed(2)} s`);
  return `closed in ${closed.toFixed(2)} s`;
});

// ── the will ───────────────────────────────────────────────────────────────────────────────
test('will: a nudge reaches out a pseudopod — the rest stays put — and it comes home on release', () => {
  const sim = dish(); bead(sim, 8, 8, 15);
  run(sim, 0.4);
  const x0 = sim.bCx[sim.primary];
  let front = 0;
  run(sim, 1.0, () => { sim.stickX = 0.3; });
  const b = sim.primary;
  for (let i = 0; i < sim.n; i++) front = Math.max(front, sim.px[i] - sim.bCx[b]);
  const moved = sim.bCx[b] - x0;
  expect(front > sim.bR[b] * 1.35, `front reaches only ${(front / sim.bR[b]).toFixed(2)} R`);
  expect(moved < 0.8, `the whole body slid ${moved.toFixed(2)} instead of reaching`);
  sim.stickX = 0;
  run(sim, 1.2);
  expect(overflow(sim) < 0.03, `the pseudopod did not come home (overflow ${(overflow(sim) * 100).toFixed(1)}%)`);
  return `reach ${(front / sim.bR[b]).toFixed(2)} R, body moved ${moved.toFixed(2)}`;
});

test('will: a full throw carries the whole body, in one piece, circulating as it goes', () => {
  const sim = dish({ w: 40 }); bead(sim, 6, 8, 15);
  run(sim, 0.3);
  let core = 0, flank = 0, nc = 0, nf = 0;
  run(sim, 1.4, (t) => {
    sim.stickX = 1;
    if (t > 0.8) {
      const b = sim.primary;
      for (let i = 0; i < sim.n; i++) {
        if (sim.body[i] !== b) continue;
        const lat = Math.abs(sim.py[i] - sim.bCy[b]) / sim.bR[b];
        if (lat < 0.25) { core += sim.vx[i]; nc++; } else if (lat > 0.7) { flank += sim.vx[i]; nf++; }
      }
    }
  });
  const v = sim.bVx[sim.primary];
  expect(v > 4, `cruise speed only ${v.toFixed(2)}`);
  expect(sim.nComps === 1, `it came apart (${sim.nComps} pieces)`);
  const lead = core / nc - flank / nf;
  expect(lead > 0.5, `no fountain: core leads flanks by only ${lead.toFixed(2)} u/s`);
  return `${v.toFixed(1)} u/s, core leads flanks by ${lead.toFixed(1)} u/s`;
});

test('will: a thumb wiggling in place never hollows the body out', () => {
  const sim = dish(); bead(sim, 10, 8, 6.5);
  let worst = 0;
  run(sim, 4, (t) => {
    const b = sim.primary, dx = 10 - sim.bCx[b], dy = 8 - sim.bCy[b], d = Math.hypot(dx, dy) + 1e-6, m = Math.min(1, 0.45 + d / 2);
    sim.stickX = (dx / d) * m; sim.stickY = (dy / d) * m;
    if (t > 1) worst = Math.max(worst, hollow(sim));
  });
  expect(finite(sim) && worst < 0.3, `a hollow ${worst.toFixed(2)} opened in the middle`);
  return `emptiest middle ${worst.toFixed(2)}`;
});

test('will: a stray behind a wall finds its way home around it', () => {
  // a wall between the stray and "me": the straight way home runs into it
  const prims = [{ t: 'box', x: 10, y: 8, hw: 0.4, hh: 4.5, r: 0.3 }];
  const sim = dish({ prims });
  sim.spawnBlob(5, 8, 700); sim.spawnBlob(15, 8, 120); sim.massRef = 820; sim.analyze(DT);
  run(sim, 0.2);
  const b0 = sim.primary;
  expect(sim.bCount[b0] > 500, 'the big piece is not "me"');
  let home = -1;
  run(sim, 7, (t) => { if (home < 0 && sim.nComps === 1) home = t; });
  expect(home > 0, `the stray never came home (still ${sim.nComps} pieces)`);
  return `home in ${home.toFixed(1)} s`;
});

// ── fusion is a rate, never a rule ─────────────────────────────────────────────────────────
function meet(kind) {
  const all = { t: 'box', x: 10, y: 7, hw: 10, hh: 7 };
  const zones = kind === 'rivalheal' ? [{ ...all, fuse: 4, heal: 6 }] : kind === 'repel' ? [{ ...all, fuse: -0.6 }] : [];
  const sim = dish({ w: 20, h: 14, zones, fields: [{ t: 'well', x: 10, y: 7, g: 9, core: 2.5, range: 12 }] });
  const kB = kind === 'rival' || kind === 'rivalheal' ? 3 : kind === 'lipid' ? WILD : 2;
  const n = Math.round(6 / sim.a0);
  const A = sim.spawnBlob(7.2, 7, n, { kin: 2 });
  const B = sim.spawnBlob(12.8, 7, n, { sub: kind === 'lipid' ? SUB.lipid : SUB.myria, kin: kB });
  if (kind === 'cut') {
    for (const i of A) if (sim.px[i] > 7.9) { sim.skin[i] = 1; sim.snx[i] = 1; sim.sny[i] = 0; }
    for (const i of B) if (sim.px[i] < 12.1) { sim.skin[i] = 1; sim.snx[i] = -1; sim.sny[i] = 0; }
  }
  for (const i of A) sim.vx[i] = 1.2;
  for (const i of B) sim.vx[i] = -1.2;
  // (storage is re-sorted as the sim runs, so membership is remembered by each particle's seed)
  const inA = new Set(A.map((i) => sim.seed[i]));
  sim.massRef = 2 * n; sim.analyze(DT);
  let touch = -1, fused = -1, gap = 9;
  run(sim, 5, (t) => {
    let xa = -9, xb = 99;
    for (let i = 0; i < sim.n; i++) if (inA.has(sim.seed[i])) xa = Math.max(xa, sim.px[i]); else xb = Math.min(xb, sim.px[i]);
    gap = Math.min(gap, xb - xa);
    if (touch < 0 && xb - xa < 1.6 * sim.d0) touch = t;
    if (fused < 0 && sim.nComps === 1) fused = t;
  });
  return { touch, fused, gap, sim };
}
test('fusion: two pieces of one lineage become one on contact', () => {
  const { fused, touch } = meet('kin');
  expect(fused > 0 && fused < 2, `fused at ${fused.toFixed(2)}`);
  return `touched ${touch.toFixed(2)}s, one at ${fused.toFixed(2)}s`;
});
test('fusion: the same gel of two lineages presses together but stays two', () => {
  const { fused, touch } = meet('rival');
  expect(touch > 0, 'they never met');
  expect(fused < 0, `they fused at ${fused.toFixed(2)}s`);
});
test('fusion: immiscible gels never fuse', () => {
  const { fused, touch } = meet('lipid');
  expect(touch > 0, 'they never met');
  expect(fused < 0, `they fused at ${fused.toFixed(2)}s`);
});
test('fusion: fresh-cut faces resist, then heal and take', () => {
  const { touch, fused } = meet('cut');
  expect(touch > 0, 'they never met');
  expect(fused < 0 || fused - touch > 0.6, `cut faces fused only ${(fused - touch).toFixed(2)}s after touching`);
  return fused < 0 ? 'held apart for 5 s' : `took after ${(fused - touch).toFixed(2)}s`;
});
test('fusion: a healing medium and pressure overcome even kinship', () => {
  const { fused } = meet('rivalheal');
  expect(fused > 0, 'rivals in a healing bath never fused');
  return `fused at ${fused.toFixed(2)}s`;
});
test('fusion: a repellent medium holds pieces of one lineage apart, untouched', () => {
  const { fused, gap } = meet('repel');
  expect(fused < 0, `they fused at ${fused.toFixed(2)}s`);
  expect(gap > 1.2 * 0.12, `they still touched (closest ${gap.toFixed(3)})`);
  return `closest approach ${gap.toFixed(2)}`;
});

// ── strands ────────────────────────────────────────────────────────────────────────────────
// two fingertips take hold of either side of a bead and draw them apart
function pull(v) {
  const sim = dish({ w: 40, h: 12 }); bead(sim, 20, 6, 12);
  run(sim, 0.3);
  const R = sim.bR[sim.primary];
  let xl = 20 - 0.65 * R, xr = 20 + 0.65 * R;
  const hl = sim.hold(xl, 6, 0.75), hr = sim.hold(xr, 6, 0.75);
  let span = 0, snaps = 0, parted = -1;
  run(sim, 10, (t) => {
    if (parted >= 0) return;
    xl -= v / 60; xr += v / 60; sim.moveHold(hl, xl, 6); sim.moveHold(hr, xr, 6);
    if (sim.nComps === 1) { let lo = 99, hi = -99; for (let i = 0; i < sim.n; i++) { lo = Math.min(lo, sim.px[i]); hi = Math.max(hi, sim.px[i]); } span = hi - lo; }
    else parted = t;
    snaps += sim.drainEvents().snaps;
  });
  return { span, snaps, parted, sim };
}
test('strands: drawn apart, it necks into a thinning strand and lets go — slowly, later', () => {
  const slow = pull(0.8), fast = pull(6);
  expect(slow.parted > 0 && fast.parted > 0, `it never let go (slow ${slow.parted}, fast ${fast.parted})`);
  expect(slow.span > 6.5, `the slow strand only spanned ${slow.span.toFixed(2)} before letting go`);
  expect(slow.parted > 3 * fast.parted, `slow parted at ${slow.parted.toFixed(2)}s, fast at ${fast.parted.toFixed(2)}s`);
  return `slow: spans ${slow.span.toFixed(1)}, parts at ${slow.parted.toFixed(1)}s · fast: parts at ${fast.parted.toFixed(2)}s`;
});

// ── mass ───────────────────────────────────────────────────────────────────────────────────
test('mass: wild nutrient touched is taken in and becomes you', () => {
  const sim = dish(); bead(sim, 7, 8, 12); sim.spawnBlob(11.5, 8, 60, { sub: SUB.amber, kin: WILD }); sim.analyze(DT);
  const m0 = sim.playerMass();
  run(sim, 4, (t) => { sim.stickX = t < 1.8 ? 0.8 : 0; });
  expect(sim.playerMass() - m0 >= 56, `only ${sim.playerMass() - m0} of 60 taken in`);
  return `${sim.playerMass() - m0} of 60 taken in`;
});

test('mass: a burst spends mass and buys speed; the floor refuses the last of it', () => {
  const sim = dish(); bead(sim, 10, 8, 12);
  run(sim, 0.3);
  const n0 = sim.playerMass();
  const k = sim.burn(1, 0, 0.1);
  sim.analyze(DT);
  expect(k > 0 && sim.playerMass() < n0, 'burn did nothing');
  run(sim, 0.1);
  expect(sim.bVx[sim.primary] > 3, `burst speed only ${sim.bVx[sim.primary].toFixed(2)}`);
  sim.P.floorN = sim.playerMass() - 20;
  sim.burn(1, 0, 0.1); sim.analyze(DT);
  expect(sim.playerMass() >= sim.P.floorN, `burned below the floor: ${sim.playerMass()} < ${sim.P.floorN}`);
  const k3 = sim.burn(1, 0, 0.1);
  expect(k3 === 0, `at the floor, a burn still took ${k3}`);
  return `${k} burnt → ${sim.bVx[sim.primary].toFixed(1)} u/s`;
});

test('mass: an abrasive wall grinds you down, never past the floor', () => {
  const prims = [{ t: 'box', x: 10, y: 1.5, hw: 9, hh: 1.0, r: 0.2, m: MAT.ABRASIVE }];
  const sim = dish({ prims }, { floorN: 400 }); bead(sim, 10, 5, 15);
  const m0 = sim.playerMass();
  run(sim, 5, (t) => { sim.stickY = -0.6; sim.stickX = Math.sin(t * 3) > 0 ? 1 : -1; });
  expect(sim.playerMass() < m0 - 10, `nothing was ground away (${sim.playerMass()})`);
  expect(sim.playerMass() >= 400, `ground below the floor: ${sim.playerMass()}`);
  return `${m0 - sim.playerMass()} lost`;
});

test('mass: near the floor, what is left becomes a seed nothing can grind', () => {
  const prims = [{ t: 'box', x: 10, y: 1.5, hw: 9, hh: 1.0, r: 0.2, m: MAT.ABRASIVE }];
  const sim = dish({ prims }, { floorN: 200 }); bead(sim, 10, 5, 5.8);
  run(sim, 5, (t) => { sim.stickY = -0.6; sim.stickX = Math.sin(t * 3) > 0 ? 1 : -1; });
  expect(sim.lastStand > 0.5, `last stand only ${sim.lastStand.toFixed(2)}`);
  expect(sim.playerMass() > 200, `mass ${sim.playerMass()}`);
  return `held at ${sim.playerMass()} (floor 200), last stand ${sim.lastStand.toFixed(2)}`;
});

test('mass: a well that drinks takes what reaches its core — never past the floor', () => {
  const sim = dish({ fields: [{ t: 'well', x: 10, y: 8, g: 40, core: 1.2, range: 6, eat: 3 }] }, { floorN: 400 });
  bead(sim, 10, 8, 11.5);
  const m0 = sim.playerMass();
  run(sim, 4);
  expect(sim.playerMass() < m0 - 10, `the well drank nothing (${sim.playerMass()})`);
  expect(sim.playerMass() >= 400, `drank past the floor: ${sim.playerMass()}`);
  return `${m0 - sim.playerMass()} drunk`;
});

// ── touch and walls ───────────────────────────────────────────────────────────────────────
test('touch: a poke dimples the body and it rings back to a bead', () => {
  const sim = dish(); bead(sim, 10, 8, 15);
  run(sim, 0.5);
  const n = sim.poke(10 + 1.6, 8, 0.85, 6);
  expect(n > 20, `the poke touched only ${n}`);
  run(sim, 0.15);
  const dented = overflow(sim);
  run(sim, 2);
  const after = overflow(sim);
  expect(after < 0.03, `did not recover (${(after * 100).toFixed(1)}%)`);
  return `overflow ${(dented * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%`;
});

test('walls: glass is slick tangentially — a body slides along it freely', () => {
  const prims = [{ t: 'box', x: 15, y: 2, hw: 14, hh: 1, r: 0.1, m: MAT.GLASS }];
  const sim = dish({ w: 30, prims }); bead(sim, 8, 5.2, 12);
  run(sim, 0.8, () => { sim.stickY = -0.6; });
  const x0 = sim.bCx[sim.primary];
  run(sim, 1.0, () => { sim.stickY = -0.4; sim.stickX = 0.8; });
  const glide = sim.bCx[sim.primary] - x0;
  expect(glide > 2.5, `slid only ${glide.toFixed(2)}`);
  return `slid ${glide.toFixed(2)} units in 1 s`;
});

test('walls: a tacky surface holds what rests on it and lets go in a strand', () => {
  const prims = [{ t: 'box', x: 10, y: 2.2, hw: 5, hh: 0.5, r: 0.3, m: MAT.TACKY }];
  const sim = dish({ prims }); bead(sim, 10, 6.2, 15);
  let snaps = 0, held = 0;
  run(sim, 4, (t) => {
    sim.stickY = t < 1.4 ? -0.7 : t < 3.6 ? 1 : 0;
    snaps += sim.drainEvents().snaps;
    if (t > 2.4 && t < 2.6) { held = 0; for (let i = 0; i < sim.n; i++) if (sim.py[i] < 3.4) held++; }
  });
  expect(held > 10, `nothing held on (${held})`);
  expect(snaps > 0, 'no strand snapped');
  return `${held} held while pulling, ${snaps} snaps`;
});

test('walls: a razor parts what is driven onto it, and the faces are skinned', () => {
  const prims = [{ t: 'poly', pts: [10, 3.0, 10.12, 6.6, 9.88, 6.6], r: 0.03, m: MAT.RAZOR }];
  const sim = dish({ prims }); bead(sim, 10, 10, 15);
  let cuts = 0, maxPieces = 1;
  run(sim, 2.6, () => { sim.stickY = -1; cuts += sim.drainEvents().cuts; maxPieces = Math.max(maxPieces, sim.nComps); });
  expect(cuts > 30, `only ${cuts} cuts`);
  expect(maxPieces >= 2, 'it never came apart');
  return `${cuts} cuts, ${maxPieces} pieces`;
});

// ── the dial and the medium ────────────────────────────────────────────────────────────────
test('dial: firm stiffens and beads it up; supple softens and wets', () => {
  const sim = dish(); bead(sim, 10, 8, 12);
  run(sim, 0.5);
  run(sim, 0.4, () => { sim.dialTarget = 1; });
  const kF = sim.eK[0], sF = sim.eSig[0], wF = sim.eWet[0];
  run(sim, 0.4, () => { sim.dialTarget = -1; });
  const kS = sim.eK[0], sS = sim.eSig[0], wS = sim.eWet[0];
  expect(kF > kS * 2 && sF > sS * 2, `stiffness firm ${kF.toFixed(0)} / supple ${kS.toFixed(0)}, tension ${sF.toFixed(2)} / ${sS.toFixed(2)}`);
  expect(wS > wF + 0.4, `wetting firm ${wF.toFixed(2)} vs supple ${wS.toFixed(2)}`);
});

test('medium: heat makes matter run, frost makes it hold and turn brittle', () => {
  const zones = [{ t: 'circle', x: 5, y: 8, r: 3, heat: 1, heatRate: 6 }, { t: 'circle', x: 15, y: 8, r: 3, heat: -1, heatRate: 6 }];
  // (matter of no one's: it neither swims home nor feels like kind across the dish)
  const sim = dish({ zones }); sim.spawnBlob(5, 8, 300, { kin: WILD }); sim.spawnBlob(15, 8, 300, { kin: WILD }); sim.analyze(DT);
  run(sim, 1.5);
  let h = 0, c = 0;
  for (let i = 0; i < sim.n; i++) { if (Math.hypot(sim.px[i] - 5, sim.py[i] - 8) < Math.hypot(sim.px[h] - 5, sim.py[h] - 8)) h = i; if (Math.hypot(sim.px[i] - 15, sim.py[i] - 8) < Math.hypot(sim.px[c] - 15, sim.py[c] - 8)) c = i; }
  expect(sim.heat[h] > 0.5 && sim.heat[c] < -0.5, `heat ${sim.heat[h].toFixed(2)} / ${sim.heat[c].toFixed(2)}`);
  // relaxation factor per tick: closer to 0 forgets faster
  expect(sim.eRel[h] < sim.eRel[c], 'hot matter does not forget faster than cold');
  expect(sim.eBrk[c] < sim.eBrk[h] * 0.75, 'cold matter is not more brittle');
});

// ── stability ──────────────────────────────────────────────────────────────────────────────
test('stability: violent input, bursts into a wedge, a razor, grit and a sponge — nothing explodes', () => {
  const prims = [{ t: 'poly', pts: [6, 4, 9, 9, 3, 9] }, { t: 'box', x: 14, y: 6, hw: 0.2, hh: 3, r: 0.05, m: MAT.RAZOR },
    { t: 'box', x: 10, y: 15.2, hw: 6, hh: 0.6, r: 0.2, m: MAT.ABRASIVE }, { t: 'circle', x: 17, y: 12, r: 1.2, m: MAT.SPONGE }];
  const sim = dish({ prims }); bead(sim, 12, 10, 15);
  let bad = 0, f = 0, maxV = 0;
  run(sim, 6, (t) => {
    sim.stickX = Math.sign(Math.sin(t * 7.3)); sim.stickY = Math.sign(Math.cos(t * 9.5)); sim.dialTarget = Math.sin(t * 3.1);
    if (f++ % 40 === 0) sim.burn(Math.cos(t * 7), Math.sin(t * 7), 0.08);
    if (!finite(sim)) bad++;
    for (let i = 0; i < sim.n; i++) maxV = Math.max(maxV, Math.hypot(sim.vx[i], sim.vy[i]));
  });
  expect(bad === 0, `${bad} frames with non-finite state`);
  let inside = 0; for (let i = 0; i < sim.n; i++) if (sim.world.dist(sim.px[i], sim.py[i]) < -0.05) inside++;
  expect(inside === 0, `${inside} particles ended up inside a wall`);
  const c = sim.compression();
  expect(c.mean < 0.05, `the bulk is squeezed ${(c.mean * 100).toFixed(1)}%`);
  const b = sim.primary, a = visualArea(sim, 0.025, { filter: (i) => sim.body[i] === b }) / (sim.bCount[b] * sim.a0);
  expect(a > 0.92 && a < 1.08, `main body area ratio ${a.toFixed(3)}`);
  expect(maxV < 120, `something flew off at ${maxV.toFixed(0)} u/s`);
  return `body area ${a.toFixed(3)}, bulk squeeze ${(c.mean * 100).toFixed(1)}%, fastest ${maxV.toFixed(0)} u/s`;
});

test('determinism: the same inputs give the same world', () => {
  const go = () => { const sim = dish(); bead(sim, 10, 8, 8); run(sim, 1.5, (t) => { sim.stickX = Math.sin(t * 4); sim.dialTarget = Math.cos(t * 3); }); return com(sim); };
  const a = go(), b = go();
  expect(a[0] === b[0] && a[1] === b[1], `${a} vs ${b}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
