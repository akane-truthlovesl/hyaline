// Measurements of what the player would see, computed on the CPU from the same kind of kernels
// the renderer splats (fixed integral per point). The visual area is the area inside the
// ½-isocontour of the field.
export function field(sim, res = 0.025, opts = {}) {
  const d0 = sim.d0, Rk = (opts.kr || 1.8) * d0, R2 = Rk * Rk;
  let s = 0; for (let j = -8; j <= 8; j++) for (let i = -8; i <= 8; i++) { const r2 = (i * d0) ** 2 + (j * d0) ** 2; if (r2 < R2) { const t = 1 - r2 / R2; s += t * t * t; } }
  const amp = 1 / s;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let p = 0; p < sim.n; p++) { const x = sim.px[p], y = sim.py[p]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 -= 0.5; y0 -= 0.5; x1 += 0.5; y1 += 0.5;
  const w = Math.ceil((x1 - x0) / res), h = Math.ceil((y1 - y0) / res);
  const g = new Float32Array(w * h);
  for (let p = 0; p < sim.n; p++) {
    if (opts.filter && !opts.filter(p)) continue;
    const cx = sim.px[p], cy = sim.py[p];
    const i0 = Math.max(0, Math.floor((cx - Rk - x0) / res)), i1 = Math.min(w - 1, Math.ceil((cx + Rk - x0) / res));
    const j0 = Math.max(0, Math.floor((cy - Rk - y0) / res)), j1 = Math.min(h - 1, Math.ceil((cy + Rk - y0) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = x0 + (i + 0.5) * res - cx, dy = y0 + (j + 0.5) * res - cy, r2 = dx * dx + dy * dy;
      if (r2 < R2) { const t = 1 - r2 / R2; g[j * w + i] += amp * t * t * t; }
    }
  }
  return { g, w, h, x0, y0, res };
}

export function visualArea(sim, res = 0.025, opts) {
  const { g, res: r } = field(sim, res, opts);
  let c = 0;
  for (let k = 0; k < g.length; k++) if (g[k] > 0.5) c++;
  return c * r * r;
}
