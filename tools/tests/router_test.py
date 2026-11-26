"""Scénarios de navigation contre la vraie appli (index.html + vues), dans Chromium (Playwright).

    python -P tools/tests/router_test.py            (port 8771 par défaut)
    python -P tools/tests/router_test.py --port 8780 --headed

Reprend les 23 scénarios de FINAL-design §4.3 bis (scripts-designcheck/router_fixed_test.py), adaptés à l'appli :
page.go_back() = le Retour d'Android ou du navigateur, les onglets et la flèche ← sont de vrais clics, les liens
internes sont de vrais <a href="#/…"> interceptés par main.js. Différence voulue avec le prototype : un lien profond
pose aussi ses parents (carte → série → Séries), donc le Retour système depuis la série ouverte par lien profond
revient d'abord à Séries, puis à Collection (scénario 19 en deux temps).
Ajoute : feuilles (Retour, Échap, ✕, fond, navigation depuis une feuille, rechargement), setParams, cache des vues,
focus et titre, onglet actif, collection vide (Scanner au départ), liens vers la racine d'un autre onglet ; puis la
coquille : thème (forcé avant le premier affichage, Réglages), pastille du Marché (WishDB), tuile corrigée en place
et « Annuler », mise à jour de l'appli (« Nouvelle version disponible · Recharger », service worker servi avec une
autre VERSION par le serveur du test), message si main.js ne se charge pas.
Les images et l'API TCGdex sont coupées (tests rapides et sans réseau). Code de sortie 1 si un scénario échoue.
"""
import argparse
import functools
import http.server
import json
import os
import re
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAMPLE = os.path.join(ROOT, "tools", "sample_collection.json")
BLOCK = re.compile(r"^https://(assets\.tcgdex\.net|images\.scrydex\.com|api\.tcgdex\.net|cdn\.jsdelivr\.net|tcgplayer-cdn\.tcgplayer\.com|raw\.githubusercontent\.com)/")

results = []


SW_VERSION = {"v": None}   # test de mise à jour : sw.js servi avec une autre VERSION (le fichier n'est pas modifié)
DELAY = {"re": None, "ms": 0}   # réponse ralentie côté serveur (courses : vue quittée pendant son chargement)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if DELAY["re"] and re.search(DELAY["re"], self.path):
            time.sleep(DELAY["ms"] / 1000)
        if SW_VERSION["v"] and self.path.split("?")[0] == "/sw.js":
            src = open(os.path.join(ROOT, "sw.js"), encoding="utf8").read()
            body = re.sub(r"^const VERSION = '[^']*';", f"const VERSION = '{SW_VERSION['v']}';", src, count=1, flags=re.M).encode("utf8")
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def serve(port):
    http.server.ThreadingHTTPServer.request_queue_size = 128   # file d'attente : 5 par défaut, Windows refuse les rafales
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def settle(p, ms=0):
    try:
        p.evaluate("() => window.__cardex && window.__cardex.settled()")
    except Exception:
        pass
    if ms:
        p.wait_for_timeout(ms)


def st(p):
    if not p.url.startswith("http://127.0.0.1"):
        return {"hash": "LEFT_APP:" + p.url, "state": None, "y": 0, "last": None, "n": 0}
    return p.evaluate("""() => ({ hash: location.hash, state: history.state, y: Math.round(scrollY),
        last: (window.__cardex?.log || []).slice(-1)[0] || null, n: (window.__cardex?.log || []).length,
        len: history.length, sheet: !!window.__cardex?.sheet.isOpen(),
        tab: [...document.querySelectorAll('.tabbar [aria-current="page"]')].map(a => a.dataset.tab).join(),
        back: !document.querySelector('.appbar .back').hidden, title: document.title,
        focus: document.activeElement?.id || document.activeElement?.tagName })""")


def check(label, p, ok_extra=True, **want):
    s = st(p)
    ok = bool(ok_extra)
    for k, v in want.items():
        if s.get(k) != v:
            ok = False
    results.append((label, ok))
    shown = {k: s.get(k) for k in ("hash", "last", "y", "tab", "sheet", "back") if k in s}
    print(f"{'PASS' if ok else 'FAIL'}  {label:<64} {json.dumps(shown, ensure_ascii=False)}")
    if not ok:
        print(f"      attendu : {json.dumps(want, ensure_ascii=False)}  (état complet : {json.dumps(s, ensure_ascii=False)[:400]})")
    return s


def tab(p, name):
    p.click(f'.tabbar [data-tab="{name}"]')
    settle(p, 60)


def back_arrow(p):
    p.click(".appbar .back")
    settle(p, 60)


def sys_back(p):
    p.go_back()
    settle(p, 60)


def js_click(p, sel):
    """Clic sur un lien sans faire défiler la page (Playwright ferait défiler l'élément à l'écran)."""
    p.wait_for_selector(sel, state="attached", timeout=15000)
    p.evaluate("s => document.querySelector(s).click()", sel)
    settle(p, 60)


def go(p, h):
    p.evaluate("h => window.__cardex.router.go(h)", h)
    settle(p, 60)


def scroll(p, y):
    p.evaluate("y => scrollTo(0, y)", y)
    p.wait_for_timeout(350)   # le routeur mémorise la position après une pause


SET_LINK = 'main a.row[href="#/serie/sv03.5"]'
CARD_LINK = 'main a.tile[href="#/carte/sv03.5-025"]'


def run(base, headed):
    sample = json.load(open(SAMPLE, encoding="utf8"))
    errs = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=not headed)

        def context(seed=True):
            c = b.new_context(viewport={"width": 390, "height": 844}, locale="fr-FR", service_workers="block")
            c.route(BLOCK, lambda r: r.abort())
            if seed:
                c.add_init_script("try { if (!localStorage.getItem('cardex.collection.v1')) localStorage.setItem('cardex.collection.v1', %s); } catch (e) {}" % json.dumps(json.dumps(sample)))
            return c

        c = context()

        def page(hash_=""):
            p = c.new_page()
            p.on("pageerror", lambda e: errs.append(str(e)))
            p.goto(base + hash_)
            p.wait_for_function("() => window.__cardex && document.documentElement.classList.contains('ready')", timeout=20000)
            settle(p, 100)
            return p

        # 1–6 parcours principal, défilement retrouvé, destination de départ, sortie
        p = page()
        check("1 lancement -> Collection", p, hash="#/collection/cartes", last="#/collection/cartes|collection", tab="collection", back=False)
        tab(p, "series"); p.wait_for_selector(SET_LINK, state="attached"); scroll(p, 1500)
        js_click(p, SET_LINK); p.wait_for_selector(CARD_LINK, state="attached"); scroll(p, 800)
        js_click(p, CARD_LINK)
        check("2 Séries > série > carte", p, hash="#/carte/sv03.5-025", last="#/carte/sv03.5-025|series", tab="series", back=True)
        sys_back(p); check("3 Retour -> série, défilement 800 retrouvé", p, hash="#/serie/sv03.5", y=800)
        sys_back(p); check("4 Retour -> Séries, défilement 1500 retrouvé", p, hash="#/series", y=1500, back=False)
        sys_back(p); check("5 Retour sur la racine Séries -> Collection", p, hash="#/collection/cartes", last="#/collection/cartes|collection", tab="collection")
        sys_back(p); check("6 Retour sur Collection -> quitte l'appli", p, hash="LEFT_APP:about:blank")
        p.close()

        # 7–9 l'onglet possède sa pile, même quand elle finit sur une carte
        p = page()
        tab(p, "series"); js_click(p, SET_LINK); js_click(p, CARD_LINK); tab(p, "market")
        check("7 Séries>série>carte, puis Marché", p, hash="#/marche/cotes", last="#/marche/cotes|market", tab="market")
        tab(p, "series"); check("8 retour sur Séries : la carte est retrouvée", p, hash="#/carte/sv03.5-025", last="#/carte/sv03.5-025|series", tab="series")
        tab(p, "collection"); tab(p, "market")
        check("9 Collection puis Marché : racine du Marché", p, hash="#/marche/cotes", last="#/marche/cotes|market")
        p.close()

        # 10–11 deux appuis dans la même image
        p = page(); tab(p, "series"); js_click(p, SET_LINK)
        p.evaluate("""() => { document.querySelector('.tabbar [data-tab="market"]').click(); document.querySelector('.tabbar [data-tab="collection"]').click(); }""")
        settle(p, 300)
        check("10 Marché + Collection dans la même image : reste dans l'appli", p, hash="#/marche/cotes", tab="market")
        p.close()
        p = page(); tab(p, "series"); js_click(p, SET_LINK)
        p.evaluate("() => { const b = document.querySelector('.appbar .back'); b.click(); b.click(); }")
        settle(p, 300)
        check("11 double appui sur ← : un seul pas", p, hash="#/series")
        p.close()

        # 12–13 fragment simple (hash tapé, lien hors routeur) adopté comme enfant
        p = page(); tab(p, "series"); js_click(p, SET_LINK)
        p.evaluate("() => { location.hash = '#/carte/sv03.5-001'; }"); settle(p, 200)
        s = check("12 hash tapé vers une carte : profondeur 2", p, hash="#/carte/sv03.5-001")
        ok = (s.get("state") or {}).get("d") == 2
        results.append(("12b état d = 2", ok)); print(f"{'PASS' if ok else 'FAIL'}  12b état d = 2 ({s.get('state')})")
        back_arrow(p); check("13 ← revient à la série", p, hash="#/serie/sv03.5")
        p.close()

        # 14–16 le rechargement garde les piles
        p = page(); tab(p, "series"); js_click(p, SET_LINK); js_click(p, CARD_LINK)
        p.reload(); p.wait_for_function("() => window.__cardex && document.documentElement.classList.contains('ready')"); settle(p, 100)
        check("14 rechargement à la profondeur 2 : onglet gardé", p, hash="#/carte/sv03.5-025", last="#/carte/sv03.5-025|series", tab="series")
        tab(p, "market"); tab(p, "series")
        check("15 après rechargement, mémoire de l'onglet retrouvée", p, hash="#/carte/sv03.5-025", last="#/carte/sv03.5-025|series")
        sys_back(p); check("16 Retour -> série", p, hash="#/serie/sv03.5")
        p.close()

        # 17–19 liens profonds
        p = page("#/carte/sv03.5-025")
        check("17 lien profond vers une carte : onglet Séries", p, hash="#/carte/sv03.5-025", last="#/carte/sv03.5-025|series", tab="series", back=True)
        back_arrow(p); check("18 ← sur le lien profond -> la série", p, hash="#/serie/sv03.5")
        sys_back(p); check("19a Retour système -> Séries (parent posé dessous)", p, hash="#/series", tab="series")
        sys_back(p); check("19b Retour système -> Collection", p, hash="#/collection/cartes", tab="collection")
        p.close()
        p = page("#wishlist")
        check("20 ancien lien #wishlist -> Envies", p, hash="#/marche/envies", last="#/marche/envies|market", tab="market")
        p.close()

        # 21–23 feuille + Retour, carte -> Pokémon dans la pile de Séries
        p = page(); tab(p, "series"); js_click(p, SET_LINK)
        n0 = st(p)["n"]
        p.click(".appbar .more"); p.wait_for_selector("dialog.sheet[open]"); settle(p, 50)
        s = st(p)
        ok = s["sheet"] and (s.get("state") or {}).get("sheet") == 1 and s["hash"] == "#/serie/sv03.5"
        results.append(("21a ⋯ ouvre une feuille avec son entrée d'historique", ok)); print(f"{'PASS' if ok else 'FAIL'}  21a ⋯ ouvre une feuille avec son entrée d'historique")
        sys_back(p); p.wait_for_timeout(300)
        s = check("21 feuille + Retour : fermée, pas de nouveau rendu", p, hash="#/serie/sv03.5", sheet=False)
        ok = s["n"] == n0 and not p.evaluate("document.getElementById('sheet').open")
        results.append(("21b aucun rendu ajouté", ok)); print(f"{'PASS' if ok else 'FAIL'}  21b aucun rendu ajouté ({s['n'] - n0})")
        js_click(p, CARD_LINK); go(p, "#/pokemon/6")
        check("22 carte -> page Pokémon : reste dans la pile de Séries", p, hash="#/pokemon/6", last="#/pokemon/6|series", tab="series")
        sys_back(p); check("23 Retour -> la carte", p, hash="#/carte/sv03.5-025")
        p.close()

        # ---------- ajouts : feuilles ----------
        p = page(); tab(p, "series"); js_click(p, SET_LINK)
        len0 = st(p)["len"]
        for how in ("Échap", "✕", "fond"):
            n0 = st(p)["n"]
            p.click(".appbar .more"); p.wait_for_selector("dialog.sheet[open]"); settle(p, 50)
            if how == "Échap":
                p.keyboard.press("Escape")
            elif how == "✕":
                p.click("dialog.sheet .sheet-x")
            else:
                p.mouse.click(195, 40)   # au-dessus de la feuille : le fond
            p.wait_for_function("() => !document.getElementById('sheet').open", timeout=3000)
            settle(p, 50)
            s = st(p)
            ok = (not s["sheet"]) and s["hash"] == "#/serie/sv03.5" and not (s.get("state") or {}).get("sheet") and s["n"] == n0
            results.append((f"24 feuille fermée par {how}", ok))
            print(f"{'PASS' if ok else 'FAIL'}  24 feuille fermée par {how} (entrée retirée, pas de rendu) {json.dumps(s.get('state'))}")
        sys_back(p); check("25 après 3 feuilles, Retour -> Séries (aucune entrée fantôme)", p, hash="#/series")
        p.close()

        p = page(); tab(p, "series"); js_click(p, SET_LINK)
        p.click(".appbar .more"); p.wait_for_selector("dialog.sheet[open]")
        p.click("dialog.sheet .menu .row:last-child"); settle(p, 250)
        check("26 menu ⋯ -> « Réglages et sauvegarde » : page Réglages", p, hash="#/reglages", sheet=False, back=True)
        sys_back(p); check("27 Retour -> la série (pas la feuille)", p, hash="#/serie/sv03.5", sheet=False)
        p.close()

        p = page(); tab(p, "series"); js_click(p, SET_LINK)
        p.click(".appbar .more"); p.wait_for_selector("dialog.sheet[open]")
        p.reload(); p.wait_for_function("() => window.__cardex && document.documentElement.classList.contains('ready')"); settle(p, 100)
        s = check("28 rechargement sur une feuille : entrée retirée", p, hash="#/serie/sv03.5", sheet=False)
        ok = not (s.get("state") or {}).get("sheet")
        results.append(("28b état sans feuille", ok)); print(f"{'PASS' if ok else 'FAIL'}  28b état sans feuille {json.dumps(s.get('state'))}")
        sys_back(p); check("28c Retour -> Séries", p, hash="#/series")
        p.close()

        # ---------- ajouts : setParams (filtres dans l'URL, sans nouvelle entrée) ----------
        p = page(); tab(p, "series")
        len0 = st(p)["len"]
        p.fill('main input[name="q"]', "flammes"); p.wait_for_timeout(400); settle(p)
        s = check("29 recherche -> ?q= dans l'URL, sans nouvelle entrée", p, hash="#/series?q=flammes")
        ok = s["len"] == len0
        results.append(("29b history.length inchangé", ok)); print(f"{'PASS' if ok else 'FAIL'}  29b history.length inchangé ({len0} -> {s['len']})")
        n_rows = p.evaluate("document.querySelectorAll('#v-sets a.row').length")
        p.click('main .chip[data-f="miennes"]'); settle(p)
        check("30 puce -> ?q=…&filtre=miennes", p, hash="#/series?q=flammes&filtre=miennes")
        p.click('main .chip[data-f=""]'); settle(p)
        shows = p.evaluate("__cardex.views.get('sets').shows")
        js_click(p, 'main a.row[href^="#/serie/"]'); sys_back(p)
        check("31 série puis Retour : filtres retrouvés", p, hash="#/series?q=flammes")
        ok = p.evaluate("__cardex.views.get('sets').shows") == shows and p.evaluate("document.querySelectorAll('#v-sets a.row').length") == n_rows
        results.append(("31b vue gardée en cache (pas de nouveau rendu)", ok)); print(f"{'PASS' if ok else 'FAIL'}  31b vue gardée en cache (pas de nouveau rendu)")
        p.reload(); p.wait_for_function("() => window.__cardex && document.documentElement.classList.contains('ready')"); settle(p, 100)
        ok = p.input_value('main input[name="q"]') == "flammes"
        check("32 rechargement : route et filtres retrouvés", p, ok_extra=ok, hash="#/series?q=flammes")
        p.click(".appbar .more"); p.wait_for_selector("dialog.sheet[open]")
        p.evaluate("() => window.__cardex.router.setParams({ filtre: 'en-cours' })")
        p.keyboard.press("Escape"); p.wait_for_function("() => !document.getElementById('sheet').open"); settle(p, 50)
        s = check("33 setParams pendant une feuille : appliqué à la page dessous", p, hash="#/series?q=flammes&filtre=en-cours", sheet=False)
        sys_back(p); check("33b Retour -> Collection (aucune entrée en trop)", p, hash="#/collection/cartes")
        p.close()

        # ---------- ajouts : onglets, focus, titre, cache ----------
        p = page(); tab(p, "series"); js_click(p, SET_LINK)
        s = check("34 sous-page : ←, titre du document, focus sur le titre", p, back=True, focus="bar-title")
        ok = s["title"].endswith(" · Cardex") and s["title"] != "Série · Cardex"
        results.append(("34b document.title = « <titre> · Cardex »", ok)); print(f"{'PASS' if ok else 'FAIL'}  34b document.title = {s['title']!r}")
        js_click(p, CARD_LINK)
        shows = p.evaluate("__cardex.views.get('set').shows")
        sys_back(p)
        ok = p.evaluate("__cardex.views.get('set').shows") == shows
        check("35 Retour sur la même série : pas de nouveau rendu", p, ok_extra=ok, hash="#/serie/sv03.5")
        tab(p, "series"); check("36 appui sur l'onglet actif -> sa racine", p, hash="#/series", back=False, tab="series")
        scroll(p, 900); tab(p, "series"); p.wait_for_timeout(700)
        check("37 appui sur l'onglet actif à la racine -> haut de page", p, hash="#/series", y=0)
        tab(p, "collection"); js_click(p, 'main .ptabs a[href="#/collection/pokedex"]')
        len1 = st(p)["len"]
        js_click(p, 'main .ptabs a[href="#/collection/doubles"]')
        s = check("38 onglets principaux : remplacement (pas de nouvelle entrée)", p, hash="#/collection/doubles", tab="collection")
        ok = s["len"] == len1 and p.evaluate("document.querySelector('#v-collection .ptabs [aria-current=\"page\"]')?.getAttribute('href')") == "#/collection/doubles"
        results.append(("38b aria-current sur la section", ok)); print(f"{'PASS' if ok else 'FAIL'}  38b aria-current sur la section, history.length {len1} -> {s['len']}")
        p.close()

        # hash venu de l'extérieur vers la racine d'un autre onglet (notification), lien vers la racine d'un autre onglet
        p = page(); tab(p, "series"); js_click(p, SET_LINK)
        p.evaluate("() => { location.hash = '#/decks/actuelle'; }"); settle(p, 300)
        check("39 hash externe vers la racine d'un autre onglet : change d'onglet", p, hash="#/decks/actuelle", tab="decks", last="#/decks/actuelle|decks")
        sys_back(p); check("39b Retour -> Collection", p, hash="#/collection/cartes")
        p.close()
        p = page("#/scanner")
        js_click(p, 'main a[href="#/series"]')
        check("40 lien vers la racine d'un autre onglet : change d'onglet", p, hash="#/series", tab="series", last="#/series|series")
        sys_back(p); check("40b Retour -> Collection", p, hash="#/collection/cartes", tab="collection")
        p.close()
        c.close()

        # collection vide : départ sur Scanner, Collection dessous
        c = context(seed=False)
        p = c.new_page(); p.on("pageerror", lambda e: errs.append(str(e)))
        p.goto(base); p.wait_for_function("() => window.__cardex && document.documentElement.classList.contains('ready')"); settle(p, 100)
        check("41 collection vide : départ sur Scanner", p, hash="#/scanner", tab="scan", back=False)
        sys_back(p); check("41b Retour -> Collection", p, hash="#/collection/cartes", tab="collection")
        sys_back(p); check("41c Retour -> quitte l'appli", p, hash="LEFT_APP:about:blank")
        c.close()
        shell(b, base, sample, errs)
        fixes(b, base, sample, errs)
        b.close()

    print("erreurs JavaScript :", errs or "aucune")
    ok = sum(1 for _, r in results if r)
    print(f"{ok}/{len(results)} réussis")
    return 0 if ok == len(results) and not errs else 1


def rec(label, ok, info=""):
    results.append((label, bool(ok)))
    print(f"{'PASS' if ok else 'FAIL'}  {label}{f'  ({info})' if info != '' else ''}")


def shell(b, base, sample, errs):
    """Le reste de la coquille : thème, pastille du Marché, mise à jour des tuiles, mise à jour de l'appli, démarrage raté."""
    seed = "try { if (!localStorage.getItem('cardex.collection.v1')) localStorage.setItem('cardex.collection.v1', %s); localStorage.setItem('cardex.wishCheck.v1', String(Date.now())); } catch (e) {}" % json.dumps(json.dumps(sample))

    def ctx(**kw):
        c = b.new_context(viewport={"width": 390, "height": 844}, locale="fr-FR", **kw)
        c.route(BLOCK, lambda r: r.abort())
        c.add_init_script(seed)
        return c

    def ready(p):
        p.wait_for_function("() => window.__cardex && document.documentElement.classList.contains('ready')", timeout=20000)
        settle(p, 100)

    # thème : forcé avant le premier affichage, puis changé dans Réglages
    c = ctx(color_scheme="light")
    c.add_init_script("try { localStorage.setItem('cardex.prefs.v1', JSON.stringify({ theme: 'dark' })); } catch (e) {}")
    p = c.new_page(); p.on("pageerror", lambda e: errs.append(str(e)))
    first = {}
    p.on("domcontentloaded", lambda: first.update(p.evaluate("() => ({ t: document.documentElement.dataset.theme, m: [...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content).join() })")))
    p.goto(base + "#/reglages"); ready(p)
    look = "() => ({ t: document.documentElement.dataset.theme || 'auto', m: [...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content).join(), bg: getComputedStyle(document.body).backgroundColor })"
    s = p.evaluate(look)
    rec("50 thème sombre forcé avant le premier affichage", first.get("t") == "dark" and s["t"] == "dark" and s["m"] == "#0e0e11,#0e0e11" and s["bg"] == "rgb(14, 14, 17)", f"{first} {s}")
    p.click('[data-theme-set="light"]'); p.wait_for_timeout(100); s = p.evaluate(look)
    rec("51 Réglages › Clair", s["t"] == "light" and s["m"] == "#f6f6f7,#f6f6f7" and s["bg"] == "rgb(246, 246, 247)", s)
    p.click('[data-theme-set="auto"]'); p.wait_for_timeout(100); s = p.evaluate(look)
    rec("52 Réglages › Auto (suit le système)", s["t"] == "auto" and s["m"] == "#f6f6f7,#0e0e11" and s["bg"] == "rgb(246, 246, 247)", s)
    c.close()

    # pastille du Marché : une envie dans sa fourchette (WishDB), puis retirée
    c = ctx()
    p = c.new_page(); p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(base); ready(p)
    p.wait_for_timeout(1500)   # tâches de fond (abonnement à WishDB)
    p.evaluate("""() => window.WishDB.put({ key: 'sv03.5-025|normal', id: 'sv03.5-025', v: 2, name: 'Pikachu', setName: '151', setId: 'sv03.5',
        localId: '025', image: '', variant: 'normal', min: 0, max: 1, low: 0.2, trend: 0.25, checkedAt: Date.now(), inRange: true, createdAt: Date.now() })""")
    p.wait_for_timeout(400)
    s = p.evaluate("() => { const t = document.querySelector('.tabbar [data-tab=market]'); return { bdg: !t.querySelector('.bdg').hidden, name: t.textContent.replace(/\\s+/g, ' ').trim() }; }")
    rec("53 envie dans sa fourchette -> pastille sur Marché", s["bdg"] and "fourchette" in s["name"], s)
    tab(p, "market"); js_click(p, 'main .ptabs a[href="#/marche/envies"]')
    rec("54 point sur l'onglet Envies", p.evaluate("!!document.querySelector('#v-market .ptabs a[href=\"#/marche/envies\"] .dot')"))
    p.evaluate("() => window.WishDB.del('sv03.5-025|normal')"); p.wait_for_timeout(400)
    s = p.evaluate("() => ({ bdg: !document.querySelector('.tabbar [data-tab=market] .bdg').hidden, dot: !!document.querySelector('#v-market .ptabs .dot') })")
    rec("55 envie retirée -> plus de pastille", not s["bdg"] and not s["dot"], s)
    c.close()

    # changement de la collection : la tuile de la série est corrigée en place (sans nouveau rendu), « Annuler » marche
    c = ctx()
    p = c.new_page(); p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(base + "#/serie/sv03.5"); ready(p)
    tile = 'main a.tile[href="#/carte/sv03.5-002"]'
    p.wait_for_selector(tile, state="attached")
    miss0 = p.evaluate("s => document.querySelector(s).classList.contains('missing')", tile)
    shows = p.evaluate("__cardex.views.get('set').shows")
    js_click(p, tile); p.wait_for_selector('#v-card [data-f="normal"] [data-step="1"]')
    p.click('#v-card [data-f="normal"] [data-step="1"]'); p.wait_for_timeout(150)
    t = p.evaluate("() => ({ msg: document.querySelector('.toast .msg')?.textContent, act: document.querySelector('.toast .act')?.textContent })")
    rec("56 + sur la fiche -> toast avec « Annuler »", t["act"] == "Annuler" and "Ajoutée en Normale" in (t["msg"] or ""), t)
    sys_back(p)
    s = p.evaluate("s => { const t = document.querySelector(s); return { missing: t.classList.contains('missing'), label: t.getAttribute('aria-label') }; }", tile)
    rec("57 Retour : la tuile n'est plus « manquante », sans nouveau rendu", miss0 and not s["missing"] and p.evaluate("__cardex.views.get('set').shows") == shows and "possédée" in s["label"], s)
    js_click(p, tile); p.click('#v-card [data-f="normal"] [data-step="1"]'); p.wait_for_timeout(150)
    p.click(".toast .act"); p.wait_for_timeout(150)
    rec("58 « Annuler » rend la quantité d'avant", p.evaluate("__cardex && document.querySelector('#v-card [data-f=normal] .v').textContent") == "1")
    c.close()

    # mise à jour de l'appli : « Nouvelle version disponible · Recharger », puis rechargement sur la nouvelle version
    SW_VERSION["v"] = "test-1"
    c = b.new_context(viewport={"width": 390, "height": 844}, locale="fr-FR", service_workers="allow")
    c.add_init_script(seed)
    c.route(BLOCK, lambda r: r.abort())
    p = c.new_page(); p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(base); ready(p)
    try:
        p.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=15000)
        ctrl = True
    except Exception:
        ctrl = False
    rec("59 service worker installé et aux commandes", ctrl)
    SW_VERSION["v"] = "test-2"
    p.evaluate("() => navigator.serviceWorker.getRegistration().then(r => r && r.update())")
    try:
        p.wait_for_selector(".toast .act", timeout=15000)
        t = p.evaluate("() => ({ msg: document.querySelector('.toast .msg').textContent, act: document.querySelector('.toast .act').textContent })")
    except Exception:
        t = {}
    rec("60 nouvelle version -> toast « Nouvelle version disponible · Recharger »", t.get("msg") == "Nouvelle version disponible" and t.get("act") == "Recharger", t)
    if t:
        with p.expect_navigation(timeout=15000):
            p.click(".toast .act")
        ready(p)
        v = p.evaluate("""() => new Promise(res => { const ch = new MessageChannel(); navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'version') res(e.data.version); }, { once: true });
            navigator.serviceWorker.controller.postMessage({ type: 'version' }); setTimeout(() => res(null), 3000); })""")
        rec("61 « Recharger » : page rechargée sur la nouvelle version", v == "test-2", v)
    c.close()
    SW_VERSION["v"] = None

    # démarrage raté (fichier manquant) : un message plutôt qu'une page vide
    c = ctx()
    c.route(re.compile(r".*/js/main\.js$"), lambda r: r.fulfill(status=404, body="absent"))
    p = c.new_page()
    p.goto(base)
    try:
        p.wait_for_selector("#boot-fail", timeout=5000)
        ok = "pas pu démarrer" in p.inner_text("#boot-fail")
    except Exception:
        ok = False
    rec("62 main.js introuvable -> « Cardex n’a pas pu démarrer » + Recharger", ok)
    c.close()


def fixes(b, base, sample, errs):
    """Scénarios de la relecture du 25/11 : courses de la barre, feuille + autre onglet, hash ancien ou inconnu,
    ids avec « % », onglets principaux collants, focus d'une action, toast persistant, messages d'erreur, démarrage."""
    seed = "try { if (!localStorage.getItem('cardex.collection.v1')) localStorage.setItem('cardex.collection.v1', %s); localStorage.setItem('cardex.wishCheck.v1', String(Date.now())); } catch (e) {}" % json.dumps(json.dumps(sample))

    def ctx(**kw):
        c = b.new_context(viewport={"width": 390, "height": 844}, locale="fr-FR", service_workers="block", **kw)
        c.route(BLOCK, lambda r: r.abort())
        c.add_init_script(seed)
        return c

    def page(c, h=""):
        p = c.new_page()
        p.on("pageerror", lambda e: errs.append(str(e)))
        p.goto(base + h)
        p.wait_for_function("() => window.__cardex && document.documentElement.classList.contains('ready')", timeout=20000)
        settle(p, 100)
        return p

    bar = """() => ({ hash: location.hash, title: document.getElementById('bar-title').textContent, back: !document.querySelector('.appbar .back').hidden,
        doc: document.title, view: document.documentElement.dataset.view, sheet: !!window.__cardex.sheet.isOpen(),
        dlg: document.getElementById('sheet').open, d: history.state && history.state.d, vis: document.querySelector('main .view:not([hidden])')?.id })"""

    # 70–73 une vue quittée pendant son chargement ne touche plus à la barre (ni maintenant, ni au retour du cache)
    c = ctx(); p = page(c, "#/series")
    DELAY.update(re=r"/data/sets/sv02\.json", ms=1500)
    p.evaluate("() => { window.__cardex.router.go('#/serie/sv02'); setTimeout(() => history.back(), 250); }")
    p.wait_for_timeout(2600); settle(p)
    s = p.evaluate(bar)
    rec("70 série lente, Retour avant la fin : barre de Séries intacte", s["hash"] == "#/series" and s["title"] == "Séries" and not s["back"], s)
    DELAY.update(re=None, ms=0)
    go(p, "#/serie/sv03.5"); sys_back(p)
    s = p.evaluate(bar)
    rec("71 puis une autre série et Retour : Séries sans ← (cache sain)", s["hash"] == "#/series" and s["title"] == "Séries" and not s["back"], s)
    DELAY.update(re=r"/data/sets/sv02\.json", ms=1500)
    p.evaluate("() => { window.__cardex.router.go('#/carte/sv02-001'); setTimeout(() => document.querySelector('.tabbar [data-tab=\"market\"]').click(), 250); }")
    p.wait_for_timeout(2600); settle(p)
    s = p.evaluate(bar)
    rec("72 fiche lente, onglet Marché avant la fin : barre du Marché intacte", s["hash"] == "#/marche/cotes" and s["title"] == "Marché" and not s["back"], s)
    DELAY.update(re=None, ms=0)
    tab(p, "series"); p.wait_for_timeout(300); settle(p)
    s = p.evaluate(bar)
    rec("73 retour sur Séries : la fiche abandonnée est refaite (titre de la carte, ←)", s["hash"] == "#/carte/sv02-001" and s["back"] and s["title"] not in ("Carte", "Marché", ""), s)
    c.close()

    # 74–77 feuille ouverte + lien vers la racine d'un autre onglet, puis Retour ; « Voir » d'un toast ; onglet actif
    c = ctx(); p = page(c, "#/collection/cartes")
    p.evaluate("""async () => { const s = await import('./js/core/sheet.js'); const d = await import('./js/core/dom.js');
        s.openSheet({ title: 'Pas la bonne ?', body: d.html`<a id="lnk" href="#/series?q=pikachu">Chercher par nom</a>` }); }""")
    settle(p, 300); p.click("#lnk"); settle(p, 400)
    s = p.evaluate(bar)
    rec("74 lien d'une feuille vers Séries : feuille fermée, Séries affichée", s["hash"] == "#/series?q=pikachu" and s["vis"] == "v-sets" and not s["sheet"] and not s["dlg"] and s["d"] == 0, s)
    sys_back(p); s = p.evaluate(bar)
    rec("75 puis Retour -> Collection (écran et adresse d'accord)", s["hash"] == "#/collection/cartes" and s["vis"] == "v-collection" and s["title"] == "Collection", s)
    p.evaluate("""() => { window.__cardex.sheet.infoSheet('Info', 'texte');
        window.__cardex.toast('Pikachu est dans ta fourchette', { action: 'Voir', onAction: () => window.__cardex.router.openRoot('#/marche/envies') }); }""")
    settle(p, 300); p.click(".toast .act"); settle(p, 400)
    s = p.evaluate(bar)
    rec("76 « Voir » d'un toast pendant une feuille : Envies, feuille fermée", s["hash"] == "#/marche/envies" and s["vis"] == "v-market" and not s["dlg"], s)
    sys_back(p); s = p.evaluate(bar)
    rec("76b puis Retour -> Collection", s["hash"] == "#/collection/cartes" and s["vis"] == "v-collection", s)
    tab(p, "series"); go(p, "#/serie/sv03.5")
    p.click(".appbar .more"); p.wait_for_selector("dialog.sheet[open]")
    p.evaluate("() => window.__cardex.router.switchTab('series')"); settle(p, 300)
    s = p.evaluate(bar)
    rec("77 onglet actif touché pendant une feuille (sous-page) : racine affichée", s["hash"] == "#/series?q=pikachu" and s["vis"] == "v-sets" and not s["back"] and not s["dlg"] and s["d"] == 0, s)
    c.close()

    # 78–80 hash ancien ou inconnu tapé
    c = ctx(); p = page(c)
    tab(p, "market")
    p.evaluate("() => { location.hash = '#wishlist'; }"); settle(p, 300)
    s = p.evaluate(bar)
    rec("78 #wishlist tapé pendant le Marché -> Envies, pas d'entrée en plus", s["hash"] == "#/marche/envies" and s["d"] == 0, s)
    sys_back(p); s = p.evaluate(bar)
    rec("78b puis Retour -> Collection", s["hash"] == "#/collection/cartes", s)
    tab(p, "series")
    p.evaluate("() => { location.hash = '#/nimporte/quoi'; }"); settle(p, 300)
    s = p.evaluate(bar)
    rec("79 hash inconnu tapé : annulé, Séries reste (profondeur 0)", s["hash"] == "#/series" and s["d"] == 0 and s["vis"] == "v-sets", s)
    sys_back(p); s = p.evaluate(bar)
    rec("80 puis Retour -> Collection (pas de doublon de Séries)", s["hash"] == "#/collection/cartes", s)
    c.close()

    # 81–84 ids avec « % » (exu-%3F) : lien encodé une fois, décodé une fois ; ancien lien non encodé ; « % » isolé
    c = ctx(); p = page(c, "#/serie/exu")
    t = "main a.tile[data-card=\"exu-%3F\"]"
    p.wait_for_selector(t, state="attached")
    s = p.evaluate("s => { const a = document.querySelector(s); return { href: a.getAttribute('href'), label: a.getAttribute('aria-label'), cap: a.querySelector('.cap').textContent }; }", t)
    rec("81 tuile exu-%3F : lien encodé, « ? » dans le nom accessible et la légende", s["href"] == "#/carte/exu-%253F" and ", ?," in s["label"] and "%" not in s["label"] and "%" not in s["cap"], s)
    js_click(p, t); p.wait_for_timeout(300)
    s = p.evaluate(bar)
    rec("82 clic -> fiche Zarbi (pas « introuvable »)", s["title"] == "Zarbi" and s["back"], s)
    c.close()
    c = ctx(); p = page(c, "#/carte/exu-%3F")
    s = p.evaluate(bar)
    rec("83 ancien lien profond #/carte/exu-%3F -> fiche Zarbi", s["title"] == "Zarbi", s)
    n_err = len(errs)
    p.evaluate("() => { location.hash = '#/carte/abc%'; }"); settle(p, 600)
    s = p.evaluate(bar)
    txt = p.evaluate("() => document.querySelector('main .view:not([hidden])').innerText")
    rec("84 #/carte/abc% : pas d'exception, message de la fiche", len(errs) == n_err and "Écran indisponible" not in txt and s["vis"] == "v-card", s)
    c.close()

    # 85–86 onglets principaux collés sous la barre, cibles de 44 px
    c = ctx(); p = page(c, "#/collection/cartes")
    p.evaluate("() => scrollTo(0, 400)"); p.wait_for_timeout(300)
    s = p.evaluate("""() => { const t = document.querySelector('#v-collection .ptabs'); return { top: Math.round(t.getBoundingClientRect().top),
        bar: Math.round(document.querySelector('.appbar').getBoundingClientRect().bottom), y: Math.round(scrollY),
        h: [...t.querySelectorAll('a')].map(a => Math.round(a.getBoundingClientRect().height)),
        shadow: getComputedStyle(document.querySelector('.appbar')).boxShadow }; }""")
    rec("85 onglets principaux collés sous la barre après défilement", s["y"] >= 300 and s["top"] == s["bar"] and s["shadow"] == "none", s)
    rec("86 onglets principaux : 44 px de haut", all(h >= 44 for h in s["h"]), s["h"])
    c.close()

    # 87 updateAction garde le focus clavier ; 88 le toast persistant revient après un toast passager
    c = ctx(); p = page(c, "#/produit/719691")
    p.focus(".appbar .acts [data-act='0']")
    p.evaluate("async () => { const a = await import('./js/core/appbar.js'); a.updateAction(0, { pressed: true, icon: 'star-fill', label: 'Ne plus suivre' }); }")
    s = p.evaluate("() => { const e = document.activeElement; return { act: e?.dataset?.act ?? null, pressed: e?.getAttribute('aria-pressed'), label: e?.getAttribute('aria-label'), use: e?.querySelector('use')?.getAttribute('href') }; }")
    rec("87 updateAction : bouton mis à jour en place, focus gardé", s == {"act": "0", "pressed": "true", "label": "Ne plus suivre", "use": "#i-star-fill"}, s)
    p.evaluate("() => { window.__cardex.toast('Nouvelle version disponible', { action: 'Recharger', ms: 0 }); window.__cardex.toast('Ajoutée', { ms: 600 }); }")
    first = p.evaluate("() => document.querySelector('.toast .msg')?.textContent")
    p.wait_for_timeout(3200)
    again = p.evaluate("() => [...document.querySelectorAll('.toast:not(.out) .msg')].map(m => m.textContent)")
    rec("88 toast persistant mis de côté puis revenu", first == "Ajoutée" and again == ["Nouvelle version disponible"], [first, again])
    c.close()

    # 89–90 messages d'erreur : module absent / erreur dans la vue ; 91 une vue sans onChange n'est pas redessinée
    c = ctx()
    c.route(re.compile(r".*/js/views/deck\.js$"), lambda r: r.fulfill(status=404, body="absent"))
    p = page(c, "#/decks/actuelle")
    go(p, "#/deck/1")
    txt = p.evaluate("() => document.querySelector('#v-deck').innerText")
    rec("89 module de vue absent : « Un fichier de l’appli n’a pas pu être chargé »", "pas pu être chargé" in txt and "Réessayer" in txt, " ".join(txt.split())[:80])
    c.close()
    c = ctx(); p = page(c, "#/series")
    go(p, "#/serie/sv03.5")
    p.evaluate("() => { const v = window.__cardex.views.get('set'); v.mod._show = v.mod.show; v.mod.show = async () => { throw new Error('essai'); }; }")
    go(p, "#/serie/sv02")
    txt = p.evaluate("() => document.querySelector('#v-set').innerText")
    rec("90 erreur dans la vue : « Cet écran n’a pas pu s’afficher » + Réessayer", "pas pu s’afficher" in txt and "pas pu être chargé" not in txt, " ".join(txt.split())[:80])
    p.evaluate("() => { const v = window.__cardex.views.get('set'); v.mod.show = v.mod._show; }")
    p.click("#v-set [data-retry]"); settle(p, 600)
    s = p.evaluate("() => ({ err: !!document.querySelector('#v-set .view-err'), failed: document.querySelector('#v-set').classList.contains('failed'), tiles: document.querySelectorAll('#v-set a.tile').length })")
    rec("90b Réessayer : la série s'affiche (structure de la vue gardée)", not s["err"] and not s["failed"] and s["tiles"] > 0, s)
    tab(p, "scan")
    shows = p.evaluate("__cardex.views.get('scan').shows")
    p.evaluate("async () => { const col = await import('./js/state/collection.js'); col.add({ id: 'sv03.5-004', localId: '004', name: 'Bulbizarre', setId: 'sv03.5', image: '' }, 'normal', 1); }")
    p.wait_for_timeout(300); settle(p)
    rec("91 vue sans onChange (Scanner) : pas redessinée sous les yeux", p.evaluate("__cardex.views.get('scan').shows") == shows and p.evaluate("__cardex.views.get('scan').stale"))
    c.close()

    # 92 démarrage : data/cardimg.json lent -> Séries et Collection s'affichent sans l'attendre (au plus 600 ms)
    DELAY.update(re=r"/data/cardimg\.json", ms=5000)
    for h, sel, limit in (("#/series", "#v-sets a.row", 1500), ("#/collection/cartes", "#v-collection a.tile", 2000)):
        c = ctx(); p = c.new_page(); p.on("pageerror", lambda e: errs.append(str(e)))
        p.goto(base + h)
        try:
            p.wait_for_selector(sel, timeout=4000)
            ms = p.evaluate("() => Math.round(performance.now())")
        except Exception:
            ms = None
        rec(f"92 {h} : premier contenu sans attendre la table des images", ms is not None and ms < limit, f"{ms} ms")
        c.close()
    DELAY.update(re=None, ms=0)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # console Windows (cp1252)
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8771)
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args()
    httpd = serve(a.port)
    try:
        code = run(f"http://127.0.0.1:{a.port}/index.html", a.headed)
    finally:
        httpd.shutdown()
    sys.exit(code)


if __name__ == "__main__":
    main()
