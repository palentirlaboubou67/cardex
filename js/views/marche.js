// Marché : Cotes · Scellé · Mon scellé · Envies (onglets principaux, FINAL-design W-P à W-T).
// Une section par onglet, gardée dans le DOM : changer d'onglet ne redessine que ce qui a changé.
// Pastille : main.js publie l'état « une envie est dans sa fourchette » (événement cardex:badge) ; point sur Envies.
import { setBar, primaryTabs } from '../core/appbar.js';
import { html, setHTML } from '../core/dom.js';
import { infoSheet } from '../core/sheet.js';
import cotes from './marche/cotes.js';
import scelle from './marche/scelle.js';
import monScelle from './marche/monscelle.js';
import envies from './marche/envies.js';

const SECS = { cotes, scelle, 'mon-scelle': monScelle, envies };
const LABELS = { cotes: 'Cotes', scelle: 'Scellé', 'mon-scelle': 'Mon scellé', envies: 'Envies' };
let el = null, sec = null, visible = false, lastR = null;

// pastille de l'onglet Marché (posée par main.js), ou envie dans sa fourchette vue par la section Envies
const alertOn = () => {
  const b = document.querySelector('.tabbar [data-tab="market"] .bdg');
  return (!!b && !b.hidden) || envies.anyInRange();
};

const ORDER = Object.keys(LABELS);
const DOT_LABEL = 'une envie est dans ta fourchette';
// les onglets « Cotes » et « Scellé » rouvrent la vue et les filtres laissés (catalogue, recherche, type, tri),
// comme l'ancienne appli
const hrefOf = k => SECS[k].href?.() || `#/marche/${k}`;

// onglets dessinés une fois, puis corrigés sur place : le lien qui a le focus (clavier) n'est jamais remplacé
function tabs() {
  if (!el) return;
  const slot = el.querySelector('.ptabs-slot');
  const cur = sec || 'cotes';
  const dot = alertOn();
  const nav = slot.querySelector('.ptabs');
  if (!nav) {
    const items = ORDER.map(k => ({ href: hrefOf(k), label: LABELS[k], dot: k === 'envies' && dot, dotLabel: DOT_LABEL }));
    setHTML(slot, primaryTabs(items, hrefOf(cur), 'Sections du marché'));
    slot.querySelectorAll('.ptabs a').forEach((a, i) => { a.dataset.sec = ORDER[i]; });
    return;
  }
  for (const a of nav.querySelectorAll('a[data-sec]')) {
    const k = a.dataset.sec, h = hrefOf(k);
    if (a.getAttribute('href') !== h) a.setAttribute('href', h);
    if (k === cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (k !== 'envies') continue;
    const d = a.querySelector('.dot');
    if (dot && !d) a.insertAdjacentHTML('beforeend', String(html`<i class="dot" aria-hidden="true"></i><span class="sr">, ${DOT_LABEL}</span>`));
    else if (!dot && d) { a.querySelector('.sr')?.remove(); d.remove(); }
  }
}

function bar(r) {
  const s = SECS[sec];
  const info = { icon: 'info', label: 'À propos de cet écran', onClick: () => { const i = s.info(); infoSheet(i.title, i.body); } };
  setBar({ title: 'Marché', signal: r.signal, actions: [...(s.actions?.() || []), info] });
}

// donné aux sections : redessiner les onglets (pastille) ou la barre d'app (état d'une action)
const ctx = {
  refreshTabs: () => tabs(),
  refreshBar: () => { if (visible && lastR && !lastR.signal.aborted) bar(lastR); },
  signal: () => lastR?.signal || null,
};

export default {
  mount(section) {
    el = section;
    el.classList.add('mk-view');
    el.innerHTML = `<div class="ptabs-slot"></div>${Object.keys(SECS).map(k => `<div class="mk-sec" data-sec="${k}" hidden></div>`).join('')}`;
    for (const [k, s] of Object.entries(SECS)) s.mount(el.querySelector(`.mk-sec[data-sec="${k}"]`), ctx);
    document.addEventListener('cardex:badge', tabs);
  },

  async show(r) {
    lastR = r;
    const k = SECS[r.m[1]] ? r.m[1] : 'cotes';
    if (sec && sec !== k) SECS[sec].hide?.();
    sec = k;
    visible = true;
    bar(r);
    tabs();
    for (const box of el.querySelectorAll('.mk-sec')) box.hidden = box.dataset.sec !== k;
    await SECS[k].show(r);
  },

  // retour sur la vue gardée en cache (même adresse) : la section rattrape ce qui a changé pendant l'absence
  resume(r) {
    lastR = r;
    visible = true;
    tabs();
    SECS[sec]?.resume?.(r);
  },

  hide() {
    visible = false;
    SECS[sec]?.hide?.();
  },

  onChange(events) {
    for (const [k, s] of Object.entries(SECS)) s.onChange?.(events, visible && k === sec);
  },
};
