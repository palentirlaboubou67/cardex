// Collection › Pokédex (W-J) : progression « 15 / 1 025 Pokémon », recherche (nom ou numéro), puces Tous · Possédés ·
// Manquants avec leurs nombres, grille de sprites (silhouette = pas encore dans la collection, pastille = nombre de
// cartes différentes). Un Pokémon ouvre sa page (#/pokemon/:n).
import { html, setHTML, delegate } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { num, norm } from '../../core/format.js';
import { setParams } from '../../core/router.js';
import { MESSAGES } from '../../core/net.js';
import * as col from '../../state/collection.js';
import { fill, renderGrid as paint } from './grid.js';
import { pokedex, sprite } from '../../data/dex.js';

const FILTERS = [['', 'Tous'], ['possedes', 'Possédés'], ['manquants', 'Manquants']];
const FILTER_KEYS = new Set(FILTERS.map(f => f[0]));
const no4 = n => String(n).padStart(4, '0');
const label = (p, k) => `${p.name}, numéro ${p.n}, ${k ? `${k} carte${k > 1 ? 's' : ''}` : 'pas encore dans ta collection'}`;

// une case : sprite (silhouette si absent), numéro, nom, pastille du nombre de cartes
function cellHTML(p, k) {
  return html`<a class="dexcell${k ? ' own' : ''}" href="#/pokemon/${p.n}" data-n="${p.n}" aria-label="${label(p, k)}"><span class="spr"><img src="${sprite(p.n)}" crossorigin="anonymous" loading="lazy" decoding="async" width="96" height="96" alt=""></span>${
    k ? html`<span class="qty">${k}</span>` : ''}<span class="no num">${no4(p.n)}</span><span class="nm">${p.name}</span></a>`;
}

export function create(box, api) {
  box.innerHTML = `<div class="col-dexhead"></div>
    <div class="searchbar"><label class="search">${icon('search')}<input type="search" name="dq" placeholder="Nom ou numéro" aria-label="Chercher un Pokémon par nom ou numéro" autocomplete="off" enterkeyhint="search"><button type="button" class="search-clear" aria-label="Effacer la recherche">${icon('close')}</button></label></div>
    <div class="chips col-dexchips" role="group" aria-label="Filtrer le Pokédex"></div>
    <div class="dexgrid" data-content></div>`;
  const els = { head: box.querySelector('.col-dexhead'), input: box.querySelector('input[name="dq"]'), chips: box.querySelector('.col-dexchips'), grid: box.querySelector('.dexgrid') };
  let st = { q: '', filtre: '' }, lastKey = null, rendered = false, dirty = false, busy = false;
  let DEX = null, owned = new Map(), qT = 0;
  const keyOf = s => `${s.q}|${s.filtre}`;

  const ownCount = () => { let n = 0; for (const p of DEX) if (owned.get(p.n)) n++; return n; };
  function matchQ(p) {
    const raw = st.q.replace(/^#/, '').trim();
    if (!raw) return true;
    if (/^\d+$/.test(raw)) return String(p.n).startsWith(String(+raw));
    return (p.k ??= norm(p.name)).includes(norm(raw));
  }
  const matchF = p => !st.filtre || (st.filtre === 'possedes') === !!owned.get(p.n);

  function renderHead() {
    const have = ownCount(), tot = DEX.length;
    const pc = tot ? (have / tot) * 100 : 0;
    setHTML(els.head, html`<div class="prog${have === tot && tot ? ' done' : ''}"><b class="num">${num(have)} / ${num(tot)}</b><span>Pokémon</span><span class="progress wide${have === tot && tot ? ' done' : ''}" aria-hidden="true"><i style="width:${pc.toFixed(2)}%"></i></span><span class="pc num">${pc > 0 && pc < 1 ? '< 1' : Math.floor(pc)} %</span></div>`);
  }
  function renderChips() {
    const have = ownCount(), n = { '': DEX.length, possedes: have, manquants: DEX.length - have };
    setHTML(els.chips, html`${FILTERS.map(([k, l]) => html`<button type="button" class="chip" data-dexf="${k}" aria-pressed="${st.filtre === k ? 'true' : 'false'}">${l} <span class="n">${num(n[k])}</span></button>`)}`);
  }
  function renderGrid() {
    const list = DEX.filter(p => matchF(p) && matchQ(p));
    busy = true;
    const p = paint(els.grid, list, x => cellHTML(x, owned.get(x.n) || 0), {
      first: 32, batch: 80,
      empty: html`<div class="empty" data-content><span class="ic">${icon('search')}</span><b>Aucun Pokémon</b><p>${st.q ? 'Rien ne correspond à ta recherche.' : st.filtre === 'possedes' ? 'Ajoute une carte de Pokémon pour commencer ton Pokédex.' : 'Tu les as tous.'}</p></div>`,
    });
    p.then(ok => { if (ok) busy = false; });
    return p;
  }

  async function render() {
    if (!DEX) {
      try { DEX = (await pokedex()).map(p => ({ ...p })); }
      catch (e) {
        fill(els.grid, html`<div class="errrow" data-content>${icon('wifi-off')}<span class="grow">${MESSAGES[e?.kind] || 'Pokédex indisponible'}</span><button type="button" class="btn text sm" data-act="retry">Réessayer</button></div>`);
        return;
      }
    }
    dirty = false;
    rendered = true;
    owned = new Map(col.ownedByDex());
    if (els.input.value.trim() !== st.q) els.input.value = st.q;
    renderHead();
    renderChips();
    renderGrid();          // premier lot posé tout de suite ; les suivants continuent à chaque image (show() n'attend pas)
  }

  delegate(box, 'input', 'input[name="dq"]', (e, inp) => {
    clearTimeout(qT);
    qT = setTimeout(() => {
      const v = inp.value.trim().slice(0, 40);
      if (v === st.q || !DEX || !api.shown()) return;          // écran quitté entre-temps : l'adresse n'est plus la nôtre
      st.q = v; lastKey = keyOf(st);
      setParams({ q: v || null });
      renderGrid();
    }, 150);
  });
  delegate(box, 'keydown', 'input[name="dq"]', (e, inp) => { if (e.key === 'Enter') inp.blur(); });
  delegate(box, 'click', '[data-dexf]', (e, b) => {
    const f = b.dataset.dexf || '';
    if (f === st.filtre || !DEX) return;
    st.filtre = f; lastKey = keyOf(st);
    setParams({ filtre: f || null });
    for (const c of els.chips.querySelectorAll('[data-dexf]')) c.setAttribute('aria-pressed', c.dataset.dexf === f ? 'true' : 'false');
    renderGrid();
  });
  delegate(box, 'click', '[data-act="retry"]', () => render());
  // sprite introuvable : la case garde sa place, sans image cassée
  els.grid.addEventListener('error', e => { if (e.target?.tagName === 'IMG') e.target.classList.add('gone'); }, true);

  // ---------- changements : cases corrigées (pastille, silhouette), ajoutées ou retirées sous un filtre ----------
  function patchCell(p, k) {
    const c = els.grid.querySelector(`.dexcell[data-n="${p.n}"]`);
    const keep = matchQ(p) && matchF(p);
    if (c && !keep) { c.remove(); return; }
    if (!c && keep) {
      let next = null;
      for (const x of els.grid.children) if (+x.dataset.n > p.n) { next = x; break; }
      const h = String(cellHTML(p, k));
      if (next) next.insertAdjacentHTML('beforebegin', h); else els.grid.insertAdjacentHTML('beforeend', h);
      els.grid.querySelector(':scope > .empty')?.remove();
      return;
    }
    if (!c) return;
    c.classList.toggle('own', !!k);
    c.setAttribute('aria-label', label(p, k));
    let b = c.querySelector('.qty');
    if (k) {
      if (!b) { b = document.createElement('span'); b.className = 'qty'; c.querySelector('.spr').after(b); }
      b.textContent = String(k);
    } else b?.remove();
  }

  function onChange(evs, current) {
    if (!rendered || !DEX) return;
    if (!current) { dirty = true; return; }
    if (!evs.some(e => e.type === 'reload' || (e.type === 'qty' && (e.added || e.removed)))) return;
    if (busy) { if (api.shown()) render(); else dirty = true; return; }
    const next = col.ownedByDex();
    const touched = new Set([...owned.keys(), ...next.keys()]);
    const byN = new Map(DEX.map(p => [p.n, p]));
    let changed = false;
    for (const n of touched) {
      const a = owned.get(n) || 0, b = next.get(n) || 0;
      if (a === b || !byN.has(n)) continue;
      owned.set(n, b);
      patchCell(byN.get(n), b);
      changed = true;
    }
    if (changed) {
      renderHead();
      const counts = els.chips.querySelectorAll('.n');
      const have = ownCount();
      if (counts.length === 3) { counts[1].textContent = num(have); counts[2].textContent = num(DEX.length - have); }
      if (!els.grid.querySelector('.dexcell') && !els.grid.querySelector('.empty')) renderGrid();
    }
  }

  async function show(q) {
    const next = { q: (q.get('q') || '').trim().slice(0, 40), filtre: FILTER_KEYS.has(q.get('filtre')) ? q.get('filtre') : '' };
    if (rendered && !dirty && keyOf(next) === lastKey) return;
    st = next;
    lastKey = keyOf(st);
    if (!DEX) fill(els.grid, html`<div class="dexsk" aria-busy="true" aria-label="Chargement">${Array.from({ length: 16 }, () => html`<span></span>`)}</div>`);
    await render();
  }

  return { show, resume() { if (dirty) render(); }, onChange };
}
