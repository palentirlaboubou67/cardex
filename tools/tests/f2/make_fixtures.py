"""Écrit les petits fichiers de données de test (formats SPEC §6.1–§6.5) dans tools/tests/f2/fixtures/data/.

Ils servent tant que CA (catalogue) et MK (cotes) n'ont pas produit les vrais fichiers, et pour les cas limites.
    python tools/tests/f2/make_fixtures.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures', 'data')


def w(rel, obj):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf8', newline='\n') as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))


def card(l, n, i=1, r='Commune', c='P', d=None, f=None):
    return {'l': l, 'n': n, 'i': i, 'r': r, 'c': c, 'd': d or [], 'f': f or ['normal']}


SETS = [
    # id, name, bloc, date, total, count, code
    ('me06', 'Règne Delta', 'me', '2026-11-14', 103, 140, 'DRI'),
    ('sv08.5', 'Évolutions Prismatiques', 'sv', '2025-01-17', 131, 180, 'PRE'),
    ('sv03.5', '151', 'sv', '2023-09-22', 165, 207, 'MEW'),
    ('30th', '30e Anniversaire', 'me', '2026-02-27', 30, 33, ''),
    ('30th-c', '30e Anniversaire – Classique', 'me', '2026-02-27', 30, 30, ''),
    ('cel25cc', 'Célébrations : Collection classique', 'swsh', '2021-10-08', 25, 25, 'CEL'),
    ('2018sm-fr', "Collection McDonald's 2018", 'mc', '2018-10-16', 40, 40, ''),
    ('2013bw', "Collection McDonald's 2013", 'mc', '2013-01-01', 12, 12, ''),
    ('tk-xy-latia', 'Kit du Dresseur XY Latias', 'tk', '2015-11-01', 30, 30, ''),
    ('exu', 'Zarbi', 'ex', '2005-08-01', 28, 28, ''),
    ('base3', 'Fossile', 'base', '1999-10-10', 62, 62, 'FO'),
    ('sm3', 'Ombres Ardentes', 'sm', '2017-08-04', 147, 177, 'BUS'),
]

meta = lambda s: {'id': s[0], 'name': s[1], 'bloc': s[2], 'date': s[3], 'total': s[4], 'count': s[5], 'code': s[6],
                  'logo': f'img/sets/{s[0]}.test.webp', 'logoLang': 'fr', 'sym': f'img/sym/{s[0]}.test.webp',
                  'legal': {'standard': s[2] in ('me', 'sv'), 'expanded': True}, 'tag': None, 'dark': False}

w('sets.json', {
    'v': 1, 'built': '2026-11-25T05:00:00Z',
    'blocs': [
        {'id': 'me', 'name': 'Méga-Évolution', 'logo': '', 'first': '2025-09-26'},
        {'id': 'sv', 'name': 'Écarlate et Violet', 'logo': '', 'first': '2023-03-31'},
        {'id': 'swsh', 'name': 'Épée et Bouclier', 'logo': '', 'first': '2020-02-07'},
        {'id': 'sm', 'name': 'Soleil et Lune', 'logo': '', 'first': '2017-02-03'},
        {'id': 'mc', 'name': "Collection McDonald's", 'logo': '', 'first': '2011-06-17'},
        {'id': 'tk', 'name': 'Kits du dresseur', 'logo': '', 'first': '2004-01-01'},
        {'id': 'ex', 'name': 'EX', 'logo': '', 'first': '2003-07-01'},
        {'id': 'base', 'name': 'Base', 'logo': '', 'first': '1999-01-09'},
    ],
    'sets': [meta(s) for s in SETS],
    'hidden': ['wp', 'jumbo', 'rc'],
})

w('sets/sv03.5.json', {'v': 1, 'id': 'sv03.5', 'serie': 'sv', 'cards': [
    card('001', 'Bulbizarre', d=[1], f=['normal', 'reverse']),
    card('004', 'Salamèche', d=[4], f=['normal', 'reverse']),
    card('006', 'Dracaufeu-ex', r='Double rare', d=[6], f=['holo']),
    card('007', 'Carapuce', d=[7], f=['normal', 'reverse']),
    card('025', 'Pikachu', d=[25], f=['normal', 'reverse']),
    card('133', 'Évoli', d=[133], f=['normal', 'reverse']),
    card('150', 'Mewtwo', r='Rare', d=[150], f=['holo', 'reverse']),
    card('199', 'Dracaufeu-ex', r='Illustration spéciale rare', d=[6], f=['holo']),
    card('207', 'Énergie Pikachu', i=0, c='E', f=['normal']),
]})
w('sets/me06.json', {'v': 1, 'id': 'me06', 'serie': 'me', 'cards': [
    card('001', 'Méga-Lucario-ex', d=[448], f=['holo']),
    card('060', 'Ténéfix', d=[302], f=['normal', 'reverse', 'pokeball', 'masterball']),
    card('099', 'Méga-Ténéfix et Tyranocif', d=[302, 248], f=['holo']),
]})
w('sets/exu.json', {'v': 1, 'id': 'exu', 'serie': 'ex', 'cards': [
    card('A', 'Zarbi', i=0, d=[201], f=['holo']),
    card('!', 'Zarbi', i=0, d=[201], f=['holo']),
    card('%3F', 'Zarbi', i=0, d=[201], f=['holo']),
]})
w('sets/tk-xy-latia.json', {'v': 1, 'id': 'tk-xy-latia', 'serie': 'tk', 'cards': [
    card('1', 'Latias', i=0, d=[380]), card('2', 'Psykokwak', i=0, d=[54]),
]})
w('sets/30th-c.json', {'v': 1, 'id': '30th-c', 'serie': 'me', 'cards': [
    card('001', 'Dracaufeu', i=0, d=[6], f=['holo']), card('022', 'Palkia', i=0, d=[484], f=['holo']),
]})
w('sets/30th.json', {'v': 1, 'id': '30th', 'serie': 'me', 'cards': [
    card('001', 'Pikachu', d=[25]), card('R', 'Mew', d=[151], f=['holo']),
]})
w('sets/cel25cc.json', {'v': 1, 'id': 'cel25cc', 'serie': 'swsh', 'cards': [
    card('CC001', 'Dracaufeu de base', i=0, d=[6], f=['holo']), card('CC003', 'Mew ex', i=0, d=[151], f=['holo']),
]})
w('sets/base3.json', {'v': 1, 'id': 'base3', 'serie': 'base', 'cards': [
    card('1', 'Ptéra', r='Rare', d=[142], f=['holo', 'firstEdition']), card('2', 'Artikodin', d=[144], f=['holo']),
]})
w('sets/2018sm-fr.json', {'v': 1, 'id': '2018sm-fr', 'serie': 'mc', 'cards': [
    card('1', 'Feuillajou', i=0, d=[511], f=['normal', 'holo']), card('4', 'Salamèche', i=0, d=[4], f=['normal', 'holo']),
    card('5', 'Caninos', i=0, d=[58], f=['normal', 'holo']),
]})
w('sets/2013bw.json', {'v': 1, 'id': '2013bw', 'serie': 'mc', 'cards': [
    card('1', 'Phyllali', i=0, d=[470]), card('5', 'Pikachu', i=0, d=[25]),
]})
w('sets/sm3.json', {'v': 1, 'id': 'sm3', 'serie': 'sm', 'cards': [card('12', 'Feuillajou', d=[511])]})

idx = {}
for s in SETS:
    p = os.path.join(OUT, 'sets', f'{s[0]}.json')
    if os.path.isfile(p):
        with open(p, encoding='utf8') as fh:
            f = json.load(fh)
        idx[s[0]] = [[c['l'], c['n'], c['d'], c['i']] for c in f['cards']]
idx['sv08.5'] = [['161', 'Noctali-ex', [197], 1]]
w('cards-index.json', {'v': 1, 'sets': idx})

w('cardimg.json', {
    'v': 1, 'built': '2026-11-25',
    'en': {'dp1': 'dp'},
    'sx': {'exu': 'ex10', 'tk-xy-latia': 'tk8b', '30th-c': 'me55c', 'cel25cc': 'cel25c', 'sv03.5': 'sv3pt5'},
    'id': {'30th-c': {'001': 'me55c-4', '022': 'me55c-106p'}, 'cel25cc': {'CC001': 'cel25c-4_A', 'CC003': 'cel25c-15_A1'}},
    'ok': {'exu': 'A ! %3F', 'tk-xy-latia': '1 2', 'sv03.5': '207'},
    'alt': {'2018sm-fr-5': 'sx:mcd18-1', '2018sm-fr-1': 'fr:sm/sm3/12'},
    'from': {'2018sm-fr-1': 'sm3-12'},
    'png': ['base3-1'],
    'fix': {'30th-R': 'me55-R'},
})

w('market/prices/sv03.5.json', {'v': 1, 'd': '2026-11-25', 'c': {
    '025': {'normal': [23, 25, 24, 17, 15], 'reverse': [57, None, 61, 60, 40]},
    '004': {'normal': [14, 15, 14, 13, 5], 'reverse': [35, 30, 34, 33, 20]},
    '006': {'holo': [512, 500, 520, 530, 450]},
    '001': {'normal': [10, None, 11, 12, 2]},
    '150': {'holo': [2, 1990, 1983, 8426, 1500]},        # tendance cassée (comme neo2-10) : garde-fou
    '133': {'normal': [30, 31, 29, 28, 10]},
}})
w('market/prices/me06.json', {'v': 1, 'd': '2026-11-24', 'c': {
    '060': {'normal': [12, 12, 12, 12, 5], 'pokeball': [150, None, 140, 160, 99]},
}})
# Cardmarket idProduct -> TCGplayer productId (photos) : sert aussi à relier le scellé de l'ancienne version
w('market/sealed-img.json', {'719691': 735067, '719700': 735052, '800001': 999})
print('fixtures écrites dans', OUT)
