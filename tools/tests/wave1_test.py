"""Contrôles de l'intégration de la vague 1 dans la vraie appli (Playwright, données réelles, sans service worker).

    python -P tools/tests/wave1_test.py --port N

1. enregistrement en échec -> toast persistant « Exporter », parti quand l'enregistrement remarche ;
2. problème vu au démarrage (collection illisible) -> toast « Réglages » une seule fois ;
3. message 'navigate' du service worker -> la route demandée ;
4. collection v1 : « normale » -> « holo » sur les cartes holo seulement (checkFinishes au repos), drapeau retiré ;
5. ordre des blocs (grandes périodes puis McDonald's, kits, POP), drapeaux dark/special ; objectif des barres (svp : 220).
6. sauvegarde v1 importée appli ouverte : finitions revues sans recharger ; export pendant la correction : fixFin gardé.
"""
import argparse
import functools
import http.server
import json
import os
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--port", type=int, default=8771)
PORT = ap.parse_args().port
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer.request_queue_size = 128   # 5 par défaut : Windows refuse les rafales
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}/index.html"
sample = open(os.path.join(ROOT, "tools", "sample_collection.json"), encoding="utf8").read()
ok = True


def check(c, msg, extra=""):
    global ok
    print(("PASS " if c else "FAIL ") + msg, extra if extra != "" else "")
    ok = ok and bool(c)


def boot(b, hsh, ls=None, raw=None):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    if raw is not None:
        ctx.add_init_script("try{if(!sessionStorage.getItem('x')){sessionStorage.setItem('x',1);localStorage.setItem('cardex.collection.v1', %s)}}catch(e){}" % json.dumps(raw))
    elif ls is not None:
        ctx.add_init_script("try{if(!sessionStorage.getItem('x')){sessionStorage.setItem('x',1);localStorage.setItem('cardex.collection.v1', %s)}}catch(e){}" % json.dumps(ls))
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "manifest.json" not in m.location.get("url", "") else None)
    pg.goto(BASE + hsh)
    pg.wait_for_function("() => document.documentElement.classList.contains('ready')")
    pg.evaluate("() => window.__cardex.settled()")
    return ctx, pg, errs


with sync_playwright() as p:
    b = p.chromium.launch()
    # 1. enregistrement en échec
    ctx, pg, errs = boot(b, "#/carte/sv03.5-025", ls=sample)
    pg.evaluate("""() => { window.__orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'cardex.collection.v1') { const e = new DOMException('plein', 'QuotaExceededError'); throw e; } return window.__orig.call(this, k, v); }; }""")
    pg.click("#v-card [data-f='reverse'] [data-step='1']")
    pg.wait_for_timeout(400)
    t = pg.evaluate("() => [...document.querySelectorAll('.toast')].map(t => [t.querySelector('.msg')?.textContent, t.querySelector('.act')?.textContent])")
    check(any(a == "Exporter" and "Stockage plein" in (m or "") for m, a in t), "échec d'enregistrement : toast « Exporter »", t)
    pg.click("#v-card [data-f='reverse'] [data-step='1']")
    pg.wait_for_timeout(5600)          # le toast « Ajoutée » passe, le persistant revient
    t2 = pg.evaluate("() => [...document.querySelectorAll('.toast:not(.out)')].map(t => t.querySelector('.act')?.textContent)")
    check(t2.count("Exporter") == 1, "toast persistant revenu une seule fois", t2)
    pg.evaluate("() => { Storage.prototype.setItem = window.__orig; }")
    pg.click("#v-card [data-f='reverse'] [data-step='-1']")
    pg.wait_for_timeout(5600)
    t3 = pg.evaluate("() => [...document.querySelectorAll('.toast:not(.out)')].map(t => t.querySelector('.act')?.textContent)")
    check("Exporter" not in t3, "enregistrement revenu : toast parti", t3)
    check(not errs, "aucune erreur console (1)", errs)
    ctx.close()

    # 2. collection illisible au démarrage
    ctx, pg, errs = boot(b, "#/collection/cartes", raw="{pas du json")
    pg.wait_for_timeout(300)
    t = pg.evaluate("() => [...document.querySelectorAll('.toast')].map(t => [t.querySelector('.msg')?.textContent, t.querySelector('.act')?.textContent])")
    check(len(t) == 1 and t[0][1] == "Réglages" and "illisible" in t[0][0], "collection illisible : un toast « Réglages »", t)
    check(not errs, "aucune erreur console (2)", errs)
    ctx.close()

    # 3. message 'navigate' du service worker
    ctx, pg, errs = boot(b, "#/collection/cartes", ls=sample)
    pg.wait_for_timeout(4500)            # registerSW() est lancé au repos
    pg.evaluate("() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'navigate', url: location.origin + '/index.html#/marche/envies' } }))")
    pg.evaluate("() => window.__cardex.settled()")
    h = pg.evaluate("() => [location.hash, document.querySelector('.tabbar [aria-current=page]')?.dataset.tab]")
    check(h == ["#/marche/envies", "market"], "message navigate -> #/marche/envies (onglet Marché)", h)

    # 4. finitions v1
    st = pg.evaluate("""async () => { const C = await import('./js/state/collection.js');
      return { n006: C.qtyOf('sv03.5-006', 'normal'), h006: C.qtyOf('sv03.5-006', 'holo'), r006: C.qtyOf('sv03.5-006', 'reverse'),
               n025: C.qtyOf('sv03.5-025', 'normal'), h199: C.qtyOf('sv03.5-199', 'holo'), need: C.needsFinishCheck(),
               saved: 'fixFin' in JSON.parse(localStorage.getItem('cardex.collection.v1') || '{}') }; }""")
    check(st == {"n006": 0, "h006": 1, "r006": 1, "n025": 2, "h199": 1, "need": False, "saved": False}, "finitions v1 revues au repos", st)
    check(not errs, "aucune erreur console (3-4)", errs)
    ctx.close()

    # 5. blocs et objectif
    ctx, pg, errs = boot(b, "#/series", ls=sample)
    r = pg.evaluate("""async () => { const cat = await import('./js/data/catalog.js'); const s = await cat.sets();
      return { order: s.blocs.map(b => b.id), pop: s.blocs.find(b => b.id === 'pop'), svp: cat.goalOf(s.byId.get('svp')), mew: cat.goalOf(s.byId.get('sv03.5')),
               }; }""")
    check(r["order"][-3:] == ["mc", "tk", "pop"] and r["order"][:3] == ["me", "sv", "swsh"], "ordre des blocs", r["order"])
    check(r["pop"]["dark"] is True and r["pop"]["special"] is True, "bloc POP : dark + special")
    check(r["svp"] == 220 and r["mew"] == 165, "objectif : svp 220, 151 165", (r["svp"], r["mew"]))
    check(not errs, "aucune erreur console (5)", errs)
    ctx.close()

    # 6. sauvegarde v1 importée dans l'appli ouverte : finitions revues tout de suite (pas au prochain démarrage) ;
    # exportée avant la correction (série injoignable), le fichier garde fixFin et l'appareil qui l'importe corrige
    empty = '{"v":2,"cards":{},"sealed":{},"watch":[],"savedAt":0}'
    STATE = """async () => { const C = await import('./js/state/collection.js');
      return { need: C.needsFinishCheck(), n199: C.qtyOf('sv03.5-199', 'normal'), h199: C.qtyOf('sv03.5-199', 'holo'),
               h006: C.qtyOf('sv03.5-006', 'holo'), n006: C.qtyOf('sv03.5-006', 'normal'), r006: C.qtyOf('sv03.5-006', 'reverse') }; }"""
    FIXED = {"need": False, "n199": 0, "h199": 1, "h006": 1, "n006": 0, "r006": 1}
    IMPORT = "async (t) => { const C = await import('./js/state/collection.js'); window.__C = C; return C.importText(t).cards; }"
    DONE = "() => window.__C && !window.__C.needsFinishCheck()"

    def wait_fixed(pg):
        try:
            pg.wait_for_function(DONE, timeout=10000)
        except Exception:
            pass

    ctx, pg, errs = boot(b, "#/collection/cartes", ls=empty)
    pg.wait_for_timeout(4500)            # tâches de fond lancées (checkFinishes au repos)
    n = pg.evaluate(IMPORT, sample)
    wait_fixed(pg)
    st = pg.evaluate(STATE)
    check(n > 0 and st == FIXED, "import v1 dans l'appli ouverte : finitions revues sans recharger", (n, st))
    check(not errs, "aucune erreur console (6a)", errs)
    ctx.close()

    ctx, pg, errs = boot(b, "#/collection/cartes", ls=empty)
    # série injoignable (fichier et TCGdex en direct) : correction en attente
    ctx.route("**/data/sets/sv03.5.json*", lambda r: r.abort())
    ctx.route("https://api.tcgdex.net/**", lambda r: r.abort())
    pg.wait_for_timeout(4500)
    pg.evaluate(IMPORT, sample)
    pg.wait_for_timeout(1500)
    pending = pg.evaluate(STATE)
    out = pg.evaluate("async () => JSON.parse((await import('./js/state/collection.js')).exportText())")
    check(pending["need"] and out.get("fixFin") == 1 and out["cards"]["sv03.5-199"]["qty"] == {"normal": 1},
          "export pendant la correction : fixFin gardé dans le fichier", (pending, out.get("fixFin")))
    ctx.close()
    ctx, pg, errs = boot(b, "#/collection/cartes", ls=empty)
    pg.wait_for_timeout(4500)
    pg.evaluate(IMPORT, json.dumps(out))
    wait_fixed(pg)
    st = pg.evaluate(STATE)
    check(st == FIXED, "export réimporté sur un autre appareil : finitions revues", st)
    check(not errs, "aucune erreur console (6b)", errs)
    ctx.close()
    b.close()
print("RESULTAT", "OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
