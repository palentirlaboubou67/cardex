// Départage des réimpressions (même illustration) et des sosies par la zone du code de série et du numéro
// (FINAL-scanner §4.5 / §5.5) : la zone de la photo redressée en 600×825 est comparée (NCC, ±12 px)
// à la même zone de l'image high.webp de chaque candidat. 50/51 réimpressions départagées en synthèse.
import { homography } from './describe.js';
import { weights } from './describe.js';

export const RW = 600, RH = 825, PAD = 12;
// Zone par position du numéro (fractions de la carte) : bas-gauche (SL → ME), bas-droite, e-card
const RECT = { bl: [0.03, 0.905, 0.40, 0.99], br: [0.60, 0.905, 0.97, 0.99], ec: [0.55, 0.86, 0.97, 0.99] };

export function rectPx(num) {
  const [a, b, c, d] = RECT[num] || RECT.br;
  return [Math.round(a * RW), Math.round(b * RH), Math.round(c * RW), Math.round(d * RH)];
}

// Noyau gaussien σ = 0,8 (7 coefficients, comme OpenCV)
const GK = (() => {
  const k = [], s = 0.8;
  for (let i = -3; i <= 3; i++) k.push(Math.exp(-(i * i) / (2 * s * s)));
  const t = k.reduce((a, b) => a + b, 0);
  return k.map(v => v / t);
})();

function gauss(a, w, h) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); s += a[y * w + xx] * GK[k + 3]; }
      t[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); s += t[yy * w + x] * GK[k + 3]; }
      o[y * w + x] = s;
    }
  }
  return o;
}

// Zone de la photo (RGBA source) redressée en coordonnées 600×825, avec une marge (pour le flou), puis floutée.
export function queryBand(data, W, H, quad, num) {
  const M = homography(quad, RW, RH);
  if (!M) return null;
  const [x0, y0, x1, y1] = rectPx(num), m = 4;
  const bw = x1 - x0 + 2 * m, bh = y1 - y0 + 2 * m, a = new Float32Array(bw * bh);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const u = x0 - m + i + 0.5, v = y0 - m + j + 0.5, z = M[6] * u + M[7] * v + 1;
      let x = (M[0] * u + M[1] * v + M[2]) / z - 0.5, y = (M[3] * u + M[4] * v + M[5]) / z - 0.5;
      if (x < 0) x = 0; else if (x > W - 1.001) x = W - 1.001;
      if (y < 0) y = 0; else if (y > H - 1.001) y = H - 1.001;
      const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, p = (iy * W + ix) * 4, q = p + W * 4;
      const g = o => 0.299 * data[p + o] + 0.587 * data[p + 1 + o] + 0.114 * data[p + 2 + o];
      const g2 = o => 0.299 * data[q + o] + 0.587 * data[q + 1 + o] + 0.114 * data[q + 2 + o];
      const top = g(0) + (g(4) - g(0)) * fx, bot = g2(0) + (g2(4) - g2(0)) * fx;
      a[j * bw + i] = top + (bot - top) * fy;
    }
  }
  const b = gauss(a, bw, bh), tw = x1 - x0, th = y1 - y0, t = new Float32Array(tw * th);
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) t[j * tw + i] = b[(j + m) * bw + i + m];
  return { a: t, w: tw, h: th, num };
}

// Fenêtre de recherche d'un candidat (image décodée RGBA, toute taille) : zone ± PAD en 600×825, floutée.
export function candidateWindow(data, w, h, num) {
  const [x0, y0, x1, y1] = rectPx(num);
  const X0 = Math.max(0, x0 - PAD), Y0 = Math.max(0, y0 - PAD), X1 = Math.min(RW, x1 + PAD), Y1 = Math.min(RH, y1 + PAD);
  // moyenne de surface de l'image entière vers 600×825, limitée aux lignes / colonnes utiles
  const wx = weights(w, RW), wy = weights(h, RH);
  const ww = X1 - X0, wh = Y1 - Y0, gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  // lignes source nécessaires
  const r0 = wy[Y0].idx[0], r1 = wy[Y1 - 1].idx[wy[Y1 - 1].idx.length - 1] + 1;
  const tmp = new Float32Array(ww * (r1 - r0));
  for (let y = r0; y < r1; y++) {
    for (let x = 0; x < ww; x++) {
      const { idx, c } = wx[X0 + x];
      let s = 0;
      for (let t = 0; t < idx.length; t++) s += gray[y * w + idx[t]] * c[t];
      tmp[(y - r0) * ww + x] = s;
    }
  }
  const out = new Float32Array(ww * wh);
  for (let y = 0; y < wh; y++) {
    const { idx, c } = wy[Y0 + y];
    for (let x = 0; x < ww; x++) {
      let s = 0;
      for (let t = 0; t < idx.length; t++) s += tmp[(idx[t] - r0) * ww + x] * c[t];
      out[y * ww + x] = s;
    }
  }
  return { a: gauss(out, ww, wh), w: ww, h: wh, dx: x0 - X0, dy: y0 - Y0, num };
}

// ---------------------------------------------------------------------------------------------------------
// Corrélation normalisée centrée (TM_CCOEFF_NORMED), maximum sur les décalages ; grossier (½) puis fin.

function half(a, w, h) {
  const W = w >> 1, H = h >> 1, o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = 2 * y * w + 2 * x;
    o[y * W + x] = (a[i] + a[i + 1] + a[i + w] + a[i + w + 1]) / 4;
  }
  return { a: o, w: W, h: H };
}

function nccAt(T, tm, tn, I, x, y) {
  // T : modèle centré (tm = Σ T'²) ; I : fenêtre
  let st = 0, si = 0, sii = 0;
  const n = T.w * T.h;
  for (let j = 0; j < T.h; j++) {
    const ro = (y + j) * I.w + x, rt = j * T.w;
    for (let i = 0; i < T.w; i++) {
      const v = I.a[ro + i];
      st += T.a[rt + i] * v; si += v; sii += v * v;
    }
  }
  const vi = sii - si * si / n;
  return vi > 1e-6 && tm > 1e-6 ? st / Math.sqrt(tm * vi) : 0;
}

function centered(t) {
  let m = 0;
  for (let i = 0; i < t.a.length; i++) m += t.a[i];
  m /= t.a.length;
  const a = new Float32Array(t.a.length);
  let s = 0;
  for (let i = 0; i < a.length; i++) { a[i] = t.a[i] - m; s += a[i] * a[i]; }
  return { a, w: t.w, h: t.h, ss: s };
}

export function nccMax(tmpl, win) {
  if (win.w < tmpl.w || win.h < tmpl.h) return 0;
  const T = centered(tmpl);
  const Th = centered(half(tmpl.a, tmpl.w, tmpl.h)), Ih = half(win.a, win.w, win.h);
  // grossier : tous les décalages à mi-résolution
  const cand = [];
  for (let y = 0; y + Th.h <= Ih.h; y++) {
    for (let x = 0; x + Th.w <= Ih.w; x++) cand.push([nccAt(Th, Th.ss, 0, Ih, x, y), x, y]);
  }
  cand.sort((a, b) => b[0] - a[0]);
  // fin : ±2 px autour des 2 meilleurs
  let best = -1;
  const seen = new Set();
  for (const [, cx, cy] of cand.slice(0, 2)) {
    for (let y = 2 * cy - 2; y <= 2 * cy + 2; y++) {
      for (let x = 2 * cx - 2; x <= 2 * cx + 2; x++) {
        if (x < 0 || y < 0 || x + T.w > win.w || y + T.h > win.h || seen.has(x * 1000 + y)) continue;
        seen.add(x * 1000 + y);
        const v = nccAt(T, T.ss, 0, win, x, y);
        if (v > best) best = v;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------
// Chargement des zones des candidats (high.webp, mises en cache en mémoire)

const WIN = new Map();
async function loadWindow(url, num, signal) {
  const key = url + '|' + num;
  if (WIN.has(key)) return WIN.get(key);
  const p = (async () => {
    const res = await fetch(url, { mode: 'cors', signal });
    if (!res.ok) throw new Error('image ' + res.status);
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close?.();
    return candidateWindow(d.data, d.width, d.height, num);
  })();
  WIN.set(key, p);
  p.catch(() => WIN.delete(key));
  if (WIN.size > 80) WIN.delete(WIN.keys().next().value);
  return p;
}

// Quad agrandi ou réduit autour de son centre (le détecteur a pu se caler sur le cadre intérieur de la carte,
// ou sur le bord d'un étui : la recherche ±12 px ne rattrape pas une erreur d'échelle)
function scaleQuad(q, s) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  return q.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]);
}
export const SCALES = [1, 1.03, 1.06, 0.97];

// Compare la photo (RGBA + quad) aux candidats (lignes de la base). Retourne [{ i, score }] pour chaque ligne, trié
// (score null = image du candidat indisponible, en dernier), ou null si aucune image n'a pu être chargée.
// urlOf(i) : adresse de l'image (par défaut high.webp TCGdex). Score = meilleure corrélation sur quelques échelles.
export async function compareRegions(db, frame, quad, rows, { signal, timeout = 6000, urlOf = null, scales = SCALES } = {}) {
  const { data, width: W, height: H } = frame;
  const bands = new Map();
  const bandsOf = num => {
    if (!bands.has(num)) bands.set(num, scales.map(s => queryBand(data, W, H, s === 1 ? quad : scaleQuad(quad, s), num)).filter(Boolean));
    return bands.get(num);
  };
  const jobs = rows.map(async i => {
    const base = db.imageBase(i), set = db.setOf(i);
    if (!base || !set) return { i, score: null };
    const num = set.num || 'br';
    const bs = bandsOf(num);
    if (!bs.length) return { i, score: null };
    let timer = 0;
    try {
      const win = await Promise.race([
        loadWindow(urlOf ? urlOf(i) : base + '/high.webp', num, signal),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('délai')), timeout); }),
      ]);
      let score = -1;
      for (const b of bs) score = Math.max(score, nccMax(b, win));
      return { i, score };
    } catch {
      return { i, score: null };
    } finally {
      clearTimeout(timer);
    }
  });
  const res = await Promise.all(jobs);
  if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
  if (!res.some(x => x.score != null)) return null;
  return res.sort((a, b) => (b.score ?? -9) - (a.score ?? -9));
}
