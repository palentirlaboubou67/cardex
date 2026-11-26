"""Téléchargements : délais, nouvelles tentatives (429/5xx), If-None-Match, gzip. Le cache est dans sources.Cache."""
import gzip
import time
import urllib.error
import urllib.request

UA = "Cardex-market/2.0 (static price builder, Python urllib)"


class SourceError(RuntimeError):
    """Une source ne répond pas ou renvoie des données inutilisables : rien n'est écrit."""


def _decode(body, headers):
    if (headers.get("Content-Encoding") or "").lower() == "gzip" or body[:2] == b"\x1f\x8b":
        return gzip.decompress(body)
    return body


def fetch(url, *, timeout=60, tries=4, headers=None, data=None, etag=None, gz=True, pause=2.0, quiet=False, raw=False):
    """-> (status, body, headers). status 304 => body vide. raw=True : corps tel que reçu (gzip non décodé).
    Lève SourceError après `tries` échecs."""
    h = {"User-Agent": UA}
    if gz:
        h["Accept-Encoding"] = "gzip"
    if etag:
        h["If-None-Match"] = etag
    h.update(headers or {})
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=h, data=data)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return r.status, (body if raw else _decode(body, r.headers)), r.headers
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return 304, b"", e.headers
            last = e
            if e.code in (400, 401, 403, 404, 410):
                break  # inutile d'insister
            # 429 / 5xx : on ralentit
            wait = pause * (attempt + 1) * (6 if e.code == 429 else 1)
            ra = e.headers.get("Retry-After") if e.headers else None
            if ra and ra.isdigit():
                wait = max(wait, min(int(ra), 120))
        except Exception as e:  # délai dépassé, connexion coupée, gzip tronqué…
            last = e
            wait = pause * (attempt + 1)
        if attempt < tries - 1:
            if not quiet:
                print(f"  … nouvel essai ({attempt + 2}/{tries}) {url} : {last}")
            time.sleep(wait)
    raise SourceError(f"{url} : {last}")
