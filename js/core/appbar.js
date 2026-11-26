// Barre d'app (FINAL-design §4.1, §6.1) : ← sur chaque sous-page, titre (+ sous-titre), ≤ 2 actions, menu ⋯.
// Le menu ⋯ se termine toujours par « Réglages et sauvegarde » (sauf sur la page Réglages elle-même).
import { esc, html } from './dom.js';
import { icon } from './icons.js';
import { menuSheet } from './sheet.js';
import * as router from './router.js';

const SETTINGS = { icon: 'settings', label: 'Réglages et sauvegarde', onClick: () => router.go('#/reglages') };
let cfg = null, els = null, scrolled = false, wired = false;

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
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
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

function actionHTML(a, i) {
  const pressed = a.pressed == null ? '' : ` aria-pressed="${a.pressed ? 'true' : 'false'}"`;
  const inner = `${icon(a.icon)}${a.badge ? '<i class="bdg" aria-hidden="true"></i>' : ''}`;
  const label = esc(a.badge ? `${a.label} (${typeof a.badge === 'string' ? a.badge : 'nouveau'})` : a.label);
  if (a.href) {
    const ext = !String(a.href).startsWith('#');
    return `<a class="ibtn" data-act="${i}" href="${esc(a.href)}" aria-label="${label}"${ext ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`;
  }
  return `<button type="button" class="ibtn" data-act="${i}" aria-label="${label}"${pressed}${a.disabled ? ' disabled' : ''}>${inner}</button>`;
}

// setBar({ title, subtitle, back, titleHidden, actions, menu, menuTitle, progress })
export function setBar(c = {}) {
  cfg = { title: '', subtitle: '', back: false, titleHidden: false, actions: [], menu: [], progress: false, ...c };
  const e = dom();
  document.title = cfg.title ? `${cfg.title} · Cardex` : 'Cardex';
  if (!e) return;
  e.back.hidden = !cfg.back;
  e.title.textContent = cfg.title || '';
  e.sub.textContent = cfg.subtitle || '';
  e.sub.hidden = !cfg.subtitle;
  e.bar.classList.toggle('title-hidden', !!cfg.titleHidden);
  e.acts.innerHTML = (cfg.actions || []).slice(0, 2).map(actionHTML).join('');
  e.more.hidden = menuRows().length === 0;
  setProgress(cfg.progress);
}

// la configuration affichée (main.js la remet telle quelle au retour sur une vue gardée en cache)
export const getBar = () => (cfg ? { ...cfg, titleHidden: dom()?.bar.classList.contains('title-hidden') ?? cfg.titleHidden } : null);

// page carte : le titre apparaît quand le grand nom sort de l'écran
export function revealTitle(on) {
  const e = dom();
  if (cfg) cfg.titleHidden = !on;
  e?.bar.classList.toggle('title-hidden', !on);
}

// barre de 2 px sous la barre d'app : rafraîchissement en arrière-plan
export function setProgress(on) {
  const e = dom();
  if (cfg) cfg.progress = !!on;
  if (e) e.prog.hidden = !on;
}

// met à jour une action sans tout redessiner (ex. ☆ → ★)
export function updateAction(i, patch) {
  if (!cfg?.actions?.[i]) return;
  Object.assign(cfg.actions[i], patch);
  const e = dom();
  const old = e?.acts.querySelector(`[data-act="${i}"]`);
  if (old) old.outerHTML = actionHTML(cfg.actions[i], i);
}

export function focusTitle() {
  const e = dom();
  try { e?.title.focus({ preventScroll: true }); } catch {}
}

// Onglets principaux soulignés (sections d'une racine : Collection, Marché, Decks), collés sous la barre.
// Ce sont des liens avec data-replace : changer de section ne crée pas d'entrée d'historique.
// items = [{ href, label, dot?, dotLabel? }] ; current = le href de la section affichée.
export function primaryTabs(items, current, label = 'Sections') {
  return html`<nav class="ptabs" aria-label="${label}">${items.map(it => html`<a href="${it.href}" data-replace${
    it.href === current ? html` aria-current="page"` : ''}>${it.label}${
    it.dot ? html`<i class="dot" aria-hidden="true"></i><span class="sr">, ${it.dotLabel || 'nouveau'}</span>` : ''}</a>`)}</nav>`;
}
