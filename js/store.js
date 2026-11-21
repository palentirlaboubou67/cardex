// Sauvegarde de la collection dans le navigateur (localStorage) + export/import en fichier.
import { img, setIdOf, priceOf } from './api.js';

const KEY = 'cardex.collection.v1';
export const VARIANTS = { normal: 'Normale', reverse: 'Reverse', holo: 'Holo', firstEdition: '1re édition' };

let data = load();
const listeners = new Set();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.cards) return d;
  } catch {}
  return { version: 1, cards: {} };
}

function save() {
  data.savedAt = Date.now();
  localStorage.setItem(KEY, JSON.stringify(data));
  listeners.forEach(f => f());
}

export const onChange = f => listeners.add(f);
export const all = () => Object.values(data.cards);
export const get = id => data.cards[id];
export const total = rec => (rec ? Object.values(rec.qty).reduce((a, b) => a + b, 0) : 0);
export const count = id => total(data.cards[id]);

// Construit l'enregistrement à partir de la fiche complète de l'API.
function recordFrom(full) {
  const prices = {};
  for (const v of Object.keys(VARIANTS)) prices[v] = priceOf(full, v);
  return {
    id: full.id,
    name: full.name,
    localId: full.localId,
    setId: full.set?.id || setIdOf(full.id),
    setName: full.set?.name || '',
    setTotal: full.set?.cardCount?.official || null,
    image: full.image || '',
    rarity: full.rarity || '',
    prices,
    qty: {},
    addedAt: Date.now(),
  };
}

export function setQty(full, variant, n) {
  const id = full.id;
  let rec = data.cards[id];
  if (!rec) rec = data.cards[id] = recordFrom(full);
  else rec.prices = recordFrom(full).prices; // rafraîchit les prix au passage
  if (n > 0) rec.qty[variant] = n;
  else delete rec.qty[variant];
  if (total(rec) === 0) delete data.cards[id];
  save();
}

export function add(full, variant, n = 1) {
  setQty(full, variant, (data.cards[full.id]?.qty[variant] || 0) + n);
}

export function value(rec) {
  let v = 0;
  for (const [k, n] of Object.entries(rec.qty)) v += (rec.prices?.[k] ?? rec.prices?.normal ?? 0) * n;
  return v;
}

export function stats() {
  const cards = all();
  return {
    total: cards.reduce((a, c) => a + total(c), 0),
    unique: cards.length,
    sets: new Set(cards.map(c => c.setId)).size,
    value: cards.reduce((a, c) => a + value(c), 0),
  };
}

export function ownedBySet() {
  const m = new Map();
  for (const c of all()) m.set(c.setId, (m.get(c.setId) || 0) + 1);
  return m;
}

export const thumb = rec => img(rec.image, 'low');

// ---------- Sauvegarde fichier ----------
export function exportFile() {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cardex-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Fusionne : pour chaque carte et variante, on garde la plus grande quantité.
export function importText(text) {
  const d = JSON.parse(text);
  if (!d || typeof d.cards !== 'object') throw new Error('Fichier invalide');
  let n = 0;
  for (const [id, rec] of Object.entries(d.cards)) {
    if (!rec?.id || !rec.qty) continue;
    const cur = data.cards[id];
    if (!cur) { data.cards[id] = rec; n++; continue; }
    for (const [v, q] of Object.entries(rec.qty)) cur.qty[v] = Math.max(cur.qty[v] || 0, q);
  }
  save();
  return n;
}

export function clearAll() {
  data = { version: 1, cards: {} };
  save();
}

export const lastSave = () => data.savedAt;
