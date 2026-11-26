// Outils DOM : gabarit html`` qui échappe tout par défaut, raw() pour le HTML de confiance, $, $$, delegate().
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

// HTML sûr (déjà échappé ou de confiance)
export class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = s => (s instanceof Safe ? s : new Safe(String(s ?? '')));
export const isSafe = v => v instanceof Safe;

const part = v => (v instanceof Safe ? v.s
  : Array.isArray(v) ? v.map(part).join('')
  : v == null || v === false || v === true ? ''
  : esc(v));

// html`<b>${nom}</b>` : chaque valeur est échappée, sauf Safe et tableaux de Safe
export const html = (strings, ...vals) => new Safe(strings.reduce((out, s, i) => out + part(vals[i - 1]) + s));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// handler(e, el) pour chaque événement dont la cible est dans `selector` ; renvoie de quoi se désabonner
export function delegate(root, event, selector, handler, opts) {
  const fn = e => {
    const el = e.target instanceof Element ? e.target.closest(selector) : null;
    if (el && root.contains(el)) handler(e, el);
  };
  root.addEventListener(event, fn, opts);
  return () => root.removeEventListener(event, fn, opts);
}

export function setHTML(el, safe) { el.innerHTML = String(safe ?? ''); }

// Comportements communs, posés une fois sur le document :
//  - .search-clear vide le champ voisin et prévient la vue (événement input) ;
//  - .chip-sel recopie l'option choisie dans la puce (le select est invisible par-dessus).
let enhanced = false;
export function enhance(root = document) {
  if (enhanced) return;
  enhanced = true;
  delegate(root, 'click', '.search-clear', (e, b) => {
    const input = b.parentElement?.querySelector('input');
    if (!input) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  delegate(root, 'change', '.chip-sel select', (e, s) => {
    const v = s.parentElement?.querySelector('.v');
    if (v) v.textContent = s.selectedOptions[0]?.text || '';
  });
}

// Puce de tri : <select> natif habillé en puce. options = [[valeur, libellé], …]
export function selectChip({ label, options, value, name = '', cls = '' }) {
  const cur = options.find(([v]) => String(v) === String(value)) || options[0] || ['', ''];
  return html`<label class="chip chip-sel ${cls}"><span class="v">${cur[1]}</span><svg class="i" width="14" height="14" aria-hidden="true"><use href="#i-chevron-down"/></svg><select aria-label="${label}"${name ? raw(` name="${esc(name)}"`) : ''}>${
    options.map(([v, t]) => html`<option value="${v}"${String(v) === String(cur[0]) ? raw(' selected') : ''}>${t}</option>`)
  }</select></label>`;
}
