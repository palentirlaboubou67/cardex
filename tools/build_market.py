"""Cotes Cardmarket de Cardex : prix des cartes par série, catalogue du scellé et historique des prix du scellé.

  python tools/build_market.py              chaque jour (04:15 et 10:15 UTC) : guide des prix + produits scellés ->
                                            data/market/prices/<série>.json, data/market/sealed.json, un point
                                            d'historique quand le guide est nouveau (date = createdAt), meta.json
  python tools/build_market.py --weekly     chaque lundi (03:45 UTC, à la place du passage de 04:15), avec le
                                            quotidien : base TCGdex (cards-database, MIT), liste des cartes
                                            Cardmarket, noms PokéAPI, listes TCGCSV -> data/market/cm-map.json et
                                            data/market/sealed-img.json ; chaque fichier Cardmarket n'est demandé
                                            qu'une fois par passage (au plus deux passages par jour)
  python tools/build_market.py --backfill   une fois : historique du scellé reconstitué depuis les copies du guide
                                            gardées par l'Internet Archive (au moins 10 s entre deux requêtes) ;
                                            relancé (--offline) après une correction du calcul des prix, il
                                            recalcule les jours de ces copies
Le quotidien refait aussi la table cm-map.json (sans les photos) quand l'appli a des cartes que la table ne
connaît pas encore (nouvelle série) : les cotes d'une nouvelle série n'attendent pas le lundi.
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


def app_set_dates(root):
    j = read_json(os.path.join(root, "data", "sets.json")) or {}
    return {s["id"]: s.get("date") for s in j.get("sets", []) if isinstance(s, dict) and s.get("id")}


def _sid(cid):
    return cid[:cid.rfind("-")]


def unlinked(cm, app):
    """Cartes de l'appli absentes de la table."""
    cards = cm.get("cards") or {}
    return sorted(cid for cid in app if cid[cid.rfind("-") + 1:] not in (cards.get(_sid(cid)) or {}))


RECENT = (-14, 21)  # jours autour de la sortie d'une série où la table est refaite chaque jour s'il lui manque des cartes


def table_stale(cm, app, set_dates, today):
    """La table doit-elle être refaite avant les cotes du jour ? -> raison, ou None.
    Oui si l'appli a des cartes que la dernière construction n'a pas vues (nouvelle série, cartes ajoutées), ou,
    une fois par jour, s'il manque encore des cartes d'une série sortie il y a moins de 3 semaines (TCGdex et
    Cardmarket complètent leurs liens dans les jours qui suivent une sortie)."""
    miss = unlinked(cm, app)
    seen = set(cm.get("unlinked") or ())
    new = [c for c in miss if c not in seen]
    if new:
        sets = sorted({_sid(c) for c in new})
        more = " …" if len(sets) > 6 else ""
        return f"{len(new)} cartes de l'appli inconnues de la table ({', '.join(sets[:6])}{more})"
    if cm.get("built") == today.isoformat():
        return None
    recent = set()
    for c in miss:
        d = set_dates.get(_sid(c))
        try:
            age = (today - date.fromisoformat(d)).days if d else None
        except ValueError:
            age = None
        if age is not None and RECENT[0] <= age <= RECENT[1]:
            recent.add(_sid(c))
    return f"cartes encore sans cote dans des séries récentes ({', '.join(sorted(recent))})" if recent else None


# ---------- hebdomadaire ----------
def weekly(cache, out_dir, meta, report, photos=True):
    """-> (cm-map, table des photos ou None si photos=False, produits scellés, infos)."""
    t = time.monotonic()
    log("Hebdomadaire : base TCGdex, cartes Cardmarket, noms PokéAPI" + (", photos TCGplayer" if photos else ""))
    singles, si = sources.cardmarket(cache, "products_singles_6.json")
    nonsingles, ni = sources.cardmarket(cache, "products_nonsingles_6.json")
    guide, _ = sources.cardmarket(cache, "price_guide_6.json")  # repris tel quel par le quotidien (une requête)
    zpath, zi = sources.cards_db(cache)
    species = sources.species(cache)
    app = app_cards(ROOT)
    log(f"  appli : {len(app)} cartes dans data/sets/")
    rows = {r["idProduct"]: r for r in guide["priceGuides"] if isinstance(r, dict) and isinstance(r.get("idProduct"), int)}
    cm, audit, db = cmap.build(zpath, singles["products"], nonsingles["products"], species, app_cards=app, log=log,
                               guide=rows)
    cm["built"] = datetime.now(timezone.utc).date().isoformat()
    cm["unlinked"] = unlinked(cm, app)  # cartes de l'appli vues sans lien (le quotidien ne refait pas la table pour elles)
    log("  " + json.dumps(cm["stats"], ensure_ascii=False))
    if len(cm["cards"]) < 150 or cm["stats"].get("fr cards linked", 0) < 18000:
        raise SourceError("table TCGdex -> Cardmarket trop petite : base TCGdex ou liste Cardmarket incomplète")
    write_json(cache.path("audit.json"), audit)

    def done(img):  # meta.json ne change qu'une fois tout calculé
        meta["singles"] = {k: si.get(k) for k in ("createdAt", "etag", "rows")}
        meta["cardsdb"] = {"etag": (cache.index.get("cards-database") or {}).get("etag"), "files": zi.get("files")}
        meta.setdefault("stats", {})["cmap"] = cm["stats"]
        if img is not None:
            meta["stats"]["images"] = {"matched": len(img.get("img") or {})}
        log(f"  {'hebdomadaire calculé' if photos else 'table calculée'} en {time.monotonic() - t:.0f} s")
        return cm, img, nonsingles, ni

    if not photos:
        return done(None)
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
    return done(img)


# ---------- historique depuis l'Internet Archive ----------
def day_values(rows, ctx):
    """Prix du scellé d'un guide (même calcul que le catalogue) ; ctx = sealed.context() -> {"idProduct": centimes}."""
    vals = {}
    for pid, (k, rel) in ctx.items():
        eur, _ = sealed.sealed_price(rows.get(pid), k, rel)
        if eur:
            vals[str(pid)] = cents(eur)
    return vals


def backfill(cache, H, ctx, offline):
    """Recalcule chaque jour couvert par une copie de l'Archive (date = createdAt) : les valeurs de ces jours sont
    remplacées, donc relancer après une correction du calcul des prix nettoie l'historique."""
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
        days.setdefault(day, {}).update(day_values(rows, ctx))  # deux copies le même jour : la plus récente
        log(f"  {ts} -> {day}")
    ids = [str(p) for p in ctx]
    for day, vals in sorted(days.items()):
        H.set_day(day, vals, ids)
    log(f"  {len(caps)} copies, {len(days)} jours recalculés")
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

    # cartes (seulement celles que l'appli liste)
    pfiles, pst = prices.build(cm, rows, day, app=app_cards(ROOT))
    if pst["priced"] < 15000:
        raise SourceError(f"cotes des cartes : {pst['priced']} cartes seulement (guide incomplet ?)")
    for sid in app_set_names(ROOT):  # un fichier (vide) pour chaque série de l'appli : jamais de 404 dans la console
        pfiles.setdefault(sid, {"v": 1, "d": day, "c": {}})

    # scellé
    kept, langs = sealed.classify(nonsingles["products"], cm)
    ctx = sealed.context(kept, cm)
    H = hist.History(os.path.join(out_dir, "hist"))
    hinfo = meta.get("hist") or {}
    if args.backfill:
        meta["backfill"] = backfill(cache, H, ctx, args.offline)
    last = hinfo.get("last")
    if last and created_dt(created) < created_dt(last):
        warn(f"guide plus ancien ({created}) que le dernier point d'historique ({last}) : rien n'est ajouté")
    else:
        # nouveau guide : un point ; même guide relu : le point du jour est recalculé (identique, sauf correction)
        n = H.set_day(day, day_values(rows, ctx), [str(i) for i in ctx])
        if not last or created_dt(created) > created_dt(last):
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
        eur, _ = sealed.sealed_price(rows.get(pid), *ctx[pid])
        if eur and (not pts or pts[-1][0] != day):
            pts.append((day, cents(eur)))  # le prix du jour, même sans nouveau point
        if not eur:
            return {k: None for k in ("c7", "c30", "c90", "c365", "first", "since", "max", "chg")}
        return hist.summary(pts, today)

    names_fr = app_set_names(ROOT)
    set_names = {sid: (names_fr.get(sid) or s.get("fr"), s.get("en")) for sid, s in cm["sets"].items()}
    namer = names.Namer(cm.get("species") or {}, set_names)
    products = sealed.catalogue(kept, rows, cm, namer, img_map, summary, H.shard_of)
    if len(products) < 2500 or sum(1 for p in products if p["eur"]) < 2000:
        raise SourceError(f"catalogue du scellé : {len(products)} produits seulement (liste incomplète ?)")
    # même guide et même catalogue : fichier identique (pas de nouveau hachage dans data/manifest.json)
    old = read_json(os.path.join(out_dir, "sealed.json")) or {}
    same = old.get("priceDate") == day and old.get("products") == products and old.get("updatedAt")
    sealed_json = {"updatedAt": old["updatedAt"] if same else
                   datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
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
    sp = os.path.join(out_dir, "sealed.json")
    text = dumps(res["sealed"], sort=False) + "\n"
    try:
        with open(sp, encoding="utf8") as fh:
            same = fh.read() == text
    except OSError:
        same = False
    if not same:
        write_text(sp, text)
    res["sealed_written"] = not same
    if cm is not None:
        write_text(os.path.join(out_dir, "cm-map.json"), dumps(cm, sort=False) + "\n")
    if img is not None:  # même table de photos : fichier gardé (seule sa date changerait)
        old_img = read_json(os.path.join(out_dir, "sealed-img.json")) or {}
        if old_img.get("img") != img.get("img"):
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
        else:
            old = read_json(os.path.join(args.out, "cm-map.json"))
            today = datetime.now(timezone.utc).date()
            why = table_stale(old, app_cards(ROOT), app_set_dates(ROOT), today) if old and old.get("cards") else None
            if why:
                warn(f"{why} : table TCGdex -> Cardmarket refaite avant les cotes")
                try:
                    cm, _, nonsingles, ni = weekly(cache, args.out, meta, args.report, photos=False)
                except SourceError as e:
                    warn(f"table non refaite ({e}) : table précédente gardée")
                    cm = nonsingles = ni = None
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
    log(f"Scellé : {s['products']} produits, {s['priced']} avec un prix, {s['withImage']} avec une photo"
        + ("" if res.get("sealed_written") else " (sealed.json inchangé)"))
    log(f"Historique : {len(res['hchanged'])} fichiers modifiés")
    if args.report:
        from market import report
        report.write(args.out, args.cache, log=log)
    log(f"Terminé en {time.monotonic() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
