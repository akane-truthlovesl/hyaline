// Minimal PNG writer and a field plotter, for looking at simulation state without a browser.
import zlib from 'node:zlib';
import fs from 'node:fs';

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
export function writePNG(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const PAL = [[120, 230, 255], [255, 170, 90], [170, 255, 140], [255, 120, 200], [200, 180, 255], [255, 240, 120]];

// The matter field the eye would see (isotropic kernels of fixed integral, one per particle),
// coloured by `mode`: body, piece, kin, strain, skin, heat, sub, will, rho, dots, bonds.
export function raster(sim, view, mode = 'body', scale = 40, opts = {}) {
  const [x0, y0, x1, y1] = view;
  const w = Math.round((x1 - x0) * scale), h = Math.round((y1 - y0) * scale);
  const img = new Uint8Array(w * h * 3);
  const F = new Float32Array(w * h), R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
  const world = sim.world, d0 = sim.d0, Rk = 1.8 * d0, R2 = Rk * Rk;
  // amplitude: a lattice of d0² per particle sums to 1 in the bulk
  let s = 0; for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) { const r2 = (i * d0) ** 2 + (j * d0) ** 2; if (r2 < R2) { const t = 1 - r2 / R2; s += t * t * t; } }
  const amp = 1 / s, res = 1 / scale;
  for (let p = 0; p < sim.n; p++) {
    let c;
    if (mode === 'piece') c = PAL[(sim.piece[p] >>> 0) % PAL.length];
    else if (mode === 'kin') c = [[200, 200, 200], [120, 230, 255], [255, 120, 160], [170, 255, 140]][sim.kin[p] & 3];
    else if (mode === 'strain') { const t = Math.min(1, sim.strainS[p] * 1.5); c = [60 + 195 * t, 220 - 150 * t, 255 - 200 * t]; }
    else if (mode === 'skin') { const t = sim.skin[p]; c = [120 + 135 * t, 230 - 100 * t, 255 - 200 * t]; }
    else if (mode === 'heat') { const t = Math.max(-1, Math.min(1, sim.heat[p])); c = [160 + 95 * Math.max(0, t), 160 - 60 * Math.abs(t), 160 + 95 * Math.max(0, -t)]; }
    else if (mode === 'sub') c = [255 * Math.exp(-0.45 * sim.cr[p]), 255 * Math.exp(-0.45 * sim.cg[p]), 255 * Math.exp(-0.45 * sim.cb[p])];
    else if (mode === 'will') { const t = sim.will[p]; c = [120 + 135 * t, 230 - 60 * t, 255 - 180 * t]; }
    else if (mode === 'flow') { const b = Math.max(0, sim.body[p]), t = Math.max(-1, Math.min(1, ((sim.vx[p] - sim.bVx[b]) * (opts.fx ?? 1) + (sim.vy[p] - sim.bVy[b]) * (opts.fy ?? 0)) * 0.8)); c = [150 + 105 * Math.max(0, t) - 60 * Math.max(0, -t), 150 - 50 * Math.abs(t), 150 + 105 * Math.max(0, -t) - 60 * Math.max(0, t)]; }
    else if (mode === 'rho') { const t = Math.max(-1, Math.min(1, (sim.rho[p] / sim.rho0 - 1) * 6)); c = [160 + 95 * Math.max(0, t), 170, 160 + 95 * Math.max(0, -t)]; }
    else c = PAL[Math.max(0, sim.body[p]) % PAL.length];
    const cx = sim.px[p], cy = sim.py[p];
    const i0 = Math.max(0, Math.floor((cx - Rk - x0) / res)), i1 = Math.min(w - 1, Math.ceil((cx + Rk - x0) / res));
    const j0 = Math.max(0, Math.floor((cy - Rk - y0) / res)), j1 = Math.min(h - 1, Math.ceil((cy + Rk - y0) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = x0 + (i + 0.5) * res - cx, dy = y0 + (j + 0.5) * res - cy, r2 = dx * dx + dy * dy;
      if (r2 >= R2) continue;
      const t = 1 - r2 / R2, k = j * w + i, a = amp * t * t * t;
      F[k] += a; R[k] += a * c[0]; G[k] += a * c[1]; B[k] += a * c[2];
    }
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const X = x0 + (i + 0.5) * res, Y = y0 + (j + 0.5) * res, k = j * w + i, o = k * 3;
    const d = world.dist(X, Y);
    if (d < 0) { const m = world.material(X, Y); img[o] = 48 + m * 24; img[o + 1] = 54 + (m === 1 ? 30 : 0); img[o + 2] = 68 - m * 6; continue; }
    const f = F[k];
    if (f > 0.5) {
      const sh = Math.min(1, 0.55 + 0.45 * Math.min(1, (f - 0.5) * 3));
      img[o] = (R[k] / f) * sh; img[o + 1] = (G[k] / f) * sh; img[o + 2] = (B[k] / f) * sh;
    } else { const g = Math.min(1, f * 1.4); img[o] = 10 + 30 * g; img[o + 1] = 13 + 40 * g; img[o + 2] = 20 + 50 * g; }
  }
  const dot = (X, Y, r, g, b) => { if (X >= 0 && Y >= 0 && X < w && Y < h) { const o = (Y * w + X) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; } };
  if (mode === 'dots' || mode === 'bonds') for (let p = 0; p < sim.n; p++) dot(Math.round((sim.px[p] - x0) * scale), Math.round((sim.py[p] - y0) * scale), 255, 255, 255);
  if (mode === 'bonds' && sim.bj) {
    const S = 6;
    for (let i = 0; i < sim.n; i++) for (let s2 = 0; s2 < S; s2++) {
      const j = sim.bj[i * S + s2]; if (j <= i) continue;
      const ax = (sim.px[i] - x0) * scale, ay = (sim.py[i] - y0) * scale, bx = (sim.px[j] - x0) * scale, by = (sim.py[j] - y0) * scale;
      const L = Math.hypot(bx - ax, by - ay), st = Math.min(1, Math.max(0, (Math.hypot(sim.px[j] - sim.px[i], sim.py[j] - sim.py[i]) / sim.bl[i * S + s2] - 1) * 2));
      for (let t = 0; t <= L; t += 0.7) dot(Math.round(ax + (bx - ax) * t / L), Math.round(ay + (by - ay) * t / L), 255, 220 - 200 * st, 120 - 100 * st);
    }
  }
  return { w, h, img };
}
export function plot(path, sim, view, mode = 'body', scale = 40) { const t = raster(sim, view, mode, scale); writePNG(path, t.w, t.h, t.img); }
// A row-major contact sheet of equally sized tiles.
export class Sheet {
  constructor(cols) { this.cols = cols; this.tiles = []; }
  add(sim, view, mode = 'body', scale = 40) { this.tiles.push(raster(sim, view, mode, scale)); }
  save(path) {
    if (!this.tiles.length) return;
    const t0 = this.tiles[0], cols = Math.min(this.cols, this.tiles.length), rows = Math.ceil(this.tiles.length / cols);
    const W = cols * (t0.w + 2), H = rows * (t0.h + 2), out = new Uint8Array(W * H * 3).fill(90);
    this.tiles.forEach((t, k) => {
      const ox = (k % cols) * (t0.w + 2), oy = Math.floor(k / cols) * (t0.h + 2);
      for (let y = 0; y < t.h; y++) out.set(t.img.subarray(y * t.w * 3, (y + 1) * t.w * 3), ((oy + y) * W + ox) * 3);
    });
    writePNG(path, W, H, out);
  }
}
