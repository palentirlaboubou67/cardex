// Succès : les 18 succès de l'ancienne appli, en 5 groupes, avec un toast « Succès débloqué ».
// Un succès débloqué le reste (date gardée dans cardex.ach.v2), même si la valeur repasse sous le seuil ; vider la
// collection (Tout effacer, autre onglet) les remet à zéro, sauf si elle revient dans les 2 minutes (« Annuler ») :
// succès et dates d'avant sont alors rendus. L'ancienne liste (cardex.ach.v1) est reprise sans toast.
// init() : appelé par main.js quand le navigateur est libre. list() → [{ id, group, title, desc, done, at, progress, unit }]
import * as col from '../state/collection.js';
import * as prices from '../data/prices.js';
import { pokedex, dexNums } from '../data/dex.js';
import { sets as catalogSets, goalOf } from '../data/catalog.js';
import * as decks from '../data/decks.js';
import { whenIdle } from '../core/idle.js';
import { toast } from '../core/toast.js';
import * as router from '../core/router.js';

const KEY = 'cardex.ach.v2', OLD = 'cardex.ach.v1';
export const GROUPS = ['Collection', 'Brillantes', 'Pokédex', 'Jeu', 'Valeur'];
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const KANTO = range(1, 151);
const EEVEE = [133, 134, 135, 136, 196, 197, 470, 471, 700];

let unlocked = null;          // { id: ms (0 = date inconnue) }
let SETS = null;
let started = false, timer = 0, silent = false;
// collection déjà là sans liste de succès (premier lancement, liste v1 reprise) : calculs sans toast et sans date
// (0 = inconnue) jusqu'au premier calcul complet : Pokédex, séries, cotes chargés et finitions v1 revues par main.js
// (la valeur change après cette correction) ; 20 s au plus si la correction ne peut pas finir (hors ligne)
let hush = false, hushEnd = 0, full = false;
const quietStart = () => { hush = true; hushEnd = Date.now() + 20e3; };
let cleared = null;           // succès d'avant la remise à zéro : { at, until }
const UNDO = 120e3;
const subs = new Set();

function load() {
  if (unlocked) return unlocked;
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch { d = null; }
  if (d && typeof d === 'object' && d.at && typeof d.at === 'object') {
    unlocked = {};
    for (const [k, v] of Object.entries(d.at)) if (typeof k === 'string' && k.length < 20 && Number.isFinite(v)) unlocked[k] = v;
    return unlocked;
  }
  // ancienne appli : tableau des succès atteints au dernier calcul
  let old = null;
  try { old = JSON.parse(localStorage.getItem(OLD)); } catch { old = null; }
  if (Array.isArray(old)) {
    unlocked = {};
    for (const k of old) if (typeof k === 'string' && k.length < 20) unlocked[k] = 0;
    quietStart();
    save();
    try { localStorage.removeItem(OLD); } catch { /* rien */ }
    return unlocked;
  }
  return null;                                   // premier lancement : le premier calcul est noté sans toast
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 2, at: unlocked || {} })); } catch { /* stockage plein */ }
}

// ---------- données ----------
const loadSets = () => catalogSets().then(s => { SETS = s; return s; });
// decks de la méta : la même lecture et la même règle que l'écran Decks (js/data/decks.js : comparaison par nom,
// seules les 9 énergies de base comptent comme possédées). Chargés à la demande (écran Succès, ou collection
// modifiée), pas à chaque démarrage : data/decks.json pèse 70 Ko.
// quiet : lecture lancée par un import ou un autre onglet (le calcul qui suit reste sans toast, comme l'import)
const loadDecks = (quiet = false) => decks.load().then(() => { if (deckWanted()) { if (quiet) silent = true; schedule(200); } }, () => null);
const deckWanted = () => col.all().length > 0 && !Object.prototype.hasOwnProperty.call(load() || {}, 'deck');

// Tout ce qu'il faut pour un calcul complet (écran Succès) : Pokédex, séries, decks, cotes. Ne rejette jamais.
export function ready() {
  return Promise.allSettled([pokedex(), loadSets(), decks.load(), col.ensurePrices()]).then(r => { full = true; return r; });
}

// ---------- calcul ----------
function compute() {
  const recs = col.all(), st = col.stats(), dex = col.ownedByDex();
  const fins = new Set();
  for (const r of recs) for (const f in r.qty) fins.add(f);
  const got = ns => ns.reduce((a, n) => a + (dex.has(n) ? 1 : 0), 0);
  let setBest = 0, setId = '';
  if (SETS) {
    for (const [id, k] of col.ownedBySet()) {
      const g = goalOf(SETS.byId.get(id));
      const p = g ? Math.min(1, k / g) : 0;
      if (p > setBest) { setBest = p; setId = id; }
    }
  }
  let deckBest = 0, deckName = '';
  if (decks.loaded() && recs.length) {
    for (const p of decks.periods()) {
      for (const d of p.decks) { const x = decks.pctOf(d); if (x > deckBest) { deckBest = x; deckName = d.name; } }
    }
  }
  const dups = recs.reduce((a, r) => a + Object.values(r.qty).reduce((x, n) => x + Math.max(0, n - 1), 0), 0);
  const pika = recs.reduce((a, r) => a + (dexNums(r).includes(25) ? 1 : 0), 0);
  const value = Math.floor(st.value || 0);
  const setLabel = SETS?.byId.get(setId)?.name || '';
  return [
    ['first', 0, 'Première carte', 'Ajoute une carte à ta collection', st.total, 1],
    ['c50', 0, 'Collectionneur', 'Réunis 50 cartes', st.total, 50],
    ['c250', 0, 'Classeur plein', 'Réunis 250 cartes', st.total, 250],
    ['c1000', 0, 'Légende vivante', 'Réunis 1 000 cartes', st.total, 1000],
    ['set', 0, 'Série complète', setLabel && setBest < 1 ? `Ta série la plus avancée : ${setLabel}` : setLabel ? `${setLabel} au complet` : 'Toutes les cartes d’une série', Math.floor(setBest * 100), 100, '%'],
    ['shiny', 1, 'Ça brille', 'Une reverse, une holo ou mieux', [...fins].some(f => f !== 'normal') ? 1 : 0, 1],
    ['fins', 1, 'Arc-en-ciel', '4 finitions différentes', fins.size, 4],
    ['master', 1, 'Master Ball', 'Une reverse Master Ball', fins.has('masterball') ? 1 : 0, 1],
    ['starters', 2, 'Trio de départ', 'Bulbizarre, Salamèche et Carapuce', got([1, 4, 7]), 3],
    ['birds', 2, 'Oiseaux légendaires', 'Artikodin, Électhor et Sulfura', got([144, 145, 146]), 3],
    ['eevee', 2, 'Évolitions', 'Évoli et ses 8 évolutions', got(EEVEE), 9],
    ['pika', 2, 'Fan de Pikachu', '10 cartes Pikachu différentes', pika, 10],
    ['dex100', 2, 'Dresseur confirmé', '100 Pokémon différents', dex.size, 100],
    ['kanto', 2, 'Pokédex de Kanto', 'Les 151 premiers Pokémon', got(KANTO), 151],
    ['deck', 3, 'Prêt pour le tournoi', deckName && deckBest < 1 ? `Ton deck le plus avancé : ${deckName}` : deckName ? `${deckName} au complet` : 'Un deck de la méta au complet', Math.floor(deckBest * 100), 100, '%'],
    ['dups', 3, 'Roi de l’échange', '10 cartes en double', dups, 10],
    ['v100', 4, 'Petit trésor', 'Collection estimée à 100 €', value, 100, '€'],
    ['v1000', 4, 'Coffre-fort', 'Collection estimée à 1 000 €', value, 1000, '€'],
  ];
}

// [{ id, group, title, desc, done, at (ms, 0 = date inconnue, null = pas débloqué), progress: [n, but], unit }]
export function list() {
  const u = load() || {};
  return compute().map(([id, g, title, desc, have, need, unit = '']) => {
    const at = Object.prototype.hasOwnProperty.call(u, id) ? u[id] : null;
    const reached = have >= need;
    return { id, group: GROUPS[g], title, desc, done: reached || at != null, at: at ?? (reached ? Date.now() : null), progress: [have, need], unit };
  });
}

// fn() après chaque nouveau calcul (succès débloqué ou remis à zéro)
export const on = fn => (subs.add(fn), () => subs.delete(fn));
const notify = () => subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

// « Voir » : Succès s'ouvre par-dessus l'écran courant (← et Retour y reviennent), sans changer d'onglet
const SUCCES = '#/collection/succes';
function openList() {
  if (location.hash.startsWith(SUCCES)) return;
  if (router.parse()?.view === 'collection') router.go(SUCCES, { replace: true });
  else router.go(SUCCES);
}

// Un toast avec action (« Annuler » d'un ajout) ne doit pas être remplacé par « Succès débloqué » : le succès attend
// qu'il soit parti (core/toast.js n'en montre qu'un). Un toast persistant (« Nouvelle version », stockage) n'est pas
// attendu : vu depuis plus de 12 s, il ne bloque plus. Un toast sans action (« Ajout annulé », qui suit l'appui sur
// « Annuler ») reste lisible au moins 1,5 s avant d'être remplacé.
const seen = new WeakMap();
function actionToastUp() {
  const now = Date.now();
  for (const t of document.querySelectorAll('.toast:not(.out)')) {
    if (!seen.has(t)) seen.set(t, now);
    if (now - seen.get(t) < (t.classList.contains('has-act') ? 12e3 : 1500)) return true;
  }
  return false;
}
let queued = [], waitT = 0;
function announce(titles) {
  queued.push(...titles);                         // succès débloqués pendant l'attente : un seul toast pour tous
  clearTimeout(waitT);
  const tryShow = () => {
    if (!queued.length) return;
    if (actionToastUp()) { waitT = setTimeout(tryShow, 400); return; }
    const t = queued;
    queued = [];
    toast(t.length === 1 ? `Succès débloqué : ${t[0]}` : `${t.length} succès débloqués`, { action: 'Voir', onAction: openList });
  };
  tryShow();
}

// nouveau calcul : les succès atteints sont notés (avec la date) ; toast sauf au premier lancement ou après un import
export function check({ quiet = false } = {}) {
  const first = load() === null;
  if (first) unlocked = {};
  const fresh = [];
  const q = quiet || silent || hush;
  silent = false;
  // collection déjà là (premier calcul, reprise v1) : date inconnue (0), pas « aujourd'hui »
  const when = first || hush ? 0 : Date.now();
  if (full && (!col.needsFinishCheck?.() || Date.now() > hushEnd)) hush = false;
  for (const [id, , title, , have, need] of compute()) {
    if (have >= need && !Object.prototype.hasOwnProperty.call(unlocked, id)) { unlocked[id] = when; fresh.push(title); }
  }
  if (first || fresh.length) save();
  if (fresh.length && !first && !q) announce(fresh);
  if (fresh.length) notify();
  return fresh;
}

function reset() {
  queued = [];
  clearTimeout(waitT);
  const prev = load();
  if (prev && Object.keys(prev).length) cleared = { at: prev, until: Date.now() + UNDO };
  unlocked = {};
  save();
  notify();
}

// collection revenue juste après avoir été vidée (« Annuler », autre onglet) : succès d'avant, avec leurs dates
function restore() {
  const c = cleared;
  cleared = null;
  if (!c || Date.now() > c.until) return;
  unlocked = { ...(load() || {}), ...c.at };
  save();
  notify();
}

function schedule(ms = 800) {
  clearTimeout(timer);
  timer = setTimeout(() => whenIdle(() => check(), { timeout: 4000 }), ms);
}

export function init() {
  if (started) return;
  started = true;
  // premier lancement : liste vide notée tout de suite (la première carte ajoutée aura son toast) ; une collection
  // déjà là (sauvegarde importée, données d'avant les succès) est notée sans toast
  const firstRun = load() === null;
  if (firstRun) { unlocked = {}; save(); if (col.all().length) quietStart(); }
  col.on(evs => {
    const reload = evs.some(e => e.type === 'reload');
    if (reload && !col.all().length) { clearTimeout(timer); reset(); return; }   // collection vidée
    if (!reload && !evs.some(e => e.type === 'qty')) return;
    if (reload) { silent = true; if (cleared) restore(); }   // import, autre onglet, « Annuler » : sans toast
    if (!decks.loaded() && deckWanted()) loadDecks(reload);  // decks lus au premier changement (succès « tournoi »)
    schedule();
  });
  prices.on(() => schedule(1200));
  addEventListener('storage', e => { if (e.key === KEY) { unlocked = null; load(); notify(); } });
  // données au repos ; les decks (70 Ko) attendent le premier changement de la collection ou l'écran Succès
  Promise.allSettled([pokedex(), loadSets(), col.ensurePrices()]).then(() => { full = true; schedule(0); });
}
