// Pièces de la Collection chargées à la demande (hors du premier écran) : variation et courbe de l'en-tête,
// feuille « Évolution de la valeur », textes ⓘ.
import { html } from '../../core/dom.js';
import { eur, num, dateDay, dateFr } from '../../core/format.js';
import { openSheet } from '../../core/sheet.js';
import { lineChart, deltaHTML, sparkline } from '../../components/chart.js';
import * as col from '../../state/collection.js';
import * as prices from '../../data/prices.js';
import * as vh from '../../features/valuehistory.js';

// ---------- variation de la valeur (en-tête de synthèse, feuille) ----------
// « +2,9 % sur 30 jours » ; « depuis le 12 nov. » quand l'historique est plus court ; « La courbe démarre demain »
export function deltaLine(value) {
  const pts = vh.points();
  if (pts.length < 2) return html`La courbe démarre demain`;
  const ch = vh.change(value, 30);
  if (!ch) return '';
  return html`${deltaHTML(ch.pct)} <span>${ch.full ? 'sur 30 jours' : `depuis le ${dateDay(ch.from)}`}</span>`;
}

// courbe de l'en-tête : 30 derniers points + la valeur du moment
export function sparkHTML(value) {
  const v = vh.points().slice(-30).map(p => p.v);
  if (v.length && Number.isFinite(value) && value !== v[v.length - 1]) v.push(value);
  return sparkline(v);
}

// ---------- feuille « Évolution de la valeur » (W-I : appui sur l'en-tête) ----------
let chart = null;
export function openValueSheet() {
  const st = col.stats();
  const pts = vh.points();
  const live = !st.pending && pts.length && pts[pts.length - 1].v !== st.value;
  const series = live ? [...pts.filter(p => p.d !== vh.today()), { d: vh.today(), v: st.value }] : pts;
  const body = document.createElement('div');
  body.className = 'col-value';
  body.innerHTML = String(html`
    <div class="col-value-head"><b class="num">${st.pending && !st.priced ? '—' : eur(st.value)}</b><span>${deltaLine(st.value)}</span></div>
    ${series.length >= 2 ? html`<div class="col-chart"></div>` : html`<p class="col-value-empty">Cardex note la valeur de ta collection chaque jour où tu ouvres l’appli : la courbe démarre demain.</p>`}
    <div class="group">
      <div class="row dl"><span class="k">Cartes cotées</span><span class="v num">${num(st.priced)}</span></div>
      <div class="row dl"><span class="k">Sans cote</span><span class="v num">${num(st.unpriced)}${st.unpriced ? html` <span class="muted">(comptées 0 €)</span>` : ''}</span></div>
      ${st.pending ? html`<div class="row dl"><span class="k">En attente</span><span class="v num">${num(st.pending)} <span class="muted">(cotes pas encore chargées)</span></span></div>` : ''}
      ${pts.length ? html`<div class="row dl"><span class="k">Depuis</span><span class="v">${dateFr(pts[0].d)}</span></div>` : ''}
    </div>
    <div class="prose"><p>La valeur estimée additionne la cote Cardmarket (tendance) de chaque version que tu possèdes. Une carte sans cote compte pour 0 €.</p><p>${prices.creditText()}</p></div>`);
  chart?.destroy();
  chart = null;
  const s = openSheet({ title: 'Évolution de la valeur', body, wide: true, onClose: () => { chart?.destroy(); chart = null; } });
  // la courbe à l'image suivante : la feuille s'affiche d'abord (pas de longue tâche à l'appui)
  const box = body.querySelector('.col-chart');
  if (box) requestAnimationFrame(() => setTimeout(() => { if (box.isConnected) chart = lineChart(box, series, { ranges: ['30j', '90j', 'tout'], range: '90j', label: 'Valeur de la collection' }); }, 0));
  return s;
}

// ---------- textes ⓘ (FINAL-design §9) ----------
export const onHistory = fn => vh.on(fn);

export const INFO = {
  cartes: ['Collection', [
    'La valeur estimée additionne la cote Cardmarket (tendance) de chaque version que tu possèdes.',
    'Une tuile par carte et par finition : une reverse et une normale de la même carte sont deux versions. Appuie sur la valeur pour voir son évolution.',
  ]],
  pokedex: ['Pokédex', [
    'Un Pokémon est possédé dès que tu as une de ses cartes. Le chiffre sur un Pokémon est le nombre de ses cartes différentes dans ta collection.',
    'Les cartes des séries sans numéro de Pokédex (Méga-Évolution…) sont reconnues d’après leur nom.',
  ]],
  doubles: ['Doubles', [
    'Le badge indique les exemplaires en trop : tu en gardes toujours un.',
    'La liste copiée contient tes doubles et tes envies : colle-la dans ta discussion pour proposer un échange.',
  ]],
  succes: ['Succès', [
    'Les succès se débloquent tout seuls quand ta collection change. Un succès débloqué le reste.',
    'Tout effacer la collection les remet à zéro.',
  ]],
};
