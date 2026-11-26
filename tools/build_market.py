"""Cotes Cardmarket de Cardex : prix des cartes par série, catalogue du scellé et historique des prix du scellé.

  python tools/build_market.py              chaque jour (04:15 et 10:15 UTC) : guide des prix + produits scellés ->
                                            data/market/prices/<série>.json, data/market/sealed.json, un point
                                            d'historique quand le guide est nouveau (date = createdAt), meta.json
  python tools/build_market.py --weekly     chaque semaine, avant le quotidien : base TCGdex (cards-database, MIT),
                                            liste des cartes Cardmarket, noms PokéAPI, listes TCGCSV ->
                                            data/market/cm-map.json et data/market/sealed-img.json
  python tools/build_market.py --backfill   une fois : historique du scellé reconstitué depuis les copies du guide
                                            gardées par l'Internet Archive (au moins 10 s entre deux requêtes)
Options : --offline (copies du cache seulement), --report (tableaux de relecture dans .cache/mk/report/),
          --cache DIR (défaut .cache/mk), --out DIR (défaut data/market).

Bibliothèque standard uniquement. Rien n'est écrit si une source est cassée (code de sortie 2) : les anciens
fichiers restent en place. Cotes Cardmarket (tendance, toutes langues) ; Cardex n'est pas affilié à Cardmarket.
"""
import argparse
import glob
import json
import os
import sys
import time
import traceback
from collections import Counter
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from market import cmap, hist, images, names, prices, sealed, sources, wayback  # noqa: E402
from market.net import SourceError  # noqa: E402
from market.util import cents, created_day, created_dt, dumps, read_json, write_json, write_text  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRICE_FILE = "{}.json"


def log(*a):
    print(*a, flush=True)


def warn(msg):
    # annotation GitHub Actions (visible dans le résumé du run) + journal
    print(f"::warning::{msg}" if os.environ.get("GITHUB_ACTIONS") else f"  ! {msg}", flush=True)


# ---------- lecture des fichiers de l'appli (CA) ----------
def app_cards(root):
    """{cardId: [finitions]} d'après data/sets/<id>.json (ce que l'appli affiche), ou {} sans ces fichiers."""
    out = {}
    for p in glob.glob(os.path.join(root, "data", "sets", "*.json")):
        j = read_json(p)
        if not isinstance(j, dict) or not isinstance(j.get("cards"), list):
            continue
        for c in j["cards"]:
            if isinstance(c, dict) and isinstance(c.get("l"), str):
                out[f"{j.get('id')}-{c['l']}"] = [f for f in c.get("f") or [] if isinstance(f, str)]
    return out


def app_set_names(root):
    j = read_json(os.path.join(root, "data", "sets.json")) or {}
    return {s["id"]: s.get("name") for s in j.get("sets", []) if isinstance(s, dict) and s.get("id")}


# ---------- hebdomadaire ----------
def weekly(cache, out_dir, meta, report):
    t = time.monotonic()
    log("Hebdomadaire : base TCGdex, cartes Cardmarket, noms PokéAPI, photos TCGplayer")
    singles, si = sources.cardmarket(cache, "products_singles_6.json")
    nonsingles, ni = sources.cardmarket(cache, "products_nonsingles_6.json")
    zpath, zi = sources.cards_db(cache)
    species = sources.species(cache)
    app = app_cards(ROOT)
    log(f"  appli : {len(app)} cartes dans data/sets/")
    cm, audit, db = cmap.build(zpath, singles["products"], nonsingles["products"], species, app_cards=app, log=log)
    cm["built"] = datetime.now(timezone.utc).date().isoformat()
    log("  " + json.dumps(cm["stats"], ensure_ascii=False))
    if len(cm["cards"]) < 150 or cm["stats"].get("fr cards linked", 0) < 18000:
        raise SourceError("table TCGdex -> Cardmarket trop petite : base TCGdex ou liste Cardmarket incomplète")
    # photos : TCGCSV en panne -> on garde la table de la semaine dernière (les cotes, elles, avancent)
    old_img = read_json(os.path.join(out_dir, "sealed-img.json"))
    try:
        groups, tprods = sources.tcgcsv(cache)
        kept, _ = sealed.classify(nonsingles["products"], cm)
        img = {"v": 1, "built": cm["built"], "img": images.match_all(kept, cm, groups, tprods, species.keys(), log=log)}
        if len(img["img"]) < 800:
            raise SourceError(f"photos TCGplayer : {len(img['img'])} correspondances seulement (TCGCSV incomplet ?)")
        meta["tcgcsv"] = {"groups": len(groups), "products": len(tprods)}
    except SourceError as e:
        if not old_img:
            raise
        warn(f"photos TCGplayer non mises à jour ({e}) : table précédente gardée")
        img = old_img
    meta["singles"] = {k: si.get(k) for k in ("createdAt", "etag", "rows")}
    meta["cardsdb"] = {"etag": (cache.index.get("cards-database") or {}).get("etag"), "files": zi.get("files")}
    meta.setdefault("stats", {})["cmap"] = cm["stats"]
    meta["stats"]["images"] = {"matched": len(img.get("img") or {})}
    write_json(cache.path("audit.json"), audit)
    log(f"  hebdomadaire calculé en {time.monotonic() - t:.0f} s")
    return cm, img, nonsingles, ni


# ---------- historique depuis l'Internet Archive ----------
def backfill(cache, H, kept_ids, offline):
    log("Historique : copies du guide de l'Internet Archive")
    folder = cache.path("wayback")
    caps = wayback.local(folder) if offline else wayback.captures(folder, log=log)
    days = {}
    for ts, path in caps:
        with open(path, "rb") as f:
            g = wayback.parse_capture(f.read())
        if not g:
            continue
        day = created_day(g["createdAt"])
        rows = {r.get("idProduct"): r for r in g["priceGuides"] if isinstance(r, dict)}
        vals = {}
        for pid in kept_ids:
            eur, _ = sealed.sealed_price(rows.get(pid))
            if eur:
                vals[str(pid)] = cents(eur)
        n = H.add(day, vals)
        days[day] = max(days.get(day, 0), n)
        log(f"  {ts} -> {day} : {n} prix")
    return {"captures": len(caps), "days": len(days), "from": min(days) if days else None,
            "to": max(days) if days else None}


# ---------- quotidien ----------
def daily(args, cache, out_dir, meta, cm=None, img=None, nonsingles=None, ni=None):
    t0 = time.monotonic()
    if cm is None:
        cm = read_json(os.path.join(out_dir, "cm-map.json"))
        if not cm or not cm.get("cards"):
            raise SourceError("data/market/cm-map.json absent : lancer d'abord --weekly")
    if img is None:
        img = read_json(os.path.join(out_dir, "sealed-img.json"), {}) or {}
    img_map = img.get("img") or {}
    log("Quotidien : guide des prix et produits scellés Cardmarket")
    guide, gi = sources.cardmarket(cache, "price_guide_6.json")
    if nonsingles is None:
        nonsingles, ni = sources.cardmarket(cache, "products_nonsingles_6.json")
    created = gi["createdAt"]
    day = created_day(created)
    age_h = (datetime.now(timezone.utc) - created_dt(created)).total_seconds() / 3600
    log(f"  guide du {created} ({age_h:.0f} h), {gi['rows']} lignes ; produits du {ni['createdAt']}")
    # guide produit vers 01:45 UTC : à 04:15 un guide de la veille (≈ 26 h) peut encore arriver, à 10:15 (≈ 32 h) non
    if age_h > 30:
        warn(f"le guide Cardmarket date de {age_h:.0f} h (createdAt {created}) : pas de guide du jour "
             f"(génération sautée ou copie CloudFront ancienne)")
    rows = {r["idProduct"]: r for r in guide["priceGuides"] if isinstance(r, dict) and isinstance(r.get("idProduct"), int)}

    # cartes
    pfiles, pst = prices.build(cm, rows, day)
    if pst["priced"] < 15000:
        raise SourceError(f"cotes des cartes : {pst['priced']} cartes seulement (guide incomplet ?)")
    for sid in app_set_names(ROOT):  # un fichier (vide) pour chaque série de l'appli : jamais de 404 dans la console
        pfiles.setdefault(sid, {"v": 1, "d": day, "c": {}})

    # scellé
    kept, langs = sealed.classify(nonsingles["products"], cm)
    H = hist.History(os.path.join(out_dir, "hist"))
    hinfo = meta.get("hist") or {}
    if args.backfill:
        meta["backfill"] = backfill(cache, H, [p["idProduct"] for p, _, _ in kept], args.offline)
    last = hinfo.get("last")
    new_point = not last or created_dt(created) > created_dt(last)
    if last and created_dt(created) < created_dt(last):
        warn(f"guide plus ancien ({created}) que le dernier point d'historique ({last}) : rien n'est ajouté")
    if new_point:
        vals = {}
        for p, _, _ in kept:
            eur, _ = sealed.sealed_price(rows.get(p["idProduct"]))
            if eur:
                vals[str(p["idProduct"])] = cents(eur)
        n = H.add(day, vals)
        log(f"  historique : point du {day} ({n} prix)")
        hinfo["last"] = created
    else:
        log(f"  historique : guide déjà enregistré ({created}), pas de nouveau point")
    H.assign({str(p["idProduct"]): (p["idExpansion"], k) for p, k, _ in kept})
    today = date.fromisoformat(day)
    H.compact(today)
    hchanged, nfiles = H.prepare()

    def summary(pid):
        pts = [(d, v) for d, v in H.points(pid) if d <= day]
        g = rows.get(pid)
        eur, _ = sealed.sealed_price(g)
        if eur and (not pts or pts[-1][0] != day):
            pts.append((day, cents(eur)))  # le prix du jour, même sans nouveau point
        if not eur:
            return {k: None for k in ("c7", "c30", "c90", "c365", "first", "since", "max", "chg")}
        return hist.summary(pts, today)

    names_fr = app_set_names(ROOT)
    set_names = {sid: (names_fr.get(sid) or s.get("fr"), s.get("en")) for sid, s in cm["sets"].items()}
    namer = names.Namer(cm.get("species") or {}, set_names)
    products = sealed.catalogue(kept, rows, cm, namer, img_map, summary, lambda pid: H.shard.get(str(pid)))
    if len(products) < 2500 or sum(1 for p in products if p["eur"]) < 2000:
        raise SourceError(f"catalogue du scellé : {len(products)} produits seulement (liste incomplète ?)")
    sealed_json = {"updatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                   "priceDate": day, "source": "Cardmarket", "products": products}

    # statistiques
    kinds = Counter((p["k"], p["l"]) for p in products)
    sst = {"products": len(products), "priced": sum(1 for p in products if p["eur"]),
           "withImage": sum(1 for p in products if p["img"]), "withLow": sum(1 for p in products if p["low"]),
           "byKind": {f"{k}/{l}": n for (k, l), n in sorted(kinds.items())},
           "languages": dict(Counter(langs.values()).most_common())}
    meta["guide"] = {"createdAt": created, "day": day, "etag": gi.get("etag"), "lastModified": gi.get("lastModified"),
                     "rows": gi["rows"]}
    meta["nonsingles"] = {"createdAt": ni["createdAt"], "etag": ni.get("etag"), "rows": ni["rows"]}
    alld = H.days()
    hinfo.update({"days": len(alld), "first": alld[0] if alld else None, "files": nfiles,
                  "products": sum(1 for v in H.series.values() if v)})
    meta["hist"] = hinfo
    meta.setdefault("stats", {})["prices"] = pst
    meta["stats"]["sealed"] = sst
    meta["v"] = 1
    return {"pfiles": pfiles, "sealed": sealed_json, "H": H, "hchanged": hchanged, "pst": pst, "sst": sst,
            "t": time.monotonic() - t0}


# ---------- écriture (tout ou rien) ----------
def write_all(out_dir, res, cm=None, img=None, meta=None):
    pdir = os.path.join(out_dir, "prices")
    os.makedirs(pdir, exist_ok=True)
    keep = set()
    wrote = 0
    for sid, f in sorted(res["pfiles"].items()):
        fn = PRICE_FILE.format(sid)
        keep.add(fn)
        path = os.path.join(pdir, fn)
        text = dumps(f, sort=False) + "\n"
        try:
            with open(path, encoding="utf8") as fh:
                if fh.read() == text:
                    continue
        except OSError:
            pass
        write_text(path, text)
        wrote += 1
    for fn in os.listdir(pdir):  # séries disparues de la table
        if fn.endswith(".json") and fn not in keep:
            os.remove(os.path.join(pdir, fn))
    res["H"].commit(res["hchanged"])
    write_text(os.path.join(out_dir, "sealed.json"), dumps(res["sealed"], sort=False) + "\n")
    if cm is not None:
        write_text(os.path.join(out_dir, "cm-map.json"), dumps(cm, sort=False) + "\n")
    if img is not None:
        write_text(os.path.join(out_dir, "sealed-img.json"), dumps(img, sort=False) + "\n")
    if meta is not None:
        old = read_json(os.path.join(out_dir, "meta.json"))
        if old != meta:
            write_json(os.path.join(out_dir, "meta.json"), meta)
    return wrote


def main(argv=None):
    ap = argparse.ArgumentParser(description="Cotes Cardmarket de Cardex")
    ap.add_argument("--weekly", action="store_true", help="reconstruire cm-map.json et sealed-img.json")
    ap.add_argument("--backfill", action="store_true", help="reconstituer l'historique (Internet Archive)")
    ap.add_argument("--offline", action="store_true", help="n'utiliser que les copies du cache")
    ap.add_argument("--report", action="store_true", help="écrire les tableaux de relecture (.cache/mk/report/)")
    ap.add_argument("--cache", default=os.path.join(ROOT, ".cache", "mk"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "market"))
    args = ap.parse_args(argv)
    t0 = time.monotonic()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    cache = sources.Cache(args.cache, offline=args.offline, log=log)
    meta = read_json(os.path.join(args.out, "meta.json"), {}) or {}
    try:
        cm = img = nonsingles = ni = None
        if args.weekly:
            try:
                cm, img, nonsingles, ni = weekly(cache, args.out, meta, args.report)
            except SourceError as e:
                # base TCGdex ou liste Cardmarket en panne : les tables de la semaine dernière servent encore
                if not os.path.exists(os.path.join(args.out, "cm-map.json")):
                    raise
                warn(f"hebdomadaire impossible ({e}) : tables de la semaine dernière gardées, quotidien quand même")
                cm = img = nonsingles = ni = None
        res = daily(args, cache, args.out, meta, cm=cm, img=img, nonsingles=nonsingles, ni=ni)
    except SourceError as e:
        print(f"::error::{e}" if os.environ.get("GITHUB_ACTIONS") else f"ERREUR source : {e}", file=sys.stderr)
        print("Rien n'est modifié.", file=sys.stderr)
        return 2
    except Exception:
        traceback.print_exc()
        print("Rien n'est modifié.", file=sys.stderr)
        return 1
    wrote = write_all(args.out, res, cm=cm, img=img, meta=meta)
    p, s = res["pst"], res["sst"]
    log(f"Cartes : {p['priced']}/{p['cards']} cotées, {len(res['pfiles'])} fichiers ({wrote} modifiés)")
    log(f"Scellé : {s['products']} produits, {s['priced']} avec un prix, {s['withImage']} avec une photo")
    log(f"Historique : {len(res['hchanged'])} fichiers modifiés")
    if args.report:
        from market import report
        report.write(args.out, args.cache, log=log)
    log(f"Terminé en {time.monotonic() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
