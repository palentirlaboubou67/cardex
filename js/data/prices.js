// Cotes Cardmarket des cartes (euros uniquement). Fichiers par série : data/market/prices/<setId>.json (MK, chaque nuit) :
// {"v":1,"d":"2026-11-25","c":{"025":{"normal":[trend,avg1,avg7,avg30,low],…}}} en centimes, null si absent.
// Une finition sans cote renvoie null : jamais le prix de la normale à la place.
import { data, NetError } from '../core/net.js';
import { foilKey } from './finishes.js';

export const CREDIT = 'Cotes Cardmarket (tendance, toutes langues), mises à jour chaque nuit';

const setIdOf = id => { const s = String(id); const i = s.lastIndexOf('-'); return i > 0 ? s.slice(0, i) : s; };
// clés courtes tolérées (« n », « r »…) au cas où
const ALIAS = { n: 'normal', r: 'reverse', h: 'holo', c: 'cosmos', pb: 'pokeball', mb: 'masterball', fe: 'firstEdition', '1e': 'firstEdition', s: 'stamp' };

const FILES = new Map();     // setId -> { d, c } | null (pas de fichier : série sans cotes)
const LOADING = new Map();   // setId -> promesse
const subs = new Set();
let DATE = null, VER = 0;

export const on = fn => (subs.add(fn), () => subs.delete(fn));   // fn([setIds chargés])
export const version = () => VER;                                // change à chaque fichier chargé (clé de mémo)
export const has = setId => FILES.has(setId);                    // fichier chargé (avec ou sans cotes)
export const date = () => DATE;                                  // date du guide Cardmarket (createdAt), 'YYYY-MM-DD'
// mention complète (SPEC §8) pour Réglages et les feuilles ⓘ : « … chaque nuit · prix du 26/11/2026. Cardex n'est pas affilié à Cardmarket. »
export const creditText = () => `${CREDIT}${DATE ? ` · prix du ${DATE.slice(8, 10)}/${DATE.slice(5, 7)}/${DATE.slice(0, 4)}` : ''}. Cardex n’est pas affilié à Cardmarket.`;

function normalize(f) {
  const c = {};
  for (const [lid, fins] of Object.entries(f?.c || {})) {
    const o = {};
    for (const [k, v] of Object.entries(fins || {})) if (Array.isArray(v)) o[ALIAS[k] || k] = v;
    c[lid] = o;
  }
  return { d: typeof f?.d === 'string' ? f.d : null, c };
}

function loadOne(setId) {
  if (FILES.has(setId)) return Promise.resolve(false);
  if (!LOADING.has(setId)) {
    const p = data(`data/market/prices/${setId}.json`).then(f => {
      const n = normalize(f);
      FILES.set(setId, n);
      if (n.d && (!DATE || n.d > DATE)) DATE = n.d;
      return true;
    }, e => {
      if (e instanceof NetError && e.kind === 'notfound') { FILES.set(setId, null); return true; }
      return false;   // hors ligne, serveur… : on réessaiera au prochain ensure()
    }).finally(() => LOADING.delete(setId));
    LOADING.set(setId, p);
  }
  return LOADING.get(setId);
}

// Charge les fichiers de cotes de ces séries (6 en parallèle au plus). Ne rejette jamais.
export async function ensure(setIds) {
  const todo = [...new Set([].concat(setIds || []).filter(Boolean))].filter(s => !FILES.has(s));
  if (!todo.length) return;
  const done = [];
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const s = todo[i++];
      if (await loadOne(s)) done.push(s);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  if (done.length) {
    VER++;
    subs.forEach(fn => { try { fn(done); } catch (e) { console.error(e); } });
  }
}

const c2e = v => (typeof v === 'number' && v > 0 ? v / 100 : null);

// tendance gardée seulement si elle est plausible : dans [réf/5, réf×5] avec réf = avg7, sinon avg30
function shape(trend, avg1, avg7, avg30, low, avg = null) {
  const ref = avg7 ?? avg30;
  const sane = trend != null && (!ref || (trend >= ref / 5 && trend <= ref * 5));
  const eur = sane ? trend : (avg30 ?? avg7 ?? avg1 ?? avg ?? null);
  if (eur == null && low == null) return null;
  return { eur, trend, avg1, avg7, avg30, low };
}

// { eur, trend, avg1, avg7, avg30, low[, allEditions] } en euros, ou null (série non chargée, carte ou finition sans cote).
// 1re édition / tampon sans produit Cardmarket à part : MK y recopie la cote de la carte de base (même tableau que la
// normale ou la holo) -> allEditions: true, à afficher « prix toutes éditions », jamais comme une vraie cote 1re édition.
const sameArr = (a, b) => Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
export function get(cardId, finish = 'normal') {
  const s = setIdOf(cardId), f = FILES.get(s);
  if (!f) return null;
  const row = f.c[String(cardId).slice(s.length + 1)];
  const a = row?.[finish];
  if (!a) return null;
  const p = shape(c2e(a[0]), c2e(a[1]), c2e(a[2]), c2e(a[3]), c2e(a[4]));
  if (p && (finish === 'firstEdition' || finish === 'stamp') && (sameArr(a, row.normal) || sameArr(a, row.holo))) p.allEditions = true;
  return p;
}

export const eur = (cardId, finish = 'normal') => get(cardId, finish)?.eur ?? null;

// variation : maintenant vs moyennes 30 et 7 jours (en %, ex. 41.2)
export function change(cardId, finish = 'normal') {
  const p = get(cardId, finish);
  if (!p || p.eur == null) return null;
  const pct = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);
  return { now: p.eur, a1: p.avg1, a7: p.avg7, a30: p.avg30, pct30: pct(p.eur, p.avg30), pct7: pct(p.eur, p.avg7) };
}

// Somme des cotes connues d'une série (page série) : { value, priced, unpriced } pour les cartes données.
export function sum(entries /* [{ id, finish, n }] */) {
  let value = 0, priced = 0, unpriced = 0;
  for (const { id, finish, n = 1 } of entries) {
    const e = eur(id, finish);
    if (e == null) unpriced += n; else { value += e * n; priced += n; }
  }
  return { value: Math.round(value * 100) / 100, priced, unpriced };
}

// ---------- Secours : cote TCGdex en direct (fiche carte), avec la correspondance corrigée cmFor ----------
// Cardmarket (Pokémon) : champs de base = la carte telle qu'imprimée (normale, ou la holo quand il n'y a pas de normale) ;
// champs « -holo » = annonces reverse. Les produits séparés des finitions de type reverse se vendent comme reverse.
const lc = s => String(s || '').toLowerCase();
export function cmFor(full, finish) {              // -> [enregistrement cardmarket | null, suffixe, produit séparé]
  const cm = full?.pricing?.cardmarket || null;
  const v = full?.variants || {};
  const vd = Array.isArray(full?.variants_detailed) ? full.variants_detailed : [];
  if (finish === 'cosmos' || finish === 'pokeball' || finish === 'masterball') {
    const d = vd.find(x => foilKey(x) === finish);
    if (!d) return [null, '', false];                // la carte n'a pas cette finition
    const dc = d.pricing?.cardmarket;
    const reverseType = finish !== 'cosmos' || lc(d.type) === 'reverse';
    if (dc && dc.idProduct !== cm?.idProduct) return [dc, reverseType ? '-holo' : '', true];
    // pas de produit séparé : les annonces reverse du produit de base ne valent que si c'est la seule reverse
    const plainReverse = vd.length ? vd.some(x => lc(x.type) === 'reverse' && !foilKey(x)) : !!v.reverse;
    if (reverseType) return plainReverse ? [null, '', false] : [cm, '-holo', false];
    return v.normal ? [null, '', false] : [cm, '', false];      // cosmos de type holo = la carte de base sans normale
  }
  if (finish === 'reverse') return [cm, '-holo', false];
  if (finish === 'holo' && v.normal) {               // normale ET holo : seul un produit holo séparé a une cote holo
    const d = vd.find(x => lc(x.type) === 'holo' && !foilKey(x));
    const dc = d?.pricing?.cardmarket;
    return dc && dc.idProduct !== cm?.idProduct ? [dc, '', true] : [null, '', false];
  }
  return [cm, '', false];                            // normale, holo seule (la holo EST le produit), 1re éd., tampon
}

function readCm(cm, s) {
  const n = k => (typeof cm?.[k + s] === 'number' && cm[k + s] > 0 ? cm[k + s] : null);
  return shape(n('trend'), n('avg1'), n('avg7'), n('avg30'), n('low'), n('avg'));
}

// même forme que get(), ou null ; full = fiche TCGdex complète (ou son id : chargée à la demande)
export function liveSync(full, finish = 'normal') {
  const [cm, sfx, separate] = cmFor(full, finish);
  if (!cm) return null;
  return readCm(cm, sfx) || (separate ? readCm(cm, sfx ? '' : '-holo') : null);
}

export async function live(full, finish = 'normal') {
  if (typeof full === 'string') {
    const { card } = await import('./tcgdex.js');
    full = await card(full);
  }
  return liveSync(full, finish);
}

// Pour les tests
export function _reset() { FILES.clear(); LOADING.clear(); DATE = null; VER++; }
