// Appels TCGdex en direct (l'exception : fiche détaillée d'une carte, recherche et séries absentes des fichiers statiques).
// Au plus 4 requêtes par seconde, pause puis nouvel essai sur 429/503, délai maximal sur chaque appel.
import { getJSON, NetError } from '../core/net.js';
import { finishesOf } from './finishes.js';

export const API = 'https://api.tcgdex.net/v2/fr';
export const GRAPHQL = 'https://api.tcgdex.net/v2/graphql';
const CAT = { P: 'Pokémon', D: 'Dresseur', E: 'Énergie' };
const EN_CAT = { Pokemon: 'Pokémon', 'Pokémon': 'Pokémon', Trainer: 'Dresseur', Energy: 'Énergie' };
export const isPocket = id => /^(A\d|B\d|P-A)/.test(String(id || ''));
export const setIdOf = id => { const s = String(id); const i = s.lastIndexOf('-'); return i > 0 ? s.slice(0, i) : s; };

// ---------- file d'attente ----------
let nextAt = 0;
const abortErr = signal => signal?.reason ?? new DOMException('Aborted', 'AbortError');
function sleep(ms, signal) {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(abortErr(signal));
    const t = setTimeout(() => { signal?.removeEventListener('abort', stop); res(); }, ms);
    const stop = () => { clearTimeout(t); rej(abortErr(signal)); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}
async function slot(signal) {
  const now = Date.now(), at = Math.max(now, nextAt);
  nextAt = at + 250;                       // 4 départs par seconde au plus
  if (at > now) await sleep(at - now, signal);
}

async function call(url, { signal, timeout = 12000, init } = {}) {
  for (let attempt = 0; ; attempt++) {
    await slot(signal);
    try {
      return await getJSON(url, { signal, timeout, init });
    } catch (e) {
      const busy = e instanceof NetError && (e.status === 429 || e.status === 503);
      if (!busy || attempt >= 2) throw e;
      await sleep(attempt ? 8000 : 2500, signal);   // le serveur sature : on patiente
    }
  }
}

// Une promesse partagée par plusieurs appelants : l'annulation de l'un n'annule pas la requête des autres.
function withSignal(p, signal) {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortErr(signal));
  return new Promise((res, rej) => {
    const stop = () => rej(abortErr(signal));
    signal.addEventListener('abort', stop, { once: true });
    p.then(v => { signal.removeEventListener('abort', stop); res(v); },
      e => { signal.removeEventListener('abort', stop); rej(e); });
  });
}

const memo = new Map();
function shared(key, load) {
  if (!memo.has(key)) {
    const p = load();
    memo.set(key, p);
    p.catch(() => memo.delete(key));
    if (memo.size > 300) memo.delete(memo.keys().next().value); // mémoire bornée
  }
  return memo.get(key);
}

// ---------- fiche complète ----------
// Les identifiants peuvent contenir « % » (exu-%3F) : encodeURIComponent est indispensable (exu-%253F côté serveur).
export function card(id, { signal } = {}) {
  return withSignal(shared(`card:${id}`, () => call(`${API}/cards/${encodeURIComponent(id)}`)), signal);
}

// ---------- GraphQL (POST, données françaises avec @locale) ----------
export async function gql(query, { signal, timeout = 25000 } = {}) {
  const d = await call(GRAPHQL, {
    signal, timeout,
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) },
  });
  if (d?.errors?.length) {
    const e = new NetError('server', 200, GRAPHQL);
    e.detail = d.errors.map(x => x.message).join(' ; ');
    throw e;
  }
  return d?.data ?? null;
}

const FIELDS = 'id localId name image rarity category dexId variants { normal reverse holo firstEdition } variants_detailed { type foil }';
const gqlCards = (setId, locale) =>
  `{ cards(filters:{id:${JSON.stringify(setId + '-')}})${locale ? ' @locale(lang:"fr")' : ''} { ${FIELDS} } }`;

// carte TCGdex (fiche, brève REST ou GraphQL) → forme commune des vues
export function toBrief(c, setId = setIdOf(c.id)) {
  return {
    id: c.id,
    localId: String(c.localId ?? c.id.slice(setId.length + 1)),
    name: c.name || '',
    setId,
    image: c.image || '',
    rarity: c.rarity || '',
    category: CAT[c.category] || c.category || '',
    dexId: Array.isArray(c.dexId) ? c.dexId.filter(n => Number.isInteger(n)) : [],
    finishes: c.variants || c.variants_detailed ? finishesOf(c) : [],
  };
}

// métadonnées d'une série au format de data/sets.json (série absente des fichiers statiques)
export function toMeta(s) {
  const ext = u => (u ? (/\.(webp|png|jpg|svg)$/i.test(u) ? u : `${u}.webp`) : '');
  return {
    id: s.id,
    name: s.name || s.id,
    bloc: s.serie?.id || '',
    serie: s.serie?.id || '',
    blocName: s.serie?.name || '',
    date: s.releaseDate || '',
    total: s.cardCount?.official ?? s.cardCount?.total ?? 0,
    count: s.cardCount?.total ?? s.cards?.length ?? 0,
    code: s.abbreviation?.official || '',
    logo: ext(s.logo),
    logoLang: 'fr',
    sym: ext(s.symbol),
    legal: { standard: !!s.legal?.standard, expanded: !!s.legal?.expanded },
    tag: null,
    dark: false,
    live: true,
  };
}

// ---------- recherche par nom (secours quand l'index local manque) ----------
export async function searchLive(name, { signal, limit = 120 } = {}) {
  const q = String(name || '').trim();
  if (q.length < 2) return [];
  const list = await withSignal(shared(`search:${q.toLowerCase()}`,
    () => call(`${API}/cards?name=${encodeURIComponent(q)}&pagination:itemsPerPage=${limit}`)), signal);
  return (Array.isArray(list) ? list : []).filter(c => c?.id && !isPocket(setIdOf(c.id)))
    .map(c => ({ ...toBrief(c), partial: true }));
}

// ---------- série entière en direct : REST (métadonnées + liste) + GraphQL (raretés, catégories, finitions) ----------
export function setLive(id, { signal } = {}) {
  return withSignal(shared(`set:${id}`, () => loadSetLive(id)), signal);
}

async function loadSetLive(id) {
  const [rest, g] = await Promise.all([
    call(`${API}/sets/${encodeURIComponent(id)}`),
    gql(gqlCards(id, true)).catch(() => null),
  ]);
  const meta = toMeta(rest);
  const restCards = Array.isArray(rest.cards) ? rest.cards : [];
  let rich = (g?.cards || []).filter(c => setIdOf(c.id) === id);
  // @locale n'est pas documenté : on vérifie que les noms sont bien ceux de l'API française
  const byId = new Map(restCards.map(c => [c.id, c]));
  const common = rich.filter(c => byId.has(c.id));
  const same = common.filter(c => c.name === byId.get(c.id).name).length;
  let french = common.length > 0 && same >= common.length * 0.8;
  if (!french) {
    // directive ignorée : finitions depuis les données anglaises (mêmes identifiants), noms depuis REST
    const en = await gql(gqlCards(id, false)).catch(() => null);
    rich = (en?.cards || []).filter(c => setIdOf(c.id) === id)
      .map(c => ({ ...c, name: byId.get(c.id)?.name || c.name, rarity: '', category: EN_CAT[c.category] || '' }));
  }
  const richById = new Map(rich.map(c => [c.id, c]));
  const cards = restCards.map(c => {
    const r = richById.get(c.id);
    const b = toBrief(r ? { ...r, image: c.image || r.image, name: c.name || r.name, localId: c.localId } : c, id);
    if (!b.finishes.length) b.finishes = ['normal'];
    return b;
  });
  return { meta, cards, french, finishesKnown: rich.length > 0 };
}

// liste des séries (REST, légère) et détail d'une série
export const setList = ({ signal } = {}) => withSignal(shared('sets', () => call(`${API}/sets`)), signal);
export const setInfo = (id, { signal } = {}) =>
  withSignal(shared(`setinfo:${id}`, () => call(`${API}/sets/${encodeURIComponent(id)}`)), signal);
