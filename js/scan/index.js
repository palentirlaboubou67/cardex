// API publique du scanner (SPEC §5.7). Aucune interface ici : la vue (js/views/scanner.js) s'appuie dessus.
//   preload(onProgress?)                 base des cartes (data/scan/hashes.bin + cards.json) et worker
//   openCamera(video) / closeCamera()     caméra arrière 1080p ; setTorch(on) / setZoom(z)
//   createLoop({ video, guide, onState, onResult })   boucle de scan en direct
//   identifyImage(source)                photo importée (sans guide)
//   ocrFallback(source, hint?)           lecture du code de série et du numéro (tesseract, chargé à la demande)
//
// Exemple (vue) :
//   const { caps } = await scan.openCamera(videoEl);              // CameraError.kind : insecure | denied | nocamera…
//   const loop = scan.createLoop({ video: videoEl, guide: guideEl,
//     onState: s => { pill.textContent = s.hint; drawQuad(s.quad, s.state); },       // quad en px CSS de la vidéo
//     onResult: r => (r.decision === 'accept' ? showResult(r) : showChooser(r)) });  // r.best.id, r.candidates…
//   loop.start();  …  loop.resume() (« Scanner une autre carte »)  …  loop.destroy(); scan.closeCamera();
import * as net from '../core/net.js';
import { call, setCards, getCards, frameOf } from './client.js';
import { createLoop as makeLoop, settle, resultOf, LOOP } from './loop.js';

export { openCamera, closeCamera, setTorch, setZoom, CameraError, torchState, cameraOpen } from './camera.js';
export { LOOP } from './loop.js';

const ROOT = new URL('../../', import.meta.url).href;
const MAX_IMPORT = 2560;   // côté maximal d'une photo importée (pixels)

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

async function fetchBytes(path, onBytes, timeout = 30000) {
  const { url, init } = await dataUrl(path);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new net.NetError(res.status === 404 ? 'notfound' : 'server', res.status, url);
    if (!res.body || !onBytes) return await res.arrayBuffer();
    const reader = res.body.getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      n += value.length;
      onBytes(n);
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

// Charge la base et démarre le worker. onProgress(fraction 0–1). Appels multiples : une seule fois.
export function preload(onProgress) {
  if (pre) {
    if (onProgress) pre.then(() => onProgress(1), () => {});
    return pre;
  }
  pre = (async () => {
    onProgress?.(0);
    const cardsBuf = await fetchBytes('data/scan/cards.json', null);
    const cards = JSON.parse(new TextDecoder().decode(cardsBuf));
    onProgress?.(0.15);
    const total = cards.ids.length * 64;
    const buf = await fetchBytes('data/scan/hashes.bin', n => onProgress?.(0.15 + 0.8 * Math.min(1, n / total)));
    if (buf.byteLength !== total) throw new Error('base du scanner incomplète');
    setCards(cards);
    const info = await call('init', { buf, cards }, [buf]);
    onProgress?.(1);
    return { cards: info.n, groups: info.groups, noimg: (cards.noimg || []).length, built: cards.built };
  })();
  pre.catch(() => { pre = null; });
  return pre;
}

// Boucle de scan. guide : rectangle du guide en pixels CSS relatifs à la vidéo ({ x, y, width, height }),
// ou l'élément du guide (recalculé à chaque image), ou une fonction qui renvoie l'un des deux.
export function createLoop(opts) {
  const ready = preload();
  return makeLoop({ ...opts, ready });
}

// Source quelconque → image pour le worker (orientation EXIF appliquée), réduite à `max` pixels de côté
async function toFrame(source, max = MAX_IMPORT) {
  let bmp = source, own = false;
  if (!(typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)) {
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement && !source.complete) await source.decode();
    bmp = await createImageBitmap(source, { imageOrientation: 'from-image' });
    own = true;
  }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const f = await frameOf(bmp, 0, 0, bmp.width, bmp.height, Math.round(bmp.width * k), Math.round(bmp.height * k));
  if (own) bmp.close();
  return f;
}

// Photo importée : détecteur sans guide (quadrilatères candidats arbitrés par la base).
// Résultat : même objet que onResult (decision 'accept' | 'choose'), ou null si aucune carte plausible.
export async function identifyImage(source) {
  await preload();
  const t0 = performance.now();
  const f = await toFrame(source);
  const r = await call('unguided', { bmp: f.img }, f.transfer);
  r.t0 = t0;
  const res = await settle(r, { single: true, t0 });
  if (res) res.token = r.token;
  return res;
}

// Lecture du numéro (et du code de série SV/ME). hint : { quad, guide, candidates: [id…], token }.
// Sans quad ni token, la carte est d'abord cherchée dans l'image. Résultat : même objet (source 'ocr') ou null.
export async function ocrFallback(source, hint = {}) {
  await preload();
  const t0 = performance.now();
  let token = hint.token || null, quad = hint.quad || null, r = { top: [], group: [], rivals: [] };
  let cands = hint.candidates || [];
  if (!token) {
    const f = await toFrame(source, 3200);
    const W = f.w, H = f.h;
    r = hint.guide
      ? await call('identify', { bmp: f.img, guide: { x: hint.guide.x, y: hint.guide.y, w: hint.guide.width ?? hint.guide.w, h: hint.guide.height ?? hint.guide.h } }, f.transfer)
      : await call('unguided', { bmp: f.img }, f.transfer);
    token = r.token;
    if (!quad) quad = r.quad || [[0, 0], [W, 0], [W, H], [0, H]];
    if (!cands.length && r.top && r.d1 <= LOOP.none) cands = [...r.top, ...(r.group || []), ...(r.rivals || [])].map(x => x.id);
  }
  const { ocrFrame } = await import('./ocr.js');
  const o = await ocrFrame(token, { candidates: cands, quad });
  if (!o) return null;
  const res = resultOf(o.decision, o.ids[0], r, { alternatives: o.ids.slice(1), source: 'ocr', ms: performance.now() - t0, extra: { text: o.texts } });
  res.candidates = o.ids.slice(0, 5).map(id => ({ id, d: res.candidates.find(x => x.id === id)?.d ?? null }));
  return res;
}

// Métadonnées de la base (après preload) : { ids, noimg, sets, codes, built }
export const scanData = () => getCards();

// Préchargement de l'OCR (≈ 4,8 Mo une seule fois, gardés par le service worker) pour qu'il marche hors ligne.
// À appeler en ligne, au repos (whenIdle), par exemple après une première séance de scan. Retourne les octets reçus.
export const warmOcr = () => import('./ocr.js').then(m => m.warm());
