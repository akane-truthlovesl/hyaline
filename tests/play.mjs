// Autopilot: play every chamber headless with a simple waypoint pilot, and report whether the
// loop can be finished, how long it took and what it cost. It plays like a cautious beginner:
// steer at the next waypoint; if stuck, go supple; if still stuck, burst.
//   node tests/play.mjs [chamber] [d0=0.12] [verbose=1]
import { Game } from '../src/game/game.js';
import { CHAMBERS } from '../src/game/chambers.js';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=')));
const only = process.argv.slice(2).find((a) => !a.includes('='));
const d0 = +(args.d0 || 0.12), verbose = !!args.verbose;

const ROUTES = {
  cradle: [[8, 17.5], [10.6, 15.6], [8, 12.6], [5.4, 9.2], [9.6, 7.8], [8, 4.9]],
  narrows: [[13.2, 23.4], [13.2, 17.8], [8, 17.6], [2.6, 17.2], [2.6, 11.6], [8, 9.6], [8, 6.4], [8, 3.9]],
  blades: [[9, 23.8], [5.4, 19.6], [5.8, 14.0], [9, 11.4], [6.6, 8.6], [9, 4.2]],
  ember: [[6.2, 25.8], [9, 21.8], [9, 16.6], [9, 13.0], [6.4, 9.6], [9, 4.2]],
};

function play(index) {
  const def = CHAMBERS[index];
  const game = new Game({}, { d0, chamber: index });
  const sim = game.sim, inp = game.input, route = ROUTES[def.name];
  let wp = 0, t = 0, best = 1e9, bestT = 0, mode = 'steer', modeT = 0, bursts = 0, supple = 0;
  const startMass = sim.playerMass();
  const log = [];
  while (t < 70) {
    const b = sim.primary, cx = sim.bCx[b], cy = sim.bCy[b];
    const [tx, ty] = route[Math.min(wp, route.length - 1)];
    const dx = tx - cx, dy = ty - cy, d = Math.hypot(dx, dy);
    const last = wp >= route.length - 1;
    if (!last && d < 1.3) { wp++; best = 1e9; bestT = t; mode = 'steer'; continue; }
    if (d < best - 0.4) { best = d; bestT = t; if (mode !== 'steer') mode = 'steer'; }
    const stuck = t - bestT;
    if (mode === 'steer' && stuck > 2.5 && !last) { mode = 'supple'; modeT = t; supple++; }
    if (mode === 'supple' && t - modeT > 2.2) { mode = 'burst'; modeT = t; }
    const m = last ? Math.min(1, d / 1.2) : Math.min(1, 0.45 + d / 2);
    inp.x = (dx / (d + 1e-6)) * m; inp.y = (dy / (d + 1e-6)) * m;
    inp.dialValue = mode === 'supple' ? -1 : 0;
    if (mode === 'burst') { game._burst(dx / d, dy / d, 0.6); bursts++; mode = 'steer'; bestT = t; }
    game.update(1 / 60, 2, 1 / 120); t += 1 / 60;
    if (verbose && Math.round(t * 60) % 60 === 0) log.push(`${t.toFixed(0)}s wp${wp} d=${d.toFixed(1)} ${mode} pieces=${sim.nComps} mine=${sim.playerMass()} calyx=${game.calyx.inside.toFixed(2)}`);
    if (game.state === 'exit' || game.index !== index) break;
  }
  const done = game.state === 'exit' || game.index !== index;
  if (verbose) console.log(log.join('\n'));
  console.log(`${def.name.padEnd(8)} ${done ? 'DONE' : 'STUCK'} in ${t.toFixed(1)}s  waypoint ${wp}/${route.length - 1}  mass ${startMass} → ${sim.playerMass()}  bursts ${bursts}  supple ${supple}  pieces ${sim.nComps}`);
  return done;
}

const list = only !== undefined ? [+only] : CHAMBERS.map((_, k) => k);
let ok = 0;
for (const k of list) ok += play(k) ? 1 : 0;
console.log(`${ok}/${list.length} chambers finished`);
process.exit(0);
