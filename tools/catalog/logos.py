"""Logos et symboles des séries, auto-hébergés en WebP (FINAL-images §4–§5, SPEC §6.1).

Logos : rognés (marges transparentes), ≤ 240×96, WebP q70 ; symboles ≤ 64×64, WebP q80. Une source opaque
(fond uni relié aux bords : logo FR de swsh3, symboles bw1 et mcd12) est détourée avant le rognage.
Nom de fichier = <série ou alias>.<8 hex>.webp, où le hash porte sur le contenu de la source (octets
téléchargés) et les réglages (PIPE, qualité, taille) : il ne dépend pas de l'encodeur WebP de la machine, et
un fichier déjà présent sous ce nom n'est jamais réécrit (immuable : cache-first pour toujours côté service
worker ; une CI avec une autre version de Pillow/libwebp ne renomme rien).

Logo, dans l'ordre : logo partagé (promos, POP, McDonald's, kits EX) ; source FR hors TCGdex (LOGO_SOURCE) ;
TCGdex FR (.webp puis .png, y compris un logo non annoncé par l'API) ; sous-série -> logo FR de la série mère +
étiquette ; TCGdex EN ; images.pokemontcg.io
(licence permissive, téléchargé une fois et auto-hébergé). Jamais d'image Scrydex auto-hébergée (ce serait du
« mirroring », conditions Scrydex §4) : en dernier recours, l'adresse Scrydex donnée par pokemontcg-data (jamais
devinée) est liée telle quelle, après vérification (200, image, pas l'image de remplacement, CORS « * »).
Sinon logo null : l'interface affiche une couverture générée (symbole + code).

Symbole : TCGdex FR (.png puis .webp ; 77 .webp manquent), EN, images.pokemontcg.io, symbole de la série mère,
puis Scrydex lié (adresse de pokemontcg-data, ou /<extension>-symbol/symbol vérifiée : Scrydex répond 404 pour un
symbole inconnu).

Échec passager (réseau, 5xx, source absente du cache hors ligne) : le choix de la série est marqué « pas sûr »
(logoSure / symSure) et build_catalog.py garde alors le logo ou le symbole de la sortie précédente, au lieu de
descendre vers une source moins bonne.
"""
import hashlib
import io
import os
import re
import urllib.parse

from .tables import (BLOC_LOGO, FR_LOGO_IS_EN, LOGO_SOURCE, NO_SYMBOL, PARENT, PARENT_SYMBOL,
                     SCRYDEX_LOGO_PLACEHOLDER_ETAG, SCRYDEX_NONE, SCRYDEX_SET, SHARED, SYMBOL_FROM)

TC = 'https://assets.tcgdex.net/'
SX = 'https://images.scrydex.com/pokemon/'
PTCG_SETS = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json'
LOGO_MAX = (240, 96)
SYM_MAX = (64, 64)
# Qualité WebP (couleur, alpha). Logos : q70 / alpha 70 au lieu de q80 / alpha sans perte : −25 % (919 -> 689 Ko
# pour 127 fichiers), sans différence visible à 64×36 ni à 160×64 (planche comparée) ; l'écran Séries
# entièrement parcouru doit rester sous 1 Mo (FINAL-perf §4.10). Symboles : q80, alpha sans perte.
LOGO_Q = (70, 70)
SYM_Q = (80, 100)
DAY = 86400
# Version du traitement (détourage, rognage, redimensionnement) : entre dans le hash des noms de fichiers.
# À changer quand le traitement change, pour que les nouveaux fichiers prennent de nouveaux noms.
PIPE = 'cardex-art-2'
# Détourage d'une source opaque : écart toléré avec la couleur du fond, largeur du liseré désassocié.
MATTE_TOL = 16
MATTE_BAND = 2

# Thème sombre : surface des listes #17171b (css/tokens.css). Un logo reçoit la plaque claire (dark=true) si
# rien n'y ressort (90e centile du contraste < 3 : « TRAINER KIT » bleu nuit) ou s'il est surtout noir
# (contraste médian < 1,5 et ≥ 45 % de pixels presque noirs : Nuit Noire, Équilibre Parfait, étoile PROMO, POP).
# Les autres gardent leur liseré foncé, rendu lisible par la lueur blanche de css/base.css.
DARK_SURFACE = (23, 23, 27)
DARK_P90 = 3.0
DARK_P50 = 1.5
DARK_NEARBLACK = 0.45

# Blocs où le symbole d'une série est son code imprimé dans un cadre (SVI, MEG, 30C…).
BADGE_BLOCS = {'sv', 'me'}


def _pil():
    from PIL import Image  # Pillow seulement pour cette étape (--skip-logos s'en passe)
    return Image


def host(u):
    return urllib.parse.urlsplit(u or '').hostname or ''


def dark_metrics(im):
    """Contraste de chaque pixel opaque contre la surface sombre : (p50, p90, part presque noire)."""
    import numpy as np
    a = np.asarray(im, dtype=np.float32) / 255.0

    def lum(rgb):
        lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
        return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]

    m = a[..., 3] > 0.5
    if not m.any():
        return {'p50': 0.0, 'p90': 0.0, 'nearBlack': 1.0}
    c = (lum(a[..., :3])[m] + 0.05) / (float(lum(np.array(DARK_SURFACE, dtype=np.float32) / 255.0)) + 0.05)
    return {'p50': round(float(np.percentile(c, 50)), 2), 'p90': round(float(np.percentile(c, 90)), 2),
            'nearBlack': round(float((c < 1.25).mean()), 3)}


def is_dark(k):
    return bool(k) and (k['p90'] < DARK_P90 or (k['p50'] < DARK_P50 and k['nearBlack'] >= DARK_NEARBLACK))


def _grow(m, diag=False):
    """Dilatation d'un masque booléen d'un pixel (4 voisins, ou 8 avec diag)."""
    g = m.copy()
    g[1:] |= m[:-1]
    g[:-1] |= m[1:]
    g[:, 1:] |= m[:, :-1]
    g[:, :-1] |= m[:, 1:]
    if diag:
        g[1:, 1:] |= m[:-1, :-1]
        g[:-1, :-1] |= m[1:, 1:]
        g[1:, :-1] |= m[:-1, 1:]
        g[:-1, 1:] |= m[1:, :-1]
    return g


def unmatte(im, Image):
    """Source opaque sur un fond uni (logo FR de swsh3 : RGB sur blanc). Le fond relié aux bords (écart ≤ MATTE_TOL
    avec la couleur médiane du bord) devient transparent ; le liseré anticrénelé (MATTE_BAND px) est désassocié du
    fond (« couleur vers alpha ») : pas de halo clair sur fond sombre. Les zones claires enfermées dans le dessin
    restent opaques. Renvoie (image, True), ou (image, False) si le bord n'est pas uni (rien à détourer)."""
    import numpy as np
    a = np.asarray(im.convert('RGBA'), dtype=np.float32)
    rgb = a[..., :3]
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    like = np.abs(rgb - bg).max(axis=2) <= MATTE_TOL
    edge_like = np.concatenate([like[0], like[-1], like[:, 0], like[:, -1]])
    if edge_like.mean() < 0.6:
        return im, False
    reach = np.zeros_like(like)
    reach[0], reach[-1] = like[0], like[-1]
    reach[:, 0] |= like[:, 0]
    reach[:, -1] |= like[:, -1]
    n = int(reach.sum())
    while True:  # reconstruction : le fond relié aux bords seulement
        reach = _grow(reach) & like
        k = int(reach.sum())
        if k == n:
            break
        n = k
    near = reach
    for _ in range(MATTE_BAND):
        near = _grow(near, diag=True)
    band = near & ~reach
    bgn, p = bg / 255.0, rgb / 255.0
    up = np.where(p > bgn, (p - bgn) / np.maximum(1.0 - bgn, 1e-6), 0.0)
    dn = np.where(p < bgn, (bgn - p) / np.maximum(bgn, 1e-6), 0.0)
    al = np.clip(np.maximum(up, dn).max(axis=2), 0.0, 1.0)
    col = np.clip(bgn + (p - bgn) / np.maximum(al, 1e-6)[..., None], 0.0, 1.0) * 255.0
    out = a.copy()
    out[..., 3] = np.where(reach, 0.0, np.where(band, al * a[..., 3], a[..., 3]))
    out[..., :3] = np.where(band[..., None], col, rgb)
    out[..., :3] = np.where(reach[..., None], 0.0, out[..., :3])
    return Image.fromarray(np.rint(out).astype(np.uint8), 'RGBA'), True


def opaque_light_border(im):
    """Contrôle de sortie : image entièrement opaque dont le bord est clair (une boîte claire en thème sombre)."""
    import numpy as np
    a = np.asarray(im.convert('RGBA'), dtype=np.float32)
    if a[..., 3].min() < 250:
        return False
    border = np.concatenate([a[0, :, :3], a[-1, :, :3], a[:, 0, :3], a[:, -1, :3]])
    return float(border.mean()) > 160.0


class Art:
    def __init__(self, client, root, log=print):
        self.c, self.root, self.log = client, root, log
        self.files = {}      # chemin relatif -> octets à écrire (None : fichier déjà présent, gardé tel quel)
        self.by_hash = {}    # (kind, hash) -> chemin (dédoublonnage)
        self.fails = []
        self.hotlinks = []   # adresses Scrydex liées (pas auto-hébergées)
        self.unsure = []     # sources en échec passager (réseau, hors ligne sans copie en cache)
        self.opaque = []     # images publiées encore opaques sur fond clair (contrôle : doit rester vide)
        self.matted = []     # sources opaques détourées
        self.Image = _pil()
        self._ptcg = None

    # ---------- sources ----------
    def ptcg_sets(self):
        if self._ptcg is None:
            try:
                lst = self.c.get_json(PTCG_SETS, ttl=30 * DAY) or []
            except Exception as e:  # source facultative
                self.log(f'  ! pokemontcg-data indisponible : {e}')
                lst = []
            self._ptcg = {s['id']: s for s in lst}
        return self._ptcg

    def _open(self, data):
        try:
            im = self.Image.open(io.BytesIO(data))
            im.load()
        except Exception:
            return None
        if im.width < 8 or im.height < 8:
            return None
        out = im.convert('RGBA')
        out.info['cardex_src'] = hashlib.sha1(data).hexdigest()  # hash de la source : nom du fichier publié
        return out

    def fetch(self, url):
        """(image PIL RGBA à auto-héberger | None, sûr). Jamais Scrydex. sûr=False : échec passager (réseau, 5xx,
        403, hors ligne sans copie en cache) : on ne sait pas si la source existe."""
        if not url or 'scrydex.com' in host(url):
            return None, True
        try:
            st, ctype, data, _ = self.c.get_bytes(url)
        except Exception:  # Offline (absente du cache), erreur inattendue
            self.unsure.append(url)
            return None, False
        if st == 200 and data:
            return self._open(data), True   # illisible : définitif
        if st in (404, 410):
            return None, True
        self.unsure.append(url)
        return None, False

    def first(self, urls):
        """Première source valide : (url, image, sûr) ; sûr=False si une source mieux placée a échoué en passant."""
        sure = True
        for u in urls:
            im, ok = self.fetch(u)
            if im is not None:
                return u, im, sure
            sure = sure and ok
        return None, None, sure

    def hotlink(self, url, logo=True):
        """Adresse Scrydex utilisable telle quelle : 200, image, pas l'image de remplacement, CORS ouvert.
        Renvoie (url | None, image pour la mesure de luminance | None, sûr)."""
        if not url or host(url) != 'images.scrydex.com':
            return None, None, True
        m = self.c.head(url, origin='https://example.com')  # origine neutre : seule la réponse CORS compte
        st = m.get('status')
        if st != 200:
            sure = st in (404, 410)
            if not sure:
                self.unsure.append(url)
            return None, None, sure
        if not (m.get('type') or '').startswith('image/'):
            return None, None, True
        if logo and (m.get('etag') or '').startswith(SCRYDEX_LOGO_PLACEHOLDER_ETAG):
            return None, None, True
        if (m.get('acao') or '') != '*':
            self.log(f'  ! {url} : pas de CORS ouvert ({m.get("acao")}), non retenu')
            return None, None, True
        im, sure = None, True
        if logo:  # une seule lecture, en cache local, pour décider de la plaque claire (rien n'est publié)
            try:
                st, _, data, _ = self.c.get_bytes(url, accept='image/png,image/*;q=0.8')
            except Exception:
                st, data = 0, None
            im = self._open(data) if st == 200 and data else None
            if im is None:  # plaque claire indécidable : on garde le choix précédent
                sure = False
                self.unsure.append(url)
        self.hotlinks.append(url)
        return url, im, sure

    # ---------- traitement ----------
    def trim(self, im, name=''):
        a = im.getchannel('A')
        lo, hi = a.getextrema()
        if lo >= 250:  # opaque : on détoure d'abord le fond uni relié aux bords
            im2, done = unmatte(im, self.Image)
            if done:
                self.matted.append(name)
                im = im2
                a = im.getchannel('A')
                lo, hi = a.getextrema()
        if lo < 250:  # transparence : on rogne les marges presque invisibles
            bb = a.point(lambda v: 255 if v > 8 else 0).getbbox()
        else:         # opaque sans fond uni : on rogne la couleur du coin
            from PIL import ImageChops
            bg = self.Image.new('RGBA', im.size, im.getpixel((0, 0)))
            diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 16 else 0)
            bb = diff.getbbox()
        return im.crop(bb) if bb else im

    def fit(self, im, box):
        w, h = im.size
        sc = min(1.0, box[0] / w, box[1] / h)
        if sc >= 1.0:
            return im
        size = (max(1, round(w * sc)), max(1, round(h * sc)))
        # alpha prémultiplié pendant le redimensionnement : pas de liseré sombre autour des formes
        return im.convert('RGBa').resize(size, self.Image.LANCZOS).convert('RGBA')

    def save(self, kind, name, im):
        """WebP nommé au hash de la source et des réglages ; une même source réutilise le même fichier, et un
        fichier déjà présent sous ce nom est gardé tel quel (pas de réencodage)."""
        box = LOGO_MAX if kind == 'sets' else SYM_MAX
        q, aq = LOGO_Q if kind == 'sets' else SYM_Q
        src = im.info.get('cardex_src') or hashlib.sha1(im.tobytes()).hexdigest()
        h = hashlib.sha1(f'{PIPE}|{kind}|{box}|{q}|{aq}|{src}'.encode()).hexdigest()[:8]
        if (kind, h) in self.by_hash:
            return self.by_hash[(kind, h)]
        pim = self.fit(self.trim(im, name), box)
        if opaque_light_border(pim):
            self.opaque.append(f'{kind}/{name}')
            self.log(f'  ! {kind}/{name} : image opaque sur fond clair (une boîte claire en thème sombre)')
        safe = re.sub(r'[^A-Za-z0-9._-]', '_', name)
        path = f'img/{kind}/{safe}.{h}.webp'
        self.by_hash[(kind, h)] = (path, pim)
        if os.path.exists(os.path.join(self.root, path.replace('/', os.sep))):
            self.files[path] = None
        else:
            buf = io.BytesIO()
            pim.save(buf, 'WEBP', quality=q, alpha_quality=aq, method=6)
            self.files[path] = buf.getvalue()
        return path, pim

    # ---------- séries ----------
    def build(self, metas, fr, en, series):
        """metas : [{id, bloc, serie, date, …}] visibles (ordre d'affichage). fr/en : détails TCGdex par série.
        Renvoie ({setId: {logo, logoLang, sym, dark, tag, logoSure, symSure, src…}},
                 {blocId: {logo, dark, sure}}).
        logoSure / symSure = False : une source mieux placée a échoué en passant (garder la sortie précédente)."""
        ptcg = self.ptcg_sets()
        order = sorted(metas, key=lambda m: (m['date'] or '', m['id']))  # plus anciennes d'abord : noms stables
        by_id = {m['id']: m for m in metas}
        own, sym, sym_src, info = {}, {}, {}, {}

        def ptcg_of(sid):
            p = ptcg.get(SCRYDEX_SET.get(sid, sid))
            return p if p and p.get('id') else None

        # 1. logo et symbole propres de chaque série
        for m in order:
            sid, serie = m['id'], m['serie']
            f, e = fr.get(sid) or {}, en.get(sid) or {}
            fr_base = f.get('logo') or f'{TC}fr/{serie}/{sid}/logo'
            urls_fr = ([LOGO_SOURCE[sid]] if sid in LOGO_SOURCE else []) + [fr_base + '.webp', fr_base + '.png']
            en_serie = (e.get('serie') or {}).get('id') or serie
            en_base = e.get('logo') or f'{TC}en/{en_serie}/{sid}/logo'
            urls_en = [en_base + '.webp', en_base + '.png']
            p = ptcg_of(sid) or {}
            pl = (p.get('images') or {}).get('logo')
            urls_pt = [pl] if host(pl) == 'images.pokemontcg.io' else []
            u, im, sure = self.first(urls_fr)
            lang = 'fr'
            if im is not None and sid in FR_LOGO_IS_EN and u != LOGO_SOURCE.get(sid):
                lang = 'en'   # « FR » de TCGdex qui est le logo anglais
            if im is None and sid not in PARENT:
                u, im, s2 = self.first(urls_en + urls_pt)
                sure = sure and s2
                lang = 'en'
            sx_logo = pl if host(pl) == 'images.scrydex.com' else None   # adresse donnée par les données, jamais devinée
            own[sid] = {'url': u, 'im': im, 'lang': lang if im is not None else None, 'rest': urls_en + urls_pt,
                        'sx': sx_logo, 'sure': sure, 'symSure': True}
            # symbole (TCGdex FR, EN ; pokemontcg.io sauf si son entrée est celle de la série mère : exu -> ex10)
            if sid in NO_SYMBOL or sid in PARENT_SYMBOL:
                continue
            sb = f.get('symbol') or f'{TC}univ/{serie}/{sid}/symbol'
            urls_s = [sb + '.png', sb + '.webp']
            if e.get('symbol') and e['symbol'] != f.get('symbol'):
                urls_s += [e['symbol'] + '.png', e['symbol'] + '.webp']
            if sid in SYMBOL_FROM:
                p = ptcg.get(SYMBOL_FROM[sid]) or {}
            ps = (p.get('images') or {}).get('symbol')
            par_pt = SCRYDEX_SET.get(PARENT[sid][0], PARENT[sid][0]) if sid in PARENT else None
            if host(ps) == 'images.pokemontcg.io' and p.get('id') != par_pt:
                urls_s.append(ps)
            su, sim, ssure = self.first(urls_s)
            own[sid]['symSure'] = ssure
            if sim is not None:
                sym[sid] = self.save('sym', sid, sim)[0]
                sym_src[sid] = su
            else:
                sx_sym = ps if host(ps) == 'images.scrydex.com' else None
                if not sx_sym and sid not in SCRYDEX_NONE:
                    sx_sym = f'{SX}{SCRYDEX_SET.get(sid, sid)}-symbol/symbol'   # 404 si inconnu : vérifiable
                own[sid]['sxSym'] = sx_sym

        # 2. logos partagés
        shared, shared_sure = {}, {}
        for alias, cfg in SHARED.items():
            kind, val = cfg['source']
            if kind == 'url':
                u, im, sure = self.first([val])
                lang = cfg.get('lang', 'en')
            else:
                o = own.get(val) or {}
                u, im, lang, sure = o.get('url'), o.get('im'), o.get('lang'), o.get('sure', True)
            shared_sure[alias] = sure
            if im is not None:
                path, pim = self.save('sets', alias, im)
                k = dark_metrics(pim)
                shared[alias] = {'logo': path, 'lang': cfg.get('lang', lang), 'k': k, 'src': u, 'sure': sure}
            else:
                self.fails.append(('shared', alias))

        def members(cfg):
            if 'bloc' in cfg:
                return [m['id'] for m in metas if m['bloc'] == cfg['bloc']]
            return cfg['sets']

        share_of = {}
        for alias, cfg in SHARED.items():
            for sid in members(cfg):
                share_of[sid] = alias

        # 3. choix par série
        saved = {}
        for m in order:
            sid = m['id']
            o = own[sid]
            tag, res = None, None
            sure = o['sure']
            if sid in share_of and share_of[sid] in shared:
                alias = share_of[sid]
                res = shared[alias]
                sure = res['sure']
                tag = (SHARED[alias].get('tags') or {}).get(sid)
            else:
                if sid in share_of:
                    sure = sure and shared_sure.get(share_of[sid], True)
                if o['im'] is not None and o['lang'] == 'fr':
                    res = self._own(sid, o, saved)
                elif sid in PARENT:
                    par, ptag = PARENT[sid]
                    po = own.get(par) or {}
                    sure = sure and po.get('sure', True)
                    if po.get('im') is not None:
                        res = self._own(par, po, saved)
                        tag = ptag
                    else:
                        u2, im2, s2 = self.first(o['rest'])
                        sure = sure and s2
                        if im2 is not None:
                            res = self._own(sid, {'url': u2, 'im': im2, 'lang': 'en'}, saved)
                elif o['im'] is not None:
                    res = self._own(sid, o, saved)
            if res is None and o.get('sx'):
                u3, im3, s3 = self.hotlink(o['sx'])
                sure = sure and s3
                if u3:
                    res = {'logo': u3, 'lang': 'en', 'k': dark_metrics(im3) if im3 is not None else None, 'src': u3}
            if res:
                info[sid] = {'logo': res['logo'], 'logoLang': res['lang'], 'dark': is_dark(res['k']), 'tag': tag,
                             'metrics': res['k'], 'logoSrc': res['src']}
            else:
                info[sid] = {'logo': None, 'logoLang': None, 'dark': False, 'tag': None, 'metrics': None, 'logoSrc': None}
            info[sid]['logoSure'] = bool(sure)
            s, ssrc = sym.get(sid), sym_src.get(sid)
            ssure = o.get('symSure', True)
            if not s and sid in PARENT:
                # depuis Écarlate et Violet, le « symbole » est le code imprimé (SVI, MEG…) : une sous-série au
                # code différent (mee : MEE ≠ MEG) ne reprend pas celui de sa série mère
                par = PARENT[sid][0]
                if m['bloc'] not in BADGE_BLOCS or (by_id.get(par) or {}).get('code') == m.get('code'):
                    s, ssrc = sym.get(par), sym_src.get(par)
                    ssure = ssure and (own.get(par) or {}).get('symSure', True)
            if not s and o.get('sxSym'):
                s, _, hs = self.hotlink(o['sxSym'], logo=False)
                ssure = ssure and hs
                ssrc = s
            info[sid]['sym'] = s
            info[sid]['symSrc'] = ssrc
            info[sid]['symSure'] = bool(ssure)

        # 4. blocs : {logo, dark, sure}
        blocs = {}
        by_logo_url = {}
        for m in metas:
            f = fr.get(m['id']) or {}
            x = info[m['id']]
            if f.get('logo') and x['logo'] and x['logoLang'] == 'fr' and not x['tag'] and x['logo'].startswith('img/'):
                by_logo_url.setdefault(f['logo'], {'logo': x['logo'], 'dark': x['dark'], 'sure': x['logoSure']})
        for bid in dict.fromkeys(m['bloc'] for m in metas):
            if bid in BLOC_LOGO:
                spec = BLOC_LOGO[bid]
                if spec is None:
                    blocs[bid] = {'logo': None, 'dark': False, 'sure': True}
                elif spec[0] == 'set':
                    x = info.get(spec[1]) or {}
                    blocs[bid] = {'logo': x.get('logo'), 'dark': bool(x.get('dark')), 'sure': x.get('logoSure', True)}
                else:
                    x = shared.get(spec[1]) or {}
                    blocs[bid] = {'logo': x.get('logo'), 'dark': is_dark(x.get('k')),
                                  'sure': x.get('sure', shared_sure.get(spec[1], True))}
                continue
            su = (series.get(bid) or {}).get('logo')
            b = by_logo_url.get(su) if su else None
            if not b and su:
                u2, im2, s2 = self.first([su + '.webp', su + '.png'])
                b = {'logo': None, 'dark': False, 'sure': s2}
                if im2 is not None:
                    path, pim = self.save('sets', 'bloc-' + bid, im2)
                    b.update(logo=path, dark=is_dark(dark_metrics(pim)))
            blocs[bid] = b or {'logo': None, 'dark': False, 'sure': True}
        return info, blocs

    def _own(self, name, o, saved):
        if name not in saved:
            path, pim = self.save('sets', name, o['im'])
            saved[name] = {'logo': path, 'lang': o['lang'], 'k': dark_metrics(pim), 'src': o['url']}
        return saved[name]

    # ---------- écriture ----------
    def write(self, keep_paths):
        """Écrit les nouveaux fichiers (jamais par-dessus un fichier existant : noms immuables) et supprime ceux
        de img/sets et img/sym qui ne servent plus."""
        written = 0
        for rel, data in self.files.items():
            p = os.path.join(self.root, rel.replace('/', os.sep))
            if data is None or os.path.exists(p):
                continue
            os.makedirs(os.path.dirname(p), exist_ok=True)
            tmp = p + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, p)
            written += 1
        removed = 0
        for kind in ('sets', 'sym'):
            d = os.path.join(self.root, 'img', kind)
            if not os.path.isdir(d):
                continue
            for fn in os.listdir(d):
                rel = f'img/{kind}/{fn}'
                if rel not in keep_paths and fn.endswith('.webp'):
                    os.remove(os.path.join(d, fn))
                    removed += 1
        return written, removed
