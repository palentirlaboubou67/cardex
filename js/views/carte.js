// (Ébauche F1, remplacée par la vague 2.) Fiche carte : grande image, nom (le titre de la barre apparaît quand le
// nom sort de l'écran), quantités par finition avec un compteur, et l'annulation dans le toast.
import { setBar, revealTitle } from '../core/appbar.js';
import { html, setHTML, delegate } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { cardNo, eur } from '../core/format.js';
import { toast } from '../core/toast.js';
import { infoSheet } from '../core/sheet.js';
import { cardId } from '../core/router.js';
import { MESSAGES } from '../core/net.js';
import { imgHTML, imgCaption } from '../data/images.js';
import { LABEL, DOT } from '../data/finishes.js';
import * as catalog from '../data/catalog.js';
import * as col from '../state/collection.js';
import * as prices from '../data/prices.js';

let el = null, card = null, io = null, sig = null;

function rowsHTML() {
  return html`${(card.finishes?.length ? card.finishes : ['normal']).map(f => {
    const n = col.qtyOf(card.id, f);
    // cote Cardmarket de la finition (« — » si elle n'en a pas : jamais la normale à la place, SPEC §8)
    const p = prices.has(card.setId) ? prices.get(card.id, f) : undefined;
    const pt = p === undefined ? '' : p?.eur != null ? `${eur(p.eur)}${p.allEditions ? ' · prix toutes éditions' : ''}` : '—';
    return html`<div class="row" data-f="${f}"><i class="${DOT[f]}"></i><span class="body"><span class="t">${LABEL[f] || f}</span>${pt ? html`<span class="s"><span class="num">${pt}</span></span>` : ''}</span><span class="stepper"><button type="button" data-step="-1" aria-label="${LABEL[f] || f} : retirer un exemplaire"${n ? '' : html` disabled`}>${icon('minus')}</button><span class="v" aria-live="polite">${n}</span><button type="button" data-step="1" aria-label="${LABEL[f] || f} : ajouter un exemplaire">${icon('plus')}</button></span></div>`;
  })}`;
}

function observe() {
  io?.disconnect();
  const name = el.querySelector('.stub-name');
  if (!name || typeof IntersectionObserver !== 'function') return;
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--appbar')) || 56;
  io = new IntersectionObserver(([e]) => revealTitle(!e.isIntersecting, { signal: sig }), { rootMargin: `-${top}px 0px 0px 0px` });
  io.observe(name);
}

export default {
  mount(section) {
    el = section;
    delegate(el, 'click', '[data-step]', (e, b) => {
      const f = b.closest('[data-f]').dataset.f;
      const before = col.qtyOf(card.id, f);
      const n = Math.max(0, before + Number(b.dataset.step));
      col.setQty(card, f, n);
      const c = card;
      toast(n > before ? `Ajoutée en ${LABEL[f] || f} · ${col.qtyOf(c.id)} au total` : `Retirée · ${col.qtyOf(c.id)} au total`,
        { action: 'Annuler', onAction: () => col.setQty(c, f, before) });
    });
  },
  // r.signal : annulé si on quitte la fiche pendant son chargement (la barre d'une autre page n'est jamais écrasée)
  async show(r) {
    const { signal } = r;
    sig = signal;
    const id = cardId(r);
    io?.disconnect();
    setBar({ title: 'Carte', back: true, titleHidden: true, signal });
    let c = null, err = null;
    try { c = await catalog.card(id); } catch (e) { err = e; }
    if (signal.aborted) return;
    c ??= col.get(id) || null;
    if (!c) {
      setBar({ title: 'Carte', back: true, signal });
      setHTML(el, html`<div class="empty" data-content><span class="ic">${icon(err ? 'wifi-off' : 'alert')}</span><b>${err ? MESSAGES[err.kind] || 'Carte indisponible' : 'Carte introuvable'}</b><p>${id}</p></div>`);
      return;
    }
    card = c;
    const meta = catalog.metaSync(c.setId || catalog.setIdOf(id));
    const caption = imgCaption(c);
    setBar({
      title: c.name, back: true, titleHidden: true, signal,
      actions: [{ icon: 'bell', label: 'Alerte prix', onClick: () => infoSheet('Alerte prix', 'Les alertes de prix arrivent avec la version complète de la fiche.') }],
    });
    setHTML(el, html`
      <div class="stub-card">${imgHTML(c, { q: 'high', eager: true, alt: c.name })}</div>
      <div class="pad"><h2 class="stub-name">${c.name}</h2>
      <p class="muted">${[meta?.name, cardNo(c.localId, meta?.total), c.rarity].filter(Boolean).join(' · ')}</p>
      ${caption ? html`<p class="caption">${caption}</p>` : ''}</div>
      <div class="sect">Ma collection</div>
      <div class="group" id="card-rows">${rowsHTML()}</div>
      <p class="caption">${prices.CREDIT}</p>
      <p class="stub-note">Écran en construction</p>`);
    observe();
    // cotes de la série : les lignes sont refaites quand le fichier arrive
    if (!prices.has(c.setId)) prices.ensure([c.setId]).then(() => { const box = el.querySelector('#card-rows'); if (card === c && box) setHTML(box, rowsHTML()); });
  },
  resume() { observe(); },
  hide() { io?.disconnect(); io = null; },
  onChange(events) {
    if (!card || !events.some(e => e.type === 'reload' || e.id === card.id)) return;
    const box = el.querySelector('#card-rows');
    if (box) setHTML(box, rowsHTML());
  },
};
