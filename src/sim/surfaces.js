// SURFACES — what walls are made of.
//
// A contact is never one friction number. Each surface sets independent axes, and each of
// them meets a matching property of the substance touching it (substances.js):
//
//   tack        normal adhesion: how hard a surface holds what wets it    (× substance tack)
//   grip        tack that grows the longer something rests on it — a trap
//   friction    tangential drag while in contact; 0 is lubricated glass    (× substance slip)
//   restitution normal speed handed back on impact
//   wet         multiplier on how far a substance spreads on it (its contact angle)
//   sharp       cauterises what it parts: the faces resist re-fusing
//   abrade      grinds mass away in proportion to sliding speed
//   coat        leaves a lubricating film on whatever slides over it
//   heat        the temperature it imposes on contact (-1 frost … +1 hot)
//   drink       drinks mass on contact, like a desiccant
//   tint        how it reads to the eye (the renderer's only use of this table)

const DEFAULTS = {
  tack: 1, grip: 0, friction: 0, restitution: 0, wet: 1, sharp: 0, abrade: 0, coat: 0,
  heat: 0, drink: 0, tint: [0.55, 0.85, 1.0],
};

export const SURFACES = [];
export const MAT = {};

export function defineSurface(name, props) {
  const s = { ...DEFAULTS, ...props, name, id: SURFACES.length };
  SURFACES.push(s);
  MAT[name.toUpperCase()] = s.id;
  return s.id;
}

defineSurface('glass',    { tack: 0.45 });                                                   // slick, faintly tacky
defineSurface('tacky',    { tack: 9, grip: 2.5, friction: 4, wet: 1.6, tint: [1.0, 0.62, 0.22] });  // a trap that tightens
defineSurface('slick',    { tack: 0, friction: 0, restitution: 0.55, wet: 0.2, coat: 0.6, tint: [0.78, 0.70, 1.0] });
defineSurface('razor',    { tack: 0, sharp: 1, wet: 0.5, tint: [1.0, 0.36, 0.52] });
defineSurface('abrasive', { tack: 0.4, friction: 9, abrade: 1, tint: [0.85, 0.80, 0.70] });
defineSurface('warm',     { tack: 1.2, heat: 1, wet: 1.2, tint: [1.0, 0.45, 0.25] });
defineSurface('frost',    { tack: 0.6, heat: -1, friction: 0.5, tint: [0.75, 0.92, 1.0] });
defineSurface('sponge',   { tack: 2, drink: 0.6, friction: 2, wet: 1.4, tint: [0.70, 0.85, 0.45] });

export const SURF = {};
export function buildSurfaces() {
  const f = (k) => Float32Array.from(SURFACES, (s) => s[k]);
  Object.assign(SURF, {
    n: SURFACES.length,
    tack: f('tack'), grip: f('grip'), friction: f('friction'), restitution: f('restitution'),
    wet: f('wet'), sharp: f('sharp'), abrade: f('abrade'), coat: f('coat'), heat: f('heat'),
    drink: f('drink'),
    tint: Float32Array.from(SURFACES.flatMap((s) => s.tint)),
  });
  return SURF;
}
buildSurfaces();
