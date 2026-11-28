// Outils de grille de la Collection et de la page Pokémon (premier écran) : rendu par lots, tuile d'une version,
// insertion à sa place. renderGrid sert aussi aux longues listes de Séries, Série et Decks (un lot par image).
import * as prices from '../../data/prices.js';

const runs = new WeakMap();

// attend que l'image suivante soit rendue : chaque lot a sa propre mise en page. (scheduler.yield reprend avant le
// rendu : plusieurs lots finissaient mis en page d'un coup, longue tâche de 70 à 100 ms à CPU ×4 avec 2 000 cartes.)
// Onglet caché : pas d'image, une simple tâche suffit.
const nextPaint = () => new Promise(res => {
  if (document.hidden) { setTimeout(res, 0); return; }
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
  requestAnimationFrame(go);
  setTimeout(go, 100);
});

// el.innerHTML = premier écran, puis un lot par image (remplace renderChunked de core/list.js pour ces grilles).
// tpl(item, i) -> chaîne ou Safe. Renvoie false si un rendu plus récent (ou fill) a pris la place.
export async function renderGrid(el, items, tpl, { first = CHUNK.first, batch = CHUNK.batch, empty = '' } = {}) {
  const my = Symbol('grid');
  runs.set(el, my);
  const join = (from, to) => { let s = ''; for (let i = from; i < to; i++) s += tpl(items[i], i); return s; };
  el.innerHTML = items.length ? join(0, Math.min(first, items.length)) : String(empty ?? '');
  for (let i = first; i < items.length; i += batch) {
    await nextPaint();
    if (runs.get(el) !== my) return false;
    el.insertAdjacentHTML('beforeend', join(i, Math.min(i + batch, items.length)));
  }
  return runs.get(el) === my;
}

// contenu fixe (vide, squelette, erreur) : arrête aussi un rendu par lots encore en cours
export const fill = (el, content) => renderGrid(el, [], null, { empty: content });

// premier lot : 18 tuiles (un écran de téléphone et plus ; ce qui manque à l'écran arrive à l'image suivante), puis
// 60 par image : la première image (police, en-tête, 2e passe de content-visibility) reste sous 50 ms à CPU ×4
export const CHUNK = { first: 18, batch: 60 };
export const tileSel = (id, f) => `.tile[data-card="${CSS.escape(id)}"][data-finish="${CSS.escape(f)}"]`;

// insère `htmlStr` dans `grid` avant la tuile de la première clé suivante présente (ordre de `keys`), sinon à la fin
export function insertAt(grid, keys, i, htmlStr, sel) {
  for (let j = i + 1; j < keys.length; j++) {
    const next = grid.querySelector(sel(keys[j]));
    if (next) { next.insertAdjacentHTML('beforebegin', htmlStr); return next.previousElementSibling; }
  }
  grid.insertAdjacentHTML('beforeend', htmlStr);
  return grid.lastElementChild;
}

// prix d'une tuile : cote, « — » si la série est cotée sans cette finition, rien tant que le fichier n'est pas là
export const tilePrice = (id, setId, f) => (prices.has(setId) ? (prices.eur(id, f) ?? '—') : null);
