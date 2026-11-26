"""Client HTTP du constructeur de catalogue (bibliothèque standard uniquement).

- débit limité par hôte (TCGdex ≤ 4 req/s, Scrydex ≤ 1 req/s), délais d'attente, reprises
  avec attente croissante sur 429/503 et sur les erreurs réseau ;
- cache disque sous .cache/ca/http/ (réponses JSON, images, résultats de HEAD) avec durée de vie ;
- mode hors ligne : seulement le cache, jamais le réseau.
"""
import hashlib
import json
import os
import random
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

UA = 'cardex-catalog/1.0 (static PWA builder)'
# Accept d'un navigateur : Scrydex négocie le format (AVIF/WebP/PNG) et l'ETag de son image de
# remplacement est le même dans tous les formats.
ACCEPT_IMG = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'

# intervalle minimal entre deux requêtes vers un même groupe d'hôtes (secondes)
RATE = {'tcgdex': 0.25, 'scrydex': 1.0, 'ptcg': 0.25, 'other': 0.25}

DAY = 86400.0


def host_group(url):
    h = urllib.parse.urlsplit(url).hostname or ''
    if h.endswith('tcgdex.net'):
        return 'tcgdex'
    if h.endswith('scrydex.com'):
        return 'scrydex'
    if h.endswith('pokemontcg.io'):
        return 'ptcg'
    return 'other'


def quote_url(u):
    """Encode le chemin comme le ferait un navigateur, sans double encodage (« %3F » reste « %3F »)."""
    p = urllib.parse.urlsplit(u)
    path = urllib.parse.quote(urllib.parse.unquote(p.path), safe="/!'()*,;=:@-._~")
    return urllib.parse.urlunsplit((p.scheme, p.netloc, path, p.query, p.fragment))


class Offline(Exception):
    """Ressource absente du cache en mode hors ligne."""


class HttpError(Exception):
    def __init__(self, url, status, msg=''):
        super().__init__(f'{status} {url} {msg}'.strip())
        self.url, self.status = url, status


class Client:
    def __init__(self, cache_dir, offline=False, refresh=False, log=print):
        self.dir = os.path.join(cache_dir, 'http')
        os.makedirs(self.dir, exist_ok=True)
        self.offline, self.refresh, self.log = offline, refresh, log
        self._next = {}
        self._lock = threading.Lock()
        self.stats = {'net': 0, 'cache': 0, 'retry': 0, 'bytes': 0, 'by_host': {}}

    # ---------- cache ----------
    def _key(self, kind, url, body=None):
        h = hashlib.sha1(f'{kind}\n{url}\n{body or ""}'.encode()).hexdigest()
        return os.path.join(self.dir, h[:2], h)

    def _read_meta(self, key):
        try:
            with open(key + '.meta', encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def _write(self, key, meta, data=None):
        os.makedirs(os.path.dirname(key), exist_ok=True)
        if data is not None:
            tmp = key + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, key + '.bin')
        tmp = key + '.mtmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False)
        os.replace(tmp, key + '.meta')

    def cached_meta(self, kind, url, body=None):
        return self._read_meta(self._key(kind, url, body))

    # ---------- réseau ----------
    def _throttle(self, url):
        g = host_group(url)
        with self._lock:
            now = time.monotonic()
            t = max(now, self._next.get(g, 0.0))
            self._next[g] = t + RATE[g]
        if t > now:
            time.sleep(t - now)
        return g

    def _do(self, method, url, body=None, headers=None, timeout=40, tries=5):
        """Une requête avec reprises. Renvoie (status, en-têtes, octets). 404/410/403/400 ne sont pas réessayés."""
        if self.offline:
            raise Offline(url)
        hdr = {'User-Agent': UA}
        hdr.update(headers or {})
        data = None
        if body is not None:
            data = body.encode() if isinstance(body, str) else body
        last = None
        for i in range(tries):
            g = self._throttle(url)
            self.stats['net'] += 1
            self.stats['by_host'][g] = self.stats['by_host'].get(g, 0) + 1
            try:
                req = urllib.request.Request(quote_url(url), data=data, method=method, headers=hdr)
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    raw = r.read() if method != 'HEAD' else b''
                    self.stats['bytes'] += len(raw)
                    return r.status, {k.lower(): v for k, v in r.headers.items()}, raw
            except urllib.error.HTTPError as e:
                h = {k.lower(): v for k, v in (e.headers or {}).items()}
                if e.code in (400, 403, 404, 410):
                    return e.code, h, b''
                last = e.code
                if e.code in (429, 503, 502, 504, 500):
                    ra = h.get('retry-after')
                    wait = float(ra) if ra and ra.isdigit() else 15.0 * (2 ** i)
                    wait = min(wait, 120.0)
                    self.log(f'  … {e.code} sur {g}, nouvel essai dans {wait:.0f} s')
                    self.stats['retry'] += 1
                    with self._lock:  # toute l'équipe attend : on respecte la limite de l'hôte
                        self._next[g] = time.monotonic() + wait
                    continue
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                last = str(e)[:80]
                self.stats['retry'] += 1
                time.sleep(2.0 * (2 ** i) + random.random())
                continue
        raise HttpError(url, last, 'après %d essais' % tries)

    # ---------- API publiques ----------
    def get_json(self, url, ttl=DAY, timeout=60):
        """GET JSON avec cache. Renvoie l'objet, ou None si 404. Lève HttpError/Offline sinon."""
        return self._json('GET', url, None, ttl, timeout)

    def post_json(self, url, payload, ttl=DAY, timeout=90):
        body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False)
        return self._json('POST', url, body, ttl, timeout)

    def _json(self, method, url, body, ttl, timeout):
        key = self._key(method, url, body)
        meta = self._read_meta(key)
        fresh = meta and (self.offline or (not self.refresh and time.time() - meta['t'] < ttl))
        if fresh:
            self.stats['cache'] += 1
            if meta['status'] != 200:
                return None
            with open(key + '.bin', 'rb') as f:
                return json.loads(f.read().decode('utf-8'))
        if self.offline:
            raise Offline(url)
        hdr = {'Accept': 'application/json'}
        if body is not None:
            hdr['Content-Type'] = 'application/json'
        st, h, raw = self._do(method, url, body, hdr, timeout)
        if st == 200:
            obj = json.loads(raw.decode('utf-8'))
            self._write(key, {'t': time.time(), 'status': 200, 'url': url}, raw)
            return obj
        if st == 404:
            self._write(key, {'t': time.time(), 'status': 404, 'url': url})
            return None
        raise HttpError(url, st)

    def age(self, method, url, body=None):
        m = self._read_meta(self._key(method, url, body))
        return (time.time() - m['t']) if m else None

    def head(self, url, ttl_ok=90 * DAY, ttl_bad=7 * DAY, origin=None):
        """HEAD avec cache : {'status', 'type', 'len', 'etag', 'acao', 't'} (status 0 = erreur réseau).
        origin : envoie un en-tête Origin (contrôle CORS) ; résultat mis en cache à part."""
        key = self._key('HEADO' if origin else 'HEAD', url)
        meta = self._read_meta(key)
        if meta and not self.refresh:
            ok = meta.get('status') == 200
            if self.offline or time.time() - meta['t'] < (ttl_ok if ok else ttl_bad):
                self.stats['cache'] += 1
                return meta
        if self.offline:
            return meta or {'status': None, 'offline': True}
        hdr = {'Accept': ACCEPT_IMG}
        if origin:
            hdr['Origin'] = origin
        try:
            st, h, _ = self._do('HEAD', url, headers=hdr, timeout=30, tries=4)
        except HttpError as e:
            return {'status': 0, 'err': str(e.status)}
        res = {'t': time.time(), 'url': url, 'status': st, 'type': h.get('content-type', ''), 'len': int(h.get('content-length') or 0),
               'etag': (h.get('etag') or '').strip('"').replace('W/', '').strip('"'), 'acao': h.get('access-control-allow-origin')}
        self._write(key, res)
        return dict(res, net=True)

    def seed_head(self, url, res):
        """Enregistre un résultat de HEAD connu (vérifications faites ailleurs)."""
        key = self._key('HEAD', url)
        if not self._read_meta(key):
            self._write(key, res)

    def get_bytes(self, url, ttl=90 * DAY, ttl_bad=7 * DAY, accept='image/png,image/*;q=0.9'):
        """GET binaire avec cache : (status, content-type, octets|None, etag)."""
        key = self._key('GETB', url)
        meta = self._read_meta(key)
        if meta and not self.refresh:
            ok = meta.get('status') == 200
            if self.offline or time.time() - meta['t'] < (ttl if ok else ttl_bad):
                self.stats['cache'] += 1
                data = None
                if ok:
                    with open(key + '.bin', 'rb') as f:
                        data = f.read()
                return meta['status'], meta.get('type', ''), data, meta.get('etag', '')
        if self.offline:
            raise Offline(url)
        try:
            st, h, raw = self._do('GET', url, headers={'Accept': accept}, timeout=60, tries=4)
        except HttpError as e:
            return 0, '', None, ''
        etag = (h.get('etag') or '').replace('W/', '').strip('"')
        meta = {'t': time.time(), 'status': st, 'type': h.get('content-type', ''), 'etag': etag, 'url': url}
        self._write(key, meta, raw if st == 200 else None)
        return st, meta['type'], (raw if st == 200 else None), etag

    def seed_bytes(self, url, data, ctype='image/png'):
        key = self._key('GETB', url)
        if not self._read_meta(key):
            self._write(key, {'t': time.time(), 'status': 200, 'type': ctype, 'etag': '', 'url': url, 'seeded': True}, data)
