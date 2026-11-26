// (Ébauche F1, remplacée par la vague 2.) Decks : Méta actuelle · Saisons passées.
import { setBar, primaryTabs } from '../core/appbar.js';
import { html, setHTML } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { infoSheet } from '../core/sheet.js';

const SECTIONS = [
  { href: '#/decks/actuelle', label: 'Méta actuelle' },
  { href: '#/decks/passees', label: 'Saisons passées' },
];

export default {
  mount(el) { el.innerHTML = '<div class="ptabs-slot"></div><div class="stub-body"></div>'; },
  async show(r, el) {
    setBar({
      title: 'Decks',
      actions: [{ icon: 'info', label: 'À propos de cet écran', onClick: () => infoSheet('Decks', 'Jouables : tu as déjà les 60 cartes. Presque : au moins 70 %. Listes : Limitless.') }],
    });
    setHTML(el.querySelector('.ptabs-slot'), primaryTabs(SECTIONS, `#/decks/${r.m[1]}`));
    setHTML(el.querySelector('.stub-body'), html`<div class="empty" data-content><span class="ic">${icon('decks')}</span><b>Decks · écran en construction</b><p>Cette partie arrive à l’étape suivante.</p></div>`);
  },
  hide() {},
};
