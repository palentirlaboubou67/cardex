// (Ébauche F1, remplacée par la vague 2.) Séries : champ de recherche, puces, séries par bloc avec leur logo.
// La recherche de l'ébauche filtre seulement les séries par leur nom ; la vraie recherche (cartes + séries) vient ensuite.
import { setBar } from '../core/appbar.js';
import { html, setHTML, delegate } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { norm, plural } from '../core/format.js';
import { setParams, setHref } from '../core/router.js';
import { renderChunked } from '../core/list.js';
import { setLogoHTML } from '../components/setlogo.js';
import * as catalog from '../data/catalog.js';
import * as col from '../state/collection.js';
import { MESSAGES } from '../core/net.js';

const FILTERS = [['', 'Toutes'], ['miennes', 'Les miennes'], ['en-cours', 'En cours']];
let el = null, q = '', filtre = '', timer = 0;

const pctOf = (n, t) => (t ? Math.floor((n / t) * 100) : 0);

function rowHTML(s, owned) {
  const total = catalog.goalOf(s);
  const pc = pctOf(owned, total);
  const done = total && owned >= total;
  return html`<a class="row" href="${setHref(s.id)}">${setLogoHTML(s)}<span class="body"><span class="t">${s.name}</span><span class="s"><span class="num">${owned} / ${total}</span><span class="progress${done ? ' done' : ''}"><i style="width:${pc}%"></i></span><span class="num">${done ? 'Complète' : `${pc} %`}</span></span></span>${icon('chevron-right', { cls: 'chev' })}</a>`;
}

async function render() {
  const body = el.querySelector('.stub-body');
  let all;
  try { all = await catalog.sets(); } catch (e) {
    setHTML(body, html`<div class="errrow" data-content>${icon('wifi-off')}<span class="grow">${MESSAGES[e?.kind] || 'Séries indisponibles'}</span><button type="button" class="btn text" data-retry>Réessayer</button></div>`);
    return;
  }
  const owned = col.ownedBySet();
  const nq = norm(q);
  const keep = s => (!nq || norm(s.name).includes(nq) || (s.code || '').toLowerCase() === nq)
    && (!filtre || (filtre === 'miennes' ? owned.get(s.id) : owned.get(s.id) && owned.get(s.id) < catalog.goalOf(s)));
  const blocs = all.blocs.map(b => ({ b, sets: b.sets.filter(keep) })).filter(x => x.sets.length);
  const blocHTML = ({ b, sets }) => html`
    <div class="blochead">${b.logo ? setLogoHTML({ id: b.id, logo: b.logo, code: b.id, dark: b.dark }, { size: 'bloc' }) : ''}<span class="grow">${b.name}${b.first ? ` · ${b.first.slice(0, 4)}` : ''}</span><span class="num">${plural(sets.length, 'série', 'séries')}</span></div>
    <div class="group">${sets.map(s => rowHTML(s, owned.get(s.id) || 0))}</div>`;
  // le premier écran tout de suite (premiers blocs), le reste par lots qui rendent la main (FINAL-perf §4.5)
  await renderChunked(body, blocs, blocHTML, {
    first: 1, batch: 2,
    empty: html`<div class="empty" data-content><span class="ic">${icon('search')}</span><b>Aucune série trouvée</b><p>Essaie un autre nom.</p></div>`,
  });
}

export default {
  mount(section) {
    el = section;
    el.innerHTML = String(html`
      <div class="searchbar"><label class="search">${icon('search')}<input type="search" name="q" placeholder="Rechercher une carte ou une série" aria-label="Rechercher une carte ou une série" autocomplete="off" enterkeyhint="search"><button type="button" class="search-clear" aria-label="Effacer">${icon('close')}</button></label></div>
      <div class="chips" role="group" aria-label="Filtrer les séries">${FILTERS.map(([v, t]) => html`<button type="button" class="chip" data-f="${v}" aria-pressed="false">${t}</button>`)}</div>
      <div class="stub-body"></div>`);
    delegate(el, 'input', 'input[name="q"]', (e, i) => {
      clearTimeout(timer);
      timer = setTimeout(() => { q = i.value.trim(); setParams({ q: q || null }); render(); }, 150);
    });
    delegate(el, 'click', '[data-f]', (e, b) => { filtre = b.dataset.f; setParams({ filtre: filtre || null }); syncChips(); render(); });
    delegate(el, 'click', '[data-retry]', () => render());
  },
  async show(r) {
    setBar({ title: 'Séries', signal: r.signal });
    q = r.q.get('q') || '';
    filtre = r.q.get('filtre') || '';
    el.querySelector('input[name="q"]').value = q;
    syncChips();
    await render();
  },
  hide() { clearTimeout(timer); },
  onChange(events) { if (events.some(e => e.type !== 'qty' || e.added || e.removed)) render(); },
};

function syncChips() {
  for (const b of el.querySelectorAll('[data-f]')) b.setAttribute('aria-pressed', String(b.dataset.f === filtre));
}
