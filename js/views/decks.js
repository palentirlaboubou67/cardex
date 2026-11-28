// Decks : Méta actuelle · Saisons passées (FINAL-design W-N). Saison, tri, filtre et recherche dans l'URL
// (saison, tri, filtre, q). Chaque deck : ce que tu as déjà (par nom de carte), le reste à acheter et le prix du deck.
import { setBar, primaryTabs, updateAction, setProgress } from '../core/appbar.js';
import { html, setHTML, delegate, selectChip } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { eur, norm, plural } from '../core/format.js';
import { setParams, depth } from '../core/router.js';
// lots rythmés par l'image (core/list.js renderChunked enchaîne plusieurs lots avant le rendu : longue tâche)
import { renderGrid as renderChunked } from './collection/grid.js';
import { MESSAGES } from '../core/net.js';
import * as decks from '../data/decks.js';
import * as prices from '../data/prices.js';
import * as col from '../state/collection.js';
import { deckHref, artHTML, restText, infoDecks, footText, sleep } from './decks/ui.js';

const SECTIONS = [['actuelle', 'Méta actuelle'], ['passees', 'Saisons passées']];
const SORTS = [['joues', 'Les plus joués'], ['complets', 'Les plus complets'], ['reste', 'Moins chers à finir'], ['prix', 'Prix du deck']];
const FILTERS = [['', 'Tous', 'all'], ['jouables', 'Jouables', 'ready'], ['presque', 'Presque', 'close']];
const byShare = (a, b) => (b.d.share || 0) - (a.d.share || 0) || (a.d.placing || 999) - (b.d.placing || 999);
const SORT = {
  joues: byShare,
  complets: (a, b) => b.st.pct - a.st.pct || byShare(a, b),
  reste: (a, b) => a.st.missing - b.st.missing || b.st.pct - a.st.pct || byShare(a, b),
  prix: (a, b) => a.st.value - b.st.value || byShare(a, b),
};

let el = null, ui = null, sec = 'actuelle', sig = null, visible = false;
let P = { q: '', tri: 'joues', filtre: '', saison: '' };
let searchOpen = false, qTimer = 0, frame = 0, ready = false;
// dernière saison passée choisie : gardée quand on passe par Méta actuelle
let lastSaison = '';
// ce qui est affiché : section et paramètres, révision de la collection, version des cotes ; orderStale : ordre en
// retard sur les chiffres (liste défilée pendant une mise à jour) ; rendu par lots en cours ; cotes en chargement
let paintedView = '', paintedCol = -1, paintedPv = -1, orderStale = false;
let renderSeq = 0, rendering = false, dirty = false, pend = 0;
const viewKey = () => `${sec}|${P.q}|${P.tri}|${P.filtre}|${P.saison}`;
const NEAR_TOP = 184;   // environ deux lignes : au-delà, l'ordre ne change pas sous les yeux

function readParams(q) {
  const tri = q.get('tri'), f = q.get('filtre');
  P = {
    q: (q.get('q') || '').trim().slice(0, 60),
    tri: SORT[tri] ? tri : 'joues',
    filtre: FILTERS.some(([v]) => v && v === f) ? f : '',
    saison: sec === 'passees' ? q.get('saison') || '' : '',
  };
  if (sec === 'passees') lastSaison = P.saison;
}

// liens des onglets principaux : la recherche, le tri et le filtre suivent d'une section à l'autre ; la saison
// reste celle choisie dans Saisons passées
function tabHref(s, saison = s === 'passees' ? (sec === 'passees' ? P.saison : lastSaison) : '') {
  const q = new URLSearchParams();
  if (P.q) q.set('q', P.q);
  if (P.tri !== 'joues') q.set('tri', P.tri);
  if (P.filtre) q.set('filtre', P.filtre);
  if (s === 'passees' && saison) q.set('saison', saison);
  const qs = q.toString();
  return `#/decks/${s}${qs ? `?${qs}` : ''}`;
}
const tabsHTML = () => primaryTabs(SECTIONS.map(([s, label]) => ({ href: tabHref(s), label })), tabHref(sec), 'Decks');
function syncTabs() {
  ui.tabs.querySelectorAll('.ptabs a').forEach((a, i) => a.setAttribute('href', tabHref(SECTIONS[i][0])));
}

function bar() {
  // racine ouverte par-dessus un autre écran : ← pour y revenir (une feuille ouverte a sa propre entrée)
  const d = depth() - (history.state?.sheet ? 1 : 0);
  setBar({
    title: 'Decks', back: d > 0, signal: sig, progress: pend > 0,
    actions: [
      { icon: 'search', label: 'Rechercher un deck', pressed: searchOpen, onClick: toggleSearch },
      { icon: 'info', label: 'À propos des decks', onClick: () => infoDecks() },
    ],
  });
}

// ---------- recherche (champ sous les onglets, ouvert par la loupe ; reste ouvert tant qu'une recherche est active) ----------
function syncSearch() {
  ui.search.hidden = !searchOpen;
  if (ui.input.value !== P.q) ui.input.value = P.q;
}
function toggleSearch() {
  const inside = ui.search.contains(document.activeElement);
  searchOpen = !searchOpen;
  updateAction(0, { pressed: searchOpen }, { signal: sig });
  if (searchOpen) { syncSearch(); ui.input.focus(); return; }
  // fermée : la recherche s'efface (frappe en attente comprise)
  clearTimeout(qTimer);
  const had = P.q;
  P.q = '';
  ui.input.value = '';
  syncSearch();
  if (had) apply();
  // fermée depuis le champ (Échap) : le focus revient sur la loupe, pas sur la page
  if (inside) document.querySelector('.appbar [data-act="0"]')?.focus();
}
function runQuery() {
  clearTimeout(qTimer);
  const v = ui.input.value.trim().slice(0, 60);
  if (v === P.q) return;
  P.q = v;
  apply();
}
function onInput() {
  clearTimeout(qTimer);
  qTimer = setTimeout(runQuery, 150);
}

// ---------- liste ----------
const periodsShown = () => (sec === 'actuelle' ? [decks.current()].filter(Boolean)
  : decks.past().filter(p => !P.saison || p.id === P.saison));
const scope = () => periodsShown().flatMap(p => p.decks);
const keep = st => !((P.filtre === 'jouables' && !st.ready) || (P.filtre === 'presque' && !st.close));

function compute() {
  const q = norm(P.q);
  const counts = { all: 0, ready: 0, close: 0 };
  const groups = [];
  for (const p of periodsShown()) {
    const items = [];
    for (const d of p.decks) {
      const m = decks.match(d, q);
      if (!m) continue;
      const st = decks.status(d);
      counts.all++;
      if (st.ready) counts.ready++;
      if (st.close) counts.close++;
      if (keep(st)) items.push({ d, st, m });
    }
    items.sort(SORT[P.tri]);
    if (items.length) groups.push({ p, items });
  }
  return { groups, counts };
}

// ligne courte sous le nom (W-N) ; l'étiquette pour les lecteurs d'écran garde la forme longue
const metaOf = (d, m) => (m.card ? `Contient ${m.card.name} ×${m.card.count}` : [decks.shareShort(d.share), decks.placeShort(d.placing), decks.eventShort(d.event)].filter(Boolean).join(' · '));
const metaLong = (d, m) => (m.card ? `contient ${m.card.name} ×${m.card.count}` : [decks.shareLabel(d.share), decks.placeLabel(d.placing), d.event].filter(Boolean).join(', '));
const pcOf = st => Math.round(st.pct * 1000) / 10;
const labelOf = (d, st, meta) => `${d.name}, ${st.have} cartes sur ${st.total}, ${st.ready ? 'prêt à jouer' : restText(st).replace('≈', 'environ')}, deck ${eur(st.value)}${meta ? `, ${meta}` : ''}`;
const restHTML = st => html`${st.ready ? icon('check') : ''}${restText(st)}`;

function rowHTML({ d, st, m }) {
  const meta = metaOf(d, m);
  return html`<a class="row dk-row${st.ready ? ' ready' : ''}" href="${deckHref(d.id)}" data-deck="${d.id}" aria-label="${labelOf(d, st, metaLong(d, m))}">${artHTML(d)}<span class="body"><span class="t">${d.name}</span><span class="s dk-meta"><span>${meta}</span></span><span class="progress wide dk-bar${st.ready ? ' done' : ''}"><i style="width:${pcOf(st)}%"></i></span><span class="dk-rest num">${restHTML(st)}</span><span class="dk-n num">${st.have} / ${st.total} cartes</span><span class="dk-price num">deck ${eur(st.value)}</span></span></a>`;
}
function rowNode(it) {
  const t = document.createElement('template');
  t.innerHTML = String(rowHTML(it));
  return t.content.firstElementChild;
}

const setText = (e, v) => { if (e && e.textContent !== v) e.textContent = v; };
// chiffres d'une ligne corrigés en place (seulement ce qui change : l'image et le reste de la ligne ne bougent pas)
function patchRow(row, { d, st, m }) {
  if (row.classList.contains('ready') !== st.ready) {
    row.classList.toggle('ready', st.ready);
    row.querySelector('.dk-bar')?.classList.toggle('done', st.ready);
  }
  const bar = row.querySelector('.dk-bar > i'), w = `${pcOf(st)}%`;
  if (bar && bar.style.width !== w) bar.style.width = w;
  const rest = row.querySelector('.dk-rest');
  if (rest && rest.textContent !== restText(st)) setHTML(rest, restHTML(st));
  setText(row.querySelector('.dk-n'), `${st.have} / ${st.total} cartes`);
  setText(row.querySelector('.dk-price'), `deck ${eur(st.value)}`);
  const label = labelOf(d, st, metaLong(d, m));
  if (row.getAttribute('aria-label') !== label) row.setAttribute('aria-label', label);
}

const focusedDeck = () => document.activeElement?.closest?.('.dk-row')?.dataset.deck;
function refocus(id) {
  if (id && !ui.list.contains(document.activeElement)) ui.list.querySelector(`.dk-row[data-deck="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}

// Liste mise à jour sans être refaite (cotes arrivées, collection modifiée) : chiffres corrigés, lignes déplacées
// pour suivre le tri, ajoutées ou retirées pour suivre le filtre ; les images restent. order = false (liste défilée) :
// l'ordre attend le retour sur l'écran (orderStale), sauf si le filtre ajoute ou retire des decks.
// Les saisons affichées changent (filtre) ou la liste devient vide : nouveau rendu.
function sync(order) {
  const { groups, counts } = compute();
  patchChips(counts);
  const boxes = [...ui.list.querySelectorAll(':scope > .dk-group')];
  if (!groups.length || boxes.length !== groups.length || groups.some((g, i) => boxes[i].dataset.p !== g.p.id)) {
    renderList({ sync: true });
    return;
  }
  const had = focusedDeck();
  let stale = false;
  groups.forEach((g, i) => {
    const box = boxes[i];
    const rows = new Map([...box.children].map(r => [r.dataset.deck, r]));
    const same = g.items.length === rows.size && g.items.every(it => rows.has(it.d.id));
    if (same && !order) {
      for (const it of g.items) patchRow(rows.get(it.d.id), it);
      stale ||= g.items.some((it, j) => box.children[j].dataset.deck !== it.d.id);
      return;
    }
    let ref = box.firstElementChild;
    for (const it of g.items) {
      let row = rows.get(it.d.id);
      if (row) { rows.delete(it.d.id); patchRow(row, it); } else row = rowNode(it);
      if (row === ref) ref = ref.nextElementSibling; else box.insertBefore(row, ref);
    }
    for (const r of rows.values()) r.remove();
    const head = box.previousElementSibling?.matches('.dk-season') ? box.previousElementSibling.querySelector(':scope > .num') : null;
    setText(head, plural(g.items.length, 'deck', 'decks'));
  });
  refocus(had);
  orderStale = stale;
  paintedCol = col.rev(); paintedPv = prices.version();
  ui.foot.textContent = footText();
}

// decks de ces périodes qui correspondent à la recherche et au filtre
function countIn(pers) {
  const q = norm(P.q);
  let n = 0;
  for (const p of pers) for (const d of p.decks) if (decks.match(d, q) && keep(decks.status(d))) n++;
  return n;
}

// États vides, rédigés pour la saison choisie. Propositions, dans l'ordre : l'autre filtre de la même liste, toutes
// les saisons (une saison choisie), l'autre section ; au plus deux boutons, sinon « Voir tous les decks » / « Effacer ».
function emptyHTML(counts) {
  const season = sec === 'passees' && !!P.saison;
  const [one, many] = P.filtre === 'jouables' ? ['deck jouable', 'decks jouables'] : P.filtre === 'presque' ? ['deck presque complet', 'decks presque complets'] : ['deck', 'decks'];
  const acts = [];
  const wider = () => {
    if (season) {
      const n = countIn(decks.past().filter(p => p.id !== P.saison));
      if (n) acts.push(b => html`<button type="button" class="${b}" data-saison="">Voir ${plural(n, one, many)} dans toutes les saisons</button>`);
    }
    const other = sec === 'actuelle' ? 'passees' : 'actuelle';
    const n = countIn(other === 'passees' ? decks.past() : [decks.current()].filter(Boolean));
    if (n) acts.push(b => html`<a class="${b}" href="${tabHref(other, '')}" data-replace>Voir ${plural(n, one, many)} ${other === 'passees' ? 'des saisons passées' : 'de la méta actuelle'}</a>`);
  };
  // premier bouton plein, le second en texte
  const box = (ic, title, text) => html`<div class="empty" data-content><span class="ic">${icon(ic)}</span><b>${title}</b><p>${text}</p><div class="dk-eacts">${acts.slice(0, 2).map((a, i) => a(i ? 'btn text' : 'btn'))}</div></div>`;
  const forQ = P.q ? ` pour « ${P.q} »` : '';
  if (P.q && !counts.all) {
    wider();
    if (!acts.length) acts.push(b => html`<button type="button" class="${b}" data-clear-q>Effacer la recherche</button>`);
    return box('search', `Aucun deck${forQ}${season ? ' cette saison' : sec === 'actuelle' ? ' dans la méta actuelle' : ' dans les saisons passées'}`, 'Cherche un nom de deck, de Pokémon ou de carte.');
  }
  const when = season ? ' cette saison' : P.q ? '' : ' pour l’instant';
  const ofSeason = season ? ' de cette saison' : '';
  const all = b => html`<button type="button" class="${b}" data-f="">Voir tous les decks</button>`;
  if (P.filtre === 'jouables') {
    if (counts.close) acts.push(b => html`<button type="button" class="${b}" data-f="presque">Voir ${plural(counts.close, 'deck presque complet', 'decks presque complets')}</button>`);
    wider();
    if (!acts.length) acts.push(all);
    return box('decks', `Aucun deck jouable${forQ}${when}`, `Il te manque encore des cartes pour chaque deck${ofSeason}.`);
  }
  if (P.filtre === 'presque') {
    if (counts.ready) acts.push(b => html`<button type="button" class="${b}" data-f="jouables">Voir ${plural(counts.ready, 'deck jouable', 'decks jouables')}</button>`);
    wider();
    if (!acts.length) acts.push(all);
    return box('decks', `Aucun deck presque complet${forQ}${when}`, counts.ready
      ? `Tes decks les plus avancés${ofSeason} sont déjà complets.`
      : `Aucun deck${ofSeason} n’a encore 70 % de ses cartes dans ta collection.`);
  }
  return box('decks', 'Aucun deck', 'Les listes de cette période ne sont pas disponibles.');
}

function chipsHTML(counts) {
  const season = sec === 'passees' ? selectChip({ label: 'Saison', name: 'saison', value: P.saison,
    options: [['', 'Toutes les saisons'], ...decks.past().map(p => [p.id, p.label])] }) : '';
  return html`${season}${selectChip({ label: 'Trier', name: 'tri', options: SORTS, value: P.tri })}${
    FILTERS.map(([v, t, k]) => html`<button type="button" class="chip" data-f="${v}" aria-pressed="${P.filtre === v ? 'true' : 'false'}">${t} <span class="n">${counts[k]}</span></button>`)}`;
}
// filtres : état et nombres corrigés en place (le focus reste sur la puce)
function patchChips(counts) {
  for (const b of ui.chips.querySelectorAll('[data-f]')) {
    const f = FILTERS.find(([v]) => v === b.dataset.f);
    b.setAttribute('aria-pressed', P.filtre === f[0] ? 'true' : 'false');
    setText(b.querySelector('.n'), String(counts[f[2]]));
  }
}

function seasonHead(p, n) {
  return html`<h2 class="sect dk-season"><span class="grow">${p.label}${p.era ? html`<span class="dk-era"> · ${p.era}</span>` : ''}</span><span class="num">${plural(n, 'deck', 'decks')}</span></h2>`;
}

// rendu de la liste : les saisons passées (jusqu'à 125 decks) arrivent par lots d'une ou deux saisons, sans longue tâche
// (sync : tout d'un coup, pour un rafraîchissement qui ne doit pas raccourcir la page sous le défilement).
// Renvoie une promesse résolue quand tout est dans le DOM (show() l'attend : le défilement restauré a sa hauteur).
// Ce qui arrive pendant un rendu par lots (cotes, collection) est appliqué à la fin (dirty).
function renderList({ chips = false, sync = false } = {}) {
  const { groups, counts } = compute();
  if (chips) setHTML(ui.chips, chipsHTML(counts)); else patchChips(counts);
  const had = focusedDeck();
  const heads = sec === 'passees';
  paintedView = viewKey(); paintedCol = col.rev(); paintedPv = prices.version(); orderStale = false;
  ui.foot.textContent = footText();
  ui.foot.hidden = !groups.length;
  const my = ++renderSeq;
  rendering = true; dirty = false;
  const tpl = g => html`${heads ? seasonHead(g.p, g.items.length) : ''}<div class="group dk-group" data-p="${g.p.id}">${g.items.map(rowHTML)}</div>`;
  return renderChunked(ui.list, groups, tpl, { first: sync ? Infinity : 2, batch: 2, empty: emptyHTML(counts) }).then(() => {
    if (my !== renderSeq) return;
    rendering = false;
    refocus(had);
    if (dirty) { dirty = false; schedule(); }
  });
}

// retour sur l'écran ou événement (cotes arrivées, collection modifiée) : mise à jour en place ; order : l'ordre suit
function refresh(order) {
  if (!ready) return;
  if (rendering) { dirty = true; return; }
  if (paintedView !== viewKey()) { renderList({ sync: true }); return; }
  if (paintedCol !== col.rev() || paintedPv !== prices.version() || (order && orderStale)) sync(order);
}

// cotes des séries affichées ; barre de progression sous la barre d'app tant qu'il en manque
function loadPrices() {
  const sets = decks.setsOf(scope());
  const missing = sets.some(s => !prices.has(s));
  const p = prices.ensure(sets);
  if (!missing) return p;
  if (!pend++) setProgress(true, { signal: sig });
  p.finally(() => { if (!--pend) setProgress(false, { signal: sig }); });
  return p;
}

// paramètres changés sur l'écran : URL (sans nouvelle entrée), liens des onglets, puces et liste
function apply({ chips = false } = {}) {
  if (sec === 'passees') lastSaison = P.saison;
  setParams({ q: P.q || null, tri: P.tri !== 'joues' ? P.tri : null, filtre: P.filtre || null, saison: sec === 'passees' && P.saison ? P.saison : null });
  syncTabs();
  if (!ready) return;
  renderList({ chips });
  loadPrices();
}

// événements groupés à l'image suivante, seulement quand l'écran est visible (sinon : au retour, resume) ;
// l'ordre ne suit que si la liste n'est pas défilée
function schedule() {
  if (!visible || !ready || frame) return;
  frame = requestAnimationFrame(() => { frame = 0; if (visible) refresh(scrollY <= NEAR_TOP); });
}

const SK_ROW = '<span class="row sk-row dk-sk"><span class="sk-a"></span><span class="body"><span class="sk-t"></span><span class="sk-s"></span></span></span>';
const skeleton = () => `<div class="group" aria-busy="true" aria-label="Chargement">${SK_ROW.repeat(6)}</div>`;

function errorHTML(e) {
  const why = MESSAGES[e?.kind] || 'Les listes n’ont pas pu être chargées';
  return html`<div class="empty" data-content><span class="ic">${icon(e?.kind === 'offline' ? 'wifi-off' : 'alert')}</span><b>Decks indisponibles</b><p>${why}. Vérifie ta connexion, puis réessaie.</p><button type="button" class="btn" data-retry>Réessayer</button></div>`;
}

// saison inconnue dans l'URL (ancien lien) : toutes les saisons
function checkSeason() {
  if (lastSaison && !decks.past().some(p => p.id === lastSaison)) lastSaison = '';
  if (P.saison && !decks.past().some(p => p.id === P.saison)) { P.saison = ''; setParams({ saison: null }); syncTabs(); }
}

// decks.json (squelette pendant le chargement, erreur avec « Réessayer »), puis les cotes des séries affichées :
// le premier rendu les attend un court instant ; la suite met la liste à jour en place (prices.on), ordre compris
// tant que la liste n'est pas défilée, sinon au retour sur l'écran
async function load(signal) {
  ready = false;
  if (decks.loaded()) {
    checkSeason();
    if (decks.setsOf(scope()).every(s => prices.has(s))) return true;   // tout est là : rendu immédiat
  }
  setHTML(ui.chips, ''); ui.list.innerHTML = skeleton(); ui.foot.hidden = true;
  try { await decks.load(); } catch (e) {
    if (signal?.aborted) return false;
    setHTML(ui.chips, '');
    setHTML(ui.list, errorHTML(e));
    ui.foot.hidden = true;
    return false;
  }
  if (signal?.aborted) return false;
  checkSeason();
  await Promise.race([loadPrices(), sleep(400)]);
  return !signal?.aborted;
}

async function fill(signal) {
  if (!(await load(signal))) return;
  ready = true;
  await renderList({ chips: true });
}

// main.js précharge ce module au repos : le fichier des decks part dès que l'on touche l'onglet
document.querySelector('.tabbar [data-tab="decks"]')?.addEventListener('pointerdown', () => { decks.load().catch(() => {}); }, { once: true });

export default {
  mount(section) {
    el = section;
    el.innerHTML = `<div class="ptabs-slot"></div><div class="searchbar dk-search" hidden><div class="search">${icon('search')}`
      + '<input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="Deck, Pokémon ou carte" aria-label="Chercher un deck, un Pokémon ou une carte">'
      + `<button type="button" class="search-clear" aria-label="Effacer">${icon('close')}</button></div></div>`
      + '<div class="chips dk-chips" role="group" aria-label="Saison, tri et filtres"></div>'
      + '<div class="dk-list"></div><p class="caption dk-foot" hidden></p>';
    ui = {
      tabs: el.querySelector('.ptabs-slot'), search: el.querySelector('.dk-search'), input: el.querySelector('.dk-search input'),
      chips: el.querySelector('.dk-chips'), list: el.querySelector('.dk-list'), foot: el.querySelector('.dk-foot'),
    };
    ui.input.addEventListener('input', onInput);
    ui.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); runQuery(); ui.input.blur(); return; }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (ui.input.value) { ui.input.value = ''; onInput(); } else toggleSearch();
    });
    // bouton d'un état vide : il disparaît avec la liste, le focus passe sur la puce qu'il a changée
    delegate(el, 'click', '[data-f]', (e, b) => {
      const chip = !!b.closest('.chips');
      if (P.filtre === b.dataset.f && chip) return;
      P.filtre = b.dataset.f;
      apply();
      if (!chip) ui.chips.querySelector(`[data-f="${CSS.escape(P.filtre)}"]`)?.focus({ preventScroll: true });
    });
    delegate(el, 'click', '[data-saison]', (e, b) => {
      P.saison = b.dataset.saison;
      apply({ chips: true });
      ui.chips.querySelector('select[name="saison"]')?.focus({ preventScroll: true });
    });
    delegate(el, 'change', '.dk-chips select', (e, s) => {
      if (s.name === 'tri') P.tri = SORT[s.value] ? s.value : 'joues';
      else if (s.name === 'saison') P.saison = s.value;
      apply();
    });
    delegate(el, 'click', '[data-clear-q]', () => { ui.input.value = ''; P.q = ''; apply(); ui.input.focus(); });
    delegate(el, 'click', '[data-retry]', () => { fill(sig); });
    prices.on(() => schedule());
  },

  async show(r) {
    sig = r.signal;
    visible = true;
    sec = r.m[1] === 'passees' ? 'passees' : 'actuelle';
    readParams(r.q);
    searchOpen = !!P.q;
    bar();
    setHTML(ui.tabs, tabsHTML());
    syncSearch();
    await fill(r.signal);
  },

  // retour sur l'écran gardé : chiffres et ordre mis à jour en place (cotes ou collection changées entre-temps)
  resume(r) {
    visible = true;
    sig = r?.signal || sig;
    bar();                      // la même adresse peut être la racine de l'onglet ou empilée (← ou pas) ; progression
    refresh(true);
  },

  hide() {
    visible = false;
    clearTimeout(qTimer);
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
  },

  // collection modifiée : lignes mises à jour en place à l'image suivante si l'écran est visible, sinon au retour
  onChange(events) {
    if (events?.some?.(e => e.type === 'qty' || e.type === 'reload') ?? true) schedule();
  },
};
