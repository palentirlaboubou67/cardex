// Ligne de série (logo, nom, progression), partagée par la liste des séries et la recherche,
// et calcul de la progression (aussi utilisé par l'en-tête de la page d'une série).
import { html, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { num, localNo } from '../core/format.js';
import { setHref } from '../core/router.js';
import { setLogoHTML } from '../components/setlogo.js';
import { goalOf } from '../data/catalog.js';
import * as col from '../state/collection.js';

// carte secrète : numéro au-delà du total imprimé (« 199/165 ») quand le catalogue en a plus que ce total
const secretTest = meta => {
  const total = meta?.total || 0;
  if (!total || goalOf(meta) !== total || (meta.count || 0) <= total) return () => false;
  return lid => { const l = localNo(lid); return /^\d+$/.test(l) && +l > total; };
};
export const isSecretOf = secretTest;

// pourcentage affiché : entier inférieur, au moins 1 % dès une carte, 100 % seulement quand c'est complet
export function pctOf(n, goal) {
  if (!goal) return { pc: 0, done: false };
  const done = n >= goal;
  const pc = done ? 100 : Math.max(n > 0 ? 1 : 0, Math.min(99, Math.floor((n * 100) / goal)));
  return { pc, done };
}

// { owned, goal, secret, pc, done } : cartes différentes possédées (hors secrètes) sur l'objectif de la série
export function progressOf(meta) {
  const goal = goalOf(meta);
  const secret = secretTest(meta);
  let owned = 0, sec = 0;
  for (const r of col.inSet(meta.id)) { if (secret(r.localId)) sec++; else owned++; }
  owned = Math.min(owned, goal || owned);
  return { owned, goal, secret: sec, ...pctOf(owned, goal) };
}

export const pctText = p => (p.done ? 'Complète' : `${p.pc} %`);

// barre de progression 4 px (largeur en %, un point dès la première carte)
export const barHTML = (p, cls = '') => html`<span class="progress${p.done ? ' done' : ''}${cls ? ` ${cls}` : ''}"><i style="width:${p.pc}%"></i></span>`;

// deuxième ligne d'une ligne de série : « 8 / 165 ▬▬▬ 5 % » (colonnes de largeur fixe : les barres sont alignées)
function lineHTML(p) {
  return html`<span class="s sp"><span class="cnt">${num(p.owned)} / ${num(p.goal)}</span>${barHTML(p)}<span class="pc${p.done ? ' ok' : ''}">${
    p.done ? raw(`${icon('check')}Complète`) : `${p.pc} %`}</span></span>`;
}

const labelOf = (meta, p) => {
  const tag = meta.tag && !meta.name.toLowerCase().includes(meta.tag.toLowerCase()) ? ` (${meta.tag})` : '';
  return `${meta.name}${tag}, ${p.owned} carte${p.owned > 1 ? 's' : ''} sur ${p.goal}, ${p.done ? 'complète' : `${p.pc} %`}`;
};

// <a class="row setrow"> vers la page de la série
export function setRowHTML(meta, p = progressOf(meta)) {
  return html`<a class="row setrow" href="${setHref(meta.id)}" data-set="${meta.id}" aria-label="${labelOf(meta, p)}">${setLogoHTML(meta)}<span class="body"><span class="t">${meta.name}</span>${lineHTML(p)}</span>${icon('chevron-right', { cls: 'chev' })}</a>`;
}

// met à jour la progression d'une ligne déjà affichée
export function patchSetRow(a, meta, p = progressOf(meta)) {
  const s = a.querySelector('.sp');
  if (s) s.outerHTML = String(lineHTML(p));
  a.setAttribute('aria-label', labelOf(meta, p));
}
