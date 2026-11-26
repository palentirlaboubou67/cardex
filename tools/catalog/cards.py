"""Conversion d'une carte TCGdex en ligne compacte de data/sets/<id>.json (SPEC §6.2)."""
import re
import unicodedata

# Ordre des finitions (js/state/collection.js FINISHES)
FINISHES = ['normal', 'reverse', 'holo', 'cosmos', 'pokeball', 'masterball', 'firstEdition', 'stamp']
STD = ['normal', 'reverse', 'holo', 'firstEdition']
TYPE_KEY = {'normal': 'normal', 'reverse': 'reverse', 'holo': 'holo', 'firstedition': 'firstEdition'}

IMG_FR = 'https://assets.tcgdex.net/fr/'


def letters(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^a-z]', '', s.lower())


def foil_key(v):
    """Comme foilKey() de l'appli : libellés FR (« Pokéball », « Masterball », « Cosmos ») et EN."""
    f = letters((v or {}).get('foil'))
    if 'cosmo' in f:
        return 'cosmos'
    if 'pokeball' in f:
        return 'pokeball'
    if 'masterball' in f:
        return 'masterball'
    return None


def finishes(card, stats=None):
    """Finitions dans l'ordre FINISHES.

    normal / reverse / holo / 1re édition : champ `variants`. Poké Ball, Master Ball, Cosmos : `variants_detailed.foil`.
    Ignorés (pas une finition à part dans FINISHES) : « Or » (les cartes dorées : leur finition holo est déjà
    dans `variants`), « Énergie », « league », « tinsel »… ; les tampons restent un ajout manuel (« stamp »).
    Si `variants` manque, on se rabat sur les types de `variants_detailed`.
    """
    v = card.get('variants') or {}
    out = {k for k in STD if v.get(k)}
    vd = card.get('variants_detailed') or []
    if not out:
        for d in vd:
            k = TYPE_KEY.get(letters(d.get('type')))
            if k:
                out.add(k)
        if stats is not None and out:
            stats['fromDetailed'] = stats.get('fromDetailed', 0) + 1
    for d in vd:
        k = foil_key(d)
        if k:
            out.add(k)
        elif stats is not None and d.get('foil'):
            key = 'foil:' + str(d.get('foil'))
            stats[key] = stats.get(key, 0) + 1
    if not out:
        out = {'normal'}
        if stats is not None:
            stats['defaultNormal'] = stats.get('defaultNormal', 0) + 1
    return [k for k in FINISHES if k in out]


def category(c):
    k = letters(c)
    if k.startswith('pok'):
        return 'P'
    if k.startswith('dress') or k.startswith('trainer'):
        return 'D'
    if k.startswith('ener'):
        return 'E'
    return None


def fr_image_base(serie, sid, lid):
    return f'{IMG_FR}{serie}/{sid}/{lid}'


def dex_ids(card, cat, dex, stats=None):
    """Numéros TCGdex, sinon devinés d'après le nom. Pokémon uniquement : un Dresseur ou une Énergie n'a jamais
    de numéro, même si TCGdex en donne (hgssp-HGSS18 « Raz-de-marée tropical » : [25, 183, 54, 187])."""
    if cat != 'P':
        if stats is not None and card.get('dexId'):
            stats['dexDroppedNotPokemon'] = stats.get('dexDroppedNotPokemon', 0) + 1
        return []
    d = [int(x) for x in (card.get('dexId') or []) if isinstance(x, (int, float)) or str(x).isdigit()]
    if d:
        return d
    g = dex.guess(card.get('name'))
    if stats is not None:
        stats['guessed' if g else 'noDex'] = stats.get('guessed' if g else 'noDex', 0) + 1
    return g
