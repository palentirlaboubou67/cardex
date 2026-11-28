"""Catalogue statique de Cardex : séries, cartes, index de recherche, images de secours, logos et symboles.

Écrit (SPEC §6.1–§6.4, §9) : data/sets.json, data/sets/<id>.json, data/cards-index.json, data/cardimg.json,
img/sets/*.webp, img/sym/*.webp. Sources : TCGdex (FR, GraphQL @locale fr, une requête par série), TCGdex EN,
Scrydex (identifiants vérifiés seulement, jamais d'image auto-hébergée), pokemontcg.io (logos libres).

  python -P tools/build_catalog.py               exécution normale (cache .cache/ca/, réseau si nécessaire)
  python -P tools/build_catalog.py --offline     uniquement le cache, aucune requête
  python -P tools/build_catalog.py --only sv03.5 ne recharge que cette série (le reste vient du cache)
  python -P tools/build_catalog.py --skip-logos  sans Pillow : logos et symboles de l'exécution précédente
  python -P tools/build_catalog.py --verify      vérifie en plus toutes les adresses d'images produites
  python -P tools/build_catalog.py --refresh     ignore les durées de vie du cache

Débit : TCGdex ≤ 4 req/s, attente croissante sur 429/503 ; Scrydex : seulement les identifiants nouveaux.
Les adresses d'images que la sortie précédente servait déjà sont tenues pour vérifiées : un cache vide (CI)
ne refait pas le scan des 17 000 images FR, seules les cartes nouvelles sont vérifiées (--verify revoit tout
ce qui est en cache et un échantillon frais).
Si une source échoue (n'importe quelle erreur), la sortie précédente de la série est conservée ; si la liste des
séries échoue ou perd plus de MAX_GONE séries publiées, rien n'est écrit (code de sortie 2). Une image n'est
déclarée absente que sur un 404/410 : une erreur passagère laisse la carte comme l'annonce l'API, et un logo ou un
symbole dont une source mieux placée a échoué en passant garde le choix précédent. Dans ces cas, et si le tirage
Scrydex de --verify s'alarme, les sorties sont écrites mais le code de sortie est 3 (à relancer plus tard).
Exécution mensuelle conseillée (CI) : python -P tools/build_catalog.py --verify.
Durées mesurées : complète (--refresh, 25/11/2026) 6 min, 1 112 requêtes ; incrémentale (26/11) 7 s, 1 requête ;
--verify (26/11) 2 min 30, 441 requêtes (dont 40 Scrydex à 1 req/s).
"""
import argparse
import collections
import concurrent.futures
import datetime as dt
import gzip
import json
import os
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # python -P n'ajoute pas le dossier du script

from catalog import cards as C  # noqa: E402
from catalog import images as I  # noqa: E402
from catalog import tables as T  # noqa: E402
from catalog.dex import Dex  # noqa: E402
from catalog.http import DAY, Client, HttpError  # noqa: E402
from catalog.tcgdex import TCGdex, set_ttl  # noqa: E402

ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'data')
API = 'https://api.tcgdex.net/v2'
NEVER = 10 ** 9
# Au-delà de ce nombre de séries publiées absentes de /v2/fr/sets, la liste est tenue pour tronquée.
MAX_GONE = 3
# Codes de sortie : 0 = tout vérifié ; 2 = rien d'écrit (liste des séries indisponible ou suspecte) ;
# 3 = sorties écrites, mais des vérifications n'ont pas pu se faire (échecs passagers, alerte Scrydex) : relancer.
EXIT_UNSURE = 3


def log(*a):
    print(*a, flush=True)


def jdump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def read_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_if_changed(path, obj, stamp=None):
    """Écrit le JSON minifié seulement si le texte change (ordre des clés compris ; le champ `built` est ignoré)."""
    old = read_json(path)
    if isinstance(obj, dict) and 'built' in obj:
        if isinstance(old, dict) and jdump({**old, 'built': None}) == jdump({**obj, 'built': None}):
            return False
        obj['built'] = stamp
    elif old is not None and jdump(old) == jdump(obj):
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(jdump(obj))
    os.replace(tmp, path)
    return True


def gz(data):
    return len(gzip.compress(data, 9))


def load_db(offline, log):
    """Cartes de l'archive TCGdex cards-database (MIT), celle que tools/build_market.py garde dans .cache/mk
    (téléchargée avec son ETag si besoin) -> {cardId: carte de market.cmap.read_db}, ou None si indisponible."""
    try:
        from market import sources as MS
        from market.cmap import read_db
        path, _ = MS.cards_db(MS.Cache(os.path.join(ROOT, '.cache', 'mk'), offline=offline, log=log))
        return read_db(path)[1]
    except Exception as e:  # SourceError, zip illisible, hors ligne sans copie
        log(f'  ! cards-database indisponible ({e}) : finitions complétées reprises de la sortie précédente')
        return None


def to_catalog(files):
    """{setId: fichier data/sets/<id>.json} -> {setId: {'serie', 'cards': [{'id', 'l', 'n', 'img'}]}} (img = base FR ou '')."""
    out = collections.OrderedDict()
    for sid, f in files.items():
        if not f or not f.get('cards'):
            continue
        out[sid] = {'serie': f['serie'], 'cards': [
            {'id': f'{sid}-{c["l"]}', 'l': c['l'], 'n': c['n'],
             'img': C.fr_image_base(f['serie'], sid, c['l']) if c['i'] == 1 else (c['i'] or '')} for c in f['cards']]}
    return out


def main():
    ap = argparse.ArgumentParser(description='Construit le catalogue statique de Cardex.')
    ap.add_argument('--offline', action='store_true', help='cache uniquement, aucune requête réseau')
    ap.add_argument('--only', metavar='SET', help='ne recharge que cette série')
    ap.add_argument('--skip-logos', action='store_true', help='garde les logos et symboles précédents (sans Pillow)')
    ap.add_argument('--verify', action='store_true', help='vérifie toutes les adresses d\'images produites')
    ap.add_argument('--refresh', action='store_true', help='ignore les durées de vie du cache')
    ap.add_argument('--cache', default=os.path.join(ROOT, '.cache', 'ca'), help='dossier du cache')
    ap.add_argument('--report', metavar='JSON', help='écrit aussi le rapport détaillé dans ce fichier')
    args = ap.parse_args()
    t0 = time.time()
    stamp = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    client = Client(args.cache, offline=args.offline, refresh=args.refresh, log=log)
    td = TCGdex(client, log)
    rep = {'problems': []}

    prev_sets = read_json(os.path.join(DATA, 'sets.json'), {}) or {}
    prev_meta = {m['id']: m for m in prev_sets.get('sets', [])}
    prev_img = read_json(os.path.join(DATA, 'cardimg.json'), {}) or {}
    prev_files = {sid: f for sid in prev_meta if (f := read_json(os.path.join(DATA, 'sets', f'{sid}.json')))}
    prev_catalog = to_catalog(prev_files)

    # ---------- 1. séries et blocs ----------
    try:
        lst = td.set_list()
        series = td.series()
    except Exception as e:  # HttpError, Offline, réponse inattendue
        log(f'Liste des séries indisponible ({e}) : rien n\'est écrit, sorties précédentes conservées.')
        return 2
    # liste tronquée ou incomplète : on ne supprime pas en masse des séries publiées
    gone = sorted(set(prev_meta) - {s['id'] for s in lst} - set(T.EXTRA_SETS))
    if len(gone) > MAX_GONE:
        log(f'Liste des séries suspecte : {len(gone)} séries publiées en sont absentes ({", ".join(gone[:8])}…) : '
            f'rien n\'est écrit, sorties précédentes conservées.')
        return 2
    if gone:
        rep['problems'].append(('sets', f'séries retirées par TCGdex : {", ".join(gone)}'))
    entries = {s['id']: s for s in lst}
    tc_index = {sid: i for i, sid in enumerate(entries)}
    for sid in T.EXTRA_SETS:
        if sid not in entries:
            entries[sid] = {'id': sid, 'extra': True}
            tc_index[sid] = len(tc_index)

    def ttl_for(sid, release=None):
        if args.only and sid != args.only:
            return NEVER  # --only : le reste vient du cache tel quel
        if args.only == sid:
            return 0
        return set_ttl(release) if release else DAY

    fr, en = {}, {}
    failed = set()

    def load_detail(sid):
        e = entries[sid]
        if e.get('extra'):
            return sid, None
        try:
            if args.only and sid != args.only:
                d = client.get_json(f'{API}/fr/sets/{sid}', ttl=NEVER)
            else:
                d = td.set_detail(sid, 'fr', e, force=args.only == sid)
            return sid, d
        except Exception as ex:  # toute erreur : série en échec, fichier précédent conservé
            return sid, ex

    with concurrent.futures.ThreadPoolExecutor(3) as ex:
        for sid, d in ex.map(load_detail, list(entries)):
            if isinstance(d, Exception):
                failed.add(sid)
                rep['problems'].append((sid, f'détail : {d}'))
            elif d is not None:
                fr[sid] = d

    td.check_locale()
    rep['locale'] = td.locale_ok

    # ---------- 2. cartes ----------
    dex = Dex(read_json(os.path.join(DATA, 'pokedex.json'), []))
    stats = collections.Counter()
    fin_stats = {}
    raw_cards, how = {}, {}

    def load_cards(sid):
        d = fr.get(sid)
        try:
            if entries[sid].get('extra'):
                # pas de liste REST pour ces séries : sans @locale fiable, on garde le fichier précédent
                if not td.locale_ok:
                    raise HttpError(f'{API}/graphql', 'locale', '@locale indisponible')
                g = td.gql_cards(sid, ttl_for(sid, None))
                if not g:
                    raise HttpError(f'{API}/graphql', 'vide', 'aucune carte')
                return sid, g, 'gql'
            if not d or not d.get('cards'):
                return sid, [], 'vide'
            ttl = ttl_for(sid, d.get('releaseDate'))
            cs, h = td.cards_of(sid, d, ttl)
            return sid, cs, h
        except Exception as ex:  # toute erreur : série en échec, fichier précédent conservé
            return sid, ex, None

    todo = [sid for sid in entries if sid not in failed]
    with concurrent.futures.ThreadPoolExecutor(3) as ex:
        for sid, cs, h in ex.map(load_cards, todo):
            if isinstance(cs, Exception):
                failed.add(sid)
                rep['problems'].append((sid, f'cartes : {cs}'))
                continue
            raw_cards[sid] = cs
            how[sid] = h
    rep['cardsVia'] = dict(collections.Counter(how.values()))

    # métadonnées anglaises (logos, symboles, série supplémentaire pl4) : seulement si utile
    need_en = [sid for sid in entries if entries[sid].get('extra') or not (fr.get(sid) or {}).get('logo') or not (fr.get(sid) or {}).get('symbol')]
    for sid in need_en:
        if raw_cards.get(sid) == [] and not entries[sid].get('extra'):
            continue
        try:
            d = client.get_json(f'{API}/en/sets/{sid}', ttl=NEVER if (args.only and sid != args.only) else 30 * DAY)
            if d:
                en[sid] = d
        except Exception as ex2:
            rep['problems'].append((sid, f'détail EN : {ex2}'))

    # cards-database (archive TCGdex de tools/build_market.py) : variantes que l'API ne donne pas, impressions
    # tamponnées (cards.finishes)
    dbcards = load_db(args.offline, log)
    rep['cardsDb'] = dbcards is not None

    # ---------- 3. lignes compactes par série ----------
    visible, hidden = [], []
    set_files, legal_of = {}, {}
    prev_dir = os.path.join(DATA, 'sets')
    for sid in entries:
        d = fr.get(sid) or {}
        extra = entries[sid].get('extra')
        e_meta = en.get(sid) or {}
        if sid in failed:
            old = read_json(os.path.join(prev_dir, f'{sid}.json'))
            if old and old.get('cards'):
                for c in old['cards']:
                    c['n'] = T.typo(c.get('n'))
                set_files[sid] = old
                visible.append(sid)
                log(f'  ! {sid} : source en échec, fichier précédent conservé')
            continue
        cs = raw_cards.get(sid) or []
        if not cs:
            if not extra:
                hidden.append(sid)
            continue
        serie = T.EXTRA_SETS[sid]['serie'] if extra else d['serie']['id']
        brief_img = {c['id']: c.get('image') or '' for c in d.get('cards') or []}
        prev_f = {c['l']: c.get('f') for c in (prev_files.get(sid) or {}).get('cards') or []}
        era = C.era_finishes if T.ERA_RULE.match(sid) else None
        recs, n_std, n_exp, n_legal, n_mark = [], 0, 0, 0, 0
        seen = set()
        for c in cs:
            if c['id'] in seen:
                continue
            seen.add(c['id'])
            lid = c.get('localId') or c['id'][len(sid) + 1:]
            cat = C.category(c.get('category'))
            if cat is None:
                stats['categoryUnknown'] += 1
                cat = 'P' if c.get('dexId') else 'D'
            img = c.get('image') or ''
            if brief_img.get(c['id'], img) != img:
                stats['imageGqlVsRest'] += 1
                img = img or brief_img.get(c['id'])
            derived = C.fr_image_base(serie, sid, lid)
            i = (1 if img == derived else img) if img else 0
            if img and img != derived:
                stats['imageExplicit'] += 1
            rar = c.get('rarity')
            rar = '' if rar in (None, 'None') else rar
            recs.append({'l': lid, 'n': T.typo(c.get('name') or ''), 'i': i, 'r': rar, 'c': cat,
                         'd': C.dex_ids(c, cat, dex, stats),
                         'f': C.finishes(c, fin_stats, db=dbcards.get(c['id']) if dbcards is not None else False,
                                         sid=sid, prev=prev_f.get(lid), era_rule=era)})
            lg = c.get('legal') or {}
            if lg:
                n_legal += 1
                n_std += bool(lg.get('standard'))
                n_exp += bool(lg.get('expanded'))
            n_mark += bool(c.get('regulationMark'))
        set_files[sid] = {'v': 1, 'id': sid, 'serie': serie, 'cards': recs}
        if n_legal:  # légalité de la série = celle de la majorité de ses cartes (celle des séries TCGdex est figée)
            legal_of[sid] = {'standard': n_std * 2 >= n_legal, 'expanded': n_exp * 2 >= n_legal, 'marks': n_mark}
        visible.append(sid)
    rep['finishStats'] = fin_stats
    rep['cardStats'] = dict(stats)

    # ---------- 4. images de secours ----------
    catalog = to_catalog({sid: set_files[sid] for sid in visible})
    # série en échec (fichier précédent) : ses cartes à l'image FR annoncée mais absente (`fix` précédent) y sont
    # en i=0 ; on leur rend l'image annoncée pour qu'elles retrouvent leur entrée `fix` (sortie inchangée)
    for sid in failed & set(catalog):
        for c in catalog[sid]['cards']:
            if c['id'] in (prev_img.get('fix') or {}) and not c['img']:
                c['img'] = C.fr_image_base(catalog[sid]['serie'], sid, c['l'])
    try:
        en_cards = td.en_cards()
    except Exception as ex3:
        rep['problems'].append(('en', f'cartes EN : {ex3}'))
        en_cards = []
    if not en_cards and prev_img:
        log('  ! cartes EN indisponibles : cardimg.json précédent conservé')
        cardimg, missing, irep = None, set(), {}
    else:
        cardimg, missing, irep = I.build(catalog, en_cards, client, prev_img, verify=args.verify, log=log,
                                         prev_catalog=prev_catalog)
        for sid in visible:
            for c in set_files[sid]['cards']:
                if f'{sid}-{c["l"]}' in missing:
                    c['i'] = 0
    rep['images'] = irep

    # ---------- 5. métadonnées des séries ----------
    def date_of(sid):
        return (fr.get(sid) or en.get(sid) or {}).get('releaseDate') or (prev_meta.get(sid) or {}).get('date') or ''

    # Série toute neuve : TCGdex n'a pas encore rempli les marques de règlement ni la légalité de ses cartes
    # (me06 en novembre 2026 : 141 cartes sans marque, standard=false). Une rotation ne retire jamais une série
    # plus récente qu'une série encore légale : sans aucune marque, une série d'un bloc qui a des séries légales,
    # plus récente que la plus ancienne d'entre elles, est légale aussi.
    for fmt in ('standard', 'expanded'):
        floor = {}
        for s2, x in legal_of.items():
            if x.get(fmt) and x.get('marks') and date_of(s2):
                b = set_files[s2]['serie']
                floor[b] = min(floor.get(b, '9999'), date_of(s2))
        for s2, x in legal_of.items():
            b = set_files[s2]['serie']
            if not x.get('marks') and not x[fmt] and s2 not in T.PARENT and b in floor and date_of(s2) > floor[b]:
                x[fmt] = True
                rep.setdefault('legalInferred', []).append(f'{s2}:{fmt}')

    metas = []
    for sid in visible:
        d = fr.get(sid) or {}
        e_meta = en.get(sid) or {}
        src = d or e_meta
        old = prev_meta.get(sid) or {}
        # code : abbreviation.official de TCGdex (FR, sinon EN), sinon la table faite main
        ab = (d.get('abbreviation') or {}).get('official') or (e_meta.get('abbreviation') or {}).get('official')
        name = T.typo(T.NAME_FIX.get(sid) or (T.EXTRA_SETS.get(sid) or {}).get('name') or d.get('name') or old.get('name') or sid)
        # légalité : celle des cartes ; série en échec (cartes non relues) : celle de la sortie précédente
        # (jamais celle de la série chez TCGdex, figée à standard=false)
        lg = legal_of.get(sid) or (old.get('legal') if (sid in failed or not src) else None) \
            or {k: bool((src.get('legal') or {}).get(k)) for k in ('standard', 'expanded')}
        own_total = (T.EXTRA_SETS.get(sid) or {}).get('ownTotal')
        metas.append({
            'id': sid, 'name': name, 'bloc': set_files[sid]['serie'], 'date': date_of(sid),
            'total': len(set_files[sid]['cards']) if own_total else
            (src.get('cardCount') or {}).get('official') or old.get('total') or len(set_files[sid]['cards']),
            'count': len(set_files[sid]['cards']),
            'code': ab or T.CODES.get(sid) or old.get('code'),
            'logo': None, 'logoLang': None, 'sym': None,
            'legal': {'standard': lg['standard'], 'expanded': lg['expanded']},
            'tag': None, 'dark': False, 'serie': set_files[sid]['serie'],
        })
    # tri : plus récentes d'abord ; à date égale, les séries principales avant les sous-séries et les promos,
    # puis l'ordre TCGdex
    minor = set(T.PARENT) | set(T.SHARED['promo']['sets'])
    metas.sort(key=lambda m: (m['date'], m['id'] not in minor, -tc_index.get(m['id'], 0)), reverse=True)

    # ---------- 6. logos et symboles ----------
    LOGO_KEYS = ('logo', 'logoLang', 'tag', 'dark')
    prev_blocs = {b['id']: b for b in prev_sets.get('blocs', [])}
    bloc_art = {}
    art = None
    rep['artKept'] = []

    def file_ok(p):  # rien, ou fichier auto-hébergé encore présent (jamais une adresse liée : SPEC §6.1)
        return not p or (p.startswith('img/') and os.path.exists(os.path.join(ROOT, p)))

    if args.skip_logos:
        for m in metas:
            old = prev_meta.get(m['id']) or {}
            for k in LOGO_KEYS + ('sym',):
                m[k] = old.get(k, m[k])
        bloc_art = {b['id']: {'logo': b.get('logo'), 'dark': bool(b.get('dark'))} for b in prev_blocs.values()}
    else:
        from catalog.logos import Art
        art = Art(client, ROOT, log)
        info, bloc_art = art.build(metas, fr, en, series)
        for m in metas:
            x = info[m['id']]
            old = prev_meta.get(m['id'])
            # série en échec, ou source mieux placée en échec passager : on garde le choix précédent
            keep_logo = old and (m['id'] in failed or not x['logoSure']) and file_ok(old.get('logo'))
            keep_sym = old and (m['id'] in failed or not x['symSure']) and file_ok(old.get('sym'))
            for k in LOGO_KEYS:
                m[k] = old.get(k) if keep_logo else x[k]
            m['sym'] = old.get('sym') if keep_sym else x['sym']
            if keep_logo or keep_sym:
                rep['artKept'].append(m['id'])
        for bid, b in bloc_art.items():
            old = prev_blocs.get(bid)
            if not b['sure'] and old and file_ok(old.get('logo')):
                bloc_art[bid] = {'logo': old.get('logo'), 'dark': bool(old.get('dark'))}
                rep['artKept'].append('bloc:' + bid)
        rep['art'] = {sid: {k: x[k] for k in ('logoSrc', 'symSrc', 'metrics', 'dark', 'logoSure', 'symSure')}
                      for sid, x in info.items()}
        rep['artFails'] = art.fails
        rep['artUnsure'] = sorted(set(art.unsure))
        rep['artMatted'] = art.matted
        rep['artOpaque'] = art.opaque

    # ---------- 7. blocs : grandes périodes du plus récent au plus ancien, puis les blocs à part ----------
    blocs = []
    firsts = collections.OrderedDict()
    for m in metas:
        b = m['bloc']
        firsts[b] = min(firsts.get(b, m['date']), m['date'])
    for b, first in sorted(firsts.items(), key=lambda kv: (kv[0] not in T.SPECIAL_BLOCS, kv[1]), reverse=True):
        s = series.get(b) or {}
        ba = bloc_art.get(b) or {}
        blocs.append({'id': b, 'name': T.typo(s.get('name') or (prev_blocs.get(b) or {}).get('name') or b),
                      'logo': ba.get('logo'), 'first': first, 'dark': bool(ba.get('dark')),
                      'special': b in T.SPECIAL_BLOCS})

    # ---------- 8. écriture ----------
    out_sets = {'v': 1, 'built': None, 'blocs': blocs,
                'sets': [{k: m[k] for k in ('id', 'name', 'bloc', 'date', 'total', 'count', 'code', 'logo', 'logoLang',
                                             'sym', 'legal', 'tag', 'dark')} for m in metas],
                'hidden': sorted(hidden, key=lambda s: tc_index.get(s, 0))}
    changed = []
    for m in metas:
        sid = m['id']
        if args.only and sid != args.only and os.path.exists(os.path.join(prev_dir, f'{sid}.json')):
            continue
        if write_if_changed(os.path.join(prev_dir, f'{sid}.json'), set_files[sid]):
            changed.append(f'data/sets/{sid}.json')
    keep = {f'{m["id"]}.json' for m in metas}
    if os.path.isdir(prev_dir) and not args.only:
        for fn in os.listdir(prev_dir):
            if fn.endswith('.json') and fn not in keep:
                os.remove(os.path.join(prev_dir, fn))
                changed.append(f'- data/sets/{fn}')
    index = {'v': 1, 'sets': {m['id']: [[c['l'], c['n'], c['d'], c['i']] for c in set_files[m['id']]['cards']] for m in metas}}
    if write_if_changed(os.path.join(DATA, 'cards-index.json'), index):
        changed.append('data/cards-index.json')
    if cardimg is not None and write_if_changed(os.path.join(DATA, 'cardimg.json'), cardimg, stamp):
        changed.append('data/cardimg.json')
    if art is not None:
        keep_img = {p for p in [m['logo'] for m in metas] + [m['sym'] for m in metas] + [b['logo'] for b in blocs]
                    if p and p.startswith('img/')}
        art.files = {p: d for p, d in art.files.items() if p in keep_img}
        w, r = art.write(keep_img)
        rep['imgWritten'], rep['imgRemoved'] = w, r
    if write_if_changed(os.path.join(DATA, 'sets.json'), out_sets, stamp):
        changed.append('data/sets.json')

    # ---------- 9. rapport ----------
    rep['changed'] = changed
    rep['seconds'] = round(time.time() - t0, 1)
    rep['http'] = client.stats
    im = rep.get('images') or {}
    why = []
    if im.get('unsure'):
        why.append(f'{len(im["unsure"])} images non vérifiables (échec passager)')
    if (im.get('sxSample') or {}).get('alarm'):
        why.append('tirage Scrydex : trop d\'échecs (dos de carte ?)')
    if rep.get('artUnsure'):
        why.append(f'{len(rep["artUnsure"])} sources de logos/symboles en échec passager (choix précédent gardé)')
    if not rep.get('cardsDb'):
        why.append('cards-database indisponible (finitions complétées de la sortie précédente)')
    if failed:
        why.append(f'{len(failed)} séries en échec (fichier précédent gardé)')
    rep['exit'] = EXIT_UNSURE if why else 0
    rep['exitWhy'] = why
    summary(rep, metas, hidden, set_files, blocs)
    if args.report:
        with open(args.report, 'w', encoding='utf-8') as f:
            json.dump(rep, f, ensure_ascii=False, indent=1, default=list)
    return rep['exit']


def summary(rep, metas, hidden, set_files, blocs):
    n_cards = sum(m['count'] for m in metas)
    log(f'\nSéries visibles : {len(metas)} · blocs : {len(blocs)} · masquées : {", ".join(hidden) or "aucune"}')
    log(f'Cartes : {n_cards} · via {rep.get("cardsVia")} · @locale fr : {"ok" if rep.get("locale") else "ÉCHEC"}')
    cs = rep.get('cardStats') or {}
    log(f'Numéros de Pokédex devinés : {cs.get("guessed", 0)} cartes · Pokémon sans numéro : {cs.get("noDex", 0)}')
    fs = rep.get('finishStats') or {}
    log('Finitions (cartes) : ' + (', '.join(f'{k} {v}' for k, v in sorted(fs.items()) if not k.startswith('foil:')) or 'API telle quelle'))
    im = rep.get('images') or {}
    if im:
        tot = im.get('total', 0) or 1
        n_alt = sum(im.get(k, 0) for k in ('alt-twin', 'alt-fr', 'alt-en', 'alt-scrydex'))
        log(f'Images : FR {im.get("fr", 0)} · TCGdex EN {im.get("tcgdex-en", 0)} · Scrydex {im.get("scrydex", 0)} · '
            f'réimpressions {n_alt} (jumelle McDonald\'s anglaise {im.get("alt-twin", 0)}, FR d\'origine {im.get("alt-fr", 0)}, '
            f'EN d\'origine {im.get("alt-en", 0) + im.get("alt-scrydex", 0)}) · aucune {len(im.get("none", []))} '
            f'-> couverture {100 * im.get("covered", 0) / tot:.2f} %')
        log(f'  png : {len(im.get("png", []) if isinstance(im.get("png"), list) else [])} · sans image : {", ".join(im.get("none", []))}')
        if im.get('altMissing'):
            log(f'  ! réimpressions sans image trouvée : {im["altMissing"]}')
        if im.get('review'):
            log(f'  revue manuelle Scrydex : {im["review"][:10]}')
        if im.get('failures'):
            log(f'  ! premières adresses non vérifiées : {im["failures"][:10]}')
        if im.get('verify'):
            v = im['verify']
            sx = im.get('sxSample') or {}
            log(f'  --verify : secours TCGdex {v["fallbackTcgdex"]} (échecs {len(v["fallbackTcgdexBad"])}), Scrydex servis '
                f'{v["scrydexIds"]} (tirage frais {sx.get("n", 0)} : {len(sx.get("bad", []))} retirés, '
                f'{len(sx.get("unsure", []))} sans réponse), échantillon FR frais {v["frSample"]} (échecs {len(v["frSampleBad"])})')
        if im.get('unsure'):
            log(f'  ! images non vérifiables (échec passager, laissées comme l\'annonce l\'API) : {im["unsure"][:10]}')
        log(f'  requêtes HEAD réseau : {im.get("net")} · adresses déjà servies par la sortie précédente : {im.get("assumed", 0)}')
    nl = [m['id'] for m in metas if not m['logo']]
    hl = [m['id'] for m in metas if m['logo'] and not m['logo'].startswith('img/')]
    hs = [m['id'] for m in metas if m['sym'] and not m['sym'].startswith('img/')]
    log(f'Logos : {len(metas) - len(nl)} / {len(metas)} (FR {sum(1 for m in metas if m["logoLang"] == "fr")}, '
        f'adresses externes : {", ".join(hl) or "aucune"} ; couverture générée : {", ".join(nl) or "aucune"})')
    log(f'Symboles : {sum(1 for m in metas if m["sym"])} / {len(metas)} (adresses externes : {len(hs)} ; '
        f'sans : {", ".join(m["id"] for m in metas if not m["sym"]) or "aucun"}) · '
        f'plaque claire en thème sombre : {", ".join(m["id"] for m in metas if m["dark"]) or "aucune"}')
    log(f'Blocs : {", ".join(b["id"] + ("*" if b["special"] else "") + ("(plaque)" if b["dark"] else "") for b in blocs)} '
        f'(* = à part)')
    if rep.get('artMatted') is not None:
        log(f'Sources opaques détourées : {", ".join(rep["artMatted"]) or "aucune"} · encore opaques sur fond clair : '
            f'{", ".join(rep["artOpaque"]) or "aucune"}')
    if rep.get('artKept'):
        log(f'  ! choix de logo/symbole précédent gardé (échec passager) : {", ".join(rep["artKept"])}')
    for p in rep['problems']:
        log(f'  ! {p[0]} : {p[1]}')
    files = ['data/sets.json', 'data/cards-index.json', 'data/cardimg.json']
    for f in files:
        p = os.path.join(ROOT, f)
        if os.path.exists(p):
            b = open(p, 'rb').read()
            log(f'{f} : {len(b):,} o · gzip {gz(b):,} o'.replace(',', ' '))
    sizes = []
    for m in metas:
        p = os.path.join(DATA, 'sets', f'{m["id"]}.json')
        if os.path.exists(p):
            b = open(p, 'rb').read()
            sizes.append((len(b), gz(b), m['id']))
    if sizes:
        log(f'data/sets/*.json : {len(sizes)} fichiers · médiane {statistics.median(s[0] for s in sizes):,.0f} o '
            f'(gzip {statistics.median(s[1] for s in sizes):,.0f}) · max {max(sizes)[0]:,} o (gzip {max(sizes, key=lambda s: s[1])[1]:,}, '
            f'{max(sizes)[2]}) · total {sum(s[0] for s in sizes):,} o'.replace(',', ' '))
    tot = 0
    nimg = 0
    for kind in ('sets', 'sym'):
        d = os.path.join(ROOT, 'img', kind)
        if os.path.isdir(d):
            for fn in os.listdir(d):
                tot += os.path.getsize(os.path.join(d, fn))
                nimg += 1
    log(f'img/ : {nimg} fichiers · {tot:,} o'.replace(',', ' '))
    log(f'Fichiers modifiés : {len(rep["changed"])} · {rep["seconds"]} s · HTTP {rep["http"]["net"]} requêtes réseau, '
        f'{rep["http"]["cache"]} depuis le cache, {rep["http"]["retry"]} reprises')
    if rep.get('exitWhy'):
        log(f'Code de sortie {rep["exit"]} (à relancer plus tard) : {" ; ".join(rep["exitWhy"])}')


if __name__ == '__main__':
    sys.exit(main())
