// SUBSTANCES — what matter is made of.
//
// Every rheological, chemical and optical quantity the solver uses is looked up per substance,
// then bent per particle by its temperature, its surface state, the medium it sits in and — for
// living matter only — the will of whoever it belongs to. Nothing in the engine assumes there is
// only one kind of stuff.
//
// The rheology is a transient network (what clear slime actually is: long chains held by
// crosslinks that keep forming and breaking). Its numbers:
//   links        how many neighbours each particle bonds to. In 2D a central-force network turns
//                rigid at four (the isostatic point): fewer is a liquid, more is a jelly.
//   stiff        how hard a bond springs back (× PARAMS.bondHz², the network's own frequency)
//   tau          how long a bond remembers its length: jelly when long, honey when short
//   yieldStrain  past this a bond stops arguing and flows (plastic)
//   breakStrain  yanked this far past its length at once, a bond snaps (fast pulls are brittle)
//   strandLen    drawn out slowly, a bond thins; at this length (× spacing) nothing is left of it
//   tension      cohesion at the scale of the whole body: how round, how fast it rings
// A slime, a melt, a jelly and an oil are the same law with different numbers.
//
// How two substances treat each other follows from chemistry, not a hand-filled table: polarity
// decides miscibility (like dissolves like), and any pair can be bent by an override. Kinship —
// which organism a piece of matter belongs to — is a separate axis: the very same substance owned
// by two different lineages is reluctant to fuse.

export const WILD = 0;      // matter that belongs to no one
export const PLAYER = 1;    // the lineage the thumb speaks for
export const MAXKIN = 8;

const DEFAULTS = {
  // ── cohesion
  tension: 1,         // body-scale surface tension (× PARAMS.tension)
  // ── the network
  links: 4,
  stiff: 1,
  tau: 0.9,
  yieldStrain: 0.5,
  breakStrain: 1.1,
  strandLen: 4.5,
  // ── dissipation
  visc: 1,            // shear damping inside a piece (× PARAMS.visc)
  drag: 1,            // drag of the medium on it
  // ── the bulk
  tensile: 1,         // how far below its rest density the bulk holds before it cavitates
  // ── contact with walls
  wet: 0.55,          // how it meets a wall: 0 beads up, 1 spreads flat
  tack: 1,            // how strongly it clings normally to a wall
  slip: 1,            // multiplier on tangential friction (0 = perfectly lubricated)
  // ── chemistry
  polarity: 0,        // like dissolves like
  kinCross: 0.04,     // willingness to fuse with the same matter of another lineage
  heal: 1,            // how quickly cut or passivated skin heals
  heatSens: 1,        // how strongly temperature changes its rheology
  assimilate: 0,      // fused into a living body, how fast it becomes part of it (1/s)
  becomes: -1,        // substance it turns into when assimilated (-1: the host's)
  // ── optics
  absorb: [2.3, 0.55, 0.42],   // Beer–Lambert absorption per unit thickness (rgb)
  ior: 1.0,           // refraction strength (× the renderer's base)
  glow: 0,            // emission
};

export const SUBSTANCES = [];
export const SUB = {};

export function defineSubstance(name, props) {
  const s = { ...DEFAULTS, ...props, name, id: SUBSTANCES.length };
  SUBSTANCES.push(s);
  SUB[name] = s.id;
  return s.id;
}

// The living gel. Crystal-clear, slick, faintly tacky; elastic for a heartbeat, liquid if you wait,
// drawing into long strands when pulled slowly, and always gathering itself back into a bead.
defineSubstance('myria', {
  tension: 1, links: 4, stiff: 1, tau: 0.9, yieldStrain: 0.5, breakStrain: 1.1, strandLen: 4.5,
  polarity: 0, kinCross: 0.04, wet: 0.4, absorb: [0.95, 0.24, 0.15],
});

// Nutrient: a sweeter, runnier gel that belongs to no one. Living matter that touches it takes it
// in and it becomes that matter; its colour lingers and swirls a while.
defineSubstance('amber', {
  tension: 0.8, links: 3, stiff: 0.5, tau: 0.35, yieldStrain: 0.3, breakStrain: 0.8, strandLen: 3.5,
  polarity: 0.12, kinCross: 1, assimilate: 1.6, visc: 0.8, wet: 0.5, absorb: [0.06, 0.55, 2.6], glow: 1.1,
});

// A foreign, oily gel. It does not mix with myria: the two press against each other as two beads
// with a film between them, and slide apart. Stiffer, more viscous, beads up on walls, and it
// never draws a strand — it parts cleanly.
defineSubstance('lipid', {
  tension: 1.3, links: 5, stiff: 1.4, tau: 1.6, yieldStrain: 0.6, breakStrain: 0.5, strandLen: 2.2,
  polarity: 1, kinCross: 1, visc: 2.2, wet: 0.15, tack: 0.15, slip: 0.4, absorb: [0.8, 1.4, 0.45], ior: 1.3,
});

// ── interactions, derived ───────────────────────────────────────────────────────────────────

const OVERRIDES = new Map();   // 'a|b' -> affinity
export function setAffinity(a, b, v) { OVERRIDES.set(`${a}|${b}`, v); OVERRIDES.set(`${b}|${a}`, v); }

// Flat typed-array views of every per-substance number, rebuilt whenever substances change, so
// the solver's inner loops index plain arrays.
export const CHEM = { n: 0 };
export function buildChemistry() {
  const n = SUBSTANCES.length;
  const f = (k) => Float32Array.from(SUBSTANCES, (s) => s[k]);
  Object.assign(CHEM, {
    n,
    tension: f('tension'), links: f('links'), stiff: f('stiff'), tau: f('tau'), yieldStrain: f('yieldStrain'),
    breakStrain: f('breakStrain'), strandLen: f('strandLen'),
    visc: f('visc'), drag: f('drag'), tensile: f('tensile'),
    wet: f('wet'), tack: f('tack'), slip: f('slip'), heal: f('heal'), heatSens: f('heatSens'),
    assimilate: f('assimilate'), glow: f('glow'), kinCross: f('kinCross'), ior: f('ior'),
    becomes: Int16Array.from(SUBSTANCES, (s) => s.becomes),
    absR: Float32Array.from(SUBSTANCES, (s) => s.absorb[0]),
    absG: Float32Array.from(SUBSTANCES, (s) => s.absorb[1]),
    absB: Float32Array.from(SUBSTANCES, (s) => s.absorb[2]),
  });
  const AFF = new Float32Array(n * n), KX = new Float32Array(n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const A = SUBSTANCES[a], B = SUBSTANCES[b];
    const dp = (A.polarity - B.polarity) / 0.45;
    const o = OVERRIDES.get(`${A.name}|${B.name}`);
    AFF[a * n + b] = o !== undefined ? o : Math.exp(-dp * dp);
    KX[a * n + b] = Math.min(A.kinCross, B.kinCross);
  }
  CHEM.AFF = AFF; CHEM.KX = KX;
  return CHEM;
}
buildChemistry();
