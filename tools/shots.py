"""Captures d'écran de Cardex dans un vrai navigateur (Playwright + Chromium), pour vérifier l'interface.

  python tools/shots.py                    toutes les vues, thème clair, largeur téléphone (390 px)
  python tools/shots.py --dark             thème sombre
  python tools/shots.py --only sets,set    seulement certaines étapes (noms ci-dessous)
  python tools/shots.py --out DOSSIER      dossier de sortie (défaut : tools/shots/)
  python tools/shots.py --width 1280       largeur d'écran (ordinateur)

Sert l'appli sur http://localhost:8765, remplit une collection d'exemple (tools/sample_collection.json,
créée au premier lancement depuis TCGdex), parcourt les écrans et écrit une image par étape,
plus console.txt (erreurs JavaScript et requêtes en échec). Code de sortie 1 s'il y a des erreurs JS.
Installation : python -m pip install --user playwright && python -m playwright install chromium
"""
import argparse
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765
SAMPLE = os.path.join(ROOT, "tools", "sample_collection.json")

# Cartes de la collection d'exemple : variées (séries, finitions, doubles, Pokémon et dresseurs).
SAMPLE_CARDS = [
    ("sv03.5-025", {"normal": 2}), ("sv03.5-004", {"reverse": 1}), ("sv03.5-006", {"normal": 1, "reverse": 1}),
    ("sv03.5-007", {"normal": 1}), ("sv03.5-001", {"normal": 3}), ("sv03.5-150", {"holo": 1}),
    ("sv03.5-199", {"normal": 1}), ("sv03.5-133", {"normal": 1, "reverse": 2}), ("sv08-057", {"normal": 1}),
    ("sv08.5-161", {"normal": 1}), ("me01-001", {"normal": 1}), ("me01-114", {"pokeball": 1}),
    ("swsh12-139", {"normal": 1}), ("swsh7-215", {"normal": 1}), ("sm12-1", {"normal": 1}),
    ("xy1-1", {"normal": 1}), ("base1-4", {"normal": 1}), ("sv06-130", {"masterball": 1}),
    ("sv02-185", {"normal": 4}), ("me02-059", {"normal": 1}), ("sv01-245", {"normal": 1}),
    ("swsh9-154", {"normal": 2}), ("sv04.5-232", {"normal": 1}), ("me06-060", {"normal": 1}),
]
VARIANTS = ["normal", "reverse", "holo", "cosmos", "pokeball", "masterball", "firstEdition", "stamp"]


def build_sample():
    if os.path.exists(SAMPLE):
        return json.load(open(SAMPLE, encoding="utf8"))
    cards, t = {}, int(time.time() * 1000)
    for i, (cid, qty) in enumerate(SAMPLE_CARDS):
        try:
            with urllib.request.urlopen(f"https://api.tcgdex.net/v2/fr/cards/{cid}", timeout=30) as r:
                full = json.loads(r.read())
        except Exception as e:  # carte absente de l'API : on la saute
            print(f"  ! {cid} : {e}", file=sys.stderr)
            continue
        cm = (full.get("pricing") or {}).get("cardmarket") or {}
        price = cm.get("trend") or cm.get("avg")
        holo = cm.get("trend-holo") or cm.get("avg-holo") or price
        cards[cid] = {
            "id": cid, "qty": qty, "addedAt": t - i * 3600000,
            "name": full["name"], "localId": full["localId"], "setId": full["set"]["id"],
            "setName": full["set"]["name"], "setTotal": (full["set"].get("cardCount") or {}).get("official"),
            "image": full.get("image", ""), "rarity": full.get("rarity", ""), "category": full.get("category", ""),
            "dexId": full.get("dexId") or [],
            "prices": {v: (price if v in ("normal", "firstEdition", "stamp") else holo) for v in VARIANTS},
        }
    data = {"version": 1, "cards": cards, "savedAt": t}
    json.dump(data, open(SAMPLE, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    return data


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *a: None
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# Étapes : (nom, liste d'actions). Action = ("click", sélecteur) | ("fill", sélecteur, texte) | ("wait", ms)
#          | ("eval", js) | ("waitfor", sélecteur). Chaque étape part de l'état laissé par la précédente.
STEPS = [
    ("scan", [("click", '.tab[data-view="scan"]')]),
    ("search", [("click", '.tab[data-view="search"]'), ("fill", "#search-input", "Dracaufeu"), ("wait", 2500)]),
    ("card", [("click", "#search-results .tile"), ("wait", 2500)]),
    ("collection", [("eval", "history.back()"), ("wait", 400), ("click", '.tab[data-view="collection"]'), ("wait", 800)]),
    ("dex", [("click", '#col-mode [data-m="dex"]'), ("wait", 1200)]),
    ("poke", [("click", '[data-dex="25"]'), ("wait", 3500)]),
    ("doubles", [("click", '.tab[data-view="collection"]'), ("click", '#col-mode [data-m="dup"]'), ("wait", 600)]),
    ("achievements", [("click", '#col-mode [data-m="ach"]'), ("wait", 2500)]),
    ("sets", [("click", '.tab[data-view="sets"]'), ("wait", 4000)]),
    ("set", [("click", '.set-row[data-set="sv03.5"]'), ("wait", 4000)]),
    ("set-list", [("click", '#set-view [data-v="list"]'), ("wait", 2500)]),
    ("set-binder", [("click", '#set-view [data-v="binder"]'), ("wait", 1500)]),
    ("decks", [("click", '.tab[data-view="decks"]'), ("wait", 1500)]),
    ("deck", [("click", "#deck-list .deck"), ("wait", 1200)]),
    ("market", [("click", '.tab[data-view="market"]'), ("wait", 6000)]),
    ("sealed", [("click", '#view-market [data-mk="sealed"]'), ("wait", 3000)]),
    ("sealed-all", [("click", '#sealed-mode [data-s="all"]'), ("wait", 2000)]),
    ("product", [("click", "#sealed-grid .ptile"), ("wait", 2500)]),
    ("wishlist", [("eval", "history.back()"), ("wait", 400), ("click", '#view-market [data-mk="wish"]'), ("wait", 1200)]),
]


def run(page, name, actions):
    for a in actions:
        kind = a[0]
        if kind == "click":
            page.locator(a[1]).first.click(timeout=8000)
        elif kind == "fill":
            page.locator(a[1]).first.fill(a[2])
        elif kind == "wait":
            page.wait_for_timeout(a[1])
        elif kind == "eval":
            page.evaluate(a[1])
        elif kind == "waitfor":
            page.locator(a[1]).first.wait_for(timeout=10000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dark", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default=os.path.join(ROOT, "tools", "shots"))
    ap.add_argument("--width", type=int, default=390)
    ap.add_argument("--height", type=int, default=844)
    ap.add_argument("--full", action="store_true", help="capture de toute la page, pas seulement l'écran")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    os.makedirs(args.out, exist_ok=True)
    sample = build_sample()
    httpd = serve()
    only = {s for s in args.only.split(",") if s}
    logs, js_errors = [], 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": args.width, "height": args.height}, device_scale_factor=2,
                                  color_scheme="dark" if args.dark else "light", locale="fr-FR",
                                  service_workers="block")
        ctx.add_init_script(f"try {{ if (!localStorage.getItem('cardex.collection.v1')) localStorage.setItem('cardex.collection.v1', {json.dumps(json.dumps(sample))}); }} catch (e) {{}}")
        page = ctx.new_page()

        def on_console(m):
            nonlocal js_errors
            if m.type in ("error", "warning"):
                logs.append(f"[{m.type}] {m.text}")
                js_errors += m.type == "error"

        def on_pageerror(e):
            nonlocal js_errors
            logs.append(f"[pageerror] {e}")
            js_errors += 1

        page.on("console", on_console)
        page.on("pageerror", on_pageerror)
        page.on("requestfailed", lambda r: logs.append(f"[requestfailed] {r.url} {r.failure}"))
        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
        page.wait_for_timeout(800)
        suffix = "-dark" if args.dark else ""
        for name, actions in STEPS:
            try:
                run(page, name, actions)
            except Exception as e:
                logs.append(f"[step {name}] {type(e).__name__}: {str(e).splitlines()[0]}")
                continue
            if only and name not in only:
                continue
            path = os.path.join(args.out, f"{name}{suffix}.png")
            page.screenshot(path=path, full_page=args.full)
            print(f"  {path}")
        browser.close()
    httpd.shutdown()
    open(os.path.join(args.out, f"console{suffix}.txt"), "w", encoding="utf8").write("\n".join(logs) + "\n")
    print(f"{len(logs)} lignes de journal, {js_errors} erreur(s) JS -> {os.path.join(args.out, f'console{suffix}.txt')}")
    sys.exit(1 if js_errors else 0)


if __name__ == "__main__":
    main()
