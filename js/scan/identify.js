// Identification d'une carte dans une image (sans DOM) : utilisée par le worker et par le banc d'essai.
// guidé (caméra) : options de côtés autour du guide → descente choisie par la base (detect.search), départs
//                   géométriques compris (detect.seedCombos) → si le résultat est faible : options « porte-carte »
//                   et guide réduit ×0,8 (carte trop loin) → recentrage autour du meilleur quad
// sans guide (photo importée) : guides candidats (detect.proposals + guides centrés de 4 tailles, portrait et
//                   paysage) examinés comme des guides de caméra → recherche complète sur les meilleurs.
import { describe, warpRegion, rotate180, CW, CH, RATIO } from './describe.js';
import {
  smallImage, sideOptions, search, rectQuad, toSmall, fromSmall, GUIDE_H, proposals, rotations, displayQuad, guideHeight,
  seedCombos,
} from './detect.js';

// Réglages du détecteur (le banc d'essai peut les changer) : seeds = départs géométriques de la recherche
export const DETECT = { seeds: 6, recentre: 1.35, recentrePeaks: 3 };

// Seuils de décision (FINAL-scanner §5.4) ; calibrés avec tools/scan_bench.py calib (synthèse 750 photos,
// carte absente 450, 21 photos réelles) : « normale » d1 ≤ 1,10 et d2 − d1 ≥ 0,30 garde 100 % de précision partout
// et accepte 19/21 photos réelles ; plus strict ne fait guère baisser les fausses acceptations « carte absente »
// (paires de même illustration), mais beaucoup les acceptations réelles. Revérifié sur 709 photos réelles (QA-SCAN,
// tools/scan_bench.py photos) : aucune fausse acceptation ; assouplir (1,20 / 0,25) n'ajoute que 0,5–1 point.
export const T = {
  strong: 0.60, strongRatio: 0.60,     // acceptation sur une seule image
  normal: 1.10, margin: 0.30,          // acceptation confirmée par 2 des 3 dernières images
  retry: 0.80,                         // au-delà : options porte-carte et guide ×0,8
  lookalike: 0.45,                     // sosie connu à moins de d1 + 0,45 : départagé par la zone du numéro
  none: 1.45,                          // au-delà : aucune carte plausible (le choix montre le top 3 en deçà)
};

// ---------------------------------------------------------------------------------------------------------
// Image de travail en niveaux de gris (moyenne f×f) d'une zone de l'image

export function workGray(data, W, H, roi, f) {
  const [x0, y0, x1, y1] = roi, w = Math.floor((x1 - x0) / f), h = Math.floor((y1 - y0) / f);
  const g = new Float32Array(w * h), inv = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        let p = ((y0 + y * f + dy) * W + x0 + x * f) * 4;
        for (let dx = 0; dx < f; dx++, p += 4) s += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      }
      g[y * w + x] = s * inv;
    }
  }
  return { g, w, h, x0, y0, f };
}

const toWork = (wk, q) => q.map(([x, y]) => [(x - wk.x0) / wk.f, (y - wk.y0) / wk.f]);

// Descripteur d'un quad (coordonnées de l'image source) ; rot = carte à l'envers
function descOf(wk, q, rot) {
  const c = warpRegion(wk.g, wk.w, wk.h, toWork(wk, q));
  if (!c) return null;
  return describe(rot ? rotate180(c) : c);
}

function clampRoi(x0, y0, x1, y1, W, H) {
  return [Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0)), Math.min(W, Math.ceil(x1)), Math.min(H, Math.ceil(y1))];
}

// Objectif pour la descente : meilleure distance de la base (en d), avec cache des descripteurs.
function makeObjective(db, wk, img, state) {
  return qs => {
    const q = qs.map(p => fromSmall(img, p));
    const d = descOf(wk, q, state.rot);
    state.n++;
    if (!d) return Infinity;
    const b = db.best(d);
    return b.s / 128;
  };
}

// ---------------------------------------------------------------------------------------------------------
// Caméra : guide = { x, y, w, h } en pixels de l'image.

export function identifyGuided(db, frame, guide, { small = null, retry = true } = {}) {
  const t0 = performance.now();
  const { data, width: W, height: H } = frame;
  const gh = guide.h;
  const m = 0.3 * gh;
  const roi = clampRoi(guide.x - m, guide.y - m, guide.x + guide.w + m, guide.y + guide.h + m, W, H);
  const img = small || smallImage(data, W, H, GUIDE_H / gh, roi);
  const f = gh >= 900 ? 2 : 1;
  const wk = workGray(data, W, H, roi, f);
  const state = { n: 0, rot: false };
  const obj = makeObjective(db, wk, img, state);
  const g0 = rectQuad(...toSmall(img, [guide.x, guide.y]), guide.w * img.kx, guide.h * img.ky);
  const so = sideOptions(img, g0);

  // carte à l'envers ? on compare les deux sens sur les quads de départ
  const seeds = [[0, 0, 0, 0], so.sides.map(s => Math.min(1, s.opts.length - 1)), ...seedCombos(so, { k: DETECT.seeds })];
  let best = search(so, obj, { seeds });
  if (best.score > T.strong) {
    state.rot = true;
    const cache = new Map();
    const alt = search(so, obj, { seeds, passes: 0, cache });
    if (alt.score < best.score - 0.15) best = { ...search(so, obj, { seeds, cache }), rot: true };
    state.rot = false;
  }
  let stage = 'guide';
  if (retry && best.score > T.retry) {
    // porte-carte rigide : pics plus faibles et décalages vers l'intérieur
    state.rot = !!best.rot;
    const so2 = sideOptions(img, g0, { extra: true });
    const inward = [];
    for (let k = 0; k < 3; k++) {
      // départs « tous les côtés décalés vers l'intérieur de la même marge »
      inward.push(so2.sides.map(s => {
        const want = (s.info[0]?.d ?? 0) - [0.045, 0.065, 0.085][k] * so2.h;
        let bi = 0, bd = Infinity;
        s.opts.forEach((o, i) => { const e = Math.abs(o.d - want); if (e < bd) { bd = e; bi = i; } });
        return bi;
      }));
    }
    const r2 = search(so2, obj, { seeds: [...seeds.slice(0, 2), ...inward, ...seedCombos(so2, { k: DETECT.seeds })] });
    if (r2.score < best.score) { best = { ...r2, rot: best.rot }; stage = 'porte-carte'; }
    // carte tenue trop loin : guide réduit ×0,8
    if (best.score > T.retry) {
      const so3 = sideOptions(img, rectQuad(...toSmall(img, [guide.x, guide.y]), guide.w * img.kx, guide.h * img.ky, 0.8));
      const r3 = search(so3, obj);
      if (r3.score < best.score) { best = { ...r3, rot: best.rot }; stage = 'loin'; }
    }
    state.rot = false;
  }
  best = recentre(img, obj, state, best);
  return finish(db, wk, img, best, state, stage, t0);
}

// Recentrage : options recalculées autour du meilleur quad trouvé (profils perpendiculaires à ses côtés, sur toute
// leur longueur) puis nouvelle descente. Rattrape un côté resté sur le bord d'un étui, d'un cadre ou de l'illustration
// quand les trois autres sont justes (photos réelles : la vraie droite n'était pas parmi les pics du guide).
// Seulement entre « forte » et DETECT.recentre (au-delà, le quad n'a rien de commun avec une carte de la base).
function recentre(img, obj, state, best) {
  if (!DETECT.recentre || !best.quad || !(best.score > T.strong) || !(best.score < DETECT.recentre)) return best;
  state.rot = !!best.rot;
  const so = sideOptions(img, best.quad, { peaks: DETECT.recentrePeaks });
  const r = search(so, obj, { seeds: [[0, 0, 0, 0], so.sides.map(s => Math.min(1, s.opts.length - 1)), ...seedCombos(so, { k: DETECT.seeds })] });
  state.rot = false;
  return r.quad && r.score < best.score ? { ...r, rot: best.rot } : best;
}

function finish(db, wk, img, best, state, stage, t0) {
  if (!best.quad) return { quad: null, rank: null, nev: state.n, ms: performance.now() - t0, stage };
  let q = best.quad.map(p => fromSmall(img, p));
  const d = descOf(wk, q, best.rot);
  if (best.rot) q = [q[2], q[3], q[0], q[1]];       // coins dans l'ordre de la carte
  const rank = db.rank(d, 5, { lookalike: T.lookalike });
  return { quad: q, rank, desc: d, nev: state.n, ms: performance.now() - t0, stage };
}

// Détection seule (boucle à ~10 images/s, sans base) : quad affiché, côtés trouvés, netteté,
// et indice « Rapproche-toi » si le guide réduit ×0,8 explique mieux les bords.
export function detectOnly(frame, guide, { small = null } = {}) {
  const { data, width: W, height: H } = frame;
  const m = 0.3 * guide.h;
  const roi = clampRoi(guide.x - m, guide.y - m, guide.x + guide.w + m, guide.y + guide.h + m, W, H);
  const img = small || smallImage(data, W, H, GUIDE_H / guide.h, roi);
  const g = toSmall(img, [guide.x, guide.y]), gw = guide.w * img.kx, ghs = guide.h * img.ky;
  const a = displayQuad(sideOptions(img, rectQuad(g[0], g[1], gw, ghs)));
  let far = false, res = a;
  if (a.found < 4) {
    const b = displayQuad(sideOptions(img, rectQuad(g[0], g[1], gw, ghs, 0.8)));
    if (b.found > a.found || (b.found === a.found && b.sharp > a.sharp * 1.2)) { res = b; far = b.found >= 3; }
  }
  return {
    quad: res.quad ? res.quad.map(p => fromSmall(img, p)) : null,
    found: res.found, sharp: res.sharp, nsharp: res.nsharp, far,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Photo importée : pas de guide.

// Guides candidats : propositions du détecteur global, plus des guides centrés portrait et paysage de plusieurs
// tailles. Chacun est examiné comme un guide de caméra (options de côtés, quelques départs évalués par la base, dans
// les deux sens), puis les meilleurs ont la recherche complète. Photos réelles (QA-SCAN) : la vraie carte n'était
// parmi les propositions que pour 247 photos sur 505 (moitiés de carte prises pour des cartes couchées, bords de la
// photo ou de la table), et le tri sur le quad brut ne voyait pas une carte à 3 % près.
export const UNGUIDED = { scales: [0.92, 0.75, 0.6, 0.48], seeds: 4, refine: 3, levelPx: 1.2e6 };

export function identifyUnguided(db, frame, { maxProps = 8 } = {}) {
  const t0 = performance.now();
  const { data, width: W, height: H } = frame;
  const k0 = Math.min(1, 640 / Math.max(W, H));
  const over = smallImage(data, W, H, k0);
  const cands = proposals(over, { max: maxProps }).map(q => q.map(p => fromSmall(over, p)));
  for (const s of UNGUIDED.scales) {
    const h = s * Math.min(H, W / RATIO), w = h * RATIO;
    cands.push(rectQuad((W - w) / 2, (H - h) / 2, w, h));
    const h2 = s * Math.min(W, H / RATIO), w2 = h2 * RATIO;
    cands.push(rectQuad((W - h2) / 2, (H - w2) / 2, h2, w2));
  }
  const fw = Math.max(1, Math.floor(Math.max(W, H) / 2000));
  const wk = workGray(data, W, H, [0, 0, W, H], fw);
  // images de détection partagées, une par demi-octave de hauteur de guide (≈ 420 px de guide), de 1,2 Mpx au plus ;
  // au-delà (petite carte dans une grande photo), image limitée à la zone du candidat : mémoire du worker bornée
  const levels = new Map();
  const levelFor = q => {
    const gh = guideHeight(q);
    const e = Math.round(Math.log2(GUIDE_H / gh) * 2) / 2;
    const k = Math.min(2, 2 ** e);
    if (W * H * k * k <= UNGUIDED.levelPx) {
      if (!levels.has(k)) levels.set(k, smallImage(data, W, H, k));
      return levels.get(k);
    }
    const xs = q.map(p => p[0]), ys = q.map(p => p[1]), mm = 0.3 * gh;
    return smallImage(data, W, H, k, clampRoi(Math.min(...xs) - mm, Math.min(...ys) - mm, Math.max(...xs) + mm, Math.max(...ys) + mm, W, H));
  };
  const state = { n: 0, rot: false };
  const screened = [];
  for (const q of cands) {
    const r0 = rotations(q)[0];
    const img = levelFor(r0);
    const obj = makeObjective(db, wk, img, state);
    const g = r0.map(p => toSmall(img, p));
    const so = sideOptions(img, g);
    const seeds = [[0, 0, 0, 0], so.sides.map(s => Math.min(1, s.opts.length - 1)), ...seedCombos(so, { k: UNGUIDED.seeds })];
    for (const rot of [false, true]) {
      state.rot = rot;
      const cache = new Map();
      const s0 = search(so, obj, { seeds, passes: 0, cache });
      screened.push({ img, obj, g, so, seeds, cache, rot, s: s0.score });
    }
  }
  state.rot = false;
  screened.sort((a, b) => a.s - b.s);
  let best = null;
  for (const c of screened.slice(0, UNGUIDED.refine)) {
    state.rot = c.rot;
    let r = search(c.so, c.obj, { seeds: c.seeds, cache: c.cache });
    if (r.score > T.retry) {
      const so2 = sideOptions(c.img, c.g, { extra: true });
      const r2 = search(so2, c.obj, { seeds: [...c.seeds.slice(0, 2), ...seedCombos(so2, { k: DETECT.seeds })] });
      if (r2.score < r.score) r = r2;
    }
    state.rot = false;
    r = recentre(c.img, c.obj, state, { ...r, rot: c.rot });
    if (r.quad && (!best || r.score < best.r.score)) best = { r, img: c.img };
    if (best && best.r.score <= T.strong) break;
  }
  if (!best) return { quad: null, rank: null, nev: state.n, ms: performance.now() - t0, stage: 'import' };
  return finish(db, wk, best.img, best.r, state, 'import', t0);
}

// ---------------------------------------------------------------------------------------------------------
// Décision sur une image

export function decide(rank, t = T) {
  if (!rank) return { level: 'none', reprint: false, rivals: [] };
  const { d1, d2 } = rank;
  let level = 'weak';
  if (d1 <= t.strong && d1 <= t.strongRatio * d2) level = 'strong';
  else if (d1 <= t.normal && d2 - d1 >= t.margin) level = 'normal';
  else if (d1 > t.none) level = 'none';
  const reprint = rank.group.length > 1;
  const rivals = (rank.rivals || []).map(x => x.i);
  return { level, reprint, rivals };
}
