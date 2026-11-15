// Sound and touch are driven by the same physical events the eye sees — nothing is on a timer.
// Every cue here is also legible with sound and vibration off; this layer only deepens it.
//
//   shear inside the body ...... a wet hush that follows how hard it is being worked
//   a thread under tension ..... a tone that climbs toward the breaking strain, and a pulse
//                                under the thumb that quickens with it
//   a thread letting go ........ a small bright pluck
//   hitting something .......... a soft low thump scaled by the impact
//   two pieces becoming one .... a warm low fifth
//   taking mass in ............. a glass note, climbing a pentatonic scale on a streak
//   burning mass ............... a falling rush

const SCALE = [0, 2, 4, 7, 9];

export class Sound {
  constructor() {
    this.ctx = null; this.on = false;
    this.lastThump = 0; this.lastMerge = 0; this.lastSnap = 0; this.lastCut = 0;
    this.tremor = 0; this.canBuzz = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    this.lastBuzz = 0;
  }

  unlock() {
    if (this.ctx) { this.ctx.resume && this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try { ctx = this.ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
    this.out = ctx.createGain(); this.out.gain.value = 0.9;
    this.out.connect(comp); comp.connect(ctx.destination);

    // two seconds of noise, shared by everything that hisses
    const len = ctx.sampleRate * 2, buf = (this.noise = ctx.createBuffer(1, len, ctx.sampleRate)), d = buf.getChannelData(0);
    let s = 0x9e3779b9;
    for (let i = 0; i < len; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 2147483648) - 1; }
    const loop = () => { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.start(); return n; };

    // the hush of the body being worked
    this.sqF = ctx.createBiquadFilter(); this.sqF.type = 'bandpass'; this.sqF.frequency.value = 420; this.sqF.Q.value = 0.9;
    this.sqG = ctx.createGain(); this.sqG.gain.value = 0;
    loop().connect(this.sqF); this.sqF.connect(this.sqG); this.sqG.connect(this.out);
    // the room: a dish under glass
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 160;
    const rg = ctx.createGain(); rg.gain.value = 0.02;
    loop().connect(rf); rf.connect(rg); rg.connect(this.out);
    // a thread under tension
    this.stA = ctx.createOscillator(); this.stA.type = 'sine';
    this.stB = ctx.createOscillator(); this.stB.type = 'triangle';
    this.stF = ctx.createBiquadFilter(); this.stF.type = 'lowpass'; this.stF.frequency.value = 1400;
    this.stG = ctx.createGain(); this.stG.gain.value = 0;
    this.stA.connect(this.stF); this.stB.connect(this.stF); this.stF.connect(this.stG); this.stG.connect(this.out);
    this.stA.start(); this.stB.start();
    // the calyx taking hold
    this.seatO = ctx.createOscillator(); this.seatO.type = 'sine';
    this.seatG = ctx.createGain(); this.seatG.gain.value = 0;
    this.seatO.connect(this.seatG); this.seatG.connect(this.out); this.seatO.start();
    this.on = true;
  }

  buzz(pattern) {
    if (!this.canBuzz) return;
    const now = performance.now();
    if (now - this.lastBuzz < 34) return;
    this.lastBuzz = now;
    try { navigator.vibrate(pattern); } catch {}
  }

  _tone(freq, dur, gain, type = 'sine', to = 0, attack = 0.004) {
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }

  _hiss(dur, gain, type, f0, f1, q = 1) {
    const ctx = this.ctx, t = ctx.currentTime, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.noise; n.loop = true;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.out);
    n.start(t, Math.random() * 1.5); n.stop(t + dur + 0.02);
  }

  // Once per frame, with the physics events of that frame.
  feed(ev, sim, dt) {
    const now = performance.now();
    // touch first: it must work even where audio is unavailable. Strain arrives as a share of the
    // breaking strain of the most stretched strand or skin (1 = letting go now)
    const strain = ev.strainN > 2 ? ev.strainMax : 0;
    if (strain > 0.7) {
      // finer and faster as the thread nears letting go
      this.tremor += dt * 1000;
      const gap = 120 - 95 * Math.min(1, (strain - 0.7) / 0.28);
      if (this.tremor >= gap) { this.tremor = 0; this.buzz(4); }
    }
    if (ev.snaps > 2 && now - this.lastSnap > 60) this.buzz(7);
    const hit = ev.impactN > 5 ? Math.min(1, ev.impact / 700) : 0;
    if (hit > 0.06 && now - this.lastThump > 80) this.buzz(6 + Math.round(16 * hit));
    if (ev.fusions > 6 && now - this.lastMerge > 220) this.buzz([9, 36, 14]);
    if (ev.cuts > 4 && now - this.lastCut > 120) this.buzz(5);
    const lost = ev.eroded + ev.drunk;
    if (lost > 0 && now - (this.lastLoss || 0) > 90) this.buzz(3);

    if (!this.on) {
      if (ev.snaps > 2) this.lastSnap = now;
      if (hit > 0.06) this.lastThump = now;
      if (ev.fusions > 6) this.lastMerge = now;
      if (ev.cuts > 4) this.lastCut = now;
      if (lost > 0) this.lastLoss = now;
      return;
    }
    const ctx = this.ctx, t = ctx.currentTime;
    const b = sim.primary, speed = sim.nBodies ? Math.hypot(sim.bVx[b], sim.bVy[b]) : 0;
    this.sqG.gain.setTargetAtTime(Math.min(0.16, (ev.shear / Math.max(dt, 1e-3)) * 0.05), t, 0.06);
    this.sqF.frequency.setTargetAtTime(300 + 70 * speed + 400 * Math.max(0, sim.dial) - 120 * Math.max(0, -sim.dial), t, 0.1);
    if (lost > 0 && now - (this.lastLoss || 0) > 90) {
      this.lastLoss = now;
      this._hiss(0.06, 0.03 + 0.01 * Math.min(6, lost), 'bandpass', 1800 + 600 * Math.random(), 900, 2);
    }

    const sg = strain > 0.55 ? Math.min(0.07, 0.015 + 0.004 * ev.strainN) * Math.min(1, (strain - 0.55) * 4) : 0;
    this.stG.gain.setTargetAtTime(sg, t, 0.05);
    if (strain > 0) {
      const f = 150 + 700 * Math.min(1, strain);
      this.stA.frequency.setTargetAtTime(f, t, 0.04); this.stB.frequency.setTargetAtTime(f * 1.503, t, 0.04);
    }
    if (ev.snaps > 2 && now - this.lastSnap > 60) {
      this.lastSnap = now;
      const v = Math.min(1, ev.snaps / 14);
      this._tone(520 + 520 * Math.random(), 0.09, 0.05 + 0.1 * v, 'sine', 300);
      this._hiss(0.03, 0.05 + 0.08 * v, 'highpass', 2600);
    }
    if (hit > 0.06 && now - this.lastThump > 80) {
      this.lastThump = now;
      this._tone(105, 0.16, 0.1 + 0.3 * hit, 'sine', 46);
      this._hiss(0.07, 0.04 * hit, 'lowpass', 700);
    }
    if (ev.fusions > 6 && now - this.lastMerge > 220) {
      this.lastMerge = now;
      const v = Math.min(1, ev.fusions / 70);
      this._tone(98, 0.5, 0.06 + 0.12 * v, 'sine', 0, 0.04);
      this._tone(147, 0.42, 0.03 + 0.07 * v, 'sine', 0, 0.05);
    }
    if (ev.cuts > 4 && now - this.lastCut > 120) {
      this.lastCut = now;
      this._hiss(0.05, 0.05, 'highpass', 5200);
      this._tone(3100, 0.05, 0.02, 'sine', 2300);
    }
  }

  chime(streak) {
    this.buzz(10);
    if (!this.on) return;
    const f = 523.25 * Math.pow(2, (SCALE[streak % 5] + 12 * Math.min(2, Math.floor(streak / 5))) / 12);
    this._tone(f, 0.7, 0.16, 'sine');
    this._tone(f * 2.76, 0.28, 0.04, 'sine');
    this._tone(f * 0.5, 0.5, 0.05, 'sine', 0, 0.03);
  }
  burst(fraction) {
    this.buzz(30);
    if (!this.on) return;
    this._hiss(0.38, 0.22 + fraction * 1.5, 'bandpass', 2400, 260, 0.8);
    this._tone(74, 0.24, 0.3, 'sine', 40);
  }
  deny() { this.buzz([4, 30, 4]); if (this.on) this._tone(140, 0.07, 0.06, 'triangle', 110); }
  tick(v) { this.buzz(5); if (this.on) this._tone(330 + 200 * v, 0.06, 0.05 * (0.5 + v), 'sine'); }
  seat(progress, rising) {
    if (!this.on) return;
    const t = this.ctx.currentTime;
    this.seatO.frequency.setTargetAtTime(196 * (1 + progress), t, 0.03);
    this.seatG.gain.setTargetAtTime(rising ? 0.02 + 0.07 * progress : 0, t, 0.06);
  }
  complete() {
    this.buzz([18, 50, 18, 50, 40]);
    if (!this.on) return;
    this.seatG.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    for (const [f, g] of [[261.6, 0.12], [392, 0.09], [587.3, 0.07], [784, 0.04]]) this._tone(f, 1.5, g, 'sine', 0, 0.12);
  }
}
