"""Construit data/decks.json : les meilleurs decks (méta actuelle + saisons passées) d'après
Limitless TCG, avec chaque carte reliée à TCGdex (nom français, image, cote Cardmarket).

Lancer depuis la racine du projet :  python tools/build_decks.py
  python tools/build_decks.py --relink   sans réseau : réapplique aux decks déjà construits les règles de liaison
                                         (sous-séries SV/TG/GG, énergies de base) avec le catalogue local
                                         (data/sets/) et les cotes locales (data/market/prices/)
Uniquement la bibliothèque standard, pour tourner aussi dans GitHub Actions.
"""
import csv
import glob
from html import unescape
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

LIMITLESS = "https://limitlesstcg.com"
TCGDEX = "https://api.tcgdex.net/v2"
OUT = "data/decks.json"

# (paramètre "time" de Limitless, libellé, ère, nombre d'archétypes gardés) : de l'ère XY à aujourd'hui
PERIODS = [
    ("1months", "Méta actuelle", "", 20),
    ("2526", "Saison 2025-2026", "Écarlate et Violet · Méga-Évolution", 15),
    ("2425", "Saison 2024-2025", "Écarlate et Violet", 15),
    ("2324", "Saison 2023-2024", "Écarlate et Violet", 15),
    ("2223", "Saison 2022-2023", "Épée et Bouclier · Écarlate et Violet", 15),
    ("2122", "Saison 2021-2022", "Épée et Bouclier", 15),
    ("2021", "Saison 2020-2021", "Épée et Bouclier", 15),
    ("1920", "Saison 2019-2020", "Soleil et Lune · Épée et Bouclier", 15),
    ("1819", "Saison 2018-2019", "Soleil et Lune", 15),
    ("1718", "Saison 2017-2018", "Soleil et Lune", 15),
    ("1617", "Saison 2016-2017", "XY · Soleil et Lune", 15),
    ("1516", "Saison 2015-2016", "XY", 15),
    ("1415", "Saison 2014-2015", "XY", 15),
]
# nombre de tournois (les plus gros de la saison) où l'on cherche la liste de chaque archétype
BIGGEST = 30

# Codes de séries que la correspondance automatique ne trouve pas.
CODE_OVERRIDES = {"PR-SV": "svp", "PR-SW": "swshp", "PR-SM": "smp", "PR-XY": "xyp", "PR-BLW": "bwp", "MEP": "mep",
                  "SP": "swshp", "SMP": "smp", "XYP": "xyp", "BWP": "bwp"}
# Les promos sont numérotées « 30 » chez Limitless et « SM30 » chez TCGdex.
PROMO_PREFIX = {"SP": "SWSH", "PR-SW": "SWSH", "SMP": "SM", "PR-SM": "SM", "XYP": "XY", "PR-XY": "XY", "BWP": "BW", "PR-BLW": "BW"}
# Sous-séries numérotées à part : Limitless garde le code de la série (« SHF SV118 »), TCGdex en fait une série
# (swsh4.5sv-SV118). Série TCGdex -> {préfixe du numéro: sous-série}.
SUBSETS = {"swsh4.5": {"SV": "swsh4.5sv"}, "sm115": {"SV": "sma"}, "swsh9": {"TG": "swsh9tg"},
           "swsh10": {"TG": "swsh10tg"}, "swsh11": {"TG": "swsh11tg"}, "swsh12": {"TG": "swsh12tg"},
           "swsh12.5": {"GG": "swsh12.5gg"}}
# Énergies de base : les 9 types (pas les énergies spéciales « Jet Energy », « Mist Energy »… : des cartes à réunir)
BASIC_ENERGY = re.compile(r"^(?:Basic )?(?:Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$", re.I)


def typo(s):
    """Apostrophe typographique dans les noms affichés (comme l'interface et le catalogue)."""
    return s.replace("'", "\u2019") if isinstance(s, str) else s


def subset_of(sid, number):
    """Série TCGdex de la carte : la sous-série quand le numéro en porte le préfixe (SHF SV118 -> swsh4.5sv)."""
    m = re.match(r"^([A-Z]+)\d", str(number or ""))
    return (SUBSETS.get(sid) or {}).get(m.group(1), sid) if m else sid


def is_basic_energy(kind, en):
    return kind == "energy" and bool(BASIC_ENERGY.match(str(en or "").strip()))

_cache = {}


def get(url, as_json=True, pause=0.0):
    if url in _cache:
        return _cache[url]
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Cardex deck builder (github.com/palentirlaboubou67/cardex)"})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read().decode("utf8")
            break
        except Exception as e:  # réseau capricieux : on réessaie
            if attempt == 2:
                print(f"  ! {url} : {e}", file=sys.stderr)
                _cache[url] = None
                return None
            time.sleep(2)
    if pause:
        time.sleep(pause)
    val = json.loads(body) if as_json else body
    _cache[url] = val
    return val


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def norm_num(s):
    return re.sub(r"^([A-Z]*)0+(?=\d)", r"\1", str(s).upper())


# ---------- Codes de séries (TWM, SVI…) → identifiants TCGdex ----------
def build_code_map():
    en_sets = get(f"{TCGDEX}/en/sets") or []
    by_name = {norm(s["name"]): s["id"] for s in en_sets}
    code_map = dict(CODE_OVERRIDES)
    ptcg = None
    for _ in range(4):
        ptcg = get("https://api.pokemontcg.io/v2/sets?pageSize=250&select=name,ptcgoCode")
        if ptcg:
            break
        _cache.pop("https://api.pokemontcg.io/v2/sets?pageSize=250&select=name,ptcgoCode", None)
        time.sleep(10)
    ptcg = ptcg or {}
    for s in ptcg.get("data", []):
        code, sid = s.get("ptcgoCode"), by_name.get(norm(s["name"]))
        if code and sid and code not in code_map:
            code_map[code] = sid
    return code_map, en_sets


def resolve_code(code, code_map, en_sets):
    """Codes inconnus (séries récentes) : on lit l'abréviation officielle des séries TCGdex, des plus récentes aux plus anciennes."""
    if code in code_map:
        return code_map[code]
    for s in reversed(en_sets):
        d = get(f"{TCGDEX}/en/sets/{s['id']}")
        abbr = (d or {}).get("abbreviation", {}).get("official")
        if abbr:
            code_map.setdefault(abbr, s["id"])
        if abbr == code:
            return s["id"]
    code_map[code] = None
    return None


# ---------- Noms de Pokémon anglais → français (pour les noms d'archétypes) ----------
def species_names():
    raw = get("https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv", as_json=False) or ""
    en, fr = {}, {}
    for r in csv.DictReader(io.StringIO(raw)):
        if r["local_language_id"] == "9":
            en[r["pokemon_species_id"]] = r["name"]
        elif r["local_language_id"] == "5":
            fr[r["pokemon_species_id"]] = r["name"]
    return {en[k]: fr[k] for k in en if k in fr}


def translate(name, en2fr):
    words = [en2fr.get(w, w) for w in name.split()]
    s = " ".join(words)
    s = re.sub(r"^Mega (\S+)", r"Méga-\1", s)
    s = re.sub(r" ex\b", "-ex", s)
    s = re.sub(r"^Rocket's (.+)$", r"\1 de la Team Rocket", s)
    s = re.sub(r"^(\w+)'s (.+)$", r"\2 de \1", s)
    return s


# ---------- Limitless ----------
def archetypes(period, top):
    html = get(f"{LIMITLESS}/decks?time={period}&format=standard", as_json=False, pause=0.5) or ""
    table = html[html.find('<table class="data-table'):]
    out = []
    for row in re.findall(r"<tr>(.*?)</tr>", table, re.S):
        m = re.search(r'href="/decks/(\d+)">(.*?)<span class="annotation">(.*?)</span>', row, re.S)
        share = re.search(r"<td>([\d.]+)%</td>", row)
        if not m:
            continue
        name = unescape(re.sub(r"\s+", " ", f"{m.group(2)} {m.group(3)}").strip())
        out.append({"id": int(m.group(1)), "name": name, "share": float(share.group(1)) if share else None})
        if len(out) >= top:
            break
    return out


def best_list(arch_id, period):
    """Méta actuelle : la liste la mieux classée parmi les derniers résultats de l'archétype.
    (La page d'un archétype ignore la saison : pour les saisons passées, voir season_lists.)"""
    html = get(f"{LIMITLESS}/decks/{arch_id}", as_json=False, pause=0.5) or ""
    best, event = None, ""
    for row in re.findall(r"<tr>(.*?)</tr>", html, re.S)[:60]:
        head = re.search(r'class="sub-heading".*?<a href="/tournaments/\d+">(.*?)</a>', row, re.S)
        if head:
            event = re.sub(r"^\d+\w* \w+ \d{4} - ", "", head.group(1)).strip()
            continue
        lst = re.search(r'href="/decks/list/(\d+)"', row)
        place = re.search(r"<td>(\d+)(?:st|nd|rd|th)</td>", row)
        if lst and place and (best is None or int(place.group(1)) < best[0]):
            best = (int(place.group(1)), lst.group(1), event)
    return best


def season_lists(period, biggest=BIGGEST):
    """Saisons passées : meilleure place de chaque archétype dans les plus gros tournois de la saison."""
    html = get(f"{LIMITLESS}/tournaments?time={period}&format=standard&show=100", as_json=False, pause=0.5) or ""
    events = []
    for m in re.finditer(r'<tr data-date="[^"]*"[^>]*data-name="([^"]*)"[^>]*data-players="(\d+)"[^>]*>(.*?)</tr>', html, re.S):
        t = re.search(r'href="/tournaments/(\d+)"', m.group(3))
        if t:
            events.append((int(m.group(2)), t.group(1), m.group(1)))
    best = {}
    for _, tid, name in sorted(events, reverse=True)[:biggest]:
        page = get(f"{LIMITLESS}/tournaments/{tid}", as_json=False, pause=0.5) or ""
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
            place = re.search(r"<td>(\d+)</td>", row)
            arch = re.search(r'href="/decks/(\d+)"', row)
            lst = re.search(r'href="/decks/list/(\d+)"', row)
            if place and arch and lst:
                a, pl = int(arch.group(1)), int(place.group(1))
                if a not in best or pl < best[a][0]:
                    best[a] = (pl, lst.group(1), name)
    return best


def decklist(list_id):
    html = get(f"{LIMITLESS}/decks/list/{list_id}", as_json=False, pause=0.5) or ""
    cards = []
    for m in re.finditer(r'<div class="decklist-card"(.*?)</a>', html, re.S):
        blk = m.group(1)
        attr = lambda k: (re.search(rf'data-{k}="([^"]*)"', blk) or [None, ""])[1]
        count = re.search(r'class="card-count">(\d+)<', blk)
        num = attr("number")
        if attr("set") in PROMO_PREFIX and num.isdigit():
            num = PROMO_PREFIX[attr("set")] + num
        cards.append({"set": attr("set"), "number": num, "type": attr("type"),
                      "en": unescape(attr("name")), "count": int(count.group(1)) if count else 1})
    return cards


# ---------- TCGdex ----------
def tcgdex_card(set_id, number):
    for lang in ("fr", "en"):
        s = get(f"{TCGDEX}/{lang}/sets/{set_id}")
        if not s:
            continue
        for c in s.get("cards", []):
            if norm_num(c["localId"]) == norm_num(number):
                return c, lang
    return None, None


def price_of(card_id):
    for lang in ("fr", "en"):
        full = get(f"{TCGDEX}/{lang}/cards/{card_id}")
        cm = (full or {}).get("pricing", {}).get("cardmarket") or {}
        # La cote « normale » de vieilles Ultra Rares est parfois faussée (cartes gradées ?) :
        # on garde la plus basse des cotes tendance / moyenne 30 jours, normale ou holo.
        vals = [cm.get(k) for k in ("trend", "trend-holo", "avg30", "avg30-holo")]
        vals = [v for v in vals if isinstance(v, (int, float)) and v > 0]
        if vals:
            return round(min(vals), 2), full
        if full:
            return None, full
    return None, None


# ---------- --relink : sans réseau ----------
def _local_catalogue(root="."):
    """{setId: {numéro normalisé: (localId, nom, i, dex, serie)}} depuis data/sets/."""
    out = {}
    for p in glob.glob(os.path.join(root, "data", "sets", "*.json")):
        j = json.load(open(p, encoding="utf8"))
        out[j["id"]] = {norm_num(c["l"]): (c["l"], c["n"], c["i"], c.get("d") or None, j.get("serie"))
                        for c in j.get("cards", [])}
    return out


def _local_price(cid, root="."):
    """Cote Cardmarket locale (data/market/prices/) : la plus basse des tendances / moyennes 30 j, normale ou holo,
    comme price_of() ; None sans fichier."""
    sid, lid = cid[:cid.rfind("-")], cid[cid.rfind("-") + 1:]
    p = os.path.join(root, "data", "market", "prices", f"{sid}.json")
    try:
        row = json.load(open(p, encoding="utf8"))["c"].get(lid) or {}
    except (OSError, ValueError, KeyError):
        return None
    vals = [v for f in ("normal", "holo") for v in ((row.get(f) or [None] * 4)[0], (row.get(f) or [None] * 4)[3])
            if isinstance(v, (int, float)) and v > 0]
    return round(min(vals) / 100, 2) if vals else None


def relink(path=OUT, root="."):
    """Réapplique les règles de liaison aux decks existants, sans réseau : énergies de base (9 types), sous-séries
    (SHF SV118 -> swsh4.5sv-SV118, avec nom français, image, Pokédex et cote locales), apostrophes ; le prix total des
    decks modifiés est recalculé."""
    d = json.load(open(path, encoding="utf8"))
    cat = _local_catalogue(root)
    code_sid = {}  # code Limitless -> série TCGdex, d'après les lignes déjà reliées
    for p in d["periods"]:
        for k in p["decks"]:
            for c in k["cards"]:
                if c.get("id") and " " in (c.get("ref") or ""):
                    code_sid.setdefault(c["ref"].split(" ")[0], c["id"][:c["id"].rfind("-")])
    n_basic = n_link = 0
    for p in d["periods"]:
        for k in p["decks"]:
            changed = False
            k["name"] = typo(k.get("name"))
            for c in k["cards"]:
                c["name"] = typo(c.get("name"))
                b = is_basic_energy(c.get("type"), c.get("en"))
                if b != c.get("basicEnergy"):
                    c["basicEnergy"] = b
                    n_basic += 1
                if c.get("id") or " " not in (c.get("ref") or ""):
                    continue
                code, num = c["ref"].split(" ", 1)
                sid = code_sid.get(code) or CODE_OVERRIDES.get(code)
                sid = subset_of(sid, num) if sid else None
                hit = (cat.get(sid) or {}).get(norm_num(num)) if sid else None
                if not hit:
                    continue
                lid, name, i, dex, serie = hit
                c["id"] = f"{sid}-{lid}"
                c["name"] = typo(name)
                c["image"] = (f"https://assets.tcgdex.net/fr/{serie}/{sid}/{lid}" if i == 1
                              else i if isinstance(i, str) else None)
                c["dex"] = dex
                c["price"] = _local_price(c["id"], root)
                n_link += 1
                changed = True
            if changed:
                k["price"] = round(sum((x["price"] or 0) * x["count"] for x in k["cards"]), 2)
    json.dump(d, open(path, "w", encoding="utf8", newline="\n"), ensure_ascii=False, separators=(",", ":"))
    print(f"-> {path} : {n_link} cartes reliées, {n_basic} drapeaux « énergie de base » corrigés")


def main():
    if "--relink" in sys.argv[1:]:
        relink()
        return
    code_map, en_sets = build_code_map()
    en2fr = species_names()
    periods = []
    for period, label, era, top in PERIODS:
        print(f"== {label}")
        decks = []
        past = None if period == "1months" else season_lists(period)
        for a in archetypes(period, top):
            best = best_list(a["id"], period) if past is None else past.get(a["id"])
            if not best:
                continue
            cards = []
            for c in decklist(best[1]):
                sid = resolve_code(c["set"], code_map, en_sets) if c["set"] else None
                sid = subset_of(sid, c["number"]) if sid else None
                tc, lang = tcgdex_card(sid, c["number"]) if sid else (None, None)
                price, full = price_of(tc["id"]) if tc else (None, None)
                basic = is_basic_energy(c["type"], c["en"])
                cards.append({
                    "id": tc["id"] if tc else None,
                    "name": typo((tc or {}).get("name") if lang == "fr" else translate(c["en"], en2fr)),
                    "en": c["en"], "count": c["count"], "type": c["type"],
                    "image": (tc or {}).get("image"), "price": price,
                    "dex": (full or {}).get("dexId"), "basicEnergy": basic,
                    "ref": f"{c['set']} {c['number']}",
                })
            total = round(sum((x["price"] or 0) * x["count"] for x in cards), 2)
            decks.append({
                "id": f"{period}-{a['id']}", "archetype": a["id"],
                "name": typo(translate(a["name"], en2fr)), "en": a["name"], "share": a["share"],
                "placing": best[0], "event": best[2], "list": f"{LIMITLESS}/decks/list/{best[1]}",
                "price": total, "cards": cards,
            })
            print(f"  {a['name']:<32} {sum(x['count'] for x in cards):>3} cartes  {total:>8.2f} €  "
                  f"(non reliées : {sum(1 for x in cards if not x['id'])})")
        periods.append({"id": period, "label": label, "era": era, "current": period == "1months", "decks": decks})
    if not any(p["decks"] for p in periods if p["current"]):
        sys.exit("Aucun deck récupéré pour la méta actuelle : data/decks.json n'est pas modifié.")
    json.dump({"updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "source": "Limitless TCG + TCGdex", "periods": periods},
              open(OUT, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
