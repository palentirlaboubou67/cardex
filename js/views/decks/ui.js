// Pièces communes de l'onglet Decks (liste et page d'un deck) : images des cartes, illustration d'un deck,
// libellés de prix, icônes d'état, feuille ⓘ.
import { html, raw, esc } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { eur, dateFr } from '../../core/format.js';
import { infoSheet } from '../../core/sheet.js';
import { imgHTML } from '../../data/images.js';
import * as decks from '../../data/decks.js';
import * as prices from '../../data/prices.js';

export const deckHref = id => `#/deck/${encodeURIComponent(id)}`;

// image d'une carte de deck : fiche du catalogue (FR, sinon anglais via cardimg.json) ; carte absente du catalogue
// français : son image anglaise TCGdex telle que decks.json la donne ; sinon la vignette sobre
export function cardImgHTML(c) {
  const en = decks.enImage(c);
  if (en) {
    return raw(`<img class="card-img" crossorigin="anonymous" loading="lazy" decoding="async" width="245" height="337" alt=""`
      + ` src="${esc(en)}/low.webp" data-fb="${esc(en)}/low.png" data-ph-no="${esc(c.ref)}" data-ph-sym="">`);
  }
  if (c.id) return imgHTML(decks.brief(c), { q: 'low' });
  return raw(`<span class="card-ph" role="img" aria-label="Pas d'illustration"><span class="card-ph-no">${esc(c.ref)}</span></span>`);
}

// deux cartes en éventail ; le Pokémon qui donne son nom au deck passe devant (dernier dans le DOM)
export function artHTML(deck, cls = '') {
  const cards = decks.art(deck).slice().reverse();
  return html`<span class="dk-art${cls ? ` ${cls}` : ''}" aria-hidden="true">${
    cards.length ? cards.map(c => html`<span class="dk-c">${cardImgHTML(c)}</span>`) : html`<span class="dk-c dk-none">${icon('decks')}</span>`
  }</span>`;
}

// « reste ≈ 30,56 € » ; cartes à acheter sans cote connue : leur nombre
export function restText(st) {
  if (st.ready) return 'Prêt à jouer';
  if (st.missing > 0) return `reste ≈ ${eur(st.missing)}`;
  return st.buy > 1 ? `${st.buy} cartes à acheter` : '1 carte à acheter';
}

// icône d'état d'une ligne : possédée (coche), en partie (demi-disque), à acheter (cercle)
export function stateIcon(state) {
  if (state === 'ok') return icon('check', { cls: 'dk-st-i' });
  const half = state === 'part' ? '<path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>' : '';
  return raw(`<svg class="i dk-st-i" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/>${half}</svg>`);
}

export const updatedLabel = () => {
  const d = decks.loaded()?.updatedAt;
  return d ? dateFr(d) : '';
};

// ⓘ À propos des decks (explications sorties de l'écran, FINAL-design §9) + mentions
export function infoDecks() {
  const up = updatedLabel();
  const legend = html`<div class="dk-legend"><span class="dkc-st ok">${stateIcon('ok')}Tu l’as</span><span class="dkc-st part">${stateIcon('part')}En partie</span><span class="dkc-st buy">${stateIcon('buy')}À acheter</span></div>`;
  return infoSheet('À propos des decks', [
    'Les meilleurs decks de tournoi, avec ce que tu as déjà dans ta collection et ce qu’il te reste à acheter. Pour chaque archétype : la liste la mieux classée sur Limitless TCG (méta du dernier mois, ou plus gros tournois de chaque saison).',
    html`<p><b>Jouables</b> : tu as déjà les 60 cartes. <b>Presque</b> : au moins 70 %.</p>`,
    'Ta collection est comparée par nom de carte, toutes séries et finitions confondues : n’importe quelle impression d’une carte suffit pour jouer. Les énergies de base sont comptées comme possédées.',
    legend,
    'Prix : pour chaque carte, la cote Cardmarket la moins chère entre normale, holo et reverse. « Reste » additionne les cartes qui te manquent.',
    '« Ajouter les manquantes aux envies » pose une alerte par carte, 10 % sous sa cote : une notification te prévient quand une offre passe à ce prix.',
    prices.creditText(),
    `Listes : Limitless TCG${up ? `, mises à jour le ${up}` : ''}. Cartes : TCGdex.`,
  ]);
}

// mention en bas des listes
export function footText() {
  const up = updatedLabel(), pd = prices.date();
  return [up ? `Listes Limitless TCG du ${up}` : 'Listes Limitless TCG', pd ? `cotes Cardmarket du ${dateFr(pd)}` : 'cotes Cardmarket'].join(' · ');
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
