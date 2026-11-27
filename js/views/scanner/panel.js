// Panneau du scanner (FINAL-design W-B) : gabarits du résultat, du choix « Laquelle est-ce ? », de la carte non
// reconnue, de l'analyse d'une photo et de la liste des cartes ajoutées pendant le scan. Aucun état ici.
import { html } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { eur, cardNo, num, plural } from '../../core/format.js';
import { cardHref } from '../../core/router.js';
import { imgHTML, enBadge } from '../../data/images.js';
import { LABEL, SHORT, DOT } from '../../data/finishes.js';

const chev = () => icon('chevron-right', { size: 16 });
export const searchHref = q => `#/series${q ? `?q=${encodeURIComponent(q)}` : ''}`;
const noOf = c => cardNo(c.localId, c.setTotal);
const where = c => [c.setName, noOf(c)].filter(Boolean).join(' · ');
const labelOf = c => [c.name, c.setName, noOf(c)].filter(Boolean).join(', ');

// image de carte (boîte 63:88 de base.css, bord dessiné dedans)
const art = (c, eager = false) => html`<span class="tile-img">${imgHTML(c, { q: 'low', eager })}${enBadge(c)}</span>`;

// « Dans ta collection : 3 (Normale 2, Reverse 1) »
export function ownedText(qty) {
  const per = Object.entries(qty || {}).filter(([, n]) => n > 0);
  const total = per.reduce((a, [, n]) => a + n, 0);
  if (!total) return '';
  const detail = per.length > 1 ? ` (${per.map(([f, n]) => `${SHORT[f] || f} ${num(n)}`).join(', ')})` : '';
  return `Dans ta collection : ${num(total)}${detail}`;
}

// cote de la finition utilisée par l'ajout rapide
export function priceHTML(p, finish) {
  const v = p?.eur ?? null;
  const note = p?.allEditions ? 'prix toutes éditions' : SHORT[finish] || finish;
  return html`<span class="scn-price"><b class="price">${eur(v)}</b><small>${note}</small></span>`;
}

// v = { card, finishes, pref, price, qty, group: [brief] (même illustration), thumbs: [brief], q }
export function resultHTML(v) {
  const c = v.card;
  const sub = [c.setName, noOf(c), c.rarity].filter(Boolean).join(' · ');
  const own = ownedText(v.qty);
  return html`<div class="scn-res" data-card="${c.id}">
    <a class="scn-art" href="${cardHref(c.id)}" aria-label="${`Voir la fiche de ${c.name}`}">${art(c, true)}</a>
    <div class="scn-info">
      <div class="scn-l1"><h2 class="scn-name" tabindex="-1">${c.name}</h2>${priceHTML(v.price, v.pref)}</div>
      <p class="scn-sub">${sub}</p>
      <p class="scn-own"${own ? '' : html` hidden`}>${own}</p>
    </div>
  </div>
  <p class="scn-lbl">Ajouter</p>
  <div class="chips scn-fins" role="group" aria-label="Ajouter à ta collection">${v.finishes.map(f => html`<button type="button" class="chip scn-fin${f === v.pref ? ' pref' : ''}" data-add="${f}" aria-label="${`Ajouter en ${LABEL[f] || f}`}">${icon('plus', { size: 16 })}<i class="${DOT[f] || 'dot'}"></i>${SHORT[f] || f}</button>`)}</div>
  <div class="scn-links"><a href="${cardHref(c.id)}">Voir la fiche${chev()}</a>${v.dex ? html`<a href="${`#/pokemon/${v.dex}`}">Voir dans le Pokédex${chev()}</a>` : ''}</div>
  ${v.group.length > 1 ? html`<div class="scn-grp">
    <p class="scn-lbl">Même illustration dans plusieurs séries</p>
    <div class="chips scn-alts" role="group" aria-label="Choisis la série de ta carte">${v.group.map(g => html`<button type="button" class="chip" data-pick="${g.id}" aria-pressed="${g.id === c.id ? 'true' : 'false'}" aria-label="${labelOf(g)}">${where(g) || g.id}</button>`)}</div>
  </div>` : ''}
  <div class="scn-more">
    <div class="scn-more-h"><span>Pas la bonne ?</span><a href="${searchHref(v.q)}">Chercher par nom${chev()}</a></div>
    ${v.thumbs.length > 1 ? html`<div class="scn-thumbs" role="group" aria-label="Autres cartes possibles">${v.thumbs.map(t => html`<button type="button" class="scn-thumb" data-pick="${t.id}"${t.id === c.id ? html` aria-current="true"` : ''} aria-label="${labelOf(t)}">${art(t)}</button>`)}</div>` : ''}
  </div>`;
}

// v = { picks: [brief] (3 au plus), same (même illustration : seuls le numéro et le symbole les distinguent), q }
export function chooserHTML(v) {
  return html`<div class="scn-choose">
    <h2 class="scn-ttl" tabindex="-1">Laquelle est-ce ?</h2>
    <p class="scn-sub">${v.same ? 'Même illustration dans plusieurs séries : compare le numéro et le symbole en bas de ta carte.' : 'Ces cartes se ressemblent : touche la bonne.'}</p>
    <div class="scn-picks">${v.picks.map(c => html`<button type="button" class="scn-pick" data-pick="${c.id}" aria-label="${labelOf(c)}">${art(c, true)}<span class="cap"><b>${c.name}</b><span><i>${[noOf(c), c.setName].filter(Boolean).join(' · ')}</i></span></span></button>`)}</div>
    <div class="scn-more-h"><span>Aucune de celles-ci ?</span><a href="${searchHref(v.q)}">Chercher par nom${chev()}</a></div>
  </div>`;
}

// carte non reconnue (déclencheur ou photo) ; retry : libellé du bouton « Réessayer » / « Importer une autre photo »
export function noneHTML({ title = 'Carte non reconnue', text = 'Rapproche-toi : le numéro en bas doit être net.', q = '', retry = 'Réessayer', search = true } = {}) {
  return html`<div class="scn-none">
    <h2 class="scn-ttl" tabindex="-1">${title}</h2>
    <p class="scn-sub">${text}</p>
    <div class="scn-acts">${search ? html`<a class="btn" href="${searchHref(q)}">${icon('search')}Chercher par nom</a>` : ''}<button type="button" class="btn text" data-retry>${retry}</button></div>
  </div>`;
}

export const busyHTML = (text = 'Analyse de la photo…') => html`<div class="scn-busy" aria-busy="true">
  <span class="scn-busy-art"></span><span class="scn-busy-t"><b class="scn-busy-h" tabindex="-1">${text}</b><span class="sk"></span><span class="sk"></span></span>
</div>`;

// Liste des cartes ajoutées pendant le scan (feuille sur téléphone, colonne sur ordinateur)
// items = session.list() ; value = { value, unpriced }
export function sessionHTML(items, value) {
  if (!items.length) {
    return html`<div class="scn-sess-empty"><b>Aucune carte ajoutée</b><p>Les cartes ajoutées depuis le scanner s’affichent ici, avec de quoi annuler.</p></div>`;
  }
  const n = items.reduce((a, x) => a + x.n, 0);
  const val = value?.value ? ` · ${eur(value.value)}` : '';
  return html`<div class="group scn-sess">${items.map(x => html`<div class="row scn-srow">
      <a class="scn-slink" href="${cardHref(x.id, x.finish === 'normal' ? null : x.finish)}" aria-label="${`${labelOf(x)}, ${LABEL[x.finish] || x.finish}${x.n > 1 ? ` ×${x.n}` : ''}`}">
        <span class="thumb">${imgHTML(x, { q: 'low' })}</span>
        <span class="body"><span class="t">${x.name}</span><span class="s"><span>${where(x)}</span><span class="scn-sfin"><i class="${DOT[x.finish] || 'dot'}"></i>${SHORT[x.finish] || x.finish}${x.n > 1 ? ` ×${x.n}` : ''}</span></span></span>
      </a>
      <button type="button" class="btn text sm" data-undo="${x.id}" data-fin="${x.finish}" aria-label="${`Annuler l’ajout de ${x.name}, ${LABEL[x.finish] || x.finish}`}">Annuler</button>
    </div>`)}</div>
  <div class="scn-sess-foot"><span class="num">${plural(n, 'carte', 'cartes')}${val}</span><button type="button" class="btn text sm" data-clear>Effacer la liste</button></div>`;
}

// ordinateur : colonne de droite au repos
export const idleHTML = (items, value) => html`<div class="scn-idle">
  <p class="scn-sub">Pose une carte dans le guide, ou importe une photo. Rien n’est ajouté sans ton accord.</p>
</div>
<h3 class="scn-sect">Ajoutées pendant ce scan</h3>
${sessionHTML(items, value)}`;
