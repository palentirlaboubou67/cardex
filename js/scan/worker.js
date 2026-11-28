// Web Worker du scanner (module) : détection, descripteurs, recherche dans la base et départage des réimpressions,
// hors du fil principal. Messages { id, type, … } → réponse { id, ok, r } ou { id, ok: false, error }.
//   init      { buf, cards, canvas }    base (hashes.bin + cards.json) ; canvas = la page a OffscreenCanvas
//   detect    { bmp, guide }            détection seule sur la copie réduite (guide ≈ 420 px de haut)
//   identify  { bmp, guide }            identification sur l'image pleine résolution (zone du guide)
//   unguided  { bmp }                   photo importée (sans guide)
//   region    { token, ids }            départage par la zone du code / numéro d'une image identifiée
//   ocrprep   { token, nums, quad? }    lignes à lire par l'OCR d'une image identifiée
//   has       { token }                 l'image est-elle encore en mémoire ?
//   forget    { token? }                oublie une image (ou toutes)
//   cancel    { target }                abandonne une demande en cours (téléchargements de « region »)
//   exclude   { ids }                   banc d'essai : cartes masquées (« carte absente »), [] pour tout rétablir
// identify / unguided renvoient un « token » : l'image reste en mémoire (4 au plus) pour region / ocrprep.
import { ScanDB } from './match.js';
import { identifyGuided, identifyUnguided, detectOnly, decide } from './identify.js';
import { compareRegions } from './region.js';
import { ocrLines } from './ocrprep.js';

let db = null, cv = null, cx = null, tok = 0;
const frames = new Map();     // token → { frame, quad }
const inflight = new Map();   // id de demande → AbortController
const KEEP = 4;

// OffscreenCanvas 2D dans ce worker (Safari < 16.4 n'en a pas : la zone du numéro est alors indisponible → choix)
let CANVAS = (() => {
  try { return typeof OffscreenCanvas === 'function' && !!new OffscreenCanvas(1, 1).getContext('2d'); } catch { return false; }
})();

function pixels(bmp) {
  if (bmp.data) return bmp;                 // ImageData déjà prête (navigateur sans OffscreenCanvas)
  const w = bmp.width, h = bmp.height;
  if (!cv) { cv = new OffscreenCanvas(w, h); cx = cv.getContext('2d', { willReadFrequently: true }); }
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  cx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return cx.getImageData(0, 0, w, h);
}

function keep(frame, quad) {
  const t = ++tok;
  frames.set(t, { frame, quad });
  while (frames.size > KEEP) frames.delete(frames.keys().next().value);
  return t;
}

// Résultat d'identification sérialisable (ids plutôt que numéros de ligne)
function pack(r, token) {
  const out = { token, quad: r.quad, ms: r.ms, nev: r.nev, stage: r.stage, size: r.size };
  if (!r.rank) return out;
  const k = r.rank, dc = decide(k);
  out.top = k.top.map(x => ({ id: x.id, d: x.d }));
  out.d1 = k.d1;
  out.d2 = k.d2;
  out.level = dc.level;
  out.group = k.group.map(x => ({ id: db.ids[x.i], d: x.d }));
  out.rivals = dc.rivals.map(i => ({ id: db.ids[i], d: k.near.find(n => n.i === i)?.d ?? null }));
  out.twins = db.twinsOf(k.i1);
  out.arts = (db.arts.get(k.i1) || []).map(j => db.ids[j]);    // même illustration d'après le nom : jamais acceptée sur la zone seule
  return out;
}

function need() { if (!db) throw new Error('base du scanner non chargée'); }

const handlers = {
  init({ buf, cards, canvas = true }) {
    db = new ScanDB(buf, cards);
    if (!canvas) CANVAS = false;
    return { n: db.n, groups: db.groups.length, canvas: CANVAS };
  },

  detect({ bmp, guide }) {
    return detectOnly(pixels(bmp), guide);
  },

  identify({ bmp, guide, retry = true }) {
    need();
    const frame = pixels(bmp);
    const r = identifyGuided(db, frame, guide, { retry });
    r.size = [frame.width, frame.height];
    return pack(r, keep(frame, r.quad));
  },

  unguided({ bmp }) {
    need();
    const frame = pixels(bmp);
    const r = identifyUnguided(db, frame);
    r.size = [frame.width, frame.height];
    return pack(r, keep(frame, r.quad));
  },

  // { scores: [{ id, score }] (score null = image du candidat indisponible), complete, reason }
  async region({ token, ids, timeout = 6000 }, { signal }) {
    need();
    const f = frames.get(token);
    if (!f?.quad) return { scores: [], complete: false, reason: 'image' };
    if (!CANVAS) return { scores: [], complete: false, reason: 'canvas' };
    const rows = ids.map(id => db.row.get(id)).filter(i => i !== undefined);
    const sc = await compareRegions(db, f.frame, f.quad, rows, { timeout, signal });
    if (!sc) return { scores: [], complete: false, reason: 'reseau' };
    const scores = sc.map(x => ({ id: db.ids[x.i], score: x.score }));
    const complete = scores.length === ids.length && scores.every(x => x.score != null);
    return { scores, complete, reason: complete ? null : 'reseau' };
  },

  ocrprep({ token, nums, quad = null }) {
    const f = frames.get(token);
    const q = quad || f?.quad;
    if (!f || !q) return { lines: [], transfer: [] };
    const lines = ocrLines(f.frame, q, nums);
    return { lines, transfer: lines.map(l => l.img.data.buffer) };
  },

  has({ token }) { return frames.has(token); },

  forget({ token } = {}) {
    if (token) frames.delete(token); else frames.clear();
    return true;
  },

  exclude({ ids = [] } = {}) {
    need();
    db.exclude(ids.length ? ids : null);
    return true;
  },
};

self.onmessage = async e => {
  const { id, type, ...msg } = e.data || {};
  if (type === 'cancel') { inflight.get(msg.target)?.abort(); return; }
  const ctl = new AbortController();
  inflight.set(id, ctl);
  try {
    const h = handlers[type];
    if (!h) throw new Error('message inconnu : ' + type);
    let r = await h(msg, { signal: ctl.signal });
    let transfer = [];
    if (type === 'ocrprep') { transfer = r.transfer; r = r.lines; }
    if (!ctl.signal.aborted) self.postMessage({ id, ok: true, r }, transfer);
  } catch (err) {
    if (!ctl.signal.aborted) self.postMessage({ id, ok: false, error: String(err?.message || err) });
  } finally {
    inflight.delete(id);
  }
};
