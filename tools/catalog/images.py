"""data/cardimg.json : images de secours des cartes sans image française (FINAL-images §3.1, §3.2 corrigé, §3.4).

FR -> même carte en anglais (TCGdex EN, puis Scrydex, identifiants vérifiés seulement : liste `ok`)
-> même illustration d'une réimpression (`alt`) -> vignette. Chaque adresse produite est vérifiée (HEAD) ;
Scrydex : seulement les identifiants nouveaux, doucement, avec contrôle du nom (sinon revue manuelle), plus un
tirage frais de SX_SAMPLE identifiants connus avec --verify (dos de carte détecté par le préfixe d'ETag).
Une image n'est « absente » que sur un 404/410 ; une erreur passagère (réseau, 5xx, 403) laisse la carte comme
l'annonce l'API (i=1) et la signale dans rep['unsure'] (build_catalog.py sort alors avec le code 3).
"""
import collections
import concurrent.futures
import datetime as dt
import random
import re
import unicodedata
import urllib.parse

from .http import DAY
from .tables import REPRINT, SCRYDEX_ID, SCRYDEX_NONE, SCRYDEX_PLACEHOLDER_ETAG, SCRYDEX_SET

SX = 'https://images.scrydex.com/pokemon/'
TC = 'https://assets.tcgdex.net/'
# Seules réponses qui prouvent qu'une image n'existe pas ; le reste (erreur réseau, 5xx, 403…) = « on ne sait pas ».
ABSENT = (404, 410)
# --verify : identifiants Scrydex déjà vérifiés redemandés à chaque fois (tirage au sort, ≤ 1 req/s), pour
# voir si Scrydex sert son dos de carte à la place ; au-delà de SX_ALARM d'échecs, alerte (code de sortie 3).
SX_SAMPLE = 40
SX_ALARM = 0.25
PTCG_CARDS = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/{}.json'


def set_of(cid):
    return cid[:cid.rfind('-')]


def enc(s):
    """encodeURIComponent"""
    return urllib.parse.quote(s, safe="-_.!~*'()")


def dec(s):
    """decodeURIComponent (sans exception)"""
    try:
        return urllib.parse.unquote(s, errors='strict')
    except UnicodeDecodeError:
        return s


def sx_num(lid):
    return str(int(lid)) if re.fullmatch(r'\d+', lid) else re.sub(r'^H0+(?=\d)', 'H', lid)


def sx_url(sxid, q='low'):
    return f'{SX}{sxid}/{"large" if q == "high" else "small"}'


def norm_name(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn').lower()
    s = s.replace('δ', 'delta').replace('’', "'")
    return re.sub(r'[^a-z0-9]', '', s)


class Verifier:
    """Vérifications HEAD (cache disque du client), en parallèle mais au débit de chaque hôte."""

    def __init__(self, client, known_sx=(), log=print):
        self.c, self.log = client, log
        self.known_sx = set(known_sx)  # identifiants Scrydex déjà vérifiés (sorties précédentes)
        self.assume = set()            # adresses TCGdex produites et vérifiées par une exécution précédente
        self.net = collections.Counter()

    def head_many(self, urls, workers=4):
        urls = list(dict.fromkeys(urls))
        out = {}
        if not urls:
            return out
        with concurrent.futures.ThreadPoolExecutor(workers) as ex:
            for u, m in zip(urls, ex.map(self.c.head, urls)):
                out[u] = m
                if m.get('net'):
                    self.net['scrydex' if 'scrydex' in u else 'tcgdex' if 'tcgdex' in u else 'other'] += 1
        return out

    @staticmethod
    def ok(m, scrydex=False):
        if not m or m.get('status') != 200:
            return False
        t = m.get('type') or ''
        if not (t.startswith('image/') or t == 'application/octet-stream' or m.get('seeded')):
            return False
        if scrydex and (m.get('etag') or '').startswith(SCRYDEX_PLACEHOLDER_ETAG):
            return False
        return True

    @staticmethod
    def verdict(m, scrydex=False):
        """Réponse HEAD -> True (image vérifiée) / False (absente pour de bon : 404, 410, image de remplacement
        Scrydex) / None (on ne sait pas : jamais vérifiée, erreur réseau, 5xx, 403, 200 qui n'est pas une image)."""
        st = (m or {}).get('status')
        if st in ABSENT:
            return False
        if st != 200:
            return None
        if scrydex and (m.get('etag') or '').startswith(SCRYDEX_PLACEHOLDER_ETAG):
            return False
        return True if Verifier.ok(m, scrydex) else None

    def status(self, url):
        """Statut connu sans requête : True / False / None (voir verdict). Le cache HEAD d'abord, puis les
        adresses que la sortie précédente servait déjà (vérifiées à leur ajout ; --verify en revoit un échantillon)."""
        v = self.verdict(self.c.cached_meta('HEAD', url), 'scrydex' in url)
        if v is None and url in self.assume:
            return True
        return v

    def sx_ok(self, sxid):
        """Identifiant Scrydex utilisable : vérifié (cache HEAD ou sortie précédente), sauf s'il est désormais
        absent ou remplacé par le dos de carte (contrôle frais de --verify)."""
        v = self.status(sx_url(sxid))
        return v if v is not None else sxid in self.known_sx


def scrydex_id(sid, raw):
    """Identifiant Scrydex (table par carte, sinon règle de numérotation) : (id, par_table) ou (None, False)."""
    over = SCRYDEX_ID.get(sid, {}).get(raw)
    if over:
        return over, True
    if sid in SCRYDEX_NONE:
        return None, False
    ext = SCRYDEX_SET.get(sid, sid)
    return f'{ext}-{enc(sx_num(dec(raw)))}', False


class NameCheck:
    """Identité d'un nouvel identifiant Scrydex : nom anglais de référence (TCGdex EN même id, sinon dictionnaire
    FR->EN) comparé au nom donné par pokemontcg-data. Sans source de nom : refus (revue manuelle)."""

    def __init__(self, client, en_by_id, fr2en):
        self.c, self.en, self.fr2en = client, en_by_id, fr2en
        self.sets = {}

    def ptcg(self, ext):
        if ext not in self.sets:
            try:
                d = self.c.get_json(PTCG_CARDS.format(ext), ttl=30 * DAY) or []
            except Exception:  # source facultative
                d = []
            self.sets[ext] = {str(c.get('number')): c.get('name') for c in d}
        return self.sets[ext]

    def check(self, cid, fr_name, sxid):
        ref = (self.en.get(cid) or {}).get('name') or self.fr2en.get(fr_name)
        ext, num = sxid.rsplit('-', 1) if '-' in sxid else (sxid, '')
        cand = self.ptcg(ext).get(dec(num))
        if not ref or not cand:
            return False, ref, cand
        a, b = norm_name(ref), norm_name(cand)
        return (a == b or a.replace('delta', '') == b.replace('delta', '')), ref, cand


def known_from(prev):
    """Identifiants Scrydex d'un cardimg.json précédent (vérifiés lors d'une exécution antérieure)."""
    known = set()
    for s, ids in (prev.get('ok') or {}).items():
        for raw in ids.split(' '):
            sxid, _ = scrydex_id(s, raw)
            if sxid:
                known.add(sxid)
    for m in (prev.get('id') or {}).values():
        known.update(m.values())
    known.update((prev.get('fix') or {}).values())
    known.update(v[3:] for v in (prev.get('alt') or {}).values() if v.startswith('sx:'))
    return known


def assumed_from(prev, prev_catalog):
    """Première adresse TCGdex (FR ou EN) de chaque carte d'après les sorties précédentes : vérifiée lors de
    l'exécution qui l'a produite. Un cache vide (CI) ne refait donc pas les 17 000 HEAD du scan des images FR."""
    if not prev or not prev_catalog:
        return set()
    M, OK = _prep({'en': {}, 'sx': {}, 'id': {}, 'ok': {}, 'alt': {}, 'from': {}, 'png': [], 'fix': {}, **prev})
    out = set()
    for s in prev_catalog.values():
        for c in s['cards']:
            urls, _, _ = card_img(M, OK, c['id'], c['img'], c['l'])
            if urls and urls[0].startswith(TC):
                out.add(urls[0])
    return out


def build(catalog, en_cards, client, prev=None, verify=False, log=print, sample=200, prev_catalog=None):
    """catalog : {setId: {'serie', 'cards': [{'id','l','n','img'}]}} (img = base FR donnée par l'API, ou '').
    prev / prev_catalog : cardimg.json et fichiers de séries précédents (adresses déjà vérifiées).

    Renvoie (cardimg, cartes dont l'image FR annoncée n'existe pas, rapport)."""
    V = Verifier(client, known_from(prev or {}), log)
    V.assume = assumed_from(prev, prev_catalog)
    rep = {'review': [], 'failures': [], 'noLowPng': [], 'assumed': len(V.assume), 'unsure': []}
    en_by_id = {c['id']: c for c in en_cards}
    if verify:  # avant tout choix : un identifiant devenu absent ou dos de carte sort de la liste `ok`
        rep['sxSample'] = sample_scrydex(V, log)

    # dictionnaire FR -> EN (cartes présentes dans les deux langues, traduction dominante)
    pairs = collections.defaultdict(collections.Counter)
    for s in catalog.values():
        for c in s['cards']:
            e = en_by_id.get(c['id'])
            if e and e.get('name'):
                pairs[c['n']][e['name']] += 1
    fr2en = {fr: cnt.most_common(1)[0][0] for fr, cnt in pairs.items() if cnt.most_common(1)[0][1] * 4 >= 3 * sum(cnt.values())}
    names = NameCheck(client, en_by_id, fr2en)

    # ---- 1. images FR : low.webp de chaque carte (cache = scan complet, sinon HEAD au débit TCGdex)
    fr_cards = [c for s in catalog.values() for c in s['cards'] if c['img']]
    low = {c['id']: c['img'] + '/low.webp' for c in fr_cards}
    unknown = [u for u in low.values() if V.status(u) is None]
    if unknown:
        log(f'  images FR jamais vérifiées : {len(unknown)} HEAD')
        V.head_many(unknown)
    second = {c['id']: (c['img'] + '/low.png', c['img'] + '/high.webp') for c in fr_cards if not V.status(low[c['id']])}
    V.head_many([u for us in second.values() for u in us if V.status(u) is None])
    png, missing, unsure = [], set(), []
    for cid, (p, h) in second.items():
        if V.status(p):
            png.append(cid)          # seul low.webp manque : low.png
        elif V.status(h):
            rep['noLowPng'].append(cid)  # ni low.webp ni low.png, mais high.webp : rare, signalé
        elif V.status(low[cid]) is False and V.status(p) is False and V.status(h) is False:
            missing.add(cid)         # annoncée mais absente partout (404/410 sur les trois)
        else:
            unsure.append(cid)       # échec passager : on garde l'image annoncée par l'API (i=1), signalé
    rep['frListed'] = len(fr_cards)
    rep['png'] = sorted(png)
    rep['frMissing'] = sorted(missing)
    rep['frUnsure'] = sorted(unsure)
    rep['unsure'] += [('fr', cid) for cid in sorted(unsure)]

    # ---- 2. cartes sans image FR (ou image FR absente partout)
    need = [(sid, c) for sid, s in catalog.items() for c in s['cards'] if not c['img'] or c['id'] in missing]
    by_id = {c['id']: c for _, c in need}
    en_url, sx_cand = {}, {}
    for sid, c in need:
        e = en_by_id.get(c['id'])
        if e and e.get('image'):
            m = re.fullmatch(re.escape(TC) + r'en/([^/]+)/' + re.escape(sid) + r'/(.+)', e['image'])
            if m and m.group(2) == enc(dec(c['l'])):
                en_url[c['id']] = (m.group(1), e['image'] + '/low.webp')
        sxid, over = scrydex_id(sid, c['l'])
        if sxid:
            sx_cand[c['id']] = (sxid, over)
    V.head_many([u for _, u in en_url.values() if V.status(u) is None])
    en_ok = {cid for cid, (_, u) in en_url.items() if V.status(u)}
    rep['unsure'] += [('en', cid) for cid, (_, u) in sorted(en_url.items()) if V.status(u) is None]

    # Scrydex : identifiants déjà vérifiés ; les nouveaux : HEAD (≤ 1 req/s) puis contrôle du nom
    sx_ok, new_sx = set(), []
    for cid, (sxid, _) in sx_cand.items():
        st = V.status(sx_url(sxid))
        if st is False:
            continue                 # absent, ou dos de carte (contrôle frais de --verify)
        if st or sxid in V.known_sx:
            sx_ok.add(cid)
        else:
            new_sx.append(cid)
    twins = [t for t, _ in REPRINT.values() if t and not V.sx_ok(t) and V.status(sx_url(t)) is None]
    if (new_sx or twins) and not client.offline:
        log(f'  Scrydex : {len(new_sx) + len(twins)} identifiants nouveaux à vérifier')
        res = V.head_many([sx_url(sx_cand[cid][0]) for cid in new_sx] + [sx_url(t) for t in twins], workers=1)
        for cid in new_sx:
            sxid = sx_cand[cid][0]
            if not V.ok(res.get(sx_url(sxid)), True):
                if V.verdict(res.get(sx_url(sxid)), True) is None:
                    rep['unsure'].append(('scrydex', cid))
                continue
            ok, ref, cand = names.check(cid, by_id[cid]['n'], sxid)
            if ok:
                sx_ok.add(cid)
            else:
                rep['review'].append({'id': cid, 'fr': by_id[cid]['n'], 'ref': ref, 'scrydex': sxid, 'name': cand})
    elif new_sx:
        rep['review'] += [{'id': cid, 'scrydex': sx_cand[cid][0], 'why': 'hors ligne'} for cid in new_sx]

    # ---- 3. tables
    M = {'en': {}, 'sx': {}, 'id': {}, 'ok': {}, 'fix': {}}
    by_set = collections.defaultdict(list)
    for sid, c in need:
        if c['id'] in missing and c['id'] in sx_ok:
            M['fix'][c['id']] = sx_cand[c['id']][0]   # image FR annoncée mais absente : Scrydex direct
            continue
        by_set[sid].append(c)
    for sid, cs in by_set.items():
        ids = {c['id'] for c in cs}
        A = ids & en_ok
        B = ids & sx_ok
        # TCGdex EN pour la série si toutes ses cartes sans image l'ont, ou si Scrydex n'en couvre pas certaines
        if A and (A == ids or A - B):
            series = {en_url[i][0] for i in A}
            if len(series) == 1:
                M['en'][sid] = series.pop()
        for c in cs:
            if c['id'] not in sx_ok:
                continue
            sxid, over = sx_cand[c['id']]
            if over:
                M['id'].setdefault(sid, {})[c['l']] = sxid
            else:
                M['ok'].setdefault(sid, []).append(c['l'])
                M['sx'][sid] = SCRYDEX_SET.get(sid, sid)

    out = {'v': 1, 'built': None,
           'en': dict(sorted(M['en'].items())),
           'sx': dict(sorted(M['sx'].items())),
           'id': {s: dict(sorted(m.items())) for s, m in sorted(M['id'].items())},
           'ok': {s: ' '.join(v) for s, v in sorted(M['ok'].items())},
           'alt': {}, 'from': {},
           'png': sorted(png),
           'fix': dict(sorted(M['fix'].items()))}

    # ---- 4. même illustration (réimpressions, FINAL-images §2.4b). Ordre retenu (McDonald's) : la carte
    # McDonald's anglaise exacte, puis l'image FR de l'impression d'origine, puis son image anglaise
    # (résolue comme n'importe quelle carte : TCGdex EN, sinon Scrydex vérifié).
    img_of, lid_of = {}, {}
    for sid, s in catalog.items():
        for c in s['cards']:
            if c['img'] and c['id'] not in missing:
                img_of[c['id']] = c['img']
            lid_of[c['id']] = (sid, c['l'])
    M2, OK2 = _prep(out)
    alt, src_from = {}, {}
    for cid, (twin, orig) in REPRINT.items():
        if cid not in lid_of or cid in img_of or cid in en_ok or cid in sx_ok:
            continue
        val = None
        if twin and V.sx_ok(twin):
            val = 'sx:' + twin                                   # la carte McDonald's anglaise exacte
        elif orig in lid_of:
            urls, _, _ = card_img(M2, OK2, orig, img_of.get(orig, ''), lid_of[orig][1])
            u = urls[0] if urls else ''
            if orig in img_of:
                val = 'fr:' + img_of[orig][len(TC) + 3:]          # image FR de l'impression d'origine
            elif u.startswith(TC + 'en/') and V.status(u):
                val = 'en:' + u[len(TC) + 3:].rsplit('/', 1)[0]  # son image anglaise (TCGdex)
            elif u.startswith(SX) and _sx_known(u, V):
                val = 'sx:' + u[len(SX):].rsplit('/', 1)[0]      # son image anglaise (Scrydex vérifié)
        if val:
            alt[cid] = val
            if twin is None or val != 'sx:' + twin:
                src_from[cid] = orig
        else:
            rep.setdefault('altMissing', []).append(cid)
    out['alt'] = dict(sorted(alt.items()))
    out['from'] = dict(sorted(src_from.items()))

    # ---- 5. simulation du résolveur sur toutes les cartes ; chaque première adresse doit être vérifiée
    sim = simulate(out, catalog, missing)
    rep.update(sim['counts'])
    rep['bySource'] = sim['bySource']
    rep['none'] = sim['none']
    unk = [u for u in sim['first'].values() if u and V.status(u) is None and not _sx_known(u, V)]
    if unk:
        V.head_many(unk)
    rep['failures'] = [(cid, u) for cid, u in sim['first'].items() if u and not (V.status(u) or _sx_known(u, V))]
    if verify:
        rep['verify'] = reverify(V, catalog, out, missing, sample, log)
    rep['net'] = dict(V.net)
    return out, missing, rep


def _sx_known(u, V):
    return u.startswith(SX) and V.sx_ok(u[len(SX):].rsplit('/', 1)[0])


def sample_scrydex(V, log, n=SX_SAMPLE):
    """--verify : contrôle frais (cache ignoré, ≤ 1 req/s, dans l'esprit des conditions Scrydex) d'un tirage
    d'identifiants déjà vérifiés. Un identifiant absent (404) ou servi avec le dos de carte (préfixe d'ETag) est
    retiré de la sortie ; beaucoup d'échecs d'un coup = Scrydex a changé : alerte."""
    ids = sorted(V.known_sx)
    if not ids or V.c.offline:
        return {'n': 0, 'bad': [], 'unsure': [], 'alarm': False}
    rnd = random.Random(dt.date.today().toordinal())  # un autre tirage chaque jour, reproductible dans la journée
    smp = rnd.sample(ids, min(n, len(ids)))
    keep = V.c.refresh
    V.c.refresh = True
    try:
        res = V.head_many([sx_url(i) for i in smp], workers=1)
    finally:
        V.c.refresh = keep
    bad = [i for i in smp if V.verdict(res.get(sx_url(i)), True) is False]
    unsure = [i for i in smp if V.verdict(res.get(sx_url(i)), True) is None]
    alarm = len(bad) >= SX_ALARM * len(smp)
    log(f'  --verify : tirage Scrydex frais {len(smp)} identifiants, {len(bad)} absents ou dos de carte '
        f'{bad[:5]}, {len(unsure)} sans réponse' + (' — ALERTE : Scrydex a changé ?' if alarm else ''))
    return {'n': len(smp), 'bad': bad, 'unsure': unsure, 'alarm': alarm}


def card_img(M, OK, cid, image, raw, q='low'):
    """Portage Python de cardImg() (FINAL-images §3.2, version corrigée). Renvoie (urls, en, same)."""
    if cid in M['fix']:
        return [sx_url(M['fix'][cid], q)], True, False
    if image:
        w, p = f'{image}/{q}.webp', f'{image}/{q}.png'
        return ([p] if q == 'low' and cid in M['_png'] else [w, p]), False, False
    sid = set_of(cid)
    lid = dec(raw)
    urls = []
    if sid in M['en']:
        urls.append(f'{TC}en/{M["en"][sid]}/{sid}/{enc(lid)}/{q}.webp')
    sx = M['id'].get(sid, {}).get(raw) or (raw in OK.get(sid, ()) and M['sx'].get(sid) and f'{M["sx"][sid]}-{enc(sx_num(lid))}')
    if sx:
        urls.append(sx_url(sx, q))
    if urls:
        return urls, True, False
    a = M['alt'].get(cid, '')
    same = cid in M.get('from', {})   # sans carte d'origine : jumelle anglaise exacte (la même carte)
    if a.startswith('sx:'):
        return [sx_url(a[3:], q)], True, same
    if a.startswith('fr:'):
        b = f'{TC}fr/{a[3:]}'
        return [f'{b}/{q}.webp', f'{b}/{q}.png'], False, True
    if a.startswith('en:'):
        return [f'{TC}en/{a[3:]}/{q}.webp'], True, True
    return [], False, False


def _direct(M, OK, cid, raw):
    """La carte a-t-elle une image anglaise directe (TCGdex EN ou Scrydex vérifié) ?"""
    sid = set_of(cid)
    return sid in M['en'] or bool(M['id'].get(sid, {}).get(raw)) or (raw in OK.get(sid, ()) and sid in M['sx'])


def _prep(M):
    M = dict(M)
    M['_png'] = set(M['png'])
    return M, {s: set(v.split(' ')) for s, v in M['ok'].items()}


def simulate(M, catalog, missing=()):
    M, OK = _prep(M)
    counts = collections.Counter()
    by_source = collections.defaultdict(collections.Counter)
    first, none = {}, []
    for sid, s in catalog.items():
        for c in s['cards']:
            image = c['img'] if c['id'] not in missing else ''
            urls, en, same = card_img(M, OK, c['id'], image, c['l'])
            u = urls[0] if urls else ''
            first[c['id']] = u
            via_alt = bool(u) and not image and c['id'] not in M['fix'] and c['id'] in M['alt'] \
                and not _direct(M, OK, c['id'], c['l'])
            if not u:
                k = 'none'
                none.append(c['id'])
            elif via_alt:
                k = 'alt-twin' if not same else 'alt-scrydex' if u.startswith(SX) else 'alt-en' if u.startswith(TC + 'en/') else 'alt-fr'
            elif u.startswith(SX):
                k = 'scrydex'
            elif u.startswith(TC + 'en/'):
                k = 'tcgdex-en'
            else:
                k = 'fr'
            counts[k] += 1
            by_source[sid][k] += 1
    counts['total'] = sum(counts.values())
    counts['covered'] = counts['total'] - counts['none']
    return {'counts': dict(counts), 'bySource': {k: dict(v) for k, v in by_source.items()}, 'first': first, 'none': none}


def reverify(V, catalog, M, missing, sample, log):
    """--verify : toutes les adresses de secours (basse et haute définition), plus un échantillon frais
    (cache ignoré) d'images FR basse et haute définition, pour détecter une régression chez TCGdex."""
    V.assume = set()  # ici on ne suppose rien : tout ce qui n'est pas dans le cache HEAD est redemandé
    M2, OK = _prep(M)
    tc_urls, sx_ids, fr_low, fr_high = set(), set(), [], []
    for sid, s in catalog.items():
        for c in s['cards']:
            image = c['img'] if c['id'] not in missing else ''
            for q in ('low', 'high'):
                urls, _, _ = card_img(M2, OK, c['id'], image, c['l'], q)
                for u in urls:
                    if u.startswith(SX):
                        sx_ids.add(u[len(SX):].rsplit('/', 1)[0])
                    elif u.endswith('.png'):
                        continue  # secours du navigateur après un .webp absent
                    elif image and u.startswith(image + '/'):
                        (fr_low if q == 'low' else fr_high).append(u)
                    else:
                        tc_urls.add(u)
    need = [u for u in tc_urls if V.status(u) is None]
    log(f'  --verify : {len(tc_urls)} adresses TCGdex de secours (dont {len(need)} à vérifier), '
        f'{len(sx_ids)} identifiants Scrydex servis (vérifiés à leur ajout ; tirage frais : voir sxSample)')
    V.head_many(need)
    bad_tc = sorted(u for u in tc_urls if not V.status(u))
    bad_sx = sorted(i for i in sx_ids if not V.sx_ok(i))
    rnd = random.Random(20261125)
    smp = rnd.sample(sorted(fr_low), min(sample, len(fr_low))) + rnd.sample(sorted(fr_high), min(sample, len(fr_high)))
    keep = V.c.refresh
    V.c.refresh = True
    try:
        res = V.head_many(smp)
    finally:
        V.c.refresh = keep
    bad_fr = sorted(u for u in smp if not V.ok(res.get(u)))
    return {'fallbackTcgdex': len(tc_urls), 'fallbackTcgdexBad': bad_tc, 'scrydexIds': len(sx_ids), 'scrydexBad': bad_sx,
            'frSample': len(smp), 'frSampleBad': bad_fr}
