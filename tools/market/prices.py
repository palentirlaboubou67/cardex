"""Cotes des cartes, une fois par jour : data/market/prices/<setId>.json depuis price_guide_6.json et cm-map.json.

Format (contrat SPEC §6.5) : {"v":1,"d":"2026-11-25","c":{"025":{"normal":[23,25,24,17,15],"reverse":[…]}}}
valeurs en centimes [tendance, moy. 1 j, moy. 7 j, moy. 30 j, plus bas], null si absente.
"""
from .util import cents, num

# côtés de cm-map : 0 = champs de base, 1 = champs « -holo » (annonces reverse) ; 2/3 = idem avec repli sur
# l'autre côté (produits séparés : Poké Ball, Master Ball, Cosmo, tampons, 1re édition à part…)
_PRIMARY = {0: "", 1: "-holo", 2: "", 3: "-holo"}
_FALLBACK = {2: "-holo", 3: ""}


def _vals(g, s):
    t, a1, a7, a30, low, avg = (num(g.get(k + s)) for k in ("trend", "avg1", "avg7", "avg30", "low", "avg"))
    ref = a7 or a30
    if t and ref and not (ref / 5 <= t <= ref * 5):
        t = ref  # tendance cassée (neo2-10 Cizayox : 0,02 € pour 19,83 € de moyenne sur 7 jours)
    t = t or ref or avg
    return [cents(t), cents(a1), cents(a7), cents(a30), cents(low)]


def card_values(g, side):
    """Ligne du guide + côté -> [tendance, avg1, avg7, avg30, low] en centimes, ou None sans aucun prix."""
    if not g:
        return None
    v = _vals(g, _PRIMARY[side])
    if v[0] is None and side in _FALLBACK:
        w = _vals(g, _FALLBACK[side])
        if w[0] is not None:
            v = w
    return v if any(x is not None for x in v) else None


def build(cmmap, guide_rows, price_day):
    """-> ({setId: fichier}, statistiques)."""
    out, st = {}, {"cards": 0, "priced": 0, "entries": 0}
    for sid, cards in cmmap["cards"].items():
        c = {}
        for local, fins in cards.items():
            st["cards"] += 1
            e = {}
            for f, (prod, side) in fins.items():
                v = card_values(guide_rows.get(prod), side)
                if v is not None:
                    e[f] = v
            if e:
                c[local] = e
                st["priced"] += any(v[0] is not None for v in e.values())
                st["entries"] += len(e)
        if c:
            out[sid] = {"v": 1, "d": price_day, "c": c}
    return out, st
