// Produits scellés, Cardmarket uniquement (euros). Catalogue data/market/sealed.json (MK, chaque nuit) et historique
// data/market/hist/<h>.json ({ d: [dates], p: { id: [centimes…] } }). Lus par net.data() (hash du manifest).
// eur null = « Pas de vente récente » ; low (« dès … ») seulement s'il est plausible (0,3× à 3× la cote).
// c7 / c30 / c90 / c365 viennent de notre historique ; chg = date du dernier changement de cote (cotes figées).
import { data, NetError } from '../core/net.js';
import { norm } from '../core/format.js';
import * as prices from './prices.js';

// ---------- types ----------
export const KIND_ORDER = ['box', 'halfbox', 'etb', 'bundle', 'coffret', 'tin', 'blister', 'booster', 'deck', 'prerelease', 'kit', 'case'];
// libellé d'un produit (titre de la fiche, ligne « type » des tuiles)
export const KIND = {
  box: 'Display', halfbox: 'Demi-display', etb: 'Coffret Dresseur d’Élite', bundle: 'Bundle', coffret: 'Coffret',
  tin: 'Pokébox', blister: 'Blister', booster: 'Booster', deck: 'Deck', prerelease: 'Stratégies et Combats',
  kit: 'Kit du Dresseur', case: 'Carton',
};
// puces du catalogue (une famille de produits)
export const CHIP = {
  box: 'Display', halfbox: 'Demi-display', etb: 'Coffret Dresseur d’Élite', bundle: 'Bundle', coffret: 'Coffret',
  tin: 'Pokébox et tins', blister: 'Blister', booster: 'Booster', deck: 'Deck', prerelease: 'Avant-première',
  kit: 'Kit du Dresseur', case: 'Carton et présentoir',
};

// ---------- périodes de variation ----------
export const PERIODS = ['c7', 'c30', 'c90', 'c365'];
export const DAYS = { c7: 7, c30: 30, c90: 91, c365: 365 };
export const PER = { c7: '7 j', c30: '30 j', c90: '3 mois', c365: '1 an' };              // pastilles
export const PER_LONG = { c7: '7 jours', c30: '30 jours', c90: '3 mois', c365: '1 an' };  // titres, tri
const MIN_AVAIL = 30;          // une période « existe » quand au moins 30 produits en ont une variation

// ---------- chargement ----------
let DB = null, P = null;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pos = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const day = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const str = s => (typeof s === 'string' ? s : '');

function clean(p) {
  const eur = pos(p.eur);
  const low = pos(p.low);
  const out = {
    id: p.id, k: p.k, l: p.l === 'ja' ? 'ja' : 'int', sid: str(p.sid) || null, set: str(p.set), rel: day(p.rel),
    fr: str(p.fr) || str(p.n) || `Produit ${p.id}`, n: str(p.n), img: /^https:\/\//.test(p.img) ? p.img : '',
    eur, low: eur && low && low >= 0.3 * eur && low <= 3 * eur ? low : null,
    c7: num(p.c7), c30: num(p.c30), c90: num(p.c90), c365: num(p.c365),
    first: pos(p.first), since: day(p.since), max: pos(p.max), chg: day(p.chg), h: str(p.h) || null,
  };
  return out;
}

function prep(d) {
  const products = [];
  for (const p of Array.isArray(d?.products) ? d.products : []) {
    if (p && Number.isInteger(p.id) && KIND[p.k]) products.push(clean(p));
  }
  const byId = new Map(products.map(p => [p.id, p]));
  const n = Object.fromEntries(PERIODS.map(k => [k, 0]));
  let since0 = null;
  for (const p of products) {
    for (const k of PERIODS) if (p[k] != null) n[k]++;
    if (p.since && (!since0 || p.since < since0)) since0 = p.since;
  }
  const avail = new Set(PERIODS.filter(k => n[k] >= MIN_AVAIL));
  DB = { products, byId, avail, since0, priceDate: day(d?.priceDate) || day(String(d?.updatedAt || '').slice(0, 10)), updatedAt: d?.updatedAt || null };
  return DB;
}

// le catalogue (mémorisé) ; rejette hors ligne sans copie (NetError)
export function load() {
  P ??= data('data/market/sealed.json').then(prep).catch(e => { P = null; throw e; });
  return P;
}
export const loaded = () => DB;
export const get = id => DB?.byId.get(Number(id)) || null;

// ---------- libellés ----------
// « Display – Règne Delta » → { type: 'Display', name: 'Règne Delta' } ; sans tiret : le type, puis le nom entier
export function split(p) {
  const i = p.fr.indexOf(' – ');
  return i > 0 ? { type: p.fr.slice(0, i), name: p.fr.slice(i + 3) } : { type: KIND[p.k] || 'Produit', name: p.fr };
}
export const year = p => (p.rel ? p.rel.slice(0, 4) : '');
export const isJa = p => p.l === 'ja';

// texte de recherche (sans accents ni casse), calculé à la première recherche
const qOf = p => (p._q ??= norm(`${p.fr} ${p.n} ${p.set} ${CHIP[p.k]} ${KIND[p.k]} ${p.l === 'ja' ? 'japonais japon' : ''} ${p.rel ? p.rel.slice(0, 4) : ''}`));
export function matcher(q) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return null;
  return p => { const s = qOf(p); return words.every(w => s.includes(w)); };
}

// langue choisie : 'int' (international, défaut), 'ja' (japonais), 'tout'
export const langOk = (p, lang) => lang === 'tout' || p.l === (lang === 'ja' ? 'ja' : 'int');

// ---------- variations ----------
const DAY_MS = 86400000;
const t = s => new Date(`${s}T12:00:00`).getTime();
export const daysBetween = (a, b) => Math.round((t(b) - t(a)) / DAY_MS);

// la plus longue variation connue du produit parmi les périodes données : { key, v, per } | null
export function change(p, keys = ['c365', 'c90', 'c30', 'c7']) {
  for (const k of keys) if (p[k] != null) return { key: k, v: p[k], per: PER[k] };
  return null;
}

// cote figée : pas de changement depuis au moins `days` jours → date du dernier changement, sinon null
export function stillSince(p, days) {
  const ref = DB?.priceDate;
  if (!p.chg || !ref) return null;
  return daysBetween(p.chg, ref) >= days ? p.chg : null;
}

// premier prix connu → prix actuel (×)
export const mult = p => (p.eur && p.first ? p.eur / p.first : null);

// ---------- historique ----------
const HIST = new Map();
function shard(h) {
  if (!HIST.has(h)) {
    const pr = data(`data/market/hist/${h}.json`).catch(e => {
      if (e instanceof NetError && e.kind === 'notfound') return null;   // pas d'historique pour ce groupe
      HIST.delete(h);
      throw e;
    });
    HIST.set(h, pr);
  }
  return HIST.get(h);
}
// points [{ d, v (euros) }] du produit, du plus ancien au plus récent ; [] sans historique ; rejette hors ligne
export async function history(p) {
  if (!p?.h) return [];
  const f = await shard(p.h);
  const col = f?.p?.[String(p.id)];
  if (!f || !Array.isArray(f.d) || !Array.isArray(col)) return [];
  const out = [];
  for (let i = 0; i < f.d.length; i++) {
    const c = col[i];
    if (typeof c === 'number' && c > 2 && day(f.d[i])) out.push({ d: f.d[i], v: c / 100 });   // 1–2 centimes : plancher, jamais une cote
  }
  return out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

// dernier mouvement de la cote : { prev, now, pct, date (premier jour au prix actuel) } ; { since } si jamais bougée
export function lastMove(points) {
  if (!points?.length) return null;
  const now = points[points.length - 1].v;
  for (let i = points.length - 2; i >= 0; i--) {
    if (Math.abs(points[i].v - now) >= 0.005) {
      return { prev: points[i].v, now, pct: ((now - points[i].v) / points[i].v) * 100, date: points[i + 1].d };
    }
  }
  return { since: points[0].d, now };
}

// ---------- liens et mentions ----------
export const cmUrl = p => `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent((p.n || p.fr).replace(/\s*\[[^\]]+\]/g, '').trim())}`;
export const bigImg = u => String(u || '').replace(/_200w\.jpg$/, '_400w.jpg');
export const PHOTO_CREDIT = 'Photos des produits : TCGplayer (version anglaise).';
// mention Cardmarket (SPEC §8) avec la date du guide des produits scellés
export function creditText() {
  const d = DB?.priceDate;
  if (!d || d === prices.date()) return prices.creditText();
  return `${prices.CREDIT} · prix du ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}. Cardex n’est pas affilié à Cardmarket.`;
}

// ---------- catalogue : tri ----------
const byNull = (a, b) => (a == null) - (b == null);
const desc = k => (a, b) => byNull(a[k], b[k]) || (b[k] ?? 0) - (a[k] ?? 0) || (b.eur ?? 0) - (a.eur ?? 0);
const asc = k => (a, b) => byNull(a[k], b[k]) || (a[k] ?? 0) - (b[k] ?? 0) || (b.eur ?? 0) - (a.eur ?? 0);
export const SORTS = {
  new: (a, b) => byNull(a.rel, b.rel) || (b.rel || '').localeCompare(a.rel || '') || (b.eur ?? 0) - (a.eur ?? 0),
  c365: desc('c365'), c90: desc('c90'), c30: desc('c30'), c7: desc('c7'),
  b365: asc('c365'), b90: asc('c90'), b30: asc('c30'), b7: asc('c7'),
  mult: (a, b) => byNull(mult(a), mult(b)) || (mult(b) ?? 0) - (mult(a) ?? 0),
  asc: (a, b) => byNull(a.eur, b.eur) || a.eur - b.eur,
  desc: (a, b) => byNull(a.eur, b.eur) || b.eur - a.eur,
};
// options du tri : seulement les périodes qui ont des données (et la valeur demandée, même sans données)
export function sortOptions(current) {
  const av = DB?.avail || new Set();
  const o = [['new', 'Nouveautés']];
  for (const k of ['c365', 'c90', 'c30', 'c7']) if (av.has(k) || current === k) o.push([k, `Hausse sur ${PER_LONG[k]}`]);
  for (const k of ['c365', 'c90', 'c30', 'c7']) { const b = `b${k.slice(1)}`; if (av.has(k) || current === b) o.push([b, `Baisse sur ${PER_LONG[k]}`]); }
  o.push(['mult', 'Plus-value depuis le premier prix'], ['asc', 'Prix croissant'], ['desc', 'Prix décroissant']);
  return o;
}
// la variation à montrer pour un tri donné (tri sur 30 jours : la variation sur 30 jours)
export const sortKey = tri => (/^[cb](7|30|90|365)$/.test(tri || '') ? `c${tri.slice(1)}` : null);

// catalogue filtré : { list, counts: { all, suivis, [kind]: n } } ; type '' = tous (sans les cartons), 'suivis'.
// Les produits suivis restent visibles dans toutes les langues (comme dans les pistes) : la langue ne les filtre pas.
export function catalogue({ q = '', type = '', tri = 'new', lang = 'int', watch = [] } = {}) {
  if (!DB) return { list: [], counts: { all: 0, suivis: 0 } };
  const m = matcher(q);
  const w = new Set(watch.map(String));
  const base = [], mine = [];
  const counts = { all: 0, suivis: 0 };
  for (const p of DB.products) {
    if (m && !m(p)) continue;
    if (w.size && w.has(String(p.id))) mine.push(p);
    if (!langOk(p, lang)) continue;
    base.push(p);
    counts[p.k] = (counts[p.k] || 0) + 1;
    if (p.k !== 'case') counts.all++;
  }
  counts.suivis = mine.length;
  const list = type === 'suivis' ? mine
    : KIND[type] ? base.filter(p => p.k === type)
    : base.filter(p => p.k !== 'case');
  list.sort(SORTS[tri] || SORTS.new);
  return { list, counts };
}

// nombre de produits suivis qui répondent à la recherche (toutes langues) : puce « Suivis » sans tout recalculer
export function followedCount(q = '', watch = []) {
  if (!DB) return 0;
  const m = matcher(q);
  let n = 0;
  for (const id of new Set(watch.map(String))) { const p = DB.byId.get(Number(id)); if (p && (!m || m(p))) n++; }
  return n;
}

// section « Tes produits suivis » des pistes (les derniers suivis d'abord), ou null
export function followedIdea(watch = []) {
  const list = [...watch].reverse().map(id => DB?.byId.get(Number(id))).filter(Boolean);
  return list.length ? { id: 'suivis', title: 'Tes produits suivis', sub: 'Ceux que tu as marqués d’une étoile dans leur fiche.', list, tri: null, type: 'suivis' } : null;
}

// ---------- pistes : 6 sections calculées sur l'historique ----------
// La période de chaque section suit l'historique disponible (1 an → 3 mois → 30 jours → 7 jours) et son titre dit
// la période réellement utilisée. Ni cartons, ni boosters à l'unité, ni pièces de musée (5 € à 1 500 €).
const REG = { c365: 20, c90: 12, c30: 6 };          // hausse régulière : plus de N %
const DYN = { c90: 10, c30: 10, c7: 5 };            // forte dynamique
const DOWN = { c365: 20, c90: 15, c30: 10, c7: 8 }; // en baisse : plus de N % de baisse
// Une variation hors de ces bornes, ou une cote sans offre plausible en vente (low), vient presque toujours d'une vente
// isolée (vieux tripack passé de 150 € à 1 500 €) : écartée des pistes, jamais du catalogue.
const CAP = { c7: 50, c30: 100, c90: 200, c365: 500 };
const sane = (p, k) => p[k] != null && p.low != null && p[k] <= CAP[k] && p[k] >= -80;
const monthYear = d => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
const pctTxt = n => `${n} %`;

export function ideas({ lang = 'int', watch = [] } = {}) {
  if (!DB) return [];
  const P = DB.products.filter(p => p.k !== 'case' && p.k !== 'booster' && p.eur != null && p.eur >= 5 && p.eur <= 1500 && langOk(p, lang));
  const av = ['c365', 'c90', 'c30', 'c7'].filter(k => DB.avail.has(k));
  const L = av.find(k => k !== 'c7') || null;                              // période longue
  const M = L ? av[av.indexOf(L) + 1] || null : (av.includes('c7') ? 'c7' : null);   // la suivante, plus courte
  const shorter = L ? av.slice(av.indexOf(L) + 1) : [];
  const ref = DB.priceDate ? t(DB.priceDate) : Date.now();
  const months = p => (p.rel ? (ref - t(p.rel)) / (30.44 * DAY_MS) : null);
  const out = [];

  const followed = followedIdea(watch);
  if (followed) out.push(followed);

  let reg = [];
  if (L) {
    // la période juste plus courte ne baisse pas, les suivantes pas plus de 5 %
    reg = P.filter(p => sane(p, L) && p[L] > REG[L] && shorter.every((k, i) => p[k] == null || (i === 0 ? p[k] >= 0 : p[k] > -5)))
      .sort((a, b) => b[L] - a[L]);
    out.push({ id: 'reguliere', title: `Hausse régulière sur ${PER_LONG[L]}`, per: L,
      sub: `Plus de ${pctTxt(REG[L])} sur ${PER_LONG[L]}, sans baisse marquée depuis : la demande tient dans la durée.`, list: reg, tri: L });
  }
  if (M) {
    const seen = new Set(reg.slice(0, 12).map(p => p.id));
    const dyn = P.filter(p => sane(p, M) && p[M] > DYN[M] && !seen.has(p.id)).sort((a, b) => b[M] - a[M]);
    out.push({ id: 'dynamique', title: `Forte dynamique sur ${PER_LONG[M]}`, per: M,
      sub: 'Les plus fortes hausses récentes. Une hausse rapide peut aussi retomber : à surveiller avant d’acheter.', list: dyn, tri: M });
  }
  const fresh = P.filter(p => ['etb', 'box', 'bundle', 'coffret', 'tin'].includes(p.k) && months(p) != null && months(p) >= 0 && months(p) < 10
    && p.first && p.eur <= p.first * 1.1).sort(SORTS.new);
  out.push({ id: 'sortie', title: 'Encore proches de leur prix de sortie',
    sub: 'Sortis il y a moins de 10 mois et pas plus de 10 % au-dessus de leur premier prix. Les produits prennent souvent de la valeur quand ils ne sont plus réimprimés.',
    list: fresh, tri: 'new' });
  if (DB.since0) {
    const cut = new Date(t(DB.since0) + 45 * DAY_MS).toISOString().slice(0, 10);
    const gains = P.filter(p => p.since && p.since <= cut && p.first && p.eur > p.first && p.low != null).sort(SORTS.mult);
    const when = monthYear(DB.since0);
    out.push({ id: 'plusvalues', title: `Les plus belles plus-values depuis ${when}`,
      sub: `Le prix actuel comparé au premier prix connu (${when} pour les produits plus anciens).`, list: gains, tri: 'mult' });
  }
  if (M) {
    const down = P.filter(p => sane(p, M) && p[M] < -DOWN[M]).sort((a, b) => a[M] - b[M]);
    out.push({ id: 'baisse', title: `En baisse sur ${PER_LONG[M]}`, per: M,
      sub: `Plus de ${pctTxt(DOWN[M])} de baisse : une occasion pour certains, un signal d’alerte pour d’autres.`, list: down, tri: `b${M.slice(1)}` });
  }
  return out.filter(s => s.list.length);
}

// Pour les tests
export function _reset() { DB = null; P = null; HIST.clear(); }
