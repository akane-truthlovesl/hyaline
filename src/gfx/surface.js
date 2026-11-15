// Surface reconstruction, CPU side.
//
// The silhouette is the ½-isocontour of a smooth field summed from one kernel per particle.
// Round kernels would give a lumpy outline and lose anything thinner than a kernel, so each
// kernel is shaped by its neighbourhood (anisotropic kernels, after Yu & Turk): flattened
// along a surface, stretched along a thread, small and sharp where matter is sparse. Every
// kernel carries the same integral — the area of one particle — so the area you see is the
// mass that is there. A strand being drawn is drawn as what it is: each stretched bond is a
// filament whose width conserves the matter in it.
//
// Alongside the field each kernel carries what the optics need, weighted by its amplitude so
// that mixtures come out right: the absorption it carries (Beer–Lambert coefficients add by
// concentration), its strain, its cut skin, its glow, and the identity of the piece it is in
// (so two touching pieces that have not fused show a seam).

import { SLOTS } from '../sim/continuum.js';

const FLOATS = 13;         // cx, cy, ax, ay, b, amp, σr, σg, σb, strain, skin, glow, piece
const TFLOATS = 11;        // x1, y1, x2, y2, halfWidth, amp, σr, σg, σb, strain, piece
const MFLOATS = 6;         // x, y, vx, vy, seed, spin

const GOLD = 0.6180339887;

export class Surface {
  constructor(maxN) {
    this.maxN = maxN;
    this.inst = new Float32Array(maxN * FLOATS);
    this.threads = new Float32Array(4096 * TFLOATS);
    this.motes = new Float32Array(1024 * MFLOATS);
    this.mist = new Float32Array(1024 * 4);
    this.n = 0; this.nThreads = 0; this.nMotes = 0; this.nMist = 0;
    const f = (n) => new Float32Array(n);
    this.sw = f(maxN); this.sx = f(maxN); this.sy = f(maxN);
    this.sxx = f(maxN); this.sxy = f(maxN); this.syy = f(maxN);
    this.curl = f(maxN);
    this.cx = f(maxN); this.cy = f(maxN);
  }

  build(sim, dt) {
    const n = sim.n, { px, py, vx, vy, pi, pj, pph, cr, cg, cb, strainS, skin, glow, seed, phi, piece, body } = sim;
    const { sw, sx, sy, sxx, sxy, syy, curl, cx, cy, inst } = this;
    const spin = sim.spin, d0 = sim.d0, a0 = sim.a0;
    // neighbourhood statistics over a kernel a little wider than a particle's reach
    const h2 = (2.2 * d0) * (2.2 * d0), invh2 = 1 / h2;
    for (let i = 0; i < n; i++) { sw[i] = 0; sx[i] = 0; sy[i] = 0; sxx[i] = 0; sxy[i] = 0; syy[i] = 0; curl[i] = 0; }
    for (let k = 0, np = sim.nPairs; k < np; k++) {
      const i = pi[k], j = pj[k];
      const dx = px[j] - px[i], dy = py[j] - py[i];
      const r2 = dx * dx + dy * dy;
      if (r2 >= h2) continue;
      // a kernel is shaped by its own piece only: two unfused pieces keep two outlines
      const t = 1 - r2 * invh2, w = t * t * t * (pph[k] ? 1 : 0.12);
      sw[i] += w; sx[i] += w * dx; sy[i] += w * dy; sxx[i] += w * dx * dx; sxy[i] += w * dx * dy; syy[i] += w * dy * dy;
      sw[j] += w; sx[j] -= w * dx; sy[j] -= w * dy; sxx[j] += w * dx * dx; sxy[j] += w * dx * dy; syy[j] += w * dy * dy;
      const c = w * (dx * (vy[j] - vy[i]) - dy * (vx[j] - vx[i]));     // local rotation
      curl[i] += c; curl[j] += c;
    }
    const rBulk = 2.3 * d0, rLone = 1.15 * d0;
    let nn = 0, nm = 0;
    const motes = this.motes, maxM = motes.length / MFLOATS;
    for (let i = 0; i < n; i++) {
      const W = 1 + sw[i], mx = sx[i] / W, my = sy[i] / W;
      // pull the kernel a little toward its neighbours: the surface sits on the matter, not on
      // the outermost particle centres
      const X = px[i] + 0.4 * mx, Y = py[i] + 0.4 * my;
      cx[i] = X; cy[i] = Y;
      const cxx = sxx[i] / W - mx * mx, cyy = syy[i] / W - my * my, cxy = sxy[i] / W - mx * my;
      const tr = 0.5 * (cxx + cyy), det = cxx * cyy - cxy * cxy;
      const disc = Math.sqrt(Math.max(0, tr * tr - det));
      const l1 = tr + disc, l2 = Math.max(tr - disc, l1 * 0.07, 1e-9);
      let ratio = Math.sqrt(Math.sqrt(l1 / l2));          // √ of the axis ratio
      if (ratio > 1.4) ratio = 1.4;            // (more, and a curved surface turns into facets)
      let ux = 1, uy = 0;
      if (disc > 1e-12) {
        ux = cxy; uy = l1 - cxx;
        if (Math.abs(ux) + Math.abs(uy) < 1e-12) { ux = cxx >= cyy ? 1 : 0; uy = cxx >= cyy ? 0 : 1; }
        const ul = Math.sqrt(ux * ux + uy * uy); ux /= ul; uy /= ul;
      }
      // a particle alone (or in a thin thread) gets a small, sharp kernel; one in the bulk a wide soft one
      let f = (phi[i] - 0.2) / 0.55;
      f = f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f);
      const r = rLone + (rBulk - rLone) * f;
      const a = r * ratio, b = r / ratio;
      const o = nn * FLOATS;
      inst[o] = X; inst[o + 1] = Y; inst[o + 2] = ux * a; inst[o + 3] = uy * a; inst[o + 4] = b;
      inst[o + 5] = (4 * a0) / (Math.PI * r * r);          // ∫ = one particle's area, exactly
      inst[o + 6] = cr[i]; inst[o + 7] = cg[i]; inst[o + 8] = cb[i];
      inst[o + 9] = strainS[i]; inst[o + 10] = skin[i]; inst[o + 11] = glow[i];
      inst[o + 12] = (((piece[i] + 1) * GOLD) % 1);
      nn++;
      // a few particles carry something visible, so the flow inside can be read
      if (seed[i] < 0.085 && nm < maxM && phi[i] > 0.55) {
        spin[i] += (curl[i] / (W * d0 * d0)) * dt * 0.5;
        const m = nm * MFLOATS;
        motes[m] = X; motes[m + 1] = Y; motes[m + 2] = vx[i]; motes[m + 3] = vy[i];
        motes[m + 4] = seed[i] / 0.085; motes[m + 5] = spin[i];
        nm++;
      }
    }
    this.n = nn; this.nMotes = nm;

    // strands: a bond stretched past neighbour spacing is drawn as the filament it is, with a
    // width that keeps the matter in it
    const th = this.threads, maxT = th.length / TFLOATS, bj = sim.bj, S = SLOTS;
    const lo = 1.35 * d0;
    let nt = 0;
    for (let i = 0; i < n && nt < maxT; i++) {
      for (let s = 0; s < S; s++) {
        const j = bj[i * S + s];
        if (j <= i) continue;
        if (phi[i] > 0.75 && phi[j] > 0.75) continue;
        const dx = cx[j] - cx[i], dy = cy[j] - cy[i];
        const L = Math.sqrt(dx * dx + dy * dy);
        if (L < lo) continue;
        let w = (0.9 * a0) / L;
        if (w < 0.32 * d0) w = 0.32 * d0;
        const fade = Math.min(1, (L - lo) / (0.3 * d0));
        const o = nt * TFLOATS;
        th[o] = cx[i]; th[o + 1] = cy[i]; th[o + 2] = cx[j]; th[o + 3] = cy[j];
        th[o + 4] = w; th[o + 5] = 1.25 * fade;
        th[o + 6] = 0.5 * (cr[i] + cr[j]); th[o + 7] = 0.5 * (cg[i] + cg[j]); th[o + 8] = 0.5 * (cb[i] + cb[j]);
        th[o + 9] = Math.max(strainS[i], strainS[j]);
        th[o + 10] = (((piece[i] + 1) * GOLD) % 1);
        if (++nt >= maxT) break;
      }
    }
    this.nThreads = nt;
    void body;

    const mist = this.mist;
    for (let k = 0; k < sim.exN; k++) {
      mist[k * 4] = sim.exX[k]; mist[k * 4 + 1] = sim.exY[k]; mist[k * 4 + 2] = sim.exLife[k]; mist[k * 4 + 3] = sim.exKind[k];
    }
    this.nMist = sim.exN;
  }
}

Surface.FLOATS = FLOATS; Surface.TFLOATS = TFLOATS; Surface.MFLOATS = MFLOATS;
