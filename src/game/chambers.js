import { MAT } from '../sim/world.js';

// A chamber is a dish: its walls and what they are made of, the medium that fills it, what
// lies in it, where you enter and where you leave. World units; y grows downward (toward the
// thumb). Each one teaches by being touched, never told.
//
//   prims     : wall primitives (see world.js), each with a surface material (surfaces.js)
//   zones     : regions of medium with their own local law (visc, fuse, heal, heat, burn…)
//   fields    : point sources of force (well: g > 0 pulls, g < 0 pushes; vortex)
//   nutrients : [x, y, area] — beads of amber gel, wild, there for the taking
//   matter    : [x, y, area, substance] — other matter lying in the dish
//   spawn     : where you arrive          calyx: [x, y, r] — seat most of yourself in it

const cap = (x1, y1, x2, y2, r, m = MAT.GLASS) => ({ t: 'capsule', x1, y1, x2, y2, r, m });
const disc = (x, y, r, m = MAT.GLASS) => ({ t: 'circle', x, y, r, m });
const box = (x, y, hw, hh, r = 0.3, a = 0, m = MAT.GLASS) => ({ t: 'box', x, y, hw, hh, r, a, m });

// A grate of n pillars of radius r spanning [x0, x1] at height y, every gap the same width.
function grate(x0, x1, y, n, r) {
  const gap = (x1 - x0 - 2 * r * n) / (n + 1), out = [];
  for (let k = 0; k < n; k++) out.push(disc(x0 + gap * (k + 1) + r * (2 * k + 1), y, r));
  return out;
}
export const GRATE_GAP = (13.0 - 5.0 - 2 * 0.34 * 7) / 8;     // ≈ 0.40: too fine for anything that holds its shape
const GRATE = grate(5.0, 13.0, 13.0, 7, 0.34);

export const CHAMBERS = [
  {
    // You arrive as dew and find yourself. Then a gate narrower than you are: the first lesson
    // is that you have no shape. A pebble to brush past, one that will not be clung to.
    name: 'cradle',
    w: 16, h: 27, round: 3.2,
    spawn: [8, 20.5], calyx: [8, 4.9, 2.5],
    prims: [
      cap(-1, 12.6, 5.75, 12.6, 1.15), cap(10.25, 12.6, 17, 12.6, 1.15),
      disc(4.6, 17.2, 0.95), disc(11.7, 8.6, 0.85, MAT.SLICK),
    ],
    nutrients: [[8, 16.4, 0.5], [10.8, 15.4, 0.4], [8, 12.6, 0.45], [5.2, 9.0, 0.4], [9.8, 7.6, 0.4]],
  },
  {
    // Shelves to climb around. Under one lip, something that holds on and tightens the longer
    // you rest on it; near the top, a slit. Go supple and pour through, or squeeze.
    name: 'narrows',
    w: 16, h: 31, round: 2.6,
    spawn: [4.2, 26.6], calyx: [8, 3.9, 2.3],
    prims: [
      box(5.2, 21.2, 6.2, 0.75, 0.7),
      box(10.8, 14.4, 6.2, 0.75, 0.7),
      box(6.4, 15.22, 1.5, 0.22, 0.2, 0, MAT.TACKY),
      box(3.1, 8.0, 4.0, 0.7, 0.65), box(12.9, 8.0, 4.0, 0.7, 0.65),   // a slit: 1.8 wide
      disc(12.6, 24.6, 1.0),
    ],
    nutrients: [[12.9, 22.0, 0.5], [13.2, 17.6, 0.4], [2.6, 17.4, 0.6], [2.4, 11.4, 0.5], [8, 8.0, 0.45], [12.4, 4.6, 0.4]],
  },
  {
    // An edge aimed at you and a wall behind it: there is no going round in one piece. Beyond,
    // a pool where cut faces heal at once. Then a sink that drinks whatever drifts near —
    // a burst is the price of leaving it.
    name: 'blades',
    w: 18, h: 32, round: 3.0,
    spawn: [9, 27.2], calyx: [9, 4.2, 2.5],
    prims: [
      { t: 'poly', pts: [9, 22.4, 9.16, 18.2, 8.84, 18.2], r: 0.035, m: MAT.RAZOR },
      cap(9, 18.2, 9, 12.9, 0.3),
      box(3.0, 16.0, 0.3, 2.4, 0.25, 0.0, MAT.ABRASIVE),
      disc(14.8, 15.6, 1.1, MAT.SLICK),
      disc(4.2, 23.6, 0.8), disc(14.2, 23.2, 0.7),
    ],
    zones: [{ t: 'circle', x: 9, y: 11.4, r: 2.6, soft: 0.8, fuse: 3, heal: 6 }],
    fields: [{ t: 'well', x: 9, y: 7.6, g: 30, core: 1.0, range: 4.2, eat: 1.5 }],
    nutrients: [[5.6, 20.2, 0.5], [12.4, 20.2, 0.5], [6.0, 13.2, 0.5], [12.6, 12.6, 0.5], [3.4, 6.4, 0.5], [14.6, 6.6, 0.5]],
  },
  {
    // Oil in the channel: it will not mix with you, only slide. Shoulder it aside. Then warmth
    // that loosens you, and a grate too fine for anything that holds its shape.
    name: 'ember',
    w: 18, h: 34, round: 3.0,
    spawn: [9, 29.5], calyx: [9, 4.2, 2.5],
    prims: [
      box(2.2, 22.0, 2.6, 0.6, 0.5), box(15.8, 22.0, 2.6, 0.6, 0.5),
      box(1.6, 13.0, 3.4, 0.6, 0.5), box(16.4, 13.0, 3.4, 0.6, 0.5),
      // the grate: seven pillars, eight even gaps between the shoulders (see GRATE below)
      ...GRATE,
      box(9, 8.8, 1.6, 0.45, 0.4, 0, MAT.FROST),
    ],
    zones: [{ t: 'box', x: 9, y: 16.4, hw: 7.4, hh: 2.2, r: 1.0, soft: 0.9, heat: 1, heatRate: 2.5 }],
    matter: [[7.4, 22.2, 1.6, 'lipid'], [10.8, 21.6, 1.3, 'lipid'], [13.6, 26.5, 0.8, 'lipid']],
    nutrients: [[4.4, 26.2, 0.5], [9, 18.6, 0.5], [14.2, 17.4, 0.4], [4.6, 9.8, 0.5], [13.6, 9.6, 0.5]],
  },
];
