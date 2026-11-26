// (Ébauche F1, remplacée par la vague 2.) Page d'une série : en-tête (logo, progression) et la grille de ses cartes.
import { setBar } from '../core/appbar.js';
import { html, setHTML } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { dateFr, localNo } from '../core/format.js';
import { renderChunked, patchByKey } from '../core/list.js';
import { MESSAGES } from '../core/net.js';
import { infoSheet } from '../core/sheet.js';
import { param } from '../core/router.js';
import { setLogoHTML } from '../components/setlogo.js';
import { tileHTML, patchTile } from '../components/tile.js';
import * as catalog from '../data/catalog.js';
import * as col from '../state/collection.js';

let el = null, cur = null;

function progHTML(owned, total) {
  const pc = total ? Math.floor((owned / total) * 100) : 0;
  const done = total && owned >= total;
  return html`<div class="prog${done ? ' done' : ''}"><span class="lbl">Cartes</span><b>${owned} / ${total}</b><span class="progress${done ? ' done' : ''}"><i style="width:${pc}%"></i></span><span class="pc">${done ? 'Complète' : `${pc} %`}</span></div>`;
}

export default {
  mount(section) {
    el = section;
    el.innerHTML = '<div class="stub-head"></div><div class="grid" id="set-grid"></div>';
  },
  async show(r) {
    const { signal } = r;                    // annulé dès que la route change : plus de barre ni de DOM après coup
    const id = param(r);
    const meta0 = catalog.metaSync(id);
    setBar({ title: meta0?.name || 'Série', subtitle: meta0?.date ? dateFr(meta0.date) : '', back: true, signal });
    const grid = el.querySelector('#set-grid');
    grid.innerHTML = '';
    let s;
    try { s = await catalog.set(id); } catch (e) {
      if (signal.aborted) return;
      setHTML(el.querySelector('.stub-head'), html`<div class="errrow" data-content>${icon('wifi-off')}<span class="grow">${MESSAGES[e?.kind] || 'Série indisponible'}</span></div>`);
      return;
    }
    if (signal.aborted) return;
    cur = s;
    const all = await catalog.sets().catch(() => null);
    if (signal.aborted) return;
    const bloc = all?.blocs.find(b => b.id === s.meta.bloc);
    setBar({
      title: s.meta.name, back: true, signal,
      subtitle: [bloc?.name, s.meta.date ? dateFr(s.meta.date) : ''].filter(Boolean).join(' · '),
      menu: [{ icon: 'info', label: 'Modes d’affichage', onClick: () => infoSheet('Modes d’affichage', 'Grille, liste à cocher et classeur arrivent avec la version complète de cet écran.') }],
    });
    const owned = new Set(col.inSet(id).map(rec => rec.id));
    setHTML(el.querySelector('.stub-head'), html`<div class="stub-sethead">${setLogoHTML(s.meta, { size: 'hero' })}<div class="grow">${progHTML(owned.size, catalog.goalOf(s.meta) || s.cards.length)}<p class="caption">${[s.meta.code, s.meta.legal?.standard ? 'Standard' : s.meta.legal?.expanded ? 'Étendu' : ''].filter(Boolean).join(' · ')}</p></div></div><p class="stub-note">Écran en construction</p>`);
    await renderChunked(grid, s.cards, c => {
      const n = col.qtyOf(c.id);
      return tileHTML(c, { qty: n, missing: !n, meta: localNo(c.localId) });   // numéro affiché décodé (« ? »)
    });
  },
  hide() {},
  onChange(events) {
    if (!el || !cur) return;
    for (const e of events) {
      if (e.type === 'reload') { el.querySelectorAll('[data-card]').forEach(t => { const n = col.qtyOf(t.dataset.card); patchTile(t, { qty: n, missing: !n }); }); continue; }
      if (e.type !== 'qty') continue;
      patchByKey(el, e.id, t => { const n = col.qtyOf(e.id); patchTile(t, { qty: n, missing: !n }); });
    }
  },
};
