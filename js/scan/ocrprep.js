// Lignes à lire par l'OCR (sans DOM, utilisé par le worker et le banc d'essai). La fenêtre du numéro est redressée
// à travers l'homographie de la carte (texte ≈ 30–40 px de haut), le fond est normalisé localement (bords jaunes,
// panneaux colorés → clairs), la ligne de texte est retrouvée par projection horizontale près de sa hauteur attendue,
// puis recadrée sur ses caractères ; deux variantes par ligne (gris d'origine étiré, fond normalisé).

import { homography } from './describe.js';

// Fenêtres par position du numéro (fractions de la carte, mesurées sur les images TCGdex) :
// x = étendue horizontale, yc = centre attendu de la ligne, dy = tolérance verticale (erreur de coins)
export const OCR_ZONE = {
  bl: { x: [0.04, 0.31], yc: 0.956, dy: 0.030 },     // sv, me, swsh : « G [SVI FR] 001/198 ● »
  blsm: { x: [0.04, 0.28], yc: 0.945, dy: 0.020 },   // sm : « [symbole] 1/149 ● » entre « Illus. » et « ©2017 »
  br: { x: [0.72, 0.94], yc: 0.962, dy: 0.032 },     // base → xy : « 4/102 ★ », « 1/114 ● », « RC1/RC32 »
  ec: { x: [0.70, 0.87], yc: 0.905, dy: 0.022 },     // e-card : « 6/165 ★ » au-dessus de la bande de points
};
export const CARD_H = 1700;
const CARD_W = Math.round(CARD_H * 63 / 88);
const LINE_H = Math.round(0.034 * CARD_H);           // hauteur d'une ligne découpée
const MARGIN = 10;

// Fenêtre redressée en niveaux de gris (Float32Array w×h), origine (x0, y0) en pixels de carte
function warp(frame, quad, x0, y0, w, h) {
  const { data, width: W, height: H } = frame;
  const M = homography(quad, CARD_W, CARD_H);
  if (!M) return null;
  const g = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = x0 + i + 0.5, v = y0 + j + 0.5, z = M[6] * u + M[7] * v + 1;
      let x = (M[0] * u + M[1] * v + M[2]) / z - 0.5, y = (M[3] * u + M[4] * v + M[5]) / z - 0.5;
      if (x < 0) x = 0; else if (x > W - 1.001) x = W - 1.001;
      if (y < 0) y = 0; else if (y > H - 1.001) y = H - 1.001;
      const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, p = (iy * W + ix) * 4, q = p + W * 4;
      const a = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      const b = 0.299 * data[p + 4] + 0.587 * data[p + 5] + 0.114 * data[p + 6];
      const c = 0.299 * data[q] + 0.587 * data[q + 1] + 0.114 * data[q + 2];
      const d = 0.299 * data[q + 4] + 0.587 * data[q + 5] + 0.114 * data[q + 6];
      const top = a + (b - a) * fx, bot = c + (d - c) * fx;
      g[j * w + i] = top + (bot - top) * fy;
    }
  }
  return g;
}

// Moyenne locale (fenêtre carrée 2r+1) par image intégrale
function boxMean(g, w, h, r) {
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

// Composantes connexes (4-connexité) des pixels d'encre : rectangles, taux de remplissage et étiquettes
function components(ink, w, h) {
  const lab = new Int32Array(w * h).fill(-1), out = [], stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!ink[s] || lab[s] >= 0) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
    lab[s] = out.length;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && ink[p - 1] && lab[p - 1] < 0) { lab[p - 1] = out.length; stack.push(p - 1); }
      if (x < w - 1 && ink[p + 1] && lab[p + 1] < 0) { lab[p + 1] = out.length; stack.push(p + 1); }
      if (y > 0 && ink[p - w] && lab[p - w] < 0) { lab[p - w] = out.length; stack.push(p - w); }
      if (y < h - 1 && ink[p + w] && lab[p + w] < 0) { lab[p + w] = out.length; stack.push(p + w); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    out.push({ x0, y0, x1, y1, bw, bh, n, fill: n / (bw * bh) });
  }
  return { comps: out, lab };
}

// Image RGBA en niveaux de gris (texte sombre sur fond clair) avec une marge blanche
function toImage(v, w, h) {
  const W = w + 2 * MARGIN, H = h + 2 * MARGIN, out = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = ((y + MARGIN) * W + x + MARGIN) * 4, g = v[y * w + x];
      out[o] = out[o + 1] = out[o + 2] = g;
    }
  }
  return typeof ImageData === 'function' ? new ImageData(out, W, H) : { data: out, width: W, height: H };
}

// Rapport local (pixel / moyenne du voisinage) : encre = nettement plus sombre (ou plus clair) que l'entourage
const INK = 0.78;

// Nombre de composantes « en forme de caractère » (hauteur 30–90 % de la ligne, pas plus larges que hautes ×1,3)
function charLike(comps, lh) {
  let n = 0;
  for (const b of comps) if (b.bh >= 0.3 * lh && b.bh <= 0.92 * lh && b.bw <= 1.3 * b.bh && b.n >= 20) n++;
  return n;
}

// Étirement entre les percentiles 2 et 98 d'une zone (x0..x1, y0..y1) du gris g (largeur w) → Uint8 cw×ch
function stretch(g, w, x0, y0, x1, y1, invert = false) {
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, vals = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) vals[y * cw + x] = g[(y0 + y) * w + x0 + x];
  const srt = Float32Array.from(vals).sort();
  const lo = srt[Math.floor(0.02 * (srt.length - 1))], hi = Math.max(lo + 1, srt[Math.floor(0.98 * (srt.length - 1))]);
  const out = new Uint8ClampedArray(cw * ch);
  for (let i = 0; i < vals.length; i++) { const v = 255 * (vals[i] - lo) / (hi - lo); out[i] = invert ? 255 - v : v; }
  return { a: out, w: cw, h: ch };
}

// Agrandissement bilinéaire jusqu'à une hauteur donnée (petits caractères du cartouche : tesseract lit mieux ≥ 30 px)
function upscale(img, H) {
  if (img.h >= H) return img;
  const k = H / img.h, W = Math.round(img.w * k), out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(img.h - 1.001, Math.max(0, (y + 0.5) / k - 0.5)), iy = sy | 0, fy = sy - iy;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(img.w - 1.001, Math.max(0, (x + 0.5) / k - 0.5)), ix = sx | 0, fx = sx - ix, p = iy * img.w + ix;
      const t = img.a[p] + (img.a[p + 1] - img.a[p]) * fx, b = img.a[p + img.w] + (img.a[p + img.w + 1] - img.a[p + img.w]) * fx;
      out[y * W + x] = t + (b - t) * fy;
    }
  }
  return { a: out, w: W, h: H };
}

// Boîte du code de série SV/ME (lettres blanches sur un cartouche noir, à gauche du numéro) : composante sombre du
// gris étiré, pleine, plus large que haute ; null si absente (autres ères)
function codeBox(g, w, lh) {
  const s = stretch(g, w, 0, 0, w - 1, lh - 1), dark = new Uint8Array(w * lh);
  for (let i = 0; i < dark.length; i++) dark[i] = s.a[i] < 90 ? 1 : 0;
  let best = null;
  for (const b of components(dark, w, lh).comps) {
    const r = b.bw / b.bh;
    if (b.bh < 0.4 * lh || b.bh > 0.97 * lh || r < 1.3 || r > 4.5 || b.fill < 0.45 || b.x0 < 1) continue;
    if (!best || b.n > best.n) best = b;
  }
  return best;
}

// Une ligne découpée (rapport local n et gris g, w×lh) → images pour tesseract, recadrées sur le groupe de
// caractères le plus fourni : « code » = cartouche SV/ME seul, inversé (texte noir sur blanc) ; « raw » = gris
// d'origine, contraste étiré ; « norm » = fond normalisé localement (bords jaunes, panneaux, dégradés → blancs ;
// texte clair sur fond sombre inversé). Avec un cartouche, raw et norm ne gardent que le numéro à sa droite.
function lineImages(n, g, w, lh) {
  const dark = new Uint8Array(w * lh), light = new Uint8Array(w * lh);
  for (let i = 0; i < dark.length; i++) { dark[i] = n[i] < INK ? 1 : 0; light[i] = n[i] > 1 / INK ? 1 : 0; }
  const cd = components(dark, w, lh), cl = components(light, w, lh);
  const inv = charLike(cl.comps, lh) > charLike(cd.comps, lh) + 1;
  const v = new Uint8ClampedArray(w * lh);
  for (let i = 0; i < v.length; i++) {
    const r = inv ? 1 / Math.max(0.05, n[i]) : n[i];          // texte sombre dans les deux cas
    v[i] = 255 * Math.min(1, Math.max(0, (r - 0.35) / 0.65));
  }
  const box = inv ? null : codeBox(g, w, lh);
  // composantes : effacer bords et panneaux, repérer le groupe de caractères principal
  const ink = new Uint8Array(w * lh);
  for (let i = 0; i < ink.length; i++) ink[i] = v[i] < 150 ? 1 : 0;
  const { comps, lab } = components(ink, w, lh);
  const chars = [];
  for (let k = 0; k < comps.length; k++) {
    const b = comps[k];
    if (b.bh >= 0.97 * lh || b.bw > 6 * lh) {
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (lab[y * w + x] === k) v[y * w + x] = 255;
    } else if (b.bh >= 0.25 * lh && b.bh <= 0.95 * lh && b.n >= 15 && b.bw <= 2.2 * lh && (!box || b.x0 > box.x1)) {
      chars.push(b);
    }
  }
  let x0 = box ? box.x1 + 1 : 0, x1 = w - 1;
  if (chars.length) {
    chars.sort((a, b) => a.x0 - b.x0);
    // groupes : écart horizontal ≤ 1,4 × la hauteur de ligne ; on garde le plus fourni
    const groups = [];
    for (const c of chars) {
      const cur = groups[groups.length - 1];
      if (cur && c.x0 - cur.x1 <= 1.4 * lh) { cur.x1 = Math.max(cur.x1, c.x1); cur.n++; cur.ink += c.n; }
      else groups.push({ x0: c.x0, x1: c.x1, n: 1, ink: c.n });
    }
    const best = groups.reduce((a, b) => (b.n > a.n || (b.n === a.n && b.ink > a.ink) ? b : a));
    const pad = Math.round(0.6 * lh);
    x0 = Math.max(box ? box.x1 + Math.round(0.1 * lh) : 0, best.x0 - pad); x1 = Math.min(w - 1, best.x1 + pad);
  }
  if (x1 - x0 < 8) { x0 = 0; x1 = w - 1; }
  const a = stretch(g, w, x0, 0, x1, lh - 1);
  const cw = a.w, b = new Uint8ClampedArray(cw * lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < cw; x++) b[y * cw + x] = v[y * w + x0 + x];
  const out = [];
  if (box) {
    // cartouche inversé (lettres noires sur blanc) ; ce qui est hors du cartouche (coins arrondis, carte autour),
    // atteint depuis le bord du rectangle sans traverser le noir du cartouche, est blanchi
    const c = stretch(g, w, box.x0, box.y0, box.x1, box.y1, true);
    const seen = new Uint8Array(c.w * c.h), st = [];
    const push = i => { if (!seen[i] && c.a[i] < 165) { seen[i] = 1; st.push(i); } };
    for (let x = 0; x < c.w; x++) { push(x); push((c.h - 1) * c.w + x); }
    for (let y = 0; y < c.h; y++) { push(y * c.w); push(y * c.w + c.w - 1); }
    while (st.length) {
      const i = st.pop(), x = i % c.w, y = (i / c.w) | 0;
      c.a[i] = 255;
      if (x > 0) push(i - 1); if (x < c.w - 1) push(i + 1); if (y > 0) push(i - c.w); if (y < c.h - 1) push(i + c.w);
    }
    const u = upscale(c, 64);
    out.push({ variant: 'code', img: toImage(u.a, u.w, u.h) });
  }
  out.push({ variant: 'raw', img: toImage(a.a, cw, lh) }, { variant: 'norm', img: toImage(b, cw, lh) });
  for (const o of out) o.box = !!box;
  return out;
}

// Prépare une fenêtre déjà redressée (g, w×h) : lignes candidates triées par vraisemblance
export function prepWindow(g, w, h, { yc = h / 2, dy = h / 2, maxLines = 2 } = {}) {
  const r = Math.max(8, Math.round(0.022 * CARD_H));
  const m = boxMean(g, w, h, r), n = new Float32Array(w * h);
  for (let i = 0; i < n.length; i++) n[i] = g[i] / Math.max(8, m[i]);
  // profil par ligne : transitions encre / fond le long de la ligne (le texte en a beaucoup, un bord uni très peu),
  // texte sombre ou clair ; lissé sur la hauteur d'un chiffre
  const prof = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let td = 0, tl = 0, pd = n[y * w] < INK, pl = n[y * w] > 1 / INK;
    for (let x = 1; x < w; x++) {
      const v = n[y * w + x], d = v < INK, l = v > 1 / INK;
      if (d !== pd) td++;
      if (l !== pl) tl++;
      pd = d; pl = l;
    }
    prof[y] = Math.max(td, tl) / w;
  }
  const k = Math.max(3, Math.round(0.016 * CARD_H)), sm = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0, c = 0;
    for (let t = Math.max(0, y - (k >> 1)); t <= Math.min(h - 1, y + (k >> 1)); t++) { s += prof[t]; c++; }
    sm[y] = s / c;
  }
  const half = LINE_H >> 1, cands = [];
  for (let y = half; y < h - half; y++) {
    if (sm[y] < 0.01 || sm[y] < sm[y - 1] || sm[y] < sm[y + 1]) continue;
    const z = (y - yc) / Math.max(1, 0.7 * dy);
    cands.push({ y, s: sm[y] * Math.exp(-z * z) });
  }
  cands.sort((a, b) => b.s - a.s);
  const centers = [];
  for (const c of cands) {
    if (centers.some(y => Math.abs(y - c.y) < 0.018 * CARD_H)) continue;
    centers.push(c.y);
    if (centers.length >= maxLines) break;
  }
  if (!centers.length) centers.push(Math.round(Math.min(h - half - 1, Math.max(half, yc))));
  // ligne la plus probable d'abord : ses deux variantes, puis la suivante
  const out = [];
  centers.forEach((c, i) => {
    const y0 = Math.max(0, c - half), lh = Math.min(h - y0, LINE_H);
    for (const l of lineImages(n.subarray(y0 * w, (y0 + lh) * w), g.subarray(y0 * w, (y0 + lh) * w), w, lh)) out.push({ variant: `l${i}-${l.variant}`, img: l.img, box: l.box });
  });
  return out;
}

// frame : { data, width, height } RGBA ; quad : coins de la carte [tl, tr, br, bl] ; nums : clés de OCR_ZONE
export function ocrLines(frame, quad, nums = ['bl', 'br']) {
  const out = [];
  for (const num of nums) {
    const z = OCR_ZONE[num];
    if (!z) continue;
    const x0 = Math.round(z.x[0] * CARD_W), x1 = Math.round(z.x[1] * CARD_W);
    const y0 = Math.round((z.yc - z.dy) * CARD_H) - (LINE_H >> 1), y1 = Math.min(CARD_H, Math.round((z.yc + z.dy) * CARD_H) + (LINE_H >> 1));
    const w = x1 - x0, h = y1 - y0;
    const g = warp(frame, quad, x0, y0, w, h);
    if (!g) continue;
    const lines = prepWindow(g, w, h, { yc: z.yc * CARD_H - y0, dy: z.dy * CARD_H });
    for (const l of lines) out.push({ num, ...l });
  }
  return out;
}

// Ligne déjà isolée (texte rendu, tests) : une seule image
export function prepLine(g, w, h) {
  return prepWindow(g, w, h, { maxLines: 1 });
}
