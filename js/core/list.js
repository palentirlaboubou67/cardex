// Rendu des longues listes (FINAL-perf §4.5) : le premier écran tout de suite, le reste par lots qui rendent la main.
import { nextPaint } from './idle.js';

const tokens = new WeakMap();

// el.innerHTML = premiers éléments, puis un lot par image (nextPaint : chaque lot a sa propre tâche et sa propre mise
// en page ; scheduler.yield reprenait avant le rendu et plusieurs lots finissaient mis en page d'un coup).
// Renvoie false si un rendu plus récent a pris la place. tpl(item, i) renvoie une chaîne ou un Safe (html``) ;
// empty : contenu quand la liste est vide.
export async function renderChunked(el, items, tpl, { first = 48, batch = 120, empty = '' } = {}) {
  const my = Symbol('render');
  tokens.set(el, my);
  const join = (from, to) => { let s = ''; for (let i = from; i < to; i++) s += tpl(items[i], i); return s; };
  el.innerHTML = items.length ? join(0, Math.min(first, items.length)) : String(empty ?? '');
  for (let i = first; i < items.length; i += batch) {
    await nextPaint();
    if (tokens.get(el) !== my) return false;
    el.insertAdjacentHTML('beforeend', join(i, Math.min(i + batch, items.length)));
  }
  return tokens.get(el) === my;
}

// catalogue paginé : onNear() quand la sentinelle (posée en fin de el) approche de l'écran. Renvoie disconnect().
export function sentinel(el, onNear, { margin = '800px' } = {}) {
  const s = el.appendChild(Object.assign(document.createElement('div'), { className: 'sentinel' }));
  s.setAttribute('aria-hidden', 'true');
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) onNear(); }, { rootMargin: margin });
  io.observe(s);
  return () => { io.disconnect(); s.remove(); };
}

// met à jour les éléments [data-card="<id>"] d'une carte au lieu de tout redessiner
export function patchByKey(root, id, fn) {
  for (const t of root.querySelectorAll(`[data-card="${CSS.escape(id)}"]`)) fn(t);
}
