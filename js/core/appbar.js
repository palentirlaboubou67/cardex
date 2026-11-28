// Barre d'app (FINAL-design §4.1, §6.1) : ← sur chaque sous-page, titre (+ sous-titre), ≤ 2 actions, menu ⋯.
// Le menu ⋯ se termine toujours par « Réglages et sauvegarde » (sauf sur la page Réglages elle-même).
import { esc, html } from './dom.js';
import { icon } from './icons.js';
import { menuSheet } from './sheet.js';
import * as router from './router.js';

const SETTINGS = { icon: 'settings', label: 'Réglages et sauvegarde', onClick: () => router.go('#/reglages') };
let cfg = null, els = null, scrolled = false, wired = false;
let lastSig = null;                       // signal de la dernière barre posée (null : sans signal)
const bySig = new WeakMap();              // signal d'un rendu -> dernière barre posée par sa vue
const dead = o => !!o?.signal?.aborted;   // appel venu d'une vue quittée entre-temps : ignoré

function dom() {
  if (els) return els;
  const bar = document.getElementById('appbar');
  if (!bar) return null;
  els = {
    bar,
    back: bar.querySelector('.back'),
    title: bar.querySelector('h1'),
    sub: bar.querySelector('small'),
    acts: bar.querySelector('.acts'),
    more: bar.querySelector('.more'),
    prog: bar.querySelector('.bar-progress'),
  };
  if (!wired) {
    wired = true;
    els.back.addEventListener('click', () => router.back());
    els.more.addEventListener('click', () => openMenu());
    els.acts.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      const a = b && cfg?.actions?.[+b.dataset.act];
      if (a?.onClick) { e.preventDefault(); a.onClick(e, b); }
    });
    // pas de lecture de scrollY ici : setBar est appelé pendant le premier rendu, et lire scrollY y forcerait une mise en
    // page (longue tâche du démarrage). Le routeur repose le défilement avec scrollTo, qui envoie l'événement.
    addEventListener('scroll', onScroll, { passive: true });
  }
  return els;
}

function onScroll() {
  const s = scrollY > 2;
  if (s === scrolled || !els) return;
  scrolled = s;
  els.bar.classList.toggle('scrolled', s);
}

const onSettings = () => /^#\/reglages(\?|$)/.test(location.hash);
const menuRows = () => [...(cfg?.menu || []), ...(onSettings() ? [] : [SETTINGS])];

function openMenu() {
  const rows = menuRows();
  if (rows.length) menuSheet(rows, cfg?.menuTitle || '');
}

const labelOf = a => (a.badge ? `${a.label} (${typeof a.badge === 'string' ? a.badge : 'nouveau'})` : a.label);

function actionHTML(a, i) {
  const pressed = a.pressed == null ? '' : ` aria-pressed="${a.pressed ? 'true' : 'false'}"`;
  const inner = `${icon(a.icon)}${a.badge ? '<i class="bdg" aria-hidden="true"></i>' : ''}`;
  const label = esc(labelOf(a));
  if (a.href) {
    const ext = !String(a.href).startsWith('#');
    return `<a class="ibtn" data-act="${i}" href="${esc(a.href)}" aria-label="${label}"${ext ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`;
  }
  return `<button type="button" class="ibtn" data-act="${i}" aria-label="${label}"${pressed}${a.disabled ? ' disabled' : ''}>${inner}</button>`;
}

// setBar({ title, subtitle, back, titleHidden, actions, menu, menuTitle, progress, signal })
// signal = r.signal du show() : si la route a changé depuis (signal annulé), l'appel est ignoré et renvoie false.
// (Le second argument { signal } est accepté aussi ; { shell: true } est réservé à main.js.)
export function setBar(c = {}, o = {}) {
  const signal = o.signal || c.signal || null;
  if (signal?.aborted) return false;
  const { signal: _s, ...rest } = c || {};
  cfg = { title: '', subtitle: '', back: false, titleHidden: false, actions: [], menu: [], progress: false, ...rest };
  lastSig = signal;
  if (signal && !o.shell) bySig.set(signal, cfg);
  const e = dom();
  document.title = cfg.title ? `${cfg.title} · Cardex` : 'Cardex';
  if (!e) return true;
  e.back.hidden = !cfg.back;
  e.title.textContent = cfg.title || '';
  e.sub.textContent = cfg.subtitle || '';
  e.sub.hidden = !cfg.subtitle;
  e.bar.classList.toggle('title-hidden', !!cfg.titleHidden);
  e.acts.innerHTML = (cfg.actions || []).slice(0, 2).map(actionHTML).join('');
  e.more.hidden = menuRows().length === 0;
  e.prog.hidden = !cfg.progress;
  return true;
}

// la configuration affichée (main.js la remet telle quelle au retour sur une vue gardée en cache)
export const getBar = () => (cfg ? { ...cfg, titleHidden: dom()?.bar.classList.contains('title-hidden') ?? cfg.titleHidden } : null);
// pour main.js : qui a posé la barre affichée, et la dernière barre posée par un rendu donné
export const barSignal = () => lastSig;
export const barOf = signal => (signal && bySig.get(signal)) || null;

// page carte : le titre apparaît quand le grand nom sort de l'écran ({ signal } : ignoré si la vue a été quittée)
export function revealTitle(on, o) {
  if (dead(o)) return;
  const e = dom();
  if (cfg) cfg.titleHidden = !on;
  e?.bar.classList.toggle('title-hidden', !on);
}

// barre de 2 px sous la barre d'app : rafraîchissement en arrière-plan
export function setProgress(on, o) {
  if (dead(o)) return;
  const e = dom();
  if (cfg) cfg.progress = !!on;
  if (e) e.prog.hidden = !on;
}

// met à jour une action en place, sans recréer le bouton (le focus clavier reste dessus) : ex. ☆ → ★, pressed, badge
export function updateAction(i, patch, o) {
  if (dead(o) || !cfg?.actions?.[i]) return;
  const a = Object.assign(cfg.actions[i], patch);
  const el = dom()?.acts.querySelector(`[data-act="${i}"]`);
  if (!el) return;
  if (a.href != null && el.tagName !== 'A' || a.href == null && el.tagName === 'A') { el.outerHTML = actionHTML(a, i); return; }
  if (a.href != null) el.setAttribute('href', a.href);
  el.setAttribute('aria-label', labelOf(a));
  if (a.pressed == null) el.removeAttribute('aria-pressed'); else el.setAttribute('aria-pressed', a.pressed ? 'true' : 'false');
  if (el.tagName === 'BUTTON') el.disabled = !!a.disabled;
  el.querySelector('use')?.setAttribute('href', `#i-${a.icon}`);
  const b = el.querySelector('.bdg');
  if (a.badge && !b) el.insertAdjacentHTML('beforeend', '<i class="bdg" aria-hidden="true"></i>');
  else if (!a.badge) b?.remove();
}

export function focusTitle() {
  const e = dom();
  try { e?.title.focus({ preventScroll: true }); } catch {}
}

// Onglets principaux soulignés (sections d'une racine : Collection, Marché, Decks), collés sous la barre.
// Ce sont des liens avec data-replace : changer de section ne crée pas d'entrée d'historique.
// items = [{ href, label, dot?, dotLabel? }] ; current = le href de la section affichée.
// À placer comme enfant direct de la <section> de la vue (ou dans un conteneur .ptabs-slot, en display: contents) :
// un élément collant ne sort jamais de son parent, il ne resterait pas sous la barre.
export function primaryTabs(items, current, label = 'Sections') {
  return html`<nav class="ptabs" aria-label="${label}">${items.map(it => html`<a href="${it.href}" data-replace${
    it.href === current ? html` aria-current="page"` : ''}>${it.label}${
    it.dot ? html`<i class="dot" aria-hidden="true"></i><span class="sr">, ${it.dotLabel || 'nouveau'}</span>` : ''}</a>`)}</nav>`;
}
