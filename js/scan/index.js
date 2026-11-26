// API publique du scanner (SPEC §5.7). Aucune interface ici : la vue (js/views/scanner.js) s'appuie dessus.
//   preload(onProgress?)                 base des cartes (data/scan/hashes.bin + cards.json) et worker
//   openCamera(video) / closeCamera()     caméra arrière 1080p ; setTorch(on) / setZoom(z)
//   createLoop({ video, guide, onState, onResult, auto? })   boucle de scan en direct
//   identifyImage(source)                photo importée (sans guide)
//   ocrFallback(source, hint?)           lecture du code de série et du numéro (tesseract, chargé à la demande)
//
// Exemple (vue) :
//   const { caps } = await scan.openCamera(videoEl);              // CameraError.kind : insecure | denied | nocamera…
//   const loop = scan.createLoop({ video: videoEl, guide: guideEl, auto: prefs.get('scanAuto', true),
//     onState: s => { pill.textContent = s.hint; drawQuad(s.quad, s.state); },       // quad en px CSS de la vidéo
//     onResult: r => (r.decision === 'accept' ? showResult(r) : showChooser(r)) });  // r.best.id, r.candidates…
//   loop.start();  …  loop.resume() (« Scanner une autre carte »)  …  loop.destroy(); scan.closeCamera();
// États : searching | detected | identifying | uncertain | paused | error (base des cartes indisponible : s.error =
// offline | timeout | network | server | notfound, nouvel essai automatique). s.found = côtés trouvés (vert si 4).
// Résultats : plusieurs « choose » peuvent arriver pour la même carte (image, puis lecture OCR) : le dernier remplace
// le précédent ; « accept » termine (pause jusqu'à ce que la carte sorte). Champs ajoutés : why (raison d'un choix :
// incertaine | zone-reseau | zone-canvas | zone-marge | jumelles | …), token (pour ocrFallback), level, region.
// Après un choix fait dans la liste : loop.hold() (pause comme après une acceptation). loop.setAuto(bool).
import * as net from '../core/net.js';
import { call, setCards, getCards, frameOf, OFFSCREEN } from './client.js';
import { createLoop as makeLoop, settle, resultOf, LOOP } from './loop.js';

export { openCamera, closeCamera, setTorch, setZoom, CameraError, torchState, cameraOpen } from './camera.js';
export { LOOP } from './loop.js';

const ROOT = new URL('../../', import.meta.url).href;
const MAX_IMPORT = 2560;   // côté maximal d'une photo importée (pixels)

// Erreur typée : kind = decode (fichier qui n'est pas une image lisible)
export class ScanError extends Error {
  constructor(kind, message) { super(message); this.name = 'ScanError'; this.kind = kind; }
}

let pre = null;

// Adresse d'un fichier de data/ : hash du manifeste (cache immuable du service worker) quand la page est l'appli
async function dataUrl(path) {
  const url = new URL(path, ROOT).href;
  const atRoot = typeof location !== 'undefined' && new URL('./', location.href).href === ROOT;
  if (atRoot && typeof net.hashOf === 'function') {
    try {
      const h = await net.hashOf(path);
      if (h) return { url: `${url}?h=${h}`, init: {} };
    } catch { /* pas de manifeste : chemin simple */ }
  }
  return { url, init: { cache: 'no-cache' } };
}

// Téléchargement en flux avec délai d'inactivité (aucun octet pendant `idle` ms → abandon) : un réseau lent
// mais vivant termine toujours. onBytes(n) à chaque morceau.
export const FETCH = { first: 20000, idle: 15000 };
async function fetchBytes(path, onBytes = null) {
  const { url, init } = await dataUrl(path);
  const ctl = new AbortController();
  let t = setTimeout(() => ctl.abort(), FETCH.first);
  const alive = () => { clearTimeout(t); t = setTimeout(() => ctl.abort(), FETCH.idle); };
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new net.NetError(res.status === 404 ? 'notfound' : 'server', res.status, url);
    alive();
    if (!res.body) return await res.arrayBuffer();
    const reader = res.body.getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      alive();
      parts.push(value);
      n += value.length;
      onBytes?.(n);
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out.buffer;
  } catch (e) {
    if (e instanceof net.NetError) throw e;
    throw new net.NetError(ctl.signal.aborted ? 'timeout' : navigator.onLine === false ? 'offline' : 'network', 0, url);
  } finally {
    clearTimeout(t);
  }
}

// Charge la base et démarre le worker. onProgress(fraction 0–1). Appels multiples : une seule fois ;
// après un échec (NetError : offline | timeout | network | server | notfound), l'appel suivant réessaie.
export function preload(onProgress) {
  if (pre) {
    if (onProgress) pre.then(() => onProgress(1), () => {});
    return pre;
  }
  pre = (async () => {
    onProgress?.(0);
    const cardsBuf = await fetchBytes('data/scan/cards.json');
    const cards = JSON.parse(new TextDecoder().decode(cardsBuf));
    onProgress?.(0.15);
    const total = cards.ids.length * 64;
    const buf = await fetchBytes('data/scan/hashes.bin', n => onProgress?.(0.15 + 0.8 * Math.min(1, n / total)));
    if (buf.byteLength !== total) throw new net.NetError('server', 0, 'data/scan/hashes.bin');
    setCards(cards);
    const info = await call('init', { buf, cards, canvas: OFFSCREEN }, [buf]);
    onProgress?.(1);
    // canvas : false = navigateur sans OffscreenCanvas (zone du numéro indisponible : réimpressions → choix)
    return { cards: info.n, groups: info.groups, noimg: (cards.noimg || []).length, built: cards.built, canvas: info.canvas };
  })();
  pre.catch(() => { pre = null; });
  return pre;
}

// Boucle de scan. guide : rectangle du guide en pixels CSS relatifs à la vidéo ({ x, y, width, height }),
// ou l'élément du guide (recalculé à chaque image), ou une fonction qui renvoie l'un des deux.
// auto (défaut true) : false = identification seulement à l'appui sur shutter() (préférence scanAuto).
export function createLoop(opts) {
  return makeLoop({ ...opts, ready: () => preload() });
}

// ---------------------------------------------------------------------------------------------------------
// Photo importée : dimensions lues dans l'en-tête (JPEG / PNG / WebP / GIF, orientation EXIF comprise) pour
// décoder directement à ≤ 2 560 px (une photo de 50 Mpx décodée en entier occuperait ≈ 200 Mo).

function exifOrientation(v, o, end) {
  // v : DataView ; o : début du segment APP1 (après la longueur)
  if (v.getUint32(o) !== 0x45786966) return 1;                 // « Exif »
  const t = o + 6, le = v.getUint16(t) === 0x4949;
  const u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return 1;
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) return u16(e + 8) || 1;
  }
  return 1;
}

export async function imageSize(blob) {
  try {
    const buf = await blob.slice(0, 1 << 20).arrayBuffer(), v = new DataView(buf), n = buf.byteLength;
    if (n < 30) return null;
    if (v.getUint32(0) === 0x89504e47) return { w: v.getUint32(16), h: v.getUint32(20), o: 1 };            // PNG
    if (v.getUint32(0) === 0x47494638) return { w: v.getUint16(6, true), h: v.getUint16(8, true), o: 1 };  // GIF
    if (v.getUint32(0) === 0x52494646 && v.getUint32(8) === 0x57454250) {                                // WebP
      const k = v.getUint32(12);
      if (k === 0x56503820) return { w: v.getUint16(26, true) & 0x3fff, h: v.getUint16(28, true) & 0x3fff, o: 1 };
      if (k === 0x5650384c) { const b = v.getUint32(21, true); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, o: 1 }; }
      if (k === 0x56503858) return { w: 1 + (v.getUint32(24, true) & 0xffffff), h: 1 + (v.getUint32(27, true) & 0xffffff), o: 1 };
      return null;
    }
    if (v.getUint16(0) !== 0xffd8) return null;                                                          // JPEG
    let p = 2, o = 1;
    while (p + 9 < n) {
      if (v.getUint8(p) !== 0xff) return null;
      const m = v.getUint8(p + 1);
      if (m === 0xff) { p++; continue; }
      const len = v.getUint16(p + 2);
      if (m === 0xe1 && o === 1) o = exifOrientation(v, p + 4, Math.min(n, p + 2 + len));
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: v.getUint16(p + 7), h: v.getUint16(p + 5), o };
      p += 2 + len;
    }
  } catch { /* en-tête illisible : décodage complet */ }
  return null;
}

// Source quelconque → image pour le worker (orientation EXIF appliquée), réduite à `max` pixels de côté.
// Retourne aussi k = échelle appliquée (pixels de l'image envoyée / pixels de la source orientée).
async function toFrame(source, max = MAX_IMPORT) {
  const decodeError = () => new ScanError('decode', 'Image illisible');
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    const k = Math.min(1, max / Math.max(source.width, source.height));
    const f = await frameOf(source, 0, 0, source.width, source.height, Math.round(source.width * k), Math.round(source.height * k));
    return { ...f, k };
  }
  let bmp, k = 1;
  try {
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
      if (!source.complete) await source.decode();
      const W = source.naturalWidth, H = source.naturalHeight;
      k = Math.min(1, max / Math.max(W, H));
      bmp = await createImageBitmap(source, k < 1 ? { resizeWidth: Math.round(W * k), resizeHeight: Math.round(H * k), resizeQuality: 'high' } : {});
    } else {
      const sz = typeof Blob !== 'undefined' && source instanceof Blob ? await imageSize(source) : null;
      if (sz && sz.w > 0 && sz.h > 0) {
        const swap = sz.o >= 5 && sz.o <= 8, W = swap ? sz.h : sz.w, H = swap ? sz.w : sz.h;
        k = Math.min(1, max / Math.max(W, H));
        const opts = { imageOrientation: 'from-image' };
        if (k < 1) Object.assign(opts, { resizeWidth: Math.round(W * k), resizeHeight: Math.round(H * k), resizeQuality: 'high' });
        bmp = await createImageBitmap(source, opts);
        // navigateur qui redimensionne avant d'appliquer l'orientation : image déformée → on recommence sans réduire
        if (k < 1 && Math.abs(bmp.width / bmp.height - W / H) > 0.02) { bmp.close(); bmp = null; }
      }
      if (!bmp) {
        bmp = await createImageBitmap(source, { imageOrientation: 'from-image' });
        k = 1;
      }
    }
  } catch (e) {
    throw decodeError();
  }
  if (!bmp.width || !bmp.height) { bmp.close?.(); throw decodeError(); }
  // réduction restante (repli sans dimensions d'en-tête)
  const k2 = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const f = await frameOf(bmp, 0, 0, bmp.width, bmp.height, Math.round(bmp.width * k2), Math.round(bmp.height * k2));
  bmp.close();
  return { ...f, k: k * k2 };
}

// Photo importée : détecteur sans guide (quadrilatères candidats arbitrés par la base).
// Résultat : même objet que onResult (decision 'accept' | 'choose'), ou null si aucune carte plausible.
// Lève ScanError (kind 'decode', « Image illisible ») si le fichier n'est pas une image.
export async function identifyImage(source) {
  await preload();
  const t0 = performance.now();
  const f = await toFrame(source);
  const r = await call('unguided', { bmp: f.img }, f.transfer);
  r.t0 = t0;
  return settle(r, { single: true, t0 });
}

// Lecture du numéro (et du code de série SV/ME). hint : { token, quad, guide, candidates: [id…] }.
//  - token (r.token d'un résultat de la boucle ou d'identifyImage) : relit la même image (quad de l'identification,
//    ou hint.quad en pixels de cette image) ; source peut alors être null. Image oubliée (4 gardées) → source.
//  - sinon source (Blob | ImageBitmap | HTMLImageElement) : hint.quad / hint.guide en pixels de la source
//    (orientation EXIF appliquée) ; sans l'un ni l'autre, la carte est d'abord cherchée dans l'image.
// Résultat : même objet (source 'ocr') ou null.
export async function ocrFallback(source, hint = {}) {
  await preload();
  const t0 = performance.now();
  let token = hint.token || null, quad = token ? hint.quad || null : null, r = { top: [], group: [], rivals: [] };
  let cands = hint.candidates || [];
  if (token && !(await call('has', { token }))) token = null;
  if (!token) {
    if (!source) return null;
    const f = await toFrame(source, 3200);
    const W = f.w, H = f.h, k = f.k;
    const sc = q => q.map(([x, y]) => [x * k, y * k]);
    if (hint.quad) {
      r = await call('unguided', { bmp: f.img }, f.transfer);
      quad = sc(hint.quad);
    } else if (hint.guide) {
      const g = hint.guide;
      r = await call('identify', { bmp: f.img, guide: { x: (g.x ?? g.left) * k, y: (g.y ?? g.top) * k, w: (g.width ?? g.w) * k, h: (g.height ?? g.h) * k } }, f.transfer);
    } else {
      r = await call('unguided', { bmp: f.img }, f.transfer);
    }
    token = r.token;
    if (!quad) quad = r.quad || [[0, 0], [W, 0], [W, H], [0, H]];
    if (!cands.length && r.top && r.d1 <= LOOP.none) cands = [...r.top, ...(r.group || []), ...(r.rivals || [])].map(x => x.id).concat(r.twins || []);
  }
  const { ocrFrame } = await import('./ocr.js');
  const dists = {};
  for (const l of [r.rivals, r.group, r.top]) for (const x of l || []) if (x.d != null) dists[x.id] = x.d;
  const o = await ocrFrame(token, { candidates: cands, dists, quad });
  if (!o) return null;
  const lead = o.decision === 'accept' ? o.ids : [...new Set([...o.ids, ...cands])];
  const res = resultOf(o.decision, o.ids[0], { ...r, token }, { lead, alternatives: lead.slice(1), source: 'ocr', why: o.why, ms: performance.now() - t0, extra: { text: o.texts } });
  res.candidates = lead.slice(0, 5).map(id => ({ id, d: res.candidates.find(x => x.id === id)?.d ?? null }));
  return res;
}

// Métadonnées de la base (après preload) : { ids, noimg, sets, codes, twins, built }
export const scanData = () => getCards();

// Préchargement de l'OCR (≈ 4,8 Mo une seule fois, gardés par le service worker) pour qu'il marche hors ligne.
// À appeler en ligne, au repos (whenIdle), par exemple après une première séance de scan. Retourne les octets reçus.
export const warmOcr = () => import('./ocr.js').then(m => m.warm());
