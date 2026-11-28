"""Table TCGdex -> Cardmarket (data/market/cm-map.json), construite chaque semaine.

- série TCGdex -> extension Cardmarket : la déclaration si au moins une carte vote pour elle, sinon la majorité
  (ex4 -> 1542, swsh10.5 -> 5051, tk-ex-latia -> 1626), plus une table manuelle pour les séries sans lien ;
- carte + finition -> produit Cardmarket et côté des champs (base ou « -holo » = annonces reverse) ;
- liens vérifiés par le nom anglais (☆ = Gold Star, δ, ex/EX gardés), relinkés ou retrouvés dans l'extension
  de la série (nom puis attaques), sinon abandonnés (la carte affiche « — »).
"""
import html
import re
import zipfile
from collections import Counter, defaultdict
from datetime import date

from .tsparse import parse_object
from .util import norm_words, num, straight


POCKET = re.compile(r"^(A\d|B\d|P-A)")

# Séries que TCGdex ne relie à aucune extension (vérifié le 2026-11-25 par recouvrement des noms ; à revoir
# quand TCGdex ajoute ses identifiants).
CM_EXP_EXTRA = {"sma": 2514, "bwp": 1611, "np": 1608, "tk-xy-latia": 1683, "tk-xy-latio": 1683,
                "tk-xy-sy": 1631, "tk-xy-n": 1631, "tk-xy-b": 1632, "tk-xy-w": 1632, "tk-xy-su": 1707, "tk-xy-p": 1707}

# Cartes que TCGdex ne relie à rien : « A jaune » (xya), versions alternatives ajoutées par Cardmarket le 19/05/2017
# dans l'extension de la carte d'origine (vérifié le 2026-11-28 : nom, attaques, date d'ajout).
# xy10-54a est la même carte que xya-54a (TCGdex la range aussi dans la série d'origine) : même produit.
CM_CARD_EXTRA = {"xya-24a": 297894, "xya-28a": 297892, "xya-54a": 297893, "xya-55a": 297891, "xya-92a": 297897,
                 "xya-107a": 297896, "xy10-54a": 297893}

# Rang de rareté (anglais de cards-database) pour répartir des produits jumeaux : la carte la plus rare reçoit le
# produit le plus cher quand les raretés diffèrent (sm12-29 commune / sm12-237 secrète).
_RANK = {"common": 0, "uncommon": 1, "rare": 2, "holo rare": 3, "rare holo": 3, "promo": 3, "none": 3,
         "secret rare": 6, "hyper rare": 6, "special illustration rare": 6, "mega hyper rare": 6}


PROMO_SETS = ("basep", "np", "dpp", "hgssp", "bwp", "xyp", "smp", "swshp", "svp", "mep")


def _added(p):
    """Date d'ajout d'un produit Cardmarket (None pour l'import d'origine, « 0000-00-00 »)."""
    d = str((p or {}).get("dateAdded") or "")[:10]
    try:
        return date.fromisoformat(d)
    except ValueError:
        return None


def _close(a, b, days=183):
    """Deux produits de la même époque : tous deux sans date, ou à moins de six mois d'écart."""
    if a is None or b is None:
        return a is None and b is None
    return abs((a - b).days) <= days


def rarity_rank(c):
    """Rang de la carte ; une sous-série à préfixe (RC, SV, TG, GG…) passe après la série principale."""
    r = _RANK.get(str(c.get("rarity") or "none").lower(), 5)
    return r + (10 if re.match(r"^[A-Za-z]+\d", c["local"]) else 0)

APP_FOILS = ("cosmos", "pokeball", "masterball")
FINISH_ORDER = ["normal", "reverse", "holo", "cosmos", "pokeball", "masterball", "firstEdition", "stamp"]

# Côté des champs du guide : 0 = base, 1 = « -holo » ; 2/3 = idem avec repli sur l'autre côté (produits séparés).
BASE, HOLO, BASE_FB, HOLO_FB = 0, 1, 2, 3


# ---------- lecture de l'archive ----------
def _stamps(e):
    s = e.get("stamp")
    return [x for x in (s if isinstance(s, list) else [s] if s else []) if isinstance(x, str)]


def _cm(tp):
    v = (tp or {}).get("cardmarket") if isinstance(tp, dict) else None
    return v if isinstance(v, int) and v > 0 else None


def read_db(zip_path):
    """-> (sets, cards, asia) depuis le zip de cards-database (texte uniquement)."""
    z = zipfile.ZipFile(zip_path)
    names = [n for n in z.namelist() if n.endswith(".ts")]
    sets, folder, cards = {}, {}, {}
    asia_sets, asia_folder, asia_votes = {}, {}, defaultdict(list)
    for n in names:
        p = n.split("/")
        if len(p) != 4 or p[1] not in ("data", "data-asia"):
            continue
        o = parse_object(z.read(n).decode("utf8", "replace")) or {}
        sid = o.get("id")
        if not isinstance(sid, str):
            continue
        tp = o.get("thirdParty") or {}
        if p[1] == "data":
            folder[n[:-3]] = sid
            nm = o.get("name") if isinstance(o.get("name"), dict) else {}
            ab = o.get("abbreviations") if isinstance(o.get("abbreviations"), dict) else {}
            sets[sid] = {"id": sid, "fr": nm.get("fr"), "en": nm.get("en"), "rel": o.get("releaseDate"),
                         "serie": p[2], "cm": _cm(tp), "tcgp": tp.get("tcgplayer") if isinstance(tp, dict) else None,
                         "code": ab.get("official")}
        else:
            asia_folder[n[:-3]] = sid
            rel = o.get("releaseDate")
            rel = rel.get("ja") if isinstance(rel, dict) else rel
            asia_sets[sid] = {"cm": _cm(tp), "rel": rel if isinstance(rel, str) else None}
    rx_cm = re.compile(r"cardmarket\s*:\s*(\d+)")
    for n in names:
        p = n.split("/")
        if len(p) != 5:
            continue
        if p[1] == "data-asia":
            sid = asia_folder.get("/".join(p[:4]))
            if sid:
                asia_votes[sid] += [int(x) for x in rx_cm.findall(z.read(n).decode("utf8", "replace"))]
            continue
        if p[1] != "data":
            continue
        sid = folder.get("/".join(p[:4]))
        if not sid:
            continue
        o = parse_object(z.read(n).decode("utf8", "replace")) or {}
        nm = o.get("name") if isinstance(o.get("name"), dict) else {}
        local = p[4][:-3]
        atk = []
        for a in o.get("attacks") or []:
            an = (a or {}).get("name") if isinstance(a, dict) else None
            if isinstance(an, dict) and an.get("en"):
                atk.append(an["en"])
        v = o.get("variants")
        cards[f"{sid}-{local}"] = {"sid": sid, "local": local, "en": nm.get("en"), "fr": nm.get("fr"),
                                   "atk": atk, "variants": v if isinstance(v, (list, dict)) else None,
                                   "top": _cm(o.get("thirdParty")),
                                   "stage": o.get("stage") if isinstance(o.get("stage"), str) else None,
                                   "rarity": o.get("rarity") if isinstance(o.get("rarity"), str) else None,
                                   "langs": _langs(o)}
    return sets, cards, {"sets": asia_sets, "votes": asia_votes}


def _langs(o):
    """Langues dans lesquelles la carte existe (clés du nom), pour ignorer les variantes d'autres langues."""
    nm = o.get("name")
    return sorted(nm) if isinstance(nm, dict) else []


# ---------- noms ----------
_MARK = re.compile(r"\b(gold star|delta|ex|gx|v|vmax|vstar|lv x|break|prime|legend|star)\b")


_SP_CODE = {"G": " g ", "GL": " gl ", "FB": " fb ", "C": " c ", "4": " e4 ", "E4": " e4 ", "F": " f ", "M": " m "}
_EN_CODE = {"G": "grass", "R": "fire", "W": "water", "L": "lightning", "P": "psychic", "F": "fighting",
            "D": "darkness", "M": "metal", "Y": "fairy", "N": "dragon", "C": "colorless"}
_GREEK = {"α": " alpha ", "β": " beta ", "γ": " gamma ", "δ": " delta ", "Ω": " omega ", "Δ": " delta ",
          "♀": " f ", "♂": " m "}


def _cm_codes(s):
    """Codes entre crochets dans les noms Cardmarket : « Weavile [G] Lv.48 », « Bubbly [W] Energy »,
    « Nidoran [F] »."""
    s = re.sub(r"\[([GRWLPFDMYNC])\]\s+Energy\b", lambda m: _EN_CODE[m.group(1)] + " Energy", s)
    return re.sub(r"\[(G|GL|FB|C|4|E4|F|M)\](?=\s|$)", lambda m: _SP_CODE[m.group(1)], s)


# Orthographes qui diffèrent entre TCGdex (anglais officiel) et Cardmarket : nom TCGdex -> nom Cardmarket.
NAME_ALIAS = {
    "impostor professor oak": "imposter professor oak",
    "prof oaks research": "professor oaks research",
    "adventure lantern": "adventuring lantern",
    "tasty rice ball": "delicious onigiri",
    "legendary pyroduct": "legendary lava tube",
    "legendary trench": "legendary marine trench",
    "blend energy grass fire psychic darkness": "blend energy gfpd",
    "blend energy water lightning fighting metal": "blend energy wlfm",
    "delta rainbow energy": "rainbow energy delta",
}

# « Unit Energy GrassFireWater », « Fairy Charm Lightning » (TCGdex) = « Unit Energy [GRW] », « Fairy Charm [L] »
_TYPE_CODE = {"Grass": "G", "Fire": "R", "Water": "W", "Lightning": "L", "Psychic": "P", "Fighting": "F",
              "Darkness": "D", "Metal": "M", "Fairy": "Y", "Dragon": "N", "Colorless": "C"}
_TYPED = re.compile(r"^(Unit Energy|Fairy Charm) ((?:%s)+)$" % "|".join(_TYPE_CODE))


def tcgdex_name(c):
    """Nom anglais TCGdex d'une carte, complété comme chez Cardmarket : les Zarbi d'exu portent leur lettre dans
    le numéro (exu-A = « Unown [A] ») ; les cartes NIV.X et TURBO n'ont pas le suffixe dans leur nom."""
    en = c.get("en")
    if not en:
        return en
    if en.strip().lower() == "unown" and re.fullmatch(r"[A-Z!?]|%3F|%21", c["local"]):
        letter = {"%3F": "?", "%21": "!"}.get(c["local"], c["local"])
        return f"Unown [{letter}]"
    m = _TYPED.match(en)
    if m:
        return f"{m.group(1)} [{''.join(_TYPE_CODE[t] for t in re.findall('[A-Z][a-z]+', m.group(2)))}]"
    low = en.lower()
    if (c.get("stage") == "LEVEL-UP" or "lv.x" in (c.get("rarity") or "").lower()) and "lv" not in low:
        return en + " LV.X"
    if c.get("stage") == "BREAK" and "break" not in low:
        return en + " BREAK"
    return en


def card_key(name, species=frozenset(), cm=False):
    """Nom anglais -> clé stricte. ☆ = « gold star », δ = « delta » ; « Lv.NN » retiré ; ex/EX/GX/δ restent
    (ce sont des cartes différentes). cm=True : nom Cardmarket, on retire le dernier groupe [attaques]."""
    s = straight(html.unescape(name))  # Cardmarket : « Nidoran &female; »
    if cm:
        s = re.sub(r"\s*\[[^\[\]]*\]\s*$", "", s)  # attaques
        s = _cm_codes(s)
    return _key(s, species)


def cm_keys(name, species=frozenset()):
    """Clés d'un nom Cardmarket : sans le dernier groupe entre crochets (attaques), et avec (« Ancient Technical
    Machine [Ice] » : le crochet fait partie du nom)."""
    a = card_key(name, species, cm=True)
    b = _key(_cm_codes(straight(html.unescape(name))), species)
    return {a, b}


def _key(s, species):
    s = re.sub(r"^M\s?(?=[A-Z])", "Mega ", s)  # « M Gengar EX » (TCGdex) = « MGengar EX » (Cardmarket)
    if s.lower().startswith("unown"):  # Zarbi « ! » et « ? »
        s = s.replace("!", " exclamation ").replace("?", " question ")
    s = s.replace("☆", " gold star ").replace("★", " gold star ")
    for g, w in _GREEK.items():
        s = s.replace(g, w)
    s = re.sub(r"\bdelta species\b", " delta ", s, flags=re.I)
    s = re.sub(r"\blv\.? ?\d+\b", " ", s, flags=re.I)
    s = re.sub(r"\blv\.? ?x\b", " lv x ", s, flags=re.I)
    s = re.sub(r"'s\b", "s", s)
    k = norm_words(s)
    k = re.sub(r"\b(delta)( delta)+\b", r"\1", k)
    k = re.sub(r"^basic (\w+ energy)$", r"\1", k)  # « Basic Grass Energy » (Cardmarket) = « Grass Energy »
    # « Mewtwo Star » (TCGdex) = « Mewtwo Gold Star » (Cardmarket)
    if k.endswith(" star") and not k.endswith("gold star"):
        base = k[:-5]
        if base in species:
            k = base + " gold star"
    return NAME_ALIAS.get(k, k)


def markers(k):
    return frozenset(m for m in _MARK.findall(k))


def atk_key(s):
    return norm_words(s)


def cm_attacks(name):
    m = re.search(r"\[([^\[\]]*)\]\s*$", name)
    return frozenset(atk_key(a) for a in m.group(1).split("|")) if m else frozenset()


def _atk_similarity(a, b):
    """Ressemblance de deux ensembles d'attaques (0..1) : meilleure paire pour chaque attaque TCGdex, espaces ôtés."""
    from difflib import SequenceMatcher
    if not a or not b:
        return 0.0
    tot = 0.0
    for x in a:
        tot += max(SequenceMatcher(None, x.replace(" ", ""), y.replace(" ", "")).ratio() for y in b)
    return tot / len(a)


# ---------- extensions ----------
def map_expansions(sets, cards, exp_of, known_exps):
    """sid -> idExpansion (règle corrigée + table manuelle). Renvoie aussi les votes (diagnostic)."""
    votes = defaultdict(Counter)
    for cid, c in cards.items():
        ids = set()
        if c["top"]:
            ids.add(c["top"])
        if isinstance(c["variants"], list):
            for e in c["variants"]:
                if isinstance(e, dict) and _cm(e.get("thirdParty")):
                    ids.add(_cm(e.get("thirdParty")))
        for i in ids:
            if i in exp_of:
                votes[c["sid"]][exp_of[i]] += 1
    out = {}
    for sid, s in sets.items():
        v, dec = votes.get(sid), s["cm"] if s["cm"] in known_exps else None
        if v and not (dec and v[dec] > 0):
            out[sid] = v.most_common(1)[0][0]
        else:
            out[sid] = dec
        if not out[sid] and sid in CM_EXP_EXTRA:
            out[sid] = CM_EXP_EXTRA[sid]
    return out, votes


def asia_expansions(asia, exp_of, known_exps):
    """-> {idExpansion: date de sortie japonaise | None} des séries asiatiques de TCGdex."""
    out = {}
    for sid, a in asia["sets"].items():
        e = a["cm"] if a["cm"] in known_exps else None
        c = Counter(exp_of[i] for i in asia["votes"].get(sid, []) if i in exp_of)
        if c:
            e = c.most_common(1)[0][0] if not (e and c[e] > 0) else e
        if e:
            if e not in out or (a["rel"] and (not out[e] or a["rel"] < out[e])):
                out[e] = a["rel"]
    return out


# ---------- finitions d'une carte ----------
def _entries(c, remap=None):
    out = []
    for e in c["variants"] if isinstance(c["variants"], list) else []:
        if not isinstance(e, dict):
            continue
        t = str(e.get("type") or "").lower()
        if t not in ("normal", "reverse", "holo"):
            continue  # lenticulaire, métal… : pas une finition de l'appli
        if str(e.get("size") or "standard").lower() != "standard":
            continue  # cartes jumbo
        langs = e.get("languages")
        if isinstance(langs, list) and langs and "fr" not in langs and "en" not in langs:
            continue  # variante propre à une autre langue
        st = _stamps(e)
        foil = str(e.get("foil") or "").lower() or None
        cm = _cm(e.get("thirdParty"))
        if remap and cm in remap:
            cm = remap[cm]
        out.append({"type": t, "foil": foil, "stamps": st, "sub": str(e.get("subtype") or "").lower() or None,
                    "cm": cm})
    return out


def api_finishes(c):
    """Finitions telles que l'API TCGdex les annonce (variants + foils de variants_detailed)."""
    v = c["variants"]
    if isinstance(v, list):
        f = set()
        for e in v:
            if not isinstance(e, dict):
                continue
            t = str(e.get("type") or "").lower()
            if t in ("normal", "reverse", "holo"):
                f.add(t)
            if "1st-edition" in _stamps(e):
                f.add("firstEdition")
        for e in _entries(c):
            if e["foil"] in APP_FOILS:
                f.add(e["foil"])
        return f
    v = v if isinstance(v, dict) else {}
    f = set()
    if v.get("normal", True) is not False:
        f.add("normal")
    for k in ("reverse", "holo", "firstEdition"):
        if v.get(k) is True:
            f.add(k)
    return f


def _serves_unstamped(c, prod, finish, remap=None):
    """Le produit d'une 1re édition / d'un tampon sert-il aussi une impression de la carte sans ce tampon ?"""
    for e in _entries(c, remap):
        if e["cm"] != prod:
            continue
        if finish == "firstEdition" and "1st-edition" not in e["stamps"]:
            return True
        if finish == "stamp" and not [x for x in e["stamps"] if x != "1st-edition"]:
            return True
    return False


def _plain(e):
    return not e["foil"] and not e["stamps"]


def _ballish(foil):
    """Motifs de reverse qui ne sont pas la reverse de l'appli : Copain Ball, Love Ball, Sombre Ball, Rapide Ball…
    (Héros Transcendants) et le motif Team Rocket ; Poké Ball / Master Ball ont leur propre finition."""
    return bool(foil) and (foil.endswith("ball") or foil == "team-rocket")


def _pick(es, pred, prefer=()):
    """Première entrée qui satisfait pred, en préférant celles dont le sous-type est dans prefer."""
    cands = [e for e in es if pred(e)]
    for e in cands:
        if e["sub"] in prefer:
            return e
    return cands[0] if cands else None


def plan_card(c, remap=None, base_hint=None, app=()):
    """-> (base_product, base_type, {finish: (product, side)}) avant vérification des noms.

    base = le produit de l'impression de base : la normale sans tampon, sinon la holo (une « normale » qui n'existe
    que tamponnée, ex. réimpression des decks des Championnats du monde, n'est pas l'impression de base).
    remap = {ancien idProduct: nouveau} (lien faux corrigé) ; base_hint = produit retrouvé par le nom ;
    app = finitions que l'appli affiche (fichiers de CA, issus de l'API) : celles que la base TCGdex ne connaît pas
    encore reçoivent le prix de la carte imprimée (normale/holo/1re éd.) ou des annonces reverse."""
    es = _entries(c, remap)
    fins = api_finishes(c)
    top = remap.get(c["top"], c["top"]) if remap else c["top"]
    pref = (None, "unlimited")
    ptypes = ({e["type"] for e in es if not e["stamps"] and e["foil"] not in APP_FOILS}
              or {e["type"] for e in es if e["foil"] not in APP_FOILS})  # tampon commun à toute la série
    # une normale sans produit Cardmarket (version de deck, ex4-3) ne fait pas l'impression de base si la holo en a un ;
    # une rare holo dont la normale (deck) partage le produit : la holo est l'impression de base (dp3-1)
    with_cm = {e["type"] for e in es if e["cm"] and not e["stamps"] and e["foil"] not in APP_FOILS}
    if "normal" in ptypes and "normal" not in with_cm and "holo" in with_cm:
        ptypes = ptypes - {"normal"}
    if {"normal", "holo"} <= ptypes and "holo" in (c.get("rarity") or "").lower():
        prods = {e["type"]: e["cm"] for e in es if not e["stamps"] and e["foil"] not in APP_FOILS}
        if prods.get("normal") == prods.get("holo"):
            ptypes = ptypes - {"normal"}
    # seule une holo Cosmo a un produit (promo SWSH129) : c'est la carte de base
    if not with_cm and any(e["cm"] and e["type"] == "holo" and e["foil"] == "cosmos" and not e["stamps"] for e in es):
        ptypes = {"holo"}
    if es:
        if "normal" in ptypes:
            btype = "normal"
        elif "holo" in ptypes:
            btype = "holo"
        else:
            btype = "normal" if "normal" in fins and "holo" not in fins else "holo" if "holo" in fins else "normal"
    else:
        btype = "normal" if "normal" in fins else "holo"
    e = (_pick(es, lambda e: e["type"] == btype and _plain(e) and e["cm"], pref)
         or _pick(es, lambda e: e["type"] == btype and not e["stamps"] and e["foil"] not in APP_FOILS and e["cm"], pref)
         or _pick(es, lambda e: e["type"] == btype and e["foil"] not in APP_FOILS and e["cm"], pref))
    base = (e and e["cm"]) or top or next((x["cm"] for x in es if x["type"] == btype and x["cm"]), None)
    if not base and base_hint:
        base = base_hint
    plan = {}

    def side_for(entry_type, prod):
        if prod is None:
            return None
        if prod != base:
            return (prod, HOLO_FB if entry_type == "reverse" else BASE_FB)
        if entry_type == "reverse":
            return (prod, HOLO)
        if entry_type == btype:
            return (prod, BASE)
        return None  # holo rangée sous le produit de la normale (ou l'inverse) : pas de prix propre

    def own(pred_list):
        for pred in pred_list:
            x = _pick(es, pred, pref)
            if x:
                return x
        return None

    # tampon commun à toute la série (McDonald's, 25 ans, 30 ans) : aucune impression sans tampon hors 1re édition ;
    # ailleurs, une normale ou une holo qui n'existe que tamponnée (deck des Championnats du monde, Gym Challenge,
    # avant-première) n'a pas de prix « normale » / « holo » : c'est une version à part (« — »)
    common_stamp = bool(es) and not any(not [st for st in e["stamps"] if st != "1st-edition"] for e in es
                                        if e["foil"] not in APP_FOILS)
    for t in ("normal", "holo"):
        if t not in fins:
            continue
        if t == btype:
            if base:
                plan[t] = (base, BASE)
            continue
        preds = [lambda e: e["type"] == t and _plain(e),
                 lambda e: e["type"] == t and not e["stamps"] and e["foil"] not in APP_FOILS,
                 lambda e: e["type"] == t and not e["stamps"]]
        if common_stamp:
            preds.append(lambda e: e["type"] == t)
        x = own(preds)
        prod = (x and x["cm"]) or (None if es else base)
        sd = side_for(t, prod)
        if not sd and t == "holo" and prod and prod == base and not any(y["type"] == "reverse" for y in es) \
                and "reverse" not in fins:
            # holo rangée sous le produit de la normale, sans reverse (McDonald's, POP) : ses annonces « foil » = la holo
            sd = (base, HOLO)
        if sd:
            plan[t] = sd
    # reverse : la reverse simple, sinon le motif de la série (logo, énergie), sinon un autre motif sans tampon
    # (cracked ice…) ; jamais Poké Ball / Master Ball / Cosmo (finitions à part), ni une Ball de Héros Transcendants
    # ou le motif Team Rocket (me02.5 : la reverse de l'appli est la reverse Énergie), ni une reverse tamponnée.
    # Sans aucune de celles-là : les annonces reverse du produit de la carte, sauf si ses reverses sont Poké Ball,
    # Master Ball ou Cosmo (ces annonces seraient les leurs).
    plain_rev = any(x["type"] == "reverse" and x["foil"] not in APP_FOILS for x in es)
    if "reverse" in fins:
        x = own([lambda e: e["type"] == "reverse" and _plain(e),
                 lambda e: e["type"] == "reverse" and not e["foil"] and e["stamps"] == ["set-logo"],
                 lambda e: e["type"] == "reverse" and e["foil"] == "energy" and not e["stamps"],
                 lambda e: (e["type"] == "reverse" and not e["stamps"] and e["foil"] not in APP_FOILS
                            and not _ballish(e["foil"]))])
        if x or not any(y["type"] == "reverse" and y["foil"] in APP_FOILS for y in es):
            sd = side_for("reverse", (x and x["cm"]) or base)
            if sd:
                plan["reverse"] = sd
    # Cosmo, Poké Ball, Master Ball : produit séparé ; sinon les annonces reverse de la carte, seulement quand la carte
    # n'a pas d'autre reverse (sinon ce serait le prix de la reverse simple)
    for f in APP_FOILS:
        if f not in fins:
            continue
        cands = [x for x in es if x["foil"] == f]
        x = (next((y for y in cands if not y["stamps"] and y["type"] == "holo" and y["cm"]), None)
             or next((y for y in cands if not y["stamps"] and y["cm"]), None)
             or next((y for y in cands if not y["stamps"]), None) or (cands[0] if cands else None))
        if not x:
            continue
        if x["cm"] and x["cm"] != base:
            plan[f] = side_for(x["type"], x["cm"])
        elif base and x["type"] == "reverse" and not plain_rev:
            plan[f] = (base, HOLO)
        elif base and x["type"] == btype and x["cm"] == base:
            plan[f] = (base, BASE)  # cosmo de type holo rangée sous la carte de base (pas de normale)
    # 1re édition : produit séparé s'il existe, sinon celui de la carte (prix toutes éditions)
    if "firstEdition" in fins:
        x = (_pick(es, lambda e: "1st-edition" in e["stamps"] and e["cm"] and e["type"] == btype)
             or _pick(es, lambda e: "1st-edition" in e["stamps"] and e["cm"]))
        prod = (x and x["cm"]) or base
        if prod:
            plan["firstEdition"] = (prod, BASE if prod == base else BASE_FB)
    # tampon (finition ajoutée à la main) : le produit tamponné quand il est unique ; le produit de la carte quand
    # TCGdex range le tampon sous celui-ci ; sinon rien (« — » plutôt que le prix d'une autre carte)
    st = [x for x in es if x["stamps"] and "1st-edition" not in x["stamps"]
          and not (x["type"] == "reverse" and x["stamps"] == ["set-logo"])]
    seps = {x["cm"] for x in st if x["cm"] and x["cm"] != base}
    if len(seps) == 1:
        prod = seps.pop()
        et = next(x["type"] for x in st if x["cm"] == prod)
        plan["stamp"] = (prod, HOLO_FB if et == "reverse" else BASE_FB)
    elif not seps and base:
        x = next((x for x in st if x["cm"] == base), None)
        if x:
            plan["stamp"] = (base, HOLO if x["type"] == "reverse" else BASE)
    # finitions que l'appli affiche mais que la base TCGdex n'a pas (API en retard sur le dépôt)
    if base:
        for f in app:
            if f in plan:
                continue
            if f in ("normal", "holo") and f not in fins:
                plan[f] = (base, BASE)  # l'appli dit « normale » d'une holo seule (bw10-9) : la carte imprimée
            elif f == "firstEdition":
                plan[f] = (base, BASE)
            elif f == "reverse" and not any(x["type"] == "reverse" for x in es):
                plan[f] = (base, HOLO)
    return base, btype, plan


# ---------- construction ----------
def build(zip_path, singles, nonsingles, species, app_cards=None, log=print, guide=None):
    """singles/nonsingles = listes Cardmarket ; species = {nom anglais: nom français} (PokéAPI) ;
    app_cards = {cardId: [finitions]} des fichiers de séries de l'appli (facultatif) ; guide = {idProduct: ligne du
    guide des prix} (facultatif : ordre des produits jumeaux selon la rareté).
    -> (cm-map, audit, base lue)."""
    app_cards = app_cards or {}
    sets, cards, asia = read_db(zip_path)
    log(f"  cards-database : {len(sets)} séries, {len(cards)} cartes")
    sp = frozenset(norm_words(s) for s in species)
    by_id = {p["idProduct"]: p for p in singles}
    exp_of = {p["idProduct"]: p["idExpansion"] for p in singles}
    known = {p["idExpansion"] for p in singles} | {p["idExpansion"] for p in nonsingles}
    exp, votes = map_expansions(sets, cards, exp_of, known)
    asia_exps = asia_expansions(asia, exp_of, known)

    by_exp_key = defaultdict(lambda: defaultdict(list))  # idExpansion -> clé de nom -> [produits]
    pkeys = {}
    for p in singles:
        pkeys[p["idProduct"]] = ks = cm_keys(p["name"], sp)
        for k in ks:
            by_exp_key[p["idExpansion"]][k].append(p["idProduct"])

    fr_ids = sorted({cid for cid, c in cards.items() if c["fr"] and sets[c["sid"]]["fr"] and not POCKET.match(cid)}
                    | {cid for cid in app_cards if cid in cards})
    missing_app = sorted(cid for cid in app_cards if cid not in cards)
    plans = {cid: plan_card(c, app=app_cards.get(cid, ())) for cid, c in cards.items() if not POCKET.match(cid)}
    tkey = {cid: card_key(tcgdex_name(c), sp) if c["en"] else None for cid, c in cards.items()}
    # deux clés quand le nom a été complété (« LV.X » d'après une rareté parfois fausse : dp7-SH3 est chromatique)
    tkeys = {cid: [k for k in dict.fromkeys((tkey[cid], card_key(c["en"], sp))) if k] if c["en"] else []
             for cid, c in cards.items()}
    tatk = {cid: frozenset(atk_key(x) for x in c["atk"]) for cid, c in cards.items()}

    def name_ok(cid, prod):
        if prod not in by_id:
            return False
        if not cards[cid]["en"]:
            return True  # carte sans nom anglais (séries françaises) : on garde le lien TCGdex
        return any(k in pkeys[prod] for k in tkeys[cid])

    def atk_clash(cid, prod):
        ca, cb = tatk[cid], cm_attacks(by_id[prod]["name"]) if prod in by_id else frozenset()
        return bool(ca and cb and not ca & cb)

    def soft_ok(cid, prod, any_exp=False):
        """Même carte malgré un nom différent : même extension que la série (any_exp : produit séparé d'une finition,
        rangé ailleurs, ex. Poké Ball d'Évolutions Prismatiques), et soit les mêmes attaques (« Empoleon » /
        « Empoleon LV.X »), soit un nom qui prolonge l'autre sans changer ex/GX/☆… (« Boss's Orders » /
        « Boss's Orders - Ghetsis »)."""
        c, p = cards[cid], by_id.get(prod)
        if not p or not c["en"] or (not any_exp and exp.get(c["sid"]) != p["idExpansion"]):
            return False
        a, b = tkey[cid], card_key(p["name"], sp, cm=True)
        wa, wb = a.split(), b.split()
        if not wa or not wb or wa[0] != wb[0]:
            return False
        ca, cb = tatk[cid], cm_attacks(p["name"])
        if ca and cb:
            # les crochets de Cardmarket contiennent aussi les talents (« Palkia LV.X [Restructure | Hydro Reflect] »)
            return ca <= cb
        return markers(a) == markers(b) and (b.startswith(a + " ") or a.startswith(b + " "))

    # 1. liens TCGdex vérifiés (produit de base et produits des finitions)
    claimed = defaultdict(set)  # produit -> signatures (nom, attaques) des cartes qui l'utilisent
    claimers = defaultdict(set)  # produit -> cartes qui l'utilisent
    sig = {cid: (tkey[cid], tatk[cid]) for cid in cards}

    def claim(prod, cid):
        claimed[prod].add(sig[cid])
        claimers[prod].add(cid)
    status = {}
    for cid, (base, btype, plan) in plans.items():
        if base and name_ok(cid, base) and not atk_clash(cid, base):
            status[cid] = "ok"
            claim(base, cid)
        elif base and name_ok(cid, base):
            status[cid] = "suspect"  # même nom, attaques toutes différentes (cartes inversées dans TCGdex)
        elif base:
            status[cid] = "mismatch"
        else:
            status[cid] = "missing"
        for f, (prod, side) in plan.items():
            if prod != base and name_ok(cid, prod):
                claim(prod, cid)

    def free(prod, cid):
        """Produit libre, ou déjà pris par des cartes identiques (même nom, mêmes attaques : réimpressions)."""
        return not claimed.get(prod) or claimed[prod] == {sig[cid]}

    def pname(i):
        return by_id[i]["name"]

    audit = {"fuzzy": []}  # cartes retrouvées par des attaques d'orthographe voisine

    def resolve(cids, pool):
        """Cartes en attente d'une même extension et d'un même nom -> {carte: produit} et cartes ambiguës.
        Attaques d'abord ; puis, entre produits indiscernables (même nom, mêmes attaques), ordre des numéros TCGdex
        <-> ordre des idProduct (Cardmarket crée les produits dans l'ordre de la série)."""
        got, amb, by_order = {}, [], []
        by_sig = defaultdict(list)
        for cid in cids:
            by_sig[tatk[cid]].append(cid)
        for S, K in sorted(by_sig.items(), key=lambda kv: sorted(kv[0])):
            K = sorted(K, key=lambda cid: (cards[cid]["sid"], cards[cid]["local"].zfill(6)))
            C = [i for i in pool if free(i, K[0])]
            if S:
                exact = [i for i in C if cm_attacks(pname(i)) == S]
                if exact:
                    C = exact
                else:
                    score = {i: len(S & cm_attacks(pname(i))) for i in C}
                    best = max(score.values(), default=0)
                    if best > 0:
                        C = [i for i in C if score[i] == best]
                    else:
                        # orthographes voisines (« Psychic Burst » / « Psyburst ») : la plus proche, si elle est nette
                        fz = {i: _atk_similarity(S, cm_attacks(pname(i))) for i in C if cm_attacks(pname(i))}
                        top = sorted(fz.values(), reverse=True)
                        if top and top[0] >= 0.75 and (len(top) == 1 or top[0] - top[1] >= 0.1):
                            C = [i for i in C if fz.get(i) == top[0]]
                            audit["fuzzy"] += K
                        else:
                            C = [i for i in C if not cm_attacks(pname(i))]
            if not C:
                continue
            # un produit libre plutôt qu'un produit déjà pris par une carte identique (même nom, mêmes attaques) :
            # sm10-198 (Marshadow full art) reçoit son produit libre, pas celui de sm10-82
            fresh = [i for i in C if not claimers.get(i, set()) - set(K)]  # libre, ou pris par ces cartes mêmes
            if fresh:
                C = fresh
            if len(C) == 1:
                for cid in K:
                    got[cid] = C[0]
                continue
            same = len({cm_attacks(pname(i)) for i in C}) == 1
            if len(K) == 1 and not same:
                amb += K
                continue
            for n, cid in enumerate(K):
                got[cid] = C[min(n, len(C) - 1)]
                by_order.append(cid)
        return got, amb, by_order

    # 2. liens faux -> relinkés ; cartes sans lien -> retrouvées (groupées par extension et par nom)
    audit.update({"relinked": {}, "recovered": {}, "kept": {}, "dropped": {}, "ambiguous": [], "ordered": [],
                  "missing_app": missing_app})
    fixes = {}
    order = sorted(plans, key=lambda cid: (cards[cid]["sid"], cards[cid]["local"].zfill(6)))
    groups = defaultdict(list)
    for cid in order:
        if status[cid] != "ok" and exp.get(cards[cid]["sid"]) and tkey[cid]:
            groups[(exp[cards[cid]["sid"]], tkey[cid])].append(cid)
    found = {}
    for (e, k), cids in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        keys = {kk for cid in cids for kk in tkeys[cid]}
        pool = sorted({i for kk in keys for i in by_exp_key[e].get(kk, [])})
        got, amb, by_order = resolve(cids, pool)
        for cid, prod in got.items():
            found[cid] = prod
            claim(prod, cid)
        audit["ordered"] += by_order
        audit["ambiguous"] += amb
    for cid in order:
        base = plans[cid][0]
        if cid in CM_CARD_EXTRA and CM_CARD_EXTRA[cid] in by_id:
            fixes[cid] = CM_CARD_EXTRA[cid]
            claim(fixes[cid], cid)
            if fixes[cid] != base:
                audit["relinked" if base else "recovered"][cid] = [base, fixes[cid]] if base else fixes[cid]
            continue
        if status[cid] == "ok":
            continue
        if cid in found:
            fixes[cid] = found[cid]
            if found[cid] != base:
                audit["relinked" if base else "recovered"][cid] = [base, found[cid]] if base else found[cid]
        elif status[cid] == "suspect" or (status[cid] == "mismatch" and soft_ok(cid, base) and free(base, cid)):
            fixes[cid] = base
            claim(base, cid)
            audit["kept"][cid] = base
        else:
            if status[cid] == "mismatch":
                audit["dropped"][cid] = base
            fixes[cid] = None

    # 2 bis. un produit pris par plusieurs numéros d'une même série, alors que l'extension a des produits libres au
    # nom exactement identique (attaques comprises) : TCGdex donne l'id de la carte courante à ses versions full art
    # ou secrètes (xy2-100, sm10-205) et celui de la holo à la non-holo (ecard1-40).
    # - jumeaux retenus : créés dans les 6 mois du produit partagé (ou tous deux de l'import d'origine, sans date) ;
    #   pas les réimpressions de decks ajoutées des années après (sm5-122, g1-RC29). Promos et versions « a » / « b »
    #   (alternatives ajoutées par lots en 2017) : toutes dates ;
    # - au moins autant de produits que de cartes, sinon rien ne change ;
    # - autant de produits que de cartes et des raretés différentes (pas des versions « a » / « b ») : rareté
    #   croissante <-> tendance croissante (Cardmarket a parfois créé les secrètes avant les communes : sm12-29 /
    #   sm12-237) ; sinon numéros croissants <-> idProduct croissants (Cardmarket crée les produits dans l'ordre de
    #   la série), la carte de base garde le plus petit.
    final = {cid: (fixes[cid] if cid in fixes else plans[cid][0]) for cid in fr_ids}
    users = defaultdict(list)
    for cid in fr_ids:
        if cid in CM_CARD_EXTRA:
            continue
        if final[cid] in by_id and name_ok(cid, final[cid]) and not atk_clash(cid, final[cid]):
            users[(cards[cid]["sid"], final[cid])].append(cid)
    used = set(claimed) | {p for p in final.values() if p}
    by_exp_name = defaultdict(list)
    for p in singles:
        by_exp_name[(p["idExpansion"], p["name"])].append(p["idProduct"])
    audit["split"] = {}
    audit["splitSkipped"] = []
    for (sid, prod), cids in sorted(users.items()):
        if len({cards[cid]["local"] for cid in cids}) < 2:
            continue
        p = by_id[prod]
        alt = any(re.search(r"\d[ab]$", cards[x]["local"]) for x in cids)
        any_date = alt or sid in PROMO_SETS
        d0 = _added(p)
        twins = [i for i in by_exp_name[(p["idExpansion"], p["name"])] if i != prod and i not in used
                 and (any_date or _close(d0, _added(by_id[i])))]
        if not twins:
            continue
        prods = sorted([prod] + twins)
        ordered = sorted(cids, key=lambda x: cards[x]["local"].zfill(6))
        if len(prods) < len(ordered):
            audit["splitSkipped"].append(f"{sid}:{prod}")
            continue
        trend = {i: num((guide or {}).get(i, {}).get("trend")) for i in prods}
        # versions « a » / « b » : TCGdex leur donne une rareté plus basse que celle de la carte d'origine
        if (not alt and len(prods) == len(ordered) and len({rarity_rank(cards[x]) for x in cids}) > 1
                and all(trend.values())):
            prods.sort(key=lambda i: (trend[i], i))
            ordered.sort(key=lambda x: (rarity_rank(cards[x]), cards[x]["local"].zfill(6)))
            audit.setdefault("splitByRarity", []).append(f"{sid}:{prod}")
        for cid, nb in zip(ordered, prods):
            if nb != final[cid]:
                fixes[cid] = nb
                used.add(nb)
                claim(nb, cid)
                audit["split"][cid] = [final[cid], nb]

    # 3. table finale (séries françaises et cartes de l'appli)
    out_cards = defaultdict(dict)
    st = Counter()
    rows = {}
    for cid in fr_ids:
        c = cards[cid]
        app = app_cards.get(cid, ())
        base, btype, plan = plans[cid]
        remap = None
        if cid in fixes and fixes[cid] != base:
            nb = fixes[cid]
            if base:
                remap = {base: nb}
                base, btype, plan = plan_card(c, remap=remap, app=app)
            else:
                base, btype, plan = plan_card(c, base_hint=nb, app=app)
            if not base:
                plan = {f: v for f, v in plan.items() if v[0] and name_ok(cid, v[0])}
        # chaque produit est vérifié par le nom (sauf celui gardé malgré une orthographe différente) ;
        # « Professor's Research - Professor Oak » (Poké Ball) vaut pour « Professor's Research »
        trusted = {fixes[cid]} if fixes.get(cid) else set()
        base_ok = bool(base) and (base in trusted or name_ok(cid, base))
        clean = {}
        for f, (prod, side) in plan.items():
            if prod in trusted or name_ok(cid, prod) or (prod != base and soft_ok(cid, prod, any_exp=True)):
                clean[f] = (prod, side)
            elif f == "reverse" and base_ok:
                clean[f] = (base, HOLO)  # produit reverse séparé faux (pl3-50) : annonces reverse de la carte
                st["reverse link replaced"] += 1
            else:
                st["finish link dropped"] += 1
        rows[cid] = (base, base_ok, clean, remap)
    # 1re édition / tampon : un produit à part n'est gardé que si aucune autre carte de la série ne s'en sert
    # (base2-17 : TCGdex donne à la 1re édition de la non-holo le produit de la holo base2-1) ; sinon le produit de
    # la carte (prix toutes éditions). Produit à part qui sert aussi une impression sans ce tampon (base1 : produits
    # « Shadowless », 1re édition et sans tampon) : 3e élément 1 = prix toutes éditions (prices.py -> 6e valeur).
    set_use = defaultdict(set)
    for cid, (base, _, clean, _) in rows.items():
        for f, (prod, _) in clean.items():
            if f not in ("firstEdition", "stamp"):
                set_use[(cards[cid]["sid"], prod)].add(cards[cid]["local"])
    for cid in fr_ids:
        c = cards[cid]
        base, base_ok, clean, remap = rows[cid]
        out = {}
        for f in FINISH_ORDER:
            if f not in clean:
                continue
            prod, side = clean[f]
            if f in ("firstEdition", "stamp") and prod != base:
                if set_use.get((c["sid"], prod), set()) - {c["local"]}:
                    st[f"{f} shared product replaced"] += 1
                    if not base_ok:
                        continue
                    prod, side = base, BASE
                elif _serves_unstamped(c, prod, f, remap):
                    out[f] = [prod, side, 1]
                    st[f"{f} all editions"] += 1
                    continue
            out[f] = [prod, side]
        if out:
            out_cards[c["sid"]][c["local"]] = out
            st["fr cards linked"] += 1
        else:
            st["fr cards unlinked"] += 1
    st["split"] = len(audit["split"])
    st["fr cards"] = len(fr_ids)
    st["app cards"] = len(app_cards)
    for k in ("relinked", "recovered", "kept", "dropped"):
        st[k] = len(audit[k])
    st["ambiguous"] = len(audit["ambiguous"])
    st["ordered"] = len(audit["ordered"])

    # séries : extension choisie ; extension -> série la plus représentative (pour le scellé)
    ncards = Counter(c["sid"] for c in cards.values())
    out_sets, exps = {}, defaultdict(list)
    for sid, s in sorted(sets.items()):
        if POCKET.match(sid):
            continue
        e = exp.get(sid)
        how = None
        if e:
            v = votes.get(sid) or {}
            how = "dec" if e == s["cm"] else "vote" if v.get(e) else "extra"
            exps[e].append(sid)
        out_sets[sid] = {k: v for k, v in (("exp", e), ("how", how), ("n", ncards.get(sid, 0)), ("tcgp", s["tcgp"]),
                                           ("fr", s["fr"]), ("en", s["en"]), ("rel", s["rel"]), ("serie", s["serie"]),
                                           ("code", s["code"])) if v is not None}
    rank = {"dec": 0, "vote": 1, "extra": 2}
    exp_set = {}
    for e, sids in exps.items():
        exp_set[str(e)] = min(sids, key=lambda sid: (rank[out_sets[sid]["how"]], -out_sets[sid]["n"], len(sid), sid))
    sp_fr = {en: fr for en, fr in sorted(species.items()) if en and fr}  # tous (noms identiques compris)
    cmmap = {"v": 1, "sets": out_sets, "exps": dict(sorted(exp_set.items(), key=lambda kv: int(kv[0]))),
             "asia": {str(e): r for e, r in sorted(asia_exps.items())},
             "cards": {sid: dict(sorted(v.items(), key=lambda kv: (kv[0].zfill(6), kv[0])))
                       for sid, v in sorted(out_cards.items())},
             "species": sp_fr, "stats": dict(sorted(st.items()))}
    audit = {k: (dict(sorted(v.items())) if isinstance(v, dict) else sorted(v)) for k, v in audit.items()}
    return cmmap, audit, {"sets": sets, "cards": cards}
