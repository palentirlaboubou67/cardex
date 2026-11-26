"""Tableaux de relecture (python tools/build_market.py --report) écrits dans .cache/mk/report/ :

- sealed-top300.md : les 300 produits scellés les plus chers avec leur nom français (relecture des noms) ;
- sealed-issues.txt : noms suspects sur tout le catalogue (mots anglais restants, ponctuation, carton mal nommé) ;
- cards.md : exemples de FINAL-cardmarket, couverture des cartes de l'appli, tailles des fichiers.
"""
import glob
import gzip
import os
import re
from collections import Counter

from .util import read_json

# mots anglais qui ne doivent pas rester dans un nom français (hors noms propres de gammes et de séries japonaises)
ENGLISH = re.compile(r"(?<![\w'])(?:Empty|Cards?|Packs?|Boxes|Box|Tins?|Collections?|Blisters?|Case|Elite|Trainer|"
                     r"Booster Box|Sleeved Booster Case|with|and|Version|Special|Premium Collection|Display Box|"
                     r"Figure|Poster|Binder|Chest|Stadium|League|Battle Deck|Theme Deck|Checklane)(?![\w'])")
STRUCT = re.compile(r"\(\(|\)\)|’|‘|\s{2,}|\(\s*\)|\s[,)]|[,(:–-]\s*$|^\s|\s$|\?\?")


def _gz(path):
    with open(path, "rb") as f:
        return len(gzip.compress(f.read(), 9))


def write(out_dir, cache_dir, log=print):
    rdir = os.path.join(cache_dir, "report")
    os.makedirs(rdir, exist_ok=True)
    sealed = read_json(os.path.join(out_dir, "sealed.json")) or {"products": []}
    ps = sealed["products"]

    # 1. les 300 plus chers
    top = sorted((p for p in ps if p["eur"]), key=lambda p: -p["eur"])[:300]
    lines = ["# Scellé : les 300 produits les plus chers (relecture des noms français)", "",
             f"Guide du {sealed.get('priceDate')} · {len(ps)} produits au catalogue", "",
             "| # | Prix | Type | Langue | Nom français | Nom Cardmarket |", "|---|---:|---|---|---|---|"]
    for i, p in enumerate(top, 1):
        lines.append(f"| {i} | {p['eur']:.2f} € | {p['k']} | {p['l']} | {p['fr']} | {p['n']} |")
    with open(os.path.join(rdir, "sealed-top300.md"), "w", encoding="utf8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")

    # 2. noms suspects (le libellé de type et le nom de série sont français par construction : on lit le détail)
    from .names import DEFAULT, TYPES
    labels = sorted({fr.split("{")[0].strip() for _, fr, _ in TYPES} | set(DEFAULT.values()), key=len, reverse=True)
    issues = []
    for p in ps:
        fr, why = p["fr"], []
        if not fr:
            why.append("vide")
        if STRUCT.search(fr):
            why.append("ponctuation")
        det = fr
        for lab in labels:
            if det.startswith(lab):
                det = det[len(lab):]
                break
        if p.get("set"):
            det = det.replace(f"– {p['set']}", " ")
        det = re.sub(r"\b(?:Mini Tins?|Blister|Pokémon Center|Poster)\b", " ", det)
        m = ENGLISH.search(det)
        if m and p["l"] != "ja":
            why.append(f"anglais « {m.group(0)} »")
        is_case = fr.startswith(("Carton", "Présentoir"))
        if (p["k"] == "case") != is_case:
            why.append("carton/boîte")
        if why:
            issues.append((p["eur"] or 0, p["k"], p["l"], fr, p["n"], ", ".join(why)))
    issues.sort(reverse=True)
    with open(os.path.join(rdir, "sealed-issues.txt"), "w", encoding="utf8", newline="\n") as f:
        f.write(f"{len(issues)} noms à revoir sur {len(ps)}\n")
        for e, k, l, fr, n, why in issues:
            f.write(f"{e:9.2f} {k:10s} {l:3s} {fr}   <= {n}   [{why}]\n")

    # 3. cartes : exemples et couverture
    def price(cid, fin):
        sid, loc = cid[:cid.rfind("-")], cid[cid.rfind("-") + 1:]
        j = read_json(os.path.join(out_dir, "prices", f"{sid}.json")) or {}
        return (j.get("c") or {}).get(loc, {}).get(fin)
    examples = [("ecard2-149", "holo", "≈ 4 634 € (pas 1 299 € des champs -holo)"),
                ("bw6-119", "holo", "≈ 176 € (pas 24,59 €)"),
                ("ex8-107", "holo", "Rayquaza ☆ ≈ 7 091 € (pas la Rayquaza normale à 84,72 €)"),
                ("ex13-104", "holo", "Pikachu ☆ ≈ 4 525 €"), ("ex13-103", "holo", "Mewtwo ☆ ≈ 3 775 €"),
                ("ex10-113", "holo", "Entei ☆ retrouvée ≈ 3 559 €"), ("sma-SV49", "normal", "Dracaufeu-GX ≈ 393 €"),
                ("sv08.5-001", "masterball", "champs -holo (≈ 1,63 €)"), ("sv08.5-001", "pokeball", "champs -holo"),
                ("neo2-10", "holo", "tendance cassée 0,02 € -> moyenne 7 j 19,83 €"),
                ("ex4-1", "holo", "relink 275978 Team Aqua's Cacturne ≈ 17,95 €"),
                ("sv03.5-025", "normal", "≈ 0,25 €"), ("sv03.5-025", "reverse", "champs -holo")]
    rows = ["# Cotes des cartes : contrôles", "", "| Carte | Finition | Valeurs (centimes) | Attendu |", "|---|---|---|---|"]
    for cid, fin, want in examples:
        rows.append(f"| {cid} | {fin} | {price(cid, fin)} | {want} |")
    app = {}
    for p in glob.glob(os.path.join(os.path.dirname(os.path.dirname(out_dir)), "data", "sets", "*.json")):
        j = read_json(p) or {}
        for c in j.get("cards", []):
            app[f"{j.get('id')}-{c['l']}"] = c.get("f") or []
    files = {os.path.basename(p)[:-5]: (read_json(p) or {}).get("c", {})
             for p in glob.glob(os.path.join(out_dir, "prices", "*.json"))}
    priced, fin_ok, fin_all, miss = 0, 0, 0, Counter()
    for cid, fs in app.items():
        e = files.get(cid[:cid.rfind("-")], {}).get(cid[cid.rfind("-") + 1:]) or {}
        priced += any(v[0] is not None for v in e.values())
        for f in fs:
            fin_all += 1
            if e.get(f) and e[f][0] is not None:
                fin_ok += 1
            else:
                miss[f] += 1
    pfiles = glob.glob(os.path.join(out_dir, "prices", "*.json"))
    hfiles = glob.glob(os.path.join(out_dir, "hist", "*.json"))
    rows += ["", f"Cartes de l'appli cotées : {priced} / {len(app)} ({100 * priced / max(1, len(app)):.2f} %)",
             f"Finitions de l'appli cotées : {fin_ok} / {fin_all} ; sans cote : {dict(miss.most_common())}", "",
             f"prices/ : {len(pfiles)} fichiers, {sum(os.path.getsize(p) for p in pfiles)} o, "
             f"gzip {sum(_gz(p) for p in pfiles)} o",
             f"sealed.json : {os.path.getsize(os.path.join(out_dir, 'sealed.json'))} o, "
             f"gzip {_gz(os.path.join(out_dir, 'sealed.json'))} o",
             f"hist/ : {len(hfiles)} fichiers, {sum(os.path.getsize(p) for p in hfiles)} o, "
             f"gzip {sum(_gz(p) for p in hfiles)} o"]
    with open(os.path.join(rdir, "cards.md"), "w", encoding="utf8", newline="\n") as f:
        f.write("\n".join(rows) + "\n")
    log(f"  relecture : {rdir} ({len(issues)} noms à revoir)")
    return issues
