"""Historique gratuit : copies de price_guide_6.json conservées par l'Internet Archive (Wayback Machine).

Une requête toutes les 12 s au plus (règle : au moins 10 s). Les copies sont gardées compressées dans
.cache/mk/wayback/<horodatage>.json.gz, donc une reprise ne retélécharge rien.
"""
import gzip
import json
import os
import time

from .net import SourceError, fetch
from .util import created_day

GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json"
CDX = ("https://web.archive.org/cdx/search/cdx?url=downloads.s3.cardmarket.com/productCatalog/priceGuide/"
       "price_guide_6.json&output=json&filter=statuscode:200&collapse=digest")
RAW = "https://web.archive.org/web/{ts}id_/" + GUIDE
GAP = 12.0  # secondes entre deux requêtes à l'Archive


class _Pacer:
    def __init__(self, gap):
        self.gap, self.t = gap, 0.0

    def wait(self):
        d = self.t + self.gap - time.monotonic()
        if d > 0:
            time.sleep(d)
        self.t = time.monotonic()


def parse_capture(raw_gz):
    """octets gzip -> guide (dict) ou None s'il est inutilisable."""
    try:
        g = json.loads(gzip.decompress(raw_gz) if raw_gz[:2] == b"\x1f\x8b" else raw_gz)
    except (OSError, ValueError, EOFError):
        return None
    if not isinstance(g, dict) or g.get("version") != 1 or not isinstance(g.get("priceGuides"), list):
        return None
    try:
        created_day(g["createdAt"])
    except (KeyError, TypeError, ValueError):
        return None
    return g if len(g["priceGuides"]) > 20000 else None


def local(cache_dir):
    """Copies déjà dans le cache -> [(horodatage, chemin)] triés (sans réseau)."""
    if not os.path.isdir(cache_dir):
        return []
    return sorted((fn[:-8], os.path.join(cache_dir, fn)) for fn in os.listdir(cache_dir)
                  if fn.endswith(".json.gz") and fn[:-8].isdigit())


def captures(cache_dir, log=print):
    """Liste CDX (une ligne par contenu distinct) puis téléchargement des copies manquantes.
    -> [(horodatage, chemin)] triés. Archive injoignable : copies du cache seulement."""
    os.makedirs(cache_dir, exist_ok=True)
    pace = _Pacer(GAP)
    pace.wait()
    try:
        st, body, _ = fetch(CDX, timeout=90, tries=4, pause=15)
        rows = json.loads(body)
    except (SourceError, ValueError) as e:
        log(f"  ! liste de l'Archive indisponible ({e}) : copies du cache seulement")
        return local(cache_dir)
    with open(os.path.join(cache_dir, "cdx.json"), "wb") as f:
        f.write(body)
    out = []
    todo = [r[1] for r in rows[1:] if len(r) > 4 and r[4] == "200"]
    log(f"  Archive : {len(todo)} copies distinctes de price_guide_6.json")
    for ts in todo:
        path = os.path.join(cache_dir, f"{ts}.json.gz")
        if not os.path.exists(path):
            pace.wait()
            try:
                st, raw, _ = fetch(RAW.format(ts=ts), timeout=180, tries=3, pause=20, raw=True)
            except SourceError as e:
                log(f"  ! copie {ts} ignorée : {e}")
                continue
            if not raw.startswith(b"\x1f\x8b"):
                raw = gzip.compress(raw, 6)
            if not parse_capture(raw):
                log(f"  ! copie {ts} illisible, ignorée")
                continue
            with open(path + ".part", "wb") as f:
                f.write(raw)
            os.replace(path + ".part", path)
            log(f"  copie {ts} : {len(raw) // 1024} Kio")
        out.append((ts, path))
    return sorted(out)
