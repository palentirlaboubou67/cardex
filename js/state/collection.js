// Collection v2 (localStorage 'cardex.collection.v1', schéma { v: 2, cards, sealed, watch, savedAt }).
// Événements groupés par microtâche, données dérivées mémorisées par révision, sauvegarde protégée,
// copie de secours d'un JSON illisible, import validé (liste blanche), synchronisation entre onglets.
import { FINISHES as FIN } from '../data/finishes.js';
import * as prices from '../data/prices.js';
import { metaSync, setIdOf, cardSync } from '../data/catalog.js';
import { dexNums, loaded as dexLoaded } from '../data/dex.js';
import { data as dataFile } from '../core/net.js';
import { norm } from '../core/format.js';

export const FINISHES = FIN;
const KEY = 'cardex.collection.v1';
export const STORAGE_KEY = KEY;
const ID_RE = /^[\w.%-]+-[\w.%!]+$/;          // « exu-! » (Zarbi « ! ») et « exu-%3F » existent
const PROD_RE = /^(?!(?:__proto__|constructor|prototype)$)[\w.-]{1,60}$/;   // produits scellés
const MAX_STR = 200;

// ---------- validation (chargement et import) ----------
const str = v => (typeof v === 'string' ? v.slice(0, MAX_STR) : '');
const strOk = v => typeof v === 'string' && v.length <= MAX_STR;
const toInt = (v, min, max) => {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const toQty = v => toInt(v, 1, 999) || 0;
const cleanUrl = v => (typeof v === 'string' && v.length <= MAX_STR && /^https:\/\/[^\s"'<>`]+$/.test(v) ? v : '');
const cleanDex = v => (Array.isArray(v) ? [...new Set(v.map(x => toInt(x, 1, 2000)).filter(Boolean))].slice(0, 6) : []);
const cleanTime = v => (Number.isFinite(v) && v > 0 && v < 4102444800000 ? Math.floor(v) : Date.now());

function cleanRecord(rec, key, strict) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const id = typeof rec.id === 'string' ? rec.id : key;
  if (typeof id !== 'string' || id.length > MAX_STR || !ID_RE.test(id)) return null;
  const qty = {};
  if (rec.qty && typeof rec.qty === 'object') for (const f of FINISHES) { const n = toQty(rec.qty[f]); if (n) qty[f] = n; }
  if (!Object.keys(qty).length) return null;
  const setId = setIdOf(id);
  const out = { id, qty, addedAt: cleanTime(rec.addedAt) };
  for (const k of ['name', 'localId', 'setName', 'rarity', 'category']) {
    // à l'import : un texte trop long est refusé (vide), au chargement il est tronqué
    out[k] = strict ? (strOk(rec[k]) ? rec[k] : '') : str(rec[k]);
  }
  out.setId = setId;
  if (!out.localId) out.localId = id.slice(setId.length + 1);
  out.setTotal = toInt(rec.setTotal, 0, 9999);
  out.image = cleanUrl(rec.image);
  out.dexId = cleanDex(rec.dexId);
  return out;
}

function cleanSealed(key, e) {
  if (!e || typeof e !== 'object') return null;
  const raw = e.id ?? key;
  const id = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : typeof raw === 'string' && PROD_RE.test(raw) ? raw : null;
  if (id === null) return null;
  const qty = toQty(e.qty);
  if (!qty) return null;
  const cost = typeof e.cost === 'number' && Number.isFinite(e.cost) && e.cost >= 0 && e.cost < 1e7 ? Math.round(e.cost * 100) / 100 : null;
  const at = typeof e.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.at) ? e.at : '';
  return { id, qty, cost, at };
}

const cleanWatchId = w => (typeof w === 'number' && Number.isInteger(w) && w >= 0 ? w : typeof w === 'string' && PROD_RE.test(w) ? w : null);

const empty = () => ({ v: 2, cards: {}, sealed: {}, watch: [], savedAt: 0 });

function cleanSealedMap(src, into) {
  let skipped = 0;
  if (src && typeof src === 'object') {
    for (const [k, e] of Object.entries(src)) { const s = cleanSealed(k, e); if (s) into[String(s.id)] = s; else skipped++; }
  }
  return skipped;
}
function cleanWatchList(src, into) {
  if (!Array.isArray(src)) return;
  const seen = new Set(into.map(String));
  for (const w of src) { const id = cleanWatchId(w); if (id !== null && !seen.has(String(id))) { seen.add(String(id)); into.push(id); } }
}

// v1 (ou v2) -> v2 : fonction pure. Les prix enregistrés (v1) disparaissent : ils viennent des fichiers de cotes.
// Le scellé de la v1 utilisait les identifiants TCGplayer, la v2 ceux de Cardmarket : les produits de la v1 sont gardés
// à part (tcg) jusqu'à leur correspondance (linkLegacySealed), jamais perdus ni mélangés.
export function migrate(d, { strict = false } = {}) {
  const out = empty();
  if (!d || typeof d !== 'object') return out;
  let skipped = 0;
  if (d.cards && typeof d.cards === 'object') {
    for (const [k, rec] of Object.entries(d.cards)) {
      const r = cleanRecord(rec, k, strict);
      if (!r) { skipped++; continue; }
      const cur = out.cards[r.id];
      if (cur) for (const [f, n] of Object.entries(r.qty)) cur.qty[f] = Math.max(cur.qty[f] || 0, n);
      else out.cards[r.id] = r;
    }
  }
  const tcg = { sealed: {}, watch: [] };
  if (d.v === 2) {
    skipped += cleanSealedMap(d.sealed, out.sealed);
    cleanWatchList(d.watch, out.watch);
    if (d.tcg && typeof d.tcg === 'object') { skipped += cleanSealedMap(d.tcg.sealed, tcg.sealed); cleanWatchList(d.tcg.watch, tcg.watch); }
  } else {
    skipped += cleanSealedMap(d.sealed, tcg.sealed);
    cleanWatchList(d.watch, tcg.watch);
  }
  if (Object.keys(tcg.sealed).length || tcg.watch.length) out.tcg = tcg;
  out.savedAt = Number.isFinite(d.savedAt) ? d.savedAt : 0;
  if (Number.isFinite(d.exportedAt)) out.exportedAt = d.exportedAt;
  Object.defineProperty(out, 'skipped', { value: skipped, enumerable: false });
  return out;
}

// ---------- état ----------
const state = { readOnly: false, corrupt: null, corruptRaw: null, error: null };
let data = load();
let REV = 0, queue = null, dirty = false;
const subs = new Set(), memo = new Map();

function readRaw() {
  try { return { raw: localStorage.getItem(KEY) }; } catch (e) { return { raw: null, blocked: e }; }
}

function load() {
  const { raw, blocked } = readRaw();
  if (blocked) { state.error = 'blocked'; return empty(); }
  if (raw == null) return empty();
  let d;
  try { d = JSON.parse(raw); } catch { d = undefined; }
  if (d && typeof d === 'object' && d.cards && typeof d.cards === 'object') return migrate(d);
  if (d === null) return empty();
  // JSON illisible ou inattendu : copie de secours avant de repartir de zéro
  const k = `${KEY}.corrupt.${Date.now()}`;
  try { localStorage.setItem(k, raw); state.corrupt = k; }
  catch { state.readOnly = true; state.corruptRaw = raw; }   // pas de place : on ne touche à rien
  return empty();
}

const isQuota = e => e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

// caches qui n'ont plus leur place dans localStorage (l'ancienne appli, et les nôtres)
const CACHE_PREFIX = ['cardex.sets.cache', 'cardex.series.cache', 'cardex.fin.', 'cardex.dexfin.', 'cardex.cotes', 'cardex.cache.', 'cardex.live.'];
function evictCaches() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of keys) if (k && CACHE_PREFIX.some(p => k.startsWith(p))) localStorage.removeItem(k);
  } catch { /* rien */ }
}

function signal(kind) {
  try { globalThis.dispatchEvent?.(new CustomEvent('cardex:storage', { detail: { error: kind, readOnly: state.readOnly } })); } catch { /* rien */ }
}

function persist() {
  if (state.readOnly) { signal('readonly'); return false; }
  data.savedAt = Date.now();
  const s = JSON.stringify(data);
  try { localStorage.setItem(KEY, s); state.error = null; return true; }
  catch (e) {
    if (isQuota(e)) {
      evictCaches();
      try { localStorage.setItem(KEY, s); state.error = null; return true; } catch { /* toujours plein */ }
    }
    state.error = isQuota(e) ? 'quota' : 'unknown';
    signal(state.error);
    return false;
  }
}

function flush() {
  const evs = queue;
  queue = null;
  if (dirty) { dirty = false; persist(); }
  for (const fn of [...subs]) { try { fn(evs); } catch (e) { console.error(e); } }
}

function emit(ev, save = true) {
  REV++;
  memo.clear();
  if (save) dirty = true;
  (queue ??= []).push(ev);
  if (queue.length === 1) queueMicrotask(flush);
}

// fn(events) une fois par microtâche ; renvoie la fonction de désabonnement
export const on = fn => (subs.add(fn), () => subs.delete(fn));
export const rev = () => REV;
export const lastSave = () => data.savedAt || 0;
export const lastExport = () => data.exportedAt || 0;
// { readOnly, corrupt (clé de la copie), error ('quota'|'blocked'|'unknown'|null) } — pour Réglages
export const storageState = () => ({ readOnly: state.readOnly, corrupt: state.corrupt, error: state.error, hasCorruptText: !!state.corruptRaw });
// texte illisible gardé en mémoire faute de place (à proposer au téléchargement), puis on peut repartir de zéro
export const corruptText = () => state.corruptRaw;
export function discardCorrupt() { state.readOnly = false; state.corruptRaw = null; persist(); }

// autre onglet (appli installée + onglet du navigateur) : on relit au lieu de s'écraser mutuellement
if (typeof addEventListener === 'function') {
  addEventListener('storage', e => {
    if (e.key !== KEY && e.key !== null) return;
    let raw = e.key === null ? readRaw().raw : e.newValue;
    let d = null;
    try { d = raw ? JSON.parse(raw) : null; } catch { return; }   // écriture illisible : on garde la nôtre
    data = d && d.cards ? migrate(d) : empty();
    state.readOnly = false; state.corruptRaw = null;
    emit({ type: 'reload' }, false);
  });
}

// ---------- lecture ----------
const memoize = (name, fn) => { if (!memo.has(name)) memo.set(name, fn()); return memo.get(name); };
export const total = rec => (rec ? Object.values(rec.qty).reduce((a, b) => a + b, 0) : 0);
export const all = () => memoize('all', () => Object.values(data.cards));   // enregistrements (lecture seule)
export const get = id => data.cards[id];
export const has = id => !!data.cards[id];
export const qtyOf = (id, finish) => {
  const r = data.cards[id];
  if (!r) return 0;
  return finish ? r.qty[finish] || 0 : total(r);
};
// cartes possédées d'une série
export const inSet = setId => memoize('inSet', () => {
  const m = new Map();
  for (const r of all()) { if (!m.has(r.setId)) m.set(r.setId, []); m.get(r.setId).push(r); }
  return m;
}).get(setId) || [];

// clé des noms (decks, comptes par nom) : norm() de js/core/format.js (sans accents ni casse), à utiliser aussi côté decks
export const normName = s => norm(s);

export const ownedBySet = () => memoize('bySet', () => {
  const m = new Map();
  for (const r of all()) m.set(r.setId, (m.get(r.setId) || 0) + 1);
  return m;
});
// les numéros devinés (séries sans dexId) demandent le Pokédex chargé : la clé de mémo en tient compte
export const ownedByDex = () => memoize(dexLoaded() ? 'byDex1' : 'byDex0', () => {
  const m = new Map();
  for (const r of all()) for (const n of dexNums(r)) m.set(n, (m.get(n) || 0) + 1);
  return m;
});
export const ownedByName = () => memoize('byName', () => {
  const m = new Map();
  for (const r of all()) { const k = normName(r.name); m.set(k, (m.get(k) || 0) + total(r)); }
  return m;
});

// valeur d'une carte (somme des finitions cotées), null si aucune n'est cotée
export function value(rec) {
  if (!rec) return null;
  let v = 0, any = false;
  for (const [f, n] of Object.entries(rec.qty)) {
    const e = prices.eur(rec.id, f);
    if (e != null) { v += e * n; any = true; }
  }
  return any ? Math.round(v * 100) / 100 : null;
}

// { total, unique, sets, value, priced, unpriced, pending } (exemplaires ; pending = séries dont les cotes ne sont pas chargées)
export function stats() {
  const key = `stats:${prices.version()}`;
  return memoize(key, () => {
    let tot = 0, val = 0, priced = 0, unpriced = 0, pending = 0;
    const list = all();
    for (const r of list) {
      const loaded = prices.has(r.setId);
      for (const [f, n] of Object.entries(r.qty)) {
        tot += n;
        if (!loaded) { pending += n; continue; }
        const e = prices.eur(r.id, f);
        if (e == null) unpriced += n; else { val += e * n; priced += n; }
      }
    }
    return { total: tot, unique: list.length, sets: ownedBySet().size, value: Math.round(val * 100) / 100, priced, unpriced, pending };
  });
}

// charge les cotes de toutes les séries possédées (puis stats() est complet)
export const ensurePrices = () => prices.ensure([...ownedBySet().keys()]);

// ---------- écriture ----------
const pick = (...vals) => { for (const v of vals) if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) return v; return undefined; };

function metaFrom(c, rec) {
  const setId = setIdOf(c.id);
  if (c.partial) c = { ...c, ...(cardSync(c.id) || {}) };   // ligne de l'index : la fiche de la série si elle est chargée
  const m = metaSync(setId);
  const so = c.set && typeof c.set === 'object' ? c.set : null;
  return {
    name: str(pick(c.name, rec?.name) ?? ''),
    localId: str(pick(c.localId, rec?.localId) ?? c.id.slice(setId.length + 1)),
    setId,
    setName: str(pick(c.setName, so?.name, m?.name, rec?.setName) ?? ''),
    setTotal: toInt(pick(c.setTotal, so?.cardCount?.official, m?.total, rec?.setTotal), 0, 9999),
    image: typeof c.image === 'string' ? cleanUrl(c.image) : (rec?.image ?? ''),
    rarity: str(pick(c.rarity, rec?.rarity) ?? ''),
    category: str(pick(c.category, rec?.category) ?? ''),
    dexId: cleanDex(pick(c.dexId, rec?.dexId) ?? []),
  };
}

// quantité d'une finition ; card = brève, fiche TCGdex complète ou enregistrement (ses infos sont gardées)
export function setQty(card, finish, n) {
  if (!FINISHES.includes(finish)) throw new TypeError(`Finition inconnue : ${finish}`);
  const id = card?.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new TypeError('Carte invalide');
  n = Math.max(0, Math.min(999, Math.floor(Number(n) || 0)));
  let rec = data.cards[id];
  const before = rec?.qty[finish] || 0;
  if (n === before) { if (rec) updateMeta(card); return; }      // rien à compter : seulement les infos, sans événement
  let added = false;
  if (!rec) {
    rec = data.cards[id] = { id, qty: {}, addedAt: Date.now(), ...metaFrom(card, null) };
    added = true;
  } else Object.assign(rec, metaFrom(card, rec));
  if (n) rec.qty[finish] = n; else delete rec.qty[finish];
  const removed = !Object.keys(rec.qty).length;
  if (removed) delete data.cards[id];
  emit({ type: 'qty', id, finish, before, after: n, added, removed });
}

export function add(card, finish, n = 1) {
  setQty(card, finish, qtyOf(card?.id, finish) + n);
}

// complète les infos d'une carte possédée (ex. dexId des anciennes sauvegardes), sans événement
export function updateMeta(card) {
  const rec = data.cards[card?.id];
  if (!rec) return false;
  const before = JSON.stringify(rec);
  Object.assign(rec, metaFrom(card, rec));
  if (JSON.stringify(rec) === before) return false;
  memo.clear();
  persist();
  return true;
}

// ---------- produits scellés : possédés (prix d'achat) et suivis — comme l'ancienne appli ----------
export const sealedAll = () => Object.values(data.sealed);
export const sealedGet = id => data.sealed[String(id)];
export function sealedSet(id, entry) {
  const k = String(id);
  const e = entry && cleanSealed(k, { ...entry, id });
  if (e) data.sealed[k] = e;
  else if (data.sealed[k]) delete data.sealed[k];
  else return;
  emit({ type: 'sealed', id });
}
export const watching = id => data.watch.some(w => String(w) === String(id));
export function toggleWatch(id) {
  const i = data.watch.findIndex(w => String(w) === String(id));
  if (i >= 0) data.watch.splice(i, 1);
  else { const c = cleanWatchId(id); if (c === null) return false; data.watch.push(c); }
  emit({ type: 'watch', id });
  return i < 0;
}
export const watchList = () => [...data.watch];

// Scellé de l'ancienne version (identifiants TCGplayer) pas encore relié à Cardmarket : { sealed: [entrée…], watch: [id…] }
export const legacySealed = () => ({ sealed: Object.values(data.tcg?.sealed || {}), watch: [...(data.tcg?.watch || [])] });

// Relie le scellé de l'ancienne version à Cardmarket. map : Map ou objet { idTCGplayer: idCardmarket } ; sans map, la
// table data/market/sealed-img.json (idCardmarket -> idTCGplayer) est lue et inversée. Ce qui n'a pas de correspondance
// reste de côté (affiché comme « à retrouver », exporté dans les sauvegardes). -> { linked, left }
export async function linkLegacySealed(map) {
  const count = () => Object.keys(data.tcg?.sealed || {}).length + (data.tcg?.watch?.length || 0);
  if (!count()) return { linked: 0, left: 0 };
  let inv = map instanceof Map ? map : map && typeof map === 'object' ? new Map(Object.entries(map)) : null;
  if (!inv) {
    try { inv = invertImgMap(await dataFile('data/market/sealed-img.json')); } catch { return { linked: 0, left: count() }; }
  }
  const to = k => { const v = inv.get(String(k)) ?? inv.get(k); const id = cleanWatchId(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v); return id; };
  let linked = 0;
  const tcg = data.tcg;
  for (const [k, e] of Object.entries(tcg.sealed)) {
    const id = to(k);
    if (id === null) continue;
    if (!data.sealed[String(id)]) data.sealed[String(id)] = { ...e, id };
    delete tcg.sealed[k];
    linked++;
  }
  tcg.watch = tcg.watch.filter(w => {
    const id = to(w);
    if (id === null) return true;
    if (!watching(id)) data.watch.push(id);
    linked++;
    return false;
  });
  if (!count()) delete data.tcg;
  if (linked) emit({ type: 'reload' });
  return { linked, left: count() };
}

// sealed-img.json : { idCardmarket: idTCGplayer } (éventuellement sous une clé), valeur nombre, texte ou { tcg | t | id }
function invertImgMap(d) {
  const inv = new Map();
  const isMap = o => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).some(k => /^\d+$/.test(k));
  const src = isMap(d) ? d : Object.values(d || {}).find(isMap) || {};
  for (const [cm, v] of Object.entries(src)) {
    if (!/^\d+$/.test(cm)) continue;
    const t = v && typeof v === 'object' ? v.tcg ?? v.t ?? v.id : v;
    if (t != null && t !== '' && !inv.has(String(t))) inv.set(String(t), Number(cm));
  }
  return inv;
}

// ---------- sauvegarde fichier ----------
export function exportText() {
  return JSON.stringify({ v: 2, app: 'cardex', exportedAt: new Date().toISOString(),
    cards: data.cards, sealed: data.sealed, watch: data.watch, ...(data.tcg ? { tcg: data.tcg } : {}), savedAt: data.savedAt }, null, 1);
}

export function exportFile() {
  const text = exportText();
  const name = `cardex-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name, rel: 'noopener' });
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  data.exportedAt = Date.now();
  persist();
  return { name, size: text.length };
}

// Fusionne une sauvegarde (v1 ou v2) : pour chaque carte et finition, la plus grande quantité.
// Tout est validé (finitions connues, quantités entières 1–999, textes ≤ 200 caractères, identifiants sûrs).
export function importText(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Fichier illisible : ce n’est pas une sauvegarde Cardex'); }
  if (!d || typeof d !== 'object' || !d.cards || typeof d.cards !== 'object') throw new Error('Ce fichier n’est pas une sauvegarde Cardex');
  const inc = migrate(d, { strict: true });
  let cards = 0, updated = 0, sealed = 0, watch = 0;
  for (const r of Object.values(inc.cards)) {
    const cur = data.cards[r.id];
    if (!cur) { data.cards[r.id] = r; cards++; continue; }
    let up = false;
    for (const [f, n] of Object.entries(r.qty)) if (n > (cur.qty[f] || 0)) { cur.qty[f] = n; up = true; }
    for (const k of ['name', 'localId', 'setName', 'rarity', 'category', 'image']) if (!cur[k] && r[k]) cur[k] = r[k];
    if (cur.setTotal == null && r.setTotal != null) cur.setTotal = r.setTotal;
    if (!cur.dexId?.length && r.dexId.length) cur.dexId = r.dexId;
    if (up) updated++;
  }
  for (const [k, s] of Object.entries(inc.sealed)) if (!data.sealed[k]) { data.sealed[k] = s; sealed++; }
  for (const w of inc.watch) if (!watching(w)) { data.watch.push(w); watch++; }
  // scellé de l'ancienne version (identifiants TCGplayer) : gardé à part, sans doublon
  if (inc.tcg) {
    const tcg = (data.tcg ??= { sealed: {}, watch: [] });
    for (const [k, s] of Object.entries(inc.tcg.sealed)) if (!tcg.sealed[k]) { tcg.sealed[k] = s; sealed++; }
    for (const w of inc.tcg.watch) if (!tcg.watch.some(x => String(x) === String(w))) { tcg.watch.push(w); watch++; }
  }
  if (cards || updated || sealed || watch) emit({ type: 'reload' });
  return { cards, updated, sealed, watch, skipped: inc.skipped };
}

export function clearAll() {
  const exportedAt = data.exportedAt;
  data = empty();
  if (exportedAt) data.exportedAt = exportedAt;
  state.readOnly = false; state.corruptRaw = null;
  emit({ type: 'reload' });
}

// Pour les tests (ne pas utiliser dans l'appli)
export const _debug = { reload() { state.readOnly = false; state.corrupt = null; state.corruptRaw = null; state.error = null; data = load(); REV++; memo.clear(); }, data: () => data };
