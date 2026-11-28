// Collection › Doubles (W-K) : valeur des exemplaires en trop, bouton « Copier ma liste d'échange » (doubles + envies,
// presse-papiers, sinon feuille avec le texte à sélectionner), une tuile « +N » par version en double.
import { html, setHTML, delegate } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { eur, num, plural, norm, cardNo } from '../../core/format.js';
import { openSheet, infoSheet } from '../../core/sheet.js';
import { toast } from '../../core/toast.js';
import { tileHTML, patchTile } from '../../components/tile.js';
import * as col from '../../state/collection.js';
import * as prefs from '../../state/prefs.js';
import * as prices from '../../data/prices.js';
import { FINISHES, LABEL, order } from '../../data/finishes.js';
import { metaSync, setIdOf } from '../../data/catalog.js';
import { tileSel, insertAt, tilePrice, CHUNK, renderGrid as paint } from './grid.js';

const keySel = k => { const i = k.lastIndexOf('|'); return tileSel(k.slice(0, i), k.slice(i + 1)); };
const finText = f => (f && f !== 'normal' ? ` (${LABEL[f] || f})` : '');

// versions possédées en au moins deux exemplaires, les plus chères d'abord (cote unitaire), puis par nom
function doubles() {
  const out = [];
  for (const r of col.all()) for (const f of FINISHES) if ((r.qty[f] || 0) >= 2) out.push({ r, f, n: r.qty[f], k: `${r.id}|${f}` });
  for (const e of out) e.s = [-(prices.eur(e.r.id, e.f) ?? -1), norm(e.r.name), order(e.f)];
  return out.sort((a, b) => { for (let i = 0; i < 3; i++) { if (a.s[i] < b.s[i]) return -1; if (a.s[i] > b.s[i]) return 1; } return 0; });
}

// texte de la liste d'échange (même forme que l'ancienne appli) ; wishes = enregistrements WishDB
export function tradeText(list, wishes = []) {
  const lines = [];
  if (list.length) {
    lines.push('Mes doubles à échanger :');
    for (const { r, f, n } of list) {
      lines.push(`• ${r.name} – ${r.setName} ${cardNo(r.localId, r.setTotal || metaSync(r.setId)?.total)}${finText(f)}${n > 2 ? ` ×${n - 1}` : ''}`);
    }
  }
  const ws = (wishes || []).filter(w => w && w.name).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  if (ws.length) {
    if (lines.length) lines.push('');
    lines.push('Je cherche :');
    for (const w of ws) {
      const sid = w.setId || setIdOf(w.id || '');
      lines.push(`• ${w.name} – ${w.setName || metaSync(sid)?.name || ''} ${cardNo(w.localId, metaSync(sid)?.total)}${finText(w.variant)}`.replace(/\s+$/, ''));
    }
  }
  return lines.join('\n');
}

export function create(box, api) {
  box.innerHTML = `<div class="summary col-dsum"></div>
    <div class="col-trade"><button type="button" class="btn block" data-act="trade">${icon('copy')}Copier ma liste d’échange</button><button type="button" class="ibtn" data-act="info" aria-label="À propos des doubles">${icon('info')}</button></div>
    <div class="grid col-grid"></div>`;
  const els = { sum: box.querySelector('.col-dsum'), trade: box.querySelector('.col-trade'), grid: box.querySelector('.col-grid') };
  let keys = [], rendered = false, dirty = false, busy = false, pricesTried = false, partial = false, resortT = 0;
  // séries des doubles : leurs cotes passent avant celles du reste de la collection (ordre et valeur des doubles)
  const dsets = () => [...new Set(doubles().map(e => e.r.setId))];
  const priced = () => dsets().every(id => prices.has(id));
  let wishes = null, wishesP = null, wishSub = false;

  // envies lues d'avance : le clic copie tout de suite (Safari refuse le presse-papiers après une attente)
  function loadWishes() {
    const W = window.WishDB;
    if (!W?.all) { wishes = []; return Promise.resolve(wishes); }
    if (!wishSub) { wishSub = true; try { W.on?.(() => { wishesP = null; loadWishes(); }); } catch { /* rien */ } }
    wishesP ??= W.all().then(a => { wishes = Array.isArray(a) ? a : []; syncButton(); return wishes; }, () => { wishes = []; return wishes; });
    return wishesP;
  }
  function syncButton() {
    const has = keys.length > 0 || (wishes?.length || 0) > 0;
    els.trade.hidden = !has;
  }

  function renderSummary() {
    const list = doubles();
    const ready = pricesTried || list.every(e => prices.has(e.r.setId));
    let value = 0, extra = 0, unpriced = 0;
    for (const e of list) {
      extra += e.n - 1;
      const p = prices.eur(e.r.id, e.f);
      if (p == null) unpriced += e.n - 1; else value += p * (e.n - 1);
    }
    els.sum.hidden = !list.length;
    if (!list.length) return;
    setHTML(els.sum, html`<span class="hero num">${ready ? eur(Math.round(value * 100) / 100) : html`<span class="sk col-sk-hero"></span>`}</span><span class="meta full">${
      plural(extra, 'carte à échanger', 'cartes à échanger')} · ${plural(list.length, 'différente', 'différentes')}${
      ready && unpriced ? ` · ${plural(unpriced, 'sans cote', 'sans cote')}` : ''}</span>`);
  }

  const tpl = e => {
    const n = col.qtyOf(e.r.id, e.f);
    return tileHTML(e.r, { qty: n - 1, finish: e.f, badge: 'extra', price: tilePrice(e.r.id, e.r.setId, e.f), meta: [`${n} ex.`, e.r.setName].filter(Boolean).join(' · ') });
  };
  const EMPTY = () => html`<div class="empty" data-content><span class="ic">${icon('copy')}</span><b>Aucun double</b><p>Quand tu ajoutes une carte que tu as déjà, elle apparaît ici.</p></div>`;

  function renderGrid() {
    const list = doubles();
    keys = list.map(e => e.k);
    els.grid.classList.toggle('compact', !!prefs.get('compact', false));
    busy = true;
    const p = paint(els.grid, list, tpl, { ...CHUNK, empty: EMPTY() });
    p.then(ok => { if (ok) busy = false; });
    syncButton();
    return p;
  }

  function render() {
    dirty = false;
    rendered = true;
    clearTimeout(resortT);
    partial = !priced();                                     // ordre fait sans toutes les cotes : refait à leur arrivée
    renderSummary();
    return renderGrid();
  }

  // ---------- liste d'échange ----------
  async function copy() {
    const text = tradeText(doubles(), wishes ?? await loadWishes());
    if (!text) { toast('Rien à copier pour l’instant'); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('presse-papiers absent');
      await navigator.clipboard.writeText(text);
      toast('Liste copiée : colle-la dans ta discussion');
    } catch {
      fallback(text);
    }
  }
  function fallback(text) {
    const share = typeof navigator.share === 'function';
    const s = openSheet({
      title: 'Ta liste d’échange',
      body: html`<p class="col-sheet-lede">Sélectionne le texte pour le copier.</p><textarea class="input col-tradetext" readonly rows="12" aria-label="Liste d’échange">${text}</textarea>${
        share ? html`<div class="col-sheet-btns"><button type="button" class="btn block" data-share>${icon('external')}Partager</button></div>` : ''}`,
    });
    const ta = s.el.querySelector('textarea');
    try { ta.focus({ preventScroll: true }); ta.select(); } catch { /* rien */ }
    s.el.querySelector('[data-share]')?.addEventListener('click', () => { navigator.share({ text }).catch(() => {}); });
  }

  delegate(box, 'click', '[data-act]', (e, b) => {
    if (b.dataset.act === 'trade') copy();
    else if (b.dataset.act === 'info') import('./shared.js').then(m => infoSheet(...m.INFO.doubles));
  });
  prefs.on(k => { if (k === 'compact') els.grid.classList.toggle('compact', !!prefs.get('compact', false)); });

  // ---------- changements ----------
  function onChange(evs, current) {
    if (!rendered) return;
    if (!current) { dirty = true; return; }
    const qty = evs.filter(e => e.type === 'qty');
    if (evs.some(e => e.type === 'reload') || (busy && qty.length)) { if (api.shown()) render(); else dirty = true; return; }
    if (!qty.length) return;
    let changed = false;
    for (const e of qty) {
      const k = `${e.id}|${e.finish}`;
      const t = els.grid.querySelector(tileSel(e.id, e.finish));
      if (e.after >= 2) {
        if (t) {
          patchTile(t, { qty: e.after - 1 });
          const meta = t.querySelector('.cap i');
          if (meta) meta.textContent = [`${e.after} ex.`, col.get(e.id)?.setName].filter(Boolean).join(' · ');
        } else if (e.before < 2) {
          if (!keys.length) { renderGrid(); changed = true; continue; }     // l'état vide laisse la place à la grille
          const ks = doubles().map(x => x.k);
          const i = ks.indexOf(k);
          if (i >= 0) { const r = col.get(e.id); insertAt(els.grid, ks, i, String(tpl({ r, f: e.finish })), keySel); keys = ks; }
        }
      } else if (t) {
        t.remove();
        keys = keys.filter(x => x !== k);
        if (!keys.length) renderGrid();
      }
      changed = true;
    }
    if (changed) { renderSummary(); syncButton(); }
  }

  // cotes arrivées : prix des tuiles corrigés en place ; l'ordre (les plus chères d'abord) n'est refait que s'il change,
  // une fois par salve de fichiers
  function onPrices() {
    if (!rendered) return;
    renderSummary();
    if (!partial) { patchPrices(); return; }
    if (!api.shown()) { dirty = true; return; }
    clearTimeout(resortT);
    resortT = setTimeout(() => {
      if (!api.shown()) { dirty = true; return; }
      const ks = doubles().map(e => e.k);
      if (busy || ks.join(';') !== keys.join(';')) { render(); return; }
      partial = !priced();
      patchPrices();
    }, 150);
  }
  function patchPrices() {
    for (const t of els.grid.querySelectorAll('.tile[data-card]')) {
      const id = t.dataset.card, s = setIdOf(id);
      if (prices.has(s)) patchTile(t, { price: tilePrice(id, s, t.dataset.finish) });
    }
  }

  // Affiché tout de suite (ordre des cotes déjà là) ; les cotes des séries des doubles sont demandées en premier,
  // puis celles du reste de la collection, et l'ordre se corrige à leur arrivée (onPrices). Avant : jusqu'à 1,2 s
  // d'attente et 544 Ko de fichiers de cotes avant le premier contenu avec une collection étalée sur 177 séries.
  async function show(q, signal) {
    loadWishes();
    if (rendered && !dirty) { syncButton(); return; }
    if (!priced()) prices.ensure(dsets());
    col.ensurePrices().then(() => { pricesTried = true; if (rendered) renderSummary(); });
    if (signal?.aborted && rendered) return;
    render();
  }

  return { show, resume() { if (dirty) render(); }, onChange, onPrices };
}
