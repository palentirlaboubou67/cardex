// Decks de tournoi (data/decks.json, construit par tools/build_decks.py d'après Limitless TCG et TCGdex) :
// lecture, prix des cartes (Cardmarket, euros) et comparaison avec la collection, par nom de carte.
import { data } from '../core/net.js';
import { norm } from '../core/format.js';
import { yieldToMain } from '../core/idle.js';
import * as prices from './prices.js';
import * as catalog from './catalog.js';
import * as col from '../state/collection.js';

const ID_RE = /^[\w.%-]+-[\w.%!]+$/;
const FR_IMG = 'https://assets.tcgdex.net/fr/';
const EN_IMG = 'https://assets.tcgdex.net/en/';
const LIMITLESS = 'https://limitlesstcg.com/';
const TYPES = new Set(['pokemon', 'trainer', 'energy']);
// énergies de base, d'après le nom anglais (le drapeau basicEnergy du fichier compte aussi « Jet Energy », « Mist Energy »…)
const BASIC = /^(?:basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy$/i;
const BASIC_FR = { grass: 'Plante', fire: 'Feu', water: 'Eau', lightning: 'Électrique', psychic: 'Psy', fighting: 'Combat', darkness: 'Obscurité', metal: 'Métal', fairy: 'Fée' };
// finitions jouables comparées pour le prix affiché (la moins chère) : les anciennes cotes « trend » et « trend-holo »
export const PLAY_FINISHES = ['normal', 'holo', 'reverse'];
export const READY = 1, CLOSE = 0.7;                 // Jouables : 60/60 ; Presque : au moins 70 %

const setIdOf = catalog.setIdOf;
const str = v => (typeof v === 'string' ? v.trim() : '');
const pos = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const int = (v, min = 1) => (Number.isInteger(v) && v >= min ? v : null);

let DATA = null, loadP = null, cat = null;

function prepCard(c) {
  const en = str(c?.en);
  const type = TYPES.has(c?.type) ? c.type : 'trainer';
  const id = typeof c?.id === 'string' && ID_RE.test(c.id) ? c.id : null;
  const basic = type === 'energy' && BASIC.test(en);
  let name = str(c?.name) || en;
  // énergie de base sans nom français (impression introuvable chez TCGdex) : nom traduit
  if (basic && (!name || name === en || /energy$/i.test(name))) name = `Énergie ${BASIC_FR[en.match(BASIC)[1].toLowerCase()]}`;
  const image = typeof c?.image === 'string' && (c.image.startsWith(FR_IMG) || c.image.startsWith(EN_IMG)) && !/[\s"'<>`]/.test(c.image) ? c.image : '';
  return {
    id, name, en, type, basic, image,
    count: int(c?.count) || 1,
    price: pos(c?.price),
    ref: str(c?.ref),
    key: norm(name),                                   // clé de comparaison avec la collection (nom français)
  };
}

// lecture du fichier, période par période en rendant la main entre deux (pas de longue tâche à l'ouverture)
async function prep(raw) {
  const periods = [], byId = new Map();
  for (const p of Array.isArray(raw?.periods) ? raw.periods : []) {
    if (!p || typeof p !== 'object') continue;
    const per = { id: String(p.id ?? ''), label: str(p.label), era: str(p.era), current: !!p.current, decks: [] };
    for (const d of Array.isArray(p.decks) ? p.decks : []) {
      if (!d || typeof d.id !== 'string' || !/^[\w.-]{1,60}$/.test(d.id) || !Array.isArray(d.cards) || byId.has(d.id)) continue;
      const cards = d.cards.map(prepCard);
      const deck = {
        id: d.id, name: str(d.name) || str(d.en) || 'Deck', en: str(d.en),
        share: pos(d.share), placing: int(d.placing), event: str(d.event),
        list: typeof d.list === 'string' && d.list.startsWith(LIMITLESS) ? d.list : '',
        period: per, cards,
        total: cards.reduce((n, c) => n + c.count, 0),
        hay: null, cardHay: null,                      // texte de recherche, calculé à la première recherche
      };
      per.decks.push(deck);
      byId.set(deck.id, deck);
    }
    periods.push(per);
    await yieldToMain();
  }
  return { updatedAt: str(raw?.updatedAt), source: str(raw?.source), periods, byId };
}

// liste des séries du catalogue (quelles cartes ont une fiche) ; un échec est retenté au prochain load()
const loadCat = () => (cat ? Promise.resolve() : catalog.sets().then(s => { cat = s; }, () => null));

// data/decks.json + liste des séries du catalogue. Ne garde pas les échecs.
export function load() {
  if (DATA) { loadCat(); return Promise.resolve(DATA); }
  loadP ??= Promise.all([data('data/decks.json', { timeout: 20000 }), loadCat()])
    .then(async ([raw]) => (DATA = await prep(raw))).catch(e => { loadP = null; throw e; });
  return loadP;
}
export const loaded = () => DATA;
export const deckSync = id => DATA?.byId.get(id) || null;
export const periods = () => DATA?.periods || [];
export const current = () => DATA?.periods.find(p => p.current) || null;
export const past = () => DATA?.periods.filter(p => !p.current) || [];

// séries des decks absentes du catalogue français (ni fiche ni fichier de cotes) : jamais de lien, même catalogue injoignable
const OUTSIDE = new Set(['bw11']);

// la carte a une fiche dans le catalogue français (sinon : affichée sans lien, ex. bw11-45, bw11-87, bw11-88).
// Catalogue injoignable : toute carte hors des séries connues pour être absentes.
export function linked(c) {
  if (!c?.id) return false;
  const s = setIdOf(c.id);
  if (OUTSIDE.has(s)) return false;
  return cat ? !!catalog.metaSync(s) : true;
}

// carte brève pour les images (js/data/images.js ne fait confiance qu'aux bases FR ; sinon il cherche l'anglais)
export function brief(c) {
  const setId = setIdOf(c.id);
  return { id: c.id, localId: c.id.slice(setId.length + 1), name: c.name, setId, image: c.image.startsWith(FR_IMG) ? c.image : '' };
}
// base d'image anglaise TCGdex d'une carte absente du catalogue français ('' sinon)
export const enImage = c => (c.image.startsWith(EN_IMG) && !linked(c) ? c.image : '');

// ---------- prix ----------
// séries des cartes de ces decks qui ont un fichier de cotes (celles du catalogue)
export function setsOf(decks) {
  const out = new Set();
  for (const d of [].concat(decks || [])) for (const c of d.cards) if (linked(c)) out.add(setIdOf(c.id));
  return [...out];
}
export const ensurePrices = decks => prices.ensure(setsOf(decks));

// finition jouable la moins chère d'après les fichiers de cotes : { finish, eur, low } ou null
export function cheapest(id) {
  if (!id || !prices.has(setIdOf(id))) return null;
  let best = null;
  for (const f of PLAY_FINISHES) {
    const p = prices.get(id, f);
    if (p?.eur != null && (!best || p.eur < best.eur)) best = { finish: f, eur: p.eur, low: p.low };
  }
  return best;
}

// prix affiché d'une carte : la cote Cardmarket la moins chère (normale, holo, reverse), sinon celle de decks.json
export function priceOf(c) {
  return cheapest(c.id)?.eur ?? c.price ?? null;
}

// ---------- comparaison avec la collection ----------
// Pour jouer, n'importe quelle impression convient : comparaison par nom français, toutes finitions confondues.
// Les énergies de base sont comptées comme possédées. Deux lignes du même nom se partagent les exemplaires.
const memo = new WeakMap();
export function status(deck, owned) {
  const key = owned ? null : `${col.rev()}|${prices.version()}`;
  if (key) { const m = memo.get(deck); if (m?.key === key) return m.st; }
  owned ??= col.ownedByName();
  const used = new Map();
  let have = 0, missing = 0, value = 0, unpriced = 0, unpricedMissing = 0, buy = 0;
  const rows = deck.cards.map(c => {
    const left = c.basic ? Infinity : (owned.get(c.key) || 0) - (used.get(c.key) || 0);
    const got = Math.max(0, Math.min(c.count, left));
    if (!c.basic) used.set(c.key, (used.get(c.key) || 0) + got);
    const price = priceOf(c);
    const need = c.count - got;
    have += got;
    buy += need;
    if (price == null) { unpriced += c.count; unpricedMissing += need; }
    else { value += price * c.count; missing += price * need; }
    return { c, got, need, price };
  });
  const total = deck.total, pct = total ? have / total : 0;
  const st = {
    rows, have, total, pct, buy,
    value: Math.round(value * 100) / 100, missing: Math.round(missing * 100) / 100, unpriced, unpricedMissing,
    ready: total > 0 && have >= total, close: pct >= CLOSE && have < total,
  };
  if (key) memo.set(deck, { key, st });
  return st;
}

// cartes à acheter qui ont une fiche (ajout aux envies) : une entrée par id
export function toBuy(st) {
  const seen = new Set();
  return st.rows.filter(r => r.need > 0 && !r.c.basic && linked(r.c) && !seen.has(r.c.id) && seen.add(r.c.id));
}

// ---------- présentation ----------
export const placeLabel = p => (!p ? '' : p === 1 ? '1re place' : `${p}e place`);
const NF_SHARE = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
export const shareLabel = s => (s ? `${NF_SHARE.format(s / 100)} de la méta` : '');

// Deux cartes pour illustrer le deck : de préférence le Pokémon qui lui donne son nom (comme l'ancienne appli).
export function art(deck) {
  if (deck.art) return deck.art;
  const words = deck.en.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['mega', 'box', 'basic'].includes(w)).map(w => w.replace(/'s$/, ''));
  const score = c => (words.some(w => c.en.toLowerCase().includes(w)) ? 100 : 0) + (c.image ? 10 : 0) + c.count;
  const seen = new Set();
  deck.art = deck.cards.filter(c => c.type === 'pokemon' && c.id)
    .map((c, i) => [c, score(c), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(x => x[0])
    .filter(c => !seen.has(c.en) && seen.add(c.en)).slice(0, 2);
  return deck.art;
}

// recherche (texte déjà passé par norm) : nom du deck (français, anglais), sinon la première carte qui correspond ;
// null si rien
export function match(deck, q) {
  if (!q) return { deck: true };
  deck.hay ??= `${norm(deck.name)}|${norm(deck.en)}`;   // « | » : pas de correspondance à cheval sur deux noms
  if (deck.hay.includes(q)) return { deck: true };
  deck.cardHay ??= deck.cards.map(c => `${c.key}|${norm(c.en)}`);
  const i = deck.cardHay.findIndex(h => h.includes(q));
  return i < 0 ? null : { card: deck.cards[i] };
}

// deck le plus avancé (succès « Prêt pour le tournoi ») : { deck, pct } ou null si les decks ne sont pas chargés
export async function best() {
  try { await load(); } catch { return null; }
  let out = null;
  for (const p of DATA.periods) for (const d of p.decks) {
    const pct = status(d).pct;
    if (!out || pct > out.pct) out = { deck: d, pct };
  }
  return out;
}
