# Hyaline

A game about a formless, living gel. **Pass 1:** the physics core and a minimum playable loop.

```
npm start                 # serves the game; open the printed address on a phone (same network)
npm test                  # the laws, as tests (31 of them, ~1 min)
npm run play              # autopilot plays every chamber headless and reports
npm run lab -- <scenario> # one experiment, with metrics and a contact sheet (OUT=dir)
```

URL options: `?dev` (performance readout), `?c=2` (start in chamber 3), `?d0=0.1` (force resolution).

## Playing

One thumb, anywhere. A stick appears under it.

| Gesture | What it does |
|---|---|
| nudge | the front reaches out as a pseudopod while the body anchors; let go and it comes home |
| full throw | the whole body travels — the core streams ahead of the flanks, so it circulates as it goes |
| flick and release | burn some of yourself for a burst (mass becomes speed) |
| tap yourself | press a fingertip in — it dimples and rings back |
| tap a stray piece | become that piece |
| second finger | the **dial**: down = firm (bead up, hold, call strays home); slide it down = supple (run, wet, reach, draw out long) |

Desk: WASD/arrows, Space firm, C supple, Shift/E burst, right mouse = second finger.

The loop: arrive (as scattered dew that finds itself), take in amber nutrient (real gel you touch and
assimilate), get through the dish, seat most of yourself in the calyx. Mass carries into the next
dish. Four chambers teach by touch: *cradle* (you have no shape), *narrows* (a trap that tightens, a
slit), *blades* (a razor parts you, a healing pool re-joins you, a sink drinks you), *ember* (oil that
will not mix, heat that loosens you, a grate finer than any shape).

## The engine (`src/sim/`)

Clear slime is a transient polymer network — long chains held by crosslinks that keep forming,
stretching, forgetting and breaking. The solver is that, nearly literally:

| File | Holds |
|---|---|
| `substances.js` | what matter is made of: network (links, stiffness, τ, yield, break strain, strand length), cohesion, chemistry (polarity → affinity, kinship), optics |
| `surfaces.js` | what walls are made of: tack, grip, friction, restitution, wetting, sharpness, abrasion, coating, heat, drink |
| `world.js` | SDF geometry; **zones** (local law: viscosity, drag, tension, tack, fusion, healing, burn price, heat, gravity); **fields** (wells, white holes, vortices) |
| `continuum.js` | the solver |

Matter is equal-area particles, so **particle count is area is mass**. One continuum holds every
piece of every kind of matter in the dish; a *piece* is simply what the bond network holds together.
Integration is position-based (XPBD): two substeps per 120 Hz tick, one constraint pass each.

### The laws

1. **The network.** Neighbours hold each other by bonds — elastic at once (jiggle, recoil), forgetting
   their length over τ (wait, and it flows), yielding past a strain, snapping when yanked, thinning
   into strands when drawn slowly until nothing is left. A crosslink has a natural size; in the
   flowing bulk, links that drift apart dissolve quietly (turnover), while a strand parts at one place
   and its ends recoil (no dust).
2. **Incompressible.** A density constraint holds every particle's area: it pushes apart everywhere
   (contact between pieces is just that) and pulls together only in a piece's own bulk, up to a tensile
   limit. A wall counts as matter beside a particle as far as it is wetted.
3. **Cohesion at every scale.** Exact capillary modes per body — l = 2 as an affine field, l = 3…8 as
   harmonic potential flows read from the outer surface r(θ), each at ω² = σ·l(l²−1)/R³, damped harder
   the finer — plus a local mean-curvature projection, a gather of overflow, and a fill that closes
   holes. All of it is momentum-neutral; all of it reads only the body's *free* matter (what a hand,
   a trap or the will holds is not rounded), and fades as more of the body is held — so a held body
   necks into a strand instead of bulging.
4. **Fusion is a rate, never a rule.** Bonds form across two pieces at a rate gated by substance
   affinity, kinship, both skins (fresh cuts resist), the medium (healing baths draw, repellent media
   push apart before contact), contact pressure and closing speed. Uncut matter of one lineage re-knits
   as fast as it heals. Fusion is crosslink exchange: an interface may take spare bond slots.
5. **Walls** are independent axes: tangential friction, and tack as compliant anchors — wetting
   anchors slide along slick glass and resist only leaving it; gripping ones hold fast and tighten
   with dwell. Plus sharp (blades cut bonds and skin both faces), abrasive, coating, heat, drink. A wall
   gives back only what came at it.
6. **The will** recruits the leading cap (a nudge: a pseudopod, the rest anchored, the cortex relaxed)
   or the whole body (a full throw: fountain flow — core faster than flanks). It never drives matter
   into a wall that blocks it and stops adding pressure where the gel is already squeezed (no jets).
7. **Strays come home** down a geodesic field (a flood fill round the walls from "me"), loosened so
   they can squeeze through what they must, pressing gently until they knit.
8. **Temperature** diffuses through the network and bends rheology: warm runs and draws further; cold
   holds, and turns brittle.
9. **Mass–energy.** A burst spends mass: ½(n−k)v² = c²k. Grit, drinking walls and wells take mass;
   nutrient adds it. No lineage goes below its floor — near it, what is left becomes a hard seed.
10. **Breathing.** Multi-scale Gaussian lobes modulate each particle's rest area, zero-mean per body.

`hold(x, y, r)` / `moveHold` / `releaseHold` take hold of matter like a fingertip (the basis for a
sculpting mode).

### Where the feel comes from (if you tune it)

| Behaviour | Controlled by |
|---|---|
| wobble frequency / ringing | `PARAMS.tension` (2 Hz for the starting body), `shapeZeta`, `modeZeta` |
| lumps, dents, holes | `surfRate`, `gather`, `fill`, `modeMax` |
| elastic memory vs. flow | substance `tau`, `yieldStrain`, `stiff`, `links` |
| strands, snap, recoil | substance `breakStrain`, `strandLen`; `bondDamp` |
| pseudopod / travel | `wU0/wU1`, `anchor`, `pump`, `fluid`, `relaxT`, `fountain`, `reach`, `drive` |
| slick vs tacky | surface `friction` / `tack` / `grip`, `anchorK`, `anchorReach`; substance `slip` / `tack` / `wet` |
| incompressibility | `relax` (≤ 0.65 — a Jacobi pass rings beyond), `substeps`, `tensile` |

## Renderer (`src/gfx/`)

Nothing is painted on. Each particle splats an anisotropic kernel whose integral is exactly one
particle's area (so the area you see is the mass that is there); stretched bonds are drawn as
filaments whose width conserves their matter. The composite treats clear gel as a lens: the slide is
magnified through it (with a ~1.5 % dispersion fringe), a soft window reflects in its curved top
(Fresnel), the steep margin traps light (a darker TIR band inside a bright rim), a caustic lands on the
slide on the far side from the light, and absorption (Beer–Lambert by concentration) colours only
what is thick — so a deep bead glows in its own hue and a film all but vanishes. Strain shimmers
(photoelasticity), cut faces frost, fresh matter glows, unfused pieces show a seam of light.

## Tests and tools

- `tests/physics.test.mjs` — 31 laws, measured the way a player would see them: area under
  squeezing, momentum (no self-propulsion, even while rounding), slab → bead, 2 Hz ringing, holes heal,
  pseudopod reach and return, fountain flow, no hollowing under a wiggling thumb, strays home round a
  wall, the full fusion matrix, slow vs fast strands, nutrient, burst & floor, grit, seed, wells, poke,
  slick glass, tacky peel, razor, dial, heat, abuse, determinism.
- `tests/play.mjs` — autopilot playthrough of every chamber.
- `tests/lab.mjs` — scenarios (`prof rest round jiggle drive gap wall strand razor meet eat abuse film`)
  with contact sheets (modes: body piece kin strain skin heat sub will rho flow dots bonds).
- `tools/shot.mjs` — drives the real page in headless Chrome:
  `node tools/shot.mjs seq out seq="f200 s0.3,-1 f60 shot" zoom=7 dpr=2`, or `auto out c=0` (autopilot).

## Performance

A boot benchmark times the real solver (warmed up) and picks the particle spacing whose full-size body
costs ~4.5 ms of each 60 Hz frame (≈ 700–1850 particles). The frame loop gives up render resolution
before smoothness. On the slow datacenter vCPU used for development, ~1000 particles cost ~6 ms per
frame; a modern phone core is several times faster.

## Not yet (deliberately out of this pass)

Picture-in-picture views of distant fragments, rival organisms with their own wills, pull-back
charging, a two-finger sculpting mode (the engine's `hold` is ready for it), more chambers and modes.
