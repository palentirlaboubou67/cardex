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


def _count(stats, key):
    if stats is not None:
        stats[key] = stats.get(key, 0) + 1


def api_finishes(card, stats=None):
    """Finitions annoncées par l'API (GraphQL FR), dans l'ordre FINISHES.

    normal / reverse / holo / 1re édition : champ `variants`. Poké Ball, Master Ball, Cosmos : `variants_detailed.foil`.
    Ignorés (pas une finition à part dans FINISHES) : « Or » (les cartes dorées : leur finition holo est déjà
    dans `variants`), « Énergie », « Copain Ball »… (motifs de reverse : la reverse de la carte), les tampons
    (ajout manuel « stamp »). Si `variants` manque, on se rabat sur les types de `variants_detailed`.
    Une holo dont toutes les impressions holo sont Cosmo n'est que la « Cosmo Holo » (sv03.5-004, promos SWSH) ;
    une reverse dont toutes les impressions reverse sont Poké Ball, Master Ball ou Cosmo n'est que celles-ci (sve).
    """
    v = card.get('variants') or {}
    out = {k for k in STD if v.get(k)}
    vd = card.get('variants_detailed') or []
    if not out:
        for d in vd:
            k = TYPE_KEY.get(letters(d.get('type')))
            if k:
                out.add(k)
        if out:
            _count(stats, 'fromDetailed')
    for d in vd:
        k = foil_key(d)
        if k:
            out.add(k)
        elif stats is not None and d.get('foil'):
            _count(stats, 'foil:' + str(d.get('foil')))
    for t in ('holo', 'reverse'):
        same = [d for d in vd if letters(d.get('type')) == t]
        if t in out and same and all(foil_key(d) for d in same):
            out.discard(t)
            _count(stats, f'phantom:{t}')
    if not out:
        out = {'normal'}
        _count(stats, 'defaultNormal')
    return [k for k in FINISHES if k in out]


def api_default(card):
    """L'API ne dit rien de plus que « normale » (valeur par défaut de TCGdex quand ses données n'ont aucune
    variante : bw8–bw10, me06, XY, Soleil et Lune)."""
    v = card.get('variants') or {}
    if not v.get('normal') or any(v.get(k) for k in ('reverse', 'holo', 'firstEdition')):
        return False
    return all(letters(d.get('type')) == 'normal' and not d.get('foil') for d in card.get('variants_detailed') or [])


def db_entries(dbc):
    """Impressions d'une carte de cards-database (liste `variants` explicite, ou None) : normal / reverse / holo,
    format standard, en français ou en anglais. -> [{type, foil (clé de l'appli ou None), stamps}]."""
    v = (dbc or {}).get('variants')
    if not isinstance(v, list):
        return None
    out = []
    for e in v:
        if not isinstance(e, dict):
            continue
        t = str(e.get('type') or '').lower()
        if t not in ('normal', 'reverse', 'holo'):
            continue  # lenticulaire, métal… : pas une finition de l'appli
        if str(e.get('size') or 'standard').lower() != 'standard':
            continue  # jumbo
        langs = e.get('languages')
        if isinstance(langs, list) and langs and 'fr' not in langs and 'en' not in langs:
            continue  # impression propre à une autre langue
        st = e.get('stamp')
        st = [x for x in (st if isinstance(st, list) else [st] if st else []) if isinstance(x, str)]
        out.append({'type': t, 'foil': foil_key({'foil': e.get('foil')}), 'stamps': st})
    return out


def _special(e):
    """Impression tamponnée à part (Championnats du monde, avant-première, Gym Challenge, logo de série sur une
    normale…) ; la 1re édition est une finition, et le logo de série sur une reverse est le motif de la série."""
    st = [x for x in e['stamps'] if x != '1st-edition']
    if e['type'] == 'reverse':
        st = [x for x in st if x != 'set-logo']
    return bool(st)


# promos où le logo de série tamponné est l'impression courante (cartes de coffrets), pas une version à part
PROMO_SETS = ('svp', 'swshp', 'mep', 'smp', 'xyp', 'bwp')


def finishes(card, stats=None, db=None, sid=None, prev=None, era_rule=None):
    """Finitions dans l'ordre FINISHES (SPEC §6.2) : celles de l'API, complétées ou corrigées par cards-database
    (db = la carte lue dans l'archive, déjà téléchargée par tools/build_market.py) :
    - API sans aucune variante (que « normale », valeur par défaut) : impressions de cards-database quand elle en a
      (bw8, bw9, bw10, me06 : reverses et holos) ; sinon règle de l'époque (era_rule(card, db) : XY, Soleil et Lune) ;
      sans archive (db=False), la sortie précédente (prev) de la carte ;
    - finition normale ou holo dont toutes les impressions sont tamponnées à part (deck des Championnats du
      monde, Gym Challenge, avant-première) alors que la carte a une impression courante d'un autre type : retirée
      (c'est un ajout manuel « stamp »). Les séries entièrement tamponnées (McDonald's, 25 ans, 30 ans) n'ont pas
      d'impression courante : rien n'est retiré."""
    out = api_finishes(card, stats)
    es = db_entries(db) if db else None
    if api_default(card):
        if db is False and prev:
            _count(stats, 'defaultPrev')
            return [k for k in FINISHES if k in set(prev)]
        if es:
            f = set()
            for e in es:
                if _special(e):
                    continue
                if e['foil']:
                    f.add(e['foil'])
                elif '1st-edition' in e['stamps']:
                    f.add('firstEdition')
                else:
                    f.add(e['type'])
            if f and f != {'normal'}:
                _count(stats, 'defaultFromDb')
                return [k for k in FINISHES if k in f]
        elif era_rule:
            f = era_rule(card, db or {})
            if f:
                _count(stats, 'defaultEraRule')
                return [k for k in FINISHES if k in f]
        return out
    if es and sid not in PROMO_SETS:
        plain = {e['type'] for e in es if not e['foil'] and not _special(e)}
        # pas la reverse : ses tampons « staff » / « pokemon-center » sur des cartes de ce nom (swsh4-153, bw4-90)
        # sont des erreurs de la base, et une reverse courante existe
        for t in ('normal', 'holo'):
            same = [e for e in es if e['type'] == t and not e['foil']]
            other = plain & ({'normal', 'holo'} - {t})
            if t in out and same and all(_special(e) for e in same) and other:
                out.remove(t)
                _count(stats, f'stampedOnly:{t}')
    return out


# Règle des extensions principales XY et Soleil et Lune (tables.ERA_RULE), où TCGdex n'a aucune variante :
# commune, peu commune, rare = normale + reverse ; EX, GX, Méga, Prisme Étoile (◇), TURBO, ultra rare, magnifique rare,
# cartes « a » (versions alternatives) = holo seule ; énergies de base = normale seule. Une rare holo reste
# « normale » (TCGdex ne distingue pas rare et rare holo à cette époque) : même produit Cardmarket.
_HOLO_NAME = re.compile(r'(^|[\s-])(EX|GX)$|^M-|◇')


def era_finishes(card, db):
    r = letters(card.get('rarity'))
    name = str(card.get('name') or '')
    lid = str(card.get('localId') or '')
    if (_HOLO_NAME.search(name) or (db.get('stage') in ('BREAK', 'MEGA')) or r in ('ultrarare', 'magnifiquerare')
            or re.search(r'\d[a-z]$', lid)):
        return ['holo']
    if r in ('commune', 'peucommune', 'rare'):
        if category(card.get('category')) == 'E' and r == 'commune':
            return ['normal']
        return ['normal', 'reverse']
    return None


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
