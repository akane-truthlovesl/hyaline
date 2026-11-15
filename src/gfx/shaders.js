// GLSL ES 3.00. Everything the eye sees of matter is derived from three fields, never painted:
//   F  (field 0 .r)     is matter here?           — the ½-isocontour is the silhouette
//   Σ  (field 0 .gba)   what it absorbs, per unit thickness, summed by concentration — so a
//                       mixture of substances is coloured exactly as Beer–Lambert says
//   S  (field 1)        its strain, its cut skin, its glow, and which piece it belongs to
//   T  (blurred F)      how much of it is piled up here: the optical thickness

export const VS_FULL = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// ── the dish: substrate, walls, zones of different medium ─────────────────────────────────
export const FS_SCENE = `#version 300 es
precision highp float;
uniform sampler2D uSdf; uniform sampler2D uMat;
uniform vec4 uView;      // centre xy, half extent xy (world)
uniform vec2 uWorld;     // world size
uniform float uTime; uniform float uPx;   // world units per pixel
uniform vec3 uTint[16];  // surface materials
uniform int uZn;
uniform vec4 uZa[8];     // type, x, y, soft
uniform vec4 uZb[8];     // circle: r | box: hw, hh, round | capsule: x2, y2, r
uniform vec4 uZc[8];     // tint, strength
in vec2 vUv; out vec4 o;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

vec3 substrate(vec2 p) {
  // slow pools of light under the glass
  float pool = 0.5 + 0.5 * sin(p.x * 0.23 + 1.3 * sin(p.y * 0.17 + 0.4)) * sin(p.y * 0.21 + 1.7 + 0.8 * sin(p.x * 0.13));
  vec3 c = mix(vec3(0.010, 0.015, 0.026), vec3(0.016, 0.044, 0.058), pool);
  // graticule: a triangular lattice of faint points etched into the slide — something fine
  // for a lens to bend
  vec2 g = p / 0.36; g.y /= 0.866;
  float row = floor(g.y); g.x += 0.5 * mod(row, 2.0);
  vec2 cell = floor(g), f = fract(g) - 0.5; f.y *= 0.866;
  float tw = 0.65 + 0.35 * sin(uTime * 0.7 + 6.283 * hash(cell));
  float r = length(f) * 0.36, aa = uPx * 1.2;
  c += vec3(0.06, 0.15, 0.17) * (smoothstep(0.03 + aa, 0.03 - aa, r) * tw * (0.45 + 0.75 * pool));
  // survey rings every two units
  float ring = abs(fract(length(p - uWorld * 0.5) / 2.0) - 0.5) * 2.0;
  c += vec3(0.016, 0.036, 0.046) * smoothstep(aa * 1.5 + 0.012, 0.004, ring);
  // dust adrift far below the focal plane
  vec2 q = p * 0.55 + vec2(uTime * 0.012, uTime * 0.007);
  vec2 qc = floor(q), qf = fract(q);
  float h = hash(qc + 7.1);
  vec2 dp = qf - vec2(0.2 + 0.6 * hash(qc + 1.7), 0.2 + 0.6 * hash(qc + 3.3));
  c += vec3(0.04, 0.07, 0.09) * (step(0.62, h) * smoothstep(0.17, 0.0, length(dp)) * 0.55);
  return c;
}

float zoneSd(int k, vec2 p) {
  vec4 a = uZa[k], b = uZb[k];
  if (a.x < 0.5) return length(p - a.yz) - b.x;
  if (a.x < 1.5) { vec2 d = abs(p - a.yz) - (b.xy - b.z); return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - b.z; }
  vec2 pa = p - a.yz, ba = b.xy - a.yz;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * t) - b.z;
}

void main() {
  vec2 p = uView.xy + (vUv * 2.0 - 1.0) * uView.zw * vec2(1.0, -1.0);
  vec2 suv = p / uWorld;
  float d = texture(uSdf, suv).r;
  // beyond the baked field is solid wall, deeper the further out
  vec2 out2 = max(-p, p - uWorld);
  float beyond = max(out2.x, out2.y);
  if (beyond > 0.0) d = min(d, -beyond - 0.05);
  int m = int(floor(texture(uMat, suv).r * 255.0 + 0.5));
  vec3 tint = uTint[clamp(m, 0, 15)];
  vec3 c = substrate(p);
  float aa = uPx * 1.25;
  // the medium itself: a zone is seen as the light it bends and holds
  for (int k = 0; k < 8; k++) {
    if (k >= uZn) break;
    float zd = zoneSd(k, p), s = max(uZa[k].w, 0.05);
    float inside = smoothstep(s, -s, zd);
    float edge = exp(-abs(zd) / (0.05 + aa)) * 0.6;
    float swirl = 0.75 + 0.25 * sin(p.x * 2.1 + p.y * 1.7 + uTime * 0.6 + float(k));
    c += uZc[k].rgb * uZc[k].a * (inside * 0.22 * swirl + edge * 0.35);
  }
  // contact shadow and a breath of the wall's own light on the slide
  c *= 1.0 - 0.45 * exp(-max(d, 0.0) / 0.3);
  c += tint * 0.03 * exp(-max(d, 0.0) / 0.55);
  // the wall body: dark glass, lighter toward its bevel
  float inside = smoothstep(aa, -aa, d);
  vec3 wall = mix(vec3(0.028, 0.040, 0.055), vec3(0.058, 0.078, 0.10), smoothstep(-0.55, 0.0, d));
  wall += tint * (0.05 * smoothstep(-0.5, 0.0, d));
  if (m == 1) wall += tint * 0.06 * (0.5 + 0.5 * sin(p.x * 9.0 + p.y * 7.0 + uTime * 0.8));   // tack glistens
  if (m == 4 || m == 7) wall += vec3(0.05) * hash(floor(p * 28.0));                         // grit, pores
  c = mix(c, wall, inside);
  // the edge catches the light: a thin luminous rim, as in dark-field
  float rim = exp(-abs(d) / (0.022 + aa));
  c += tint * rim * (m == 3 ? 1.5 : 0.55);
  o = vec4(c, 1.0);
}`;

// ── sprites in the dish (the calyx, wells): additive, refracted like everything else ───────
export const VS_SPRITE = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPosSize;    // x, y, radius, kind
layout(location=2) in vec4 aColor;      // rgb, phase
uniform vec4 uView;
out vec2 vQ; out vec4 vColor; out float vKind;
void main() {
  vQ = aCorner; vColor = aColor; vKind = aPosSize.w;
  vec2 p = aPosSize.xy + aCorner * aPosSize.z;
  vec2 c = (p - uView.xy) / uView.zw;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
export const FS_SPRITE = `#version 300 es
precision highp float;
uniform float uTime;
in vec2 vQ; in vec4 vColor; in float vKind; out vec4 o;
void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  vec3 c;
  if (vKind < 1.5) {                      // calyx: a ring that fills
    float a = atan(vQ.y, vQ.x);
    float ring = smoothstep(0.035, 0.0, abs(r - 0.86));
    float inner = smoothstep(0.02, 0.0, abs(r - 0.70)) * 0.35;
    float petals = 0.55 + 0.45 * sin(a * 12.0 + uTime * 0.6);
    float fill = step(fract(a / 6.2832 + 0.25), vColor.a);       // progress, clockwise from the top
    float glow = pow(max(0.0, 1.0 - r), 2.0) * (0.10 + 0.5 * vColor.a);
    c = vColor.rgb * (ring * (0.35 * petals + 1.6 * fill) + inner * petals + glow);
  } else {                                // soft glow (a well's pull made visible)
    c = vColor.rgb * pow(1.0 - r, 2.0) * vColor.a;
  }
  o = vec4(c, 1.0);
}`;

// ── the fields: one shaped kernel per particle, one capsule per drawn thread ───────────────
export const VS_SPLAT = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aCA;         // centre, major axis vector
layout(location=2) in vec4 aB;          // minor radius, amplitude, σr, σg
layout(location=3) in vec4 aC;          // σb, strain, skin, glow
layout(location=4) in float aD;         // piece
uniform vec4 uView;
out vec2 vQ; out vec4 vA; out vec4 vS;
void main() {
  vec2 ax = aCA.zw; float al = length(ax);
  vec2 bx = vec2(-ax.y, ax.x) / max(al, 1e-6) * aB.x;
  vec2 p = aCA.xy + ax * aCorner.x + bx * aCorner.y;
  vQ = aCorner;
  vA = aB.y * vec4(1.0, aB.z, aB.w, aC.x);
  vS = aB.y * vec4(aC.y, aC.z, aC.w, aD);
  vec2 c = (p - uView.xy) / uView.zw;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
export const FS_SPLAT = `#version 300 es
precision highp float;
uniform float uGain;
in vec2 vQ; in vec4 vA; in vec4 vS;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main() {
  float t = 1.0 - dot(vQ, vQ);
  if (t <= 0.0) discard;
  float k = t * t * t * uGain;
  o0 = vA * k; o1 = vS * k;
}`;
export const VS_THREAD = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aAB;         // endpoints
layout(location=2) in vec4 aW;          // half width, amplitude, σr, σg
layout(location=3) in vec3 aC;          // σb, strain, piece
uniform vec4 uView;
out vec2 vL; out float vLen; out vec4 vA; out vec4 vS;
void main() {
  vec2 d = aAB.zw - aAB.xy; float L = length(d); vec2 t = d / max(L, 1e-6), n = vec2(-t.y, t.x);
  float W = aW.x * 2.0;                                  // kernel radius: crosses ½ at the half width
  float along = mix(-W, L + W, aCorner.x * 0.5 + 0.5);
  vec2 p = aAB.xy + t * along + n * (aCorner.y * W);
  vL = vec2(along, aCorner.y * W) / W; vLen = L / W;
  vA = aW.y * vec4(1.0, aW.z, aW.w, aC.x);
  vS = aW.y * vec4(aC.y, 0.0, 0.0, aC.z);
  vec2 c = (p - uView.xy) / uView.zw;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
export const FS_THREAD = `#version 300 es
precision highp float;
uniform float uGain;
in vec2 vL; in float vLen; in vec4 vA; in vec4 vS;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main() {
  float x = vL.x - clamp(vL.x, 0.0, vLen);
  float t = 1.0 - (x * x + vL.y * vL.y);
  if (t <= 0.0) discard;
  float k = t * t * t * uGain;
  o0 = vA * k; o1 = vS * k;
}`;

// ── T: how much matter is piled up around here (a wide blur of F) ──────────────────────────
export const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uStep; uniform float uClamp, uLod, uGainInv;
in vec2 vUv; out vec4 o;
void main() {
  float w[5] = float[5](0.2042, 0.1802, 0.1238, 0.0663, 0.0276);
  float s = min(textureLod(uTex, vUv, uLod).r * uGainInv, uClamp) * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 d = uStep * float(i);
    s += (min(textureLod(uTex, vUv + d, uLod).r * uGainInv, uClamp) + min(textureLod(uTex, vUv - d, uLod).r * uGainInv, uClamp)) * w[i];
  }
  o = vec4(s, 0.0, 0.0, 1.0);
}`;

// ── matter, as optics ──────────────────────────────────────────────────────────────────────
// Clear gel on a dark slide is seen almost entirely through what it does to light: it lenses the
// slide beneath (magnifying, with a little dispersion at the rim), reflects a soft room in its
// curved top (Fresnel: a glint, strongest at grazing edges), traps light at its steep margin
// (total internal reflection: a darker band just inside a bright rim), focuses light onto the
// slide (a caustic), and absorbs only where it is thick — so colour blooms in the deep core and
// a thin film all but vanishes.
export const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uField0, uField1, uThick, uScene;
uniform vec2 uFieldTexel, uThickTexel;
uniform vec4 uView;
uniform float uTime, uFirm, uPx, uFlash, uGainInv;
uniform vec2 uRes;
in vec2 vUv; out vec4 o;

const vec3 KEY = vec3(-0.48, 0.58, 0.66);     // a soft window, up and to the left
const vec3 FILL = vec3(0.70, -0.42, 0.58);    // a cool bounce from the lower right

float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

// the room the gel reflects: dark, one broad soft window, a cooler bounce, a faint floor glow
vec3 environment(vec3 r) {
  vec3 k = normalize(KEY), f = normalize(FILL);
  float kd = dot(r, k), fd = dot(r, f);
  // the window is a rounded rectangle of light, not a dot: its reflection becomes a soft band
  // that slides along the curvature
  vec3 t1 = normalize(cross(k, vec3(0.0, 0.0, 1.0))), t2 = cross(k, t1);
  vec2 q = vec2(dot(r, t1), dot(r, t2)) / max(kd, 0.05);
  float win = smoothstep(0.27, 0.15, length(max(abs(q) - vec2(0.12, 0.03), 0.0))) * step(0.0, kd);
  vec3 c = vec3(1.0, 0.98, 0.95) * win * 6.5;
  c += vec3(0.85, 0.95, 1.0) * smoothstep(0.30, 0.95, kd) * 0.10;
  c += vec3(0.30, 0.85, 1.0) * smoothstep(0.86, 0.985, fd) * 0.55;
  c += mix(vec3(0.020, 0.045, 0.070), vec3(0.004, 0.008, 0.016), clamp(r.z, 0.0, 1.0));
  return c;
}

vec3 finish(vec3 c, vec2 uv) {
  vec2 v = uv - 0.5;
  c *= 1.0 - 0.5 * dot(v, v);
  c += uFlash;
  c = c / (1.0 + 0.32 * c);                              // soft shoulder
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  c += (hash(uv * uRes + fract(uTime) * 61.0) - 0.5) / 255.0;   // dither the dark gradients
  return c;
}

float piece(vec2 uv) { vec4 a = texture(uField0, uv), b = texture(uField1, uv); return b.a / max(a.r, 1e-4); }
// the surface is shaped from F a mip down (the grain between particles must not become lenses)
float Fs(vec2 uv) { return textureLod(uField0, uv, 1.0).r * uGainInv; }

void main() {
  vec4 f0 = texture(uField0, vUv) * uGainInv, f1 = texture(uField1, vUv) * uGainInv;
  float Fm = Fs(vUv);
  float F = mix(f0.r, Fm, 0.45);                         // silhouette: a touch smoothed, never faceted
  float T = texture(uThick, vUv).r;
  vec3 scene = texture(uScene, vUv).rgb;
  vec2 w2 = 2.0 * uView.zw;                              // world size of the view

  // what the gel does to the slide around it: a soft shadow away from the key light, and the
  // light it focuses landing on the far side of it
  float sh = texture(uThick, vUv + vec2(-0.20, 0.24) / w2).r;
  float cau = texture(uThick, vUv + vec2(-0.34, 0.40) / w2).r;
  scene *= 1.0 - 0.30 * smoothstep(0.05, 0.8, sh);
  scene += vec3(0.05, 0.11, 0.12) * smoothstep(0.35, 0.95, cau) * (1.0 - smoothstep(0.3, 0.6, F));

  if (F < 0.36) { o = vec4(finish(scene, vUv), 1.0); return; }

  // gradients of both fields, in world units (y up on screen)
  vec2 e = uFieldTexel * 2.0, et = uThickTexel * 1.5;
  float Fl = Fs(vUv - vec2(e.x, 0.0)), Fr = Fs(vUv + vec2(e.x, 0.0));
  float Fd = Fs(vUv - vec2(0.0, e.y)), Fu = Fs(vUv + vec2(0.0, e.y));
  float Tl = texture(uThick, vUv - vec2(et.x, 0.0)).r, Tr = texture(uThick, vUv + vec2(et.x, 0.0)).r;
  float Td = texture(uThick, vUv - vec2(0.0, et.y)).r, Tu = texture(uThick, vUv + vec2(0.0, et.y)).r;
  vec2 gF = vec2(Fr - Fl, Fu - Fd) / (2.0 * e * w2);
  vec2 gT = vec2(Tr - Tl, Tu - Td) / (2.0 * et * w2);
  float lapT = (Tl + Tr + Td + Tu - 4.0 * T) / dot(et * w2, et * w2) * 2.0;

  // the top surface: a meniscus rising steeply from the contact line, then a dome as tall as
  // the matter gathered beneath it
  float s = clamp((min(F, Fm) - 0.5) * 3.0, 0.0, 1.0);
  float sc = max(s, 0.05);
  float prof = sqrt(sc * (2.0 - sc));
  float dprof = 1.5 * (1.0 - sc) / prof;
  float dome = 0.14 + 1.15 * T * T;
  float z = prof * dome;
  vec2 gz = dprof * dome * gF + prof * 2.3 * T * gT;
  float gl = length(gz);
  if (gl > 3.5) gz *= 3.5 / gl;
  vec3 n = normalize(vec3(-gz, 1.0));

  // refraction: the slide seen through a lens — magnified toward the thick middle, each colour by
  // its own amount (a faint spectral fringe where the surface is steep)
  vec2 off = gz * (0.10 + 0.55 * z);
  vec2 ou = off / w2;
  vec3 bg = vec3(texture(uScene, vUv + ou * 0.985).r, texture(uScene, vUv + ou).g, texture(uScene, vUv + ou * 1.018).b);

  // what is absorbed on the way down to the slide and back up (Beer–Lambert, by concentration)
  vec3 sigma = f0.gba / max(f0.r, 1e-3);
  float path = 2.0 * z + 0.06;
  vec3 trans = exp(-sigma * path * 0.32);
  // steep margin: light from below cannot leave there (total internal reflection) — a darker band
  float tir = mix(0.55, 1.0, smoothstep(0.25, 0.70, n.z));
  vec3 through = bg * trans * tir;

  // light gathered inside: a lens focuses the room onto the slide under its thick middle, and the
  // gel scatters a little of it back up, tinted by what it does not absorb
  float focus = clamp(-lapT * 0.035, 0.0, 1.0) * smoothstep(0.25, 0.9, T);
  // (what it scatters is what it does not absorb: a thick bead glows softly in its own hue)
  vec3 tint = exp(-sigma * 1.6);
  vec3 inner = tint * (0.022 + 0.11 * focus) * (1.0 - exp(-z * 1.4)) * (0.65 + 0.35 * dot(n, normalize(KEY)));

  // reflection of the room (water-like, F0 ≈ 0.02), brighter when it holds itself firm
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(n.z, 0.0, 1.0), 5.0);
  vec3 refl = environment(r) * fres * (1.0 + 0.4 * uFirm);
  // the lit rim: steep flanks catch the room
  vec3 rim = vec3(0.45, 0.88, 1.0) * pow(1.0 - n.z, 3.0) * 0.30;

  // photoelasticity: stressed gel is birefringent — in open light, only a faint shimmer where a
  // thread is close to letting go, never a rainbow on the bulk
  float st = f1.r / max(F, 1e-3);
  float ret = st * (0.4 + z) * 2.4;
  vec3 fringe = 0.5 - 0.5 * cos(6.2832 * ret * vec3(1.0 / 0.66, 1.0 / 0.55, 1.0 / 0.45));
  vec3 stress = fringe * smoothstep(0.38, 0.75, st) * 0.12 * (1.2 - prof);

  // a cauterised face is frosted until it heals
  float skin = clamp(f1.g / max(F, 1e-3), 0.0, 1.0);
  vec3 frost = vec3(0.75, 0.84, 0.90) * skin * 0.16 * (0.4 + 0.6 * prof);

  // what it glows with: freshly taken-in matter, nutrient, heat — deep in the core, clear at the rim
  float glow = f1.b / max(F, 1e-3);
  // (deep and saturated where thick, translucent toward the rim: a jewel of its own colour)
  vec3 emit = exp(-sigma * (0.55 + 1.3 * z)) * glow * (0.10 + 1.7 * z) * (0.75 + 0.25 * dot(n, normalize(KEY)));

  // two pieces that touch but have not fused: a film of medium between them, a seam of light
  float pl = piece(vUv - vec2(e.x, 0.0)), pr = piece(vUv + vec2(e.x, 0.0));
  float pd = piece(vUv - vec2(0.0, e.y)), pu = piece(vUv + vec2(0.0, e.y));
  float seam = smoothstep(0.03, 0.12, max(abs(pr - pl), abs(pu - pd))) * smoothstep(0.6, 1.0, min(min(Fl, Fr), min(Fd, Fu)));
  vec3 film = vec3(0.55, 0.88, 0.95) * seam * 0.5;

  vec3 gel = through * (1.0 - 0.55 * seam) + inner + refl + rim + stress + frost + emit + film;

  float aa = clamp(fwidth(F) * 0.85, 0.003, 0.2);
  float mask = smoothstep(0.5 - aa, 0.5 + aa, F);
  o = vec4(finish(mix(scene, gel, mask), vUv), 1.0);
}`;

// ── carried inside: micro-bubbles that lens the light, flecks that glint as the flow turns them ──
export const VS_MOTE = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPV;         // position, velocity
layout(location=2) in vec2 aSS;         // seed, spin
uniform vec4 uView; uniform sampler2D uField0, uThick; uniform float uPx, uTime, uGainInv;
out vec2 vQ; out vec3 vCol; out float vKind;
void main() {
  vec2 c0 = (aPV.xy - uView.xy) / uView.zw; c0.y = -c0.y;
  vec2 uv = c0 * 0.5 + 0.5;
  vec4 f0 = textureLod(uField0, uv, 0.0) * uGainInv;
  float F = f0.r, T = textureLod(uThick, uv, 0.0).r;
  float seed = aSS.x;
  float kind = seed < 0.5 ? 0.0 : seed < 0.85 ? 1.0 : 2.0;      // fleck, bubble, filament
  vec2 v = aPV.zw; float sp = length(v);
  vec2 dir = sp > 0.05 ? v / sp : vec2(1.0, 0.0);
  float size = uPx * (kind < 0.5 ? 1.2 : kind < 1.5 ? 1.5 + 1.5 * fract(seed * 7.3) : 0.8);
  float stretch = kind > 1.5 ? 2.0 + min(sp * 0.9, 5.0) : 1.0 + min(sp * 0.2, 1.6);
  vec2 p = aPV.xy + dir * (aCorner.x * size * stretch) + vec2(-dir.y, dir.x) * (aCorner.y * size);
  vQ = aCorner; vKind = kind;
  // a fleck glints when its face turns to the light; the turning is the flow's own rotation
  float glint = kind < 0.5 ? pow(0.5 + 0.5 * sin(aSS.y * 3.0 + seed * 40.0), 8.0) * 2.0 + 0.12 : 0.6;
  float inside = smoothstep(0.6, 0.95, F) * smoothstep(0.08, 0.45, T);
  vec3 sigma = f0.gba / max(F, 1e-3);
  vec3 tint = exp(-sigma * 0.35);                        // seen through the matter around it
  vCol = tint * glint * inside * (kind > 1.5 ? 0.09 : 0.40);
  vec2 c = (p - uView.xy) / uView.zw;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
export const FS_MOTE = `#version 300 es
precision highp float;
in vec2 vQ; in vec3 vCol; in float vKind; out vec4 o;
void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  float a;
  if (vKind > 0.5 && vKind < 1.5) {
    // a micro-bubble is a tiny diverging lens: a dark rim, light pooled off-centre toward the key
    float rim = smoothstep(1.0, 0.75, r) * smoothstep(0.35, 0.8, r);
    float core = smoothstep(0.45, 0.0, length(vQ - vec2(-0.3, 0.3)));
    a = core * 0.9 - rim * 0.25;
  } else a = pow(1.0 - r, 2.0);
  o = vec4(vCol * a, 1.0);
}`;

// ── mass leaving existence: burnt, ground away, drunk ──────────────────────────────────────
export const VS_MIST = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPLK;        // position, life, kind
uniform vec4 uView; uniform float uPx;
out vec2 vQ; out vec3 vCol;
void main() {
  float life = clamp(aPLK.z * 2.2, 0.0, 1.0);
  float size = uPx * (1.6 + 4.0 * (1.0 - life));
  vec2 p = aPLK.xy + aCorner * size;
  vQ = aCorner;
  vCol = (aPLK.w < 0.5 ? vec3(0.55, 0.95, 1.0) : aPLK.w < 1.5 ? vec3(1.0, 0.75, 0.5) : vec3(0.7, 0.95, 0.5)) * life * 0.5;
  vec2 c = (p - uView.xy) / uView.zw;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;
export const FS_MIST = `#version 300 es
precision highp float;
in vec2 vQ; in vec3 vCol; out vec4 o;
void main() { float r = length(vQ); if (r > 1.0) discard; o = vec4(vCol * pow(1.0 - r, 2.0), 1.0); }`;
