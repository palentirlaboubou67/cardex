// Fiche carte : détails (série, Pokédex, illustrateur, type, PV, stade, faiblesse…), talents, attaques et effets.
// Les données viennent de la fiche TCGdex complète (en direct) ; avant son arrivée, seulement ce que dit la carte brève.
import { html, raw, esc } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { cardNo, dateFr } from '../../core/format.js';
import { setHref } from '../../core/router.js';
import { setLogoHTML } from '../../components/setlogo.js';
import { sprite, nameOf } from '../../data/dex.js';

// types d'énergie (noms français de TCGdex, anglais par sécurité) -> lettre des pastilles .nrg-X de base.css
const NRG = {
  plante: 'G', feu: 'R', eau: 'W', 'électrique': 'L', electrique: 'L', psy: 'P', combat: 'F', 'obscurité': 'D', obscurite: 'D',
  'métal': 'M', metal: 'M', 'fée': 'Y', fee: 'Y', dragon: 'N', incolore: 'C',
  grass: 'G', fire: 'R', water: 'W', lightning: 'L', psychic: 'P', fighting: 'F', darkness: 'D', fairy: 'Y', colorless: 'C',
};
const NRG_NAME = { G: 'Plante', R: 'Feu', W: 'Eau', L: 'Électrique', P: 'Psy', F: 'Combat', D: 'Obscurité', M: 'Métal', Y: 'Fée', N: 'Dragon', C: 'Incolore' };
const letterOf = t => NRG[String(t || '').trim().toLowerCase()] || '';
const nameOfType = t => NRG_NAME[letterOf(t)] || String(t || '');

// pastille d'énergie décorative (le nom est dit à côté ou dans un libellé accessible)
const pill = l => raw(`<i class="nrg nrg-${l}" aria-hidden="true"></i>`);
export const nrgHTML = t => { const l = letterOf(t); return l ? pill(l) : ''; };

// coût d'une attaque : pastilles + libellé accessible (« Coût : Feu, Feu, Incolore »)
function costHTML(cost) {
  const list = (Array.isArray(cost) ? cost : []).map(letterOf).filter(Boolean);
  if (!list.length) return html`<span class="cp-cost cp-cost-0" role="img" aria-label="Sans coût"></span>`;
  return html`<span class="cp-cost" role="img" aria-label="${`Coût : ${list.map(l => NRG_NAME[l]).join(', ')}`}">${list.map(pill)}</span>`;
}

// texte d'effet : les codes {R}, {W}… deviennent des pastilles (avec leur nom pour les lecteurs d'écran)
export function effectHTML(text) {
  const s = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(/\{([GRWLPFDMYNC])\}/g)) {
    out.push(esc(s.slice(last, m.index)));
    out.push(`<i class="nrg nrg-${m[1]}" aria-hidden="true"></i><span class="sr">${NRG_NAME[m[1]]}</span>`);
    last = m.index + m[0].length;
  }
  out.push(esc(s.slice(last)));
  return raw(out.join(''));
}

const pad4 = n => `#${String(n).padStart(4, '0')}`;
// rareté affichable (TCGdex écrit « Aucune » ou « Sans Rareté » pour les promos et les kits)
export const rarityOf = r => (r && !/^(aucune|sans raret[ée]|none)$/i.test(String(r).trim()) ? r : '');
const minus = s => String(s ?? '').replace(/^-/, '−');

// ---------- liens : la série et le(s) Pokémon ----------
// meta : métadonnées de la série (logo, nom, date) ; bloc : nom de la période ; dex : numéros du Pokédex
export function linksHTML(card, meta, bloc, dex) {
  const sub = [bloc, meta?.date ? dateFr(meta.date) : ''].filter(Boolean).join(' · ');
  const setRow = html`<a class="row" href="${setHref(card.setId)}" data-up>${setLogoHTML(meta || { id: card.setId, name: card.setName }, { size: 'row' })}<span class="body"><span class="t">${meta?.name || card.setName || card.setId}</span>${
    sub ? html`<span class="s"><span>${sub}</span></span>` : ''}</span>${icon('chevron-right', { cls: 'chev' })}</a>`;
  const dexRows = (dex || []).slice(0, 3).map(n => html`<a class="row" href="${`#/pokemon/${n}`}"><span class="cp-spr"><img class="cp-spr-img" src="${sprite(n)}" crossorigin="anonymous" alt="" width="48" height="48" loading="lazy" decoding="async"></span><span class="body"><span class="t">${nameOf(n) || card.name}</span><span class="s"><span>${pad4(n)} · toutes ses cartes</span></span></span>${icon('chevron-right', { cls: 'chev' })}</a>`);
  return html`<div class="group cp-links">${setRow}${dexRows}</div>`;
}

// ---------- libellé / valeur ----------
const dl = (k, v) => html`<div class="row dl"><span class="k">${k}</span><span class="v">${v}</span></div>`;

function formatOf(full) {
  const g = full?.legal || {};
  const fmt = g.standard ? 'Standard et Étendu' : g.expanded ? 'Étendu' : 'Hors format';
  return [full?.regulationMark ? `Marque ${full.regulationMark}` : '', fmt].filter(Boolean).join(' · ');
}

const TRAINER = { Supporter: 'Supporter', Objet: 'Objet', Item: 'Objet', Outil: 'Outil', Tool: 'Outil', Stade: 'Stade', Stadium: 'Stade' };
function categoryOf(card, full) {
  const cat = full?.category || card.category || '';
  if (cat === 'Dresseur' || cat === 'Trainer') return ['Dresseur', TRAINER[full?.trainerType] || full?.trainerType].filter(Boolean).join(' · ');
  if (cat === 'Énergie' || cat === 'Energy') {
    const t = String(full?.energyType || '').toLowerCase();
    return t ? (/base|normal|basic/.test(t) ? 'Énergie de base' : 'Énergie spéciale') : 'Énergie';
  }
  return cat;
}

// faiblesse, résistance et retraite : une ligne en trois colonnes, comme le bas de la carte
function combatHTML(full) {
  const wk = (full.weaknesses || []).map(w => html`<span class="cp-ty">${nrgHTML(w.type)}<span>${nameOfType(w.type)} ${minus(w.value)}</span></span>`);
  const rs = (full.resistances || []).map(w => html`<span class="cp-ty">${nrgHTML(w.type)}<span>${nameOfType(w.type)} ${minus(w.value)}</span></span>`);
  const n = Number.isInteger(full.retreat) ? full.retreat : null;
  const rt = n == null ? '—' : n === 0 ? 'Aucune' : html`<span class="cp-ty" role="img" aria-label="${`${n} Énergie${n > 1 ? 's' : ''}`}">${Array.from({ length: Math.min(n, 5) }, () => pill('C'))}</span>`;
  return html`<div class="kv cp-combat"><div><small>Faiblesse</small><b>${wk.length ? wk : '—'}</b></div><div><small>Résistance</small><b>${rs.length ? rs : '—'}</b></div><div><small>Retraite</small><b>${rt}</b></div></div>`;
}

// carte brève seule (fiche TCGdex pas encore là) : numéro, rareté, catégorie ; full : tout le reste
// loading : la fiche est en route (deux lignes d'attente à la place du reste)
export function factsHTML(card, meta, full, { loading = false } = {}) {
  const total = meta?.total || card.setTotal || full?.set?.cardCount?.official || 0;
  const rows = [dl('Numéro', html`<span class="num">${cardNo(card.localId, total)}</span>`)];
  const rarity = rarityOf(full?.rarity || card.rarity);
  if (rarity) rows.push(dl('Rareté', rarity));
  const isPoke = (full?.category || card.category) === 'Pokémon';
  if (!isPoke) { const c = categoryOf(card, full); if (c) rows.push(dl('Catégorie', c)); }
  if (full) {
    if (full.illustrator) rows.push(dl('Illustrateur', full.illustrator));
    if (isPoke) {
      const types = (full.types || []).map(t => html`<span class="cp-ty">${nrgHTML(t)}<span>${nameOfType(t)}</span></span>`);
      const tv = [types.length ? types : null, full.hp ? html`<span class="num">${full.hp} PV</span>` : null].filter(Boolean);
      if (tv.length) rows.push(dl('Type · PV', tv.map((x, i) => (i ? html`<span class="cp-sep" aria-hidden="true">·</span>${x}` : x))));
      // « Niveau 2, évolue de Reptincel » (le suffixe ex / V est déjà dans le nom)
      const stage = [full.stage, full.evolveFrom ? `évolue de ${full.evolveFrom}` : ''].filter(Boolean).join(', ');
      if (stage) rows.push(dl('Stade', stage));
    }
    const f = formatOf(full);
    if (f) rows.push(dl('Format', f));
  }
  const combat = full && isPoke && (full.weaknesses || full.resistances || full.retreat != null) ? combatHTML(full) : '';
  const flavor = full?.description ? html`<p class="cp-flavor">${full.description}</p>` : '';
  const wait = loading && !full ? SKELETON : '';
  return html`<div class="group cp-facts">${rows}${wait}${combat}${flavor}</div>`;
}

// lignes d'attente (fiche en cours de chargement)
const SKELETON = raw('<div class="row sk-row" aria-hidden="true"><span class="body"><span class="sk-t"></span><span class="sk-s"></span></span></div>'.repeat(2));

// ---------- talents, attaques, effet ----------
// → { title, body } ou null (rien à montrer)
export function movesHTML(full) {
  if (!full) return null;
  const abil = (full.abilities || []).filter(a => a?.name || a?.effect);
  const atk = (full.attacks || []).filter(a => a?.name || a?.effect);
  if (abil.length || atk.length) {
    const rows = [
      ...abil.map(a => html`<div class="cp-move"><div class="cp-mh"><span class="cp-tag">${a.type || 'Talent'}</span><b class="grow">${a.name || ''}</b></div>${
        a.effect ? html`<p>${effectHTML(a.effect)}</p>` : ''}</div>`),
      ...atk.map(a => html`<div class="cp-move"><div class="cp-mh">${costHTML(a.cost)}<b class="grow">${a.name || ''}</b>${
        a.damage != null && a.damage !== '' ? html`<span class="cp-dmg num">${String(a.damage).replace('x', '×')}</span>` : ''}</div>${
        a.effect ? html`<p>${effectHTML(a.effect)}</p>` : ''}</div>`),
    ];
    const title = abil.length && atk.length ? 'Talents et attaques' : abil.length ? (abil.length > 1 ? 'Talents' : 'Talent') : (atk.length > 1 ? 'Attaques' : 'Attaque');
    return { title, body: html`<div class="group cp-moves">${rows}</div>` };
  }
  const eff = full.effect || full.item?.effect;
  if (eff) return { title: 'Effet', body: html`<div class="group cp-moves"><div class="cp-move"><p class="cp-eff">${effectHTML(eff)}</p></div></div>` };
  return null;
}
