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
// seule base d'image gardée : TCGdex FR (le résolveur déduit l'anglais et Scrydex de l'id) ; une sauvegarde piégée
// ne peut donc pas faire charger un autre hôte à chaque tuile
const IMG_BASE = 'https://assets.tcgdex.net/fr/';
const cleanUrl = v => (typeof v === 'string' && v.length <= MAX_STR && v.startsWith(IMG_BASE) && /^[\w:/.%!-]+$/.test(v) ? v : '');
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
  // données de la v1 : finitions à revoir d'après le catalogue (repairFinishes), une fois les séries chargées
  if ((d.v !== 2 || d.fixFin === 1) && Object.keys(out.cards).length) out.fixFin = 1;
  Object.defineProperty(out, 'skipped', { value: skipped, enumerable: false });
  return out;
}

// ---------- état ----------
const state = { readOnly: false, corrupt: null, corruptRaw: null, error: null, notice: null, failures: 0, alert: false, lastKind: null };
const BACKUP = `${KEY}.corrupt.`;
// La collection est lue et validée au premier usage, pas pendant l'évaluation des modules : avec 2 000 cartes, lire
// et migrer ~500 Ko de JSON coûte ~20 ms à CPU ×4, et main.js le fait dans une tâche à part (SPEC §12, pas de longue
// tâche au démarrage). Un problème de lecture est signalé juste après (main.js écoute déjà 'cardex:storage').
let DATA = null;
let REV = 0, queue = null, dirty = false;
const subs = new Set(), memo = new Map();
function D() {
  if (DATA) return DATA;
  DATA = load();
  if (typeof window !== 'undefined') setTimeout(startupSignal, 0);
  return DATA;
}
// lecture faite maintenant (main.js : dans sa propre tâche, avant le premier écran) -> nombre de cartes
export const warm = () => Object.keys(D().cards).length;
// la sauvegarde contient-elle au moins une carte ? Sans la lire (squelette du démarrage, avant warm())
export function peekHasCards() {
  if (DATA) return Object.keys(DATA.cards).length > 0;
  try { return /"cards"\s*:\s*\{\s*"/.test(localStorage.getItem(KEY) || ''); } catch { return false; }
}

function readRaw() {
  try { return { raw: localStorage.getItem(KEY) }; } catch (e) { return { raw: null, blocked: e }; }
}

// clés des copies de secours (les plus anciennes d'abord)
function backupKeys() {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(BACKUP)) out.push(k); } }
  catch { /* stockage bloqué */ }
  return out.sort((a, b) => (+a.slice(BACKUP.length) || 0) - (+b.slice(BACKUP.length) || 0));
}

function load() {
  const { raw, blocked } = readRaw();
  if (blocked) { state.error = 'blocked'; return empty(); }
  if (raw == null) return empty();
  let d;
  try { d = JSON.parse(raw); } catch { d = undefined; }
  if (d && typeof d === 'object' && d.cards && typeof d.cards === 'object') return migrate(d);
  if (d === null) return empty();
  // JSON illisible ou inattendu : copie de secours (une seule par texte), puis on repart de zéro tout de suite,
  // sinon chaque démarrage referait une copie et remplirait le stockage (partagé par tout le domaine github.io)
  let k = null;
  try { k = backupKeys().find(x => localStorage.getItem(x) === raw) || null; } catch { /* rien */ }
  if (!k) {
    k = `${BACKUP}${Date.now()}`;
    try { localStorage.setItem(k, raw); }
    catch { state.readOnly = true; state.corruptRaw = raw; return empty(); }   // pas de place : on ne touche à rien
  }
  state.corrupt = k;
  state.notice = 'corrupt';
  try { localStorage.removeItem(KEY); } catch { /* rien : la copie existe, le prochain enregistrement remplacera */ }
  return empty();
}

const isQuota = e => e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

// caches de l'ancienne appli (jamais relus par la nouvelle) : retirés au démarrage, sans attendre un quota plein
const LEGACY_CACHE = ['cardex.sets.cache', 'cardex.series.cache', 'cardex.fin.', 'cardex.dexfin.', 'cardex.cotes.'];
// caches qui peuvent partir quand le stockage est plein (l'ancienne appli, et les nôtres)
const CACHE_PREFIX = [...LEGACY_CACHE, 'cardex.cache.', 'cardex.live.'];
function evictCaches(prefixes = CACHE_PREFIX) {
  let n = 0;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of keys) if (k && prefixes.some(p => k.startsWith(p))) { localStorage.removeItem(k); n++; }
  } catch { /* rien */ }
  return n;
}
export const cleanLegacyCaches = () => evictCaches(LEGACY_CACHE);

// Messages prêts à afficher (toast persistant avec l'action « Exporter », et Réglages)
export const STORAGE_MESSAGES = {
  quota: 'Stockage plein : tes derniers changements ne sont pas enregistrés. Exporte ta collection.',
  unknown: 'Enregistrement impossible : tes derniers changements ne sont pas enregistrés. Exporte ta collection.',
  readonly: 'Ta collection n’a pas pu être lue et il n’y a plus de place pour en garder une copie : rien n’est enregistré.',
  blocked: 'Le stockage du navigateur est bloqué : rien n’est enregistré sur cet appareil.',
  corrupt: 'Ta collection enregistrée était illisible : une copie a été gardée et une collection vide a été créée.',
};

// Événement window 'cardex:storage' : detail { error, readOnly, message, repeat, recovered, corrupt }.
// error = 'quota' | 'unknown' | 'readonly' | 'blocked' | 'corrupt' (info) | null (enregistrement revenu à la normale).
// repeat = même erreur que la précédente (le toast est sans doute déjà affiché).
function signal(kind, extra = {}) {
  if (kind && kind !== 'corrupt') { state.alert = true; state.lastKind = kind; }   // problème d'enregistrement affiché
  try {
    globalThis.dispatchEvent?.(new CustomEvent('cardex:storage', { detail: {
      error: kind, readOnly: state.readOnly, message: kind ? STORAGE_MESSAGES[kind] || '' : '', corrupt: state.corrupt, ...extra } }));
  } catch { /* rien */ }
}

function failed(kind) {
  state.failures++;
  const repeat = state.alert && state.lastKind === kind;   // déjà signalé (au démarrage ou au dernier échec)
  state.error = kind;
  signal(kind, { repeat });
  return false;
}
function saved() {
  state.error = null; state.failures = 0;
  if (state.alert) { state.alert = false; state.lastKind = null; signal(null, { recovered: true }); }   // le toast peut partir
  return true;
}

function persist() {
  if (state.readOnly) return failed('readonly');
  if (state.error === 'blocked') return failed('blocked');
  D().savedAt = Date.now();
  const s = JSON.stringify(D());
  try { localStorage.setItem(KEY, s); return saved(); }
  catch (e) {
    if (isQuota(e) && evictCaches()) {
      try { localStorage.setItem(KEY, s); return saved(); } catch { /* toujours plein */ }
    }
    return failed(isQuota(e) ? 'quota' : 'unknown');
  }
}

// Démarrage : problème de lecture signalé juste après la première lecture (D()), puis ménage des caches de l'ancienne
// appli quand la page est au repos.
function startupSignal() {
  if (state.readOnly) signal('readonly');
  else if (state.error === 'blocked') signal('blocked');
  else if (state.notice) signal(state.notice);
}
if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 2000));
  idle(() => cleanLegacyCaches(), { timeout: 10000 });
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
// même chose, enregistré sans attendre la microtâche -> true si l'enregistrement a réussi
function emitNow(ev) {
  emit(ev, false);
  dirty = false;
  return persist();
}

// fn(events) une fois par microtâche ; renvoie la fonction de désabonnement
export const on = fn => (subs.add(fn), () => subs.delete(fn));
export const rev = () => REV;
export const lastSave = () => D().savedAt || 0;
export const lastExport = () => D().exportedAt || 0;
// Pour Réglages et le toast de main.js : { readOnly, error ('quota'|'unknown'|'readonly'|'blocked'|null),
// notice ('corrupt' : copie faite à ce démarrage | null), message (texte à afficher, '' si tout va bien),
// corrupt (clé de cette copie), backups: [{ key, at (ms), size (caractères) }], hasCorruptText, bytes }
export function storageState() {
  D();                                   // la lecture dit s'il y a un problème
  const backups = [];
  let bytes = 0;
  try {
    for (const key of backupKeys()) backups.push({ key, at: +key.slice(BACKUP.length) || 0, size: (localStorage.getItem(key) || '').length });
    bytes = (localStorage.getItem(KEY) || '').length;
  } catch { /* bloqué */ }
  const kind = state.readOnly ? 'readonly' : state.error || state.notice;
  return { readOnly: state.readOnly, error: state.error, notice: state.notice, message: kind ? STORAGE_MESSAGES[kind] || '' : '',
    corrupt: state.corrupt, backups, hasCorruptText: !!state.corruptRaw, bytes };
}
// texte d'une copie de secours (à proposer au téléchargement) ; sans clé : le texte illisible gardé en mémoire
export function corruptText(key) {
  D();
  if (key == null) return state.corruptRaw;
  if (typeof key !== 'string' || !key.startsWith(BACKUP)) return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
// supprime une copie de secours (Réglages, après l'avoir téléchargée) -> true si elle existait
export function deleteBackup(key) {
  if (typeof key !== 'string' || !key.startsWith(BACKUP)) return false;
  try {
    if (localStorage.getItem(key) == null) return false;
    localStorage.removeItem(key);
  } catch { return false; }
  if (state.corrupt === key) { state.corrupt = null; state.notice = null; }
  return true;
}
// repartir de zéro sans copie (lecture seule faute de place, après téléchargement du texte) -> enregistré ?
export function discardCorrupt() { state.readOnly = false; state.corruptRaw = null; return persist(); }

// autre onglet (appli installée + onglet du navigateur) : on relit au lieu de s'écraser mutuellement
if (typeof addEventListener === 'function') {
  addEventListener('storage', e => {
    if (e.key !== KEY && e.key !== null) return;
    let raw = e.key === null ? readRaw().raw : e.newValue;
    let d = null;
    try { d = raw ? JSON.parse(raw) : null; } catch { return; }   // écriture illisible : on garde la nôtre
    DATA = d && d.cards ? migrate(d) : empty();
    state.readOnly = false; state.corruptRaw = null;
    emit({ type: 'reload' }, false);
  });
}

// ---------- lecture ----------
const memoize = (name, fn) => { if (!memo.has(name)) memo.set(name, fn()); return memo.get(name); };
export const total = rec => (rec ? Object.values(rec.qty).reduce((a, b) => a + b, 0) : 0);
export const all = () => memoize('all', () => Object.values(D().cards));   // enregistrements (lecture seule)
export const get = id => D().cards[id];
export const has = id => !!D().cards[id];
export const qtyOf = (id, finish) => {
  const r = D().cards[id];
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
  let rec = D().cards[id];
  const before = rec?.qty[finish] || 0;
  if (n === before) { if (rec) updateMeta(card); return; }      // rien à compter : seulement les infos, sans événement
  let added = false;
  if (!rec) {
    rec = D().cards[id] = { id, qty: {}, addedAt: Date.now(), ...metaFrom(card, null) };
    added = true;
  } else Object.assign(rec, metaFrom(card, rec));
  if (n) rec.qty[finish] = n; else delete rec.qty[finish];
  const removed = !Object.keys(rec.qty).length;
  if (removed) delete D().cards[id];
  emit({ type: 'qty', id, finish, before, after: n, added, removed });
}

export function add(card, finish, n = 1) {
  setQty(card, finish, qtyOf(card?.id, finish) + n);
}

// complète les infos d'une carte possédée (ex. dexId des anciennes sauvegardes), sans événement
export function updateMeta(card) {
  const rec = D().cards[card?.id];
  if (!rec) return false;
  const before = JSON.stringify(rec);
  Object.assign(rec, metaFrom(card, rec));
  if (JSON.stringify(rec) === before) return false;
  memo.clear();
  persist();
  return true;
}

// ---------- finitions de la v1 ----------
// L'ancien scanner enregistrait la finition préréglée (« Normale ») même sur une carte qui n'existe qu'en holo
// (Dracaufeu-ex 151 : f = ['holo']) ; Cardmarket ne la cote qu'en « holo » (le produit de base EST la holo).
// main.js charge les séries possédées au repos puis appelle repairFinishes(cartes de la série) : « normale » devient
// « holo » sur ces cartes (quantités additionnées) ; sur une carte qui n'existe qu'en Cosmo (promos SWSH / SV / ME : ni
// normale ni holo), elle devient « cosmos ». Rien d'autre n'est deviné. -> nombre de cartes corrigées
export const needsFinishCheck = () => D().fixFin === 1;
export function repairFinishes(cards) {
  let n = 0;
  for (const c of cards || []) {
    const rec = D().cards[c?.id];
    const f = Array.isArray(c?.finishes) ? c.finishes : null;
    if (!rec?.qty.normal || !f?.length || f.includes('normal')) continue;
    const to = f.includes('holo') ? 'holo' : f.includes('cosmos') ? 'cosmos' : null;
    if (!to) continue;
    rec.qty[to] = Math.min(999, (rec.qty[to] || 0) + rec.qty.normal);
    delete rec.qty.normal;
    n++;
  }
  if (n) emit({ type: 'reload' });
  return n;
}
export function finishCheckDone() {
  if (D().fixFin !== 1) return;
  delete D().fixFin;
  persist();
}

// ---------- produits scellés : possédés (prix d'achat) et suivis — comme l'ancienne appli ----------
export const sealedAll = () => Object.values(D().sealed);
export const sealedGet = id => D().sealed[String(id)];
export function sealedSet(id, entry) {
  const k = String(id);
  const e = entry && cleanSealed(k, { ...entry, id });
  if (e) D().sealed[k] = e;
  else if (D().sealed[k]) delete D().sealed[k];
  else return;
  emit({ type: 'sealed', id });
}
export const watching = id => D().watch.some(w => String(w) === String(id));
export function toggleWatch(id) {
  const i = D().watch.findIndex(w => String(w) === String(id));
  if (i >= 0) D().watch.splice(i, 1);
  else { const c = cleanWatchId(id); if (c === null) return false; D().watch.push(c); }
  emit({ type: 'watch', id });
  return i < 0;
}
export const watchList = () => [...D().watch];

// Scellé de l'ancienne version (identifiants TCGplayer) pas encore relié à Cardmarket : { sealed: [entrée…], watch: [id…] }
export const legacySealed = () => ({ sealed: Object.values(D().tcg?.sealed || {}), watch: [...(D().tcg?.watch || [])] });

// Relie le scellé de l'ancienne version à Cardmarket. map : Map ou objet { idTCGplayer: idCardmarket } ; sans map, la
// table data/market/sealed-img.json (idCardmarket -> idTCGplayer) est lue et inversée. Ce qui n'a pas de correspondance
// reste de côté (affiché comme « à retrouver », exporté dans les sauvegardes). -> { linked, left }
export async function linkLegacySealed(map) {
  const count = () => Object.keys(D().tcg?.sealed || {}).length + (D().tcg?.watch?.length || 0);
  if (!count()) return { linked: 0, left: 0 };
  let inv = map instanceof Map ? map : map && typeof map === 'object' ? new Map(Object.entries(map)) : null;
  if (!inv) {
    try { inv = invertImgMap(await dataFile('data/market/sealed-img.json')); } catch { return { linked: 0, left: count() }; }
  }
  const to = k => { const v = inv.get(String(k)) ?? inv.get(k); const id = cleanWatchId(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v); return id; };
  let linked = 0;
  const tcg = D().tcg;
  for (const [k, e] of Object.entries(tcg.sealed)) {
    const id = to(k);
    if (id === null) continue;
    if (!D().sealed[String(id)]) D().sealed[String(id)] = { ...e, id };
    delete tcg.sealed[k];
    linked++;
  }
  tcg.watch = tcg.watch.filter(w => {
    const id = to(w);
    if (id === null) return true;
    if (!watching(id)) D().watch.push(id);
    linked++;
    return false;
  });
  if (!count()) delete D().tcg;
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
// fixFin : finitions de la v1 pas encore revues (séries injoignables) ; gardé dans le fichier, l'appareil qui
// l'importe fera la correction (sinon une carte holo seule resterait « Normale » pour de bon)
export function exportText() {
  const d = D();
  return JSON.stringify({ v: 2, app: 'cardex', exportedAt: new Date().toISOString(),
    cards: d.cards, sealed: d.sealed, watch: d.watch, ...(d.tcg ? { tcg: d.tcg } : {}), ...(d.fixFin === 1 ? { fixFin: 1 } : {}),
    savedAt: d.savedAt }, null, 1);
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
  D().exportedAt = Date.now();
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
    const cur = D().cards[r.id];
    if (!cur) { D().cards[r.id] = r; cards++; continue; }
    let up = false;
    for (const [f, n] of Object.entries(r.qty)) if (n > (cur.qty[f] || 0)) { cur.qty[f] = n; up = true; }
    for (const k of ['name', 'localId', 'setName', 'rarity', 'category', 'image']) if (!cur[k] && r[k]) cur[k] = r[k];
    if (cur.setTotal == null && r.setTotal != null) cur.setTotal = r.setTotal;
    if (!cur.dexId?.length && r.dexId.length) cur.dexId = r.dexId;
    if (up) updated++;
  }
  if (inc.fixFin && (cards || updated)) D().fixFin = 1;
  for (const [k, s] of Object.entries(inc.sealed)) if (!D().sealed[k]) { D().sealed[k] = s; sealed++; }
  for (const w of inc.watch) if (!watching(w)) { D().watch.push(w); watch++; }
  // scellé de l'ancienne version (identifiants TCGplayer) : gardé à part, sans doublon
  if (inc.tcg) {
    const tcg = (D().tcg ??= { sealed: {}, watch: [] });
    for (const [k, s] of Object.entries(inc.tcg.sealed)) if (!tcg.sealed[k]) { tcg.sealed[k] = s; sealed++; }
    for (const w of inc.tcg.watch) if (!tcg.watch.some(x => String(x) === String(w))) { tcg.watch.push(w); watch++; }
  }
  // enregistré tout de suite : saved dit à l'écran si l'import est vraiment gardé (stockage plein…)
  const ok = cards || updated || sealed || watch ? emitNow({ type: 'reload' }) : true;
  return { cards, updated, sealed, watch, skipped: inc.skipped, saved: ok };
}

// -> true si la collection vide est enregistrée
export function clearAll() {
  const exportedAt = D().exportedAt;
  DATA = empty();
  if (exportedAt) D().exportedAt = exportedAt;
  state.readOnly = false; state.corruptRaw = null;
  return emitNow({ type: 'reload' });
}

// Pour les tests (ne pas utiliser dans l'appli)
export const _debug = { reload() { Object.assign(state, { readOnly: false, corrupt: null, corruptRaw: null, error: null, notice: null, failures: 0, alert: false, lastKind: null }); DATA = load(); REV++; memo.clear(); }, data: () => D() };
