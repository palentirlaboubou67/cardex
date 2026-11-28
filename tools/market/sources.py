"""Sources téléchargées : fichiers Cardmarket, archive TCGdex cards-database, noms PokéAPI, listes TCGCSV.

Chaque fichier est gardé dans le cache (.cache/mk/…) avec son ETag (If-None-Match la fois suivante) et vérifié avant
d'être utilisé : un fichier tronqué, vide ou plus ancien que la copie en cache n'est jamais pris.
"""
import csv
import io
import json
import os
import re
import time
import zipfile

from .net import SourceError, fetch
from .util import created_dt, read_json, write_json

CM = "https://downloads.s3.cardmarket.com/productCatalog/"
URLS = {
    "price_guide_6.json": CM + "priceGuide/price_guide_6.json",
    "products_nonsingles_6.json": CM + "productList/products_nonsingles_6.json",
    "products_singles_6.json": CM + "productList/products_singles_6.json",
}
# taille minimale attendue (lignes) : en dessous, le fichier est jugé cassé (aujourd'hui 81 084 / 5 198 / 75 927)
MIN_ROWS = {"price_guide_6.json": 60000, "products_nonsingles_6.json": 4000, "products_singles_6.json": 60000}
CARDS_DB_ZIP = "https://codeload.github.com/tcgdex/cards-database/zip/refs/heads/master"
SPECIES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv"
TCGCSV = "https://tcgcsv.com/tcgplayer/3"  # catégorie 3 = Pokémon (produits anglais)


class Cache:
    """Dossier de cache + index des ETag (.cache/mk/http.json)."""

    def __init__(self, root, offline=False, src=None, log=print):
        self.root, self.offline, self.src, self.log = root, offline, src, log
        os.makedirs(root, exist_ok=True)
        self.index_path = os.path.join(root, "http.json")
        self.index = read_json(self.index_path, {}) or {}

    def path(self, *p):
        return os.path.join(self.root, *p)

    def save(self):
        write_json(self.index_path, self.index)

    def get(self, key, url, rel, validate, timeout=180, keep_old=None):
        """-> (octets, info). Télécharge `url` dans <cache>/<rel> (If-None-Match si une copie existe),
        validate(octets) -> info (dict) ou lève SourceError. La copie en cache n'est remplacée que par un fichier
        valide, et pas si keep_old(octets de la copie, info du nouveau) répond vrai (copie plus récente).
        Hors ligne (ou --src) : lecture de la copie locale."""
        path = self.path(rel)
        if self.src:  # copies fournies à la main (tests)
            p = os.path.join(self.src, os.path.basename(rel))
            if not os.path.exists(p):
                raise SourceError(f"{p} absent (--src)")
            with open(p, "rb") as f:
                body = f.read()
            return body, validate(body)
        meta = self.index.get(key) or {}
        have = os.path.exists(path)
        if self.offline:
            if not have:
                raise SourceError(f"hors ligne et pas de copie en cache : {path}")
            with open(path, "rb") as f:
                body = f.read()
            return body, validate(body)
        t = time.monotonic()
        st, body, hd = fetch(url, timeout=timeout, etag=meta.get("etag") if have else None, quiet=False)
        if st == 304:
            with open(path, "rb") as f:
                body = f.read()
            info = validate(body)
            self.log(f"  {rel} : inchangé (304)")
            return body, info
        info = validate(body)  # lève SourceError si le fichier est inutilisable
        if have and keep_old:
            with open(path, "rb") as f:
                old = f.read()
            if keep_old(old, info):
                self.log(f"  ! {rel} : le serveur sert une copie plus ancienne que celle du cache, on garde le cache")
                return old, validate(old)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, path)
        self.index[key] = {"etag": hd.get("ETag"), "lastModified": hd.get("Last-Modified"), "bytes": len(body)}
        self.save()
        self.log(f"  {rel} : {len(body) / 1e6:.1f} Mo en {time.monotonic() - t:.1f} s")
        return body, info


# ---------- Cardmarket ----------
def _cm_validate(name):
    def v(body):
        try:
            j = json.loads(body)
        except ValueError as e:
            raise SourceError(f"{name} : JSON illisible ({e})") from None
        rows = j.get("priceGuides") if name.startswith("price_guide") else j.get("products")
        if j.get("version") != 1 or not isinstance(rows, list):
            raise SourceError(f"{name} : format inattendu")
        try:
            created_dt(j["createdAt"])
        except (KeyError, TypeError, ValueError):
            raise SourceError(f"{name} : createdAt absent ou illisible") from None
        if len(rows) < MIN_ROWS[name]:
            raise SourceError(f"{name} : {len(rows)} lignes seulement (fichier tronqué ?)")
        bad = sum(1 for r in rows if not isinstance(r, dict) or not isinstance(r.get("idProduct"), int))
        if bad > len(rows) // 100:
            raise SourceError(f"{name} : {bad} lignes sans idProduct")
        return {"createdAt": j["createdAt"], "rows": len(rows), "json": j}
    return v


_CREATED = re.compile(rb'"createdAt"\s*:\s*"([^"]+)"')


def head_created(body):
    """createdAt lu dans les premiers octets du fichier (sans tout décoder), ou None."""
    m = _CREATED.search(body[:400])
    try:
        return created_dt(m.group(1).decode()) if m else None
    except ValueError:
        return None


def cardmarket(cache, name):
    """-> (json, info) ; CloudFront peut servir une copie plus ancienne que celle du cache : on garde la plus récente.
    Un fichier n'est demandé qu'une fois par exécution (l'hebdomadaire et le quotidien d'un même passage le
    partagent)."""
    memo = cache.__dict__.setdefault("_cm", {})
    if name in memo:
        return memo[name]

    def keep_old(old, info):
        o = head_created(old)
        return bool(o and o > created_dt(info["createdAt"]))
    _, info = cache.get(name, URLS[name], os.path.join("cm", name), _cm_validate(name), keep_old=keep_old)
    j = info.pop("json")
    info.update({k: v for k, v in (cache.index.get(name) or {}).items() if k in ("etag", "lastModified", "bytes")})
    memo[name] = (j, info)
    return j, info


# ---------- TCGdex cards-database (zip, MIT) ----------
def _zip_validate(body):
    try:
        z = zipfile.ZipFile(io.BytesIO(body))
        n = sum(1 for x in z.namelist() if x.endswith(".ts") and "/data/" in x)
    except zipfile.BadZipFile as e:
        raise SourceError(f"cards-database : zip illisible ({e})") from None
    if n < 20000:
        raise SourceError(f"cards-database : {n} fichiers seulement")
    return {"files": n}


def cards_db(cache):
    """-> chemin du zip en cache (téléchargé si besoin)."""
    rel = "cards-database.zip"
    _, info = cache.get("cards-database", CARDS_DB_ZIP, rel, _zip_validate, timeout=300)
    return cache.path(rel) if not cache.src else os.path.join(cache.src, rel), info


# ---------- PokéAPI (noms des espèces, BSD-3-Clause) ----------
def _species_validate(body):
    try:
        rows = list(csv.DictReader(io.StringIO(body.decode("utf8"))))
    except (UnicodeDecodeError, csv.Error) as e:
        raise SourceError(f"pokemon_species_names.csv illisible ({e})") from None
    en = {r["pokemon_species_id"]: r["name"] for r in rows if r.get("local_language_id") == "9"}
    fr = {r["pokemon_species_id"]: r["name"] for r in rows if r.get("local_language_id") == "5"}
    if len(en) < 1000 or len(fr) < 1000:
        raise SourceError("pokemon_species_names.csv : trop peu de noms")
    return {"en": en, "fr": fr}


def species(cache):
    """-> {nom anglais: nom français} pour toutes les espèces (identiques comprises)."""
    _, info = cache.get("pokeapi-species", SPECIES_CSV, "pokemon_species_names.csv", _species_validate, timeout=90)
    en, fr = info["en"], info["fr"]
    return {en[i]: fr[i] for i in en if i in fr}


# ---------- TCGCSV (TCGplayer, listes de produits seulement, jamais les prix) ----------
def tcgcsv(cache, pause=0.35):
    """-> (groupes, produits scellés) ; produits = [{id, g, n}] sans les cartes à l'unité.
    Copies par groupe dans .cache/mk/tcgcsv/ (réutilisées hors ligne)."""
    def gv(body):
        try:
            j = json.loads(body)
        except ValueError as e:
            raise SourceError(f"TCGCSV groups : JSON illisible ({e})") from None
        res = j.get("results") if isinstance(j, dict) else None
        if not isinstance(res, list) or len(res) < 150:
            raise SourceError("TCGCSV groups : liste trop courte")
        return {"groups": res}

    if cache.src:  # tests : copies locales au format du prototype
        groups = json.load(open(os.path.join(cache.src, "groups_3.json"), encoding="utf8"))
        prods = json.load(open(os.path.join(cache.src, "all_sealed_3.json"), encoding="utf8"))
        return groups, [{"id": p["productId"], "g": p["groupId"], "n": p["name"]} for p in prods]
    _, info = cache.get("tcgcsv-groups", f"{TCGCSV}/groups", os.path.join("tcgcsv", "groups.json"), gv, timeout=60)
    groups = info["groups"]
    out = []
    for i, g in enumerate(groups, 1):
        gid = g["groupId"]
        rel = os.path.join("tcgcsv", f"{gid}.json")

        def pv(body, gid=gid):
            try:
                j = json.loads(body)
            except ValueError as e:
                raise SourceError(f"TCGCSV {gid} : JSON illisible ({e})") from None
            res = j.get("results") if isinstance(j, dict) else j if isinstance(j, list) else None
            if not isinstance(res, list):
                raise SourceError(f"TCGCSV {gid} : format inattendu")
            return {"res": res}
        try:
            _, pi = cache.get(f"tcgcsv-{gid}", f"{TCGCSV}/{gid}/products", rel, pv, timeout=60)
        except SourceError as e:
            cache.log(f"  ! TCGCSV groupe {gid} ignoré : {e}")
            continue
        for p in pi["res"]:
            ext = p.get("extendedData") or []
            if any(isinstance(e, dict) and e.get("name") in ("Number", "Rarity") for e in ext):
                continue  # carte à l'unité
            if isinstance(p.get("productId"), int) and isinstance(p.get("name"), str):
                out.append({"id": p["productId"], "g": gid, "n": p["name"]})
        if not cache.offline:
            time.sleep(pause)
        if i % 50 == 0:
            cache.log(f"  TCGCSV : {i}/{len(groups)} groupes")
    return groups, out
