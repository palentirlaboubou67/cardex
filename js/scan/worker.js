// Web Worker du scanner (module) : détection, descripteurs, recherche dans la base et départage des réimpressions,
// hors du fil principal. Messages { id, type, … } → réponse { id, ok, r } ou { id, ok: false, error }.
//   init      { buf, cards }            base (hashes.bin + cards.json)
//   detect    { bmp, guide }            détection seule sur la copie réduite (guide ≈ 420 px de haut)
//   identify  { bmp, guide }            identification sur l'image pleine résolution (zone du guide)
//   unguided  { bmp }                   photo importée (sans guide)
//   region    { token, ids }            départage par la zone du code / numéro d'une image identifiée
//   ocrprep   { token, nums, quad? }    lignes à lire par l'OCR d'une image identifiée
//   forget    { token? }                oublie une image (ou toutes)
// identify / unguided renvoient un « token » : l'image reste en mémoire (3 au plus) pour region / ocrprep.
import { ScanDB } from './match.js';
import { identifyGuided, identifyUnguided, detectOnly, decide } from './identify.js';
import { compareRegions } from './region.js';
import { ocrLines } from './ocrprep.js';

let db = null, cv = null, cx = null, tok = 0;
const frames = new Map();   // token → { frame, quad }

function pixels(bmp) {
  if (bmp.data) return bmp;                 // ImageData déjà prête (navigateur sans OffscreenCanvas dans les workers)
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
  while (frames.size > 3) frames.delete(frames.keys().next().value);
  return t;
}

// Résultat d'identification sérialisable (ids plutôt que numéros de ligne)
function pack(r, token) {
  const out = { token, quad: r.quad, ms: r.ms, nev: r.nev, stage: r.stage };
  if (!r.rank) return out;
  const k = r.rank, dc = decide(k);
  out.top = k.top.map(x => ({ id: x.id, d: x.d }));
  out.d1 = k.d1;
  out.d2 = k.d2;
  out.level = dc.level;
  out.group = k.group.map(x => ({ id: db.ids[x.i], d: x.d }));
  out.rivals = dc.rivals.map(i => ({ id: db.ids[i], d: k.near.find(n => n.i === i)?.d ?? null }));
  return out;
}

function need() { if (!db) throw new Error('base du scanner non chargée'); }

const handlers = {
  init({ buf, cards }) {
    db = new ScanDB(buf, cards);
    return { n: db.n, groups: db.groups.length };
  },

  detect({ bmp, guide }) {
    return detectOnly(pixels(bmp), guide);
  },

  identify({ bmp, guide, retry = true }) {
    need();
    const frame = pixels(bmp);
    const r = identifyGuided(db, frame, guide, { retry });
    return pack(r, keep(frame, r.quad));
  },

  unguided({ bmp }) {
    need();
    const frame = pixels(bmp);
    const r = identifyUnguided(db, frame);
    return pack(r, keep(frame, r.quad));
  },

  async region({ token, ids, timeout = 6000 }) {
    const f = frames.get(token);
    if (!f?.quad) return null;
    const rows = ids.map(id => db.row.get(id)).filter(i => i !== undefined);
    const sc = await compareRegions(db, f.frame, f.quad, rows, { timeout });
    return sc ? sc.map(x => ({ id: db.ids[x.i], score: x.score })) : null;
  },

  ocrprep({ token, nums, quad = null }) {
    const f = frames.get(token);
    const q = quad || f?.quad;
    if (!f || !q) return { lines: [], transfer: [] };
    const lines = ocrLines(f.frame, q, nums);
    return { lines, transfer: lines.map(l => l.img.data.buffer) };
  },

  forget({ token } = {}) {
    if (token) frames.delete(token); else frames.clear();
    return true;
  },
};

self.onmessage = async e => {
  const { id, type, ...msg } = e.data || {};
  try {
    const h = handlers[type];
    if (!h) throw new Error('message inconnu : ' + type);
    let r = await h(msg);
    let transfer = [];
    if (type === 'ocrprep') { transfer = r.transfer; r = r.lines; }
    self.postMessage({ id, ok: true, r }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
