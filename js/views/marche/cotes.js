// Marché › Cotes (W-P) : valeur de la collection, variation (moy. 7 j vs 30 j), cartes en hausse, en baisse, les plus
// chères. Cotes Cardmarket des fichiers par série (js/data/prices.js) ; une ligne par carte et par finition possédée.
import { html, setHTML, delegate } from '../../core/dom.js';
import { eur, num, plural, cardNo, dateFr } from '../../core/format.js';
import { icon } from '../../core/icons.js';
import { cardHref, setParams } from '../../core/router.js';
import { deltaHTML } from '../../components/chart.js';
import * as col from '../../state/collection.js';
import * as prices from '../../data/prices.js';
import { imgHTML } from '../../data/images.js';
import { LABEL, DOT } from '../../data/finishes.js';

const FILTERS = [['hausse', 'En hausse'], ['baisse', 'En baisse'], ['cheres', 'Les plus chères']];
const PAGE = 60;
let box = null, filtre = 'hausse', shown = PAGE, data = null, memo = '', dirty = true, visible = false, loading = null;

// lignes (carte × finition possédée) et totaux ; mémorisés sur la révision de la collection et des cotes
function compute() {
  const key = `${col.rev()}|${prices.version()}`;
  if (data && memo === key) return data;
  const rows = [];
  let value = 0, a7 = 0, a30 = 0, up = 0, down = 0, priced = 0, unpriced = 0;
  for (const rec of col.all()) {
    for (const [f, n] of Object.entries(rec.qty || {})) {
      if (!(n > 0)) continue;
      const p = prices.get(rec.id, f);
      const now = p?.eur ?? null;
      if (now == null) { unpriced += n; continue; }
      priced += n;
      value += now * n;
      // 1re édition / tampon sans produit Cardmarket à part : cote de la carte de base (« prix toutes éditions »),
      // comptée dans la valeur mais ni moyennes ni variation (ce ne sont pas des ventes de cette version)
      const ae = !!p.allEditions;
      const ch = !ae && p.avg7 && p.avg30 ? ((p.avg7 - p.avg30) / p.avg30) * 100 : null;
      if (ch != null) { a7 += p.avg7 * n; a30 += p.avg30 * n; if (ch > 0.5) up++; else if (ch < -0.5) down++; }
      rows.push({ rec, f, n, now, ch, ae, a7: ae ? null : p.avg7, a30: ae ? null : p.avg30 });
    }
  }
  data = { rows, value: Math.round(value * 100) / 100, ch: a30 ? ((a7 - a30) / a30) * 100 : null, up, down, priced, unpriced };
  memo = key;
  return data;
}

function list(d) {
  if (filtre === 'baisse') return d.rows.filter(r => r.ch != null && r.ch < -0.5).sort((a, b) => a.ch - b.ch || b.now - a.now);
  if (filtre === 'cheres') return d.rows.slice().sort((a, b) => b.now - a.now);
  return d.rows.filter(r => r.ch != null && r.ch > 0.5).sort((a, b) => b.ch - a.ch || b.now - a.now);
}

const tri = (d, n) => html`<span class="mk-tri ${d}">${icon(d, { size: 9 })}<span>${num(n)}</span><span class="sr"> ${d === 'up' ? 'en hausse' : 'en baisse'}</span></span>`;

function rowHTML(r) {
  const { rec, f, n } = r;
  const no = cardNo(rec.localId, rec.setTotal);
  const fin = f !== 'normal' ? html`<span class="mk-fin"><i class="${DOT[f] || 'fd'}" aria-hidden="true"></i>${LABEL[f] || f}</span>` : '';
  const avg = r.ae ? 'Prix toutes éditions'
    : [r.a7 ? `moy. 7 j ${eur(r.a7)}` : '', r.a30 ? `moy. 30 j ${eur(r.a30)}` : ''].filter(Boolean).join(' · ');
  const label = [rec.name, rec.setName, no, f !== 'normal' ? LABEL[f] : '', n > 1 ? `×${n}` : '', r.ae ? `prix toutes éditions ${eur(r.now)}` : eur(r.now),
    r.ch != null ? `${r.ch > 0 ? 'hausse' : 'baisse'} de ${Math.abs(r.ch).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : ''].filter(Boolean).join(', ');
  return html`<a class="row mk-crow" href="${cardHref(rec.id, f === 'normal' ? null : f)}" data-card="${rec.id}" aria-label="${label}"><span class="thumb">${imgHTML(rec, { q: 'low' })}</span><span class="body"><span class="t">${rec.name}</span><span class="s"><span>${[rec.setName, no].filter(Boolean).join(' · ')}</span>${fin}${n > 1 ? html`<span class="mk-n">×${n}</span>` : ''}</span>${
    avg ? html`<span class="s mk-avg"><span>${avg}</span></span>` : ''}</span><span class="end"><span class="price">${eur(r.now)}</span>${r.ch != null ? deltaHTML(r.ch) : ''}</span></a>`;
}

function emptyFor() {
  const t = { hausse: 'Aucune carte en hausse', baisse: 'Aucune carte en baisse', cheres: 'Aucune cote' }[filtre];
  return html`<div class="empty"><span class="ic">${icon(filtre === 'baisse' ? 'market-down' : 'market')}</span><b>${t}</b><p>Les cotes de tes cartes bougent peu en ce moment.</p></div>`;
}

function renderList(d) {
  const L = list(d);
  const g = box.querySelector('.mk-clist');
  g.hidden = !L.length;
  setHTML(g, html`${L.slice(0, shown).map(rowHTML)}`);
  setHTML(box.querySelector('.mk-cempty'), L.length ? '' : emptyFor());
  const more = box.querySelector('[data-more]');
  more.hidden = L.length <= shown;
  more.textContent = `Afficher plus (${num(L.length - shown)})`;
}

function chipsHTML(d) {
  const n = { hausse: d.up, baisse: d.down, cheres: d.rows.length };
  return FILTERS.map(([k, label]) => html`<button type="button" class="chip" data-f="${k}" aria-pressed="${k === filtre ? 'true' : 'false'}">${label}<span class="n">${num(n[k])}</span></button>`);
}

function render() {
  const d = compute();
  dirty = false;
  if (!col.all().length) {
    setHTML(box, html`<div class="empty" data-content><span class="ic">${icon('market')}</span><b>Aucune carte</b><p>Ajoute des cartes à ta collection pour suivre leurs cotes.</p><a class="btn primary" href="#/scanner">Scanner une carte</a></div>`);
    box.dataset.built = '';
    return;
  }
  if (!box.dataset.built) {
    setHTML(box, html`<div class="summary mk-sum" data-content><span class="hero num"></span><span class="meta mk-sum1"></span><span class="meta mk-sum2"></span></div>
<div class="chips" role="group" aria-label="Filtrer les cartes"></div>
<div class="mk-err"></div>
<div class="group mk-list mk-clist"></div><div class="mk-cempty"></div>
<div class="btns"><button type="button" class="btn block" data-more hidden>Afficher plus</button></div>
<p class="caption mk-credit"></p>`);
    box.dataset.built = '1';
  }
  box.querySelector('.hero').textContent = eur(d.value);
  setHTML(box.querySelector('.mk-sum1'), d.priced
    ? html`${d.ch != null ? deltaHTML(d.ch) : ''}<span>${d.ch != null ? ' (moy. 7 j vs 30 j)' : 'Variation inconnue'}</span><i class="mk-dotsep" aria-hidden="true">·</i>${tri('up', d.up)}<i class="mk-dotsep" aria-hidden="true">·</i>${tri('down', d.down)}`
    : html`<span>Pas encore de cote pour tes cartes</span>`);
  box.querySelector('.mk-sum2').textContent = [plural(d.priced, 'carte cotée', 'cartes cotées'), d.unpriced ? `${num(d.unpriced)} sans cote` : ''].filter(Boolean).join(' · ');
  setHTML(box.querySelector('.chips'), html`${chipsHTML(d)}`);
  const date = prices.date();
  box.querySelector('.mk-credit').textContent = date ? `Cotes Cardmarket du ${dateFr(date)}` : '';
  renderList(d);
}

// fichiers de cotes des séries possédées (jamais de rejet) ; hors ligne sans copie : ligne d'erreur + Réessayer
async function ensure(signal) {
  loading ??= col.ensurePrices().finally(() => { loading = null; });
  await loading;
  if (!signal?.aborted) errRow();
}
function errRow() {
  const owned = [...col.ownedBySet().keys()];
  const missing = owned.filter(s => !prices.has(s));
  const err = box.querySelector('.mk-err');
  if (!err) return;
  setHTML(err, missing.length && owned.length
    ? html`<div class="errrow" role="status">${icon('wifi-off')}<span class="grow">${navigator.onLine === false ? 'Hors ligne' : 'Connexion impossible'} · cotes de ${plural(missing.length, 'série', 'séries')} non chargées</span><button type="button" class="btn text" data-retry>Réessayer</button></div>`
    : '');
}

export default {
  mount(el) {
    box = el;
    delegate(box, 'click', '[data-f]', (e, b) => {
      if (b.dataset.f === filtre) return;
      filtre = b.dataset.f;
      shown = PAGE;
      setParams({ filtre: filtre === 'hausse' ? null : filtre });
      for (const c of box.querySelectorAll('[data-f]')) c.setAttribute('aria-pressed', c.dataset.f === filtre ? 'true' : 'false');
      renderList(compute());
    });
    delegate(box, 'click', '[data-more]', () => { shown += PAGE; renderList(compute()); });
    delegate(box, 'click', '[data-retry]', async () => { await ensure(); render(); errRow(); });
    prices.on(() => { if (visible) schedule(); else dirty = true; });
  },
  async show(r) {
    visible = true;
    const f = r.q.get('filtre');
    const nf = FILTERS.some(([k]) => k === f) ? f : 'hausse';
    if (nf !== filtre) { filtre = nf; shown = PAGE; }
    const need = col.all().length && [...col.ownedBySet().keys()].some(s => !prices.has(s));
    if (need && !box.dataset.built) {
      // premier affichage : squelette pendant le chargement des cotes
      setHTML(box, html`<div class="summary mk-sum" data-content aria-busy="true"><span class="hero"><span class="sk mk-sk-hero"></span></span><span class="meta"><span class="sk mk-sk-line"></span></span></div><div class="group">${Array.from({ length: 6 }, () => html`<span class="row sk-row"><span class="sk-a"></span><span class="body"><span class="sk-t"></span><span class="sk-s"></span></span></span>`)}</div>`);
    }
    if (need) await ensure(r.signal);
    if (r.signal.aborted) return;
    render();
    if (need) errRow();                 // ligne d'erreur éventuelle (après le rendu)
  },
  resume() { visible = true; if (dirty) render(); },
  hide() { visible = false; },
  onChange(events, isVisible) {
    if (!events.some(e => e.type === 'qty' || e.type === 'reload')) return;
    if (isVisible) schedule(); else dirty = true;
  },
  info: () => ({
    title: 'Cotes',
    body: ['La valeur additionne la cote Cardmarket (tendance) de chaque version que tu possèdes.',
      'La variation compare la moyenne des ventes des 7 derniers jours à celle des 30 derniers jours, pour chaque carte et chaque version de ta collection.',
      'Prix toutes éditions : Cardmarket ne vend pas cette 1re édition ou cette version tamponnée à part. La cote est celle de la carte de base : elle compte dans la valeur, pas dans les hausses et les baisses.',
      prices.creditText()],
  }),
};

// plusieurs changements de suite : un seul rendu
let raf = 0;
function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    if (!visible) { dirty = true; return; }
    const owned = [...col.ownedBySet().keys()];
    if (owned.some(s => !prices.has(s))) ensure().then(() => { if (visible) render(); });
    render();
  });
}
