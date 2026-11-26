// (Ébauche F1, remplacée par la vague 2.) Page d'un deck.
import { setBar } from '../core/appbar.js';
import { html, setHTML } from '../core/dom.js';
import { icon } from '../core/icons.js';

export default {
  mount() {},
  async show(r, el) {
    let id = r.m[1];
    try { id = decodeURIComponent(id); } catch { /* tel quel */ }
    setBar({ title: id, subtitle: 'Méta actuelle', back: true });
    setHTML(el, html`<div class="empty" data-content><span class="ic">${icon('decks')}</span><b>Deck · écran en construction</b><p>La liste du deck arrive à l’étape suivante.</p></div>`);
  },
  hide() {},
};
