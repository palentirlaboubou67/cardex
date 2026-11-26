// (Ébauche F1, remplacée par la vague 2.) Réglages : le thème fonctionne déjà ; sauvegarde et sources viennent ensuite.
import { setBar } from '../core/appbar.js';
import { html, setHTML, delegate } from '../core/dom.js';
import * as prefs from '../state/prefs.js';
import { creditText } from '../data/prices.js';

// mentions des sources (SPEC §8), une par ligne
const credits = () => [
  creditText(),
  'Données des cartes : TCGdex',
  'Noms des Pokémon : PokéAPI',
  'Photos des produits : TCGplayer (version anglaise)',
  'Certaines illustrations : version anglaise (TCGdex, Scrydex)',
  'Logo de Destinées Radieuses : Poképédia (licence CC BY-NC-SA 3.0)',
  'Lecture du numéro des cartes : Tesseract.js (licence Apache 2.0)',
  'Icônes : Lucide (licence ISC) · Police : Instrument Sans (licence OFL)',
];

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
    ${credits().map(t => html`<p class="caption">${t}</p>`)}`);
}

export default {
  mount(section) {
    el = section;
    delegate(el, 'click', '[data-theme-set]', (e, b) => { prefs.set('theme', b.dataset.themeSet); render(); });
  },
  async show(r) {
    setBar({ title: 'Réglages', back: true, signal: r.signal });
    render();
  },
  hide() {},
};
