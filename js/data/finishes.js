// Finitions : clés, libellés, pastilles, correspondance des « foil » TCGdex (FR et EN).
export const FINISHES = ['normal', 'reverse', 'holo', 'cosmos', 'pokeball', 'masterball', 'firstEdition', 'stamp'];

// libellé long (fiche, réglages)
export const LABEL = {
  normal: 'Normale',
  reverse: 'Reverse',
  holo: 'Holo',
  cosmos: 'Cosmo Holo',
  pokeball: 'Reverse Poké Ball',
  masterball: 'Reverse Master Ball',
  firstEdition: '1re édition',
  stamp: 'Tamponnée (promo)',
};

// libellé court (pastille 11 px sur les tuiles)
export const SHORT = {
  normal: 'Normale',
  reverse: 'Reverse',
  holo: 'Holo',
  cosmos: 'Cosmo',
  pokeball: 'Poké Ball',
  masterball: 'Master Ball',
  firstEdition: '1re éd.',
  stamp: 'Tampon',
};

// classe CSS de la pastille de couleur (stylée par F1)
export const DOT = {
  normal: 'dot-normal',
  reverse: 'dot-reverse',
  holo: 'dot-holo',
  cosmos: 'dot-cosmos',
  pokeball: 'dot-pokeball',
  masterball: 'dot-masterball',
  firstEdition: 'dot-first',
  stamp: 'dot-stamp',
};

// finitions brillantes (effet holo sur les tuiles)
export const FOIL = new Set(['reverse', 'holo', 'cosmos', 'pokeball', 'masterball']);

export const isFinish = f => FINISHES.includes(f);
export const order = f => { const i = FINISHES.indexOf(f); return i < 0 ? 99 : i; };
export const sortFinishes = list => [...new Set(list)].filter(isFinish).sort((a, b) => order(a) - order(b));

const simple = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// variants_detailed TCGdex → finition spéciale. Accepte l'objet ({ type, foil }) ou le libellé seul.
// FR : « Pokéball », « Masterball », « Cosmos » ; EN : « pokeball », « masterball », « cosmos ».
export function foilKey(variantDetailed) {
  const f = simple(typeof variantDetailed === 'string' ? variantDetailed : variantDetailed?.foil);
  if (!f) return null;
  if (f.includes('cosmo')) return 'cosmos';
  if (f.includes('pokeball')) return 'pokeball';
  if (f.includes('masterball')) return 'masterball';
  return null;
}

// Finitions d'une fiche TCGdex complète (variants + variants_detailed), dans l'ordre de FINISHES.
// Les tamponnées restent en ajout manuel.
export function finishesOf(full) {
  if (Array.isArray(full?.finishes) && full.finishes.length) return sortFinishes(full.finishes);
  const v = full?.variants || {};
  const out = ['normal', 'reverse', 'holo', 'firstEdition'].filter(k => v[k]);
  for (const d of full?.variants_detailed || []) {
    const k = foilKey(d);
    if (k) out.push(k);
  }
  return out.length ? sortFinishes(out) : ['normal'];
}
