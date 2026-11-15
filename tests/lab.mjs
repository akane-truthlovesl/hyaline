// The lab: run a named scenario against the real solver, print metrics, write contact sheets.
//   node tests/lab.mjs <scenario> [key=value ...]      (OUT=dir for images)
// A key that names a PARAMS entry overrides it (e.g. tension=200); `myria.tau=0.5` bends a
// substance; anything else is a scenario option.
import { World, MAT } from '../src/sim/world.js';
import { Continuum, PARAMS } from '../src/sim/continuum.js';
import { SUB, SUBSTANCES, PLAYER, WILD, buildChemistry } from '../src/sim/substances.js';
import { Sheet } from '../tools/png.mjs';
import { visualArea } from './measure.mjs';

const OUT = process.env.OUT || '.';
const which = process.argv[2] || 'rest';
const DT = 1 / 120;
const OPT = {}, OVR = {};
for (const a of process.argv.slice(3)) {
  const [k, v] = a.split('='), val = isNaN(+v) ? v : +v;
  if (k.includes('.')) { const [s, p] = k.split('.'); SUBSTANCES[SUB[s]][p] = val; continue; }
  (k in PARAMS ? OVR : OPT)[k] = val;
}
buildChemistry();

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toFixed(3) : v}`).join(' ');
const AREA = OPT.area || 15;
function mk(def, area = AREA, at = null, opts = {}) {
  const world = new World({ prims: [], ...def });
  const sim = new Continuum(world, { d0: OPT.d0 || 0.12, ...OVR });
  const n = Math.round(area / sim.a0);
  if (area) sim.spawnBlob(at ? at[0] : def.w / 2, at ? at[1] : def.h / 2, n, opts);
  sim.massRef = n || 1000;
  sim.analyze(DT);
  return sim;
}
// one displayed frame at 60 Hz: two ticks, then the per-frame analysis (as the game does)
function run(sim, frames, each) {
  for (let f = 0; f < frames; f++) {
    if (each) each(f, f / 60);
    sim.step(DT); sim.step(DT); sim.analyze(1 / 60);
  }
}
function moments(sim, filter) {
  let cx = 0, cy = 0, n = 0, mx = 0, my = 0;
  for (let i = 0; i < sim.n; i++) if (!filter || filter(i)) { cx += sim.px[i]; cy += sim.py[i]; mx += sim.vx[i]; my += sim.vy[i]; n++; }
  cx /= n; cy /= n;
  let xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < sim.n; i++) if (!filter || filter(i)) { const x = sim.px[i] - cx, y = sim.py[i] - cy; xx += x * x; yy += y * y; xy += x * y; }
  const tr = xx + yy, det = xx * yy - xy * xy, d = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  return { n, cx, cy, vx: mx / n, vy: my / n, aspect: Math.sqrt((tr / 2 + d) / Math.max(1e-9, tr / 2 - d)), sx: Math.log(xx / yy) / 2 };
}
const area = (sim) => visualArea(sim) / (sim.n * sim.a0);
function overflow(sim, b = sim.primary) {
  const cx = sim.bCx[b], cy = sim.bCy[b], R = sim.bR[b];
  let out = 0, n = 0;
  for (let i = 0; i < sim.n; i++) if (sim.body[i] === b) { n++; if (Math.hypot(sim.px[i] - cx, sim.py[i] - cy) > R * 1.04) out++; }
  return out / Math.max(1, n);
}
function extent(sim, dx, dy, b = sim.primary) {
  let lo = 1e9, hi = -1e9;
  const cx = sim.bCx[b], cy = sim.bCy[b];
  for (let i = 0; i < sim.n; i++) if (sim.body[i] === b) { const u = (sim.px[i] - cx) * dx + (sim.py[i] - cy) * dy; if (u < lo) lo = u; if (u > hi) hi = u; }
  return [lo, hi];
}
function line(sim, t, extra = {}) {
  const m = moments(sim), b = sim.primary, c = sim.compression();
  return `${t.toFixed(2)}s ` + fmt({ n: sim.n, pcs: sim.nComps, asp: m.aspect, ovf: overflow(sim), cx: m.cx, cy: m.cy, v: Math.hypot(sim.bVx[b], sim.bVy[b]), comp: c.mean, area: area(sim), bonds: sim.nBonds, ...extra });
}
const follow = (sim, half = 5) => { const b = sim.primary; return [sim.bCx[b] - half, sim.bCy[b] - half * 0.7, sim.bCx[b] + half, sim.bCy[b] + half * 0.7]; };

const S = {};

S.prof = () => {
  const sim = mk({ w: 16, h: 16 });
  const names = ['_feed', '_prepare', '_pairs', '_willSetup', '_forces', '_predict', '_density', '_solveBonds', '_solveAnchors', '_solveWalls', '_post', '_network', '_walls', '_diffuse', '_reorder', 'analyze'];
  const acc = {};
  for (const n of names) { const f = sim[n].bind(sim); acc[n] = 0; sim[n] = (...a) => { const t = performance.now(); const r = f(...a); acc[n] += performance.now() - t; return r; }; }
  run(sim, 60, (f, t) => { sim.stickX = Math.sin(t * 2) * 0.6; sim.stickY = Math.cos(t * 1.3) * 0.6; });
  const NT = 120, best = {}; let bestTot = 1e9;
  for (let rep = 0; rep < 3; rep++) {
    for (const n of names) acc[n] = 0;
    const t0 = performance.now();
    run(sim, NT, (f, t) => { sim.stickX = Math.sin(t * 2) * 0.6; sim.stickY = Math.cos(t * 1.3) * 0.6; });
    const tot = performance.now() - t0;
    if (tot < bestTot) { bestTot = tot; Object.assign(best, acc); }
  }
  console.log('ms per 60 Hz frame (2 ticks + analyze)', (bestTot / NT).toFixed(3), 'n', sim.n, 'pairs', sim.nPairs, 'bonds', sim.nBonds);
  for (const n of names) console.log(n.padEnd(14), (best[n] / NT).toFixed(3));
};

S.rest = () => {
  const sim = mk({ w: 16, h: 16 });
  const sheet = new Sheet(4);
  run(sim, 240, (f, t) => {
    if (f % 30 === 29) console.log(line(sim, t));
    if (f % 60 === 59) sheet.add(sim, [4, 4, 12, 12], OPT.mode || 'rho', 40);
  });
  sheet.save(`${OUT}/rest.png`);
};

// a long slab relaxing to a bead: how fast, how round, how much momentum appears from nowhere?
S.round = () => {
  const world = new World({ w: 24, h: 16, prims: [] });
  const sim = new Continuum(world, { d0: OPT.d0 || 0.12, ...OVR });
  const s = sim.sp, rh = s * Math.sqrt(3) / 2;
  let k = 0; const first = sim.n;
  for (let y = 8 - 1.2; y < 8 + 1.2; y += rh, k++) for (let x = 12 - 6 + (k & 1) * s / 2; x < 12 + 6; x += s) sim.add(x, y);
  for (let i = first; i < sim.n; i++) sim.piece[i] = 7;
  sim._bondFresh(first, sim.n);
  sim.massRef = sim.n; sim.analyze(DT);
  let tR = -1; const sheet = new Sheet(6);
  run(sim, OPT.F || 240, (f, t) => {
    const m = moments(sim);
    if (tR < 0 && m.aspect < 1.15) tR = t;
    if (f % 10 === 0 && f < 120) sheet.add(sim, [4, 2, 20, 14], OPT.mode || 'body', 16);
    if (f % 30 === 29) console.log(line(sim, t, { mom: Math.hypot(m.vx, m.vy) }));
  });
  sheet.save(`${OUT}/round.png`);
  console.log('time to aspect<1.15:', tR.toFixed(2));
};

// squash a bead and let go: how does it ring?
S.jiggle = () => {
  const sim = mk({ w: 16, h: 16 });
  run(sim, 30);
  const k = OPT.k || 3;
  for (let i = 0; i < sim.n; i++) { sim.vx[i] += (sim.px[i] - 8) * k; sim.vy[i] -= (sim.py[i] - 8) * k; }
  const ser = [], sheet = new Sheet(8);
  run(sim, 180, (f) => {
    ser.push(moments(sim).sx);
    if (f % 3 === 0 && f < 48) sheet.add(sim, [4, 4, 12, 12], OPT.mode || 'body', 24);
  });
  sheet.save(`${OUT}/jiggle.png`);
  const zc = []; for (let i = 1; i < ser.length; i++) if ((ser[i - 1] > 0) !== (ser[i] > 0)) zc.push(i / 60);
  const pk = []; for (let i = 1; i < ser.length - 1; i++) if (Math.abs(ser[i]) > Math.abs(ser[i - 1]) && Math.abs(ser[i]) >= Math.abs(ser[i + 1])) pk.push(`${(i / 60).toFixed(2)}:${ser[i].toFixed(3)}`);
  console.log('zero crossings', zc.slice(0, 8).map((z) => z.toFixed(2)).join(' '));
  console.log('peaks', pk.slice(0, 10).join(' '));
  console.log(line(sim, 3));
};

// the will: stick held at magnitude `mag` for T seconds, then let go
S.drive = () => {
  const sim = mk({ w: 40, h: 14, prims: OPT.post ? [{ t: 'circle', x: 17.5, y: 7.6, r: 1.3 }] : [] }, AREA, [7, 7]);
  const sheet = new Sheet(OPT.cols || 6), mag = OPT.mag ?? 1, T = OPT.T ?? 1.5, ang = (OPT.ang ?? 0) * Math.PI / 180;
  let front = 0, back = 0, maxAsp = 0;
  run(sim, OPT.F || 150, (f, t) => {
    sim.stickX = t < T ? mag * Math.cos(ang) : 0; sim.stickY = t < T ? mag * Math.sin(ang) : 0;
    if (t < T && t > 0.3) { const [lo, hi] = extent(sim, Math.cos(ang), Math.sin(ang)); front = Math.max(front, hi); back = Math.max(back, -lo); maxAsp = Math.max(maxAsp, sim.bAsp[sim.primary]); }
    if (f % (OPT.every || 8) === (OPT.every || 8) - 1) sheet.add(sim, OPT.fixed ? [1, 1, 39, 13] : follow(sim, OPT.half || 4.5), OPT.mode || 'will', OPT.scale || 18);
    if (f % 15 === 14) console.log(line(sim, t, { front: extent(sim, Math.cos(ang), Math.sin(ang))[1] }));
  });
  sheet.save(`${OUT}/drive.png`);
  console.log(`while driving: front reach ${front.toFixed(2)}, back ${back.toFixed(2)}, ratio ${(front / back).toFixed(2)}, max aspect ${maxAsp.toFixed(2)}`);
};

S.gap = () => {
  const prims = [{ t: 'box', x: 5.2, y: 5.2, hw: 4.2, hh: 0.6, r: 0.5 }, { t: 'box', x: 14.8, y: 5.2, hw: 4.2, hh: 0.6, r: 0.5 }];
  const sim = mk({ w: 20, h: 14, prims }, AREA, [10, 9.5]);
  const sheet = new Sheet(6);
  let lo = 9, hi = 0;
  run(sim, 180, (f, t) => {
    sim.stickY = t < 2.4 ? -1 : 0;
    sim.dialTarget = OPT.dial ?? 0;
    if (t > 0.3) { const a = area(sim); lo = Math.min(lo, a); hi = Math.max(hi, a); }
    if (f % 8 === 7) sheet.add(sim, [4, 0.5, 16, 13.5], OPT.mode || 'body', 18);
    if (f % 15 === 14) console.log(line(sim, t));
  });
  console.log('area ratio range', lo.toFixed(3), hi.toFixed(3));
  sheet.save(`${OUT}/gap.png`);
};

// press into a wall of the given material, then pull away
S.wall = () => {
  const mat = OPT.mat !== undefined ? (typeof OPT.mat === 'string' ? MAT[OPT.mat.toUpperCase()] : OPT.mat) : MAT.TACKY;
  const sim = mk({ w: 20, h: 16, prims: [{ t: 'box', x: 10, y: 2.2, hw: 5, hh: 0.5, r: 0.3, m: mat }] }, AREA, [10, 6.2]);
  const sheet = new Sheet(6);
  let snaps = 0;
  run(sim, 210, (f, t) => {
    sim.stickY = t < 1.2 ? -0.7 : t < 3.0 ? (OPT.mag ?? 1) : 0;
    if (f % 6 === 5 && t > 1.0 && t < 3.0) sheet.add(sim, [4, 1.5, 16, 15.5], OPT.mode || 'strain', 18);
    if (f % 15 === 14) { const ev = sim.drainEvents(); snaps += ev.snaps; let anc = 0; for (let i = 0; i < sim.n; i++) anc += sim.anc[i] ? 1 : 0; console.log(line(sim, t, { strainMax: ev.strainMax, snaps: ev.snaps, anc })); }
  });
  sheet.save(`${OUT}/wall.png`);
  console.log('snaps', snaps);
};

// two fingertips take hold of either side of a bead and draw them apart at v: the strand
S.strand = () => {
  const sim = mk({ w: 40, h: 12 }, OPT.area || 12, [20, 6]);
  const sheet = new Sheet(6), v = OPT.v ?? 0.8;
  run(sim, 20);
  const R = sim.bR[sim.primary];
  let xl = 20 - 0.65 * R, xr = 20 + 0.65 * R, snaps = 0, parted = -1;
  const hl = sim.hold(xl, 6, 0.75), hr = sim.hold(xr, 6, 0.75);
  run(sim, OPT.F || 240, (f, t) => {
    if (parted < 0) { xl -= v / 60; xr += v / 60; sim.moveHold(hl, xl, 6); sim.moveHold(hr, xr, 6); }
    if (parted < 0 && sim.nComps > 1) parted = t;
    if (f % 8 === 7) sheet.add(sim, [2, 2, 38, 10], OPT.mode || 'strain', 14);
    if (f % 15 === 14) { const ev = sim.drainEvents(); snaps += ev.snaps; console.log(line(sim, t, { snaps: ev.snaps, sMax: ev.strainMax })); }
  });
  sheet.save(`${OUT}/strand.png`);
  console.log('snaps', snaps, 'parted at', parted.toFixed(2), 's');
};

S.razor = () => {
  const sim = mk({ w: 20, h: 14, prims: [{ t: 'poly', pts: [10, 3.0, 10.12, 6.6, 9.88, 6.6], r: 0.03, m: MAT.RAZOR }] }, AREA, [10, 10]);
  const sheet = new Sheet(6);
  run(sim, 240, (f, t) => {
    sim.stickY = t < 1.6 ? -1 : 0;
    sim.dialTarget = t > 2.4 ? (OPT.firm ?? 0) : 0;
    if (f % 8 === 7) sheet.add(sim, [4, 0.5, 16, 13.5], OPT.mode || 'piece', 18);
    if (f % 15 === 14) { const ev = sim.drainEvents(); console.log(line(sim, t, { cuts: ev.cuts, fusions: ev.fusions })); }
  });
  sheet.save(`${OUT}/razor.png`);
};

// two pieces meeting: same kin / rival kin / immiscible / cut skin / repellent medium / healing bath
S.meet = () => {
  const kind = OPT.kind || 'kin';
  const all = { t: 'box', x: 10, y: 7, hw: 10, hh: 7 };
  const zones = kind === 'repel' ? [{ ...all, fuse: -0.6 }] : kind === 'heal' || kind === 'rivalheal' ? [{ ...all, fuse: 4, heal: 6 }] : [];
  const fields = (OPT.press ?? 1) ? [{ t: 'well', x: 10, y: 7, g: OPT.g ?? 9, core: 2.5, range: 12 }] : [];
  const sim = mk({ w: 20, h: 14, zones, fields }, 0);
  const n = Math.round(6 / sim.a0);
  const kA = 2, kB = kind === 'rival' || kind === 'rivalheal' ? 3 : kind === 'lipid' ? WILD : 2;
  const A = sim.spawnBlob(7.2, 7, n, { sub: SUB.myria, kin: kA });
  const B = sim.spawnBlob(12.8, 7, n, { sub: kind === 'lipid' ? SUB.lipid : SUB.myria, kin: kB });
  if (kind === 'cut') {
    for (const i of A) if (sim.px[i] > 7.9) { sim.skin[i] = 1; sim.snx[i] = 1; sim.sny[i] = 0; }
    for (const i of B) if (sim.px[i] < 12.1) { sim.skin[i] = 1; sim.snx[i] = -1; sim.sny[i] = 0; }
  }
  for (const i of A) sim.vx[i] = OPT.v ?? 1.2;
  for (const i of B) sim.vx[i] = -(OPT.v ?? 1.2);
  sim.massRef = 2 * n; sim.analyze(DT);
  const sheet = new Sheet(6);
  let tFuse = -1;
  run(sim, OPT.F || 300, (f, t) => {
    if (tFuse < 0 && sim.nComps === 1) tFuse = t;
    if (f % 15 === 14) sheet.add(sim, [4, 3, 16, 11], OPT.mode || 'piece', 18);
    if (f % 30 === 29) {
      let sk = 0, ns = 0; for (let i = 0; i < sim.n; i++) if (sim.skin[i] > 0) { sk += sim.skin[i]; ns++; }
      const ev = sim.drainEvents(); console.log(line(sim, t, { fusions: ev.fusions, skin: ns ? sk / ns : 0 }));
    }
  });
  console.log(`${kind}: ${tFuse < 0 ? 'never fused' : 'one piece at ' + tFuse.toFixed(2) + ' s'}`);
  sheet.save(`${OUT}/meet_${kind}.png`);
};

S.eat = () => {
  const sim = mk({ w: 20, h: 14 }, 12, [6, 7]);
  sim.spawnBlob(12.5, 7, Math.round(0.8 / sim.a0), { sub: SUB.amber, kin: WILD });
  sim.analyze(DT);
  const m0 = sim.playerMass();
  const sheet = new Sheet(6);
  run(sim, 180, (f, t) => {
    sim.stickX = t < 1.6 ? 0.8 : 0;
    if (f % 8 === 7) sheet.add(sim, [3, 2, 17, 12], 'sub', 16);
    if (f % 15 === 14) { const ev = sim.drainEvents(); console.log(line(sim, t, { mine: sim.playerMass(), assim: ev.assimilated })); }
  });
  console.log('taken in', sim.playerMass() - m0);
  sheet.save(`${OUT}/eat.png`);
};

S.abuse = () => {
  const prims = [{ t: 'poly', pts: [6, 4, 9, 9, 3, 9], r: 0.0 }, { t: 'box', x: 14, y: 6, hw: 0.2, hh: 3, r: 0.05, m: MAT.RAZOR },
    { t: 'box', x: 10, y: 15.2, hw: 6, hh: 0.6, r: 0.2, m: MAT.ABRASIVE }, { t: 'circle', x: 17, y: 12, r: 1.2, m: MAT.SPONGE }];
  const sim = mk({ w: 20, h: 16, prims }, AREA, [12, 10]);
  let bad = 0, maxV = 0;
  run(sim, 600, (f, t) => {
    const a = t * 7.3;
    sim.stickX = Math.sign(Math.sin(a)); sim.stickY = Math.sign(Math.cos(a * 1.31));
    sim.dialTarget = Math.sin(t * 3.1);
    if (f % 40 === 0) sim.burn(Math.cos(a), Math.sin(a), 0.08);
    for (let i = 0; i < sim.n; i++) { if (!isFinite(sim.px[i]) || !isFinite(sim.vx[i])) bad++; maxV = Math.max(maxV, Math.hypot(sim.vx[i], sim.vy[i])); }
    if (f % 60 === 59) console.log(line(sim, t, { bad, maxV, mine: sim.playerMass() }));
  });
};

// the dial against a wall: supple spreads into a film; firm beads it back up
S.film = () => {
  const sim = mk({ w: 20, h: 14, prims: [{ t: 'box', x: 10, y: 1.5, hw: 9.5, hh: 0.6, r: 0.2 }] }, AREA, [10, 6]);
  const sheet = new Sheet(6);
  run(sim, 240, (f, t) => {
    sim.stickY = t < (OPT.press ?? 2.0) ? -(OPT.mag ?? 0.8) : 0;
    sim.dialTarget = t < 2.6 ? -1 : 1;
    if (f % 10 === 9) sheet.add(sim, [2, 0.5, 18, 9.5], 'body', 14);
    if (f % 15 === 14) {
      let y0 = 9, y1 = 0, x0 = 99, x1 = 0;
      for (let i = 0; i < sim.n; i++) { y0 = Math.min(y0, sim.py[i]); y1 = Math.max(y1, sim.py[i]); x0 = Math.min(x0, sim.px[i]); x1 = Math.max(x1, sim.px[i]); }
      console.log(line(sim, t, { dial: sim.dial, width: x1 - x0, thick: y1 - y0 }));
    }
  });
  sheet.save(`${OUT}/film.png`);
};

if (!S[which]) { console.log('scenarios:', Object.keys(S).join(' ')); process.exit(1); }
S[which]();
