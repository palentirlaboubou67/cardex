// (Ébauche F1, remplacée par la vague 2.) Page d'un Pokémon : toutes ses cartes (les possédées d'abord).
import { setBar } from '../core/appbar.js';
import { html, setHTML } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { plural } from '../core/format.js';
import { renderChunked, patchByKey } from '../core/list.js';
import { MESSAGES } from '../core/net.js';
import { tileHTML, patchTile } from '../components/tile.js';
import * as catalog from '../data/catalog.js';
import { pokedex, nameOf } from '../data/dex.js';
import * as col from '../state/collection.js';

let el = null;
const no4 = n => `#${String(n).padStart(4, '0')}`;

export default {
  mount(section) {
    el = section;
    el.innerHTML = '<p class="caption stub-count"></p><div class="grid" id="poke-grid"></div><p class="stub-note">Écran en construction</p>';
  },
  async show(r) {
    const { signal } = r;
    const n = Number(r.m[1]);
    setBar({ title: nameOf(n) || 'Pokémon', subtitle: no4(n), back: true, signal });
    const grid = el.querySelector('#poke-grid');
    grid.innerHTML = '';
    let cards;
    try {
      await pokedex().catch(() => null);
      if (signal.aborted) return;
      setBar({ title: nameOf(n) || `Pokémon ${no4(n)}`, subtitle: no4(n), back: true, signal });
      cards = await catalog.cardsOfDex(n);
    } catch (e) {
      if (signal.aborted) return;
      setHTML(grid, html`<div class="errrow" data-content>${icon('wifi-off')}<span class="grow">${MESSAGES[e?.kind] || 'Cartes indisponibles'}</span></div>`);
      return;
    }
    if (signal.aborted) return;
    const owned = cards.filter(c => col.qtyOf(c.id)).length;
    el.querySelector('.stub-count').textContent = `${plural(cards.length, 'carte', 'cartes')} · ${owned} possédée${owned > 1 ? 's' : ''}`;
    cards.sort((a, b) => (col.qtyOf(b.id) ? 1 : 0) - (col.qtyOf(a.id) ? 1 : 0));
    await renderChunked(grid, cards, c => { const q = col.qtyOf(c.id); return tileHTML(c, { qty: q, missing: !q }); }, {
      empty: html`<div class="empty" data-content><span class="ic">${icon('card')}</span><b>Aucune carte</b><p>Ce Pokémon n’a pas encore de carte en français.</p></div>`,
    });
  },
  hide() {},
  onChange(events) {
    for (const e of events) if (e.type === 'qty') patchByKey(el, e.id, t => { const q = col.qtyOf(e.id); patchTile(t, { qty: q, missing: !q }); });
  },
};
