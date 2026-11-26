// Feuilles (bas d'écran ; dialogue centré sur ordinateur) sur <dialog>. Une seule à la fois.
// Avec le routeur, ouvrir une feuille ajoute une entrée d'historique (même hash) : Retour, Échap, le fond et ✕ la ferment.
import { html, Safe } from './dom.js';
import { icon } from './icons.js';

let dlg = null, head = null, titleEl = null, bodyEl = null;
let open = false, pushed = false, withHistory = false;
let onCloseCb = null, waiters = [], lastFocus = null, closingT = 0;

// main.js l'active quand le routeur tourne (sinon : simple fenêtre, sans historique)
export function useHistory(on = true) { withHistory = on; }
export const isOpen = () => open;

function ensure() {
  if (dlg) return;
  dlg = document.getElementById('sheet');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'sheet';
    document.body.appendChild(dlg);
  }
  dlg.className = 'sheet';
  dlg.setAttribute('aria-labelledby', 'sheet-title');
  dlg.innerHTML = `<div class="sheet-head"><span class="sheet-grip" aria-hidden="true"></span><h2 class="sheet-title" id="sheet-title"></h2><button type="button" class="ibtn sheet-x" aria-label="Fermer">${icon('close')}</button></div><div class="sheet-body"></div>`;
  head = dlg.querySelector('.sheet-head');
  titleEl = dlg.querySelector('.sheet-title');
  bodyEl = dlg.querySelector('.sheet-body');
  dlg.querySelector('.sheet-x').addEventListener('click', () => close());
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });   // Échap
  dlg.addEventListener('click', e => {                                       // clic sur le fond (hors de la boîte)
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  dragToClose();
}

// glisser la poignée vers le bas ferme la feuille (téléphone et tablette)
function dragToClose() {
  let y0 = null, dy = 0, t0 = 0;
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || matchMedia('(min-width: 900px)').matches) return;
    y0 = e.clientY; dy = 0; t0 = performance.now();
    head.setPointerCapture(e.pointerId);
    dlg.style.transition = 'none';
  });
  head.addEventListener('pointermove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    dlg.style.transform = dy ? `translateY(${dy}px)` : '';
  });
  const end = () => {
    if (y0 == null) return;
    const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
    y0 = null;
    dlg.style.transition = 'transform var(--dur-2) var(--ease)';
    if (dy > 90 || (fast && dy > 24)) { dlg.style.transform = ''; dlg.style.transition = ''; close(); }
    else { dlg.style.transform = ''; setTimeout(() => { dlg.style.transition = ''; }, 220); }
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
}

function fill(el, content) {
  el.textContent = '';
  if (content instanceof Node) el.appendChild(content);
  else if (content instanceof Safe) el.innerHTML = String(content);
  else if (content != null) el.textContent = String(content);
}

// openSheet({ title, body (Safe | Node | texte), onClose, wide, label }) → { el (corps), close() }
export function openSheet({ title = '', body = '', onClose, wide = false, label = '' } = {}) {
  ensure();
  if (open) { const prev = onCloseCb; onCloseCb = null; if (prev) queueMicrotask(() => safe(prev)); }   // remplace la feuille ouverte
  clearTimeout(closingT);
  dlg.classList.remove('closing');
  dlg.style.transform = '';
  titleEl.textContent = title;
  titleEl.hidden = !title;
  if (title) { dlg.setAttribute('aria-labelledby', 'sheet-title'); dlg.removeAttribute('aria-label'); }
  else { dlg.removeAttribute('aria-labelledby'); dlg.setAttribute('aria-label', label || 'Options'); }
  dlg.classList.toggle('wide', !!wide);
  fill(bodyEl, body);
  bodyEl.scrollTop = 0;
  onCloseCb = onClose || null;
  if (!open) {
    lastFocus = document.activeElement;
    const de = document.documentElement;
    de.style.setProperty('--sbw', `${Math.max(0, innerWidth - de.clientWidth)}px`);   // la page cesse de défiler : pas de saut
    if (!dlg.open) dlg.showModal();
    open = true;
    if (withHistory) {
      history.pushState({ ...(history.state || {}), d: (history.state?.d || 0) + 1, sheet: 1 }, '');
      pushed = true;
    }
  }
  return { el: bodyEl, close };
}

// fermeture demandée par l'interface : passe par l'historique si la feuille y a une entrée
export function close() {
  if (!open) return Promise.resolve();
  const p = new Promise(r => waiters.push(r));
  if (pushed && history.state?.sheet) history.back();   // le routeur appelle hide() au popstate
  else hide();
  return p;
}

// fermeture effective (appelée par le routeur quand Retour a retiré l'entrée de la feuille)
export function hide() {
  if (!open) return;
  open = false; pushed = false;
  const cb = onCloseCb; onCloseCb = null;
  const ws = waiters; waiters = [];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish = () => {
    clearTimeout(closingT);
    dlg.classList.remove('closing');
    if (dlg.open && !open) dlg.close();
    if (!open) bodyEl.textContent = '';
  };
  if (reduce) finish();
  else {
    dlg.classList.add('closing');
    closingT = setTimeout(finish, 210);
  }
  if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch {} }
  lastFocus = null;
  queueMicrotask(() => { if (cb) safe(cb); ws.forEach(r => r()); });
}

const safe = fn => { try { fn(); } catch (e) { console.error(e); } };

// menu ⋯ : lignes { icon, label, sub?, onClick, danger }. L'action est lancée une fois la feuille fermée.
export function menuSheet(items, title = '') {
  return new Promise(resolve => {
    let chosen = null;
    const body = html`<div class="menu list" role="menu">${items.map((it, i) => html`<button type="button" role="menuitem" class="row${it.danger ? ' danger' : ''}" data-i="${i}"><span class="lead">${icon(it.icon || 'chevron-right')}</span><span class="body"><span class="t">${it.label}</span>${it.sub ? html`<span class="s"><span>${it.sub}</span></span>` : ''}</span></button>`)}</div>`;
    const s = openSheet({
      title, body, label: 'Plus d’options',
      onClose: () => { if (chosen?.onClick) safe(() => chosen.onClick()); resolve(); },
    });
    s.el.querySelector('.menu').addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      chosen = items[+b.dataset.i];
      s.close();
    });
  });
}

// feuille d'explication ⓘ : un ou plusieurs paragraphes (texte ou Safe)
export function infoSheet(title, body) {
  const paras = Array.isArray(body) ? body : [body];
  const content = html`<div class="prose">${paras.map(p => (p instanceof Safe ? (String(p).startsWith('<') ? p : html`<p>${p}</p>`) : html`<p>${p}</p>`))}</div>`;
  return openSheet({ title, body: content });
}
