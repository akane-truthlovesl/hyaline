// Drive the real page in headless Chrome and capture frames, for looking at the game without
// a display. Frames are stepped manually, so every run is deterministic.
//   node tools/shot.mjs <scenario> [outDir] [key=value ...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from './serve.mjs';

const scenario = process.argv[2] || 'intro';
const outDir = process.argv[3] || '.';
const opts = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=')));
const W = +(opts.w || 390), H = +(opts.h || 844), DPR = +(opts.dpr || 2);

const { server, port } = await serve(0, true);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hyaline-shot-'));
const chrome = spawn('google-chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--window-size=${W},${H}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

let nextId = 1, buf = Buffer.alloc(0);
const pending = new Map(), listeners = [];
chrome.stdio[4].on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  let z;
  while ((z = buf.indexOf(0)) >= 0) {
    const msg = JSON.parse(buf.subarray(0, z).toString()); buf = buf.subarray(z + 1);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
    else for (const l of listeners) l(msg);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
});
const once = (name) => new Promise((resolve) => { const l = (m) => { if (m.method === name) { listeners.splice(listeners.indexOf(l), 1); resolve(m.params); } }; listeners.push(l); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable');
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') console.log('PAGE EXCEPTION:', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) console.log('console.' + m.params.type + ':', m.params.args.map((a) => a.value ?? a.description).join(' '));
});
await S('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
const query = new URLSearchParams({ manual: 1, ...(opts.d0 ? { d0: opts.d0 } : {}), ...(opts.c ? { c: opts.c } : {}), ...(opts.dev ? { dev: 1 } : {}) });
const loaded = once('Page.loadEventFired');
await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?${query}` });
await loaded;
const ev = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
for (let k = 0; k < 100 && !(await ev('!!window.__game || document.body.classList.contains("failed")')); k++) await new Promise((r) => setTimeout(r, 100));
if (await ev('document.body.classList.contains("failed")')) { console.log('BOOT FAILED:', await ev('document.getElementById("fail").textContent')); }
// zoom=k: capture a k-unit square around the player's primary body at 2× instead of the screen
const shot = async (name) => {
  let clip;
  if (opts.zoom) {
    const at = opts.at ? opts.at.split(',').map(Number) : null;
    const r = JSON.parse(await ev(`(()=>{const g=__game,s=g.sim,b=s.primary,R=g.renderer,c=g.cam,cv=g.dom.canvas;` +
      `const X=${at ? at[0] : 's.bCx[b]'},Y=${at ? at[1] : 's.bCy[b]'};` +
      `return JSON.stringify({x:(X-c.x)*c.ppu/R.dpr+cv.clientWidth/2,y:(Y-c.y)*c.ppu/R.dpr+cv.clientHeight/2,u:c.ppu/R.dpr})})()`));
    const half = (+opts.zoom * r.u) / 2;
    clip = { x: Math.max(0, r.x - half), y: Math.max(0, r.y - half), width: half * 2, height: half * 2, scale: 2 };
  }
  const { data } = await S('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  const file = path.join(outDir, `${scenario}_${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('wrote', file);
};
const dial = (v) => ev(`(__game.input.keyDial=${v}, 0)`);
const burst = (x, y, s) => ev(`(__game._burst(${x}, ${y}, ${s}), 0)`);
const step = (n) => ev(`__step(${n})`);
const stick = (x, y) => ev(`(__game.input.x=${x}, __game.input.y=${y}, 0)`);
const info = () => ev(`(()=>{const g=__game,s=g.sim,c=s.compression();return JSON.stringify({state:g.state,n:s.count,bodies:s.nComps,prim:s.bCount[s.primary],x:+s.bCx[s.primary].toFixed(2),y:+s.bCy[s.primary].toFixed(2),comp:+c.mean.toFixed(4),calyx:+g.calyx.inside.toFixed(2),float:g.renderer.floatTargets,d0:s.P.d0})})()`);

const scenarios = {
  async intro() { await step(2); await shot('00'); await step(30); await shot('01'); await step(45); await shot('02'); await step(90); await shot('03'); console.log(await info()); },
  async drive() {
    await step(200); await shot('rest');
    await stick(0.9, -0.45); await step(40); await shot('a'); await step(40); await shot('b');
    await stick(0, -1); await step(60); await shot('c'); await step(60); await shot('d'); await step(80); await shot('e');
    await stick(0, 0); await step(90); await shot('f'); console.log(await info());
  },
  async still() { await step(+(opts.frames || 240)); await shot('a'); console.log(await info()); },
  // seq="f120 s0.6,-1 f40 shot d1 f30 shot b0,-1,0.8 f20 shot": frames, stick, dial, burst, shot
  async seq() {
    let k = 0;
    for (const tok of String(opts.seq || 'f120 shot').split(' ')) {
      const c = tok[0], a = tok.slice(1).split(',').map(Number);
      if (tok === 'shot') await shot(String(k++).padStart(2, '0'));
      else if (c === 'f') await step(a[0]);
      else if (c === 's') await stick(a[0], a[1]);
      else if (c === 'd') await dial(a[0]);
      else if (c === 'b') await burst(a[0], a[1], a[2] ?? 0.7);
    }
    console.log(await info());
    console.log('perf', await ev('JSON.stringify(window.__perf)'));
  },
  // the autopilot's route through a chamber, a frame every `every`
  async auto() {
    const routes = {
      0: [[8, 17.5], [10.6, 15.6], [8, 12.6], [5.4, 9.2], [9.6, 7.8], [8, 4.9]],
      1: [[13.2, 23.4], [13.2, 17.8], [8, 17.6], [2.6, 17.2], [2.6, 11.6], [8, 9.6], [8, 6.4], [8, 3.9]],
      2: [[9, 23.8], [5.4, 19.6], [5.8, 14.0], [9, 11.4], [6.6, 8.6], [9, 4.2]],
      3: [[6.2, 25.8], [9, 21.8], [9, 16.6], [9, 13.0], [6.4, 9.6], [9, 4.2]],
    };
    const route = JSON.stringify(routes[+(opts.c || 0)]), every = +(opts.every || 20), n = +(opts.n || 12), mag = +(opts.mag || 1);
    await ev(`window.__wp = 0; window.__route = ${route}; 0`);
    for (let k = 0; k < n; k++) {
      for (let f = 0; f < every; f++) {
        await ev(`(()=>{const g=__game,s=g.sim,b=s.primary,r=__route;let [tx,ty]=r[Math.min(__wp,r.length-1)];let dx=tx-s.bCx[b],dy=ty-s.bCy[b],d=Math.hypot(dx,dy);const last=__wp>=r.length-1;if(!last&&d<1.3)__wp++;const m=last?Math.min(1,d/1.2):Math.min(${mag},0.45+d/2);g.input.x=dx/(d+1e-6)*m;g.input.y=dy/(d+1e-6)*m;__step(1);return 0})()`);
      }
      await shot(String(k).padStart(2, '0'));
    }
    console.log(await info());
    console.log('perf', await ev('JSON.stringify(window.__perf)'));
  },
  async up() {
    await step(170);
    for (let k = 0; k < +(opts.n || 8); k++) { await stick(+(opts.sx || 0), -1); await step(+(opts.every || 50)); await shot(String(k)); }
    console.log(await info());
    console.log('perf', await ev('JSON.stringify(window.__perf)'));
  },
};
try { await scenarios[scenario](); } catch (e) { console.log('SCENARIO ERROR:', e.message); }
chrome.kill(); server.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
