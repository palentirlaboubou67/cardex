"""Captures d'écran et mesures de Cardex, route par route, dans un vrai navigateur (Playwright + Chromium).

  python -P tools/shots.py                          toutes les étapes, thème clair, 390 px
  python -P tools/shots.py --width 320,390,1280     plusieurs largeurs (1280 : hauteur 800, sinon 844)
  python -P tools/shots.py --themes light,dark      les deux thèmes (--dark : sombre seulement)
  python -P tools/shots.py --only serie,carte       certaines étapes (noms) ou certains fichiers d'étapes (shell, …)
  python -P tools/shots.py --out DOSSIER            dossier de sortie (défaut : tools/shots/, ignoré par git)
  python -P tools/shots.py --sw                     service worker autorisé (bloqué par défaut)
  python -P tools/shots.py --cpu 4                  processeur ralenti ×4 (CDP)
  python -P tools/shots.py --big 2000               collection de 2 000 cartes tirées de data/cards-index.json
  python -P tools/shots.py --full                   capture de toute la page (sinon : l'écran)
  python -P tools/shots.py --port 8771              port du serveur local (chaque agent a le sien)
  python -P tools/shots.py --fresh                  sans le cache HTTP partagé (.cache/shots-profile)

Sert le dépôt sur http://127.0.0.1:<port>, remplit une collection d'exemple (tools/sample_collection.json, ou --big),
puis joue les étapes de tools/shotsteps/*.json (fichiers lus par ordre de nom ; chacun contient un tableau d'étapes
ou {"steps": [...]}). Une étape :
  {"name": "serie", "hash": "#/serie/sv03.5", "root": false, "wait": 800, "content": "sélecteur CSS",
   "actions": [["click", sel], ["fill", sel, texte], ["wait", ms], ["eval", js], ["waitfor", sel], ["key", touche], ["back"]]}
  - hash : ouvert comme le ferait une personne (onglet, puis lien) ; sans hash, l'étape part de l'état laissé par la
    précédente (les actions font le reste) ;
  - root : racine d'onglet ou non (déduit de la route si absent) ;
  - content : premier contenu mesuré (défaut : .tile, .row, [data-content] dans la vue affichée).
Mesures de chaque étape : débordement horizontal (scrollWidth > largeur utile), éléments qui sortent de l'écran
dans la vue (main { overflow-x: clip } les cacherait au premier test), éléments qui dépassent leur tuile ou leur ligne
(content-visibility: auto les coupe), haut du premier contenu (≤ 260 px sur une racine), onglets principaux collés
sous la barre après défilement, ← présente sur une sous-page et absente d'une racine, titre « … · Cardex »,
erreurs JavaScript, requêtes en échec. Écrit report.json dans le dossier de sortie.
Code de sortie 1 s'il y a une erreur JavaScript, une règle non tenue, un fichier local absent (404) ou une requête en
échec, sauf les absences permises de ALLOW_MISSING (liste commentée ci-dessous) et les images distantes en échec
(la chaîne de secours des images de cartes essaie des URL qui peuvent manquer : listées à part ; --strict-images les
compte aussi) et les pannes d'un service distant (TCGdex qui limite le débit : réponse 429/5xx sans en-tête CORS,
erreur réseau ; listées à part, --strict-remote les compte). Un 4xx lisible d'un service distant fait échouer.
Les passes (largeurs × thèmes) partagent un profil Chromium dans .cache/shots-profile (ignoré par git) : les images
de TCGdex ne sont téléchargées qu'une fois (moins de requêtes, pas de limitation de débit qui ferait échouer les images).
Stockage local, IndexedDB, caches et service workers sont vidés au début de chaque passe.
Installation : python -m pip install --user playwright && python -m playwright install chromium
"""
import argparse
import functools
import glob
import http.server
import json
import os
import random
import re
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, "tools", "sample_collection.json")
STEPS_DIR = os.path.join(ROOT, "tools", "shotsteps")
CONTENT = ".tile, .row, [data-content]"
FIRST_MAX = 260

# Fichiers dont l'absence est normale ici (motif d'URL, raison). Tout autre 404 local fait échouer.
ALLOW_MISSING = [
    (r"/data/manifest\.json(\?|$)", "généré au déploiement par tools/release.py (absent en local : net.js s'en passe)"),
]
# hôtes des images de cartes, logos, produits et sprites : la chaîne de secours y essaie des URL qui peuvent manquer
IMAGE_HOSTS = ("assets.tcgdex.net", "images.scrydex.com", "tcgplayer-cdn.tcgplayer.com", "raw.githubusercontent.com", "cdn.jsdelivr.net")

MEASURE = r"""(sel) => {
  const de = document.documentElement;
  const r = window.__cardex?.router?.parse(location.hash);
  const v = document.querySelector('main .view:not([hidden])');
  let top = null;
  if (v) for (const el of v.querySelectorAll(sel)) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) { top = Math.round(b.top + scrollY); break; }
  }
  // en cas de débordement : l'élément qui dépasse le plus (hors des conteneurs qui défilent ou coupent)
  let worst = null;
  if (de.scrollWidth > de.clientWidth) {
    const clipped = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (getComputedStyle(p).overflowX !== 'visible') return true; } return false; };
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.right > de.clientWidth + 0.5 && (!worst || b.right > worst.right) && !clipped(el)) {
        worst = { right: Math.round(b.right), el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '') };
      }
    }
  }
  // dans la vue : hors de l'écran sans conteneur qui défile (main coupe en x), ou plus large que sa tuile / ligne
  const W = de.clientWidth, out = [], cut = [];
  const name = el => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  if (v) {
    const all = v.querySelectorAll('*');
    for (let i = 0; i < all.length && i < 6000; i++) {
      const el = all[i];
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      let scroller = false, box = null, clipped = false;
      for (let p = el.parentElement; p && p !== v.parentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (!box && (cs.contentVisibility === 'auto' || /paint|strict|content/.test(cs.contain))) box = p;
        if (cs.overflowX !== 'visible') { if (!box) clipped = true; if (cs.overflowX !== 'clip') scroller = true; }
      }
      if ((b.right > W + 0.5 || b.left < -0.5) && !scroller && out.length < 5) out.push([name(el), Math.round(b.left), Math.round(b.right)]);
      if (box && !clipped && cut.length < 5) {
        const a = box.getBoundingClientRect();
        if (b.right > a.right + 1 || b.left < a.left - 1) cut.push([name(el), Math.round(b.right - b.left), name(box), Math.round(a.right - a.left)]);
      }
    }
  }
  const bar = document.querySelector('.appbar .back');
  return { hash: location.hash, view: r?.view || null, root: !!r?.root, sw: de.scrollWidth, cw: de.clientWidth, iw: innerWidth,
           top, back: !!bar && !bar.hidden, title: document.title, worst, out, cut,
           sheet: !!document.querySelector('dialog.sheet[open]') };
}"""

# onglets principaux : après défilement, collés juste sous la barre d'app (null : pas d'onglets ou page trop courte)
STICKY = r"""async () => {
  const t = document.querySelector('main .view:not([hidden]) .ptabs');
  const de = document.documentElement;
  if (!t || de.scrollHeight - innerHeight < 300) return null;
  const y0 = scrollY;
  scrollTo(0, 300);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const d = Math.round(t.getBoundingClientRect().top - document.querySelector('.appbar').getBoundingClientRect().bottom);
  scrollTo(0, y0);
  await new Promise(r => requestAnimationFrame(r));
  return d;
}"""

# attend que les images visibles soient chargées (ou en échec), 4 s au plus
WAIT_IMAGES = r"""async () => {
  const t0 = performance.now();
  while (performance.now() - t0 < 4000) {
    const imgs = [...document.querySelectorAll('img')].filter(i => { const b = i.getBoundingClientRect(); return b.width && b.bottom > 0 && b.top < innerHeight; });
    if (imgs.every(i => i.complete)) break;
    await new Promise(r => setTimeout(r, 100));
  }
}"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def serve(port):
    http.server.ThreadingHTTPServer.request_queue_size = 128   # file d'attente : 5 par défaut, Windows refuse les rafales
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def load_steps(only):
    steps = []
    for path in sorted(glob.glob(os.path.join(STEPS_DIR, "*.json"))):
        stem = os.path.splitext(os.path.basename(path))[0]
        try:
            data = json.load(open(path, encoding="utf8"))
        except Exception as e:
            print(f"  ! {path} illisible : {e}", file=sys.stderr)
            continue
        for s in (data.get("steps", []) if isinstance(data, dict) else data):
            if isinstance(s, dict) and s.get("name"):
                steps.append({**s, "file": stem})
    if only:
        keep = [s for s in steps if s["name"] in only or s["file"] in only]
        # les étapes sans hash dépendent de la précédente : on garde la chaîne jusqu'à l'étape demandée
        out, chain = [], []
        for s in steps:
            chain = [s] if s.get("hash") else chain + [s]
            if s in keep:
                for c in chain:
                    if c not in out:
                        out.append({**c, "_quiet": c not in keep})
        return out
    return steps


def sample_collection():
    return json.load(open(SAMPLE, encoding="utf8"))


def big_collection(n):
    """Collection v2 de n cartes différentes (séries récentes d'abord), d'après data/cards-index.json."""
    idx_path, sets_path = os.path.join(ROOT, "data", "cards-index.json"), os.path.join(ROOT, "data", "sets.json")
    if not (os.path.exists(idx_path) and os.path.exists(sets_path)):
        print("  ! --big : data/cards-index.json ou data/sets.json absent, collection d'exemple utilisée", file=sys.stderr)
        return sample_collection()
    idx = json.load(open(idx_path, encoding="utf8"))
    metas = {s["id"]: s for s in json.load(open(sets_path, encoding="utf8")).get("sets", [])}
    rnd = random.Random(42)
    order = sorted(idx.get("sets", {}), key=lambda k: metas.get(k, {}).get("date") or "", reverse=True)
    cards, t = {}, int(time.time() * 1000)
    for set_id in order:
        m = metas.get(set_id, {})
        for row in idx["sets"][set_id]:
            if len(cards) >= n:
                break
            lid, name, dex, i = (row + [None, None, None, None])[:4]
            cid = f"{set_id}-{lid}"
            img = f"https://assets.tcgdex.net/fr/{m.get('bloc')}/{set_id}/{lid}" if i == 1 and m.get("bloc") else (i if isinstance(i, str) else "")
            qty = {"normal": rnd.choice([1, 1, 1, 2, 3])}
            if rnd.random() < 0.25:
                qty["reverse"] = 1
            cards[cid] = {"id": cid, "qty": qty, "addedAt": t - len(cards) * 60000, "name": name or "", "localId": str(lid),
                          "setId": set_id, "setName": m.get("name", ""), "setTotal": m.get("total"), "image": img,
                          "rarity": "", "category": "Pokémon" if dex else "", "dexId": dex or []}
        if len(cards) >= n:
            break
    return {"v": 2, "cards": cards, "sealed": {}, "watch": [], "savedAt": t}


def run_actions(page, actions):
    for a in actions or []:
        kind = a[0]
        if kind == "click":
            page.locator(a[1]).first.click(timeout=10000)
        elif kind == "fill":
            page.locator(a[1]).first.fill(a[2])
        elif kind == "wait":
            page.wait_for_timeout(a[1])
        elif kind == "eval":
            page.evaluate(a[1])
        elif kind == "waitfor":
            page.locator(a[1]).first.wait_for(timeout=15000)
        elif kind == "key":
            page.keyboard.press(a[1])
        elif kind == "back":
            page.go_back()
        else:
            raise ValueError(f"action inconnue : {kind}")
        settle(page)


def settle(page):
    try:
        page.evaluate("() => window.__cardex && window.__cardex.settled()")
    except Exception:
        pass


def run_one(pw, args, width, theme, steps, collection, base, out_dir):
    base_origin = base.split("/index.html")[0] + "/"
    height = 800 if width >= 900 else 844
    opts = dict(viewport={"width": width, "height": height}, device_scale_factor=2 if width < 900 else 1,
                color_scheme=theme, locale="fr-FR", timezone_id="Europe/Paris",
                service_workers="allow" if args.sw else "block")
    if args.fresh:
        browser = pw.chromium.launch()
        ctx = browser.new_context(**opts)
    else:
        # profil partagé entre les passes : le cache HTTP (images distantes) est gardé, le reste est vidé
        profile = os.path.join(ROOT, ".cache", "shots-profile")
        os.makedirs(profile, exist_ok=True)
        ctx = browser = pw.chromium.launch_persistent_context(profile, **opts)
        ctx.clear_cookies()
        blank = ctx.pages[0] if ctx.pages else ctx.new_page()
        blank.goto(base.replace("index.html", "manifest.webmanifest"))
        blank.evaluate("""async () => {
            try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
            try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) {}
            try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) {}
            try { for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name); } catch (e) {}
        }""")
        blank.close()
    ctx.add_init_script("try { if (!localStorage.getItem('cardex.collection.v1')) localStorage.setItem('cardex.collection.v1', %s); } catch (e) {}"
                        % json.dumps(json.dumps(collection)))
    page = ctx.new_page()
    if args.cpu > 1:
        cdp = ctx.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": args.cpu})
    log = {"js": [], "missing": [], "failed": [], "allowed": [], "images": [], "remote": []}
    cur = {"step": "démarrage"}

    def on_console(m):
        if m.type != "error":
            return
        if m.text.startswith("Failed to load resource"):
            return  # déjà compté par les événements de réseau
        img = re.match(r"Access to image at '([^']+)'", m.text)
        if img and any(f"://{h}/" in img.group(1) for h in IMAGE_HOSTS) and not args.strict_images:
            # image distante refusée (réponse d'erreur sans en-tête CORS, souvent une limitation de débit) : chaîne de secours
            log["images"].append(f"[{cur['step']}] CORS {img.group(1)}  (secours d'image)")
            return
        far = re.match(r"Access to fetch at '([^']+)'", m.text)
        if far and not far.group(1).startswith(base_origin) and not args.strict_remote:
            # service distant en panne ou qui limite le débit (réponse sans en-tête CORS) : l'appli a son repli
            log["remote"].append(f"[{cur['step']}] CORS {far.group(1)}")
            return
        log["js"].append(f"[{cur['step']}] console.error : {m.text}")

    answered = set()

    def bucket(url, rtype):
        if url.startswith(base_origin):
            reason = next((why for pat, why in ALLOW_MISSING if re.search(pat, url)), None)
            return ("allowed", reason) if reason else (None, None)
        if rtype == "image" and any(f"://{h}/" in url for h in IMAGE_HOSTS) and not args.strict_images:
            return ("images", "secours d'image")
        return (None, None)

    def on_response(r):
        if r.status >= 400:
            answered.add(r.url)
            kind, why = bucket(r.url, r.request.resource_type)
            if not kind and not r.url.startswith(base_origin) and (r.status == 429 or r.status >= 500) and not args.strict_remote:
                kind, why = "remote", "service distant indisponible"
            log[kind or "missing"].append(f"[{cur['step']}] {r.status} {r.url}" + (f"  ({why})" if why else ""))

    def on_failed(r):
        f = r.failure or ""
        if r.url in answered:
            return  # déjà listé avec son code (une feuille de style en 404 est ensuite « annulée »)
        if "ERR_ABORTED" in f and r.resource_type in ("image", "media", "fetch"):
            return  # chargement annulé par la page (image remplacée, requête abandonnée)
        kind, why = bucket(r.url, r.resource_type)
        if not kind and not r.url.startswith(base_origin) and not args.strict_remote:
            kind, why = "remote", "service distant injoignable"   # réseau, CORS, délai : l'appli a son repli
        log[kind or "failed"].append(f"[{cur['step']}] {r.url} {f}" + (f"  ({why})" if why else ""))

    page.on("console", on_console)
    page.on("pageerror", lambda e: log["js"].append(f"[{cur['step']}] {e}"))
    page.on("response", on_response)
    page.on("requestfailed", on_failed)
    page.goto(base, wait_until="load")
    page.wait_for_function("() => window.__cardex && document.documentElement.classList.contains('ready')", timeout=30000)
    if args.full:
        # capture de toute la page : sinon les tuiles et lignes hors écran ne sont pas peintes (content-visibility: auto)
        page.add_style_tag(content="* { content-visibility: visible !important; }")
    settle(page)
    results = []
    for s in steps:
        cur["step"] = s["name"]
        rec = {"name": s["name"], "file": s["file"]}
        try:
            if s.get("hash"):
                page.evaluate("h => window.__cardex.open(h)", s["hash"])
                settle(page)
            run_actions(page, s.get("actions"))
            page.wait_for_timeout(int(s.get("wait", 600)))
            page.evaluate(WAIT_IMAGES)
            settle(page)
        except Exception as e:
            rec["problems"] = [f"étape interrompue : {type(e).__name__}: {str(e).splitlines()[0]}"]
            results.append(rec)
            print(f"  {width}-{theme} {s['name']:<22} ÉCHEC  {rec['problems'][0]}")
            continue
        if s.get("_quiet"):
            continue
        m = page.evaluate(MEASURE, s.get("content", CONTENT))
        root = s.get("root", m["root"])
        probs = []
        if m["sw"] > m["cw"]:
            probs.append(f"débordement horizontal : {m['sw']} > {m['cw']} px" + (f" ({m['worst']['el']} jusqu'à {m['worst']['right']} px)" if m.get("worst") else ""))
        if root and m["back"]:
            probs.append("← présente sur une racine d'onglet")
        if not root and not m["back"] and not m["sheet"]:
            probs.append("← absente d'une sous-page")
        if root and not m["sheet"] and (m["top"] is None or m["top"] > FIRST_MAX):
            probs.append(f"premier contenu à {m['top']} px (> {FIRST_MAX})" if m["top"] is not None else "premier contenu introuvable")
        if not m["title"].endswith("· Cardex"):
            probs.append(f"titre du document : {m['title']!r}")
        for el, left, right in m["out"]:
            probs.append(f"hors de l'écran (coupé par main) : {el} de {left} à {right} px")
        for el, w, box, bw in m["cut"]:
            probs.append(f"plus large que son conteneur (coupé par content-visibility) : {el} {w} px dans {box} {bw} px")
        sticky = None
        if root and not m["sheet"]:
            sticky = page.evaluate(STICKY)
            if sticky is not None and abs(sticky) > 1:
                probs.append(f"onglets principaux pas collés sous la barre après défilement (écart {sticky} px)")
        file = os.path.join(out_dir, f"{s['name']}.png")
        if args.full:
            # images paresseuses : on parcourt la page (20 écrans au plus) pour qu'elles se chargent, puis retour en haut
            page.evaluate("""async () => { const y0 = scrollY; for (let i = 1; i <= 20 && innerHeight * i < document.documentElement.scrollHeight; i++) { scrollTo(0, innerHeight * i); await new Promise(r => setTimeout(r, 150)); } scrollTo(0, y0); }""")
            page.evaluate(WAIT_IMAGES)
        page.screenshot(path=file, full_page=args.full)
        rec.update({"png": os.path.relpath(file, args.out).replace(os.sep, "/"), "hash": m["hash"], "view": m["view"],
                    "root": root, "scrollWidth": m["sw"], "clientWidth": m["cw"], "innerWidth": m["iw"],
                    "firstContent": m["top"], "back": m["back"], "title": m["title"], "ptabsGap": sticky, "problems": probs})
        results.append(rec)
        flag = "ok " if not probs else "!! "
        print(f"  {width}-{theme} {s['name']:<22} {flag} largeur {m['sw']}/{m['iw']}  1er contenu {m['top']}  ←{'oui' if m['back'] else 'non'}"
              + (f"  -> {'; '.join(probs)}" if probs else ""))
    browser.close()
    return results, log


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # console Windows (cp1252)
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8771)
    ap.add_argument("--width", default="390", help="largeurs séparées par des virgules (ex. 320,390,1280)")
    ap.add_argument("--themes", default="", help="light, dark ou light,dark")
    ap.add_argument("--dark", action="store_true", help="thème sombre seulement")
    ap.add_argument("--only", default="", help="noms d'étapes ou de fichiers d'étapes, séparés par des virgules")
    ap.add_argument("--out", default=os.path.join(ROOT, "tools", "shots"))
    ap.add_argument("--sw", action="store_true", help="autorise le service worker")
    ap.add_argument("--cpu", type=float, default=1, help="ralentissement du processeur (ex. 4)")
    ap.add_argument("--big", type=int, default=0, help="collection de N cartes différentes")
    ap.add_argument("--full", action="store_true", help="capture de toute la page")
    ap.add_argument("--strict-images", action="store_true", help="les images distantes en échec comptent aussi")
    ap.add_argument("--strict-remote", action="store_true", help="les pannes des services distants comptent aussi")
    ap.add_argument("--fresh", action="store_true", help="navigateur neuf à chaque passe (sans cache HTTP partagé)")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    widths = [int(w) for w in args.width.split(",") if w.strip()]
    themes = [t for t in (args.themes or ("dark" if args.dark else "light")).split(",") if t in ("light", "dark")]
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    steps = load_steps(only)
    if not steps:
        print("Aucune étape (tools/shotsteps/*.json).")
        sys.exit(1)
    collection = big_collection(args.big) if args.big else sample_collection()
    os.makedirs(args.out, exist_ok=True)
    httpd = serve(args.port)
    base = f"http://127.0.0.1:{args.port}/index.html"
    report = {"date": time.strftime("%Y-%m-%d %H:%M:%S"), "options": {k: v for k, v in vars(args).items()}, "runs": []}
    bad = 0
    try:
        with sync_playwright() as pw:
            for w in widths:
                for t in themes:
                    out_dir = os.path.join(args.out, f"{w}-{t}")
                    os.makedirs(out_dir, exist_ok=True)
                    results, log = run_one(pw, args, w, t, steps, collection, base, out_dir)
                    report["runs"].append({"width": w, "theme": t, "steps": results, **log})
                    n_probs = sum(len(r.get("problems", [])) for r in results)
                    bad += n_probs + len(log["js"]) + len(set(log["missing"])) + len(log["failed"])
                    for line in log["js"]:
                        print(f"  {w}-{t} erreur JS {line}")
                    for line in sorted(set(log["missing"])):
                        print(f"  {w}-{t} absent  {line}")
                    for line in log["failed"]:
                        print(f"  {w}-{t} échec   {line}")
                    for line in sorted(set(log["allowed"])):
                        print(f"  {w}-{t} permis  {line}")
                    for line in sorted(set(log["remote"])):
                        print(f"  {w}-{t} distant {line}")
                    if log["images"]:
                        print(f"  {w}-{t} images  {len(set(log['images']))} URL d'image distante en échec (chaîne de secours ; --strict-images pour les compter)")
    finally:
        httpd.shutdown()
    path = os.path.join(args.out, "report.json")
    json.dump(report, open(path, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    total = sum(len(r["steps"]) for r in report["runs"])
    print(f"{total} captures, {bad} problème(s) -> {path}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
