// (Ébauche F1, remplacée par la vague 2.) Fiche d'un produit scellé (identifiant Cardmarket).
import { setBar } from '../core/appbar.js';
import { html, setHTML } from '../core/dom.js';
import { icon } from '../core/icons.js';

export default {
  mount() {},
  async show(r, el) {
    const id = r.m[1];
    setBar({ title: 'Produit', subtitle: `Cardmarket n° ${id}`, back: true, actions: [{ icon: 'star', label: 'Suivre ce produit', pressed: false, onClick: () => {} }] });
    setHTML(el, html`<div class="empty" data-content><span class="ic">${icon('box')}</span><b>Produit · écran en construction</b><p>La fiche du produit (cote, courbe, Mon scellé) arrive à l’étape suivante.</p></div>`);
  },
  hide() {},
};
