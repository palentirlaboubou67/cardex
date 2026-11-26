// (Ébauche F1, remplacée par la vague 2.) Scanner : la vue de la caméra arrive avec le module js/scan/ (SC + W2).
import { setBar } from '../core/appbar.js';
import { html, setHTML } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { infoSheet } from '../core/sheet.js';

const TIPS = [
  'Pose la carte à plat, bien éclairée, sans reflet.',
  'Remplis le cadre : le numéro en bas de la carte doit être net.',
  'Si la carte n’est pas reconnue, cherche-la par son nom dans Séries.',
];

export default {
  mount(el) {
    setHTML(el, html`<div class="empty" data-content><span class="ic">${icon('camera')}</span><b>Scanner · écran en construction</b><p>Le scanner arrive à l’étape suivante. En attendant, cherche tes cartes dans Séries.</p><a class="btn" href="#/series">Ouvrir Séries</a></div>`);
  },
  async show() {
    setBar({ title: 'Scanner', actions: [{ icon: 'info', label: 'Conseils de scan', onClick: () => infoSheet('Conseils de scan', TIPS) }] });
  },
  hide() {},
};
