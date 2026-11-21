"""Construit data/decks.json : les meilleurs decks (méta actuelle + saisons passées) d'après
Limitless TCG, avec chaque carte reliée à TCGdex (nom français, image, cote Cardmarket).

Lancer depuis la racine du projet :  python tools/build_decks.py
Uniquement la bibliothèque standard, pour tourner aussi dans GitHub Actions.
"""
import csv
import io
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

LIMITLESS = "https://limitlesstcg.com"
TCGDEX = "https://api.tcgdex.net/v2"
OUT = "data/decks.json"

# (paramètre "time" de Limitless, libellé, nombre d'archétypes gardés)
PERIODS = [
    ("1months", "Méta actuelle", 12),
    ("2526", "Saison 2025-2026", 6),
    ("2425", "Saison 2024-2025", 6),
    ("2324", "Saison 2023-2024", 6),
    ("2223", "Saison 2022-2023", 5),
]

# Codes de séries que la correspondance automatique ne trouve pas.
CODE_OVERRIDES = {"PR-SV": "svp", "PR-SW": "swshp", "PR-SM": "smp", "PR-XY": "xyp", "PR-BLW": "bwp", "MEP": "mep"}

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
    ptcg = get("https://api.pokemontcg.io/v2/sets?pageSize=250&select=name,ptcgoCode") or {}
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
        name = re.sub(r"\s+", " ", f"{m.group(2)} {m.group(3)}").strip()
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


def season_lists(period, biggest=10):
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
        cards.append({"set": attr("set"), "number": attr("number"), "type": attr("type"),
                      "en": attr("name"), "count": int(count.group(1)) if count else 1})
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
        p = cm.get("trend") or cm.get("avg")
        if isinstance(p, (int, float)) and p > 0:
            return round(p, 2), full
        if full:
            return None, full
    return None, None


def main():
    code_map, en_sets = build_code_map()
    en2fr = species_names()
    periods = []
    for period, label, top in PERIODS:
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
                tc, lang = tcgdex_card(sid, c["number"]) if sid else (None, None)
                price, full = price_of(tc["id"]) if tc else (None, None)
                basic = c["type"] == "energy" and bool(re.match(r"^(Basic )?\w+ Energy$", c["en"])) and "Special" not in c["en"]
                cards.append({
                    "id": tc["id"] if tc else None,
                    "name": (tc or {}).get("name") if lang == "fr" else translate(c["en"], en2fr),
                    "en": c["en"], "count": c["count"], "type": c["type"],
                    "image": (tc or {}).get("image"), "price": price,
                    "dex": (full or {}).get("dexId"), "basicEnergy": basic,
                    "ref": f"{c['set']} {c['number']}",
                })
            total = round(sum((x["price"] or 0) * x["count"] for x in cards), 2)
            decks.append({
                "id": f"{period}-{a['id']}", "archetype": a["id"],
                "name": translate(a["name"], en2fr), "en": a["name"], "share": a["share"],
                "placing": best[0], "event": best[2], "list": f"{LIMITLESS}/decks/list/{best[1]}",
                "price": total, "cards": cards,
            })
            print(f"  {a['name']:<32} {sum(x['count'] for x in cards):>3} cartes  {total:>8.2f} €  "
                  f"(non reliées : {sum(1 for x in cards if not x['id'])})")
        periods.append({"id": period, "label": label, "current": period == "1months", "decks": decks})
    if not any(p["decks"] for p in periods if p["current"]):
        sys.exit("Aucun deck récupéré pour la méta actuelle : data/decks.json n'est pas modifié.")
    json.dump({"updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "source": "Limitless TCG + TCGdex", "periods": periods},
              open(OUT, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
