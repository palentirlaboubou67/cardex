"""Photos des produits scellés : correspondance Cardmarket -> TCGplayer par le nom (data/market/sealed-img.json).

Les listes de produits TCGCSV (export gratuit de TCGplayer) donnent l'identifiant de la photo
https://tcgplayer-cdn.tcgplayer.com/product/<id>_200w.jpg (emballage anglais). Aucun prix TCGplayer n'est lu.
Méthode (FINAL-cardmarket §3.2) : même série (groupe TCGplayer de la série TCGdex) puis, à défaut, tout le
catalogue du même type ; indice de Jaccard des mots ; mêmes nombres, mêmes Pokémon, mêmes sous-types ;
seuils 0,5 dans la série, 0,75 hors série.
"""
import re
import unicodedata
from collections import defaultdict

from .util import straight


def norm(s):
    s = unicodedata.normalize("NFD", straight(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def kind_tp(name):
    """Type d'un produit TCGplayer, d'après son nom (règles de l'ancien tools/build_sealed.py)."""
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
    return None


COMPAT = {"box": {"box"}, "halfbox": {"halfbox", "box"}, "etb": {"etb"}, "bundle": {"bundle"}, "booster": {"booster"},
          "blister": {"blister"}, "tin": {"tin"}, "coffret": {"coffret", "prerelease"},
          "prerelease": {"prerelease", "coffret"}, "deck": {"deck"}, "kit": {"deck", "coffret"}, "case": {"case"}}
STOP = set("pokemon tcg the of and a booster pack packs box collection premium special set sv swsh sm xy me "
           "version edition exclusive".split())
SUBTYPE = {"binder", "figure", "poster", "pin", "ultra", "super", "mini", "sleeved", "jumbo", "center", "half",
           "showcase", "chest", "stadium", "portfolio", "calendar", "advent", "deluxe", "costco", "walmart", "target"}


def _stem(w):
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def match_all(kept, cm, groups, products, species_en, log=print):
    """kept = [(produit Cardmarket, type, langue)] ; groups/products = TCGCSV ; species_en = noms anglais.
    -> {"idProduct": id TCGplayer}"""
    SPECIES = {norm(n) for n in species_en if n}

    def toks(s, extra=()):
        return {_stem(x) for x in norm(s).split() if x not in STOP and x not in extra}

    def nums(s):
        return set(re.findall(r"\d+", s))

    def species(s):
        return {w for w in norm(s).split() if w in SPECIES}

    def subtype(s):
        return {w for w in norm(s).split() if w in SUBTYPE}

    gname = {str(g["groupId"]): re.sub(r"^[A-Z0-9&.\- ]{1,8}:\s*", "", g.get("name") or "") for g in groups}
    tc = []
    for t in products:
        k = kind_tp(t["n"])
        if k:
            tc.append({"id": t["id"], "g": str(t["g"]), "k": k, "n": t["n"], "set": gname.get(str(t["g"]), "")})
    by_group, by_kind = defaultdict(list), defaultdict(list)
    for t in tc:
        by_group[t["g"]].append(t)
        by_kind[t["k"]].append(t)
    # précalculs des noms TCGplayer
    for t in tc:
        t["nums"], t["sp"], t["sub"], t["all"] = nums(t["n"]), species(t["n"]), subtype(t["n"]), toks(t["n"])

    out = {}
    for p, k, l in kept:
        if l != "int" or k not in COMPAT:
            continue
        sid = cm["exps"].get(str(p["idExpansion"]))
        s = cm["sets"].get(sid) or {}
        tg = s.get("tcgp")
        set_words = set(norm(s.get("en") or "").split()) if sid else set()
        pool = [t for t in by_group.get(str(tg), []) if t["k"] in COMPAT[k]] if tg else []
        scoped = bool(pool)
        if not pool:
            pool = [t for kk in COMPAT[k] for t in by_kind.get(kk, [])]
        name = p["name"]
        a = toks(name, set_words) if scoped else toks(name)
        na = nums(name)
        sa, ua = species(name) - set_words, subtype(name)
        best, bs = None, 0.0
        for t in pool:
            if t["nums"] != na and (na or t["nums"]):
                continue  # nombre de boosters / de boîtes différent
            sb = t["sp"] - set_words
            if (sa or sb) and sa != sb:
                continue  # autre Pokémon mis en avant (blisters, pokébox, coffrets)
            if ua != t["sub"]:
                continue  # classeur / coffret spécial, mini tin / pokébox, Pokémon Center / normal…
            b = toks(t["n"], set_words | set(norm(t["set"]).split())) if scoped else t["all"]
            if not a and not b:
                sc = 1.0 if scoped else 0
            elif not a or not b:
                sc = 0.5 if scoped else 0
            else:
                sc = len(a & b) / len(a | b)
            if sc > bs:
                best, bs = t, sc
        if best and bs >= (0.5 if scoped else 0.75):
            out[str(p["idProduct"])] = best["id"]
    log(f"  photos TCGplayer : {len(out)} produits reliés")
    return dict(sorted(out.items(), key=lambda kv: int(kv[0])))
