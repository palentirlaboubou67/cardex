// (Ébauche F1, remplacée par la vague 2.) Marché : Cotes · Scellé · Mon scellé · Envies (point quand une envie est
// dans sa fourchette : main.js publie l'état de la pastille par l'événement « cardex:badge »).
import { setBar, primaryTabs } from '../core/appbar.js';
import { html, setHTML } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { infoSheet } from '../core/sheet.js';

const LABELS = { cotes: 'Cotes', scelle: 'Scellé', 'mon-scelle': 'Mon scellé', envies: 'Envies' };
let el = null, sec = 'cotes';

// état de la pastille du Marché (barre d'onglets)
const alert = () => !document.querySelector('.tabbar [data-tab="market"] .bdg')?.hidden;

function tabs() {
  const items = Object.entries(LABELS).map(([k, label]) => ({
    href: `#/marche/${k}`, label, dot: k === 'envies' && alert(), dotLabel: 'une envie est dans ta fourchette',
  }));
  setHTML(el.querySelector('.ptabs-slot'), primaryTabs(items, `#/marche/${sec}`));
}

export default {
  mount(section) {
    el = section;
    el.innerHTML = '<div class="ptabs-slot"></div><div class="stub-body"></div>';
    document.addEventListener('cardex:badge', () => tabs());
  },
  async show(r) {
    sec = r.m[1];
    setBar({
      title: 'Marché', signal: r.signal,
      actions: [{ icon: 'info', label: 'À propos de cet écran', onClick: () => infoSheet('Marché', 'Cotes Cardmarket (tendance, toutes langues), mises à jour chaque nuit. Cardex n’est pas affilié à Cardmarket.') }],
    });
    tabs();
    setHTML(el.querySelector('.stub-body'), html`<div class="empty" data-content><span class="ic">${icon('market')}</span><b>${LABELS[sec]} · écran en construction</b><p>Cette partie arrive à l’étape suivante.</p></div>`);
  },
  hide() {},
};
