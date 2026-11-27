// Page d'une série (#/serie/:setId) : en-tête (logo, symbole, code, légalité, progression, valeur), filtre
// (?filtre=possedees|manquantes), affichage (?vue=grille|liste|classeur), master set (?master=1, d'après les
// finitions des fichiers statiques), tri (?tri=prix|prix-asc|nom), page du classeur (?page=).
// Données : data/sets/<id>.json et data/market/prices/<id>.json, rien d'autre (plus d'« Analyser » carte par carte).
import { setBar } from '../core/appbar.js';
import { html, raw, setHTML, delegate, selectChip } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { eur, num, plural, dateFr, localNo, norm } from '../core/format.js';
import { renderChunked } from '../core/list.js';
import { whenIdle } from '../core/idle.js';
import { MESSAGES } from '../core/net.js';
import { infoSheet, openSheet, isOpen as sheetOpen } from '../core/sheet.js';
import { toast } from '../core/toast.js';
import { param, setParams, go, cardHref } from '../core/router.js';
import { setLogoHTML, setSymHTML } from '../components/setlogo.js';
import { tileHTML, patchTile } from '../components/tile.js';
import { imgHTML, cardImg } from '../data/images.js';
import * as catalog from '../data/catalog.js';
import * as prices from '../data/prices.js';
import { SHORT, LABEL, DOT, sortFinishes } from '../data/finishes.js';
import * as col from '../state/collection.js';
import * as prefs from '../state/prefs.js';
import { progressOf, pctOf, barHTML } from './setrow.js';

const VIEWS = [['grille', 'Grille', 'grid'], ['liste', 'Liste à cocher', 'list'], ['classeur', 'Classeur', 'binder']];
const FILTERS = [['', 'Toutes'], ['possedees', 'Possédées'], ['manquantes', 'Manquantes']];
const SORTS = [['', 'Par numéro'], ['prix', 'Prix décroissant'], ['prix-asc', 'Prix croissant'], ['nom', 'Par nom']];
const POCKETS = 9;                 // pochettes par page de classeur
const TAP_GUARD = 450;             // ms : un 2e appui sur la même coche dans ce délai est un double appui accidentel
// version « de base » d'une carte (sa cote en mode une par carte) : normale, sinon holo, sinon reverse…
const BASE = ['normal', 'holo', 'reverse', 'cosmos', 'firstEdition', 'stamp', 'pokeball', 'masterball'];

let el = null, headEl = null, toolsEl = null, tipEl = null, bodyEl = null;
let cur = null;                    // { id, s: { meta, cards, byId, live?, finishesKnown? }, meta, bloc }
const st = { vue: 'grille', filtre: '', master: false, tri: '', page: 1 };
const taps = new Map();            // « id|finition » -> instant du dernier appui (coches)
let swipe = null;
let lastSig = null;                // signal du dernier show() / resume() : « Réessayer » s'arrête si la vue est quittée
const noPrices = new Set();        // séries dont le fichier de cotes n'a pas pu être chargé (dernier essai)

// ---------- données ----------
const baseFin = c => BASE.find(f => c.finishes.includes(f)) || c.finishes[0] || 'normal';
// versions d'une carte : celles du catalogue, plus celles que je possède (ajoutées à la main)
const versionsOf = c => { const r = col.get(c.id); return r ? sortFinishes([...c.finishes, ...Object.keys(r.qty)]) : c.finishes; };
const priceOf = (c, f) => prices.eur(c.id, f || baseFin(c));
const masterKnown = () => !cur.s.live || cur.s.finishesKnown !== false;

// fichier de cotes demandé ; s'il n'arrive pas (hors ligne, délai), la ligne « Valeur » le dit au lieu d'attendre
function askPrices(id) {
  noPrices.delete(id);
  return prices.ensure([id]).then(() => {
    if (prices.has(id)) return;
    noPrices.add(id);
    if (cur?.id === id && cur.s) patchValue();
  });
}

function readParams(q) {
  const v = q.get('vue');
  st.vue = VIEWS.some(x => x[0] === v) ? v : 'grille';
  const f = q.get('filtre');
  st.filtre = f === 'possedees' || f === 'manquantes' ? f : '';
  st.master = q.get('master') === '1';
  const t = q.get('tri');
  st.tri = t && SORTS.some(x => x[0] === t) ? t : '';
  st.page = Math.max(1, parseInt(q.get('page'), 10) || 1);
}

// une entrée par carte, ou par version en master set : { c, f (null = la carte), n (quantité), i (rang) }
function entries(master = st.master) {
  const out = [];
  cur.s.cards.forEach((c, i) => {
    if (master) for (const f of versionsOf(c)) out.push({ c, f, n: col.qtyOf(c.id, f), i });
    else out.push({ c, f: null, n: col.qtyOf(c.id), i });
  });
  return out;
}

function sorted(list) {
  if (!st.tri) return list;
  if (st.tri === 'nom') {
    const k = new Map(list.map(e => [e.c, norm(e.c.name)]));
    return [...list].sort((a, b) => k.get(a.c).localeCompare(k.get(b.c), 'fr') || a.i - b.i);
  }
  const sign = st.tri === 'prix' ? -1 : 1;
  return list.map(e => [e, priceOf(e.c, e.f)])
    .sort((a, b) => (a[1] == null) - (b[1] == null) || (a[1] - b[1]) * sign || a[0].i - b[0].i)
    .map(x => x[0]);
}

function masterProg() {
  let owned = 0, goal = 0;
  for (const c of cur.s.cards) for (const f of versionsOf(c)) { goal++; if (col.qtyOf(c.id, f)) owned++; }
  return { owned, goal, ...pctOf(owned, goal) };
}

// valeurs (somme des cotes connues) : une version par carte, toutes les versions, mes exemplaires
function values() {
  const cards = cur.s.cards;
  return {
    base: prices.sum(cards.map(c => ({ id: c.id, finish: baseFin(c) }))),
    master: prices.sum(cards.flatMap(c => versionsOf(c).map(f => ({ id: c.id, finish: f })))),
    mine: prices.sum(col.inSet(cur.id).flatMap(r => Object.entries(r.qty).map(([f, n]) => ({ id: r.id, finish: f, n })))),
  };
}

// ---------- en-tête ----------
function progRow(label, p) {
  return html`<div class="prog${p.done ? ' done' : ''}"><span class="lbl">${label}</span><b>${num(p.owned)} / ${num(p.goal)}</b>${barHTML(p, 'wide')}<span class="pc">${p.done ? 'Complète' : `${p.pc} %`}</span></div>`;
}

function countsText(m, p) {
  const secrets = (m.count || 0) > (m.total || 0) && p.goal === m.total ? m.count - m.total : 0;
  return `${plural(p.goal, 'carte', 'cartes')}${secrets ? ` · +${num(secrets)} secrète${secrets > 1 ? 's' : ''}${p.secret ? ` (${num(p.secret)} à toi)` : ''}` : ''}`;
}

// ligne « Valeur » de l'en-tête (une version par carte ; le détail est dans la feuille) : bouton vers la feuille
function valueHTML() {
  const lbl = html`<span class="lbl">Valeur</span>`;
  if (!cur?.s || !prices.has(cur.id)) {
    // cotes absentes après un essai : la ligne reste un bouton, la feuille réessaie
    if (cur?.s && noPrices.has(cur.id)) return html`${lbl}<span class="k">Cotes indisponibles</span>${icon('chevron-right', { cls: 'chev' })}`;
    return html`${lbl}<span class="sk sk-v" aria-label="Cotes en chargement"></span>`;
  }
  const v = values();
  if (!v.base.priced && !v.master.priced) return html`${lbl}<span class="k">Pas de cote Cardmarket</span>`;
  return html`${lbl}<b>${eur(v.base.value)}</b><span class="k">${v.mine.priced ? `· tes cartes ${eur(v.mine.value)}` : ''}</span>${icon('chevron-right', { cls: 'chev' })}`;
}

function dynHTML() {
  const m = cur.meta, p = progressOf(m);
  return html`${progRow('Cartes', p)}${cur.s && masterKnown() ? progRow('Master set', masterProg()) : ''}<button type="button" class="prog sh-val" data-value>${valueHTML()}</button>`;
}

function headHTML() {
  const m = cur.meta;
  const legal = m.legal?.standard ? 'Standard' : m.legal?.expanded ? 'Étendu' : '';
  const l1 = [m.code, legal].filter(Boolean).join(' · ');
  return html`<div class="sh-top">${setLogoHTML(m, { size: 'hero' })}<div class="sh-facts">${
    l1 || m.sym ? html`<span class="sh-l1">${setSymHTML(m, { size: 16 })}<span>${l1}</span></span>` : ''}<span class="sh-l2">${countsText(m, progressOf(m))}</span></div></div><div class="sh-prog">${dynHTML()}</div>`;
}

function patchHead() {
  if (!cur) return;
  const p = headEl.querySelector('.sh-prog'), l2 = headEl.querySelector('.sh-l2');
  if (p) setHTML(p, dynHTML());
  if (l2) l2.textContent = countsText(cur.meta, progressOf(cur.meta));
}

function patchValue() {
  const v = headEl.querySelector('.sh-val');
  if (v) setHTML(v, valueHTML());
}

// ---------- focus clavier ----------
// un rendu qui remplace le bouton activé au clavier lui rend le focus (même data-*, ou l'autre flèche si celle-ci
// est grisée) ; après un clic à la souris, rien n'est forcé
const KEYS = ['data-filtre', 'data-vue', 'data-master', 'data-page'];
function focusKey() {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !el.contains(a)) return null;
  try { if (!a.matches(':focus-visible')) return null; } catch { /* sélecteur inconnu (ancien Safari) : on rend le focus */ }
  const k = KEYS.find(x => a.hasAttribute(x));
  return k ? [k, a.getAttribute(k)] : null;
}
function refocus(key) {
  if (!key) return;
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected && !a.disabled && el.contains(a)) return;
  let b = el.querySelector(`[${key[0]}="${CSS.escape(key[1])}"]`);
  if (key[0] === 'data-page' && (!b || b.disabled)) b = el.querySelector(`[data-page="${-key[1]}"]`);
  if (b && !b.disabled) b.focus({ preventScroll: true });
}

// ---------- barre d'outils ----------
const masterInner = () => html`${st.master ? icon('check') : ''}Master set`;
// mise en page de la barre : classeur (sans filtre ni tri) ou non, puce Master set ou non
const layoutOf = () => `${st.vue === 'classeur' ? 'classeur' : 'std'}${!cur?.s || masterKnown() ? '+m' : ''}`;

function toolsHTML() {
  const views = html`<div class="seg vws" role="group" aria-label="Affichage">${
    VIEWS.map(([v, t, ic]) => html`<button type="button" data-vue="${v}" aria-pressed="${st.vue === v ? 'true' : 'false'}" aria-label="${t}" title="${t}">${icon(ic)}</button>`)}</div>`;
  const master = !cur?.s || masterKnown()
    ? html`<button type="button" class="chip" data-master aria-pressed="${st.master ? 'true' : 'false'}">${masterInner()}</button>` : '';
  // classeur : ni filtre ni tri (toutes les cartes dans l'ordre des numéros), seulement le master set
  if (st.vue === 'classeur') return html`<div class="toolbar ser-tools">${master}${views}</div>`;
  return html`<div class="toolbar ser-tools"><div class="seg flt" role="group" aria-label="Filtrer les cartes">${
    FILTERS.map(([v, t]) => html`<button type="button" data-filtre="${v}" aria-pressed="${st.filtre === v ? 'true' : 'false'}">${t}</button>`)}</div>${views}</div><div class="chips ser-opts" role="group" aria-label="Tri et versions">${
    selectChip({ label: 'Trier les cartes', options: SORTS, value: st.tri, name: 'tri' })}${master}</div>`;
}

function tipHTML() {
  if (!tipWanted()) return '';
  return html`<div class="ser-tip" role="note">${icon('info')}<span class="grow">Touche une version pour l’ajouter ou la retirer.</span><button type="button" class="ibtn sm" data-tip-x aria-label="Masquer l’astuce">${icon('close')}</button></div>`;
}

const tipWanted = () => st.vue === 'liste' && !prefs.get('setListTip', false);

function renderTools() {
  setHTML(toolsEl, toolsHTML());
  toolsEl.dataset.layout = layoutOf();
  setHTML(tipEl, tipHTML());
}

// boutons pressés corrigés en place : le focus reste sur le bouton touché. Entrée ou sortie du classeur (autre
// mise en page) : barre refaite, focus rendu au bouton équivalent.
function patchTools() {
  if (toolsEl.dataset.layout !== layoutOf()) { const key = focusKey(); renderTools(); refocus(key); return; }
  for (const b of toolsEl.querySelectorAll('[data-filtre]')) b.setAttribute('aria-pressed', String(b.dataset.filtre === st.filtre));
  for (const b of toolsEl.querySelectorAll('[data-vue]')) b.setAttribute('aria-pressed', String(b.dataset.vue === st.vue));
  const m = toolsEl.querySelector('[data-master]');
  if (m) { m.setAttribute('aria-pressed', String(st.master)); setHTML(m, masterInner()); }
  if (tipWanted() !== !!tipEl.firstElementChild) setHTML(tipEl, tipHTML());
}

// ---------- corps : grille ----------
function emptyHTML() {
  if (st.filtre === 'possedees') return html`<div class="empty" data-content><span class="ic">${icon('collection')}</span><b>Aucune carte possédée</b><p>Passe en liste à cocher pour ajouter tes cartes d’un appui.</p></div>`;
  if (st.filtre === 'manquantes') return html`<div class="empty" data-content><span class="ic">${icon('check')}</span><b>${st.master ? 'Master set complet' : 'Série complète'}</b><p>Il ne te manque aucune ${st.master ? 'version' : 'carte'} de cette série.</p></div>`;
  return html`<div class="empty" data-content><span class="ic">${icon('series')}</span><b>Aucune carte</b><p>Cette série n’a pas encore de cartes dans le catalogue français.</p></div>`;
}

function tileOf(e) {
  const no = localNo(e.c.localId);
  return tileHTML(e.c, { qty: e.n, finish: e.f, missing: !e.n, price: priceOf(e.c, e.f), meta: e.f ? `${no} · ${SHORT[e.f] || e.f}` : no });
}

function renderGrid() {
  let list = entries();
  if (st.filtre === 'possedees') list = list.filter(e => e.n);
  else if (st.filtre === 'manquantes') list = list.filter(e => !e.n);
  if (!list.length) { setHTML(bodyEl, emptyHTML()); return Promise.resolve(true); }
  setHTML(bodyEl, raw('<div class="grid ser-grid"></div>'));
  return renderChunked(bodyEl.firstChild, sorted(list), tileOf, { first: 36, batch: 120 });
}

// ---------- corps : liste à cocher ----------
const tickInner = (f, n) => html`${n ? icon('check') : raw(`<i class="${DOT[f] || ''}"></i>`)}${SHORT[f] || f}${n > 1 ? html` <b>×${n}</b>` : ''}`;
const tickHTML = (c, f) => {
  const n = col.qtyOf(c.id, f);
  return html`<button type="button" class="tick" data-f="${f}" aria-pressed="${n ? 'true' : 'false'}" aria-label="${LABEL[f] || f}${n > 1 ? `, ${n} exemplaires` : ''}">${tickInner(f, n)}</button>`;
};

function rowOf(e) {
  const c = e.c, p = priceOf(c, null), href = cardHref(c.id);
  return html`<div class="row chk${e.n ? ' own' : ''}" data-card="${c.id}"><span class="no">${localNo(c.localId)}</span><a class="thumb" href="${href}" tabindex="-1" aria-hidden="true">${
    imgHTML(c, { q: 'low' })}</a><span class="body"><span class="chk-top"><a class="t" href="${href}">${c.name}</a><span class="pr">${p != null ? eur(p) : ''}</span></span><span class="ticks" role="group" aria-label="Versions de ${c.name}">${
    versionsOf(c).map(f => tickHTML(c, f))}</span></span></div>`;
}

function renderList() {
  let list = entries(false);
  if (st.filtre === 'possedees') list = list.filter(e => e.n);
  else if (st.filtre === 'manquantes') list = list.filter(e => (st.master ? versionsOf(e.c).some(f => !col.qtyOf(e.c.id, f)) : !e.n));
  if (!list.length) { setHTML(bodyEl, emptyHTML()); return Promise.resolve(true); }
  setHTML(bodyEl, raw('<div class="group ser-chk"></div>'));
  return renderChunked(bodyEl.firstChild, sorted(list), rowOf, { first: 30, batch: 80 });
}

function patchRow(row, c) {
  const fins = versionsOf(c);
  const box = row.querySelector('.ticks');
  const btns = [...box.children];
  if (btns.length !== fins.length || btns.some((b, i) => b.dataset.f !== fins[i])) setHTML(box, html`${fins.map(f => tickHTML(c, f))}`);
  else {
    for (const b of btns) {                              // en place : le focus clavier reste sur la coche
      const f = b.dataset.f, n = col.qtyOf(c.id, f);
      b.setAttribute('aria-pressed', n ? 'true' : 'false');
      b.setAttribute('aria-label', `${LABEL[f] || f}${n > 1 ? `, ${n} exemplaires` : ''}`);
      setHTML(b, tickInner(f, n));
    }
  }
  row.classList.toggle('own', col.has(c.id));
}

// appui sur une coche : ajoute (0 → 1) ou retire (1 → 0, avec « Annuler ») ; plusieurs exemplaires → la fiche
function onTick(b) {
  const row = b.closest('.chk');
  const c = row && cur?.s.byId.get(row.dataset.card);
  if (!c) return;
  const f = b.dataset.f, key = `${c.id}|${f}`, now = performance.now();
  if (now - (taps.get(key) || -1e9) < TAP_GUARD) return;   // double appui accidentel : le second est ignoré
  taps.set(key, now);
  const n = col.qtyOf(c.id, f);
  if (n > 1) { go(cardHref(c.id, f)); return; }
  try { col.setQty(c, f, n ? 0 : 1); } catch (e) { console.error(e); return; }
  if (n) toast(`${c.name} (${SHORT[f] || f}) retirée`, { action: 'Annuler', onAction: () => col.setQty(c, f, 1) });
}

// ---------- corps : classeur ----------
// ordinateur large : double page, comme un classeur ouvert (la page de gauche est impaire)
const WIDE = typeof matchMedia === 'function' ? matchMedia('(min-width: 1100px)') : null;
const perView = () => (WIDE?.matches ? 2 : 1);
const binderList = () => entries();
const pagesOf = list => Math.max(1, Math.ceil(list.length / POCKETS));
const firstPage = (p, k) => (k === 2 ? p - ((p - 1) % 2) : p);

function binderLabel(list, pages) {
  const k = perView(), p0 = firstPage(st.page, k), p1 = Math.min(pages, p0 + k - 1);
  const slice = list.slice((p0 - 1) * POCKETS, p1 * POCKETS);
  const have = slice.filter(e => e.n).length;
  const a = localNo(slice[0]?.c.localId || ''), z = localNo(slice.at(-1)?.c.localId || '');
  return html`<b>${p1 > p0 ? `Pages ${num(p0)}–${num(p1)}` : `Page ${num(p0)}`} / ${num(pages)}</b><span>${a === z ? a : `${a}–${z}`} · ${num(have)} sur ${num(slice.length)}</span>`;
}

const pocketHTML = e => tileHTML(e.c, { qty: e.n, finish: e.f, missing: !e.n, meta: ' ' });
function pageHTML(list, p, dir) {
  const slice = list.slice((p - 1) * POCKETS, p * POCKETS);
  return html`<div class="binder-page${dir > 0 ? ' turn-next' : dir < 0 ? ' turn-prev' : ''}">${slice.map(pocketHTML)}${
    raw('<span class="pocket" aria-hidden="true"></span>'.repeat(POCKETS - slice.length))}</div>`;
}

function renderBinder(dir = 0) {
  const list = binderList(), pages = pagesOf(list), k = perView();
  st.page = Math.min(Math.max(1, st.page), pages);
  const p0 = firstPage(st.page, k);
  const shown = k === 2 ? [p0, p0 + 1] : [p0];
  const on = p => shown.includes(p);
  const nav = pages > 30
    ? html`<div class="ser-pos" aria-hidden="true"><i style="width:${(100 * Math.min(k, pages)) / pages}%;left:${((p0 - 1) * 100) / pages}%"></i></div>`
    : html`<div class="dots" aria-hidden="true">${raw(Array.from({ length: pages }, (_, i) => `<i${on(i + 1) ? ' class="on"' : ''}></i>`).join(''))}</div>`;
  const prevOff = p0 <= 1, nextOff = p0 + k - 1 >= pages;
  const box = bodyEl.querySelector(':scope > .ser-binder');
  if (box && box.classList.contains('spread') === (k === 2)) {
    // classeur déjà affiché : pages changées en place (flèches, étiquette lue à voix haute et focus gardés)
    const key = focusKey();
    const [prev, next] = box.querySelectorAll('.binder-head [data-page]');
    prev.disabled = prevOff;
    next.disabled = nextOff;
    setHTML(box.querySelector('.binder-head .lbl'), binderLabel(list, pages));
    setHTML(box.querySelector('.ser-pages'), html`${shown.map(p => pageHTML(list, p, dir))}`);
    box.querySelector(':scope > .dots, :scope > .ser-pos')?.remove();
    box.insertAdjacentHTML('beforeend', String(nav));
    refocus(key);
  } else {
    setHTML(bodyEl, html`<div class="ser-binder${k === 2 ? ' spread' : ''}" role="region" aria-label="Classeur"><div class="binder-head"><button type="button" class="ibtn" data-page="-1" aria-label="Page précédente"${prevOff ? raw(' disabled') : ''}>${icon('chevron-left')}</button><div class="lbl" aria-live="polite">${binderLabel(list, pages)}</div><button type="button" class="ibtn" data-page="1" aria-label="Page suivante"${nextOff ? raw(' disabled') : ''}>${icon('chevron-right')}</button></div><div class="ser-pages">${shown.map(p => pageHTML(list, p, dir))}</div>${nav}</div>`);
  }
  // les pages suivantes se chargent pendant qu'on regarde celles-ci : tourner est immédiat
  whenIdle(() => {
    for (const e of list.slice((p0 + k - 1) * POCKETS, (p0 + 2 * k - 1) * POCKETS)) {
      const u = cardImg(e.c, 'low').urls[0];
      if (u) { const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; im.src = u; }
    }
  }, { timeout: 1500 });
  return Promise.resolve(true);
}

function turn(d) {
  if (!cur?.s || st.vue !== 'classeur') return;
  const pages = pagesOf(binderList()), k = perView();
  const next = firstPage(st.page, k) + d * k;
  if (next < 1 || next > pages) return;
  st.page = next;
  setParams({ page: next > 1 ? next : null });
  renderBinder(d);
}
WIDE?.addEventListener?.('change', () => { if (cur?.s && el && !el.hidden && st.vue === 'classeur') renderBinder(); });

// ---------- rendu ----------
function renderBody() {
  if (!cur?.s) return Promise.resolve(false);
  bodyEl.dataset.set = cur.id;
  bodyEl.dataset.vue = st.vue;
  if (st.vue === 'liste') return renderList();
  if (st.vue === 'classeur') return renderBinder();
  return renderGrid();
}

function renderAll() {
  setHTML(headEl, headHTML());
  renderTools();
  return renderBody();
}

const skeleton = () => raw(`<div class="grid" aria-busy="true" aria-label="Chargement">${'<span class="sk-tile"><span class="sk-img"></span><span class="sk-l1"></span><span class="sk-l2"></span></span>'.repeat(9)}</div>`);

// cotes arrivées : valeur de l'en-tête, prix des tuiles et des lignes ; tri par prix refait
function onPrices(ids) {
  for (const id of ids) noPrices.delete(id);
  if (!cur?.s || !ids.includes(cur.id) || bodyEl.dataset.set !== cur.id) return;
  patchValue();
  if (st.tri.startsWith('prix') && st.vue !== 'classeur') { renderBody(); return; }
  for (const t of bodyEl.querySelectorAll('.tile[data-card]')) {
    const c = cur.s.byId.get(t.dataset.card);
    if (c) patchTile(t, { price: priceOf(c, t.dataset.finish || null) });
  }
  for (const r of bodyEl.querySelectorAll('.chk[data-card]')) {
    const c = cur.s.byId.get(r.dataset.card), p = c ? priceOf(c, null) : null;
    const pr = r.querySelector('.pr');
    if (pr) pr.textContent = p != null ? eur(p) : '';
  }
}

// carte de la série modifiée : tuiles (une par carte, ou par version en master set) et ligne de la liste
function patchOne(t) {
  const id = t.dataset.card, f = t.dataset.finish, n = f ? col.qtyOf(id, f) : col.qtyOf(id);
  patchTile(t, { qty: n, missing: !n });
}
function patchCard(id) {
  const c = cur.s.byId.get(id);
  if (!c) return;
  const sel = CSS.escape(id);
  for (const r of bodyEl.querySelectorAll(`.chk[data-card="${sel}"]`)) patchRow(r, c);
  for (const t of bodyEl.querySelectorAll(`.tile[data-card="${sel}"]`)) patchOne(t);
}
// collection rechargée (import, autre onglet) : tout ce qui est affiché, en un passage
function patchAll() {
  for (const r of bodyEl.querySelectorAll('.chk[data-card]')) { const c = cur.s.byId.get(r.dataset.card); if (c) patchRow(r, c); }
  for (const t of bodyEl.querySelectorAll('.tile[data-card]')) patchOne(t);
}

function patchBinderLabel() {
  const lbl = bodyEl.querySelector('.ser-binder .lbl');
  if (!lbl) return;
  const list = binderList();
  setHTML(lbl, binderLabel(list, pagesOf(list)));
}

// ---------- feuilles ----------
function modesSheet() {
  infoSheet('Modes d’affichage', [
    html`<p><b>Grille</b> : chaque carte de la série ; celles qui te manquent sont grisées.</p>`,
    html`<p><b>Liste à cocher</b> : touche une version pour l’ajouter ou la retirer. Avec plusieurs exemplaires, l’appui ouvre la fiche de la carte.</p>`,
    html`<p><b>Classeur</b> : la série rangée comme dans un vrai classeur, 9 cartes par page. Glisse, ou utilise les flèches du clavier, pour tourner les pages.</p>`,
    html`<p><b>Master set</b> : chaque version compte à part (normale, reverse, holo, Cosmo, Poké Ball, Master Ball, 1re édition). Les versions viennent du catalogue de chaque série.</p>`,
    html`<p><b>Progression</b> : les cartes dont le numéro est dans le total imprimé ; les secrètes (numérotées au-delà) sont comptées à part.</p>`,
  ]);
}

async function valueSheet() {
  if (!cur?.s) return;
  const id = cur.id;
  await askPrices(id);                                  // déjà chargées : immédiat ; sinon nouvel essai
  if (!cur?.s || cur.id !== id || el.hidden) return;
  const v = values(), loaded = prices.has(id);
  // fichier absent : des tirets, sans « N sans cote » (on ne sait pas lesquelles ont une cote)
  const off = loaded ? '' : html`<p>Les cotes de cette série n’ont pas pu être chargées. Vérifie ta connexion, puis rouvre cette feuille.</p>`;
  // « 207 cartes cotées · 1 sans cote » (accord : une carte, une version cotée ; un exemplaire coté)
  const sub = (x, unit, adj) => (loaded ? [x.priced ? `${plural(x.priced, unit, `${unit}s`)} ${adj}${x.priced > 1 ? 's' : ''}` : '', x.unpriced ? `${num(x.unpriced)} sans cote` : ''].filter(Boolean).join(' · ') : '');
  const row = (k, x, unit, adj) => html`<div class="row dl"><span class="k">${k}</span><span class="v"><b class="price">${x.priced ? eur(x.value) : '—'}</b><small>${sub(x, unit, adj)}</small></span></div>`;
  openSheet({
    title: 'Valeur de la série',
    body: html`<div class="group ser-val">${row('Une par carte', v.base, 'carte', 'cotée')}${row('Master set', v.master, 'version', 'cotée')}${row('Tes cartes', v.mine, 'exemplaire', 'coté')}</div><div class="prose ser-val-note">${off}<p>Somme des cotes Cardmarket connues (tendance), en euros. Une carte sans cote ne compte pas.</p><p>${prices.creditText()}</p></div>`,
  });
}

// ---------- chargement ----------
async function open(id, signal) {
  if (signal?.aborted) return;                          // vue quittée (« Réessayer » tardif) : rien n'est touché
  const meta0 = catalog.metaSync(id);
  const same = cur?.id === id && cur.s;
  if (!same) {
    cur = { id, s: null, meta: meta0 || { id, name: id, total: 0, count: 0, legal: {} }, bloc: '' };
    bodyEl.dataset.set = '';
    setHTML(headEl, meta0 ? headHTML() : '');
    renderTools();
    setHTML(bodyEl, skeleton());
  }
  const pricesP = askPrices(id);                        // 2e requête (cotes), en parallèle des cartes
  let s, all;
  try { [s, all] = await Promise.all([catalog.set(id), catalog.sets().catch(() => null)]); } catch (e) {
    if (signal?.aborted) return;
    const nf = e?.kind === 'notfound';
    setHTML(headEl, '');
    setHTML(toolsEl, '');
    toolsEl.dataset.layout = '';
    setHTML(tipEl, '');
    setHTML(bodyEl, nf
      ? html`<div class="empty" data-content><span class="ic">${icon('series')}</span><b>Série introuvable</b><p>Elle n’est pas dans le catalogue français.</p></div>`
      : html`<div class="errrow" data-content>${icon('wifi-off')}<span class="grow">${MESSAGES[e?.kind] || 'Série indisponible'}</span><button type="button" class="btn text" data-retry>Réessayer</button></div>`);
    cur = { id, s: null, meta: meta0, bloc: '', failed: true, nf };
    return;
  }
  if (signal?.aborted) return;
  cur = { id, s, meta: s.meta, bloc: all?.blocs.find(b => b.id === s.meta.bloc)?.name || '' };
  // cotes : on les attend un instant (le premier rendu les a souvent), sinon elles arrivent ensuite (onPrices)
  if (!prices.has(id)) await Promise.race([pricesP, new Promise(r => setTimeout(r, 300))]);
  if (signal?.aborted) return;
  barFor(signal);
  await renderAll();
}

function barFor(signal) {
  if (el.hidden || signal?.aborted) return;             // une autre vue est à l'écran : sa barre reste
  const m = cur.meta;
  setBar({
    title: m?.name || 'Série', back: true, signal,
    subtitle: [cur.bloc, m?.date ? dateFr(m.date) : ''].filter(Boolean).join(' · '),
    menu: [
      { icon: 'info', label: 'Modes d’affichage', onClick: modesSheet },
      { icon: 'market', label: 'Valeur de la série', onClick: valueSheet },
    ],
  });
}

export default {
  mount(section) {
    el = section;
    el.innerHTML = '<div class="ser-head"></div><div class="ser-toolbox"></div><div class="ser-tipbox"></div><div class="ser-body"></div>';
    headEl = el.querySelector('.ser-head');
    toolsEl = el.querySelector('.ser-toolbox');
    tipEl = el.querySelector('.ser-tipbox');
    bodyEl = el.querySelector('.ser-body');

    delegate(el, 'click', '[data-filtre]', (e, b) => {
      if (b.dataset.filtre === st.filtre) return;
      st.filtre = b.dataset.filtre;
      setParams({ filtre: st.filtre || null });
      patchTools();
      renderBody();
    });
    delegate(el, 'click', '[data-vue]', (e, b) => {
      if (b.dataset.vue === st.vue) return;
      st.vue = b.dataset.vue;
      setParams({ vue: st.vue === 'grille' ? null : st.vue });
      patchTools();
      renderBody();
      // classeur : la barre d'outils remonte sous la barre d'app, la page entière tient à l'écran
      if (st.vue === 'classeur' && bodyEl.getBoundingClientRect().bottom > innerHeight - 64) {
        const top = document.getElementById('appbar')?.getBoundingClientRect().bottom || 0;
        scrollTo({ top: scrollY + toolsEl.getBoundingClientRect().top - top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    });
    delegate(el, 'change', 'select[name="tri"]', (e, s) => {
      st.tri = SORTS.some(x => x[0] === s.value) ? s.value : '';
      setParams({ tri: st.tri || null });
      renderBody();
    });
    delegate(el, 'click', '[data-master]', () => {
      // classeur : on reste sur la même carte en changeant de mode
      const first = st.vue === 'classeur' && cur?.s ? binderList()[(st.page - 1) * POCKETS]?.c : null;
      st.master = !st.master;
      if (first) {
        const i = binderList().findIndex(e => e.c === first);
        st.page = i < 0 ? 1 : Math.floor(i / POCKETS) + 1;
      }
      setParams({ master: st.master ? 1 : null, page: st.vue === 'classeur' && st.page > 1 ? st.page : null });
      patchTools();
      patchHead();
      renderBody();
    });
    delegate(el, 'click', '.tick', (e, b) => onTick(b));
    delegate(el, 'click', '[data-page]', (e, b) => turn(+b.dataset.page));
    delegate(el, 'click', '[data-tip-x]', () => { prefs.set('setListTip', true); setHTML(tipEl, ''); });
    delegate(el, 'click', '[data-value]', () => valueSheet());
    // signal de la route affichée : si on quitte la page pendant le nouvel essai, ni la barre ni le DOM ne bougent
    delegate(el, 'click', '[data-retry]', () => { if (cur?.id) open(cur.id, lastSig); });

    // classeur : glisser pour tourner les pages, flèches du clavier
    bodyEl.addEventListener('touchstart', e => {
      const t = e.touches[0];
      swipe = st.vue === 'classeur' && e.touches.length === 1 && e.target.closest?.('.ser-pages') ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    bodyEl.addEventListener('touchend', e => {
      if (!swipe) return;
      const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
    }, { passive: true });
    document.addEventListener('keydown', e => {
      if (!cur?.s || el.hidden || st.vue !== 'classeur' || sheetOpen() || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
    });
    prices.on(onPrices);
  },

  async show(r) {
    const { signal } = r;
    lastSig = signal;
    const id = param(r);
    readParams(r.q);
    const meta0 = catalog.metaSync(id);
    setBar({ title: meta0?.name || 'Série', subtitle: meta0?.date ? dateFr(meta0.date) : '', back: true, signal });
    if (cur?.id === id && cur.s) {                      // même série, autres paramètres : pas de nouvelle requête
      if (!prices.has(id)) askPrices(id);               // sauf les cotes, si elles manquaient
      barFor(signal);
      await renderAll();
      return;
    }
    await open(id, signal);
  },

  // retour depuis le cache : la page est intacte ; une série en erreur (ou dont le nouvel essai a été quitté)
  // ou sans cotes est redemandée
  resume(r) {
    lastSig = r.signal;
    if (!cur?.id) return;
    if (!cur.s) { if (!cur.nf) open(cur.id, r.signal); }
    else if (!prices.has(cur.id)) askPrices(cur.id);
  },

  hide() { swipe = null; },

  // collection modifiée : corrigée en place (pas de saut de la page, les filtres s'appliquent au prochain rendu)
  onChange(events) {
    if (!cur?.s || bodyEl.dataset.set !== cur.id) return;
    const ids = new Set();
    let reload = false;
    for (const e of events) {
      if (e.type === 'reload') reload = true;
      else if (e.type === 'qty' && catalog.setIdOf(e.id) === cur.id) ids.add(e.id);
    }
    if (reload) patchAll();
    else if (!ids.size) return;
    else for (const id of ids) patchCard(id);
    patchHead();
    patchBinderLabel();
  },
};
