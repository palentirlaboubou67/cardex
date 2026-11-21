// Accès à l'API publique TCGdex (cartes en français, images et prix Cardmarket).
const BASE = 'https://api.tcgdex.net/v2/fr';
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

export const img = (base, q = 'low') => (base ? `${base}/${q}.webp` : '');
export const logo = base => (base ? `${base}.webp` : '');
export const setIdOf = cardId => cardId.slice(0, cardId.lastIndexOf('-'));

// La liste des séries change rarement : on la garde un jour en local.
const SETS_KEY = 'cardex.sets.cache';
export async function sets() {
  try {
    const c = JSON.parse(localStorage.getItem(SETS_KEY));
    if (c && Date.now() - c.t < 86400000) return c.d;
  } catch {}
  const d = await get('/sets');
  try { localStorage.setItem(SETS_KEY, JSON.stringify({ t: Date.now(), d })); } catch {}
  return d;
}

export async function setsById() {
  const list = await sets();
  return new Map(list.map((s, i) => [s.id, { ...s, order: i }]));
}

export const set = id => get(`/sets/${encodeURIComponent(id)}`);
export const card = id => get(`/cards/${encodeURIComponent(id)}`);
export const search = name =>
  get(`/cards?name=${encodeURIComponent(name)}&pagination:itemsPerPage=80`);

// Prix Cardmarket (tendance, en euros) selon la variante.
export function priceOf(full, variant = 'normal') {
  const cm = full?.pricing?.cardmarket;
  if (!cm) return null;
  const holo = variant === 'reverse' || variant === 'holo';
  const v = holo ? (cm['trend-holo'] || cm['avg-holo'] || cm.trend) : (cm.trend || cm.avg);
  return typeof v === 'number' && v > 0 ? v : null;
}
