// Descripteurs perceptuels d'une carte : dHash 256 bits + pHash 256 bits (64 octets par carte).
// L'algorithme est identique, opération par opération, à tools/build_scan.py (test de bit-exactitude
// dans tools/scan_bench.py) : toute modification doit être faite des deux côtés, puis relancer le builder.
//
// Conventions : un pixel (i, j) a son centre en (i + 0,5 ; j + 0,5) ; une image W×H couvre [0, W]×[0, H].
// La carte canonique fait CW×CH ; un quadrilatère est [[x, y] haut-gauche, haut-droite, bas-droite, bas-gauche].

export const CW = 256, CH = 352;               // carte canonique (largeur, hauteur)
export const REGION = [10, 11, 246, 341];      // zone hachée : x0, y0, x1, y1 (4 %, 3 %, 96 %, 97 %)
export const RATIO = 63 / 88;                  // largeur / hauteur d'une carte
export const BYTES = 64;                       // 32 octets dHash + 32 octets pHash

// cos(πj/128) pour j = 0..64 : littéraux partagés avec le builder (évite tout écart de libm)
const C128 = [1.0, 0.9996988186962042, 0.9987954562051724, 0.9972904566786902, 0.9951847266721969,
  0.99247953459871, 0.989176509964781, 0.9852776423889412, 0.9807852804032304, 0.9757021300385286,
  0.970031253194544, 0.9637760657954398, 0.9569403357322088, 0.9495281805930367, 0.9415440651830208,
  0.932992798834739, 0.9238795325112867, 0.9142097557035307, 0.9039892931234433, 0.8932243011955153,
  0.881921264348355, 0.8700869911087115, 0.8577286100002721, 0.8448535652497071, 0.8314696123025452,
  0.8175848131515837, 0.8032075314806449, 0.7883464276266062, 0.773010453362737, 0.7572088465064846,
  0.7409511253549592, 0.724247082951467, 0.7071067811865476, 0.6895405447370669, 0.6715589548470183,
  0.6531728429537769, 0.6343932841636455, 0.6152315905806268, 0.5956993044924335, 0.5758081914178453,
  0.5555702330196023, 0.5349976198870973, 0.5141027441932217, 0.4928981922297841, 0.4713967368259978,
  0.4496113296546066, 0.4275550934302822, 0.40524131400498986, 0.38268343236508984, 0.3598950365349883,
  0.33688985339222005, 0.3136817403988916, 0.29028467725446233, 0.2667127574748984, 0.24298017990326398,
  0.21910124015686977, 0.19509032201612833, 0.17096188876030136, 0.14673047445536175, 0.12241067519921628,
  0.09801714032956077, 0.07356456359966745, 0.049067674327418126, 0.024541228522912264, 0.0];

// Matrice DCT-II orthonormée 64 points, seules les 16 premières lignes servent (bloc 16×16).
const COS = (() => {
  const m = new Float64Array(16 * 64);
  for (let k = 0; k < 16; k++) {
    const a = k === 0 ? Math.sqrt(1 / 64) : Math.sqrt(2 / 64);
    for (let n = 0; n < 64; n++) {
      const j = ((2 * n + 1) * k) % 256;
      const c = j <= 64 ? C128[j] : j <= 128 ? -C128[128 - j] : j <= 192 ? -C128[j - 128] : C128[256 - j];
      m[k * 64 + n] = a * c;
    }
  }
  return m;
})();

// Poids exacts de recouvrement (moyenne de surface, comme INTER_AREA en réduction).
function areaWeights(sn, dn) {
  const s = sn / dn, out = [];
  for (let i = 0; i < dn; i++) {
    const a = i * s, b = a + s, idx = [], c = [];
    for (let j = Math.floor(a); j < Math.ceil(b - 1e-9); j++) {
      const cov = Math.min(b, j + 1) - Math.max(a, j);
      if (cov > 1e-9) { idx.push(j); c.push(cov / s); }
    }
    out.push({ idx: Int32Array.from(idx), c: Float64Array.from(c) });
  }
  return out;
}
const WCACHE = new Map();
export function weights(sn, dn) {
  const k = sn * 100000 + dn;
  let w = WCACHE.get(k);
  if (!w) WCACHE.set(k, w = areaWeights(sn, dn));
  return w;
}

// Redimensionnement par moyenne de surface d'un rectangle (x0, y0, sw, sh) de src (largeur de ligne stride),
// séparable : d'abord les colonnes, puis les lignes. Retourne un Float64Array dw×dh.
export function areaResize(src, stride, x0, y0, sw, sh, dw, dh) {
  const wx = weights(sw, dw), wy = weights(sh, dh);
  const tmp = new Float64Array(dw * sh), out = new Float64Array(dw * dh);
  for (let y = 0; y < sh; y++) {
    const row = (y0 + y) * stride + x0, o = y * dw;
    for (let x = 0; x < dw; x++) {
      const { idx, c } = wx[x];
      let s = 0;
      for (let t = 0; t < idx.length; t++) s += src[row + idx[t]] * c[t];
      tmp[o + x] = s;
    }
  }
  for (let y = 0; y < dh; y++) {
    const { idx, c } = wy[y], o = y * dw;
    for (let x = 0; x < dw; x++) {
      let s = 0;
      for (let t = 0; t < idx.length; t++) s += tmp[idx[t] * dw + x] * c[t];
      out[o + x] = s;
    }
  }
  return out;
}

// Image de référence (RGBA, alpha composé sur blanc) → carte canonique en niveaux de gris (Float64Array CW×CH).
export function canonFromRGBA(data, w, h) {
  const g = new Float64Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const a = data[p + 3], k = 255 * (255 - a);
    const r = (data[p] * a + k) / 255, gg = (data[p + 1] * a + k) / 255, b = (data[p + 2] * a + k) / 255;
    g[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
  }
  return areaResize(g, w, 0, 0, w, h, CW, CH);
}

// Niveaux de gris d'une image vidéo / photo (sans alpha), Float32Array.
export function grayRGBA(data, w, h, out = new Float32Array(w * h)) {
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  return out;
}

// Homographie (forme fermée carré → quadrilatère) qui envoie le canonique (u, v) ∈ [0, w]×[0, h] sur le quad.
// Retourne [a, b, c, d, e, f, g, h, 1] : x = (a u + b v + c) / (g u + h v + 1), y = (d u + e v + f) / (…).
export function homography(q, w = CW, h = CH) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  if (!den) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  return [a / w, b / h, x0, d / w, e / h, y0, g / w, hh / h, 1];
}

export function project(M, u, v) {
  const z = M[6] * u + M[7] * v + M[8];
  return [(M[0] * u + M[1] * v + M[2]) / z, (M[3] * u + M[4] * v + M[5]) / z];
}

// Échantillonnage bilinéaire de la zone hachée à travers l'homographie (gris Float32Array W×H).
// Seule la zone REGION de la carte canonique est remplie.
export function warpRegion(gray, W, H, quad, out = new Float64Array(CW * CH)) {
  const M = homography(quad);
  if (!M) return null;
  const [rx0, ry0, rx1, ry1] = REGION, xm = W - 1, ym = H - 1;
  for (let v = ry0; v < ry1; v++) {
    const vv = v + 0.5, u0 = rx0 + 0.5;
    let X = M[0] * u0 + M[1] * vv + M[2], Y = M[3] * u0 + M[4] * vv + M[5], Z = M[6] * u0 + M[7] * vv + 1;
    let o = v * CW + rx0;
    for (let u = rx0; u < rx1; u++, o++) {
      let x = X / Z - 0.5, y = Y / Z - 0.5;
      X += M[0]; Y += M[3]; Z += M[6];
      if (x < 0) x = 0; else if (x > xm) x = xm;
      if (y < 0) y = 0; else if (y > ym) y = ym;
      let ix = x | 0, iy = y | 0;
      if (ix > W - 2) ix = W - 2;
      if (iy > H - 2) iy = H - 2;
      const fx = x - ix, fy = y - iy, i = iy * W + ix;
      const top = gray[i] + (gray[i + 1] - gray[i]) * fx, bot = gray[i + W] + (gray[i + W + 1] - gray[i + W]) * fx;
      out[o] = top + (bot - top) * fy;
    }
  }
  return out;
}

// Carte canonique tournée de 180° (carte à l'envers).
export function rotate180(c) {
  const out = new Float64Array(c.length);
  for (let i = 0, n = c.length - 1; i <= n; i++) out[i] = c[n - i];
  return out;
}

// Descripteur 64 octets : dHash 17×16 puis pHash (DCT 64×64, bloc 16×16 > médiane hors DC), bits MSB d'abord.
export function describe(c, out = new Uint8Array(BYTES)) {
  const [x0, y0, x1, y1] = REGION, sw = x1 - x0, sh = y1 - y0;
  out.fill(0);
  const d = areaResize(c, CW, x0, y0, sw, sh, 17, 16);
  for (let y = 0, bit = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++, bit++) if (d[y * 17 + x + 1] > d[y * 17 + x]) out[bit >> 3] |= 0x80 >> (bit & 7);
  }
  const p = areaResize(c, CW, x0, y0, sw, sh, 64, 64);
  const t = new Float64Array(16 * 64), low = new Float64Array(256);
  for (let k = 0; k < 16; k++) {
    for (let n = 0; n < 64; n++) {
      let s = 0;
      for (let i = 0; i < 64; i++) s += COS[k * 64 + i] * p[i * 64 + n];
      t[k * 64 + n] = s;
    }
  }
  for (let k = 0; k < 16; k++) {
    for (let l = 0; l < 16; l++) {
      let s = 0;
      for (let n = 0; n < 64; n++) s += t[k * 64 + n] * COS[l * 64 + n];
      low[k * 16 + l] = s;
    }
  }
  const med = low.slice(1).sort()[127];
  for (let i = 0; i < 256; i++) if (low[i] > med) out[32 + (i >> 3)] |= 0x80 >> (i & 7);
  return out;
}

// Comptage de bits : table 16 bits (plus rapide que l'astuce SWAR dans V8).
export const POP16 = (() => {
  const t = new Uint8Array(65536);
  for (let i = 1; i < 65536; i++) t[i] = (i & 1) + t[i >> 1];
  return t;
})();
export const pop32 = x => POP16[x & 0xffff] + POP16[x >>> 16];

// Distance entre deux descripteurs (bits différents / 128 ; ≈ 2 pour deux cartes sans rapport).
export function distance(a, b) {
  let s = 0;
  for (let i = 0; i < BYTES; i++) s += POP16[a[i] ^ b[i]];
  return s / 128;
}
