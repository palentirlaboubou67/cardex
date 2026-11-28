// Collection (racine de l'onglet) : onglets principaux Cartes · Pokédex · Doubles · Succès (W-I…W-L).
// Chaque section a son conteneur, gardé : passer d'une section à l'autre ne refait rien si rien n'a changé.
// Sections dans js/views/collection/ (Cartes chargée avec la vue ; les autres à la demande, préchargées au repos).
// Collection modifiée : la section affichée corrige son DOM en place ; les autres sont refaites à leur prochain affichage.
import { setBar, primaryTabs, updateAction, setProgress } from '../core/appbar.js';
import { depth } from '../core/router.js';
import { setHTML } from '../core/dom.js';
import { infoSheet } from '../core/sheet.js';
import { whenIdle } from '../core/idle.js';
import * as prices from '../data/prices.js';
import * as col from '../state/collection.js';
import { create as createCartes } from './collection/cartes.js';

const SECTIONS = [
  { key: 'cartes', label: 'Cartes' },
  { key: 'pokedex', label: 'Pokédex' },
  { key: 'doubles', label: 'Doubles' },
  { key: 'succes', label: 'Succès' },
];
const LOAD = {
  cartes: () => Promise.resolve({ create: createCartes }),
  pokedex: () => import('./collection/pokedex.js'),
  doubles: () => import('./collection/doubles.js'),
  succes: () => import('./collection/succes.js'),
};
const href = k => `#/collection/${k}`;

let el = null, cur = null, signal = null, prefetched = false;
const secs = {};          // clé -> section créée
const loading = {};

function section(key) {
  if (secs[key]) return Promise.resolve(secs[key]);
  loading[key] ??= LOAD[key]().then(m => {
    const box = el.querySelector(`.col-sec[data-sec="${key}"]`);
    // api donnée à la section : est-elle à l'écran, barre d'app (avec le signal du rendu en cours)
    const api = {
      shown: () => cur === key && !el.hidden,
      // entonnoir de la barre : pressé quand le filtre est ouvert, inactif quand la collection est vide
      pressFilter: (on, enabled = true) => { if (cur === key) updateAction(0, { pressed: !!on, disabled: !enabled }, { signal }); },
      progress: on => setProgress(on, { signal }),
    };
    secs[key] = m.create(box, api);
    return secs[key];
  }).catch(e => { delete loading[key]; throw e; });
  return loading[key];
}

function bar(key, r) {
  // textes ⓘ : chargés au premier appui (hors du premier écran)
  const info = { icon: 'info', label: 'À propos de cet écran', onClick: () => import('./collection/shared.js').then(m => {
    const [title, paras] = m.INFO[key];
    infoSheet(title, key === 'cartes' ? [...paras, prices.creditText()] : paras);
  }) };
  // racine ouverte par-dessus un autre écran (toast « Voir » d'un succès) : ← pour y revenir
  const cfg = { title: 'Collection', back: depth() > 0, signal: r.signal, menu: [info] };
  if (key === 'cartes') {
    cfg.actions = [{ icon: 'filter', label: 'Filtrer mes cartes', pressed: !!secs.cartes?.filterOpen || !!r.q.get('q'), disabled: !col.all().length, onClick: () => secs.cartes?.toggleFilter() }];
  }
  setBar(cfg);
}

function tabs(key) {
  const slot = el.querySelector('.ptabs-slot');
  const nav = slot.querySelector('.ptabs');
  if (!nav) { setHTML(slot, primaryTabs(SECTIONS.map(s => ({ href: href(s.key), label: s.label })), href(key), 'Sections de la collection')); return; }
  // déjà là : seul l'onglet courant change (le focus clavier reste sur le lien touché)
  for (const a of nav.querySelectorAll('a')) {
    if (a.getAttribute('href') === href(key)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

export default {
  mount(section_) {
    el = section_;
    el.innerHTML = `<div class="ptabs-slot"></div>${SECTIONS.map(s => `<div class="col-sec" data-sec="${s.key}" hidden></div>`).join('')}`;
    // cotes arrivées (séries possédées, chargées au repos) : chaque section créée corrige ce qu'elle montre
    prices.on(ids => { for (const s of Object.values(secs)) { try { s.onPrices?.(ids); } catch (e) { console.error(e); } } });
  },

  async show(r) {
    const key = SECTIONS.some(s => s.key === r.m[1]) ? r.m[1] : 'cartes';
    signal = r.signal;
    cur = key;
    bar(key, r);
    tabs(key);
    for (const b of el.querySelectorAll('.col-sec')) b.hidden = b.dataset.sec !== key;
    const s = await section(key);
    if (r.signal.aborted) return;
    await s.show(r.q, r.signal);
    if (!prefetched) {
      prefetched = true;
      whenIdle(() => { for (const k of ['pokedex', 'doubles', 'succes']) LOAD[k]().catch(() => {}); }, { timeout: 6000 });
    }
  },

  resume(r) {
    signal = r.signal;
    // barre gardée par main.js : refaite, la même adresse peut être une racine (onglet) ou empilée (← ou pas)
    bar(cur, r);
    try { secs[cur]?.resume?.(); } catch (e) { console.error(e); }
  },

  hide() {},

  onChange(events) {
    for (const [k, s] of Object.entries(secs)) {
      try { s.onChange(events, k === cur); } catch (e) { console.error(e); }
    }
  },
};
