"""Lecture de TCGdex : séries, blocs, cartes (GraphQL @locale(lang:"fr"), REST carte par carte en secours)."""
import datetime as dt
import urllib.parse

from .http import DAY, HttpError
from .tables import POCKET, POCKET_SERIES

API = 'https://api.tcgdex.net/v2'
GQL = API + '/graphql'
# Carte témoin : son nom français prouve que la directive @locale fonctionne (anglais : « Bulbasaur »).
LOCALE_PROBE = ('sv03.5-001', 'Bulbizarre')

# legal : la légalité des séries de TCGdex (/sets/<id>) est figée à standard=false ; celle des cartes est tenue à jour.
FIELDS = ('id localId name rarity category dexId image regulationMark legal { standard expanded } '
          'variants { normal reverse holo firstEdition } variants_detailed { type foil }')


def q(s):
    return urllib.parse.quote(s, safe='')


def set_ttl(release_date):
    """Séries récentes (6 mois) : TCGdex les complète encore (images, numéros) -> 1 jour ; sinon 30 jours."""
    try:
        d = dt.date.fromisoformat(release_date)
    except (TypeError, ValueError):
        return DAY
    return DAY if (dt.date.today() - d).days < 183 else 30 * DAY


class TCGdex:
    def __init__(self, client, log=print):
        self.c, self.log = client, log
        self.locale_ok = None
        self.problems = []  # (setId, message) : sources en échec, données précédentes conservées

    # ---------- listes ----------
    def set_list(self):
        lst = self.c.get_json(f'{API}/fr/sets', ttl=6 * 3600)
        if not lst:
            raise HttpError(f'{API}/fr/sets', 'vide')
        return [s for s in lst if not POCKET.match(s['id'])]

    def series(self):
        lst = self.c.get_json(f'{API}/fr/series', ttl=6 * 3600) or []
        out = {}
        for s in lst:
            if s['id'] in POCKET_SERIES:
                continue
            d = self.c.get_json(f'{API}/fr/series/{q(s["id"])}', ttl=DAY)
            out[s['id']] = d or s
        return out

    def set_detail(self, sid, lang='fr', list_entry=None, force=False):
        url = f'{API}/{lang}/sets/{q(sid)}'
        ttl = 0 if force else DAY
        d = self.c.get_json(url, ttl=ttl)
        if d is not None and not force:
            ttl = set_ttl(d.get('releaseDate'))
            age = self.c.age('GET', url)
            stale = age is not None and age > ttl
            changed = list_entry and (list_entry.get('cardCount') or {}).get('total') != (d.get('cardCount') or {}).get('total')
            if (stale or changed) and not self.c.offline:
                d = self.c.get_json(url, ttl=0)
        return d

    def en_cards(self):
        return self.c.get_json(f'{API}/en/cards', ttl=7 * DAY) or []

    # ---------- cartes ----------
    def check_locale(self):
        """La directive @locale n'est pas documentée : on la vérifie à chaque exécution (une requête, jamais le
        cache, sauf hors ligne)."""
        cid, want = LOCALE_PROBE
        query = '{ cards(filters:{id:"%s"}) @locale(lang:"fr") { id name } }' % cid
        try:
            r = self.c.post_json(GQL, {'query': query}, ttl=0)
            names = [c.get('name') for c in ((r or {}).get('data') or {}).get('cards') or [] if c.get('id') == cid]
            self.locale_ok = names == [want]
        except Exception as e:  # HttpError, Offline, réponse inattendue
            self.log(f'  ! vérification @locale impossible : {e}')
            self.locale_ok = False
        if not self.locale_ok:
            self.log('  ! @locale(lang:"fr") ne renvoie pas le français : secours REST carte par carte')
        return self.locale_ok

    def gql_cards(self, sid, ttl, force=False):
        query = '{ cards(filters:{id:%s}) @locale(lang:"fr") { %s } }' % (_gq_str(sid + '-'), FIELDS)
        r = self.c.post_json(GQL, {'query': query}, ttl=0 if force else ttl)
        if not isinstance(r, dict) or 'errors' in r or not isinstance(r.get('data'), dict):
            raise HttpError(GQL, 'graphql', str((r or {}).get('errors') if isinstance(r, dict) else r)[:200])
        return [c for c in r['data'].get('cards') or [] if set_of(c['id']) == sid]

    def rest_card(self, cid, ttl):
        return self.c.get_json(f'{API}/fr/cards/{q(cid)}', ttl=ttl)

    def cards_of(self, sid, detail, ttl):
        """Cartes complètes d'une série, dans l'ordre TCGdex. Renvoie (cartes, 'gql'|'rest'|'mixte')."""
        brief = [c for c in detail.get('cards') or [] if set_of(c['id']) == sid]
        want = {c['id']: c for c in brief}
        got, how = {}, 'gql'
        if self.locale_ok and want:
            try:
                g = self.gql_cards(sid, ttl)
                if set(c['id'] for c in g) != set(want) and not self.c.offline:
                    g = self.gql_cards(sid, ttl, force=True)
                got = {c['id']: c for c in g}
            except Exception as e:  # HttpError, Offline, réponse GraphQL inattendue : REST carte par carte
                self.log(f'  ! GraphQL {sid} : {e}')
            # contrôle : noms GraphQL = noms REST français (sinon la directive n'a pas pris)
            bad = [i for i, c in got.items() if i in want and c.get('name') != want[i].get('name')]
            if bad:
                self.log(f'  ! {sid} : {len(bad)} noms GraphQL ≠ REST FR ({bad[:3]}) : REST pour ces cartes')
                for i in bad:
                    got.pop(i, None)
        missing = [i for i in want if i not in got]
        if missing:
            how = 'rest' if not got else 'mixte'
            for i in missing:
                c = self.rest_card(i, ttl)
                if c:
                    got[i] = c
        # ordre TCGdex (liste REST de la série)
        out = [got[c['id']] for c in brief if c['id'] in got]
        return out, how


def _gq_str(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def set_of(cid):
    return cid[:cid.rfind('-')]
