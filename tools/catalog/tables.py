"""Tables faites à la main pour le catalogue (à maintenir quand TCGdex ajoute des séries).

Chaque table dit pourquoi elle existe. Sources : FINAL-images §2–§5, FINAL-design §6.9, vérifications du 25/11/2026.
"""
import re

# Séries de Pokémon TCG Pocket (jeu mobile) : pas des cartes physiques, exclues partout.
POCKET = re.compile(r'^(A\d|B\d|P-A)')
POCKET_SERIES = {'tcgp'}

# Corrections de noms de séries (fautes de TCGdex, noms anglais dans la liste française).
NAME_FIX = {
    'dp4': 'Duels au Sommet',            # TCGdex : « Duels au Sommets »
    'bw6': 'Dragons Exaltés',            # TCGdex : « Dragons Éxaltés » (le logo dit EXALTÉS)
    'bw8': 'Tempête Plasma',             # TCGdex : « Tempète Plasma »
    'sm7.5': 'Majesté des Dragons',      # TCGdex : « Majesté Des Dragons »
    'xya': 'Carte alternative A Jaune',  # TCGdex : minuscule initiale
    'basep': 'Promo Wizards',            # TCGdex : « Wizards Black Star Promos » (comme « Promo DP », « Promo SWSH »)
    'svp': 'Promo SV',                   # TCGdex : « SVP Black Star Promos »
    'mep': 'Promo ME',                   # TCGdex : « MEP Black Star Promos »
    # Kits du dresseur : un seul libellé « Kit du dresseur » (TCGdex : « Kit dresseur » pour DP et EX) et le nom
    # français du Pokémon du kit, tel que l'écrivent ses cartes
    'tk-sm-l': 'SM Kit du dresseur (Lougaroc)',          # TCGdex : « Lougarox »
    'tk-xy-p': 'XY Kit du dresseur (Pikachu Catcheur)',  # TCGdex : « Pikachu Libre » (nom anglais)
    'tk-dp-l': 'DP Kit du dresseur (Lucario)',
    'tk-dp-m': 'DP Kit du dresseur (Manaphy)',
    'tk-ex-latia': 'EX Kit du dresseur (Latias)',
    'tk-ex-latio': 'EX Kit du dresseur (Latios)',
    'tk-ex-m': 'EX Kit du dresseur (Négapi)',
    'tk-ex-p': 'EX Kit du dresseur (Posipi)',            # TCGdex : « Positi » (Posipi, n° 311 du Pokédex)
}


def typo(s):
    """Apostrophe typographique dans les noms affichés (séries, blocs, cartes) : l'interface écrit « ’ » partout ;
    la recherche replie les deux formes (format.norm, dex.words)."""
    return s.replace("'", '’') if isinstance(s, str) else s

# Code affiché quand TCGdex n'a pas d'abbreviation.official (jamais le nom complet).
# Promos : sur le modèle BWP / XYP / SMP / SVP / MEP ; McDonald's : sur le modèle MCD11…MCD24 ;
# sous-séries : sur le modèle « SHF:SV » / « CRZ:GG » de TCGdex.
CODES = {
    'basep': 'WBSP',
    'np': 'NP',
    'dpp': 'DPP',
    'hgssp': 'HGSSP',
    'swshp': 'SWSHP',
    'exu': 'UF:U',
    'xya': 'XYA',
    'sma': 'HIF:SV',
    '2013bw': 'MCD13',
    '2018sm-fr': 'MCD18',
    '2019sm-fr': 'MCD19',
    'pl4': 'AR',
}

# Sous-séries sans logo propre : logo (et symbole s'il manque) de la série mère + petite étiquette.
PARENT = {
    'sma': ('sm115', 'Coffre'),
    'swsh4.5sv': ('swsh4.5', 'Coffre'),
    'cel25cc': ('cel25', 'Classique'),
    'swsh9tg': ('swsh9', 'Galerie'),
    'swsh10tg': ('swsh10', 'Galerie'),
    'swsh11tg': ('swsh11', 'Galerie'),
    'swsh12tg': ('swsh12', 'Galerie'),
    'swsh12.5gg': ('swsh12.5', 'Galerie'),
    'exu': ('ex10', 'Zarbi'),
    '30th-c': ('30th', 'Classique'),
    'xya': ('xy1', 'Alternatives'),
    'sve': ('sv01', 'Énergies'),
    'mee': ('me01', 'Énergies'),
}

# Logos partagés (un seul fichier pour plusieurs séries). Clé = nom du fichier (alias).
# source : ('set', id) = logo FR/EN choisi pour cette série ; ('url', adresse) = source libre fixe.
# tags : étiquette par série, seulement quand le nom ne suffit pas à distinguer des lignes voisines au logo
# identique (pas d'année McDonald's ni de numéro POP : le nom les donne déjà et l'étiquette masquait le logo).
SHARED = {
    # McDonald's : le même logo pour les 13 collections (les logos anglais « Match Battle » /
    # « Dragon Discovery » de 2022–2024 prêtent à confusion à côté de « Collection McDonald's 2024 »).
    'mcd': {'source': ('url', 'https://images.pokemontcg.io/mcd11/logo.png'), 'bloc': 'mc', 'lang': 'en'},
    # Étoile PROMO : identique sur toutes les séries promo (TCGdex FR de swshp).
    'promo': {'source': ('set', 'swshp'), 'sets': ['basep', 'np', 'dpp', 'hgssp', 'bwp', 'xyp', 'smp', 'swshp', 'svp', 'mep']},
    # Logo « Organized Play » des séries POP (identique sur les 6).
    'pop': {'source': ('set', 'pop1'), 'sets': ['pop1', 'pop2', 'pop3', 'pop4', 'pop5', 'pop6', 'pop7', 'pop8', 'pop9']},
    # « ex TRAINER KIT » (pokemontcg.io, téléchargé une fois et auto-hébergé) pour les 4 kits de l'ère EX,
    # avec le Pokémon du kit en étiquette (lignes voisines au logo identique).
    'tkex': {'source': ('url', 'https://images.pokemontcg.io/tk1a/logo.png'), 'sets': ['tk-ex-latia', 'tk-ex-latio', 'tk-ex-m', 'tk-ex-p'],
             'lang': 'en', 'tags': {'tk-ex-latia': 'Latias', 'tk-ex-latio': 'Latios', 'tk-ex-m': 'Négapi', 'tk-ex-p': 'Posipi'}},
}

# Logos qui n'existent que chez Scrydex : les auto-héberger serait du « mirroring » (conditions Scrydex §4).
# - kits DP → SM (16) : aucune autre source, pas d'adresse dans pokemontcg-data -> logo null, couverture
#   générée (symbole Scrydex lié + code), comme le veut SPEC §6.1 ;
# - me06 (Règne Delta, sortie le 06/11/2026) : TCGdex n'a encore ni logo ni symbole ; pokemontcg-data donne
#   l'adresse Scrydex du logo anglais -> liée telle quelle (vérifiée). Dès que TCGdex publiera le logo FR,
#   le constructeur le prendra (TCGdex FR passe toujours en premier).
# Le choix est fait par logos.py (voir sa docstring) ; aucune table à tenir ici.

# Logos FR pris ailleurs que chez TCGdex, avant TCGdex FR (téléchargés une fois et auto-hébergés).
# - swsh4.5 (Destinées Radieuses) : TCGdex FR (.webp et .png) sert le logo anglais « Shining Fates ».
#   Poképédia a le logo français (fichier « Logo Destinées Radieuses JCC.png », 3000 × 1247, transparent ;
#   wiki sous CC BY-NC-SA 3.0, le logo lui-même reste une marque de The Pokémon Company comme les autres).
LOGO_SOURCE = {
    'swsh4.5': 'https://www.pokepedia.fr/images/3/38/Logo_Destin%C3%A9es_Radieuses_JCC.png',
}
# Logos « FR » de TCGdex qui sont en réalité les logos anglais : logoLang 'en' si l'on doit s'en servir
# (source de LOGO_SOURCE en échec).
FR_LOGO_IS_EN = {'swsh4.5'}

# Symboles : collections McDonald's françaises 2018 / 2019 = mêmes cartes que les collections anglaises de
# la même année (mcd18 : 6 cartes communes, mcd19 : les 12) -> même symbole (pokemontcg.io, auto-hébergé).
SYMBOL_FROM = {'2018sm-fr': 'mcd18', '2019sm-fr': 'mcd19'}
# Pas de symbole : les cartes du Set de Base n'en ont pas (les sources donnent le logo « Pokémon TCG »).
NO_SYMBOL = {'base1'}
# Sous-séries dont le « symbole » TCGdex est inutilisable : celui de la série mère (PARENT) à la place.
# exu : TCGdex donne une vignette de texte « UNSEEN FORCES » illisible à 20 px ; les cartes Zarbi portent
# le symbole d'EX Forces Cachées.
PARENT_SYMBOL = {'exu'}

# Logos de bloc (TCGdex : logo de la première série du bloc, ou rien).
BLOC_LOGO = {
    'base': ('set', 'base1'),   # TCGdex pointe vers le logo de Jungle : trompeur
    'pop': ('shared', 'pop'),
    'mc': ('shared', 'mcd'),
    'tk': None,                 # pas de logo neutre « Trainer Kit » : couverture générée
}

# Extensions principales XY et Soleil et Lune : ni l'API ni cards-database n'ont de variantes (l'API ne dit que
# « normale »). Toutes ont des reverses (communes, peu communes, rares) et des holos (EX, GX, ultra rares…) :
# cards.era_finishes. Pas les séries spéciales dont l'existence des reverses n'est pas sûre (g1, dc1, det1,
# xy0, kits, promos) : elles gardent ce que dit l'API.
ERA_RULE = re.compile(r'^(xy([1-9]|1[0-2])|sm([1-9]|1[0-2])|sm3\.5|sm7\.5|sm115)$')

# Séries absentes de /v2/fr/sets mais dont des cartes existent en français (FINAL-images §3.2).
# pl4 (Arceus) : TCGdex FR n'a que les 9 cartes AR1–AR9 ; métadonnées prises sur la série anglaise, sauf le
# total (99 en anglais) : total = nombre de cartes du catalogue (ownTotal), sinon « 0 / 99 » inatteignable.
EXTRA_SETS = {
    'pl4': {'name': 'Arceus', 'serie': 'pl', 'ownTotal': True},
}

# Blocs « à part » (collections McDonald's, kits du dresseur, POP) : après les grandes périodes dans
# sets.json (FINAL-images §5), marqués special=true.
SPECIAL_BLOCS = ('mc', 'tk', 'pop')

# ---------- Images de secours (FINAL-images §2.3) ----------

# Série TCGdex -> extension Scrydex quand l'identifiant diffère.
SCRYDEX_SET = {
    'sm3.5': 'sm35', 'sm7.5': 'sm75', 'swsh3.5': 'swsh35', 'swsh4.5': 'swsh45', 'swsh4.5sv': 'swsh45sv',
    'swsh10.5': 'pgo', 'swsh12.5': 'swsh12pt5', 'swsh12.5gg': 'swsh12pt5gg',
    'sv01': 'sv1', 'sv02': 'sv2', 'sv03': 'sv3', 'sv03.5': 'sv3pt5', 'sv04': 'sv4', 'sv04.5': 'sv4pt5', 'sv05': 'sv5',
    'sv06': 'sv6', 'sv06.5': 'sv6pt5', 'sv07': 'sv7', 'sv08': 'sv8', 'sv08.5': 'sv8pt5', 'sv09': 'sv9', 'sv10': 'sv10',
    'sv10.5b': 'zsv10pt5', 'sv10.5w': 'rsv10pt5',
    'me01': 'me1', 'me02': 'me2', 'me02.5': 'me2pt5', 'me03': 'me3', 'me04': 'me4', 'me05': 'me5', 'me06': 'me6',
    '30th': 'me55', '30th-c': 'me55c',
    'hgssp': 'hsp', 'cel25cc': 'cel25c', 'exu': 'ex10',
    'tk-ex-latia': 'tk1a', 'tk-ex-latio': 'tk1b', 'tk-ex-p': 'tk2a', 'tk-ex-m': 'tk2b',
    'tk-dp-m': 'tk3a', 'tk-dp-l': 'tk3b', 'tk-hs-r': 'tk4a', 'tk-hs-g': 'tk4b', 'tk-bw-z': 'tk5a', 'tk-bw-e': 'tk5b',
    'tk-xy-sy': 'tk6a', 'tk-xy-n': 'tk6b', 'tk-xy-w': 'tk7a', 'tk-xy-b': 'tk7b', 'tk-xy-latio': 'tk8a',
    'tk-xy-latia': 'tk8b', 'tk-xy-su': 'tk9a', 'tk-xy-p': 'tk9b', 'tk-sm-l': 'tk10a', 'tk-sm-r': 'tk10b',
    '2011bw': 'mcd11', '2012bw': 'mcd12', '2014xy': 'mcd14', '2015xy': 'mcd15', '2016xy': 'mcd16', '2017sm': 'mcd17',
    '2021swsh': 'mcd21', '2022swsh': 'mcd22', '2023sv': 'mcd23', '2024sv': 'mcd24',
}
# Séries sans équivalent anglais (collections McDonald's françaises, cartes A jaunes : identifiants par carte).
SCRYDEX_NONE = {'2013bw', '2018sm-fr', '2019sm-fr', 'xya', 'wp', 'jumbo', 'rc', 'pl4'}

# Identifiants Scrydex complets quand la règle de numérotation ne s'applique pas (61, vérifiés un par un).
SCRYDEX_ID = {
    '30th-c': {'001': 'me55c-4', '002': 'me55c-5', '003': 'me55c-11', '004': 'me55c-11g', '005': 'me55c-18', '006': 'me55c-19',
               '007': 'me55c-25', '008': 'me55c-33', '009': 'me55c-41', '010': 'me55c-43', '011': 'me55c-47', '012': 'me55c-50',
               '013': 'me55c-57', '014': 'me55c-58', '015': 'me55c-69', '016': 'me55c-85', '017': 'me55c-89', '018': 'me55c-94',
               '019': 'me55c-99', '020': 'me55c-100', '021': 'me55c-101', '022': 'me55c-106p', '023': 'me55c-106m',
               '024': 'me55c-106', '025': 'me55c-108', '026': 'me55c-114', '027': 'me55c-123', '028': 'me55c-138',
               '029': 'me55c-149', '030': 'me55c-203'},
    'cel25cc': {'CC001': 'cel25c-2_A', 'CC002': 'cel25c-4_A', 'CC003': 'cel25c-15_A1', 'CC004': 'cel25c-73_A', 'CC005': 'cel25c-8_A',
                'CC006': 'cel25c-15_A2', 'CC007': 'cel25c-15_A3', 'CC008': 'cel25c-24_A', 'CC009': 'cel25c-20_A',
                'CC010': 'cel25c-66_A', 'CC011': 'cel25c-9_A', 'CC012': 'cel25c-86_A', 'CC013': 'cel25c-88_A',
                'CC014': 'cel25c-93_A', 'CC015': 'cel25c-17_A', 'CC016': 'cel25c-15_A4', 'CC017': 'cel25c-109_A',
                'CC018': 'cel25c-145_A', 'CC019': 'cel25c-107_A', 'CC020': 'cel25c-113_A', 'CC021': 'cel25c-114_A',
                'CC022': 'cel25c-54_A', 'CC023': 'cel25c-97_A', 'CC024': 'cel25c-76_A', 'CC025': 'cel25c-60_A'},
    'xya': {'24a': 'xy4-24a', '28a': 'g1-28a', '54a': 'xy10-54a', '55a': 'xy3-55a', '92a': 'xy6-92a', '107a': 'xy9-107a'},
}

# Même illustration ailleurs (FINAL-images §2.4b) : carte sans image -> (jumelle anglaise McDonald's sur
# Scrydex, impression d'origine chez TCGdex). Ordre retenu : la carte McDonald's anglaise exacte d'abord,
# puis l'image française de l'impression d'origine, puis son image anglaise.
# Correspondances « très probables » (même Pokémon, illustrateur, PV et dégâts), pas prouvées.
REPRINT = {
    '2013bw-5': (None, 'bw4-39'), '2013bw-6': (None, 'bw5-37'), '2013bw-7': (None, 'bw5-48'), '2013bw-8': (None, 'bw1-59'),
    '2013bw-9': (None, 'bw5-61'), '2013bw-10': (None, 'bw5-67'), '2013bw-11': (None, 'bw2-66'),
    '2018sm-fr-1': (None, 'sm3-12'), '2018sm-fr-2': (None, 'sm1-18'), '2018sm-fr-3': (None, 'sm3-16'),
    '2018sm-fr-5': ('mcd18-1', 'sm1-21'), '2018sm-fr-6': (None, 'sm1-23'), '2018sm-fr-7': (None, 'sm3-22'),
    '2018sm-fr-8': (None, 'sm2-19'), '2018sm-fr-9': (None, 'sm2-21'), '2018sm-fr-10': ('mcd18-2', 'sm1-28'),
    '2018sm-fr-11': (None, 'sm1-30'), '2018sm-fr-12': (None, 'sm2-26'), '2018sm-fr-13': (None, 'sm1-37'),
    '2018sm-fr-14': (None, 'sm2-29'), '2018sm-fr-16': (None, 'sm2-37'), '2018sm-fr-17': (None, 'sm3-40'),
    '2018sm-fr-18': (None, 'sm2-40'), '2018sm-fr-19': (None, 'sm1-49'), '2018sm-fr-20': (None, 'sm3-47'),
    '2018sm-fr-21': ('mcd18-5', 'sm2-48'), '2018sm-fr-22': (None, 'sm2-62'), '2018sm-fr-23': (None, 'sm1-67'),
    '2018sm-fr-24': (None, 'sm3-70'), '2018sm-fr-25': (None, 'sm2-73'), '2018sm-fr-26': (None, 'sm2-75'),
    '2018sm-fr-27': (None, 'sm2-78'), '2018sm-fr-28': (None, 'sm3-85'), '2018sm-fr-29': (None, 'sm1-88'),
    '2018sm-fr-30': (None, 'sm2-88'), '2018sm-fr-31': (None, 'sm3-91'), '2018sm-fr-32': ('mcd18-9', 'sm1-94'),
    '2018sm-fr-33': (None, 'sm2-94'), '2018sm-fr-34': (None, 'sm2-98'), '2018sm-fr-35': (None, 'sm3-101'),
    '2018sm-fr-36': ('mcd18-10', 'sm2-101'), '2018sm-fr-37': ('mcd18-11', 'sm1-101'), '2018sm-fr-38': (None, 'sm2-109'),
    '2018sm-fr-39': (None, 'sm2-109'), '2018sm-fr-40': (None, 'sm3-110'),
    '2019sm-fr-1': (None, 'sm3.5-1'), '2019sm-fr-2': ('mcd19-1', 'sm3-1'), '2019sm-fr-3': (None, 'sm1-4'),
    '2019sm-fr-4': (None, 'sm7-1'), '2019sm-fr-5': ('mcd19-2', 'sm6-2'), '2019sm-fr-6': (None, 'sm8-1'),
    '2019sm-fr-7': (None, 'sm7-4'), '2019sm-fr-8': (None, 'sm8-4'), '2019sm-fr-9': (None, 'sm7.5-1'),
    '2019sm-fr-10': ('mcd19-3', 'sm5-18'), '2019sm-fr-11': (None, 'smp-SM143'), '2019sm-fr-12': ('mcd19-4', 'sm5-28'),
    '2019sm-fr-13': (None, 'sm5-30'), '2019sm-fr-14': (None, 'sm8-54'), '2019sm-fr-15': (None, 'sm7.5-16'),
    '2019sm-fr-16': (None, 'sm4-15'), '2019sm-fr-17': (None, 'sm7.5-19'), '2019sm-fr-18': ('mcd19-5', 'sm7.5-21'),
    '2019sm-fr-19': (None, 'smp-SM144'), '2019sm-fr-20': ('mcd19-6', 'sm3.5-28'), '2019sm-fr-21': (None, 'sm4-31'),
    '2019sm-fr-22': (None, 'sm4-32'), '2019sm-fr-23': ('mcd18-8', 'sm6-34'), '2019sm-fr-24': (None, 'sm9-38'),
    '2019sm-fr-25': (None, 'sm5-43'), '2019sm-fr-26': (None, 'xy6-23'), '2019sm-fr-27': ('mcd19-7', 'sm4-36'),
    '2019sm-fr-28': ('mcd19-8', 'sm4-50'), '2019sm-fr-29': ('mcd19-9', 'sm7-71'), '2019sm-fr-30': (None, 'sm6-57'),
    '2019sm-fr-31': (None, 'sm3-65'), '2019sm-fr-32': ('mcd19-10', 'sm8-118'), '2019sm-fr-33': (None, 'sm1-86'),
    '2019sm-fr-33b': (None, 'sm5-78'), '2019sm-fr-34': ('mcd19-11', 'sm5-79'), '2019sm-fr-35': (None, 'sm8-133'),
    '2019sm-fr-36': (None, 'sm7.5-34'), '2019sm-fr-37': (None, 'sm5-102'), '2019sm-fr-38': (None, 'sm8-152'),
    '2019sm-fr-39': (None, 'sm7.5-55'), '2019sm-fr-40': ('mcd19-12', 'sm5-104'),
}
# Restent sans aucune image (8) : 2013bw-1/2/3/4/12, 2018sm-fr-4, 2018sm-fr-15, hgssp-HGSS18.

# Image de remplacement de Scrydex (dos de carte) et logo générique : reconnus par le préfixe d'ETag,
# stable quel que soit le format négocié (PNG / WebP / AVIF).
SCRYDEX_CARD_PLACEHOLDER_ETAG = 'cfl2loWl84E8tUjrC-Q-I0D0J'
SCRYDEX_LOGO_PLACEHOLDER_ETAG = 'cf-lVkzmA0aekAMPnwN5JhK5ny'
SCRYDEX_PLACEHOLDER_ETAG = (SCRYDEX_CARD_PLACEHOLDER_ETAG, SCRYDEX_LOGO_PLACEHOLDER_ETAG)
