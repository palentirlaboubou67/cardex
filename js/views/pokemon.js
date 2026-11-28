// Page d'un Pokémon (#/pokemon/:n, W-M) : illustration, deux progressions (cartes différentes, versions normales et
// brillantes), puces Toutes · Possédées · Manquantes (paramètre filtre), une tuile par version, les possédées d'abord.
// Cartes : index du catalogue (numéros TCGdex + ceux devinés d'après le nom pour les séries sans numéro, comme
// Méga-Évolution), plus les cartes de la collection rattachées à ce Pokémon. Finitions : fichiers des séries, chargés
// en arrière-plan (au-delà de 0,7 s, une tuile par carte d'abord, puis les versions).
import { setBar } from '../core/appbar.js';
import { html, setHTML, delegate } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { num } from '../core/format.js';
import { setParams } from '../core/router.js';
import { MESSAGES } from '../core/net.js';
import { tileHTML, patchTile } from '../components/tile.js';
import * as catalog from '../data/catalog.js';
import { pokedex, nameOf, count as dexCount, artwork, dexNums } from '../data/dex.js';
import { sortFinishes } from '../data/finishes.js';
import * as col from '../state/collection.js';
import * as prefs from '../state/prefs.js';
import { fill, renderGrid as paint, CHUNK } from './collection/grid.js';

const FILTERS = [['', 'Toutes'], ['possedees', 'Possédées'], ['manquantes', 'Manquantes']];
const FILTER_KEYS = new Set(FILTERS.map(f => f[0]));
const no4 = n => `#${String(n).padStart(4, '0')}`;
const tileSel = (id, f) => `.tile[data-card="${CSS.escape(id)}"][data-finish="${CSS.escape(f)}"]`;

let el = null, els = null, lastR = null;
let cur = { n: 0, cards: null, full: false, filtre: '' }, rendered = false, refilter = false, busy = false, token = 0;

function frame() {
  el.innerHTML = `<div class="poke-head"></div><div class="chips poke-chips" role="group" aria-label="Filtrer les versions"></div><div class="grid poke-grid"></div>`;
  els = { head: el.querySelector('.poke-head'), chips: el.querySelector('.poke-chips'), grid: el.querySelector('.poke-grid') };
}

// versions : une par finition connue de chaque carte (+ celles ajoutées à la main dans la collection)
function versionsOf(cards) {
  const out = [];
  for (const c of cards) {
    const rec = col.get(c.id);
    const known = c.finishes?.length ? c.finishes : (cur.full ? ['normal'] : []);
    const fins = sortFinishes([...known, ...Object.keys(rec?.qty || {})]);
    // finitions pas encore connues (fichier de la série en route) : la carte seule, avec ses versions possédées
    for (const f of fins.length ? fins : ['normal']) out.push({ c, f, k: `${c.id}|${f}` });
  }
  return out;
}

const qtyOf = v => col.qtyOf(v.c.id, v.f);
function counts(cards, vers) {
  let cOwn = 0;
  for (const c of cards) if (col.qtyOf(c.id)) cOwn++;
  let vOwn = 0;
  for (const v of vers) if (qtyOf(v)) vOwn++;
  return { cards: cards.length, cOwn, vers: vers.length, vOwn };
}

function progHTML(label, have, tot, pending) {
  const pc = tot ? (have / tot) * 100 : 0;
  const done = tot && have >= tot;
  return html`<div class="prog${done ? ' done' : ''}"><span class="lbl">${label}</span>${pending
    ? html`<span class="sk poke-sk"></span>`
    : html`<b class="num">${num(have)} / ${num(tot)}</b><span class="progress${done ? ' done' : ''}" aria-hidden="true"><i style="width:${pc.toFixed(2)}%"></i></span><span class="pc num">${pc > 0 && pc < 1 ? '< 1' : Math.floor(pc)} %</span>`}</div>`;
}

function renderHead(n, c) {
  setHTML(els.head, html`<span class="poke-art"><img src="${artwork(n)}" crossorigin="anonymous" decoding="async" width="160" height="160" alt=""></span>
    <div class="poke-progs">${progHTML('Cartes', c.cOwn, c.cards, false)}${progHTML('Versions', c.vOwn, c.vers, !cur.full)}</div>`);
}

function renderChips(c) {
  const n = { '': c.vers, possedees: c.vOwn, manquantes: c.vers - c.vOwn };
  setHTML(els.chips, html`${FILTERS.map(([k, l]) => html`<button type="button" class="chip" data-pf="${k}" aria-pressed="${cur.filtre === k ? 'true' : 'false'}">${l}${cur.full ? html` <span class="n">${num(n[k])}</span>` : ''}</button>`)}`);
}

const tpl = v => {
  const q = qtyOf(v);
  return tileHTML(v.c, { qty: q, finish: v.f, missing: !q });
};

function renderGrid() {
  const vers = versionsOf(cur.cards);
  // les possédées d'abord (ordre stable : séries les plus récentes, numéro, finition)
  const own = [], miss = [];
  for (const v of vers) (qtyOf(v) ? own : miss).push(v);
  const list = cur.filtre === 'possedees' ? own : cur.filtre === 'manquantes' ? miss : [...own, ...miss];
  refilter = false;
  els.grid.classList.toggle('compact', !!prefs.get('compact', false));
  busy = true;
  const p = paint(els.grid, list, tpl, {
    ...CHUNK,
    empty: html`<div class="empty" data-content><span class="ic">${icon('card')}</span><b>${cur.filtre === 'manquantes' ? 'Tu les as toutes' : cur.filtre === 'possedees' ? 'Pas encore' : 'Aucune carte'}</b><p>${
      cur.filtre === 'manquantes' ? 'Chaque version de ce Pokémon est dans ta collection.' : cur.filtre === 'possedees' ? 'Tu n’as aucune carte de ce Pokémon.' : 'Ce Pokémon n’a pas encore de carte en français.'}</p></div>`,
  });
  p.then(ok => { if (ok) busy = false; });
  const c = counts(cur.cards, vers);
  renderHead(cur.n, c);
  renderChips(c);
  return p;
}

// cartes de l'index + cartes de la collection rattachées à ce Pokémon (séries découvertes en direct, anciens numéros)
async function loadCards(n) {
  const list = await catalog.cardsOfDex(n);
  const seen = new Set(list.map(c => c.id));
  for (const r of col.all()) if (!seen.has(r.id) && dexNums(r).includes(n)) { list.push({ ...r, finishes: [] }); seen.add(r.id); }
  return list;
}
const fullCards = cards => cards.map(c => catalog.cardSync(c.id) || c);

const view = {
  mount(section) {
    el = section;
    frame();
    delegate(el, 'click', '[data-pf]', (e, b) => {
      const f = b.dataset.pf || '';
      if (f === cur.filtre || !cur.cards) return;
      cur.filtre = f;
      setParams({ filtre: f || null });
      for (const c of els.chips.querySelectorAll('[data-pf]')) c.setAttribute('aria-pressed', c.dataset.pf === f ? 'true' : 'false');
      renderGrid();
    });
    delegate(el, 'click', '[data-act="retry"]', () => { if (lastR && !lastR.signal.aborted) { rendered = false; view.show(lastR); } });
    prefs.on(k => { if (k === 'compact' && els) els.grid.classList.toggle('compact', !!prefs.get('compact', false)); });
  },

  async show(r) {
    const { signal } = r;
    const my = ++token;
    lastR = r;
    const n = Number(r.m[1]);
    const filtre = FILTER_KEYS.has(r.q.get('filtre')) ? r.q.get('filtre') : '';
    setBar({ title: nameOf(n) || 'Pokémon', subtitle: no4(n), back: true, signal });
    // même Pokémon, autre filtre (Retour, rechargement) : la liste déjà chargée suffit ; les finitions encore en
    // route sont appliquées par le chargement lancé au premier affichage (rattaché à cur, pas au jeton)
    // (premier lot de la grille posé tout de suite : show() n'attend pas les lots suivants)
    if (rendered && cur.n === n && cur.cards) { cur.filtre = filtre; renderGrid(); return; }
    cur = { n, cards: null, full: false, filtre };
    const mine = cur;
    rendered = false;
    setHTML(els.head, html`<span class="poke-art"></span><div class="poke-progs">${progHTML('Cartes', 0, 0, true)}${progHTML('Versions', 0, 0, true)}</div>`);
    setHTML(els.chips, '');
    fill(els.grid, html`${Array.from({ length: 9 }, () => html`<span class="sk-tile"><span class="sk-img"></span><span class="sk-l1"></span><span class="sk-l2"></span></span>`)}`);
    let cards;
    try {
      await pokedex();
      if (signal.aborted) return;
      if (!(n >= 1 && n <= dexCount())) {
        setBar({ title: 'Pokémon introuvable', back: true, signal });
        setHTML(els.head, '');
        fill(els.grid, html`<div class="empty" data-content><span class="ic">${icon('search')}</span><b>Pokémon introuvable</b><p>Ce numéro n’existe pas dans le Pokédex.</p></div>`);
        return;
      }
      setBar({ title: nameOf(n), subtitle: no4(n), back: true, signal });
      cards = await loadCards(n);
    } catch (e) {
      if (signal.aborted) return;
      setHTML(els.head, '');
      fill(els.grid, html`<div class="errrow" data-content>${icon('wifi-off')}<span class="grow">${MESSAGES[e?.kind] || 'Cartes indisponibles'}</span><button type="button" class="btn text sm" data-act="retry">Réessayer</button></div>`);
      return;
    }
    if (signal.aborted || my !== token) return;
    // finitions : fichiers des séries (une seule fois par session) ; on les attend 0,7 s au plus
    const ids = [...new Set(cards.map(c => c.setId))];
    const loadAll = catalog.loadSets(ids).catch(() => null);
    const inTime = await Promise.race([loadAll.then(() => true), new Promise(res => setTimeout(() => res(false), 700))]);
    if (signal.aborted || my !== token) return;
    cur.cards = fullCards(cards);
    cur.full = inTime;
    rendered = true;
    renderGrid();
    if (!inTime) {
      loadAll.then(() => {
        if (cur !== mine || mine.full) return;               // autre Pokémon affiché depuis
        mine.cards = fullCards(cards);
        mine.full = true;
        renderGrid();
      });
    }
  },

  // retour sur la page (même adresse) : un changement qui fait entrer ou sortir une version du filtre est appliqué
  resume() { if (refilter && cur.cards) renderGrid(); },

  hide() {},

  // quantité changée : tuile corrigée en place, progressions et nombres recalculés (rien n'est redessiné)
  onChange(events) {
    if (!rendered || !cur.cards) return;
    if (events.some(e => e.type === 'reload')) { if (!el.hidden) renderGrid(); else refilter = true; return; }
    const ids = new Set(cur.cards.map(c => c.id));
    let hit = false;
    for (const e of events) {
      if (e.type !== 'qty') continue;
      // carte de ce Pokémon absente de l'index (série découverte en direct) : ajoutée, visible au retour
      if (!ids.has(e.id) && e.added) {
        const r = col.get(e.id);
        if (r && dexNums(r).includes(cur.n)) { cur.cards.push(catalog.cardSync(e.id) || { ...r, finishes: [] }); ids.add(e.id); refilter = true; }
      }
      if (!ids.has(e.id)) continue;
      hit = true;
      const t = els.grid.querySelector(tileSel(e.id, e.finish));
      if (t) patchTile(t, { qty: e.after, missing: !e.after });
      else if (e.after) refilter = true;                     // finition ajoutée à la main : visible au retour
      if (cur.filtre && (!e.before || !e.after)) refilter = true;
    }
    if (!hit) return;
    if (busy) { refilter = true; return; }
    const c = counts(cur.cards, versionsOf(cur.cards));
    const progs = els.head.querySelector('.poke-progs');
    if (progs) setHTML(progs, html`${progHTML('Cartes', c.cOwn, c.cards, false)}${progHTML('Versions', c.vOwn, c.vers, !cur.full)}`);
    renderChips(c);
  },
};

export default view;
