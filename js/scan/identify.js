// Identification d'une carte dans une image (sans DOM) : utilisée par le worker et par le banc d'essai.
// guidé (caméra) : options de côtés autour du guide → descente choisie par la base (detect.search)
//                   → si le résultat est faible : options « porte-carte » et guide réduit ×0,8 (carte trop loin)
// sans guide (photo importée) : quadrilatères candidats (detect.proposals) → raffinement guidé → meilleur.
import { describe, warpRegion, rotate180, CW, CH } from './describe.js';
import {
  smallImage, sideOptions, search, rectQuad, toSmall, fromSmall, GUIDE_H, proposals, rotations, displayQuad, guideHeight,
} from './detect.js';

// Seuils de décision (FINAL-scanner §5.4) ; calibrés avec tools/scan_bench.py calib (synthèse 750 photos,
// carte absente 450, 21 photos réelles) : « normale » d1 ≤ 1,10 et d2 − d1 ≥ 0,30 garde 100 % de précision partout
// et accepte 19/21 photos réelles ; plus strict ne fait guère baisser les fausses acceptations « carte absente »
// (paires de même illustration), mais beaucoup les acceptations réelles.
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
  const seeds = [[0, 0, 0, 0], so.sides.map(s => Math.min(1, s.opts.length - 1))];
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
    const r2 = search(so2, obj, { seeds: [...seeds, ...inward] });
    if (r2.score < best.score) { best = { ...r2, rot: best.rot }; stage = 'porte-carte'; }
    // carte tenue trop loin : guide réduit ×0,8
    if (best.score > T.retry) {
      const so3 = sideOptions(img, rectQuad(...toSmall(img, [guide.x, guide.y]), guide.w * img.kx, guide.h * img.ky, 0.8));
      const r3 = search(so3, obj);
      if (r3.score < best.score) { best = { ...r3, rot: best.rot }; stage = 'loin'; }
    }
    state.rot = false;
  }
  return finish(db, wk, img, best, state, stage, t0);
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

export function identifyUnguided(db, frame, { maxProps = 8 } = {}) {
  const t0 = performance.now();
  const { data, width: W, height: H } = frame;
  const k0 = Math.min(1, 640 / Math.max(W, H));
  const over = smallImage(data, W, H, k0);
  let cands = proposals(over, { max: maxProps }).map(q => q.map(p => fromSmall(over, p)));
  // repli : guides centrés (la carte remplit la photo), portrait et paysage
  for (const s of [0.92, 0.75]) {
    const h = s * Math.min(H, W / 0.716), w = h * 0.716;
    cands.push(rectQuad((W - w) / 2, (H - h) / 2, w, h));
    const h2 = s * Math.min(W, H / 0.716), w2 = h2 * 0.716;
    const q = rectQuad((W - h2) / 2, (H - w2) / 2, h2, w2);
    cands.push(q);
  }
  // tri rapide : distance sur le quad brut, dans les deux sens possibles
  const fw = Math.max(1, Math.floor(Math.max(W, H) / 2000));
  const wk = workGray(data, W, H, [0, 0, W, H], fw);
  let n = 0;
  const scored = [];
  for (const q of cands) {
    for (const r of rotations(q)) {
      const d = descOf(wk, r, false);
      n++;
      if (d) scored.push({ q: r, s: db.best(d).s / 128 });
    }
  }
  scored.sort((a, b) => a.s - b.s);
  // raffinement guidé des 3 meilleurs
  let best = null;
  for (const c of scored.slice(0, 3)) {
    const gh = guideHeight(c.q);
    const xs = c.q.map(p => p[0]), ys = c.q.map(p => p[1]), mm = 0.3 * gh;
    const roi = clampRoi(Math.min(...xs) - mm, Math.min(...ys) - mm, Math.max(...xs) + mm, Math.max(...ys) + mm, W, H);
    const img = smallImage(data, W, H, GUIDE_H / gh, roi);
    const f = gh >= 900 ? 2 : 1;
    const wk2 = workGray(data, W, H, roi, f);
    const state = { n: 0, rot: false };
    const obj = makeObjective(db, wk2, img, state);
    const so = sideOptions(img, c.q.map(p => toSmall(img, p)));
    let r = search(so, obj);
    if (r.score > T.retry) {
      const r2 = search(sideOptions(img, c.q.map(p => toSmall(img, p)), { extra: true }), obj);
      if (r2.score < r.score) r = r2;
    }
    n += state.n;
    const cand = r.quad && r.score < c.s ? { r, img, wk: wk2 } : { r: { quad: c.q.map(p => toSmall(img, p)), score: c.s }, img, wk: wk2 };
    if (!best || cand.r.score < best.r.score) best = cand;
  }
  if (!best) return { quad: null, rank: null, nev: n, ms: performance.now() - t0, stage: 'import' };
  const res = finish(db, best.wk, best.img, best.r, { n }, 'import', t0);
  return res;
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
