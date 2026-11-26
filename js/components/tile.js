// Tuile de carte (FINAL-design §6.8) : un lien vers la fiche, avec un nom accessible complet.
// Pastilles : « ×N » seulement pour N ≥ 2 (badge 'qty'), « +N » pour les doubles (badge 'extra'), finition en bas à gauche,
// « EN » / « ≈ » en haut à gauche (js/data/images.js). Brillance fixe + un reflet au survol ou à l'appui.
import { html, raw, esc } from '../core/dom.js';
import { eur, cardNo } from '../core/format.js';
import { imgHTML, enBadge } from '../data/images.js';
import { SHORT, LABEL, DOT } from '../data/finishes.js';
import { metaSync, setIdOf } from '../data/catalog.js';

const FX = new Set(['reverse', 'holo', 'cosmos', 'pokeball', 'masterball']);   // finitions avec calque brillant

// nom et total imprimé de la série : ceux de l'enregistrement, sinon ceux du catalogue chargé
const setInfo = card => {
  const m = card.setName && card.setTotal ? null : metaSync(card.setId || setIdOf(card.id));
  return { name: card.setName || m?.name || '', total: card.setTotal || m?.total || 0 };
};

const ownText = (mode, qty, missing) => (mode === 'none' ? ''
  : missing ? 'manquante'
  : mode === 'extra' ? (qty > 0 ? `${qty} en trop` : '')
  : qty >= 2 ? `possédée ×${qty}` : qty === 1 ? 'possédée' : '');

const badgeText = (mode, qty) => (mode === 'extra' ? (qty >= 1 ? `+${qty}` : '') : mode === 'qty' && qty >= 2 ? `×${qty}` : '');
const priceText = p => (typeof p === 'number' ? eur(p) : String(p));

// tileHTML(card, { qty, finish, missing, price, meta, href, badge: 'qty'|'extra'|'none', fx, label }) → Safe
export function tileHTML(card, opts = {}) {
  const { qty = 0, finish = null, missing = false, price = null, meta = '', href, badge = 'qty', fx = true } = opts;
  const id = card.id;
  const set = setInfo(card);
  const no = cardNo(card.localId, set.total);
  const special = finish && finish !== 'normal' ? finish : null;
  const base = [card.name, set.name, no, special ? (LABEL[special] || special) : ''].filter(Boolean).join(', ');
  const label = opts.label || [base, ownText(badge, qty, missing)].filter(Boolean).join(', ');
  const link = href ?? `#/carte/${id}${finish ? `?finition=${encodeURIComponent(finish)}` : ''}`;
  const b = badgeText(badge, qty);
  const metaText = meta || [set.name, card.localId].filter(Boolean).join(' · ') || no;
  return html`<a class="tile${missing ? ' missing' : ''}" href="${link}" data-card="${id}"${finish ? raw(` data-finish="${esc(finish)}"`) : ''} data-b="${badge}" data-q="${qty}" data-l="${base}" aria-label="${label}"><span class="tile-img">${
    imgHTML(card, { q: 'low' })}${
    fx && FX.has(finish) ? raw(`<i class="fx fx-${finish}"></i>`) : ''}${
    b ? html`<span class="qty${badge === 'extra' ? ' extra' : ''}">${b}</span>` : ''}${
    special ? html`<span class="fin"><i class="${DOT[special] || ''}"></i>${SHORT[special] || special}</span>` : ''}${
    enBadge(card)}</span><span class="cap"><b>${card.name}</b><span><i>${metaText}</i>${
    price != null ? html`<em>${priceText(price)}</em>` : ''}</span></span></a>`;
}

// met à jour une tuile en place (quantité, manquante, prix) sans la redessiner
export function patchTile(el, { qty, missing, price } = {}) {
  const mode = el.dataset.b || 'qty';
  if (qty !== undefined) {
    el.dataset.q = String(qty);
    const t = badgeText(mode, qty);
    let q = el.querySelector('.qty');
    if (t) {
      if (!q) {
        q = document.createElement('span');
        q.className = `qty${mode === 'extra' ? ' extra' : ''}`;
        el.querySelector('.tile-img')?.appendChild(q);
      }
      q.textContent = t;
    } else q?.remove();
  }
  if (missing !== undefined) el.classList.toggle('missing', !!missing);
  if (price !== undefined) {
    let em = el.querySelector('.cap em');
    if (price == null) em?.remove();
    else {
      if (!em) { em = document.createElement('em'); el.querySelector('.cap > span')?.appendChild(em); }
      em.textContent = priceText(price);
    }
  }
  if (el.dataset.l != null && (qty !== undefined || missing !== undefined)) {
    const own = ownText(mode, +el.dataset.q || 0, el.classList.contains('missing'));
    el.setAttribute('aria-label', [el.dataset.l, own].filter(Boolean).join(', '));
  }
}
