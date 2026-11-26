// Pokédex : noms français (data/pokedex.json, index = numéro − 1), numéros devinés d'après le nom d'une carte, sprites.
import { data } from '../core/net.js';

// Sprites PokéAPI épinglés sur un commit jsDelivr : réponses « immutable » (un an), CORS ouvert.
const SPRITES = 'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@c0542f7c51215d9672439012838c99f520596cbd/sprites/pokemon';
export const sprite = n => `${SPRITES}/${n | 0}.png`;
export const artwork = n => `${SPRITES}/other/official-artwork/${n | 0}.png`;

let NAMES = null;        // ['Bulbizarre', …]
let LIST = null;         // [{ n, name }]
let INDEX = null;        // mot(s) normalisé(s) -> numéro
let MAXW = 1;            // nombre maximal de mots dans un nom
let loadP = null;

// clé de comparaison : sans accents ni casse, ponctuation → espace (« Méga-Lucario-ex » → « mega lucario ex »)
export const words = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/\s+(?=[♀♂])/g, '').replace(/[^a-z0-9♀♂]+/g, ' ').trim();

function build(names) {
  NAMES = names.map(x => String(x || ''));
  LIST = NAMES.map((name, i) => ({ n: i + 1, name }));
  INDEX = new Map();
  MAXW = 1;
  NAMES.forEach((name, i) => {
    const w = words(name);
    if (!w) return;
    if (!INDEX.has(w)) INDEX.set(w, i + 1);
    MAXW = Math.max(MAXW, w.split(' ').length);
  });
}

// [{ n, name }] — chargé une fois (réessaie après un échec)
export function pokedex() {
  if (LIST) return Promise.resolve(LIST);
  loadP ??= data('data/pokedex.json').then(d => {
    if (!Array.isArray(d)) throw new Error('pokedex.json invalide');
    build(d);
    return LIST;
  }).catch(e => { loadP = null; throw e; });
  return loadP;
}

export const loaded = () => !!LIST;
export const nameOf = n => NAMES?.[(n | 0) - 1] || '';
export const count = () => NAMES?.length || 0;

// Numéros de Pokédex devinés d'après le nom (« Méga-Lucario-ex » → [448]) ; une carte duo en donne plusieurs
// (« Méga-Ténéfix et Tyranocif » → [302, 248]). Les noms les plus longs gagnent (Mewtwo avant Mew).
// Synchrone : [] tant que le Pokédex n'est pas chargé (appeler pokedex() avant).
export function guessDex(name) {
  if (!INDEX || !name) return [];
  const w = words(name).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < w.length;) {
    let hit = 0, len = 0;
    for (let k = Math.min(MAXW, w.length - i); k >= 1; k--) {
      const n = INDEX.get(w.slice(i, i + k).join(' '));
      if (n) { hit = n; len = k; break; }
    }
    if (hit) { if (!out.includes(hit)) out.push(hit); i += len; } else i++;
  }
  return out;
}

// catégorie inconnue : pas de devinette (« Lien Spirituel Mewtwo » est un Dresseur)
const isPokemon = c => c.category === 'Pokémon' || c.category === 'Pokemon' || c.category === 'P' || c.c === 'P';

// Numéros d'une carte (brève, fiche ou entrée de collection) : ceux de TCGdex, sinon devinés pour les Pokémon.
export function dexNums(c) {
  if (!c) return [];
  const d = c.dexId || c.d;
  if (Array.isArray(d) && d.length) return d;
  return isPokemon(c) ? guessDex(c.name || c.n) : [];
}
