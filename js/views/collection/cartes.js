// Collection › Cartes (W-I) : rappel de sauvegarde, en-tête de synthèse (valeur, variation sur 30 jours, courbe ;
// appui = feuille « Évolution de la valeur »), filtre par nom ou série (entonnoir de la barre), une rangée de puces
// (tri + finitions avec leurs nombres), une tuile par carte et par finition (comme l'ancienne grille).
// Collection modifiée : tuiles corrigées, retirées ou insérées à leur place ; la grille n'est jamais refaite pour ça.
import { html, setHTML, selectChip, delegate } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { eur, num, plural, norm, localNo } from '../../core/format.js';
import { setParams } from '../../core/router.js';
import { whenIdle, yieldToMain } from '../../core/idle.js';
import { tileHTML, patchTile } from '../../components/tile.js';
import * as col from '../../state/collection.js';
import * as prefs from '../../state/prefs.js';
import * as prices from '../../data/prices.js';
import { FINISHES, SHORT, DOT, order } from '../../data/finishes.js';
import { dexNums, pokedex } from '../../data/dex.js';
import { sets as catalogSets, metaSync, setIdOf } from '../../data/catalog.js';
import { tileSel, insertAt, tilePrice, CHUNK, fill, renderGrid as paint } from './grid.js';
import * as backup from './backup.js';

const SORTS = [['recentes', 'Récentes'], ['nom', 'Nom'], ['pokedex', 'N° Pokédex'], ['serie', 'Série'], ['valeur', 'Valeur']];
const SORT_KEYS = new Set(SORTS.map(s => s[0]));
const keySel = k => { const i = k.lastIndexOf('|'); return tileSel(k.slice(0, i), k.slice(i + 1)); };
const numOf = l => { const n = parseInt(l, 10); return Number.isFinite(n) ? n : 1e6; };
const setRank = id => metaSync(id)?.order ?? 1e4;          // séries les plus récentes d'abord
// courbe, variation et feuille de la valeur : chargées avec les cotes, hors du premier écran
let sh = null, shP = null;
const shared = () => (shP ??= import('./shared.js').then(m => (sh = m)));
const cmpT = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };

// clés de tri (tableaux comparés dans l'ordre) ; le prix : celui de la version (unité), les non cotées à la fin
const KEYS = {
  recentes: e => [-e.r.addedAt, order(e.f)],
  nom: e => [norm(e.r.name), setRank(e.r.setId), numOf(e.r.localId), order(e.f)],
  pokedex: e => [dexNums(e.r)[0] ?? 1e5, norm(e.r.name), setRank(e.r.setId), numOf(e.r.localId), order(e.f)],
  serie: e => [setRank(e.r.setId), numOf(e.r.localId), e.r.localId, order(e.f)],
  valeur: e => [-(prices.eur(e.r.id, e.f) ?? -1), norm(e.r.name), order(e.f)],
};

export function create(box, api) {
  box.innerHTML = `<div class="col-remind" role="status" hidden></div>
    <button type="button" class="summary col-sum" hidden></button>
    <div class="searchbar col-filter" hidden><label class="search">${icon('filter')}<input type="search" name="cq" placeholder="Filtrer par nom ou série" aria-label="Filtrer mes cartes par nom ou série" autocomplete="off" enterkeyhint="search"><button type="button" class="search-clear" aria-label="Effacer le filtre">${icon('close')}</button></label></div>
    <div class="chips col-chips" role="group" aria-label="Tri et finitions" hidden></div>
    <div class="grid col-grid"></div>`;
  const els = {
    remind: box.querySelector('.col-remind'), sum: box.querySelector('.col-sum'), filter: box.querySelector('.col-filter'),
    input: box.querySelector('input[name="cq"]'), chips: box.querySelector('.col-chips'), grid: box.querySelector('.col-grid'),
  };
  let st = { q: '', tri: 'recentes', fin: '' };
  let keys = [], rendered = false, dirty = false, busy = false, pricesTried = false, lastKey = '', filterOpen = false;
  let qT = 0, patchSeq = 0, idleStarted = false;
  const hay = new WeakMap();                                // enregistrement -> texte de recherche
  const keyOf = s => `${s.q}|${s.tri}|${s.fin}`;

  // ---------- données ----------
  function entries() {
    const out = [];
    for (const r of col.all()) for (const f of FINISHES) if (r.qty[f]) out.push({ r, f, k: `${r.id}|${f}` });
    return out;
  }
  const toks = () => norm(st.q).split(' ').filter(Boolean);
  function match(e, t) {
    if (st.fin && e.f !== st.fin) return false;
    if (!t.length) return true;
    let h = hay.get(e.r);
    if (h === undefined) { h = norm(`${e.r.name} ${e.r.setName} ${localNo(e.r.localId)} ${e.r.setId}`); hay.set(e.r, h); }
    return t.every(x => h.includes(x));
  }
  function sortList(list) {
    const kf = KEYS[st.tri] || KEYS.recentes;
    for (const e of list) e.s = kf(e);
    return list.sort((a, b) => cmpT(a.s, b.s));
  }
  function counts() {
    const m = new Map();
    let total = 0;
    for (const r of col.all()) for (const f in r.qty) { m.set(f, (m.get(f) || 0) + r.qty[f]); total += r.qty[f]; }
    return { m, total };
  }
  // ce dont un tri a besoin : séries (ordre), Pokédex (numéros devinés), cotes (au plus 1,5 s d'attente)
  function needs(tri) {
    if (tri === 'serie' || tri === 'nom' || tri === 'pokedex') {
      return Promise.all([catalogSets().catch(() => null), tri === 'pokedex' ? pokedex().catch(() => null) : null]);
    }
    if (tri === 'valeur') return Promise.race([col.ensurePrices(), new Promise(r => setTimeout(r, 1500))]);
    return null;
  }

  // ---------- rendu ----------
  function renderRemind() {
    const t = backup.reminder();
    els.remind.hidden = !t;
    if (t) {
      setHTML(els.remind, html`${icon('alert')}<span class="grow">${t}</span><button type="button" class="btn text sm" data-act="export">Exporter</button><button type="button" class="ibtn sm" data-act="snooze" aria-label="Me le rappeler plus tard">${icon('close')}</button>`);
    }
  }

  function renderSummary() {
    const s = col.stats();
    els.sum.hidden = !s.total;
    if (!s.total) return;
    const ready = !s.pending || pricesTried;
    setHTML(els.sum, html`<span class="hero num">${ready ? eur(s.value) : html`<span class="sk col-sk-hero"></span>`}</span>${
      ready && sh ? sh.sparkHTML(s.value) : ''}<span class="meta">${ready && sh ? sh.deltaLine(s.value) : html`<span class="sk col-sk-line"></span>`}</span><span class="meta full">${
      plural(s.total, 'carte', 'cartes')} · ${plural(s.unique, 'différente', 'différentes')} · ${plural(s.sets, 'série', 'séries')}${
      ready && s.pending ? ' · cotes incomplètes' : ''}</span><span class="sr">, voir l’évolution de la valeur</span>`);
  }

  function finChip(f, n) {
    return html`<button type="button" class="chip" data-fin="${f}" aria-pressed="${st.fin === f ? 'true' : 'false'}">${
      f ? html`<i class="${DOT[f]}"></i>${SHORT[f]}` : 'Toutes'} <span class="n">${num(n)}</span></button>`;
  }
  function renderChips() {
    const { m, total } = counts();
    els.chips.hidden = !total;
    const fins = FINISHES.filter(f => m.get(f));
    els.chips.dataset.fins = fins.join(' ');
    setHTML(els.chips, html`${selectChip({ label: 'Trier', options: SORTS, value: st.tri, name: 'tri' })}${
      fins.length > 1 || st.fin ? [finChip('', total), ...fins.map(f => finChip(f, m.get(f)))] : ''}`);
  }
  // nombres des puces corrigés en place ; la rangée n'est refaite que si une finition apparaît ou disparaît
  function patchChips() {
    const { m, total } = counts();
    const fins = FINISHES.filter(f => m.get(f));
    if (fins.join(' ') !== els.chips.dataset.fins || !total) return renderChips();
    for (const b of els.chips.querySelectorAll('[data-fin]')) {
      const n = b.dataset.fin ? m.get(b.dataset.fin) : total;
      const span = b.querySelector('.n');
      if (span) span.textContent = num(n);
    }
  }

  const EMPTY = () => html`<div class="empty" data-content><span class="ic">${icon('collection')}</span><b>Ta collection est vide</b><p>Scanne une carte ou ouvre une série pour l’ajouter.</p><a class="btn primary" href="#/scanner">${icon('scan')}Scanner une carte</a><button type="button" class="btn text" data-act="import">Importer une sauvegarde</button></div>`;
  const NONE = () => html`<div class="empty" data-content><span class="ic">${icon('filter')}</span><b>Aucune carte</b><p>Rien ne correspond au filtre.</p><button type="button" class="btn" data-act="clear">Effacer le filtre</button></div>`;
  const tileTpl = e => tileHTML(e.r, { qty: col.qtyOf(e.r.id, e.f), finish: e.f, price: tilePrice(e.r.id, e.r.setId, e.f) });

  function renderGrid() {
    const all = entries();
    els.grid.classList.toggle('compact', !!prefs.get('compact', false));
    if (!all.length) { keys = []; busy = false; return fill(els.grid, EMPTY()); }
    const t = toks();
    const list = sortList(all.filter(e => match(e, t)));
    keys = list.map(e => e.k);
    busy = true;
    const p = paint(els.grid, list, tileTpl, { ...CHUNK, empty: NONE() });
    p.then(ok => { if (ok) busy = false; });
    return p;
  }

  function syncFilter() {
    const any = col.all().length > 0;
    els.filter.hidden = !(filterOpen && any);
    if (els.input.value.trim() !== st.q) els.input.value = st.q;
    api.pressFilter(filterOpen && any, any);
  }

  function render() {
    dirty = false;
    rendered = true;
    dropQueue();                                             // corrections en attente : comprises dans ce rendu
    renderRemind();
    renderSummary();
    renderChips();
    syncFilter();
    return renderGrid();
  }

  // ---------- interactions ----------
  const go = () => { lastKey = keyOf(st); };
  function toggleFilter(force) {
    filterOpen = force ?? !filterOpen;
    if (!filterOpen && st.q) {
      st.q = '';
      go();
      setParams({ q: null });
      renderGrid();
    }
    syncFilter();
    if (filterOpen) els.input.focus({ preventScroll: true });
  }
  // après un tri ou un filtre : la liste repart de son début (la rangée de puces en haut de l'écran)
  function toListTop() {
    const tabsEl = box.closest('.view')?.querySelector('.ptabs');
    const top = els.chips.getBoundingClientRect().top + scrollY - (tabsEl ? tabsEl.getBoundingClientRect().bottom : 100);
    if (scrollY > top + 8) scrollTo(0, Math.max(0, top));
  }

  delegate(box, 'input', 'input[name="cq"]', (e, inp) => {
    clearTimeout(qT);
    qT = setTimeout(() => {
      const v = inp.value.trim();
      if (v === st.q || !api.shown()) return;                 // écran quitté entre-temps : l'adresse n'est plus la nôtre
      st.q = v; go();
      setParams({ q: v || null });
      renderGrid();
    }, 150);
  });
  delegate(box, 'keydown', 'input[name="cq"]', (e, inp) => {
    if (e.key === 'Enter') inp.blur();
    else if (e.key === 'Escape' && !inp.value) toggleFilter(false);
  });
  delegate(box, 'change', 'select[name="tri"]', async (e, s) => {
    if (!SORT_KEYS.has(s.value) || s.value === st.tri) return;
    st.tri = s.value; go();
    setParams({ tri: st.tri === 'recentes' ? null : st.tri });
    const wait = needs(st.tri);
    if (wait) { api.progress(true); await wait; api.progress(false); }
    renderGrid();
    toListTop();
  });
  delegate(box, 'click', '[data-fin]', (e, b) => {
    const f = b.dataset.fin || '';
    if (f === st.fin) return;
    st.fin = f; go();
    setParams({ finition: f || null });
    for (const c of els.chips.querySelectorAll('[data-fin]')) c.setAttribute('aria-pressed', c.dataset.fin === f ? 'true' : 'false');
    renderGrid();
    toListTop();
  });
  delegate(box, 'click', '[data-act]', (e, b) => {
    const a = b.dataset.act;
    if (a === 'clear') {
      st.q = ''; st.fin = ''; go();
      setParams({ q: null, finition: null });
      filterOpen = false;
      renderChips(); syncFilter(); renderGrid();
    } else if (a === 'import') {
      backup.pickFile();                                      // la collection importée arrive par onChange ('reload')
    } else if (a === 'export') {
      if (backup.exportNow()) renderRemind();
    } else if (a === 'snooze') {
      backup.snooze();
      renderRemind();
    }
  });
  els.sum.addEventListener('click', () => shared().then(m => m.openValueSheet()));
  addEventListener('cardex:export', () => { if (rendered) renderRemind(); });
  prefs.on(k => {
    if (k === 'compact') els.grid.classList.toggle('compact', !!prefs.get('compact', false));
    if ((k === 'backupReminder' || k === 'lastBackupReminder') && rendered) renderRemind();
  });

  // ---------- changements ----------
  function insertEntry(id, f) {
    const r = col.get(id);
    if (!r) return;
    const t = toks();
    const e = { r, f, k: `${id}|${f}` };
    if (!match(e, t)) return;
    const ks = sortList(entries().filter(x => match(x, t))).map(x => x.k);
    const i = ks.indexOf(e.k);
    if (i < 0) return;
    insertAt(els.grid, ks, i, String(tileTpl(e)), keySel);
    keys = ks;
  }

  // Vue cachée (« + » sur une fiche ou une coche de série) : la grille est corrigée juste après, hors de l'image de
  // l'appui (insérer une tuile trie toute la collection : plusieurs ms avec 2 000 cartes à CPU ×4). Le retour sur
  // l'écran (resume) applique ce qui attend.
  let queue = [], flushT = 0;
  function dropQueue() { queue = []; clearTimeout(flushT); flushT = 0; }
  function flush() {
    clearTimeout(flushT);
    flushT = 0;
    const evs = queue;
    queue = [];
    if (evs.length) apply(evs);
  }
  function onChange(evs, current) {
    if (!rendered) return;
    if (!current) { dirty = true; return; }
    if (!api.shown()) {
      queue.push(...evs);
      if (!flushT) flushT = setTimeout(flush, 120);
      return;
    }
    if (queue.length) { queue.push(...evs); flush(); return; }
    apply(evs);
  }
  function apply(evs) {
    const reload = evs.some(e => e.type === 'reload');
    const qty = evs.filter(e => e.type === 'qty');
    if (!reload && !qty.length) return;
    // grille en cours de rendu, vide ou import : refaite (tout de suite si elle est à l'écran, sinon à son retour)
    if (reload || busy || !keys.length || !col.all().length) {
      if (api.shown()) render(); else dirty = true;
      return;
    }
    for (const e of qty) {
      const t = els.grid.querySelector(tileSel(e.id, e.finish));
      if (e.after > 0) {
        if (t) patchTile(t, { qty: e.after });
        else if (e.before === 0) insertEntry(e.id, e.finish);
      } else if (t) {
        t.remove();
        const k = `${e.id}|${e.finish}`;
        keys = keys.filter(x => x !== k);
      }
    }
    if (!keys.length) renderGrid();                          // dernière tuile du filtre retirée : état vide
    if (qty.some(e => e.added)) col.ensurePrices();          // carte d'une nouvelle série : ses cotes, puis onPrices
    patchChips();
    renderSummary();
  }

  // cotes arrivées : en-tête et prix des tuiles de ces séries, par lots (2 000 tuiles sans longue tâche)
  async function onPrices(ids) {
    if (!rendered) return;
    renderSummary();
    if (st.tri === 'valeur') { if (api.shown()) renderGrid(); else dirty = true; return; }
    const set = new Set(ids);
    const my = ++patchSeq;
    const tiles = els.grid.querySelectorAll('.tile[data-card]');
    for (let i = 0; i < tiles.length; i++) {
      if (i && i % 250 === 0) { await yieldToMain(); if (my !== patchSeq) return; }
      const t = tiles[i], id = t.dataset.card, s = setIdOf(id);
      if (set.has(s) && t.isConnected) patchTile(t, { price: tilePrice(id, s, t.dataset.finish) });
    }
  }

  // ---------- affichage ----------
  async function show(q) {
    const next = {
      q: (q.get('q') || '').trim().slice(0, 80),
      tri: SORT_KEYS.has(q.get('tri')) ? q.get('tri') : 'recentes',
      fin: FINISHES.includes(q.get('finition')) ? q.get('finition') : '',
    };
    // filtre ouvert par l'adresse ; une autre adresse sans filtre le referme (l'adresse fait foi)
    if (next.q) filterOpen = true;
    else if (keyOf(next) !== lastKey) filterOpen = false;
    if (rendered && !dirty && keyOf(next) === lastKey) { renderRemind(); syncFilter(); return; }
    st = next; go();
    await needs(st.tri);
    // premier lot (18 tuiles), en-tête et puces posés : show() se termine, les lots suivants continuent à chaque image
    // (main.js attend show() pour ses tâches de fond, dont le service worker)
    render();
    if (!idleStarted) {
      idleStarted = true;
      whenIdle(() => {
        // historique de la valeur : nouveau point du jour -> courbe et variation à jour
        shared().then(m => { m.onHistory(() => { if (rendered && !dirty) renderSummary(); }); renderSummary(); });
        col.ensurePrices().then(() => { pricesTried = true; renderSummary(); });
      }, { timeout: 1500 });
    }
  }

  function resume() {
    if (dirty) render();
    else { flush(); renderRemind(); syncFilter(); }
  }

  return { show, resume, onChange, onPrices, toggleFilter, get filterOpen() { return filterOpen; } };
}
