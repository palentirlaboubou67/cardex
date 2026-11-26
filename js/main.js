// Démarrage de Cardex : thème, routeur, vues (chargées à la demande et gardées en cache), barre d'onglets,
// liens internes, tâches de fond (succès, valeur du jour, envies), service worker et annonce des mises à jour.
import * as router from './core/router.js';
import { setBar, getBar, focusTitle } from './core/appbar.js';
import * as sheet from './core/sheet.js';
import { toast } from './core/toast.js';
import { whenIdle } from './core/idle.js';
import { html, enhance } from './core/dom.js';
import { icon, injectSprite } from './core/icons.js';
import * as collection from './state/collection.js';
import * as prefs from './state/prefs.js';
import * as images from './data/images.js';

// ---------- Thème (le script en tête de index.html l'a déjà posé avant le premier affichage) ----------
const THEME_COLOR = { light: '#f6f6f7', dark: '#0e0e11' };
export function applyTheme(t = prefs.get('theme', 'auto')) {
  const forced = t === 'light' || t === 'dark' ? t : null;
  const root = document.documentElement;
  if (forced) root.dataset.theme = forced; else delete root.dataset.theme;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.content = THEME_COLOR[forced || (/dark/.test(m.media) ? 'dark' : 'light')];
  }
}

// ---------- Vues : un module par route, une <section> par vue, gardée en cache ----------
// Contrat (SPEC §3.1) : mount(el) une fois ; show(r, el) à chaque nouvelle route (appelle setBar, résout quand le
// premier écran est dans le DOM) ; hide() quand une autre vue s'affiche ; onChange(events) pour la collection.
// Retour sur une vue qui montre encore les mêmes paramètres : show() n'est PAS rappelée (DOM et défilement intacts),
// la barre d'app est remise telle quelle et resume?(r, el) est appelée si la vue la définit (caméra, minuteries).
const FILES = {
  collection: 'collection', poke: 'pokemon', settings: 'reglages', sets: 'series', set: 'serie', card: 'carte',
  scan: 'scanner', market: 'marche', product: 'produit', decks: 'decks', deck: 'deck',
};
const TITLES = {
  collection: 'Collection', poke: 'Pokémon', settings: 'Réglages', sets: 'Séries', set: 'Série', card: 'Carte',
  scan: 'Scanner', market: 'Marché', product: 'Produit', decks: 'Decks', deck: 'Deck',
};
const views = new Map();            // nom -> { el, mod, loading, hash, bar, stale, shows }
const log = [];                     // « hash|onglet » de chaque rendu (tests)
let outlet = null, current = null, token = 0, rendering = 0;
const safe = fn => { try { return fn(); } catch (e) { console.error(e); } };

function section(name) {
  let v = views.get(name);
  if (!v) {
    const el = document.createElement('section');
    el.className = 'view';
    el.id = `v-${name}`;
    el.hidden = true;
    el.setAttribute('aria-labelledby', 'bar-title');
    outlet.appendChild(el);
    v = { el, mod: null, loading: null, hash: null, bar: null, stale: false, shows: 0 };
    views.set(name, v);
  }
  return v;
}

function loadView(name) {
  const v = section(name);
  if (v.mod) return Promise.resolve(v.mod);
  v.loading ??= import(`./views/${FILES[name]}.js`).then(m => {
    v.mod = m.default || m;
    safe(() => v.mod.mount?.(v.el));
    return v.mod;
  }).catch(e => { v.loading = null; throw e; });
  return v.loading;
}

function failView(v, r, e) {
  console.error(e);
  v.stale = true;
  setBar({ title: TITLES[r.view] || 'Cardex', back: !r.root });
  v.el.innerHTML = String(html`<div class="empty" data-content><span class="ic">${icon('alert')}</span><b>Écran indisponible</b><p>${navigator.onLine === false ? 'Tu es hors ligne et cet écran n’est pas encore enregistré sur l’appareil.' : 'Un fichier de l’appli n’a pas pu être chargé.'}</p><button type="button" class="btn" data-retry>Réessayer</button></div>`);
  v.el.querySelector('[data-retry]')?.addEventListener('click', () => { v.el.textContent = ''; renderRoute(router.parse() || r, router.currentTab(), { kind: 'refresh' }); }, { once: true });
}

async function renderRoute(r, tab, info = {}) {
  const my = ++token;
  rendering++;
  try {
    log.push(`${r.hash}|${tab}`);
    if (log.length > 400) log.splice(0, 200);
    highlightTab(tab);
    const root = document.documentElement;
    root.dataset.view = r.view;
    root.dataset.tab = tab;
    const prev = current;
    const v = section(r.view);
    if (prev && prev !== r.view) {
      const p = views.get(prev);
      if (p) {
        p.bar = getBar();
        p.el.hidden = true;
        if (p.mod?.hide) safe(() => p.mod.hide());
      }
    }
    current = r.view;
    v.el.hidden = false;
    const hit = v.hash === r.hash && !v.stale && v.mod && (prev === r.view || v.bar);
    if (hit) {
      if (prev !== r.view) { setBar(v.bar); safe(() => v.mod.resume?.(r, v.el)); }
    } else {
      if (prev !== r.view || !v.mod) setBar({ title: TITLES[r.view] || 'Cardex', back: !r.root });   // défaut, la vue le remplace
      let mod;
      try { mod = await loadView(r.view); } catch (e) { if (my === token) failView(v, r, e); return; }
      if (my !== token) return;
      v.hash = r.hash;
      v.stale = false;
      v.shows++;
      try { await mod.show(r, v.el); } catch (e) { if (my === token) failView(v, r, e); return; }
    }
    if (my !== token) return;
    if (info.kind && info.kind !== 'start' && info.kind !== 'refresh' && (info.kind !== 'replace' || prev !== r.view)) focusTitle();
  } finally {
    rendering--;
  }
}

function highlightTab(tab) {
  for (const a of document.querySelectorAll('.tabbar [data-tab]')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// ---------- Liens internes : tout passe par le routeur ----------
function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  if (a.dataset.tab) { e.preventDefault(); router.switchTab(a.dataset.tab); return; }
  const href = a.getAttribute('href');
  if (!href.startsWith('#/')) return;
  e.preventDefault();
  if (href === location.hash) return;
  if (a.hasAttribute('data-replace')) { router.go(href, { replace: true }); return; }
  const r = router.parse(href);
  if (r?.root && r.tab !== router.currentTab() && !a.hasAttribute('data-push')) { router.openRoot(href); return; }
  router.go(href);
}

// ---------- Pastille du Marché : une envie est dans sa fourchette ----------
let marketAlert = false;
export const hasMarketAlert = () => marketAlert;
export async function refreshMarketBadge() {
  let on = false;
  try { on = (await window.WishDB?.all?.() || []).some(w => w?.inRange); } catch {}
  marketAlert = on;
  const t = document.querySelector('.tabbar [data-tab="market"]');
  t?.querySelector('.bdg')?.toggleAttribute('hidden', !on);
  t?.querySelector('.bdg-sr')?.toggleAttribute('hidden', !on);
  document.dispatchEvent(new CustomEvent('cardex:badge', { detail: { market: on } }));
  return on;
}

// vérification des prix des envies : au plus toutes les 6 h, quand le navigateur est libre
const WISH_KEY = 'cardex.wishCheck.v1';
async function maybeCheckWishes() {
  const W = window.WishDB;
  if (!W?.check) return;
  let last = 0;
  try { last = +localStorage.getItem(WISH_KEY) || 0; } catch {}
  if (Date.now() - last < 6 * 3600e3) return;
  let list = [];
  try { list = await W.all(); } catch { return; }
  if (!list?.length) return;
  try { localStorage.setItem(WISH_KEY, String(Date.now())); } catch {}
  let hits = [];
  try { hits = (await W.check()) || []; } catch { return; }
  await refreshMarketBadge();
  document.dispatchEvent(new CustomEvent('cardex:wishes', { detail: { hits } }));
  if (!hits.length) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    try { const reg = await navigator.serviceWorker?.getRegistration?.(); if (reg) await W.notify(reg, hits); } catch {}
  }
  toast(hits.length === 1 ? `${hits[0].name} est dans ta fourchette` : `${hits.length} cartes sont dans ta fourchette`,
    { action: 'Voir', onAction: () => router.openRoot('#/marche/envies') });
}

// ---------- Service worker : hors ligne, et « Nouvelle version disponible · Recharger » ----------
function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  const sw = navigator.serviceWorker;
  let controlled = !!sw.controller, reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }      // première installation : rien à recharger
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  sw.register('sw.js').then(reg => {
    const offer = w => toast('Nouvelle version disponible', { action: 'Recharger', ms: 0, onAction: () => w.postMessage('activate-now') });
    if (reg.waiting && sw.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && sw.controller) offer(w); });
    });
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - checked > 3600e3) { checked = Date.now(); reg.update().catch(() => {}); }
    });
  }).catch(() => {});
}

// ---------- Changements de la collection : chaque vue montée corrige son DOM ----------
function onCollection(events) {
  for (const [name, v] of views) {
    if (!v.mod) continue;
    if (v.mod.onChange) safe(() => v.mod.onChange(events));
    else if (name !== current) v.stale = true;                       // redessinée au prochain affichage
    else { v.stale = true; const r = router.parse(); if (r) renderRoute(r, router.currentTab(), { kind: 'refresh' }); }
  }
}

const hasCards = () => {
  const a = safe(() => collection.all());
  return (Array.isArray(a) ? a.length : a && typeof a === 'object' ? Object.keys(a).length : 0) > 0;
};

function idleTasks() {
  import('./features/achievements.js').then(m => safe(() => m.init())).catch(e => console.error(e));
  import('./features/valuehistory.js').then(m => safe(() => m.init())).catch(e => console.error(e));
  // stockage persistant : seulement pour l'appli installée (Firefox afficherait une demande à chaque visite)
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    safe(() => navigator.storage?.persisted?.().then(p => p || navigator.storage.persist()).catch(() => {}));
  }
  safe(() => window.WishDB?.on?.(() => { refreshMarketBadge(); }));   // envie ajoutée, retirée ou vérifiée
  refreshMarketBadge().then(() => maybeCheckWishes());
  registerSW();
  // les racines des onglets se chargent d'avance : changer d'onglet est immédiat
  whenIdle(() => { for (const n of ['collection', 'sets', 'scan', 'market', 'decks']) import(`./views/${FILES[n]}.js`).catch(() => {}); });
}

// ---------- Tests (Playwright) ----------
const settled = async () => {
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 25));
    if (!router.isBusy() && !rendering) break;
  }
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
};
async function open(hash) {                // navigue comme une personne (onglet, puis lien)
  const r = router.parse(hash);
  if (!r) { location.hash = hash; return settled(); }
  if (r.root) {
    if (r.tab !== router.currentTab()) { router.switchTab(r.tab); await settled(); }
    if (router.depth() > 0) { router.switchTab(r.tab); await settled(); }
    if (location.hash !== hash) { router.go(hash, { replace: true }); await settled(); }
  } else { router.go(hash); await settled(); }
}

// ---------- Démarrage ----------
async function boot() {
  outlet = document.getElementById('outlet');
  injectSprite();
  enhance(document);
  applyTheme();
  safe(() => prefs.on?.((k, v) => { if (k === 'theme') applyTheme(v); }));
  sheet.useHistory(true);
  safe(() => images.installFallback?.(document));
  document.addEventListener('click', onClick);
  safe(() => collection.on(onCollection));
  window.__cardex = { router, sheet, toast, views, log, settled, open, applyTheme, refreshMarketBadge, version: 2 };
  // le module de la première vue se charge pendant que la table des images arrive
  const first = router.parse() || router.parse(router.LEGACY[location.hash] || '');
  if (first) import(`./views/${FILES[first.view]}.js`).catch(() => {});
  try { await Promise.race([images.ready, new Promise(r => setTimeout(r, 3000))]); } catch {}
  await router.start(renderRoute, {
    hasCards,
    isSheetOpen: sheet.isOpen,
    hideSheet: sheet.hide,
    onParams: h => { const v = views.get(current); if (v) v.hash = h; },
  });
  document.documentElement.classList.add('ready');
  whenIdle(idleTasks, { timeout: 4000 });
}

boot();
