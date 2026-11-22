"""Construit le catalogue des produits scellés Pokémon (displays, coffrets dresseur d'élite, bundles, coffrets,
blisters, boosters, pokébox, decks…) avec leur cote et son historique.

Source : TCGCSV (export quotidien gratuit des prix TCGplayer, marché américain, en dollars), converti en euros
au taux du jour (Frankfurter / BCE). Noms des séries en français via TCGdex.

  python tools/build_sealed.py               met à jour les prix du jour (GitHub Actions, deux fois par semaine)
  python tools/build_sealed.py --backfill    reconstitue l'historique depuis février 2024 à partir des archives
                                             quotidiennes de TCGCSV (demande py7zr : pip install py7zr)

Sorties : data/sealed.json (catalogue et variations) et data/sealed/<groupe>.json (historique, chargé à la demande).
"""
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unicodedata
import urllib.request
from datetime import date, datetime, timedelta, timezone

TCGCSV = "https://tcgcsv.com/tcgplayer/3"  # catégorie 3 = Pokémon (cartes anglaises)
ARCHIVE = "https://tcgcsv.com/archive/tcgplayer/prices-{}.ppmd.7z"
FIRST_ARCHIVE = date(2024, 2, 8)
OUT = "data/sealed.json"
HDIR = "data/sealed"
UA = {"User-Agent": "Cardex sealed builder (github.com/palentirlaboubou67/cardex)"}


def get(url, as_json=True, tries=3):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                body = r.read()
            return json.loads(body) if as_json else body
        except Exception as e:  # réseau capricieux : on réessaie (plus longtemps si le serveur demande de ralentir)
            if attempt == tries - 1:
                print(f"  ! {url} : {e}", file=sys.stderr)
                return None
            time.sleep(90 * (attempt + 1) if getattr(e, "code", None) == 429 else 3)


# ---------- Type de produit, d'après son nom anglais ----------
def kind(name):
    n = name.lower()
    if "code card" in n or "digital" in n:
        return None
    if " case" in n or n.endswith("case"):
        return "case"
    if "art bundle" in n:
        return "booster"
    if "half booster box" in n:
        return "halfbox"
    if "booster box" in n or "booster display" in n:
        return "box"
    if "elite trainer box" in n:
        return "etb"
    if "booster bundle" in n:
        return "bundle"
    if "build & battle" in n or "build and battle" in n or "prerelease" in n:
        return "prerelease"
    if "mini tin" in n or re.search(r"\btins?\b", n):
        return "tin"
    if "blister" in n or "checklane" in n:
        return "blister"
    if "booster pack" in n or "sleeved booster" in n or n.endswith("booster"):
        return "booster"
    if "theme deck" in n or "battle deck" in n or "league battle" in n or re.search(r"\bdecks?\b", n):
        return "deck"
    if "collection" in n or "box" in n or "chest" in n or "binder" in n or "bundle" in n:
        return "coffret"
    return None  # accessoires, cartes à l'unité mal rangées…


def usd_of(rows):
    """Prix d'un produit : prix de marché TCGplayer, sinon prix médian."""
    best = None
    for r in rows:
        p = r.get("marketPrice") or r.get("midPrice")
        if isinstance(p, (int, float)) and p > 0 and (best is None or r.get("subTypeName") == "Normal"):
            best = p
    return best


# ---------- Historique par groupe : {"d": [dates], "p": {produit: [centimes de dollar ou null]}} ----------
def hpath(gid):
    return os.path.join(HDIR, f"{gid}.json")


def hload(gid):
    try:
        return json.load(open(hpath(gid), encoding="utf8"))
    except (OSError, ValueError):
        return {"d": [], "p": {}}


def hadd(h, day, prices):
    if day in h["d"]:
        i = h["d"].index(day)
    else:
        i = sum(1 for d in h["d"] if d < day)
        h["d"].insert(i, day)
        for col in h["p"].values():
            col.insert(i, None)
    for pid, usd in prices.items():
        col = h["p"].setdefault(str(pid), [None] * len(h["d"]))
        col[i] = round(usd * 100)


def hcompact(h, today):
    """Un point par jour sur 4 mois, puis un toutes les deux semaines."""
    keep, seen = [], set()
    for i, d in enumerate(h["d"]):
        dd = date.fromisoformat(d)
        if (today - dd).days <= 120:
            keep.append(i)
        else:
            b = dd.toordinal() // 14
            if b not in seen:
                seen.add(b)
                keep.append(i)
    h["d"] = [h["d"][i] for i in keep]
    for k, col in list(h["p"].items()):
        col = [col[i] for i in keep]
        h["p"][k] = col
        if all(v is None for v in col):
            del h["p"][k]


def at(h, col, target, slack=21):
    """Dernier prix connu à la date cible (ou jusqu'à `slack` jours avant)."""
    best = None
    for d, v in zip(h["d"], col):
        dd = date.fromisoformat(d)
        if v is not None and target - timedelta(days=slack) <= dd <= target:
            best = v
    return best


# ---------- Noms français des séries (TCGdex) ----------
def norm(s):
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def fr_names():
    en = get("https://api.tcgdex.net/v2/en/sets") or []
    fr = {s["id"]: s["name"] for s in (get("https://api.tcgdex.net/v2/fr/sets") or [])}
    return {norm(s["name"]): (s["id"], fr.get(s["id"])) for s in en}


# Noms de groupes TCGplayer qui ne suivent pas le nom anglais de la série.
GROUP_ALIASES = {"smbaseset": "sunmoon", "swordshieldbaseset": "swordshield", "scarletvioletbaseset": "scarletviolet",
                 "scarletviolet151": "151", "xybaseset": "xy", "blackandwhite": "blackwhite"}


def group_set(name, names):
    """« ME06: Delta Reign », « SM - Burning Shadows », « SV: Scarlet & Violet 151 » → série TCGdex et nom français."""
    base = re.sub(r"^(?:[A-Z0-9&.\- ]{1,8}:\s*|(?:SM|XY|SWSH|SV|BW|DP|HGSS|ME)\s+-\s+)", "", name)
    for cand in (base, name, re.sub(r" Base Set$", "", base)):
        k = norm(cand)
        hit = names.get(GROUP_ALIASES.get(k, k))
        if hit:
            return hit[0], hit[1] or base
    return None, base


# ---------- Archives (historique) ----------
def backfill_dates(today):
    out, d = [], FIRST_ARCHIVE
    while d < today - timedelta(days=120):
        out.append(d)
        d += timedelta(days=14)
    d = today - timedelta(days=120)
    while d < today:
        out.append(d)
        d += timedelta(days=7)
    return out


def read_archive(day, wanted):
    """{groupe: {produit: prix}} pour les produits scellés, depuis l'archive TCGCSV d'un jour."""
    import py7zr
    tmp = tempfile.mkdtemp(prefix="cardex-arch-")
    try:
        blob = get(ARCHIVE.format(day.isoformat()), as_json=False)
        if not blob:
            return {}
        path = os.path.join(tmp, "a.7z")
        open(path, "wb").write(blob)
        with py7zr.SevenZipFile(path) as z:
            targets = [n for n in z.getnames() if n.count("/") == 3 and n.split("/")[1] == "3" and n.split("/")[2] in wanted]
            z.extract(path=tmp, targets=targets)
        out = {}
        for n in targets:
            gid = n.split("/")[2]
            try:
                rows = json.load(open(os.path.join(tmp, n), encoding="utf8")).get("results", [])
            except (OSError, ValueError):
                continue
            by = {}
            for r in rows:
                if r["productId"] in wanted[gid]:
                    by.setdefault(r["productId"], []).append(r)
            out[gid] = {pid: p for pid, rs in by.items() if (p := usd_of(rs))}
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    backfill = "--backfill" in sys.argv
    today = date.today()
    rate = ((get("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR") or {}).get("rates") or {}).get("EUR")
    if not rate:
        sys.exit("Taux de change indisponible : rien n'est modifié.")
    names = fr_names()
    groups = (get(f"{TCGCSV}/groups") or {}).get("results", [])
    if not groups:
        sys.exit("TCGCSV ne répond pas : rien n'est modifié.")
    os.makedirs(HDIR, exist_ok=True)

    catalog, wanted, live = [], {}, {}
    for i, g in enumerate(groups, 1):
        gid = str(g["groupId"])
        products = (get(f"{TCGCSV}/{gid}/products") or {}).get("results", [])
        sealed = []
        for p in products:
            if any(e.get("name") in ("Number", "Rarity") for e in p.get("extendedData", [])):
                continue  # carte à l'unité
            k = kind(p["name"])
            if k:
                sealed.append((p, k))
        if not sealed:
            continue
        rows = {}
        for r in (get(f"{TCGCSV}/{gid}/prices") or {}).get("results", []):
            rows.setdefault(r["productId"], []).append(r)
        sid, setname = group_set(g["name"], names)
        wanted[gid] = {p["productId"] for p, _ in sealed}
        live[gid] = {p["productId"]: u for p, _ in sealed if (u := usd_of(rows.get(p["productId"], [])))}
        for p, k in sealed:
            catalog.append({"id": p["productId"], "g": gid, "k": k, "n": p["name"], "set": setname, "sid": sid,
                            "rel": (g.get("publishedOn") or "")[:10], "img": p.get("imageUrl") or ""})
        if i % 20 == 0:
            print(f"  {i} / {len(groups)} groupes…")
    print(f"{len(catalog)} produits scellés dans {len(wanted)} groupes")

    hist = {gid: hload(gid) for gid in wanted}
    if backfill:
        known = {d for h in hist.values() for d in h["d"]}
        for day in backfill_dates(today):
            if day.isoformat() in known:
                continue  # déjà dans l'historique (reprise après une interruption)
            got = read_archive(day, wanted)
            time.sleep(20)  # les archives sont lourdes : on ménage le serveur
            for gid, prices in got.items():
                hadd(hist[gid], day.isoformat(), prices)
            print(f"  archive {day} : {sum(len(v) for v in got.values())} prix")
    for gid, prices in live.items():
        hadd(hist[gid], today.isoformat(), prices)

    out = []
    for p in catalog:
        h = hist[p["g"]]
        col = h["p"].get(str(p["id"]))
        if not col or col[-1] is None:
            continue  # pas de prix aujourd'hui : produit introuvable à la vente
        now = col[-1]
        ch = {}
        for key, days in (("c7", 7), ("c30", 30), ("c90", 90), ("c365", 365)):
            old = at(h, col, today - timedelta(days=days), slack=4 if days == 7 else 21)
            if old:
                ch[key] = round((now - old) / old * 100, 1)
        first = next(((d, v) for d, v in zip(h["d"], col) if v is not None), None)
        out.append({**p, "eur": round(now / 100 * rate, 2), "usd": now / 100, **ch,
                    "first": round(first[1] / 100 * rate, 2), "since": first[0],
                    "max": round(max(v for v in col if v is not None) / 100 * rate, 2)})

    for gid, h in hist.items():
        hcompact(h, today)
        if h["p"]:
            json.dump(h, open(hpath(gid), "w", encoding="utf8"), separators=(",", ":"))
    out.sort(key=lambda x: (x["rel"], x["eur"]), reverse=True)
    json.dump({"updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rate": rate,
               "source": "TCGplayer via TCGCSV, converti en euros", "products": out},
              open(OUT, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print(f"-> {OUT} : {len(out)} produits avec un prix")


if __name__ == "__main__":
    main()
