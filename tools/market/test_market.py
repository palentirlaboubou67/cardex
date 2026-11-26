"""Tests de tools/build_market.py et tools/market/ (bibliothèque standard) :

  python tools/market/test_market.py            tests unitaires + bout en bout hors ligne (cache .cache/mk/ requis)

Bout en bout : construit tout dans un dossier temporaire depuis le cache, puis vérifie qu'une source cassée
(guide tronqué) fait sortir en erreur sans rien modifier, et que l'historique ne reçoit qu'un point par guide.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)

from market import hist, names, prices, sealed  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  ÉCHEC ") + msg)
    if not cond:
        FAILS.append(msg)


def test_prices():
    print("cotes des cartes")
    g = {"trend": 0.02, "avg7": 19.83, "avg30": 84.26, "avg1": 13.9, "low": 5.99}
    check(prices.card_values(g, 0)[0] == 1983, "tendance cassée remplacée par la moyenne 7 j (neo2-10)")
    g = {"trend": 0, "avg": None, "trend-holo": 1.63, "avg30-holo": 1.85, "avg7-holo": 1.33}
    check(prices.card_values(g, 3)[0] == 163, "produit séparé Master Ball lu dans les champs -holo")
    check(prices.card_values(g, 0) == [None, None, None, None, None] or prices.card_values(g, 0) is None,
          "champs de base vides : pas de prix inventé")
    g = {"trend": 1.21, "trend-holo": 0}
    check(prices.card_values(g, 2)[0] == 121, "Cosmo de type holo : champs de base")
    g = {"trend": None, "avg30": 2.5, "avg7": None}
    check(prices.card_values(g, 0)[0] == 250, "sans tendance : moyenne 30 j")


def test_sealed():
    print("scellé : types, langues, prix")
    k = sealed.kind
    check(k("Perfect Order Build & Battle Box Display", 1015) == "case", "présentoir de Boîtiers = carton")
    check(k("Celebrations Mini Tins: 8-Tin Display Box", 1014) == "case", "présentoir de Mini Tins = carton")
    check(k("Back to School 2023 Pencil Case", 1014) == "tin", "trousse métal = pokébox")
    check(k("151 Booster Bundle Display", 53) == "case", "présentoir de bundles = carton")
    check(k("Detective Pikachu: Charizard GX Case File", 1015) != "case", "Case File n'est pas un carton")
    check(k("Detective Pikachu On the Case Collection", 1015) != "case", "On the Case n'est pas un carton")
    check(k("Evolving Skies 6 Booster Box Case", 53) == "case", "carton de 6 displays")
    check(k("Paldean Fates Booster Box (18 Boosters)", 53) == "halfbox", "demi-display")
    check(k("Fall 2016 Collector Chest", 1014) == "coffret", "coffre de collection = coffret")
    check(sealed.lang_hint("Trick or Trade BOOster Bundle (120 Packs)") == "int", "Trick or Trade = international")
    check(sealed.lang_hint("Mario Pikachu Special Box") == "ja", "Special Box (Pokémon Center Japon) = japonais")
    check(sealed.lang_hint('WCD 2025: Yuya Okita "JP Raging Bolt"') == "int", "deck des Mondiaux = international")
    check(sealed.lang_hint("Korean Terastal Festival ex Binder Set") == "ko", "coréen dans une extension japonaise")
    eur, low = sealed.sealed_price({"trend": 2239.24, "avg": 2103, "low": 100000})
    check(eur == 2239.24 and low is None, "Phantom Forces : « dès 100 000 € » masqué")
    eur, low = sealed.sealed_price({"trend": None, "avg": 12.5, "low": 10})
    check(eur == 12.5 and low == 10, "sans tendance : moyenne de vente confirmée par l'offre")
    eur, low = sealed.sealed_price({"trend": 0, "avg": None, "low": 5, "trend-holo": 3.93})
    check(eur is None and low is None, "jamais les champs -holo pour le scellé")
    sp = sealed.sealed_price
    check(sp({"trend": 0.02, "avg": None, "low": None})[0] is None, "tendance 0,02 € (plancher) : pas de prix")
    check(sp({"trend": 0.02, "avg": 69.95, "low": None})[0] is None,
          "plancher + moyenne seule non confirmée (display EX Émeraude à 69,95 €) : pas de prix")
    check(sp({"trend": 0.02, "avg": 1.91, "low": 0.99})[0] == 1.91, "plancher + moyenne confirmée par l'offre : moyenne")
    check(sp({"trend": 24261, "avg": 150, "low": None})[0] == 24261,
          "pas de garde tendance/moyenne générale (display Collection Légendaire 24 261 €)")
    check(sp({"trend": 43.41, "avg": 1.27, "low": 0.6}, "booster", "2026-05-22")[0] == 1.27,
          "pic d'un booster récent (fun pack à 43,41 €) : moyenne")
    check(sp({"trend": 447.47, "avg": 839.96, "low": 1.7}, "booster", "2022-09-09")[0] is None,
          "pic d'un booster récent, moyenne aussi aberrante : pas de prix")
    check(sp({"trend": 7.15, "avg": 6.53, "low": 2}, "booster", "2025-09-26")[0] == 7.15,
          "booster récent sans pic : tendance")
    check(sp({"trend": 2.01, "avg": 1.87, "low": 0.4}, "booster", "2025-03-28")[0] == 2.01,
          "petit écart (2,01 € pour 0,40 € d'offre) : tendance gardée")
    check(sp({"trend": 182.82, "avg": 200, "low": 9.95}, "booster", "2008-11-01")[0] == 182.82,
          "booster ancien (offre la moins chère peu fiable) : tendance gardée")
    check(sp({"trend": 5292.92, "avg": 100, "low": 250}, "coffret", None)[0] == 5292.92,
          "coffret Mario Pikachu : tendance gardée")
    check(sealed.lang_hint("High-Class Deck Double Box: Gengar VMAX & Inteleon VMAX") == "ja",
          "High Class Deck = japonais (même dans l'extension 1645)")
    check(sealed.lang_hint("Silver Lance & Jet Black Spirit Expansion Pack Special Edition") == "ja",
          "Silver Lance / Jet-Black Spirit = japonais")
    check(sealed.lang_hint("Crimson Invasion Booster Box") is None, "Crimson Invasion reste sans indice (série internationale)")


def test_names():
    print("noms français")
    sp = {"Charizard": "Dracaufeu", "Iron Leaves": "Vert-de-Fer", "Milotic": "Milobellus", "Pikachu": "Pikachu",
          "Zekrom": "Zekrom", "Vulpix": "Goupix", "Gyarados": "Léviator", "Magikarp": "Magicarpe", "Moltres": "Sulfura",
          "Garchomp": "Carchacrok", "Palkia": "Palkia", "Gengar": "Ectoplasma", "Crobat": "Nostenfer",
          "Victini": "Victini"}
    sets = {"sv03.5": ("151", "151"), "sv05": ("Forces Temporelles", "Temporal Forces"),
            "swsh2": ("Clash des Rebelles", "Rebel Clash"), "bw8": ("Tempète Plasma", "Plasma Storm"),
            "swsh3.5": ("La Voie du Maître", "Champion's Path"), "hgss1": ("HeartGold SoulSilver", "HeartGold SoulSilver")}
    n = names.Namer(sp, sets)
    cases = [
        (("151 Elite Trainer Box", "etb", "sv03.5"), "Coffret Dresseur d'Élite – 151"),
        (("Temporal Forces Iron Leaves Elite Trainer Box", "etb", "sv05"),
         "Coffret Dresseur d'Élite – Forces Temporelles (Vert-de-Fer)"),
        (("Rebel Clash Booster (6 Cards)", "booster", "swsh2"), "Booster (6 cartes) – Clash des Rebelles"),
        (("Kanto Power Mini Tins: Charizard Empty Tin", "tin", None), "Mini Tin Dracaufeu (Kanto Power, vide)"),
        (("Champion’s Path: Stow-on-Side Special Pin Collection", "coffret", "swsh3.5"),
         "Coffret pin's – La Voie du Maître (Stow-on-Side)"),
        (("Plasma Storm: Plasma Claw Theme Deck", "deck", "bw8"), "Deck à thème – Tempête Plasma (Plasma Claw)"),
        (("151 10 Elite Trainer Box Case", "case", "sv03.5"), "Carton de 10 Coffrets Dresseur d'Élite – 151"),
        (("2007 Spring Collector's Tins: Milotic Tin (North American)", "tin", None),
         "Pokébox de collection Milobellus (printemps 2007, version nord-américaine)"),
        (("HeartGold & SoulSilver Booster Box", "box", "hgss1"), "Display – HeartGold SoulSilver"),
        (("Tag Team Tins: Pikachu & Zekrom GX Tin", "tin", None), "Pokébox Pikachu et Zekrom-GX (Tag Team)"),
        (("Pokémon Card 151 Booster Box Case", "case", None, True), "Carton de displays – Pokémon Card 151"),
        (("Pokémon Card Gym Promo MEGA Vol. 2 Booster (1 Card)", "booster", None, True),
         "Booster (1 carte) – Pokémon Card Gym Promo MEGA Vol. 2"),
        (("EX Deck Tins: Fire Red and Leaf Green Tin", "tin", None), "Pokébox Rouge Feu et Vert Feuille (EX Deck)"),
        (("Legendary Battle Deck: Moltres", "deck", None), "Deck de combat légendaire Sulfura"),
        (("Garchomp vs Charizard SP Deck Kit", "deck", None), "Kit de decks SP Carchacrok contre Dracaufeu"),
        (("Cyrus / Klara Premium Tournament Collection Display", "case", None),
         "Présentoir de coffrets Premium Tournoi Cyrus / Klara"),
        (("Origin Forme Palkia VSTAR Premium Collection", "coffret", None), "Coffret Premium Palkia Originel VSTAR"),
        (("30th Celebration Charizard Collector’s Figure Box", "coffret", None, True),
         "Coffret 30th Celebration Dracaufeu Collector's Figure"),
        (("The Glory of Team Rocket Collector's Set", "coffret", None, True), "Coffret The Glory of Team Rocket Collector's Set"),
        (("MEGA Starter Set Mega Gengar ex", "deck", None, True), "Set de démarrage Méga-Ectoplasma-ex (MEGA)"),
        (("Fire Charizard GX Deck", "deck", None, True), "Deck Dracaufeu-GX (type Feu)"),
        (("Shiny Star V: Crobat V Shiny Box", "coffret", None, True), "Coffret Nostenfer V chromatique (Shiny Star V)"),
        (("Black & White Victini Box", "coffret", None), "Coffret Noir et Blanc Victini"),
    ]
    for args, want in cases:
        got = n.name(args[0], args[1], args[2], asia=len(args) > 3)
        check(got == want, f"{args[0]!r} -> {got!r}" + ("" if got == want else f" (attendu {want!r})"))
    check(n.set_fr("bw8") == "Tempête Plasma", "faute TCGdex « Tempète » corrigée")


def test_hist():
    print("historique")
    d = tempfile.mkdtemp(prefix="mk-hist-")
    try:
        H = hist.History(d)
        for day, v in (("2024-12-30", 100), ("2026-11-01", 200), ("2026-11-02", 200), ("2026-11-03", 210),
                       ("2026-11-04", 210), ("2026-11-25", 210)):
            H.add(day, {"1": v, "2": v * 2})
        H.add("2026-11-25", {"3": 999})
        H.assign({"1": (100, "box"), "2": (100, "etb"), "3": (200, "tin"), "4": (200, "tin")})
        check(H.shard == {"1": "100", "2": "100", "3": "200"}, "fichiers par extension, rien pour un produit sans prix")
        H.compact(date(2026, 11, 25))
        files, n = H.prepare()
        H.commit(files)
        h = json.load(open(os.path.join(d, "100.json"), encoding="utf8"))
        check(h["d"][0] == "2024-12-30" and h["p"]["1"][-1] == 210, "points gardés, dernier point du jour")
        s = hist.summary(H.points("1"), date(2026, 11, 25))
        check(s["chg"] == "2026-11-03", f"date depuis laquelle le prix ne bouge pas : {s['chg']}")
        check(s["first"] == 1.0 and s["since"] == "2024-12-30" and s["max"] == 2.1, "premier prix, date, maximum")
        check(s["c7"] is None, "pas de variation 7 j sans point à ±2 jours")
        # le même jour relu deux fois : un seul point
        H2 = hist.History(d)
        H2.add("2026-11-25", {"1": 210})
        files, _ = H2.prepare()
        check(not files, "relire le même guide ne modifie rien")
        # compactage hebdomadaire : rien ne se perd
        H3 = hist.History(tempfile.mkdtemp(prefix="mk-hist-"))
        H3.add("2025-06-02", {"9": 50})          # lundi
        H3.add("2025-06-04", {"9": 60, "8": 70})  # même semaine : « 8 » n'a qu'un point
        H3.assign({"9": (5, "box"), "8": (5, "box")})
        H3.compact(date(2026, 11, 25))
        check(H3.points("8") == [("2025-06-02", 70)] and H3.points("9") == [("2025-06-02", 50)],
              "compactage : un point par semaine, valeur de chaque produit gardée")
        # valeurs fausses : 0,02 € jamais relu, jour recalculé (correction), colonne retirée si tout était faux
        d5 = tempfile.mkdtemp(prefix="mk-hist-")
        with open(os.path.join(d5, "7.json"), "w", encoding="utf8") as f:
            json.dump({"d": ["2026-11-01", "2026-11-02"], "p": {"70": [2, 2], "71": [2, 500], "72": [4300, 120]}}, f)
        with open(os.path.join(d5, "8.json"), "w", encoding="utf8") as f:
            json.dump({"d": ["2026-11-01"], "p": {"80": [2]}}, f)
        H5 = hist.History(d5)
        check(H5.points("71") == [("2026-11-02", 500)] and not H5.points("70"), "0,02 € n'est jamais relu")
        H5.set_day("2026-11-01", {"72": 130}, ["70", "71", "72"])
        H5.set_day("2026-11-02", {}, ["72"])
        check(H5.points("72") == [("2026-11-01", 130)], "jour recalculé : valeur remplacée ou retirée")
        H5.compact(date(2026, 11, 25))
        files, _ = H5.prepare()
        H5.commit(files)
        h5 = json.load(open(os.path.join(d5, "7.json"), encoding="utf8"))
        check(set(h5["p"]) == {"71", "72"} and not os.path.exists(os.path.join(d5, "8.json")),
              "colonne et fichier qui n'avaient que des valeurs fausses retirés, rien d'autre")
        check(H5.shard_of("70") is None and H5.shard_of("71") == "7", "fichier d'historique seulement avec des points")
        s5 = hist.summary([("2026-10-01", 2), ("2026-11-24", 100), ("2026-11-25", 110)], date(2026, 11, 25))
        check(s5["first"] == 1.0 and s5["since"] == "2026-11-24", "variations : jamais le plancher comme base")
        shutil.rmtree(d5, ignore_errors=True)
        # ne rétrécit jamais
        H4 = hist.History(d)
        H4.series["2"] = {}
        try:
            H4.prepare()
            check(False, "un fichier qui perdrait un produit est refusé")
        except ValueError:
            check(True, "un fichier qui perdrait un produit est refusé")
    finally:
        shutil.rmtree(d, ignore_errors=True)


def run(args, **kw):
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    return subprocess.run([sys.executable, "-P", os.path.join(TOOLS, "build_market.py")] + args, env=env,
                          capture_output=True, text=True, encoding="utf-8", **kw)


def test_end_to_end():
    print("bout en bout (hors ligne, depuis le cache)")
    cache = os.path.join(ROOT, ".cache", "mk")
    need = [os.path.join(cache, "cm", f) for f in ("price_guide_6.json", "products_nonsingles_6.json",
                                                   "products_singles_6.json")] + [os.path.join(cache, "cards-database.zip")]
    if not all(os.path.exists(p) for p in need):
        print("  (cache absent : test ignoré)")
        return
    out = tempfile.mkdtemp(prefix="mk-out-")
    try:
        r = run(["--weekly", "--offline", "--out", out])
        check(r.returncode == 0, "hebdomadaire + quotidien : code 0" + ("" if r.returncode == 0 else "\n" + r.stderr[-800:]))
        files = sorted(os.listdir(os.path.join(out, "prices")))
        check(len(files) > 150, f"{len(files)} fichiers de cotes")
        p = json.load(open(os.path.join(out, "prices", "sv03.5.json"), encoding="utf8"))
        check(p["v"] == 1 and len(p["d"]) == 10 and all(len(v) == 5 for e in p["c"].values() for v in e.values()),
              "format prices/<série>.json : v, d, 5 valeurs en centimes")
        s = json.load(open(os.path.join(out, "sealed.json"), encoding="utf8"))
        keys = {"id", "k", "l", "e", "sid", "set", "rel", "fr", "n", "img", "eur", "low", "c7", "c30", "c90", "c365",
                "first", "since", "max", "chg", "h"}
        check(all(set(x) == keys for x in s["products"]), "format sealed.json : tous les champs, partout")
        check(all(x["fr"] for x in s["products"]) and {x["l"] for x in s["products"]} <= {"int", "ja"},
              "noms français jamais vides, langues int/ja seulement")
        m1 = json.load(open(os.path.join(out, "meta.json"), encoding="utf8"))
        hist0 = {f: open(os.path.join(out, "hist", f), "rb").read() for f in os.listdir(os.path.join(out, "hist"))}
        # même guide : pas de nouveau point d'historique
        sealed0 = open(os.path.join(out, "sealed.json"), "rb").read()
        r = run(["--offline", "--out", out])
        check(r.returncode == 0 and "pas de nouveau point" in r.stdout, "même createdAt : pas de nouveau point")
        hist1 = {f: open(os.path.join(out, "hist", f), "rb").read() for f in os.listdir(os.path.join(out, "hist"))}
        check(hist0 == hist1, "même createdAt : historique inchangé")
        check(open(os.path.join(out, "sealed.json"), "rb").read() == sealed0 and "sealed.json inchangé" in r.stdout,
              "même guide : sealed.json identique (updatedAt gardé, même hachage dans le manifeste)")
        check("table TCGdex -> Cardmarket refaite" not in r.stdout, "table à jour : pas reconstruite par le quotidien")
        cmj = json.load(open(os.path.join(out, "cm-map.json"), encoding="utf8"))
        check(isinstance(cmj.get("unlinked"), list), f"cm-map.json : {len(cmj.get('unlinked') or [])} cartes sans lien notées")
        app = {}
        for sp in os.listdir(os.path.join(ROOT, "data", "sets")):
            j = json.load(open(os.path.join(ROOT, "data", "sets", sp), encoding="utf8"))
            for c in j.get("cards", []):
                app[f"{j['id']}-{c['l']}"] = c.get("f") or []
        extra = [(sid, loc, f) for sid in os.listdir(os.path.join(out, "prices"))
                 for loc, fins in json.load(open(os.path.join(out, "prices", sid), encoding="utf8"))["c"].items()
                 for f in fins if f"{sid[:-5]}-{loc}" not in app or (f in ("stamp", "firstEdition")
                                                                    and f not in app[f"{sid[:-5]}-{loc}"])]
        check(not extra, f"cotes : seulement les cartes de l'appli, 1re édition / tampon là où elles sont listées {extra[:3]}")
        same = bad_same = 0
        for sid, cards in cmj["cards"].items():
            pf = os.path.join(out, "prices", f"{sid}.json")
            if not os.path.exists(pf):
                continue
            c = json.load(open(pf, encoding="utf8"))["c"]
            for loc, fins in cards.items():
                base = fins.get("normal") or fins.get("holo")
                for f in ("firstEdition", "stamp"):
                    if f in fins and base and fins[f] == base and f in c.get(loc, {}):
                        same += 1
                        b = c[loc].get("normal" if "normal" in fins and fins["normal"] == base else "holo")
                        bad_same += c[loc][f] != b
        check(same > 100 and not bad_same, f"1re édition sans produit à part : tableau identique à la carte de base ({same})")
        # carte de l'appli inconnue de la table : le quotidien refait la table
        cmj2 = dict(cmj, unlinked=[])
        with open(os.path.join(out, "cm-map.json"), "w", encoding="utf8") as f:
            json.dump(cmj2, f, ensure_ascii=False)
        r = run(["--offline", "--out", out])
        check(r.returncode == 0 and "table TCGdex -> Cardmarket refaite" in r.stdout,
              "carte de l'appli inconnue de la table : table refaite par le quotidien")
        snap = {f: open(os.path.join(dp, f), "rb").read() for dp, _, fs in os.walk(out) for f in fs}
        # source cassée : sortie 2, rien n'est modifié
        bad = tempfile.mkdtemp(prefix="mk-cache-")
        try:
            os.makedirs(os.path.join(bad, "cm"))
            for f in ("products_nonsingles_6.json",):
                shutil.copyfile(os.path.join(cache, "cm", f), os.path.join(bad, "cm", f))
            with open(os.path.join(cache, "cm", "price_guide_6.json"), "rb") as f:
                head = f.read(2_000_000)
            with open(os.path.join(bad, "cm", "price_guide_6.json"), "wb") as f:
                f.write(head)  # tronqué
            r = run(["--offline", "--cache", bad, "--out", out])
            check(r.returncode == 2, f"guide tronqué : code de sortie {r.returncode} (attendu 2)")
            after = {f: open(os.path.join(dp, f), "rb").read() for dp, _, fs in os.walk(out) for f in fs}
            check(after == snap, "guide tronqué : aucun fichier modifié")
        finally:
            shutil.rmtree(bad, ignore_errors=True)
        # base TCGdex absente : l'hebdomadaire échoue mais le quotidien passe avec les tables existantes
        part = tempfile.mkdtemp(prefix="mk-cache-")
        try:
            os.makedirs(os.path.join(part, "cm"))
            for f in ("price_guide_6.json", "products_nonsingles_6.json", "products_singles_6.json"):
                shutil.copyfile(os.path.join(cache, "cm", f), os.path.join(part, "cm", f))
            r = run(["--weekly", "--offline", "--cache", part, "--out", out])
            check(r.returncode == 0 and "tables de la semaine dernière gardées" in r.stdout,
                  "hebdomadaire en panne : quotidien quand même, tables gardées")
        finally:
            shutil.rmtree(part, ignore_errors=True)
        check(m1.get("hist", {}).get("last"), "meta.json : dernier createdAt enregistré")
    finally:
        shutil.rmtree(out, ignore_errors=True)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    test_prices()
    test_sealed()
    test_names()
    test_hist()
    test_end_to_end()
    print(f"\n{len(FAILS)} échec(s)" if FAILS else "\nTous les tests passent.")
    sys.exit(1 if FAILS else 0)
