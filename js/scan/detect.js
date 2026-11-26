// Détection des bords de la carte, guidée par le cadre affiché (portage de detect3.py, FINAL-scanner §5.2),
// généralisée à un guide quadrilatère quelconque, plus un détecteur sans guide pour les photos importées.
// Pour chaque côté du guide : 60 profils perpendiculaires, pics de gradient couleur, petite transformée de Hough,
// plusieurs droites candidates par côté ; c'est la base de cartes qui choisit la combinaison (search()).
// Coordonnées continues : le pixel (i, j) a son centre en (i + 0,5 ; j + 0,5).
import { RATIO, weights } from './describe.js';

export const BORDER = 0.028;     // bord extérieur jaune / argenté, en fraction de la hauteur de carte
export const GUIDE_H = 420;      // hauteur du guide dans l'image de détection
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------------------
// Image de détection : 3 plans Float32 (R, G, B) réduits par moyenne de surface puis floutés 3×3.

export function smallImage(data, W, H, k, roi = null) {
  const [x0, y0, x1, y1] = roi || [0, 0, W, H];
  const sw = x1 - x0, sh = y1 - y0;
  const dw = Math.max(8, Math.round(sw * k)), dh = Math.max(8, Math.round(sh * k));
  const n = dw * dh, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  if (dw === sw && dh === sh) {
    for (let y = 0, o = 0; y < dh; y++) {
      for (let x = 0, p = ((y0 + y) * W + x0) * 4; x < dw; x++, o++, p += 4) { R[o] = data[p]; G[o] = data[p + 1]; B[o] = data[p + 2]; }
    }
  } else {
    const wx = weights(sw, dw), wy = weights(sh, dh);
    const tr = new Float32Array(dw * sh), tg = new Float32Array(dw * sh), tb = new Float32Array(dw * sh);
    for (let y = 0; y < sh; y++) {
      const row = ((y0 + y) * W + x0) * 4, o = y * dw;
      for (let x = 0; x < dw; x++) {
        const { idx, c } = wx[x];
        let r = 0, g = 0, b = 0;
        for (let t = 0; t < idx.length; t++) { const p = row + idx[t] * 4, w = c[t]; r += data[p] * w; g += data[p + 1] * w; b += data[p + 2] * w; }
        tr[o + x] = r; tg[o + x] = g; tb[o + x] = b;
      }
    }
    for (let y = 0; y < dh; y++) {
      const { idx, c } = wy[y], o = y * dw;
      for (let x = 0; x < dw; x++) {
        let r = 0, g = 0, b = 0;
        for (let t = 0; t < idx.length; t++) { const q = idx[t] * dw + x, w = c[t]; r += tr[q] * w; g += tg[q] * w; b += tb[q] * w; }
        R[o + x] = r; G[o + x] = g; B[o + x] = b;
      }
    }
  }
  return { ch: [blur3(R, dw, dh), blur3(G, dw, dh), blur3(B, dw, dh)], w: dw, h: dh, kx: dw / sw, ky: dh / sh, x0, y0 };
}

function blur3(a, w, h) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? x - 1 : 0, rr = x < w - 1 ? x + 1 : w - 1;
      t[r + x] = a[r + l] + a[r + x] + a[r + rr];
    }
  }
  for (let y = 0; y < h; y++) {
    const u = (y > 0 ? y - 1 : 0) * w, c = y * w, d = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) o[c + x] = (t[u + x] + t[c + x] + t[d + x]) / 9;
  }
  return o;
}

// Coordonnées image de détection ↔ image source
export const toSmall = (img, [x, y]) => [(x - img.x0) * img.kx, (y - img.y0) * img.ky];
export const fromSmall = (img, [x, y]) => [img.x0 + x / img.kx, img.y0 + y / img.ky];

// ---------------------------------------------------------------------------------------------------------
// Profils perpendiculaires à un côté et pics de gradient

function sideGeometry(q, s) {
  const p0 = q[s], p1 = q[(s + 1) % 4];
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  const u = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
  return { p0, p1, L, u, n: [u[1], -u[0]], mid: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2] };
}

export function guideHeight(q) {
  return (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])) / 2;
}

// Points de bord d'un côté : [{ s, d, w, k }] (s le long du côté depuis son milieu, d vers l'extérieur, w force, k profil)
function sidePoints(img, geo, h, nLines = 60, step = 0.5, inLen = 0.12, outLen = 0.20) {
  const { ch, w: W, h: H } = img;
  const d0 = -inLen * h, nd = Math.ceil((outLen + inLen) * h / step);
  const prof = [new Float32Array(nd), new Float32Array(nd), new Float32Array(nd)], der = new Float32Array(nd);
  const pts = [];
  const xm = W - 1, ym = H - 1;
  for (let li = 0; li < nLines; li++) {
    const t = 0.12 + 0.76 * li / (nLines - 1);
    const bx = geo.p0[0] + (geo.p1[0] - geo.p0[0]) * t, by = geo.p0[1] + (geo.p1[1] - geo.p0[1]) * t;
    for (let j = 0; j < nd; j++) {
      const dd = d0 + j * step;
      let x = bx + geo.n[0] * dd - 0.5, y = by + geo.n[1] * dd - 0.5;
      if (x < 0) x = 0; else if (x > xm) x = xm;
      if (y < 0) y = 0; else if (y > ym) y = ym;
      let ix = x | 0, iy = y | 0;
      if (ix > W - 2) ix = W - 2;
      if (iy > H - 2) iy = H - 2;
      const fx = x - ix, fy = y - iy, i = iy * W + ix;
      for (let c = 0; c < 3; c++) {
        const a = ch[c];
        const top = a[i] + (a[i + 1] - a[i]) * fx, bot = a[i + W] + (a[i + W + 1] - a[i + W]) * fx;
        prof[c][j] = top + (bot - top) * fy;
      }
    }
    let mx = 0;
    for (let j = 0; j < nd; j++) {
      let best = 0;
      for (let c = 0; c < 3; c++) {
        const p = prof[c];
        const g = j === 0 ? (p[1] - p[0]) / step : j === nd - 1 ? (p[nd - 1] - p[nd - 2]) / step : (p[j + 1] - p[j - 1]) / (2 * step);
        const a = g < 0 ? -g : g;
        if (a > best) best = a;
      }
      der[j] = best;
      if (best > mx) mx = best;
    }
    const thr = Math.max(5, 0.25 * mx), peaks = [];
    for (let j = 1; j < nd - 1; j++) {
      const b = der[j];
      if (b > thr && b > der[j - 1] && b >= der[j + 1]) peaks.push(j);
    }
    if (peaks.length > 5) peaks.sort((a, b) => der[b] - der[a]).length = 5;
    const s = (t - 0.5) * geo.L;
    for (const j of peaks) {
      const a = der[j - 1], b = der[j], c = der[j + 1], den = a - 2 * b + c;
      let off = den < 0 ? 0.5 * (a - c) / den : 0;
      if (off > 0.5) off = 0.5; else if (off < -0.5) off = -0.5;
      // amplitude de la marche (moyennes à 1,5–4 px de part et d'autre) : netteté = pente / marche (sans contraste)
      let amp = 0;
      if (j >= 8 && j < nd - 8) {
        for (let ci = 0; ci < 3; ci++) {
          const p = prof[ci];
          let lo = 0, hi = 0;
          for (let q = 3; q <= 8; q++) { lo += p[j - q]; hi += p[j + q]; }
          const v = Math.abs(hi - lo) / 6;
          if (v > amp) amp = v;
        }
      }
      pts.push({ s, d: d0 + (j + off) * step, w: b, k: li, n: amp >= 8 ? b / amp : -1 });
    }
  }
  return pts;
}

// Petite transformée de Hough (angle ±15°, pas 0,5° ; décalage par pas de 0,75 px) → pics [{ v, th, d }]
function houghPeaks(pts, h, maxPeaks = 6) {
  if (pts.length < 6) return [];
  const NT = 61, tans = new Float64Array(NT);
  for (let i = 0; i < NT; i++) tans[i] = Math.tan((-15 + 0.5 * i) * DEG);
  let dmn = Infinity, dmx = -Infinity, smx = 0;
  for (const p of pts) { if (p.d < dmn) dmn = p.d; if (p.d > dmx) dmx = p.d; if (Math.abs(p.s) > smx) smx = Math.abs(p.s); }
  const ext = smx * Math.tan(15 * DEG), dmin = dmn - 2 - ext, dmax = dmx + 2 + ext, STEP = 0.75;
  const nb = Math.floor((dmax - dmin) / STEP) + 2;
  const acc = new Float32Array(NT * nb);
  for (const p of pts) {
    for (let ti = 0; ti < NT; ti++) {
      const b = Math.floor((p.d - p.s * tans[ti] - dmin) / STEP);
      if (b >= 0 && b < nb) acc[ti * nb + b] += p.w;
    }
  }
  const sm = new Float32Array(acc.length);
  for (let ti = 0; ti < NT; ti++) {
    const r = ti * nb;
    for (let b = 0; b < nb; b++) sm[r + b] = acc[r + b] + 0.5 * ((b > 0 ? acc[r + b - 1] : 0) + (b < nb - 1 ? acc[r + b + 1] : 0));
  }
  const peaks = [], di = 4, dj = Math.round(Math.max(2, 0.008 * h) / STEP);
  for (let it = 0; it < maxPeaks; it++) {
    let bv = 0, bi = -1;
    for (let i = 0; i < sm.length; i++) if (sm[i] > bv) { bv = sm[i]; bi = i; }
    if (bi < 0) break;
    const ti = (bi / nb) | 0, b = bi - ti * nb;
    peaks.push({ v: bv, th: -15 + 0.5 * ti, d: dmin + (b + 0.5) * STEP });
    for (let i = Math.max(0, ti - di); i <= Math.min(NT - 1, ti + di); i++) {
      for (let j = Math.max(0, b - dj); j <= Math.min(nb - 1, b + dj); j++) sm[i * nb + j] = 0;
    }
  }
  return peaks;
}

// Moindres carrés sur les points proches (≤ 1,2 px) : angle et décalage affinés, couverture (part des profils)
function refine(pts, th, d, nLines = 60, tol = 1.2) {
  const t = Math.tan(th * DEG), c = Math.cos(th * DEG);
  let n = 0, ss = 0, sd = 0, sss = 0, ssd = 0, sw = 0, sn = 0, nn = 0;
  const seen = new Uint8Array(nLines);
  for (const p of pts) {
    if (Math.abs(p.d - (p.s * t + d)) * c < tol) {
      n++; ss += p.s; sd += p.d; sss += p.s * p.s; ssd += p.s * p.d; sw += p.w; seen[p.k] = 1;
      if (p.n >= 0) { sn += p.n; nn++; }
    }
  }
  let cov = 0;
  for (let i = 0; i < nLines; i++) cov += seen[i];
  const nsh = nn ? sn / nn : 0;
  if (n >= 6) {
    const den = n * sss - ss * ss;
    if (Math.abs(den) > 1e-9) {
      const a = (n * ssd - ss * sd) / den, b = (sd - a * ss) / n;
      return { th: Math.atan(a) / DEG, d: b, cov: cov / nLines, str: sw / n, nsh };
    }
  }
  return { th, d, cov: cov / nLines, str: n ? sw / n : 0, nsh };
}

// Droite d'un côté à partir de (th, d) dans le repère du côté
function lineOf(geo, th, d) {
  const c = Math.cos(th * DEG), s = Math.sin(th * DEG);
  return { p: [geo.mid[0] + geo.n[0] * d, geo.mid[1] + geo.n[1] * d], v: [geo.u[0] * c + geo.n[0] * s, geo.u[1] * c + geo.n[1] * s], d, th };
}

// ---------------------------------------------------------------------------------------------------------
// Options par côté

// guide : quadrilatère [tl, tr, br, bl] dans l'image de détection. extra = options supplémentaires
// (porte-carte rigide : pics plus faibles et décalages vers l'intérieur).
export function sideOptions(img, guide, { peaks = 3, extra = false } = {}) {
  const h = guideHeight(guide), bw = BORDER * h, sides = [];
  for (let s = 0; s < 4; s++) {
    const geo = sideGeometry(guide, s);
    const pts = sidePoints(img, geo, h);
    const pk = houghPeaks(pts, h, extra ? 6 : Math.max(peaks, 3));
    const opts = [], info = [];
    const push = (th, d, meta) => {
      if (opts.some(o => Math.abs(d - o.d) < 0.004 * h && Math.abs(th - o.th) < 1)) return;
      opts.push(lineOf(geo, th, d)); info.push(meta);
    };
    const refined = pk.map(p => ({ ...refine(pts, p.th, p.d), v: p.v }));
    for (const r of refined.slice(0, peaks)) { push(r.th, r.d, r); push(r.th, r.d + bw, r); }
    if (extra) {
      for (const r of refined.slice(peaks)) { push(r.th, r.d, r); push(r.th, r.d + bw, r); }
      for (const r of refined.slice(0, 2)) for (const m of [0.045, 0.065, 0.085]) push(r.th, r.d - m * h, r);
    }
    if (!opts.length) { opts.push(lineOf(geo, 0, 0)); info.push({ cov: 0, str: 0, v: 0, th: 0, d: 0 }); }
    sides.push({ opts, info, pts: pts.length, best: refined[0] || null, geo });
  }
  return { sides, h };
}

// Intersection des 4 droites → quad [tl, tr, br, bl] ou null (rapport largeur / hauteur hors tolérance, non convexe)
export function quadFrom(lines, { tol = 0.08, landscape = false } = {}) {
  const c = [];
  for (const [a, b] of [[3, 0], [0, 1], [1, 2], [2, 3]]) {
    const { p, v: u } = lines[a], { p: q, v } = lines[b];
    const det = -u[0] * v[1] + v[0] * u[1];
    if (Math.abs(det) < 1e-6) return null;
    const dx = q[0] - p[0], dy = q[1] - p[1], t = (-dx * v[1] + v[0] * dy) / det;
    c.push([p[0] + u[0] * t, p[1] + u[1] * t]);
  }
  const d = (i, j) => Math.hypot(c[j][0] - c[i][0], c[j][1] - c[i][1]);
  const wt = d(0, 1), wb = d(3, 2), hl = d(0, 3), hr = d(1, 2);
  const ratio = (wt + wb) / Math.max(1e-3, hl + hr), want = landscape ? 1 / RATIO : RATIO;
  if (Math.abs(ratio - want) > tol * (landscape ? want / RATIO : 1)) return null;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], e = c[(i + 2) % 4];
    const z = (b[0] - a[0]) * (e[1] - b[1]) - (b[1] - a[1]) * (e[0] - b[0]);
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return null;
  }
  return c;
}

// Quad « affiché » sans base de cartes (boucle de détection) : bord extérieur si une bande de bord est visible,
// sinon la droite la plus forte. Retourne aussi le nombre de côtés trouvés et la netteté moyenne des bords.
export function displayQuad(so) {
  const lines = [], h = so.h;
  let found = 0, str = 0, nsh = 0;
  for (const side of so.sides) {
    const b = side.best;
    if (!b) { lines.push(side.opts[0]); continue; }
    let pick = 0;
    // bande de bord : une parallèle 1,5–5 % plus à l'extérieur, assez soutenue
    for (let i = 2; i < side.opts.length; i += 2) {
      const o = side.info[i];
      if (o && Math.abs(o.th - b.th) <= 2 && o.d - b.d >= 0.015 * h && o.d - b.d <= 0.05 * h && o.v >= 0.25 * b.v) { pick = i; break; }
    }
    lines.push(side.opts[pick]);
    if (b.cov >= 0.4) { found++; str += b.str; nsh += b.nsh || 0; }
  }
  let quad = quadFrom(lines, { tol: 0.12 });
  // pas de quad aux proportions d'une carte (étui, sleeve : bord de l'étui sur un côté, de la carte sur un autre) :
  // combinaisons des 3 premiers pics de chaque côté, la plus soutenue aux bonnes proportions
  if (!quad && found >= 3) {
    const opts = so.sides.map((side, k) => {
      const o = [];
      for (let i = 0; i < side.opts.length && o.length < 3; i += 2) if (i === 0 || (side.info[i]?.cov ?? 0) >= 0.3) o.push(i);
      return o.length ? o : [0];
    });
    let best = -1;
    for (const a of opts[0]) for (const b of opts[1]) for (const c of opts[2]) for (const d of opts[3]) {
      const ch = [a, b, c, d], q = quadFrom(ch.map((i, k) => so.sides[k].opts[i]), { tol: 0.12 });
      if (!q) continue;
      let v = 0;
      ch.forEach((i, k) => { v += so.sides[k].info[i]?.v ?? 0; });
      if (v > best) { best = v; quad = q; }
    }
  }
  // netteté : force moyenne des bords (dépend du contraste) et pente / marche (indépendante du contraste)
  return { quad, found, sharp: found ? str / found : 0, nsharp: found ? nsh / found : 0 };
}

// Recherche « analyse par synthèse » : descente par coordonnées sur les options de chaque côté,
// objectif = distance de la meilleure carte de la base (plus petit = mieux). Les évaluations sont mises en cache.
export function search(so, objective, { passes = 2, seeds = null, cache = new Map(), landscape = false } = {}) {
  const opts = so.sides.map(s => s.opts);
  const f = ch => {
    const key = ch.join(',');
    let r = cache.get(key);
    if (!r) {
      const q = quadFrom(ch.map((c, i) => opts[i][c]), { landscape });
      r = q ? { score: objective(q), quad: q } : { score: Infinity, quad: null };
      cache.set(key, r);
    }
    return r.score;
  };
  const start = seeds || [[0, 0, 0, 0], opts.map(o => Math.min(1, o.length - 1))];
  let choice = start.reduce((a, b) => (f(b) < f(a) ? b : a));
  choice = [...choice];
  for (let p = 0; p < passes; p++) {
    let improved = false;
    for (let s = 0; s < 4; s++) {
      for (let c = 0; c < opts[s].length; c++) {
        if (c === choice[s]) continue;
        const trial = [...choice];
        trial[s] = c;
        if (f(trial) < f(choice)) { choice = trial; improved = true; }
      }
    }
    if (!improved) break;
  }
  const r = cache.get(choice.join(','));
  return { quad: r.quad, score: r.score, choice, nev: cache.size };
}

// Guide (rectangle x, y, w, h) → quadrilatère, éventuellement réduit autour de son centre
export function rectQuad(x, y, w, h, scale = 1) {
  const cx = x + w / 2, cy = y + h / 2, hw = w * scale / 2, hh = h * scale / 2;
  return [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
}

// ---------------------------------------------------------------------------------------------------------
// Détecteur sans guide (photo importée) : gradient couleur + Hough global → paires de droites parallèles
// → quadrilatères de proportions carte, classés par le soutien des bords. Retourne des guides candidats.

export function proposals(img, { max = 8 } = {}) {
  const { ch, w: W, h: H } = img;
  // gradient de Sobel, maximum sur les 3 canaux
  const mag = new Float32Array(W * H), ang = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let bm = 0, bgx = 0, bgy = 0;
      for (let c = 0; c < 3; c++) {
        const a = ch[c];
        const gx = a[i - W + 1] + 2 * a[i + 1] + a[i + W + 1] - a[i - W - 1] - 2 * a[i - 1] - a[i + W - 1];
        const gy = a[i + W - 1] + 2 * a[i + W] + a[i + W + 1] - a[i - W - 1] - 2 * a[i - W] - a[i - W + 1];
        const m = gx * gx + gy * gy;
        if (m > bm) { bm = m; bgx = gx; bgy = gy; }
      }
      mag[i] = Math.sqrt(bm);
      ang[i] = Math.atan2(bgy, bgx);
    }
  }
  // seuil : 90e centile des magnitudes non nulles
  const sample = [];
  for (let i = 0; i < mag.length; i += 7) if (mag[i] > 0) sample.push(mag[i]);
  sample.sort((a, b) => a - b);
  const thr = Math.max(40, sample[Math.floor(sample.length * 0.9)] || 40);
  // Hough global : θ (normale) 0..179°, ρ par pas de 1 px, vote si l'orientation du gradient concorde (±12°)
  const NT = 180, diag = Math.ceil(Math.hypot(W, H)), NR = 2 * diag + 1;
  const acc = new Float32Array(NT * NR), cs = new Float64Array(NT), sn = new Float64Array(NT);
  for (let t = 0; t < NT; t++) { cs[t] = Math.cos(t * DEG); sn[t] = Math.sin(t * DEG); }
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, m = mag[i];
      if (m < thr) continue;
      let a = ang[i] / DEG;
      if (a < 0) a += 180;
      if (a >= 180) a -= 180;
      const xc = x + 0.5, yc = y + 0.5, a0 = Math.round(a);
      for (let dt = -12; dt <= 12; dt++) {
        const t = (a0 + dt + 180) % 180;
        const r = Math.round(xc * cs[t] + yc * sn[t]) + diag;
        acc[t * NR + r] += m;
      }
    }
  }
  // pics avec suppression des voisins (±4°, ±6 px)
  const lines = [];
  const a2 = acc.slice();
  for (let it = 0; it < 28; it++) {
    let bv = 0, bi = -1;
    for (let i = 0; i < a2.length; i++) if (a2[i] > bv) { bv = a2[i]; bi = i; }
    if (bi < 0 || bv <= 0) break;
    const t = (bi / NR) | 0, r = bi - t * NR - diag;
    lines.push({ t, r, v: bv });
    for (let dt = -4; dt <= 4; dt++) {
      const tt = (t + dt + NT) % NT, flip = t + dt < 0 || t + dt >= NT;
      const rr = flip ? -r : r;
      for (let dr = -6; dr <= 6; dr++) {
        const j = rr + dr + diag;
        if (j >= 0 && j < NR) a2[tt * NR + j] = 0;
      }
    }
  }
  // paires parallèles (θ ±8°) assez éloignées
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const A = lines[i], B = lines[j];
      let dt = Math.abs(A.t - B.t), rb = B.r;
      if (dt > 90) { dt = 180 - dt; rb = -B.r; }
      if (dt > 8) continue;
      const sep = Math.abs(A.r - rb);
      if (sep < 0.12 * Math.min(W, H)) continue;
      pairs.push({ A, B, t: A.t, sep, v: Math.min(A.v, B.v) });
    }
  }
  const quads = [];
  const lineObj = L => {
    const t = L.t * DEG, n = [Math.cos(t), Math.sin(t)];
    return { p: [n[0] * L.r, n[1] * L.r], v: [-n[1], n[0]] };
  };
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const P = pairs[i], Q = pairs[j];
      let dt = Math.abs(P.t - Q.t);
      if (dt > 90) dt = 180 - dt;
      if (Math.abs(dt - 90) > 14) continue;
      const ratio = Math.min(P.sep, Q.sep) / Math.max(P.sep, Q.sep);
      if (Math.abs(ratio - RATIO) > 0.12) continue;
      const L = [P.A, Q.A, P.B, Q.B].map(lineObj);
      const pts = [];
      let ok = true;
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
        const u = L[a].v, v = L[b].v, det = -u[0] * v[1] + v[0] * u[1];
        if (Math.abs(det) < 1e-6) { ok = false; break; }
        const dx = L[b].p[0] - L[a].p[0], dy = L[b].p[1] - L[a].p[1], tt = (-dx * v[1] + v[0] * dy) / det;
        pts.push([L[a].p[0] + u[0] * tt, L[a].p[1] + u[1] * tt]);
      }
      if (!ok) continue;
      if (pts.some(([x, y]) => x < -0.05 * W || y < -0.05 * H || x > 1.05 * W || y > 1.05 * H)) continue;
      const q = orderQuad(pts);
      const score = edgeSupport(mag, W, H, q, thr);
      if (score < 0.35) continue;
      quads.push({ q, score: score * Math.sqrt(Math.min(P.sep, Q.sep)) });
    }
  }
  quads.sort((a, b) => b.score - a.score);
  // suppression des doublons (centres et tailles proches)
  const keep = [];
  for (const c of quads) {
    const cc = center(c.q), hh = guideHeight(c.q);
    if (keep.some(k => Math.hypot(cc[0] - k.c[0], cc[1] - k.c[1]) < 0.15 * hh && Math.abs(guideHeight(k.q) - hh) < 0.15 * hh)) continue;
    keep.push({ ...c, c: cc });
    if (keep.length >= max) break;
  }
  return keep.map(k => k.q);
}

function center(q) { return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4]; }

// Ordonne 4 points en [tl, tr, br, bl] (sens horaire à l'écran, premier point en haut à gauche)
export function orderQuad(pts) {
  const c = center(pts);
  const s = [...pts].sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  let k = 0, best = Infinity;
  for (let i = 0; i < 4; i++) { const v = s[i][0] + s[i][1]; if (v < best) { best = v; k = i; } }
  return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]];
}

// Part des points des 4 côtés où le gradient dépasse le seuil
function edgeSupport(mag, W, H, q, thr) {
  let hit = 0, tot = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(8, Math.round(L / 3));
    for (let i = 1; i < n; i++) {
      const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      tot++;
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xi = Math.floor(x) + dx, yi = Math.floor(y) + dy;
          if (xi >= 0 && yi >= 0 && xi < W && yi < H && mag[yi * W + xi] > m) m = mag[yi * W + xi];
        }
      }
      if (m >= thr * 0.6) hit++;
    }
  }
  return tot ? hit / tot : 0;
}

// Rotations d'un quad détecté : la carte peut être tournée de 90° / 180° dans une photo importée.
export function rotations(q) {
  const d = (i, j) => Math.hypot(q[j][0] - q[i][0], q[j][1] - q[i][1]);
  const landscape = d(0, 1) + d(3, 2) > d(0, 3) + d(1, 2);
  const r = k => [q[k % 4], q[(k + 1) % 4], q[(k + 2) % 4], q[(k + 3) % 4]];
  return landscape ? [r(1), r(3)] : [r(0), r(2)];
}
