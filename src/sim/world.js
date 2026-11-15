// THE WORLD — geometry, the surfaces it is made of, and the medium that fills it.
//
// Geometry is a signed-distance field: positive in open medium, negative inside solids. Every
// solid is a primitive with a surface material (surfaces.js); the field is baked to a grid so
// one bilinear fetch gives distance, normal and material anywhere.
//
// The medium is not uniform. Zones are soft-edged regions that rewrite local law — thicker or
// thinner medium, stronger or weaker surface tension, fusion encouraged or forbidden, heat or
// frost, their own gravity, a different price for speed. Fields are point sources of force:
// wells that pull, white holes that push, vortices that stir.

import { MAT } from './surfaces.js';
export { MAT };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function sdRoundBox(px, py, p) {
  const x = px - p.x, y = py - p.y;
  const lx = x * p.ca + y * p.sa, ly = -x * p.sa + y * p.ca;
  const qx = Math.abs(lx) - (p.hw - p.r), qy = Math.abs(ly) - (p.hh - p.r);
  const ax = qx > 0 ? qx : 0, ay = qy > 0 ? qy : 0;
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - p.r;
}

function sdCapsule(px, py, p) {
  const pax = px - p.x1, pay = py - p.y1;
  const bax = p.x2 - p.x1, bay = p.y2 - p.y1;
  const t = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay + 1e-12), 0, 1);
  const dx = pax - bax * t, dy = pay - bay * t;
  return Math.sqrt(dx * dx + dy * dy) - (p.r1 + (p.r2 - p.r1) * t);
}

function sdPolygon(px, py, p) {
  const v = p.pts, n = v.length >> 1;
  let dx = px - v[0], dy = py - v[1];
  let d = dx * dx + dy * dy, s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ex = v[j * 2] - v[i * 2], ey = v[j * 2 + 1] - v[i * 2 + 1];
    const wx = px - v[i * 2], wy = py - v[i * 2 + 1];
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey + 1e-12), 0, 1);
    const bx = wx - ex * t, by = wy - ey * t;
    const bb = bx * bx + by * by;
    if (bb < d) d = bb;
    const c1 = py >= v[i * 2 + 1], c2 = py < v[j * 2 + 1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d) - (p.r || 0);
}

function sdArc(px, py, p) {
  const x = px - p.x, y = py - p.y;
  const lx = x * p.ca + y * p.sa, ly = Math.abs(-x * p.sa + y * p.ca);
  if (Math.atan2(ly, lx) <= p.ap) return Math.abs(Math.sqrt(lx * lx + ly * ly) - p.R) - p.th;
  const ex = lx - p.R * Math.cos(p.ap), ey = ly - p.R * Math.sin(p.ap);
  return Math.sqrt(ex * ex + ey * ey) - p.th;
}

export function sdShape(px, py, p) {
  switch (p.t) {
    case 'circle': { const x = px - p.x, y = py - p.y; return Math.sqrt(x * x + y * y) - p.r; }
    case 'box': return sdRoundBox(px, py, p);
    case 'capsule': return sdCapsule(px, py, p);
    case 'poly': return sdPolygon(px, py, p);
    case 'arc': return sdArc(px, py, p);
  }
  return 1e9;
}

function shapeBounds(p) {
  switch (p.t) {
    case 'circle': return [p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r];
    case 'box': { const e = Math.hypot(p.hw, p.hh); return [p.x - e, p.y - e, p.x + e, p.y + e]; }
    case 'capsule': {
      const r = Math.max(p.r1, p.r2);
      return [Math.min(p.x1, p.x2) - r, Math.min(p.y1, p.y2) - r, Math.max(p.x1, p.x2) + r, Math.max(p.y1, p.y2) + r];
    }
    case 'poly': {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < p.pts.length; i += 2) {
        x0 = Math.min(x0, p.pts[i]); x1 = Math.max(x1, p.pts[i]);
        y0 = Math.min(y0, p.pts[i + 1]); y1 = Math.max(y1, p.pts[i + 1]);
      }
      const r = p.r || 0;
      return [x0 - r, y0 - r, x1 + r, y1 + r];
    }
    case 'arc': { const e = p.R + p.th; return [p.x - e, p.y - e, p.x + e, p.y + e]; }
  }
  return [0, 0, 0, 0];
}

function prepShape(p) {
  const q = { m: MAT.GLASS, ...p };
  if (q.t === 'box') { q.r = q.r || 0; const a = q.a || 0; q.ca = Math.cos(a); q.sa = Math.sin(a); }
  if (q.t === 'capsule') { if (q.r !== undefined) { q.r1 = q.r; q.r2 = q.r; } }
  if (q.t === 'arc') { const a = q.a || 0; q.ca = Math.cos(a); q.sa = Math.sin(a); }
  return q;
}

// Every zone carries every modifier, so the solver reads one consistent shape.
const ZONE_DEFAULTS = {
  soft: 0.5,       // width of the edge over which the zone fades in
  visc: 1,         // internal viscosity ×
  drag: 1,         // drag of the medium ×
  tension: 1,      // surface tension ×
  tack: 1,         // wall adhesion ×
  fuse: 1,         // fusion between separate pieces × (0 forbids; negative repels)
  heal: 1,         // healing of cut skin ×
  burn: 1,         // price of speed × (0: free bursts)
  heat: 0,         // temperature the zone pulls matter toward…
  heatRate: 0,     // …and how fast (1/s)
  gx: 0, gy: 0,    // gravity inside the zone
  tint: null,      // how it reads to the eye
};

export class World {
  // def: { w, h, round, wallMat, prims:[...], zones:[...], fields:[...], gravity:[gx,gy] }
  constructor(def, cell = 0.05) {
    this.w = def.w; this.h = def.h;
    this.cell = cell; this.inv = 1 / cell;
    this.nx = Math.ceil(def.w / cell) + 1;
    this.ny = Math.ceil(def.h / cell) + 1;
    this.sdf = new Float32Array(this.nx * this.ny);
    this.mat = new Uint8Array(this.nx * this.ny);
    this.prims = (def.prims || []).map(prepShape);
    this.zones = (def.zones || []).map((z) => {
      const q = prepShape({ ...ZONE_DEFAULTS, ...z });
      q.bounds = shapeBounds(q);
      return q;
    });
    this.fields = (def.fields || []).map((f) => ({ ...f }));
    this.gravity = def.gravity ? [def.gravity[0], def.gravity[1]] : [0, 0];
    this.round = def.round ?? 1.5;
    this.wallMat = def.wallMat ?? MAT.GLASS;
    this.maxDist = 1.6;       // distances are only resolved this far from a surface
    this.d = 0; this.gx = 0; this.gy = 0;   // sample() results
    this.version = 0;
    this.bake();
  }

  bake() {
    const { nx, ny, cell, sdf, mat, maxDist } = this;
    const hw = this.w * 0.5, hh = this.h * 0.5;
    const bound = { x: hw, y: hh, hw, hh, r: Math.min(this.round, hw, hh), ca: 1, sa: 0 };
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const d = -sdRoundBox(ix * cell, iy * cell, bound);
        sdf[iy * nx + ix] = d < maxDist ? d : maxDist;
        mat[iy * nx + ix] = this.wallMat;
      }
    }
    for (const p of this.prims) {
      const b = shapeBounds(p);
      const x0 = clamp(Math.floor((b[0] - maxDist) / cell), 0, nx - 1);
      const y0 = clamp(Math.floor((b[1] - maxDist) / cell), 0, ny - 1);
      const x1 = clamp(Math.ceil((b[2] + maxDist) / cell), 0, nx - 1);
      const y1 = clamp(Math.ceil((b[3] + maxDist) / cell), 0, ny - 1);
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const d = sdShape(ix * cell, iy * cell, p);
          const k = iy * nx + ix;
          if (d < sdf[k]) { sdf[k] = d; mat[k] = p.m; }
        }
      }
    }
    this.version++;
  }

  // Distance at (x, y); also leaves the unit outward normal in gx, gy.
  sample(x, y) {
    const nx = this.nx;
    let fx = x * this.inv, fy = y * this.inv;
    const mx = nx - 1.001, my = this.ny - 1.001;
    if (fx < 0) fx = 0; else if (fx > mx) fx = mx;
    if (fy < 0) fy = 0; else if (fy > my) fy = my;
    const ix = fx | 0, iy = fy | 0;
    const tx = fx - ix, ty = fy - iy;
    const k = iy * nx + ix, s = this.sdf;
    const a = s[k], b = s[k + 1], c = s[k + nx], d = s[k + nx + 1];
    let gx = (b - a) * (1 - ty) + (d - c) * ty;
    let gy = (c - a) * (1 - tx) + (d - b) * tx;
    const gl = Math.sqrt(gx * gx + gy * gy);
    if (gl > 1e-9) { gx /= gl; gy /= gl; } else { gx = 0; gy = 0; }
    this.gx = gx; this.gy = gy;
    return (this.d = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
  }

  dist(x, y) {
    const nx = this.nx;
    let fx = x * this.inv, fy = y * this.inv;
    const mx = nx - 1.001, my = this.ny - 1.001;
    if (fx < 0) fx = 0; else if (fx > mx) fx = mx;
    if (fy < 0) fy = 0; else if (fy > my) fy = my;
    const ix = fx | 0, iy = fy | 0;
    const tx = fx - ix, ty = fy - iy;
    const k = iy * nx + ix, s = this.sdf;
    const a = s[k], b = s[k + 1], c = s[k + nx], d = s[k + nx + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }

  material(x, y) {
    const ix = clamp(Math.round(x * this.inv), 0, this.nx - 1);
    const iy = clamp(Math.round(y * this.inv), 0, this.ny - 1);
    return this.mat[iy * this.nx + ix];
  }

  // How much of zone z is at (x, y): 1 inside, 0 outside, smooth across its edge.
  zoneWeight(z, x, y) {
    const b = z.bounds, s = z.soft;
    if (x < b[0] - s || x > b[2] + s || y < b[1] - s || y > b[3] + s) return 0;
    const d = sdShape(x, y, z);
    if (d >= s) return 0;
    if (d <= -s) return 1;
    const t = 0.5 - d / (2 * s);
    return t * t * (3 - 2 * t);
  }
}
