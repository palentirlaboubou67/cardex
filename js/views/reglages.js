// (Ébauche F1, remplacée par la vague 2.) Réglages : le thème fonctionne déjà ; sauvegarde et sources viennent ensuite.
import { setBar } from '../core/appbar.js';
import { html, setHTML, delegate } from '../core/dom.js';
import * as prefs from '../state/prefs.js';

const THEMES = [['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']];
let el = null;

function render() {
  const t = prefs.get('theme', 'auto');
  setHTML(el, html`
    <div class="sect">Affichage</div>
    <div class="group"><div class="row"><span class="body"><span class="t">Thème</span></span><span class="seg" role="group" aria-label="Thème">${
      THEMES.map(([v, l]) => html`<button type="button" data-theme-set="${v}" aria-pressed="${v === t ? 'true' : 'false'}">${l}</button>`)}</span></div></div>
    <div class="sect">Sauvegarde</div>
    <div class="group"><div class="row" data-content><span class="body"><span class="t">Exporter, importer, tout effacer</span><span class="s"><span>Écran en construction</span></span></span></div></div>
    <div class="sect">Sources</div>
    <p class="caption">Données des cartes : TCGdex · Noms des Pokémon : PokéAPI · Cotes Cardmarket (tendance, toutes langues), mises à jour chaque nuit. Cardex n’est pas affilié à Cardmarket. Icônes : Lucide (licence ISC). Police : Instrument Sans (licence OFL).</p>`);
}

export default {
  mount(section) {
    el = section;
    delegate(el, 'click', '[data-theme-set]', (e, b) => { prefs.set('theme', b.dataset.themeSet); render(); });
  },
  async show() {
    setBar({ title: 'Réglages', back: true });
    render();
  },
  hide() {},
};
