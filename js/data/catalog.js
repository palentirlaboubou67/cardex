// Catalogue : fichiers statiques de CA (data/sets.json, data/sets/<id>.json, data/cards-index.json) lus par net.data(),
// avec TCGdex en direct en secours (séries absentes des fichiers, découvertes en arrière-plan).
import { data, cached, NetError } from '../core/net.js';
import { words } from './dex.js';
import { registerSets, cardImg, ready as imagesReady } from './images.js';

export const setIdOf = cardId => { const s = String(cardId); const i = s.lastIndexOf('-'); return i > 0 ? s.slice(0, i) : s; };
export const localIdOf = cardId => String(cardId).slice(setIdOf(cardId).length + 1);

const CAT = { P: 'Pokémon', D: 'Dresseur', E: 'Énergie' };
const ASSETS = 'https://assets.tcgdex.net/fr/';
const DAY = 86400000;
// TCGdex en direct (secours) : chargé seulement quand il sert (pas sur le chemin du premier écran)
const live = () => import('./tcgdex.js');
const isPocket = id => /^(A\d|B\d|P-A)/.test(String(id || ''));   // même règle que tcgdex.isPocket (séries Pocket)

// ---------- séries ----------
let SETS = null;            // { blocs, sets, byId, hidden }
let setsP = null;
let liveMerged = false;
const subs = new Set();
export const onUpdate = fn => (subs.add(fn), () => subs.delete(fn));   // nouvelles séries découvertes en direct

// métadonnées normalisées (les champs absents ou null deviennent '' / 0 / false)
const meta0 = m => ({
  id: m.id, name: m.name || m.id, bloc: m.bloc || m.serie || '', serie: m.serie || m.bloc || '',
  date: m.date || '', total: m.total || 0, count: m.count || 0, code: m.code || '',
  logo: m.logo || '', logoLang: m.logoLang || '', sym: m.sym || '',
  legal: { standard: !!m.legal?.standard, expanded: !!m.legal?.expanded }, tag: m.tag || null, dark: !!m.dark,
  ...(m.live ? { live: true } : {}),
});

function build(blocsIn, setsIn, hidden) {
  const hid = new Set(hidden || []);
  const metas = [];
  const seen = new Set();
  for (const s of setsIn) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    metas.push({ ...s, ...meta0(s) });
  }
  const byId = new Map(metas.map(m => [m.id, m]));
  // les plus récentes d'abord (tri stable : l'ordre du fichier départage)
  const visible = metas.filter(m => !hid.has(m.id)).map((m, i) => [m, i])
    .sort((a, b) => (b[0].date || '').localeCompare(a[0].date || '') || a[1] - b[1]).map(x => x[0]);
  visible.forEach((m, i) => { m.order = i; });
  const blocMap = new Map();
  for (const b of blocsIn || []) {
    if (b?.id) blocMap.set(b.id, { id: b.id, name: b.name || b.id, logo: b.logo || '', first: b.first || '', dark: !!b.dark, special: !!b.special, sets: [] });
  }
  for (const m of visible) {
    if (!blocMap.has(m.bloc)) blocMap.set(m.bloc, { id: m.bloc, name: m.blocName || m.bloc || 'Autres', logo: '', first: '', dark: false, special: false, sets: [], synth: true });
    blocMap.get(m.bloc).sets.push(m);
  }
  for (const b of blocMap.values()) {
    // bloc absent de sets.json : sa date = celle de sa première série
    if (!b.first) b.first = b.sets.reduce((d, m) => (m.date && (!d || m.date < d) ? m.date : d), '');
  }
  // Ordre de sets.json (grandes périodes, la plus récente d'abord, puis les blocs « special » : McDonald's, kits, POP).
  // Un bloc absent du fichier (série découverte en direct) se place parmi les grandes périodes selon sa série la plus récente.
  const newest = b => b.sets[0]?.date || '';
  const known = [...blocMap.values()].filter(b => !b.synth && b.sets.length);
  const blocs = [...known.filter(b => !b.special), ...known.filter(b => b.special)];
  for (const b of [...blocMap.values()].filter(x => x.synth && x.sets.length).sort((x, y) => newest(y).localeCompare(newest(x)))) {
    const at = blocs.findIndex(x => x.special || newest(x) < newest(b));
    blocs.splice(at < 0 ? blocs.length : at, 0, b);
  }
  for (const b of blocs) delete b.synth;
  registerSets(metas);
  return { blocs, sets: visible, byId, hidden: hid };
}

// { blocs, sets (visibles, plus récentes d'abord), byId } — immédiat si data/sets.json est là
export function sets() {
  if (SETS) return Promise.resolve(SETS);
  setsP ??= fetchSets().catch(e => { setsP = null; throw e; });
  return setsP;
}

async function fetchSets() {
  let st = null, err = null;
  try { st = await data('data/sets.json'); } catch (e) { err = e; }
  if (st && Array.isArray(st.sets) && st.sets.length) {
    SETS = build(st.blocs, st.sets, st.hidden);
    SETS.fromFile = true;
    mergeLive();                                      // en arrière-plan, sans bloquer
    return SETS;
  }
  // pas de fichier statique : la liste TCGdex en direct (gardée 1 jour, copie périmée en secours)
  try {
    const live = await liveSets();
    SETS = build([], live, []);
    liveMerged = true;
    return SETS;
  } catch (e) { throw err || e; }
}

// Toutes les séries FR en une requête GraphQL (@locale), sinon REST liste + détail. Gardées 1 jour.
async function liveSets() {
  return cached('cardex.cache.livesets', DAY, async () => {
    const tcgdex = await live();
    try {
      const d = await tcgdex.gql('{ sets @locale(lang:"fr") { id name releaseDate abbreviation { official } cardCount { total official } logo symbol legal { standard expanded } serie { id name } } }');
      const list = (d?.sets || []).filter(s => s?.id && !isPocket(s.id) && s.serie?.id !== 'tcgp' && (s.cardCount?.total || 0) > 0);
      if (list.length > 50) return list.map(tcgdex.toMeta);
    } catch { /* REST ci-dessous */ }
    const list = (await tcgdex.setList()).filter(s => s?.id && !isPocket(s.id) && (s.cardCount?.total || 0) > 0);
    return list.map(s => tcgdex.toMeta(s));
  });
}

// Séries de TCGdex absentes de data/sets.json (sortie récente) : ajoutées en arrière-plan, gardées 1 jour.
async function mergeLive() {
  if (liveMerged) return;
  liveMerged = true;
  try {
    const list = await cached('cardex.cache.setlist', DAY, async () =>
      (await (await live()).setList()).map(s => ({ id: s.id, n: s.cardCount?.total || 0 })));
    const missing = list.filter(s => s.id && s.n > 0 && !isPocket(s.id) && !SETS.byId.has(s.id) && !SETS.hidden.has(s.id));
    if (!missing.length) return;
    const metas = [];
    const tcgdex = await live();
    for (const s of missing.slice(0, 8)) {
      try {
        metas.push(await cached(`cardex.cache.setinfo.${s.id}`, DAY, async () => tcgdex.toMeta(await tcgdex.setInfo(s.id))));
      } catch { /* série ignorée */ }
    }
    if (!metas.length) return;
    const blocs = SETS.blocs.map(b => ({ id: b.id, name: b.name, logo: b.logo, first: b.first, dark: b.dark, special: b.special }));
    SETS = build(blocs, [...SETS.byId.values(), ...metas], [...SETS.hidden]);
    SETS.fromFile = true;
    subs.forEach(fn => { try { fn(SETS); } catch (e) { console.error(e); } });
  } catch { /* hors ligne : on garde le fichier statique */ }
}

// La liste des séries de TCGdex (gardée un jour par mergeLive) connaît-elle cette série ? -> true | false | null (pas de
// liste récente). Un lien vers une série qui n'existe nulle part (« #/serie/zz-nope ») ne fait alors aucune requête.
function liveListHas(id) {
  try {
    const c = JSON.parse(localStorage.getItem('cardex.cache.setlist'));
    if (!c || !Array.isArray(c.d) || !(Date.now() - c.t < DAY)) return null;
    return c.d.some(s => s?.id === id);
  } catch { return null; }
}

// métadonnées d'une série si elles sont chargées (synchrone, pour les autres modules)
export const metaSync = id => SETS?.byId.get(id) || LIVE_META.get(id) || null;
const LIVE_META = new Map();

// La série a-t-elle des fichiers statiques (data/sets/<id>.json, data/market/prices/<id>.json) ? Le catalogue de CA
// (data/sets.json) les liste toutes : une série absente de ce fichier (lien tapé à la main, série sortie depuis) n'en a
// pas, inutile de les demander (deux 404). -> true | false | null (data/sets.json pas encore là : on ne sait pas).
// wait : attendre data/sets.json s'il est déjà en route (jamais de requête en plus).
export function hasFiles(id, { wait = false } = {}) {
  const answer = () => (SETS?.fromFile ? !!SETS.byId.get(id) && !SETS.byId.get(id).live : null);
  if (SETS || !wait || !setsP) return wait ? Promise.resolve(answer()) : answer();
  return setsP.then(answer, () => null);
}

// Objectif d'une barre de progression : le total imprimé (« 165 » pour 151), sauf quand le catalogue français a
// moins de cartes que lui (promos, kits : svp, swshp, dpp… n'atteindraient jamais leur total officiel) : alors count.
export const goalOf = m => { const t = m?.total || 0, c = m?.count || 0; return c && (!t || c < t) ? c : t; };

// ---------- cartes d'une série ----------
const SETC = new Map();      // id -> { meta, cards, byId }
const SETP = new Map();

// carte brève (SPEC §5.2) + setName / setTotal de la série (libellés des tuiles : « 151, 025/165 »)
function brief(setId, serie, c, meta) {
  const l = String(c.l);
  const image = c.i === 1 ? `${ASSETS}${serie}/${setId}/${l}` : typeof c.i === 'string' ? c.i : '';
  return {
    id: `${setId}-${l}`, localId: l, name: c.n || '', setId, image,
    rarity: c.r || '', category: CAT[c.c] || c.c || '',
    dexId: Array.isArray(c.d) ? c.d : [],
    finishes: Array.isArray(c.f) && c.f.length ? c.f : ['normal'],
    setName: meta?.name || '', setTotal: meta?.total || 0,
  };
}

const pack = (meta, cards, extra = {}) => ({ meta, cards, byId: new Map(cards.map(c => [c.id, c])), ...extra });

// { meta, cards } : data/sets/<id>.json, sinon TCGdex en direct (REST + finitions GraphQL)
export function set(id) {
  if (SETC.has(id)) return Promise.resolve(SETC.get(id));
  if (!SETP.has(id)) {
    const p = loadSet(id).then(r => { SETC.set(id, r); return r; }).finally(() => SETP.delete(id));
    SETP.set(id, p);
  }
  return SETP.get(id);
}

async function loadSet(id) {
  const all = await sets().catch(() => null);
  let meta = all?.byId.get(id) || LIVE_META.get(id) || null;
  let staticErr;
  try {
    if (hasFiles(id) === false) {                    // pas dans le catalogue : pas de fichier, TCGdex en direct
      const err = new NetError('notfound', 404, `data/sets/${id}.json`);
      if (liveListHas(id) === false) throw Object.assign(err, { final: true });   // TCGdex ne la connaît pas non plus
      throw err;
    }
    const f = await data(`data/sets/${id}.json`);
    const serie = f.serie || meta?.serie || meta?.bloc || '';
    const list = Array.isArray(f.cards) ? f.cards : [];
    meta ??= meta0({ id, name: id, serie, bloc: serie, count: list.length });
    return pack(meta, list.map(c => brief(id, serie, c, meta)));
  } catch (e) { staticErr = e; }
  if (staticErr?.final) throw staticErr;
  try {
    const got = await (await live()).setLive(id);
    if (!meta) { meta = meta0(got.meta); LIVE_META.set(id, meta); registerSets([meta]); }
    for (const c of got.cards) { c.setName = meta.name; c.setTotal = meta.total; }
    return pack(meta, got.cards, { live: true, finishesKnown: got.finishesKnown });
  } catch (e) {
    // l'erreur la plus parlante : celle du fichier statique, sauf s'il n'existe simplement pas
    throw staticErr instanceof NetError && staticErr.kind !== 'notfound' ? staticErr : e;
  }
}

// carte brève via le fichier de sa série (null si inconnue)
export async function card(id) {
  try {
    const s = await set(setIdOf(id));
    return s.byId.get(id) || null;
  } catch (e) {
    if (e instanceof NetError && e.kind === 'notfound') return null;
    throw e;
  }
}

export const cardSync = id => SETC.get(setIdOf(id))?.byId.get(id) || null;
export const setSync = id => SETC.get(id) || null;

// Charge plusieurs séries (6 en parallèle au plus) ; ignore celles qui échouent.
export async function loadSets(ids, { concurrency = 6 } = {}) {
  const todo = [...new Set(ids)].filter(id => !SETC.has(id));
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
    while (i < todo.length) { const id = todo[i++]; try { await set(id); } catch { /* ignorée */ } }
  }));
}

// ---------- index de toutes les cartes (recherche, Pokédex) ----------
let IDX = null, idxP = null;
const NORM = new Map();      // nom -> clé normalisée (les noms se répètent beaucoup)
const normName = s => { let v = NORM.get(s); if (v === undefined) { v = words(s); NORM.set(s, v); } return v; };

// rend la main au navigateur (saisie, rendu) pendant la construction de l'index
const yieldNow = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(r => setTimeout(r, 0)));
const now = () => (globalThis.performance ? performance.now() : Date.now());

// ~20 000 lignes avec leur nom normalisé : construites par tranches de ~6 ms (jamais une longue tâche)
function index() {
  if (IDX) return Promise.resolve(IDX);
  idxP ??= (async () => {
    const [d, all] = await Promise.all([data('data/cards-index.json'), sets()]);
    const rows = [];
    let t0 = now();
    for (const [setId, list] of Object.entries(d?.sets || {})) {
      const m = all.byId.get(setId) || metaSync(setId);
      if (all.hidden.has(setId)) continue;
      const order = m?.order ?? 9999;
      for (const r of list || []) {
        if (!Array.isArray(r)) continue;
        const l = String(r[0]), n = String(r[1] || '');
        rows.push({ id: `${setId}-${l}`, setId, l, n, k: normName(n), nk: numKey(l), d: Array.isArray(r[2]) ? r[2] : [], i: r[3] ?? 0, order });
      }
      if (now() - t0 > 6) { await yieldNow(); t0 = now(); }
    }
    IDX = { rows, dex: null };
    return IDX;
  })().catch(e => { idxP = null; throw e; });
  return idxP;
}

// Prépare l'index quand la page est au repos (champ de recherche affiché, page Pokémon proche) : la première
// frappe ne paie plus le téléchargement ni la construction.
export function warmIndex() {
  if (IDX || idxP) return;
  const go = () => { index().catch(() => {}); };
  if (globalThis.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 200);
}

// ligne de l'index → carte brève partielle (rareté, catégorie exacte et finitions : dans le fichier de la série)
function rowBrief(r) {
  const full = cardSync(r.id);
  if (full) return full;
  const m = metaSync(r.setId);
  const serie = m?.serie || m?.bloc || '';
  const image = r.i === 1 && serie ? `${ASSETS}${serie}/${r.setId}/${r.l}` : typeof r.i === 'string' ? r.i : '';
  return {
    id: r.id, localId: r.l, name: r.n, setId: r.setId, image,
    rarity: '', category: r.d.length ? 'Pokémon' : '', dexId: r.d, finishes: [],
    setName: m?.name || '', setTotal: m?.total || 0, partial: true,
  };
}

const numKey = l => { const m = /^0*(\d+)$/.exec(l); return m ? m[1] : String(l).toUpperCase().replace(/^([A-Z]+)0*(\d)/, '$1$2'); };
const byNewest = (a, b) => a.order - b.order || (parseInt(a.l, 10) || 0) - (parseInt(b.l, 10) || 0) || a.l.localeCompare(b.l);

// ---------- recherche ----------
// nom (sans accents ni casse : début > début de mot > milieu), « 025/165 », « 25 », code + numéro (« MEW 25 »), « #25 »
export async function search(query, { limit = 120 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { sets: [], cards: [], count: 0 };
  const all = await sets();
  const [idx] = await Promise.all([index(), imagesReady]);
  const hasImg = r => (r.i ? 1 : cardImg({ id: r.id, localId: r.l, image: '' }).urls.length ? 1 : 0);
  let hits = [];

  // « #25 » : Pokédex
  let m = /^#\s*(\d{1,4})$/.exec(q);
  if (m) {
    const list = await cardsOfDex(+m[1]);
    return { sets: [], cards: list.slice(0, limit), count: list.length };
  }

  const nq = words(q);
  const setHits = matchSets(all.sets, q, nq);

  const totalSets = tot => new Set(all.sets.filter(s => s.total === tot || s.count === tot).map(s => s.id));

  // « 025/165 » ou « TG05/TG30 »
  m = /^([a-z]*\d+[a-z]?)\s*\/\s*([a-z]*\d+)$/i.exec(q);
  if (m) {
    const want = numKey(m[1]), okSets = totalSets(parseInt(m[2].replace(/^\D+/, ''), 10));
    hits = idx.rows.filter(r => okSets.has(r.setId) && r.nk === want).sort(byNewest);
    return done(hits, [], limit);
  }

  // numéro imprimé avec lettres : « SWSH001 », « TG05 », « GG01 », « SV49 », « RC5 », « H01 », « XY01 »
  // (avant le découpage code + numéro : « SV49 » est d'abord la carte SV49, puis la 49 de la série de code SV)
  const printed = /^[a-z]{1,5}\d{1,4}[a-z]?$/i.test(q) ? idx.rows.filter(r => r.nk === numKey(q)).sort(byNewest) : [];

  // code de série + numéro : « MEW 25 », « MEW025 », « mew 025 » ; aussi l'id TCGdex (« sma SV49 », « sv03.5-025 »)
  const byCode = codesOf(all);
  const splits = [];
  m = /^([a-z0-9.]{2,12})[\s-]+([a-z]*\d+[a-z]?)$/i.exec(q);
  if (m) splits.push([m[1], m[2]]);
  else if (/^[a-z]/i.test(q)) for (let k = 2; k <= Math.min(6, q.length - 1); k++) splits.push([q.slice(0, k), q.slice(k)]);
  for (const [c, num] of splits) {
    const ids = byCode.get(c.toUpperCase()) || (all.byId.has(c.toLowerCase()) && !all.hidden.has(c.toLowerCase()) ? new Set([c.toLowerCase()]) : null);
    if (!ids || !/^[a-z]*\d+[a-z]?$/i.test(num)) continue;
    const want = numKey(num);
    hits = idx.rows.filter(r => ids.has(r.setId) && r.nk === want).sort(byNewest);
    if (hits.length) break;
  }
  if (printed.length || hits.length) {
    const seen = new Set(printed.map(r => r.id));
    return done([...printed, ...hits.filter(r => !seen.has(r.id))], [], limit);
  }

  // numéro seul : « 25 » (toutes les séries, les plus récentes d'abord)
  if (/^\d{1,4}$/.test(q)) {
    const want = numKey(q);
    hits = idx.rows.filter(r => r.nk === want).sort(byNewest);
    return done(hits, setHits, limit);
  }

  // nom + numéro : « pikachu 25 », « pikachu 025 », « pikachu 025/165 », « dracaufeu ex SV107 »
  m = /^(.*\S)\s+([a-z]{0,5}\d{1,4}[a-z]?)(?:\s*\/\s*([a-z]*\d+))?$/i.exec(q);
  if (m && words(m[1]).length >= 2) {
    const want = numKey(m[2]), okSets = m[3] ? totalSets(parseInt(m[3].replace(/^\D+/, ''), 10)) : null;
    hits = byName(idx.rows.filter(r => r.nk === want && (!okSets || okSets.has(r.setId))), words(m[1]), hasImg);
    if (hits.length) return done(hits, [], limit);
  }

  if (nq.length < 2) return { sets: setHits, cards: [], count: 0 };
  return done(byName(idx.rows, nq, hasImg), setHits, limit);
}

// nom : exact > début > début de mot > milieu > tous les mots ; puis les cartes avec image, les plus récentes
function byName(rows, nq, hasImg) {
  const tokens = nq.split(' ');
  const scored = [];
  for (const r of rows) {
    const n = r.k;
    let t;
    if (n === nq) t = 0;
    else if (n.startsWith(nq)) t = 1;
    else if (n.includes(` ${nq}`)) t = 2;
    else if (n.includes(nq)) t = 3;
    else if (tokens.length > 1 && tokens.every(w => n.startsWith(w) || n.includes(` ${w}`))) t = 4;
    else continue;
    scored.push([t, r]);
  }
  scored.sort((a, b) => a[0] - b[0] || hasImg(b[1]) - hasImg(a[1]) || byNewest(a[1], b[1]));
  return scored.map(x => x[1]);
}

let CODES = null, codesFor = null;
function codesOf(all) {
  if (codesFor !== all) {
    CODES = new Map();
    for (const s of all.sets) {
      if (!s.code) continue;
      const k = s.code.toUpperCase();
      if (!CODES.has(k)) CODES.set(k, new Set());
      CODES.get(k).add(s.id);
    }
    codesFor = all;
  }
  return CODES;
}

function done(rows, setHits, limit) {
  return { sets: setHits, cards: rows.slice(0, limit).map(rowBrief), count: rows.length };
}

function matchSets(list, q, nq) {
  if (nq.length < 2 && !/^\d+$/.test(q)) return [];
  const code = q.toUpperCase();
  const out = [];
  for (const s of list) {
    const n = normName(s.name);
    let t;
    if (s.code && s.code.toUpperCase() === code) t = 0;
    else if (n === nq) t = 0;
    else if (n.startsWith(nq)) t = 1;
    else if (n.includes(` ${nq}`)) t = 2;
    else if (nq.length >= 3 && n.includes(nq)) t = 3;
    else continue;
    out.push([t, s]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1].order - b[1].order).map(x => x[1]).slice(0, 24);
}

// ---------- toutes les cartes d'un Pokémon ----------
// Numéros de l'index (TCGdex, plus ceux que CA devine d'après le nom pour les séries sans dexId et les cartes duo) ;
// les plus récentes d'abord. Pas de devinette ici : les lignes sans numéro sont des Dresseurs et des Énergies
// (« Lien Spirituel Mewtwo », « Poupée Ronflex »…). full: true charge aussi les fichiers des séries (6 en parallèle).
export async function cardsOfDex(n, { full = false } = {}) {
  const idx = await index();
  if (!idx.dex) {
    const dex = new Map();
    for (const r of idx.rows) {
      for (const k of r.d) { if (!dex.has(k)) dex.set(k, []); dex.get(k).push(r); }
    }
    for (const list of dex.values()) list.sort(byNewest);
    idx.dex = dex;
  }
  const rows = idx.dex.get(n | 0) || [];
  if (full) await loadSets(rows.map(r => r.setId));
  return rows.map(rowBrief);
}

// Pour les tests
export function _reset() { SETS = null; setsP = null; liveMerged = false; SETC.clear(); SETP.clear(); IDX = null; idxP = null; LIVE_META.clear(); }
