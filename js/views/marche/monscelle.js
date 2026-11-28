// Marché › Mon scellé (W-S) : valeur actuelle, investi, plus-value et rendement des produits possédés (col.sealedSet,
// prix d'achat à l'unité). Le scellé et les produits suivis de l'ancienne version (identifiants TCGplayer) sont reliés
// à Cardmarket dès le chargement de ce module (main.js précharge le Marché au repos) et après chaque import.
import { html, setHTML, delegate } from '../../core/dom.js';
import { eur, eurDelta, pct, num, plural, dateFr } from '../../core/format.js';
import { icon } from '../../core/icons.js';
import { infoSheet } from '../../core/sheet.js';
import { MESSAGES } from '../../core/net.js';
import { whenIdle } from '../../core/idle.js';
import * as col from '../../state/collection.js';
import * as sealed from '../../data/sealed.js';
import { pimgHTML, ready as ptileReady, changeOf } from '../ptile.js';

let box = null, dirty = true, visible = false, linking = null, loading = null;

const sign = v => (v > 0.004 ? 'up' : v < -0.004 ? 'down' : 'flat');

function rowHTML({ o, p }) {
  const value = p.eur != null ? p.eur * o.qty : null;
  const gain = p.eur != null && o.cost != null ? (p.eur - o.cost) * o.qty : null;
  const bought = o.cost != null ? `${o.qty} × acheté ${eur(o.cost)}` : `${plural(o.qty, 'exemplaire', 'exemplaires')} · prix d’achat non renseigné`;
  const ch = changeOf(p);
  const y = gain != null && o.cost ? ((p.eur - o.cost) / o.cost) * 100 : null;
  const g = gain != null ? html`<span class="mk-gain ${sign(gain)}">${eurDelta(gain)}</span>` : '';
  const label = [p.fr, bought, value != null ? `valeur ${eur(value)}` : 'pas de vente récente', gain != null ? `plus-value ${eurDelta(gain)}` : '', y != null ? `rendement ${pct(y)}` : ''].filter(Boolean).join(', ');
  return html`<a class="row mk-prow mk-mrow" href="#/produit/${p.id}" data-product="${p.id}" aria-label="${label}"><span class="sq">${pimgHTML(p)}</span><span class="body"><span class="t">${p.fr}</span><span class="s"><span>${bought}</span></span>${
    ch.still ? html`<span class="s mk-note"><span>${ch.text}</span></span>` : ''}</span><span class="end">${
    value != null ? html`<span class="price">${eur(value)}</span>` : html`<span class="mk-nosale">Pas de vente récente</span>`}${g}</span></a>`;
}

function render() {
  dirty = false;
  const db = sealed.loaded();
  const mine = col.sealedAll();
  const left = col.legacySealed();
  const leftN = left.sealed.length;
  const legacyRow = leftN ? html`<div class="group mk-legacy"><button type="button" class="row" data-legacy><span class="lead">${icon('alert')}</span><span class="body"><span class="t">${plural(leftN, 'produit de l’ancienne version', 'produits de l’ancienne version')} à retrouver</span><span class="s"><span>Pas d’équivalent Cardmarket trouvé</span></span></span>${icon('chevron-right', { cls: 'chev' })}</button></div>` : '';
  if (!mine.length) {
    setHTML(box, html`<div class="empty" data-content><span class="ic">${icon('box')}</span><b>Aucun produit scellé</b><p>Ouvre un produit du catalogue et touche « Ajouter à mon scellé » avec ton prix d’achat.</p><a class="btn primary" href="#/marche/scelle?vue=catalogue" data-replace>Parcourir le catalogue</a></div>${legacyRow}`);
    return;
  }
  const rows = mine.map(o => ({ o, p: db?.byId.get(Number(o.id)) })).filter(r => r.p);
  const lost = mine.length - rows.length;       // produits retirés du catalogue Cardmarket
  let value = 0, invested = 0, gain = 0, base = 0, unpriced = 0, nocost = 0, n = 0;
  for (const { o, p } of rows) {
    n += o.qty;
    if (p.eur != null) value += p.eur * o.qty; else unpriced++;
    if (o.cost != null) invested += o.cost * o.qty; else nocost++;
    if (p.eur != null && o.cost != null) { gain += (p.eur - o.cost) * o.qty; base += o.cost * o.qty; }
  }
  rows.sort((a, b) => (b.p.eur ?? 0) * b.o.qty - (a.p.eur ?? 0) * a.o.qty);
  const y = base ? (gain / base) * 100 : null;
  const meta = [`Investi ${eur(invested)}`, plural(n, 'produit', 'produits'),
    unpriced ? `${num(unpriced)} sans cote` : '', nocost ? `${num(nocost)} sans prix d’achat` : '', lost ? `${num(lost)} introuvable${lost > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  setHTML(box, html`<div class="summary mk-sum mk-msum" data-content><span class="hero num">${eur(value)}</span><span class="mk-gain big ${sign(gain)}">${base ? html`${eurDelta(gain)}<span class="per"> (${pct(y)})</span>` : ''}</span><span class="meta full">${meta}</span></div>
<div class="group mk-list">${rows.map(rowHTML)}</div>${legacyRow ? html`<div class="mk-gap"></div>${legacyRow}` : ''}
<p class="caption mk-credit">${db?.priceDate ? `Cotes Cardmarket du ${dateFr(db.priceDate)}` : ''}</p>`);
}

// relie le scellé et les produits suivis de l'ancienne version (table sealed-img.json), sans bloquer l'affichage ;
// ce qui n'a pas d'équivalent reste « à retrouver » (ligne ci-dessus)
function linkLegacy() {
  const old = col.legacySealed();
  if (linking || (!old.sealed.length && !old.watch.length)) return;
  // émet 'reload' si des produits ont été retrouvés ; un nouvel essai reste possible (import, hors ligne)
  linking = col.linkLegacySealed().catch(() => null).finally(() => { linking = null; });
}
// une collection v1 qui suit des produits sans en posséder n'a aucune raison d'ouvrir Mon scellé : le lien se fait au
// repos dès que le Marché est chargé, puis après un import (événement 'reload')
if (typeof window !== 'undefined') {
  whenIdle(linkLegacy, { timeout: 4000 });
  col.on(evs => { if (evs.some(e => e.type === 'reload')) whenIdle(linkLegacy, { timeout: 4000 }); });
}

// catalogue chargé si besoin (squelette pendant le chargement), puis rendu ; un seul chargement à la fois
async function refresh() {
  if (sealed.loaded() || !col.sealedAll().length) { render(); return; }
  if (loading) return loading;
  setHTML(box, html`<div class="summary mk-sum" data-content aria-busy="true"><span class="hero"><span class="sk mk-sk-hero"></span></span><span class="meta"><span class="sk mk-sk-line"></span></span></div><div class="group">${Array.from({ length: 4 }, () => html`<span class="row sk-row"><span class="sk-a"></span><span class="body"><span class="sk-t"></span><span class="sk-s"></span></span></span>`)}</div>`);
  loading = (async () => {
    try { await Promise.all([sealed.load(), ptileReady()]); }
    catch (e) {
      dirty = true;                 // nouvel essai au prochain affichage
      if (!visible) return;
      setHTML(box, html`<div class="empty" data-content><span class="ic">${icon('wifi-off')}</span><b>Catalogue indisponible</b><p>${MESSAGES[e.kind] || 'Connexion impossible'}. La valeur de ton scellé s’affichera dès que la connexion reviendra.</p><button type="button" class="btn" data-again>Réessayer</button></div>`);
      return;
    }
    // section quittée pendant le chargement : rendu au retour
    if (visible) render(); else dirty = true;
  })().finally(() => { loading = null; });
  return loading;
}

const api = {
  mount(el) {
    box = el;
    delegate(box, 'click', '[data-legacy]', () => infoSheet('Ancienne version', [
      'Ces produits venaient de l’ancien catalogue de Cardex (TCGplayer). Cardex n’a pas trouvé leur équivalent sur Cardmarket.',
      'Ajoute-les à nouveau depuis le catalogue avec ton prix d’achat. Ils restent dans tes sauvegardes tant que tu ne les remplaces pas.',
    ]));
    delegate(box, 'click', '[data-again]', () => refresh());
  },
  async show() {
    visible = true;
    linkLegacy();
    await refresh();
  },
  resume() { visible = true; if (dirty) refresh(); },
  hide() { visible = false; },
  // produits reliés depuis l'ancienne version ('reload') pendant l'affichage : même chemin que show()
  onChange(events, isVisible) {
    if (!events.some(e => e.type === 'sealed' || e.type === 'reload')) return;
    if (isVisible) refresh(); else dirty = true;
  },
  info: () => ({
    title: 'Mon scellé',
    body: ['Ajoute un produit depuis sa fiche avec ton prix d’achat à l’unité : Cardex calcule ta plus-value avec la cote du jour.',
      'Rendement : la plus-value divisée par ce que tu as payé, pour les produits dont tu as donné le prix d’achat.',
      sealed.creditText()],
  }),
};
export default api;
