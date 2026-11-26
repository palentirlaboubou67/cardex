// Liaison avec le worker du scanner (un seul worker par page) : appels { type, … } → promesse du résultat.
let worker = null, seq = 0, cards = null;
const pending = new Map();

// cards.json (gardé aussi côté page : grammaire de l'OCR, métadonnées des séries)
export const setCards = c => { cards = c; };
export const getCards = () => cards;

export function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'cardex-scan' });
  worker.onmessage = e => {
    const { id, ok, r, error } = e.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.res(r); else p.rej(new Error(error));
  };
  worker.onerror = e => {
    // erreur de chargement du module : toutes les demandes en cours échouent
    const err = new Error(e.message || 'worker du scanner indisponible');
    for (const p of pending.values()) p.rej(err);
    pending.clear();
  };
  return worker;
}

export function call(type, msg = {}, transfer = []) {
  const w = getWorker(), id = ++seq;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    w.postMessage({ id, type, ...msg }, transfer);
  });
}

// Image à envoyer au worker (zone sx, sy, sw, sh de src, réduite à dw × dh) : ImageBitmap transférée ;
// sans OffscreenCanvas 2D (Safari < 16.4), ImageData préparée ici sur le fil principal.
const OFFSCREEN = (() => {
  try { return typeof OffscreenCanvas === 'function' && !!new OffscreenCanvas(1, 1).getContext('2d'); } catch { return false; }
})();
let cv = null;
export async function frameOf(src, sx, sy, sw, sh, dw = sw, dh = sh) {
  if (OFFSCREEN) {
    const bmp = dw !== sw || dh !== sh
      ? await createImageBitmap(src, sx, sy, sw, sh, { resizeWidth: dw, resizeHeight: dh, resizeQuality: 'medium' })
      : await createImageBitmap(src, sx, sy, sw, sh);
    return { img: bmp, transfer: [bmp], w: bmp.width, h: bmp.height };
  }
  cv ??= document.createElement('canvas');
  cv.width = dw; cv.height = dh;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  const d = x.getImageData(0, 0, dw, dh);
  return { img: d, transfer: [d.data.buffer], w: dw, h: dh };
}

export function terminate() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const p of pending.values()) p.rej(new Error('worker arrêté'));
  pending.clear();
}
