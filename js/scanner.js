// Caméra + lecture (OCR) du nom et du numéro de la carte, puis identification via l'API.
import * as api from './api.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let stream = null;
let workerP = null;

// ---------- Caméra ----------
export const cameraSupported = () => !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

export async function startCamera(video) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  await video.play();
  const track = stream.getVideoTracks()[0];
  return { torch: !!track.getCapabilities?.().torch };
}

export function stopCamera() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
}

export async function setTorch(on) {
  const track = stream?.getVideoTracks()[0];
  if (track) await track.applyConstraints({ advanced: [{ torch: on }] });
}

// Découpe l'image vidéo sur le cadre affiché (la vidéo est en object-fit: cover).
export function captureGuide(video, guide) {
  const vr = video.getBoundingClientRect();
  const gr = guide.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const ox = (vr.width - vw * scale) / 2, oy = (vr.height - vh * scale) / 2;
  const sx = (gr.left - vr.left - ox) / scale, sy = (gr.top - vr.top - oy) / scale;
  const sw = gr.width / scale, sh = gr.height / scale;
  const c = document.createElement('canvas');
  c.width = 900; c.height = Math.round(900 * sh / sw);
  c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

export async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

// Extrait une bande (en fractions de la hauteur), agrandie et passée en niveaux de gris contrastés.
function strip(src, y0, y1, up = 2) {
  const sy = Math.round(src.height * y0), sh = Math.round(src.height * (y1 - y0));
  const c = document.createElement('canvas');
  c.width = src.width * up; c.height = sh * up;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, sy, src.width, sh, 0, 0, c.width, c.height);
  const im = ctx.getImageData(0, 0, c.width, c.height), p = im.data;
  let min = 255, max = 0;
  for (let i = 0; i < p.length; i += 4) {
    const g = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11;
    p[i] = g; if (g < min) min = g; if (g > max) max = g;
  }
  const k = 255 / Math.max(1, max - min);
  for (let i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = (p[i] - min) * k;
  ctx.putImageData(im, 0, 0);
  return c;
}

// ---------- OCR ----------
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Chargement OCR impossible'));
    document.head.appendChild(s);
  });
}

function worker() {
  workerP ??= (async () => {
    if (!window.Tesseract) await loadScript(TESSERACT);
    return window.Tesseract.createWorker('fra');
  })();
  workerP.catch(() => { workerP = null; });
  return workerP;
}
export const warmUp = () => worker().catch(() => {});

async function ocr(canvas) {
  const w = await worker();
  await w.setParameters({ tessedit_pageseg_mode: '11' });
  const { data } = await w.recognize(canvas);
  return data.text || '';
}

const NUM_RE = /([A-Z]{0,3}\d{1,3})\s*[\/|]\s*([A-Z]{0,3}\d{2,3})/;

export function parseNumber(text) {
  const t = text.toUpperCase().replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
  const m = t.match(NUM_RE);
  return m ? { num: m[1], total: parseInt(m[2].replace(/\D/g, ''), 10) } : null;
}

const STOP = new Set(['base', 'niveau', 'evolution', 'stade', 'stage', 'basic', 'evolue', 'pokemon', 'dresseur',
  'energie', 'supporter', 'objet', 'outil', 'vmax', 'vstar', 'gx', 'ex', 'de', 'du', 'des', 'pv', 'hp', 'tera']);

export function parseWords(text) {
  return [...new Set(
    (text.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]{2,}/g) || [])
      .map(w => w.replace(/[.'’\-]+$/, ''))
      .filter(w => w.length >= 3 && !STOP.has(norm(w)))
  )].sort((a, b) => b.length - a.length).slice(0, 4);
}

export async function read(canvas, onStep = () => {}) {
  onStep('Lecture du numéro…');
  let number = parseNumber(await ocr(strip(canvas, 0.86, 1)));
  onStep('Lecture du nom…');
  const words = parseWords(await ocr(strip(canvas, 0, 0.14)));
  if (!number) {
    onStep('Recherche du numéro sur toute la carte…');
    number = parseNumber(await ocr(strip(canvas, 0, 1, 1)));
  }
  return { number, words };
}

// ---------- Identification ----------
export const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const normLocal = s => String(s).toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');

function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

function nameScore(name, words) {
  if (!words.length) return 0;
  const tokens = norm(name).split(/[\s\-]+/).filter(Boolean);
  let best = 0;
  for (const w of words.map(norm)) for (const t of tokens) {
    best = Math.max(best, 1 - lev(w, t) / Math.max(w.length, t.length));
  }
  return best;
}

export async function identify({ number, words }) {
  const sets = await api.setsById();
  const found = new Map();

  // 1) Par le numéro : séries dont le nombre de cartes correspond, puis la carte au bon numéro.
  if (number) {
    const match = [...sets.values()]
      .filter(s => s.cardCount?.official === number.total || s.cardCount?.total === number.total)
      .sort((a, b) => b.order - a.order).slice(0, 12);
    const details = await Promise.allSettled(match.map(s => api.set(s.id)));
    for (const r of details) {
      if (r.status !== 'fulfilled') continue;
      const c = r.value.cards?.find(c => normLocal(c.localId) === normLocal(number.num));
      if (c) found.set(c.id, { ...c, byNumber: true });
    }
  }

  // 2) Par le nom, si le numéro n'a rien donné.
  if (!found.size && words.length) {
    const queries = words.slice(0, 2).map(w => w.slice(0, Math.min(5, w.length)));
    const res = await Promise.allSettled(queries.map(q => api.search(q)));
    for (const r of res) if (r.status === 'fulfilled') for (const c of r.value) found.set(c.id, c);
  }

  return [...found.values()]
    .map(c => {
      const s = sets.get(api.setIdOf(c.id));
      return {
        ...c,
        setName: s?.name || '',
        setTotal: s?.cardCount?.official,
        score: (c.byNumber ? 1 : 0) + nameScore(c.name, words) + (c.image ? 0.2 : 0) + (s ? s.order / 10000 : 0),
      };
    })
    .filter(c => c.byNumber || nameScore(c.name, words) > 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}
