"""Produits scellés Cardmarket : type, langue, série TCGdex, nom français, prix et variations (sealed.json, chaque jour).

Types et langues : FINAL-cardmarket §2.1 et §2.2 avec les corrections de la vérification (présentoirs de Boîtiers
Stratégies et Combats et de Mini Tins = cartons, trousse métal = pokébox, « Trick or Trade » = international), plus
celles de la relecture du catalogue (« On the Case », présentoirs de coffrets, de stickers et de decks = cartons,
coffre de collection = coffret, boutiques Pokémon Center japonaises = japonais).
"""
import re
from collections import Counter, defaultdict

from .util import num, straight, typo

CAT = {52: "booster", 53: "box", 54: "deck", 1013: "kit", 1014: "tin", 1015: "coffret", 1016: "etb",
       1017: "coin", 1064: "lot", 1083: "blister", 1654: "cardset"}
DROP = {"coin", "lot", "cardset", "accessory"}
KINDS = ("box", "halfbox", "etb", "bundle", "prerelease", "tin", "blister", "booster", "deck", "kit", "coffret", "case")
LANGS = ("int", "ja")  # gardées dans le catalogue ; les autres (chinois, coréen, indonésien/thaï, inconnues) non


def kind(name, cat):
    n = straight(name).lower()
    if cat in (1017, 1064, 1654):
        return CAT[cat]
    if re.match(r"wcd \d{4}", n) and "display" not in n:
        return "deck"  # decks des Championnats du monde
    if "booster bundle display" in n or "booster bundle case" in n:
        return "case"  # présentoir de bundles
    if re.search(r"(build & battle (box|stadium)|mini tins?|tin) display|\d+-tin display", n):
        return "case"  # présentoirs de plusieurs boîtes
    if re.search(r"\b(collection|deck|blister|sticker|pin|wcd \d{4}) display\b", n):
        return "case"  # présentoirs de coffrets, de decks, de blisters
    if re.search(r"\bcase\b", n) and not re.search(
            r"special case|case file|card case|deck case|counter case|pencil case|on the case|carrying case", n):
        return "case"
    if "half booster box" in n or "(18 boosters)" in n:
        return "halfbox"
    if "elite trainer box" in n:
        return "etb"
    if "booster bundle" in n:
        return "bundle"
    if "build & battle" in n or "build and battle" in n or "prerelease" in n:
        return "prerelease"
    if "booster box" in n or "booster display" in n:
        return "box"
    if re.search(r"collector'?s? chest", n):
        return "coffret"  # coffre de collection (rangé parmi les pokébox chez Cardmarket)
    if cat == 1014 or re.search(r"\btins?\b", n):
        return "tin"
    if cat == 1083 or "blister" in n or "checklane" in n:
        return "blister"
    if cat in (52, 54, 1013, 1016, 53):
        return CAT[cat]
    if re.search(r"energy pack|sleeves?\b|deck box|playmat|portfolio|card sheet|expansion sheet|coin set|badge", n):
        return "accessory"
    return "coffret"


# ---------- langue ----------
_JP_CITY = (r"\b(?:tokyo|yokohama|osaka|nagoya|sapporo|tohoku|hiroshima|fukuoka|kyoto|skytree|kanazawa|shibuya|"
            r"okinawa|kagoshima)\b")
LANG_RULES = [  # nom anglais, première règle qui s'applique
    ("int", r"trick or trade|^wcd \d{4}|^world championships? \d{4} deck"),  # vendus en anglais
    ("ko", r"\bkorean\b"),
    ("zh-tw", r"traditional chinese|\bt-?chinese\b"),
    ("zh-cn", r"simplified chinese|\bs-?ch\b|^(?:csv|csvh|csvl|cs|cbb|csm)[\w.]*c:|^151c:|\bchinese\b|gift box"),
    ("id-th", r"indonesian|\bid/th\b|\bthai\b"),
    # boutiques Pokémon Center japonaises, « Special Box » et coffrets réservés au Japon
    # (règles lues avant EXP_LANG : vaut aussi dans l'extension « fourre-tout » 1645, étiquetée internationale)
    ("ja", r"\bjp\b|japanese|\bjapan\b|start decks?\b|card gym|poncho-wearing|special box|triple starter set|"
           r"^pok[eé]mon card game classic|koko collection|high.class deck|expansion pack special edition|"
           r"\bsilver lance\b|jet.black spirit|vmax climax|vstar universe|shiny star v\b|strike master limited|"
           + _JP_CITY),
]
# Extensions « fourre-tout » sans série TCGdex, étiquetées à la main d'après leurs produits (à revoir quand
# Cardmarket en ajoute).
EXP_LANG = {1645: "int", 5335: "int", 5798: "int", 6231: "int", 5415: "int", 5838: "zh-cn",
            3324: "ja", 5927: "ja", 3389: "ja", 5362: "ja", 4251: "ja", 3781: "ja", 5212: "ja", 3214: "ja",
            6230: "ja", 4357: "ja"}


def lang_hint(name):
    n = straight(name).lower()
    for code, rx in LANG_RULES:
        if re.search(rx, n):
            return code
    return None


def languages(nonsingles, asia_exps, intl_exps):
    """-> {idProduct: 'int' | 'ja' | 'zh-cn' | 'zh-tw' | 'ko' | 'id-th' | 'int?'}"""
    hint = defaultdict(Counter)
    for p in nonsingles:
        hint[p["idExpansion"]][lang_hint(p["name"]) or "?"] += 1
    out = {}
    for p in nonsingles:
        h = lang_hint(p["name"])
        e = p["idExpansion"]
        if h:
            out[p["idProduct"]] = h
        elif e in EXP_LANG:
            out[p["idProduct"]] = EXP_LANG[e]
        elif e in asia_exps:
            out[p["idProduct"]] = "ja"
        else:
            c = hint[e]
            top, n = max(((k, v) for k, v in c.items() if k != "?"), key=lambda x: x[1], default=(None, 0))
            if top and n * 2 >= sum(c.values()):
                out[p["idProduct"]] = top
            elif e in intl_exps or re.match(r"wcd \d{4}", p["name"].lower()):
                out[p["idProduct"]] = "int"
            else:
                out[p["idProduct"]] = "int?"
    return out


# ---------- prix ----------
FLOOR = 0.02         # tendance « plancher » de Cardmarket (aucune vente) : jamais un prix
MODERN = "2020-01-01"  # boosters récents (Épée et Bouclier et après) : beaucoup de vendeurs, offre fiable


def _real(v):
    v = num(v)
    return v if v is not None and v > FLOOR else None


def sealed_price(g, kind=None, rel=None):
    """Ligne du guide (+ type et date de sortie du produit) -> (prix affiché, « dès » plausible ou None).
    Jamais les champs -holo (artefacts).
    - tendance de 0,02 € = valeur plancher de Cardmarket : absente ;
    - booster récent (sorti depuis 2020) vendu dès 10 € au plus dont la tendance dépasse 5 fois cette offre sans que
      la moyenne la confirme : pic dû à une vente aberrante (fun pack Chaos Ascendant à 43,41 € pour 0,60 € d'offre
      et 1,27 € de moyenne, booster sleeved Flammes Fantasmagoriques à 145 €), tendance écartée ;
    - sans tendance, la moyenne seule ne vaut que si l'offre la moins chère la confirme (à un facteur 3 près) : pour
      le vieux scellé elle est souvent fausse (display EX Émeraude à 69,95 €). Pas de garde générale
      tendance/moyenne : elle mettrait le display Collection Légendaire à 150 € au lieu de 24 261 € ;
    - « dès » seulement dans [0,3 ; 3] fois le prix (Phantom Forces : pas de « dès 100 000 € »).
    Le même calcul sert au catalogue, au point d'historique du jour et à la reconstitution depuis l'Archive."""
    g = g or {}
    t, avg, low = _real(g.get("trend")), _real(g.get("avg")), _real(g.get("low"))
    if (t and low and kind == "booster" and rel and rel >= MODERN and low <= 10 and t > 5 * low and t - low > 5
            and (not avg or t > 3 * avg or avg > 3 * low)):
        t = None
    eur = t
    if not eur and avg and low and avg / 3 <= low <= avg * 3:
        eur = avg
    if low and not (eur and 0.3 * eur <= low <= 3 * eur):
        low = None
    return eur, low


def release(p, l, cm):
    """Date de sortie d'un produit : celle de sa série (international) ou de son extension japonaise."""
    e = p["idExpansion"]
    sid = cm["exps"].get(str(e)) if l == "int" else None
    s = cm["sets"].get(sid) if sid else None
    return (s or {}).get("rel") or cm.get("asia", {}).get(str(e)) or None


def context(kept, cm):
    """-> {idProduct: (type, date de sortie)} pour sealed_price()."""
    return {p["idProduct"]: (k, release(p, l, cm)) for p, k, l in kept}


# ---------- catalogue ----------
def classify(nonsingles, cm):
    """-> ([(produit, type, langue)] des produits gardés, {idProduct: langue} de tous)."""
    intl = {s["exp"] for s in cm["sets"].values() if s.get("exp")}
    asia = {int(e) for e in cm.get("asia", {})}
    lang = languages(nonsingles, asia, intl)
    out = []
    for p in nonsingles:
        k = kind(p["name"], p["idCategory"])
        l = lang[p["idProduct"]]
        if k in DROP or l not in LANGS:
            continue
        out.append((p, k, l))
    return out, lang


def catalogue(kept, rows, cm, namer, img, hist_summary, shard_of):
    """kept = classify() ; rows = {idProduct: ligne du guide} ; img = {"idProduct": id TCGplayer} ;
    hist_summary(id) -> repères d'historique ; shard_of(id) -> fichier d'historique ou None. -> [produits]
    Un produit sans prix aujourd'hui ni historique (aucune vente connue) n'entre pas au catalogue."""
    out = []
    for p, k, l in kept:
        pid, e = p["idProduct"], p["idExpansion"]
        rel = release(p, l, cm)
        eur, low = sealed_price(rows.get(pid), k, rel)
        if not eur and not shard_of(pid):
            continue
        sid = cm["exps"].get(str(e)) if l == "int" else None
        tk = bool(sid and sid.startswith("tk-"))
        fr = namer.name(p["name"], k, sid, asia=l == "ja", tk=tk)
        t = img.get(str(pid)) if l == "int" else None
        h = hist_summary(pid)
        out.append({
            "id": pid, "k": k, "l": l, "e": e, "sid": None if tk else sid,
            "set": None if tk or not sid else typo(namer.set_fr(sid)), "rel": rel,
            "fr": typo(fr), "n": p["name"],
            "img": f"https://tcgplayer-cdn.tcgplayer.com/product/{t}_200w.jpg" if t else "",
            "eur": round(eur, 2) if eur else None, "low": round(low, 2) if low else None,
            "c7": h["c7"], "c30": h["c30"], "c90": h["c90"], "c365": h["c365"],
            "first": h["first"], "since": h["since"], "max": h["max"], "chg": h["chg"],
            "h": shard_of(pid),
        })
    # plus récents d'abord ; à date égale, par extension et par type (noms voisins : fichier mieux compressé)
    out.sort(key=lambda x: (x["e"], KINDS.index(x["k"]), -(x["eur"] or 0), x["id"]))
    out.sort(key=lambda x: x["rel"] or "", reverse=True)
    return out
