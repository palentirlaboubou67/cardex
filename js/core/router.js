// Routeur : routes en hash, vrai historique (le Retour d'Android marche), une pile par onglet, destination de départ fixe.
// Version corrigée de FINAL-design §4.3 bis (23 scénarios), adaptée aux routes de SPEC §3, avec en plus :
//  - les feuilles (entrée d'historique au même hash : Retour les ferme ; naviguer depuis une feuille la ferme d'abord) ;
//  - un lien profond pose ses parents en dessous (carte → série → Séries), puis la destination de départ ;
//  - la position de défilement est gardée dans chaque entrée (Retour, Avancer, rechargement, retour sur un onglet) ;
//  - un hash posé de l'extérieur vers une racine d'onglet (notification) change d'onglet ; un hash inconnu est annulé.
const START = 'collection';
export const ROOT = {
  collection: '#/collection/cartes', series: '#/series', scan: '#/scanner',
  market: '#/marche/cotes', decks: '#/decks/actuelle',
};
export const TABS = Object.keys(ROOT);
const ROOT_VIEWS = new Set(['collection', 'sets', 'scan', 'market', 'decks']);
const setOf = id => (id.includes('-') ? id.slice(0, id.lastIndexOf('-')) : '');
const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
const ID = /^[\w.%!-]+$/;
// id de carte d'un segment d'URL : décodé une fois (exu-%253F → exu-%3F) ; un ancien lien non encodé
// (#/carte/exu-%3F, que le décodage changerait en « exu-? », impossible) est gardé tel quel
const idOf = s => { const d = dec(s); return ID.test(d) || !ID.test(s) ? d : s; };

// Liens internes : l'id est encodé une fois dans l'URL, param() / cardId() le décodent une fois.
export const cardHref = (id, finish) => `#/carte/${encodeURIComponent(id)}${finish ? `?finition=${encodeURIComponent(finish)}` : ''}`;
export const setHref = id => `#/serie/${encodeURIComponent(id)}`;
export const param = (r, i = 1) => dec(r?.m?.[i] ?? '');            // segment i de la route, décodé (jamais d'exception)
export const cardId = r => idOf(r?.m?.[1] ?? '');                    // #/carte/:id → id du catalogue
const ROUTES = [ // [regex, vue, onglet (null = reste dans la pile d'où on l'ouvre), parent pour un lien profond]
  [/^#\/collection\/(cartes|pokedex|doubles|succes)$/, 'collection', 'collection'],
  [/^#\/pokemon\/(\d+)$/, 'poke', 'collection', () => '#/collection/pokedex'],
  [/^#\/reglages$/, 'settings', 'collection', () => '#/collection/cartes'],
  [/^#\/series$/, 'sets', 'series'],
  [/^#\/serie\/([^/?]+)$/, 'set', 'series', () => '#/series'],
  [/^#\/carte\/([^/?]+)$/, 'card', null, m => (setOf(idOf(m[1])) ? setHref(setOf(idOf(m[1]))) : '#/series')],
  [/^#\/scanner$/, 'scan', 'scan'],
  [/^#\/marche\/(cotes|scelle|mon-scelle|envies)$/, 'market', 'market'],
  [/^#\/produit\/(\d+)$/, 'product', 'market', () => '#/marche/scelle'],
  [/^#\/decks\/(actuelle|passees)$/, 'decks', 'decks'],
  [/^#\/deck\/([^/?]+)$/, 'deck', 'decks', () => '#/decks/actuelle'],
];
export const LEGACY = { '#wishlist': '#/marche/envies' };

// r = { hash, path, view, tab, parent, m, q (URLSearchParams), root (racine d'onglet) } ou null
export function parse(hash = location.hash) {
  const i = hash.indexOf('?');
  const path = i < 0 ? hash : hash.slice(0, i);
  for (const [re, view, tab, parent] of ROUTES) {
    const m = path.match(re);
    if (m) return { hash, path, view, tab, parent, m, q: new URLSearchParams(i < 0 ? '' : hash.slice(i + 1)), root: ROOT_VIEWS.has(view) };
  }
  return null;
}
export const isRoot = r => !!r && ROOT_VIEWS.has(r.view);

let stack = [], ys = [], memory = {}, tab = START;
let pendingTab = null, pendingGo = null, pendingParams = null;
let curD = 0;                                       // profondeur de l'entrée de la page affichée (hors feuille)
let renderView = async () => {}, deps = {}, started = false;
let busy = false, busyT = 0, seq = 0, quietUntil = 0, scrollT = 0;
const lock = () => { busy = true; clearTimeout(busyT); busyT = setTimeout(() => { busy = false; }, 800); };
const unlock = () => { busy = false; clearTimeout(busyT); };
const yNow = () => Math.round(scrollY);
const save = () => { try { sessionStorage.setItem('cardex.nav', JSON.stringify({ stack, ys, memory, tab })); } catch {} };
const ownerTab = r => r.tab || parse(r.parent?.(r.m) || '')?.tab || START;
const sheetEntry = () => !!history.state?.sheet;
export const currentTab = () => tab;
export const depth = () => history.state?.d || 0;
export const isBusy = () => busy;
if (typeof history !== 'undefined') history.scrollRestoration = 'manual';

// chaîne des parents d'une route jusqu'à la racine de son onglet : [racine, …, route]
function chainOf(r) {
  const out = [r.hash];
  for (let p = r, n = 0; p?.parent && n < 6; n++) { const h = p.parent(p.m); out.unshift(h); p = parse(h); }
  return out;
}

// deps = { hasCards(), isSheetOpen(), hideSheet(), onParams(hash) }
export async function start(render, d = {}) {
  renderView = render; deps = d;
  if (sheetEntry()) await dropSheetEntry();            // rechargé sur une feuille : on retire son entrée
  if (!started) {
    started = true;
    addEventListener('popstate', onPop);
    addEventListener('scroll', onScroll, { passive: true });
  }
  let saved = null; try { saved = JSON.parse(sessionStorage.getItem('cardex.nav')); } catch {}
  const st = history.state;
  const r = parse() || parse(LEGACY[location.hash] || defaultRoute());
  if (st?.t && Array.isArray(saved?.stack)) {         // rechargement : piles, onglet et défilement gardés
    const dd = st.d || 0;
    stack = saved.stack.slice(0, dd + 1); ys = (Array.isArray(saved.ys) ? saved.ys : []).slice(0, dd + 1);
    memory = saved.memory && typeof saved.memory === 'object' ? saved.memory : {};
    tab = st.t;
    stack[dd] = r.hash;
    history.replaceState(st, '', r.hash);
    curD = dd;
    save();
    return show(st.y || 0, { kind: 'start' });
  }
  // ouverture (lien profond compris) : destination de départ en bas, puis la racine de l'onglet et les parents
  tab = ownerTab(r);
  memory = {};
  const chain = chainOf(r);
  if (tab !== START) {
    history.replaceState({ d: 0, y: 0, t: START, base: 1 }, '', ROOT[START]);
    history.pushState({ d: 0, y: 0, t: tab }, '', chain[0]);
  } else history.replaceState({ d: 0, y: 0, t: tab }, '', chain[0]);
  chain.slice(1).forEach((h, i) => history.pushState({ d: i + 1, y: 0, from: chain[i], t: tab }, '', h));
  stack = chain.slice(); ys = chain.map(() => 0); curD = chain.length - 1; save();
  return show(0, { kind: 'start' });
}

// une feuille ouverte se ferme d'abord : par l'historique si elle y a son entrée (fn est relancée au popstate)
function afterSheet(fn) {
  if (!deps.isSheetOpen?.()) return false;
  if (sheetEntry()) { pendingGo = fn; lock(); history.back(); return true; }
  deps.hideSheet?.();
  return false;
}

// empile dans la pile de l'onglet courant (l'onglet ne change pas : une carte ouverte depuis Séries reste dans Séries)
export function go(hash, { replace = false } = {}) {
  if (busy) return;
  if (afterSheet(() => go(hash, { replace }))) return;
  const st = history.state || { d: 0, t: tab };
  const d0 = st.d || 0;
  try { history.replaceState({ ...st, y: yNow() }, ''); } catch {}
  ys[d0] = yNow();
  const d = replace ? d0 : d0 + 1;
  (replace ? history.replaceState : history.pushState).call(history,
    { d, y: 0, from: replace ? st.from : location.hash, t: tab }, '', hash);
  stack = stack.slice(0, d); stack[d] = hash;
  ys = ys.slice(0, d); ys[d] = 0;
  curD = d;
  save();
  return show(0, { kind: replace ? 'replace' : 'push' });
}

// le ← de la barre d'app
export function back() {
  if (busy) return;
  if (deps.isSheetOpen?.() && sheetEntry()) { lock(); history.back(); return; }
  if (depth() > 0) { lock(); history.back(); return; }
  const r = parse();
  if (r?.parent) return go(r.parent(r.m), { replace: true });   // ouvert sans historique : on monte au parent
}

// onglet du bas : bascule (pile mémorisée) ; sur l'onglet actif : remonte à la racine, puis en haut de page
export function switchTab(t) {
  if (busy || !ROOT[t]) return;
  if (afterSheet(() => switchTab(t))) return;               // lien ou toast dans une feuille : elle se ferme d'abord
  const d = depth();
  if (t === tab) {
    if (d > 0) { lock(); history.go(-d); }
    else scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return;
  }
  ys[d] = yNow();
  memory[tab] = { s: stack.slice(), y: ys.slice() };
  pendingTab = t;
  const toBottom = d + (tab !== START ? 1 : 0);            // l'entrée du bas = racine de la destination de départ
  if (toBottom > 0) { lock(); history.go(-toBottom); } else applyTab();
}

// lien vers la racine d'un autre onglet (ex. « Scanner une carte ») : change d'onglet, pile remise à cette racine
export function openRoot(hash) {
  if (busy) return;
  const r = parse(hash);
  if (!r?.root || r.tab === tab) return go(hash);
  if (afterSheet(() => openRoot(hash))) return;
  memory[r.tab] = { s: [r.hash], y: [0] };
  switchTab(r.tab);
}

function applyTab() {
  const t = pendingTab; pendingTab = null;
  tab = t;                                                  // l'onglet possède sa pile, même quand elle finit sur une carte
  const m = memory[t]?.s?.length ? memory[t] : { s: [ROOT[t]], y: [0] };
  const chain = m.s, yy = Array.isArray(m.y) ? m.y : [];
  if (t === START) history.replaceState({ d: 0, y: yy[0] || 0, t }, '', chain[0]);
  else {
    history.replaceState({ d: 0, y: 0, t: START, base: 1 }, '', ROOT[START]);
    history.pushState({ d: 0, y: yy[0] || 0, t }, '', chain[0]);
  }
  chain.slice(1).forEach((h, i) => history.pushState({ d: i + 1, y: yy[i + 1] || 0, from: chain[i], t }, '', h));
  stack = chain.slice(); ys = chain.map((_, i) => yy[i] || 0); curD = chain.length - 1; save();
  return show(ys[ys.length - 1] || 0, { kind: 'tab' });
}

const real = s => !!s && typeof s === 'object' && s.d != null;

function onPop() {
  unlock();
  if (pendingTab) return applyTab();
  let s = history.state, over = 0;
  if (deps.isSheetOpen?.()) {
    deps.hideSheet?.();
    if (real(s) && !s.sheet) {                              // Retour a fermé une feuille (même hash) : pas de nouveau rendu
      if (pendingParams) { const h = pendingParams; pendingParams = null; replaceHash(h); }
      if (pendingGo) { const f = pendingGo; pendingGo = null; f(); }
      return;
    }
    over = 1;                                               // un hash est arrivé par-dessus la feuille : son entrée reste dessous
  }
  pendingGo = null; pendingParams = null;
  if (real(s) && s.sheet) {                                 // entrée d'une feuille déjà fermée (Retour/Avancer) : sautée
    if (s.d < curD) { lock(); history.back(); }
    return;
  }
  if (!real(s)) {                                           // simple fragment : <a href>, hash tapé, notification
    if (LEGACY[location.hash]) history.replaceState(null, '', LEGACY[location.hash]);
    const r = parse();
    if (!r) { lock(); history.go(-(1 + over)); return; }    // hash inconnu : annulé (l'écran ne change pas)
    if (r.root) return crossTab(r, over);                   // racine d'onglet (même l'onglet courant) : pile refaite
    const prev = Math.max(0, stack.length - 1);
    if (over) stack[prev + 1] = stack[prev];                // l'entrée morte de la feuille compte dans la profondeur
    history.replaceState({ d: prev + 1 + over, y: 0, from: stack[prev], t: tab }, '');
    s = history.state;
  }
  if (s.t && s.t !== tab) { memory[tab] = { s: stack.slice(), y: ys.slice() }; tab = s.t; stack = []; ys = []; }
  stack = stack.slice(0, s.d + 1); stack[s.d] = location.hash;
  ys = ys.slice(0, s.d + 1); ys[s.d] = s.y || 0;
  curD = s.d;
  save();
  show(s.y || 0, { kind: 'pop' });
}

// hash venu de l'extérieur vers une racine d'onglet : on redescend en bas puis on reconstruit cet onglet
// (over = 1 quand l'entrée d'une feuille fermée entre-temps est encore dans l'historique)
function crossTab(r, over = 0) {
  const prevDepth = Math.max(0, stack.length - 1);
  memory[tab] = { s: stack.slice(), y: ys.slice() };
  memory[r.tab] = { s: [r.hash], y: [0] };
  pendingTab = r.tab;
  lock();
  history.go(-(prevDepth + 1 + over + (tab !== START ? 1 : 0)));
}

// filtres, tri, mode d'affichage : dans l'URL sans nouvelle entrée (rechargement et Retour les retrouvent)
export function setParams(obj) {
  const r = parse();
  if (!r) return;
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '' || v === false) r.q.delete(k);
    else r.q.set(k, v === true ? '1' : String(v));
  }
  const s = r.q.toString();
  const h = r.path + (s ? `?${s}` : '');
  if (h === location.hash) return;
  if (deps.isSheetOpen?.() && sheetEntry()) pendingParams = h;   // reporté sur la page sous la feuille à sa fermeture
  replaceHash(h);
}
function replaceHash(h) {
  try { history.replaceState(history.state, '', h); } catch {}
  if (!sheetEntry()) { stack[depth()] = location.hash; save(); }
  deps.onParams?.(location.hash);
}

async function show(y, info = {}) {
  const r = parse();
  if (!r) return go(LEGACY[location.hash] || ROOT[tab] || ROOT[START], { replace: true });
  const my = ++seq;
  try { await renderView(r, tab, info); } catch (e) { console.error(e); }
  if (my !== seq) return;
  quietUntil = performance.now() + 700;
  await new Promise(res => requestAnimationFrame(() => { if (my === seq) scrollTo(0, y); res(); }));
}

// défilement mémorisé dans l'entrée courante (après une pause), pour Retour, Avancer et le rechargement
function onScroll() {
  clearTimeout(scrollT);
  scrollT = setTimeout(() => {
    if (busy || pendingTab || performance.now() < quietUntil || deps.isSheetOpen?.()) return;
    const st = history.state;
    if (!st || st.sheet || st.d == null || st.y === yNow()) return;
    try { history.replaceState({ ...st, y: yNow() }, ''); } catch { return; }
    ys[st.d] = yNow();
  }, 250);
}

function dropSheetEntry() {
  return new Promise(res => {
    const done = () => { clearTimeout(t); removeEventListener('popstate', done); res(); };
    const t = setTimeout(done, 500);
    addEventListener('popstate', done);
    history.back();
  });
}

function defaultRoute() {
  return deps.hasCards?.() === false ? ROOT.scan : ROOT[START];
}
