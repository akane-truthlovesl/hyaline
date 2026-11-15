import * as S from './shaders.js';
import { Surface } from './surface.js';
import { SURF } from '../sim/surfaces.js';

// Pass order each frame:
//   scene  — the dish (substrate, zones of medium, walls), full resolution
//   field  — F, Σ and S: one kernel per particle and one capsule per drawn thread, summed into
//            two targets at once at reduced resolution
//   thick  — T: F blurred wide (how much matter is piled up here)
//   screen — matter as optics over the scene, then what it carries inside and what it sheds

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Renderer {
  constructor(canvas, maxN) {
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance', desynchronized: true, preserveDrawingBuffer: false,
    }));
    if (!gl) throw new Error('WebGL2 is required');
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_float_blend');
    this.gain = this.floatTargets ? 1 : 0.18;     // 8-bit fallback: store the fields scaled down
    this.surface = new Surface(maxN);
    this.fieldScale = 0.5;
    this.maxDpr = 2;

    this.pScene = program(gl, S.VS_FULL, S.FS_SCENE);
    this.pSprite = program(gl, S.VS_SPRITE, S.FS_SPRITE);
    this.pSplat = program(gl, S.VS_SPLAT, S.FS_SPLAT);
    this.pThread = program(gl, S.VS_THREAD, S.FS_THREAD);
    this.pBlur = program(gl, S.VS_FULL, S.FS_BLUR);
    this.pComp = program(gl, S.VS_FULL, S.FS_COMPOSITE);
    this.pMote = program(gl, S.VS_MOTE, S.FS_MOTE);
    this.pMist = program(gl, S.VS_MIST, S.FS_MIST);

    // geometry
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vFull = this._vao([]);
    const SF = Surface.FLOATS * 4, TF = Surface.TFLOATS * 4, MF = Surface.MFLOATS * 4;
    this.bSplat = gl.createBuffer(); this.vSplat = this._vao([[this.bSplat, SF, [[1, 4, 0], [2, 4, 16], [3, 4, 32], [4, 1, 48]]]]);
    this.bThread = gl.createBuffer(); this.vThread = this._vao([[this.bThread, TF, [[1, 4, 0], [2, 4, 16], [3, 3, 32]]]]);
    this.bMote = gl.createBuffer(); this.vMote = this._vao([[this.bMote, MF, [[1, 4, 0], [2, 2, 16]]]]);
    this.bMist = gl.createBuffer(); this.vMist = this._vao([[this.bMist, 16, [[1, 4, 0]]]]);
    this.bSprite = gl.createBuffer(); this.vSprite = this._vao([[this.bSprite, 32, [[1, 4, 0], [2, 4, 16]]]]);
    this.sprites = new Float32Array(256 * 8); this.nSprites = 0;

    this.sdfTex = gl.createTexture(); this.matTex = gl.createTexture();
    this.worldVersion = -1; this.worldSize = [1, 1];
    this.tints = new Float32Array(16 * 3);
    this.zA = new Float32Array(32); this.zB = new Float32Array(32); this.zC = new Float32Array(32); this.zN = 0;
    this.w = 0; this.h = 0;
    this.resize();
  }

  _vao(buffers) {
    const gl = this.gl, v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const [buf, stride, attrs] of buffers) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (const [loc, size, off] of attrs) {
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
        gl.vertexAttribDivisor(loc, 1);
      }
    }
    gl.bindVertexArray(null);
    return v;
  }

  _tex(w, h, mips) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }
  _target(w, h, mips, attachments = 1) {
    const gl = this.gl, texs = [];
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (let a = 0; a < attachments; a++) {
      const t = this._tex(w, h, mips && a === 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + a, gl.TEXTURE_2D, t, 0);
      texs.push(t);
    }
    if (attachments > 1) gl.drawBuffers(texs.map((_, a) => gl.COLOR_ATTACHMENT0 + a));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: texs[0], texs, fbo, w, h };
  }

  resize(scale = 1) {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr) * scale;
    const w = Math.max(2, Math.round(c.clientWidth * dpr)), h = Math.max(2, Math.round(c.clientHeight * dpr));
    if (w === this.w && h === this.h) return false;
    const gl = this.gl;
    this.w = c.width = w; this.h = c.height = h; this.dpr = dpr;
    for (const t of [this.tScene, this.tField, this.tThickA, this.tThickB]) if (t) { for (const x of t.texs) gl.deleteTexture(x); gl.deleteFramebuffer(t.fbo); }
    const fw = Math.max(2, Math.round(w * this.fieldScale)), fh = Math.max(2, Math.round(h * this.fieldScale));
    this.tScene = this._target(w, h, false);
    this.tField = this._target(fw, fh, true, 2);
    this.tThickA = this._target(Math.max(2, fw >> 2), Math.max(2, fh >> 2), false);
    this.tThickB = this._target(Math.max(2, fw >> 2), Math.max(2, fh >> 2), false);
    return true;
  }

  setWorld(world) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, world.nx, world.ny, 0, gl.RED, gl.FLOAT, world.sdf);
    gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, world.nx, world.ny, 0, gl.RED, gl.UNSIGNED_BYTE, world.mat);
    for (const [t, f] of [[this.sdfTex, gl.LINEAR], [this.matTex, gl.NEAREST]]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    // the baked grid covers [0, (n-1)·cell]; texel centres sit half a cell in
    this.worldSize = [world.nx * world.cell, world.ny * world.cell];
    this.sdfOffset = 0.5 * world.cell;
    this.worldVersion = world.version;
    this.tints.fill(0);
    for (let k = 0; k < Math.min(16, SURF.n); k++) for (let c = 0; c < 3; c++) this.tints[k * 3 + c] = SURF.tint[k * 3 + c];
    // the medium: each zone is shown by the light it holds, coloured by what it does
    this.zN = Math.min(8, world.zones.length);
    for (let k = 0; k < this.zN; k++) {
      const z = world.zones[k], o = k * 4;
      const tint = z.tint || zoneTint(z);
      this.zA[o] = z.t === 'circle' ? 0 : z.t === 'box' ? 1 : 2; this.zA[o + 1] = z.t === 'capsule' ? z.x1 : z.x; this.zA[o + 2] = z.t === 'capsule' ? z.y1 : z.y; this.zA[o + 3] = z.soft;
      if (z.t === 'circle') { this.zB[o] = z.r; }
      else if (z.t === 'box') { this.zB[o] = z.hw; this.zB[o + 1] = z.hh; this.zB[o + 2] = z.r || 0; }
      else { this.zB[o] = z.x2; this.zB[o + 1] = z.y2; this.zB[o + 2] = z.r1; }
      this.zC[o] = tint[0]; this.zC[o + 1] = tint[1]; this.zC[o + 2] = tint[2]; this.zC[o + 3] = tint[3] ?? 1;
    }
  }

  clearSprites() { this.nSprites = 0; }
  // kind 1 calyx ring (a = progress), 2 soft glow (a = strength)
  sprite(x, y, radius, kind, r, g, b, a) {
    if (this.nSprites >= 256) return;
    const o = this.nSprites++ * 8, s = this.sprites;
    s[o] = x; s[o + 1] = y; s[o + 2] = radius; s[o + 3] = kind; s[o + 4] = r; s[o + 5] = g; s[o + 6] = b; s[o + 7] = a;
  }

  // cam: { x, y, ppu }  (ppu = device pixels per world unit)
  draw(sim, cam, time, dt, fx = {}) {
    const gl = this.gl, sf = this.surface;
    if (sim.world.version !== this.worldVersion || this.worldRef !== sim.world) { this.worldRef = sim.world; this.setWorld(sim.world); }
    sf.build(sim, dt);
    const hx = this.w / (2 * cam.ppu), hy = this.h / (2 * cam.ppu);
    const view = [cam.x, cam.y, hx, hy], px = 1 / cam.ppu, gInv = 1 / this.gain;
    const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };
    const full = () => { gl.bindVertexArray(this.vFull); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
    const instanced = (vao, buf, data, floats, n) => {
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW, 0, n * floats);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    };

    // 1. scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tScene.fbo); gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    let P = this.pScene; gl.useProgram(P.p);
    bind(0, this.sdfTex); bind(1, this.matTex);
    gl.uniform1i(P.u.uSdf, 0); gl.uniform1i(P.u.uMat, 1);
    gl.uniform4f(P.u.uView, view[0] + this.sdfOffset, view[1] + this.sdfOffset, hx, hy);
    gl.uniform2f(P.u.uWorld, this.worldSize[0], this.worldSize[1]);
    gl.uniform1f(P.u.uTime, time); gl.uniform1f(P.u.uPx, px);
    gl.uniform3fv(P.u.uTint, this.tints);
    gl.uniform1i(P.u.uZn, this.zN);
    if (this.zN) { gl.uniform4fv(P.u.uZa, this.zA); gl.uniform4fv(P.u.uZb, this.zB); gl.uniform4fv(P.u.uZc, this.zC); }
    full();
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    if (this.nSprites) {
      P = this.pSprite; gl.useProgram(P.p);
      gl.uniform4fv(P.u.uView, view); gl.uniform1f(P.u.uTime, time);
      instanced(this.vSprite, this.bSprite, this.sprites, 8, this.nSprites);
    }

    // 2. fields
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tField.fbo); gl.viewport(0, 0, this.tField.w, this.tField.h);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    P = this.pSplat; gl.useProgram(P.p); gl.uniform4fv(P.u.uView, view); gl.uniform1f(P.u.uGain, this.gain);
    if (sf.n) instanced(this.vSplat, this.bSplat, sf.inst, Surface.FLOATS, sf.n);
    if (sf.nThreads) {
      P = this.pThread; gl.useProgram(P.p); gl.uniform4fv(P.u.uView, view); gl.uniform1f(P.u.uGain, this.gain);
      instanced(this.vThread, this.bThread, sf.threads, Surface.TFLOATS, sf.nThreads);
    }
    gl.disable(gl.BLEND);
    bind(0, this.tField.texs[0]); gl.generateMipmap(gl.TEXTURE_2D);

    // 3. thickness: two separable passes
    const sigma = 0.44;
    P = this.pBlur; gl.useProgram(P.p); gl.uniform1i(P.u.uTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tThickA.fbo); gl.viewport(0, 0, this.tThickA.w, this.tThickA.h);
    gl.uniform2f(P.u.uStep, sigma / (4 * hx), 0); gl.uniform1f(P.u.uClamp, 1.0); gl.uniform1f(P.u.uLod, 2.0); gl.uniform1f(P.u.uGainInv, gInv);
    full();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tThickB.fbo);
    bind(0, this.tThickA.tex);
    gl.uniform2f(P.u.uStep, 0, sigma / (4 * hy)); gl.uniform1f(P.u.uClamp, 4.0); gl.uniform1f(P.u.uLod, 0.0); gl.uniform1f(P.u.uGainInv, 1);
    full();

    // 4. matter
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    P = this.pComp; gl.useProgram(P.p);
    bind(0, this.tField.texs[0]); bind(1, this.tField.texs[1]); bind(2, this.tThickB.tex); bind(3, this.tScene.tex);
    gl.uniform1i(P.u.uField0, 0); gl.uniform1i(P.u.uField1, 1); gl.uniform1i(P.u.uThick, 2); gl.uniform1i(P.u.uScene, 3);
    gl.uniform2f(P.u.uFieldTexel, 1 / this.tField.w, 1 / this.tField.h);
    gl.uniform2f(P.u.uThickTexel, 1 / this.tThickB.w, 1 / this.tThickB.h);
    gl.uniform4fv(P.u.uView, view); gl.uniform2f(P.u.uRes, this.w, this.h);
    gl.uniform1f(P.u.uTime, time); gl.uniform1f(P.u.uFirm, Math.max(0, fx.firm || 0)); gl.uniform1f(P.u.uPx, px);
    gl.uniform1f(P.u.uFlash, fx.flash || 0); gl.uniform1f(P.u.uGainInv, gInv);
    full();

    // 5. what it carries, and what it sheds
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    if (sf.nMotes) {
      P = this.pMote; gl.useProgram(P.p);
      gl.uniform1i(P.u.uField0, 0); gl.uniform1i(P.u.uThick, 2);
      gl.uniform4fv(P.u.uView, view); gl.uniform1f(P.u.uPx, px * this.dpr); gl.uniform1f(P.u.uTime, time); gl.uniform1f(P.u.uGainInv, gInv);
      instanced(this.vMote, this.bMote, sf.motes, Surface.MFLOATS, sf.nMotes);
    }
    if (sf.nMist) {
      P = this.pMist; gl.useProgram(P.p);
      gl.uniform4fv(P.u.uView, view); gl.uniform1f(P.u.uPx, px * this.dpr);
      instanced(this.vMist, this.bMist, sf.mist, 4, sf.nMist);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}

// What a zone does, as a colour: heat glows, frost whitens, healing is gold-green, repulsion is
// a cold violet, thick medium is murky, a free lane is bright.
function zoneTint(z) {
  if (z.heatRate > 0 && z.heat > 0) return [1.0, 0.42, 0.18, 0.9];
  if (z.heatRate > 0 && z.heat < 0) return [0.62, 0.86, 1.0, 0.9];
  if (z.fuse < 0) return [0.62, 0.32, 1.0, 0.9];
  if (z.fuse > 1 || z.heal > 1) return [0.55, 1.0, 0.55, 0.8];
  if (z.burn < 1) return [0.95, 0.95, 0.6, 0.8];
  if (z.visc > 1 || z.drag > 1) return [0.35, 0.45, 0.4, 0.8];
  if (z.gx || z.gy) return [0.5, 0.6, 1.0, 0.7];
  return [0.4, 0.6, 0.7, 0.5];
}
