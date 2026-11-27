// Séries (#/series) : recherche globale (cartes et séries, ?q=), puces Toutes · Les miennes · En cours (?filtre=),
// séries rangées par bloc (repliables, état gardé dans prefs.openBlocs), progression de chaque série.
import { setBar } from '../core/appbar.js';
import { html, raw, setHTML, delegate } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { num, plural, localNo } from '../core/format.js';
import { setParams } from '../core/router.js';
import { renderChunked, patchByKey } from '../core/list.js';
import { yieldToMain } from '../core/idle.js';
import { infoSheet } from '../core/sheet.js';
import { MESSAGES } from '../core/net.js';
import { setLogoHTML } from '../components/setlogo.js';
import { tileHTML, patchTile } from '../components/tile.js';
import * as catalog from '../data/catalog.js';
import * as col from '../state/collection.js';
import * as prefs from '../state/prefs.js';
import { setRowHTML, patchSetRow, progressOf } from './setrow.js';

const FILTERS = [['', 'Toutes'], ['miennes', 'Les miennes'], ['en-cours', 'En cours']];
const okFiltre = v => (v === 'miennes' || v === 'en-cours' ? v : '');
const STEP = 120;          // cartes par page de résultats (« Afficher plus »)
const DEBOUNCE = 160;      // ms entre la frappe et la recherche

let el = null, listEl = null, resEl = null, chipsEl = null, input = null, statusEl = null;
let all = null;            // catalog.sets() : { blocs, sets, byId }
let q = '', filtre = '';
let timer = 0, seq = 0, limit = STEP, shown = 0;
let listDirty = true;      // la liste des blocs est à refaire (collection rechargée, filtre changé…)
let resDirty = false;      // les résultats de recherche sont à refaire
let listed = new Set();    // séries de la liste affichée (avec un filtre : une série peut y entrer ou en sortir)

// ---------- liste par blocs ----------

// blocs ouverts : ceux gardés dans les préférences, sinon le premier et ceux où j'ai des cartes
function openBlocs() {
  const saved = prefs.get('openBlocs', null);
  if (Array.isArray(saved)) return new Set(saved);
  const owned = col.ownedBySet();
  const s = new Set(all.blocs[0] ? [all.blocs[0].id] : []);
  for (const b of all.blocs) if (b.sets.some(m => owned.has(m.id))) s.add(b.id);
  return s;
}

// une série passe-t-elle le filtre ? (« En cours » : commencée, pas complète)
function keep(p) {
  if (!filtre) return true;
  const any = p.owned + p.secret > 0;
  return filtre === 'miennes' ? any : any && !p.done;
}

const rowsOf = b => {
  const out = [];
  for (const m of b.sets) { const p = progressOf(m); if (keep(p)) out.push([m, p]); }
  return out;
};

// « 11 séries · 4 de tes cartes » (cartes différentes possédées dans tout le bloc)
function blocMeta(b, n) {
  let cards = 0;
  for (const m of b.sets) cards += col.inSet(m.id).length;
  return [plural(n, 'série', 'séries'), cards ? `${num(cards)} de tes cartes` : ''].filter(Boolean).join(' · ');
}

function blocHTML({ b, rows, open }) {
  const year = b.first ? b.first.slice(0, 4) : '';
  return html`<section class="bloc" data-bloc="${b.id}" data-n="${rows.length}"><button type="button" class="blochead" aria-expanded="${open ? 'true' : 'false'}" aria-controls="bloc-${b.id}">${
    b.logo ? setLogoHTML({ id: b.id, logo: b.logo, code: b.id, dark: b.dark }, { size: 'bloc' }) : ''}<span class="grow"><span class="bn">${b.name}${year ? ` · ${year}` : ''}</span><span class="bm">${blocMeta(b, rows.length)}</span></span>${
    icon('chevron-up')}</button><div class="group" id="bloc-${b.id}"${open ? '' : raw(' hidden')}>${open ? rows.map(([m, p]) => setRowHTML(m, p)) : ''}</div></section>`;
}

const emptyList = () => (filtre === 'miennes'
  ? html`<div class="empty" data-content><span class="ic">${icon('collection')}</span><b>Aucune série pour l’instant</b><p>Ajoute une carte depuis le scanner ou depuis une série : sa série apparaîtra ici.</p><a class="btn" href="#/scanner">Scanner une carte</a></div>`
  : html`<div class="empty" data-content><span class="ic">${icon('series')}</span><b>Aucune série en cours</b><p>Les séries commencées mais pas encore complètes apparaissent ici.</p></div>`);

function renderList({ sync = false } = {}) {
  listDirty = false;
  updateChips();
  const open = openBlocs();
  const blocs = [];
  listed = new Set();
  for (const b of all.blocs) {
    const rows = rowsOf(b);
    for (const [m] of rows) listed.add(m.id);
    if (rows.length) blocs.push({ b, rows, open: !!filtre || open.has(b.id) });
  }
  if (!blocs.length) { setHTML(listEl, emptyList()); return Promise.resolve(true); }
  // les deux premiers blocs tout de suite, le reste par lots qui rendent la main
  return renderChunked(listEl, blocs, blocHTML, { first: sync ? blocs.length : 2, batch: 3 });
}

const topOffset = () => document.getElementById('appbar')?.getBoundingClientRect().bottom || 0;

function fillBloc(sec) {
  const grp = sec.querySelector('.group');
  const b = all.blocs.find(x => x.id === sec.dataset.bloc);
  if (b && !grp.childElementCount) setHTML(grp, html`${rowsOf(b).map(([m, p]) => setRowHTML(m, p))}`);
}

function setOpen(sec, on) {
  const btn = sec.querySelector('.blochead'), grp = sec.querySelector('.group');
  if (on) fillBloc(sec);
  btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  grp.hidden = !on;
}

function saveOpen(id, on) {
  const s = openBlocs();
  if (on) s.add(id); else s.delete(id);
  prefs.set('openBlocs', [...s]);
}

function toggleBloc(btn) {
  const sec = btn.closest('.bloc');
  const on = btn.getAttribute('aria-expanded') !== 'true';
  // en-tête collé sous la barre : après repli, la page revient au début du bloc (pas de saut dans le vide)
  const top = topOffset();
  const stuck = !on && sec.getBoundingClientRect().top < top - 1;
  setOpen(sec, on);
  if (!filtre) saveOpen(sec.dataset.bloc, on);
  if (stuck) scrollTo(0, Math.max(0, sec.getBoundingClientRect().top + scrollY - top));
}

// menu ⋯ : tout déplier / tout replier (lignes remplies bloc par bloc, sans longue tâche)
async function expandAll(on) {
  prefs.set('openBlocs', on ? all.blocs.map(b => b.id) : []);
  if (q) { listDirty = true; return; }
  for (const sec of listEl.querySelectorAll('.bloc')) {
    setOpen(sec, on);
    if (on) await yieldToMain();
  }
}

// ---------- puces ----------
function updateChips() {
  let mine = 0, going = 0;
  for (const m of all?.sets || []) {
    const p = progressOf(m);
    if (p.owned + p.secret) { mine++; if (!p.done) going++; }
  }
  const n = { '': 0, miennes: mine, 'en-cours': going };
  for (const b of chipsEl.querySelectorAll('[data-f]')) {
    b.setAttribute('aria-pressed', String(b.dataset.f === filtre));
    const c = b.querySelector('.n');
    if (c) { c.textContent = n[b.dataset.f] ? num(n[b.dataset.f]) : ''; c.hidden = !n[b.dataset.f]; }
  }
}

// ---------- recherche ----------
const hintHTML = () => html`<div class="empty" data-content><span class="ic">${icon('search')}</span><b>Tape au moins 2 lettres</b><p>Un nom, un numéro (025/165), un code et un numéro (MEW 25), ou #25 pour un Pokémon.</p></div>`;
const skelHTML = () => raw(`<div class="sect"><span class="sk sk-h"></span></div><div class="grid" aria-busy="true" aria-label="Recherche en cours">${'<span class="sk-tile"><span class="sk-img"></span><span class="sk-l1"></span><span class="sk-l2"></span></span>'.repeat(6)}</div>`);
const errHTML = (e, what) => html`<div class="errrow" data-content>${icon('wifi-off')}<span class="grow">${MESSAGES[e?.kind] || what}</span><button type="button" class="btn text" data-retry>Réessayer</button></div>`;
// légende « 025 · 151 » : le numéro d'abord, il reste lisible quand le nom de la série est coupé
const tileOf = c => tileHTML(c, { qty: col.qtyOf(c.id), meta: [localNo(c.localId), c.setName].filter(Boolean).join(' · ') });
const moreHTML = res => (res.count > res.cards.length
  ? html`<div class="ser-more"><button type="button" class="btn" data-more>Afficher plus</button><span class="caption">${num(res.cards.length)} sur ${num(res.count)}</span></div>`
  : '');

async function renderResults(res, text, more, my) {
  const grid = resEl.querySelector('#ser-cards');
  if (more && grid) {                                   // « Afficher plus » : la suite est ajoutée par lots
    const add = res.cards.slice(shown);
    shown = res.cards.length;
    resEl.querySelector('.ser-more')?.remove();
    grid.insertAdjacentHTML('afterend', String(moreHTML(res)));
    for (let i = 0; i < add.length; i += 48) {
      if (i) await yieldToMain();
      if (my !== seq) return;
      grid.insertAdjacentHTML('beforeend', add.slice(i, i + 48).map(c => String(tileOf(c))).join(''));
    }
    return;
  }
  const parts = [];
  if (res.sets.length) parts.push(html`<h2 class="sect">Séries · ${num(res.sets.length)}</h2><div class="group">${res.sets.map(m => setRowHTML(m))}</div>`);
  if (res.cards.length) parts.push(html`<h2 class="sect">Cartes · ${num(res.count)}</h2><div class="grid" id="ser-cards"></div>${moreHTML(res)}`);
  if (!parts.length) {
    parts.push(filtre
      ? html`<div class="empty" data-content><span class="ic">${icon('search')}</span><b>Aucun résultat</b><p>Rien pour « ${text} » ${filtre === 'miennes' ? 'dans tes cartes' : 'dans tes séries en cours'}.</p><button type="button" class="btn" data-f="">Chercher dans toutes les séries</button></div>`
      : html`<div class="empty" data-content><span class="ic">${icon('search')}</span><b>Aucun résultat</b><p>Rien pour « ${text} ». Essaie un autre nom, ou un numéro comme 025/165.</p></div>`);
  }
  setHTML(resEl, html`${parts}`);
  shown = res.cards.length;
  // annoncé aux lecteurs d'écran (la liste elle-même n'est pas une région vivante)
  statusEl.textContent = res.count || res.sets.length
    ? [res.sets.length ? plural(res.sets.length, 'série', 'séries') : '', res.count ? plural(res.count, 'carte', 'cartes') : ''].filter(Boolean).join(', ')
    : 'Aucun résultat';
  const g = resEl.querySelector('#ser-cards');
  if (g) await renderChunked(g, res.cards, tileOf, { first: 24, batch: 48 });
}

async function runSearch({ more = false } = {}) {
  const my = ++seq, text = q;
  resDirty = false;
  if (text.length < 2 && !/^\d+$/.test(text)) { setHTML(resEl, hintHTML()); return; }
  // rien d'affiché : squelette (premier chargement de l'index) ; sinon les anciens résultats restent jusqu'aux nouveaux
  if (!more && !resEl.querySelector('#ser-cards, .group')) setHTML(resEl, skelHTML());
  let res;
  try { res = await catalog.search(text, { limit: filtre ? 1e6 : limit }); } catch (e) {
    if (my === seq) setHTML(resEl, errHTML(e, 'Recherche indisponible'));
    return;
  }
  if (my !== seq) return;
  await renderResults(filtre ? filterRes(res) : res, text, more, my);
}

// puces pendant une recherche : « Les miennes » = mes cartes et mes séries ; « En cours » = les séries commencées
// et pas complètes, avec leurs cartes
function filterRes(res) {
  const okSet = id => { const m = all.byId.get(id); return !!m && keep(progressOf(m)); };
  const cards = res.cards.filter(c => (filtre === 'miennes' ? col.has(c.id) : okSet(c.setId)));
  return { sets: res.sets.filter(m => keep(progressOf(m))), cards: cards.slice(0, limit), count: cards.length };
}

function setQuery(v) {
  clearTimeout(timer);
  if (v === q && !resDirty) return null;
  q = v;
  limit = STEP;
  setParams({ q: q || null });
  return applyMode();
}

function applyMode() {
  const searching = !!q;
  listEl.hidden = searching;
  resEl.hidden = !searching;
  if (searching) return runSearch();
  seq++;                                                // une recherche en cours ne s'affichera plus
  setHTML(resEl, '');
  return listDirty ? renderList({ sync: true }) : null;
}

// ---------- vue ----------
function about() {
  infoSheet('Séries', [
    'Les séries sont rangées par bloc, la plus récente en haut. Touche un bloc pour le replier : Cardex s’en souvient.',
    'La barre compte les cartes différentes que tu possèdes, sur le nombre imprimé sur la série. Les cartes secrètes (numérotées au-delà) sont comptées à part, sur la page de la série.',
    'En cours : les séries commencées mais pas encore complètes.',
    'La recherche trouve les cartes et les séries : un nom (dracaufeu), un numéro (025/165 ou 25), un code de série et un numéro (MEW 25), ou un numéro de Pokédex (#25).',
  ]);
}

function refresh() {
  if (!all) return load();
  if (q) { updateChips(); return runSearch(); }
  return renderList({ sync: true });
}

async function load(signal) {
  try { all = await catalog.sets(); } catch (e) {
    if (!signal?.aborted) { listEl.hidden = false; resEl.hidden = true; setHTML(listEl, errHTML(e, 'Séries indisponibles')); }
    return false;
  }
  if (signal?.aborted) return false;
  listEl.hidden = !!q;
  resEl.hidden = !q;
  updateChips();
  if (q) await runSearch(); else await renderList();
  return true;
}

export default {
  mount(section) {
    el = section;
    el.innerHTML = String(html`
      <div class="searchbar"><label class="search">${icon('search')}<input type="search" name="q" placeholder="Rechercher une carte ou une série" aria-label="Rechercher une carte ou une série" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><button type="button" class="search-clear" aria-label="Effacer la recherche">${icon('close')}</button></label></div>
      <div class="chips ser-chips" role="group" aria-label="Filtrer les séries">${FILTERS.map(([v, t]) => html`<button type="button" class="chip" data-f="${v}" aria-pressed="false">${t}${v ? html` <span class="n" hidden></span>` : ''}</button>`)}</div>
      <div class="ser-list"><div class="group sk-list" aria-busy="true" aria-label="Chargement">${raw('<span class="row sk-row"><span class="sk-a"></span><span class="body"><span class="sk-t"></span><span class="sk-s"></span></span></span>'.repeat(8))}</div></div>
      <div class="ser-res" hidden></div><div class="pad"><p class="sr" role="status" aria-live="polite"></p></div>`);
    listEl = el.querySelector('.ser-list');
    resEl = el.querySelector('.ser-res');
    chipsEl = el.querySelector('.ser-chips');
    statusEl = el.querySelector('[role="status"]');
    input = el.querySelector('input[name="q"]');
    delegate(el, 'input', 'input[name="q"]', () => {
      clearTimeout(timer);
      const v = input.value.trim();
      timer = setTimeout(() => setQuery(v), v ? DEBOUNCE : 0);
    });
    delegate(el, 'keydown', 'input[name="q"]', e => {
      if (e.key === 'Enter') { setQuery(input.value.trim()); input.blur(); }   // le clavier du téléphone se ferme
    });
    delegate(el, 'click', '[data-f]', (e, b) => {
      const v = okFiltre(b.dataset.f);
      if (v === filtre) return;
      filtre = v;
      setParams({ filtre: filtre || null });
      if (q) { updateChips(); limit = STEP; listDirty = true; runSearch(); } else renderList({ sync: true });
    });
    delegate(el, 'click', '.blochead', (e, b) => toggleBloc(b));
    delegate(el, 'click', '[data-retry]', () => refresh());
    delegate(el, 'click', '[data-more]', (e, b) => { b.disabled = true; limit += STEP; runSearch({ more: true }); });
    // séries découvertes en direct (sortie récente absente des fichiers) : la liste est refaite
    catalog.onUpdate(s => {
      all = s;
      listDirty = true;
      if (el.hidden) return;
      if (q) updateChips(); else renderList({ sync: true });
    });
  },

  async show(r) {
    const { signal } = r;
    setBar({
      title: 'Séries', signal,
      menu: [
        { icon: 'info', label: 'À propos de cet écran', onClick: about },
        { icon: 'chevron-down', label: 'Déplier tous les blocs', onClick: () => expandAll(true) },
        { icon: 'chevron-up', label: 'Replier tous les blocs', onClick: () => expandAll(false) },
      ],
    });
    clearTimeout(timer);
    const nq = (r.q.get('q') || '').trim(), nf = okFiltre(r.q.get('filtre'));
    if (nf !== filtre) listDirty = true;
    if (nq !== q) resDirty = true;
    q = nq;
    filtre = nf;
    limit = STEP;
    if (input.value.trim() !== q) input.value = q;
    catalog.warmIndex();                                  // la première frappe ne paie plus l'index des cartes
    if (!all) { await load(signal); return; }
    listEl.hidden = !!q;
    resEl.hidden = !q;
    if (q) { updateChips(); if (resDirty || !resEl.childElementCount) await runSearch(); }
    else {
      seq++;
      if (listDirty || !listEl.querySelector('.bloc, .empty')) await renderList(); else updateChips();
    }
  },

  // retour depuis le cache : puces toujours recomptées ; liste ou résultats refaits s'ils sont périmés
  resume() {
    if (!all) return;
    if (!q && listDirty) { renderList({ sync: true }); return; }   // renderList recompte aussi les puces
    updateChips();
    if (q && resDirty) runSearch();
  },

  hide() { clearTimeout(timer); },

  // quantité : tuiles des résultats corrigées en place ; carte ajoutée ou retirée : ligne de sa série et puces.
  // Avec un filtre, une série (ou une carte) peut entrer dans la liste ou en sortir : liste ou résultats refaits,
  // tout de suite si la vue est affichée, sinon à son retour (resume).
  onChange(events) {
    if (!el || !all) return;
    if (events.some(e => e.type === 'reload')) {
      listDirty = true;
      resDirty = true;
      if (!el.hidden) refresh();
      return;
    }
    const sets = new Set();
    for (const e of events) {
      if (e.type !== 'qty') continue;
      patchByKey(resEl, e.id, t => patchTile(t, { qty: col.qtyOf(e.id) }));
      if (e.added || e.removed) sets.add(catalog.setIdOf(e.id));
    }
    if (!sets.size) return;
    if (filtre) {
      resDirty = true;
      for (const id of sets) {
        const m = all.byId.get(id);
        if (m && keep(progressOf(m)) !== listed.has(id)) listDirty = true;
      }
    }
    for (const id of sets) {
      const m = all.byId.get(id);
      if (!m) continue;
      for (const a of el.querySelectorAll(`.setrow[data-set="${CSS.escape(id)}"]`)) patchSetRow(a, m);
      const sec = listEl.querySelector(`.bloc[data-bloc="${CSS.escape(m.bloc)}"]`);
      const b = all.blocs.find(x => x.id === m.bloc);
      if (sec && b) sec.querySelector('.bm').textContent = blocMeta(b, +sec.dataset.n || 0);
    }
    updateChips();
    if (el.hidden || !filtre) return;
    if (q) runSearch();
    else if (listDirty) renderList({ sync: true });
  },
};
