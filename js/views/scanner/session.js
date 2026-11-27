// Séance de scan : les cartes ajoutées depuis le scanner (onglet du navigateur, gardée au rechargement), avec annulation.
// Une entrée par carte et par version ; les ajouts successifs de la même version s'additionnent (n).
const KEY = 'cardex.scanSession.v1';
const MAX = 200;
let items = load();
const subs = new Set();

function load() {
  try {
    const d = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (Array.isArray(d?.items)) return d.items.filter(x => x && typeof x.id === 'string' && typeof x.finish === 'string' && x.n > 0).slice(0, MAX);
  } catch { /* stockage bloqué ou illisible : séance vide */ }
  return [];
}

function save() {
  try { sessionStorage.setItem(KEY, JSON.stringify({ items })); } catch { /* séance gardée en mémoire seulement */ }
  subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}

// informations gardées pour afficher la ligne sans recharger la série
const slim = c => ({ id: c.id, name: c.name || '', localId: c.localId || '', setId: c.setId || '', setName: c.setName || '', setTotal: c.setTotal || 0, image: c.image || '', rarity: c.rarity || '', category: c.category || '', dexId: c.dexId || [], finishes: c.finishes || [] });

export const list = () => items;
export const count = () => items.reduce((a, x) => a + x.n, 0);
export const on = fn => (subs.add(fn), () => subs.delete(fn));

// +1 (ou n) pour cette carte dans cette version : l'entrée remonte en tête
export function added(card, finish, n = 1) {
  const i = items.findIndex(x => x.id === card.id && x.finish === finish);
  const prev = i >= 0 ? items.splice(i, 1)[0] : null;
  items.unshift({ ...slim(card), finish, n: (prev?.n || 0) + n, at: Date.now() });
  if (items.length > MAX) items.length = MAX;
  save();
}

// un ajout retiré (Annuler du toast) : l'entrée perd n, disparaît à 0
export function removed(id, finish, n = 1) {
  const i = items.findIndex(x => x.id === id && x.finish === finish);
  if (i < 0) return;
  items[i].n -= n;
  if (items[i].n <= 0) items.splice(i, 1);
  save();
}

export const find = (id, finish) => items.find(x => x.id === id && x.finish === finish) || null;

// la liste repart de zéro (les cartes restent dans la collection)
export function clear() { items = []; save(); }
