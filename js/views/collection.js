// (Ébauche F1, remplacée par la vague 2.) Collection : Cartes · Pokédex · Doubles · Succès.
// Montre le modèle à suivre : onglets principaux (liens data-replace), en-tête de synthèse, une rangée de puces
// (tri = <select> en puce), grille rendue par lots, filtres dans l'URL (setParams), mise à jour des tuiles en place.
import { setBar, primaryTabs } from '../core/appbar.js';
import { html, setHTML, selectChip, delegate } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { eur, plural, norm } from '../core/format.js';
import { renderChunked, patchByKey } from '../core/list.js';
import { infoSheet } from '../core/sheet.js';
import { setParams } from '../core/router.js';
import { tileHTML, patchTile } from '../components/tile.js';
import { sparkline } from '../components/chart.js';
import * as col from '../state/collection.js';
import { FINISHES, SHORT, DOT } from '../data/finishes.js';
import { points } from '../features/valuehistory.js';

const SECTIONS = [
  { href: '#/collection/cartes', label: 'Cartes' },
  { href: '#/collection/pokedex', label: 'Pokédex' },
  { href: '#/collection/doubles', label: 'Doubles' },
  { href: '#/collection/succes', label: 'Succès' },
];
const SORTS = [['recentes', 'Récentes'], ['nom', 'Nom'], ['serie', 'Série']];
let el = null, sec = 'cartes', q = new URLSearchParams(), dirty = false;
const query = () => new URLSearchParams(location.hash.split('?')[1] || '');

// une tuile par carte et par finition possédée (comme l'ancienne grille)
function entries(q) {
  const tri = q.get('tri') || 'recentes', fin = q.get('finition') || '';
  const out = [];
  for (const r of col.all()) for (const f of FINISHES) if (r.qty[f] && (!fin || f === fin)) out.push({ r, f, n: r.qty[f] });
  const by = {
    recentes: (a, b) => b.r.addedAt - a.r.addedAt,
    nom: (a, b) => norm(a.r.name).localeCompare(norm(b.r.name)),
    serie: (a, b) => (a.r.setName || '').localeCompare(b.r.setName || '') || a.r.localId.localeCompare(b.r.localId, 'fr', { numeric: true }),
  }[tri];
  return by ? out.sort(by) : out;
}

function cartes() {
  dirty = false;
  const st = col.stats();
  const fin = q.get('finition') || '';
  const counts = new Map();
  for (const rec of col.all()) for (const [f, n] of Object.entries(rec.qty)) counts.set(f, (counts.get(f) || 0) + n);
  const hist = points().map(p => p.v);
  setHTML(el.querySelector('.stub-body'), html`
    <div class="summary">
      <div class="hero">${st.priced ? eur(st.value) : plural(st.total, 'carte', 'cartes')}</div>${sparkline(hist)}
      <div class="meta">${hist.length < 2 ? 'La courbe démarre demain' : ''}</div>
      <div class="meta full">${st.priced ? `${plural(st.total, 'carte', 'cartes')} · ` : ''}${plural(st.unique, 'différente', 'différentes')} · ${plural(st.sets, 'série', 'séries')}</div>
    </div>
    <div class="chips" role="group" aria-label="Tri et filtres">
      ${selectChip({ label: 'Trier', options: SORTS, value: q.get('tri') || 'recentes', name: 'tri' })}
      <button type="button" class="chip" data-fin="" aria-pressed="${fin ? 'false' : 'true'}">Toutes <span class="n">${st.total}</span></button>
      ${FINISHES.filter(f => counts.get(f)).map(f => html`<button type="button" class="chip" data-fin="${f}" aria-pressed="${f === fin ? 'true' : 'false'}"><i class="${DOT[f]}"></i>${SHORT[f]} <span class="n">${counts.get(f)}</span></button>`)}
    </div>
    <div class="grid" id="col-grid"></div>`);
  return renderChunked(el.querySelector('#col-grid'), entries(q), e => tileHTML(e.r, { qty: e.n, finish: e.f, price: col.value(e.r) }), {
    empty: html`<div class="empty" data-content><span class="ic">${icon('collection')}</span><b>Ta collection est vide</b><p>Scanne une carte ou ouvre une série pour l’ajouter.</p><a class="btn primary" href="#/scanner">Scanner une carte</a></div>`,
  });
}

function placeholder(title) {
  setHTML(el.querySelector('.stub-body'), html`<div class="empty" data-content><span class="ic">${icon('sparkle')}</span><b>${title} · écran en construction</b><p>Cette partie arrive à l’étape suivante.</p></div>`);
}

export default {
  mount(section) {
    el = section;
    el.innerHTML = '<div class="ptabs-slot"></div><div class="stub-body"></div>';
    // filtres et tri : dans l'URL sans nouvelle entrée, puis la grille est refaite
    delegate(el, 'change', 'select[name="tri"]', (e, s) => { setParams({ tri: s.value === 'recentes' ? null : s.value }); q = query(); cartes(); });
    delegate(el, 'click', '[data-fin]', (e, b) => { setParams({ finition: b.dataset.fin || null }); q = query(); cartes(); });
  },
  async show(r) {
    sec = r.m[1];
    q = r.q;
    setBar({
      title: 'Collection',
      actions: [{ icon: 'filter', label: 'Filtrer mes cartes', onClick: () => infoSheet('Filtrer', 'Le filtre par nom ou série arrive avec la version complète de cet écran.') }],
      menu: [{ icon: 'info', label: 'À propos de cet écran', onClick: () => infoSheet('Collection', 'La valeur estimée additionne la cote Cardmarket (tendance) de chaque version que tu possèdes.') }],
    });
    setHTML(el.querySelector('.ptabs-slot'), primaryTabs(SECTIONS, `#/collection/${sec}`));
    if (sec === 'cartes') await cartes();
    else placeholder(SECTIONS.find(s => s.href.endsWith(sec))?.label || 'Collection');
  },
  hide() {},
  // revenue depuis le cache (même adresse) : refaite seulement si la collection a changé entre-temps
  resume() { if (dirty && sec === 'cartes') cartes(); },
  // quantité changée : la tuile est corrigée en place ; carte ajoutée ou retirée : la grille est refaite
  onChange(events) {
    if (sec !== 'cartes' || !el) return;
    if (events.some(e => e.type !== 'qty' || e.added || e.removed || e.after === 0 || e.before === 0)) {
      if (el.hidden) dirty = true; else cartes();
      return;
    }
    for (const e of events) patchByKey(el, e.id, t => { if (t.dataset.finish === e.finish) patchTile(t, { qty: e.after }); });
  },
};
