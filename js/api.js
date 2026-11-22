// Accès à l'API publique TCGdex (cartes en français, images et prix Cardmarket).
const BASE = 'https://api.tcgdex.net/v2/fr';
const GRAPHQL = 'https://api.tcgdex.net/v2/graphql';
const memo = new Map();

function get(path) {
  if (!memo.has(path)) {
    const p = fetch(BASE + path).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    memo.set(path, p);
    p.catch(() => memo.delete(path));
  }
  return memo.get(path);
}

const readLS = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const img = (base, q = 'low') => (base ? `${base}/${q}.webp` : '');
export const setIdOf = cardId => cardId.slice(0, cardId.lastIndexOf('-'));

// Les séries de Pokémon TCG Pocket (jeu mobile) ne sont pas des cartes physiques.
export const isPocket = id => /^(A\d|B\d|P-A)/.test(id);

// Logos : celui de TCGdex en français, sinon data/logos.json (anglais / pokemontcg.io).
// Jamais le symbole du bas des cartes : sans logo, l'appli affiche une plaque avec le nom.
let LOGOS = {};
export const logosReady = fetch('data/logos.json').then(r => r.json()).then(d => { LOGOS = d; }).catch(() => {});
export const setLogo = s => (s?.logo ? `${s.logo}.webp` : LOGOS[s?.id] || '');

// La liste des séries change rarement : on la garde un jour en local.
const SETS_KEY = 'cardex.sets.cache';
export async function sets() {
  const c = readLS(SETS_KEY);
  let d = c && Date.now() - c.t < 86400000 ? c.d : null;
  if (!d) {
    d = await get('/sets');
    writeLS(SETS_KEY, { t: Date.now(), d });
  }
  return d.filter(s => !isPocket(s.id));
}

export async function setsById() {
  const list = await sets();
  return new Map(list.map((s, i) => [s.id, { ...s, order: i }]));
}

export const set = id => get(`/sets/${encodeURIComponent(id)}`);

// Blocs (Écarlate et Violet, Épée et Bouclier…) avec la liste de leurs séries, gardés un jour.
const SERIES_KEY = 'cardex.series.cache';
export async function series() {
  const c = readLS(SERIES_KEY);
  if (c && Date.now() - c.t < 86400000) return c.d;
  const list = (await get('/series')).filter(s => s.id !== 'tcgp');
  const d = (await Promise.all(list.map(s => get(`/series/${encodeURIComponent(s.id)}`).catch(() => null))))
    .filter(Boolean)
    .map(s => ({ id: s.id, name: s.name, logo: s.logo || '', date: s.releaseDate || s.firstSet?.releaseDate || '', sets: (s.sets || []).map(x => x.id) }));
  writeLS(SERIES_KEY, { t: Date.now(), d });
  return d;
}
export const card = id => get(`/cards/${encodeURIComponent(id)}`);
export const search = (name, max = 80) => get(`/cards?name=${encodeURIComponent(name)}${max ? `&pagination:itemsPerPage=${max}` : ''}`);
export const byDex = n => get(`/cards?dexId=eq:${n}`);

// ---------- Finitions ----------
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
function foilKey(d) {
  const f = norm(d.foil);
  if (f.includes('cosmo')) return 'cosmos';
  if (f.includes('pokeball')) return 'pokeball';
  if (f.includes('masterball')) return 'masterball';
  return null;
}
const STD = ['normal', 'reverse', 'holo', 'firstEdition'];

// Finitions qui existent pour cette carte d'après TCGdex (les tamponnées restent en ajout manuel).
export function finishesOf(full) {
  const v = full?.variants || {};
  const out = STD.filter(k => v[k]);
  for (const d of full?.variants_detailed || []) {
    const k = foilKey(d);
    if (k && !out.includes(k)) out.push(k);
  }
  return out.length ? out : ['normal'];
}

// Prix Cardmarket (tendance, en euros) selon la finition.
export function priceOf(full, variant = 'normal') {
  const cm = full?.pricing?.cardmarket;
  const num = v => (typeof v === 'number' && v > 0 ? v : null);
  if (['cosmos', 'pokeball', 'masterball'].includes(variant)) {
    const d = (full?.variants_detailed || []).find(d => foilKey(d) === variant);
    const dc = d?.pricing?.cardmarket;
    if (dc && dc.idProduct !== cm?.idProduct) return num(dc.trend) || num(dc.avg);
  }
  if (!cm) return null;
  return variant === 'normal' || variant === 'firstEdition' || variant === 'stamp'
    ? num(cm.trend) || num(cm.avg)
    : num(cm['trend-holo']) || num(cm['avg-holo']) || num(cm.trend);
}

// Finitions de toutes les cartes d'une série, pour le master set.
// Rapide : GraphQL (normale / reverse / holo / 1re éd.) en 2-3 requêtes.
// Complet (sur demande) : la fiche de chaque carte, pour les reverses Poké Ball, Master Ball, Cosmo.
async function setVariants(setId) {
  const map = {};
  for (let page = 1; page < 10; page++) {
    const query = `{ cards(filters:{id:${JSON.stringify(setId + '-')}}, pagination:{page:${page},count:100}) { id variants { normal reverse holo firstEdition } } }`;
    const r = await fetch(GRAPHQL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    const cards = (await r.json())?.data?.cards || [];
    for (const c of cards) {
      if (setIdOf(c.id) !== setId) continue;
      const f = STD.filter(k => c.variants?.[k]);
      map[c.id] = f.length ? f : ['normal'];
    }
    if (cards.length < 100) break;
  }
  return map;
}

// Finitions standard de toutes les cartes d'un Pokémon (gardées une semaine : de nouvelles cartes sortent).
export async function dexFinishes(n) {
  const key = `cardex.dexfin.${n}`;
  const c = readLS(key);
  if (c && Date.now() - c.t < 7 * 86400000) return c.map;
  const map = {};
  for (let page = 1; page < 10; page++) {
    const query = `{ cards(filters:{dexId:${n | 0}}, pagination:{page:${page},count:100}) { id variants { normal reverse holo firstEdition } } }`;
    const r = await fetch(GRAPHQL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    const cards = (await r.json())?.data?.cards || [];
    for (const x of cards) {
      const f = STD.filter(k => x.variants?.[k]);
      map[x.id] = f.length ? f : ['normal'];
    }
    if (cards.length < 100) break;
  }
  writeLS(key, { t: Date.now(), map });
  return map;
}

const finKey = id => `cardex.fin.${id}`;
export const finishesDeep = id => !!readLS(finKey(id))?.deep;

export async function setFinishes(s, onProgress) {
  let c = readLS(finKey(s.id));
  if (!c) {
    c = { deep: false, map: await setVariants(s.id) };
    writeLS(finKey(s.id), c);
  }
  if (onProgress && !c.deep) {
    const ids = s.cards.map(x => x.id);
    let done = 0, i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try { c.map[id] = finishesOf(await card(id)); } catch {}
        onProgress(++done, ids.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    c.deep = true;
    writeLS(finKey(s.id), c);
  }
  return c.map;
}
