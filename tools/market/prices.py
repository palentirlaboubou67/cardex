"""Cotes des cartes, une fois par jour : data/market/prices/<setId>.json depuis price_guide_6.json et cm-map.json.

Format (contrat SPEC §6.5) : {"v":1,"d":"2026-11-25","c":{"025":{"normal":[23,25,24,17,15],"reverse":[…]}}}
valeurs en centimes [tendance, moy. 1 j, moy. 7 j, moy. 30 j, plus bas], null si absente ; 6e valeur 1 (1re édition,
tampon) = prix toutes éditions : le produit Cardmarket sert aussi une impression sans ce tampon (base1 : produits
« Shadowless »).
"""
from statistics import median

from .util import cents, num

# côtés de cm-map : 0 = champs de base, 1 = champs « -holo » (annonces reverse) ; 2/3 = idem avec repli sur
# l'autre côté (produits séparés : Poké Ball, Master Ball, Cosmo, tampons, 1re édition à part…)
_PRIMARY = {0: "", 1: "-holo", 2: "", 3: "-holo"}
_FALLBACK = {2: "-holo", 3: ""}


def sane_trend(t, a1, a7, a30, avg=None):
    """Tendance gardée si la majorité des moyennes présentes (1, 7 et 30 jours) la confirme (dans [m/5, m×5]) ;
    sinon la médiane de ces moyennes. neo2-10 Cizayox : 0,02 € pour 13,90 / 19,83 / 84,26 € -> 19,83 € ; une seule
    vente bon marché sur 7 jours ne remplace plus une tendance que la veille et le mois confirment. Une moyenne
    sur 30 jours gonflée par quelques ventes anciennes ne suffit pas à garder la tendance quand la veille et la
    semaine la contredisent (bw1-63 Sablaireau : tendance 4,08 €, 30 j 2,27 €, 7 j 0,17 €, 1 j 0,05 € -> 0,17 €).
    Même règle à appliquer dans js/data/prices.js shape()."""
    refs = [r for r in (a1, a7, a30) if r]
    if t and refs and 2 * sum(1 for r in refs if r / 5 <= t <= r * 5) <= len(refs):
        t = median(refs)
    return t or a7 or a30 or avg


def _vals(g, s):
    t, a1, a7, a30, low, avg = (num(g.get(k + s)) for k in ("trend", "avg1", "avg7", "avg30", "low", "avg"))
    return [cents(sane_trend(t, a1, a7, a30, avg)), cents(a1), cents(a7), cents(a30), cents(low)]


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


# finitions de l'ancienne appli : gardées même si la fiche de la série ne les liste pas (collections importées)
LEGACY = frozenset(("normal", "reverse", "holo", "cosmos", "pokeball", "masterball"))


def build(cmmap, guide_rows, price_day, app=None):
    """app = {cardId: [finitions]} des fichiers de séries de l'appli : quand il est donné, seules ses cartes sont
    cotées, et « 1re édition » / « tampon » seulement là où la fiche les liste. -> ({setId: fichier}, statistiques).
    Une 1re édition ou un tampon sans produit à part a exactement les valeurs de la carte de base (prix toutes
    éditions) : l'appli le reconnaît à ce tableau identique."""
    out, st = {}, {"cards": 0, "priced": 0, "entries": 0, "skipped cards": 0, "skipped finishes": 0}
    for sid, cards in cmmap["cards"].items():
        c = {}
        for local, fins in cards.items():
            listed = app.get(f"{sid}-{local}") if app else None
            if app and listed is None:
                st["skipped cards"] += 1  # carte absente des fichiers de l'appli
                continue
            st["cards"] += 1
            e = {}
            for f, link in fins.items():
                prod, side = link[0], link[1]
                if listed is not None and f not in listed and f not in LEGACY:
                    st["skipped finishes"] += 1
                    continue
                v = card_values(guide_rows.get(prod), side)
                if v is not None:
                    if len(link) > 2 and link[2]:
                        v.append(1)  # prix toutes éditions (cm-map : produit qui sert aussi la carte sans tampon)
                        st["all editions"] = st.get("all editions", 0) + 1
                    e[f] = v
            if e:
                c[local] = e
                st["priced"] += any(v[0] is not None for v in e.values())
                st["entries"] += len(e)
        if c:
            out[sid] = {"v": 1, "d": price_day, "c": c}
    return out, st
