import { Game } from './game/game.js';

// Frame pacing. The simulation runs a whole number of fixed ticks per displayed frame, with
// the tick length derived from the display's own refresh rate — so motion is perfectly even
// on 60, 90, 120 or 144 Hz panels, and input read at the top of a frame is on screen at the
// end of that same frame.

const q = new URLSearchParams(location.search);
const dom = {
  canvas: document.getElementById('view'), stick: document.getElementById('stick'), dial: document.getElementById('dial'),
  title: document.getElementById('title'), chamber: document.getElementById('chamber'),
  mass: document.getElementById('mass'), clock: document.getElementById('clock'),
  summary: document.getElementById('summary'), hint: document.getElementById('hint'),
  dev: document.getElementById('dev'),
};

let game;
try {
  game = new Game(dom, { d0: q.has('d0') ? +q.get('d0') : 0, chamber: q.has('c') ? +q.get('c') : 0 });
} catch (err) {
  document.body.classList.add('failed');
  document.getElementById('fail').textContent = String(err && err.message ? err.message : err);
  throw err;
}
window.__game = game;

const RATES = [48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
let hz = 60, ticks = 2, tickDt = 1 / 120;
function setRate(measured) {
  let best = RATES[0];
  for (const r of RATES) if (Math.abs(r - measured) < Math.abs(best - measured)) best = r;
  hz = best;
  ticks = Math.max(1, Math.ceil(100 / hz));        // keep the tick at or under 10 ms
  tickDt = 1 / (hz * ticks);
}
const samples = [];
let last = 0, frames = 0, scale = 1, slow = 0, simMs = 0, drawMs = 0, fpsT = 0, fpsN = 0, fps = 0;
const manual = q.has('manual');                     // the test harness steps frames itself

function frame(now) {
  if (!manual) requestAnimationFrame(frame);
  const el = last ? now - last : 1000 / hz;
  last = now;
  if (el > 0 && el < 100 && samples.length < 40) {
    samples.push(el);
    if (samples.length === 40) { samples.sort((a, b) => a - b); setRate(1000 / samples[12]); }
  }
  // normally exactly `ticks`; catch up after a dropped frame, never spiral
  const nominal = 1000 / hz;
  let n = ticks * Math.max(1, Math.min(3, Math.round(el / nominal)));
  if (el > 250) n = ticks;
  const frameDt = n * tickDt;

  game.renderer.resize(scale);
  const t0 = performance.now();
  game.update(frameDt, n, tickDt);
  const t1 = performance.now();
  game.render(frameDt);
  const t2 = performance.now();
  simMs += (t1 - t0 - simMs) * 0.05; drawMs += (t2 - t1 - drawMs) * 0.05;
  window.__perf = { simMs, drawMs, hz, ticks, scale, bench: game.benchMs, d0: game.d0 };

  // if the device cannot hold the refresh rate, give up pixels before giving up smoothness
  frames++;
  if (frames > 90) {
    if (el > nominal * 1.35) slow++; else slow = Math.max(0, slow - 0.25);
    if (slow > 45 && scale > 0.5) { scale = Math.max(0.5, scale * 0.85); slow = 0; }
  }
  fpsN++; fpsT += el;
  if (fpsT > 500) { fps = (1000 * fpsN) / fpsT; fpsN = 0; fpsT = 0; if (dom.dev && q.has('dev')) dev(); }
}

function dev() {
  const s = game.sim, c = s.compression();
  dom.dev.textContent = `${fps.toFixed(0)} fps @ ${hz} Hz · ${ticks}×${(tickDt * 1000).toFixed(2)} ms\n` +
    `sim ${simMs.toFixed(2)} ms · draw ${drawMs.toFixed(2)} ms · scale ${scale.toFixed(2)}\n` +
    `n ${s.count} (mine ${s.playerMass()}, d0 ${s.P.d0}) · pieces ${s.nComps} · links ${s.nBonds}\n` +
    `compression ${(c.mean * 100).toFixed(2)}% (worst ${(c.worst * 100).toFixed(0)}%) · dial ${s.dial.toFixed(2)}\n` +
    `bench ${game.benchMs.toFixed(2)} ms · ${game.state}`;
}
if (q.has('dev')) dom.dev.classList.add('on');

window.__step = (count = 1) => { for (let k = 0; k < count; k++) frame(last + 1000 / 60); };
if (!manual) requestAnimationFrame(frame);
window.addEventListener('resize', () => game.renderer.resize(scale));
document.addEventListener('visibilitychange', () => { last = 0; });
