"""Banc d'essai du scanner (FINAL-scanner §8) : exécute les vrais modules js/scan/* dans Chromium (Playwright).

  python -P tools/scan_bench.py prep [--seed DIR ...] [--fetch 150]   images haute définition pour les requêtes
  python -P tools/scan_bench.py bitexact [--n 50]                     describe() JS == hashes.bin Python
  python -P tools/scan_bench.py synth [--preset standard|hard|wide] [--n 300] [--seed 1] [--cpu 1,4] [--absent]
  python -P tools/scan_bench.py real --real DIR                       photos réelles (non versionnées)
  python -P tools/scan_bench.py live                                  fausse caméra (clip y4m) et boucle complète
  python -P tools/scan_bench.py loop                                  scénarios de la boucle (hors ligne, destroy,
                                                                      déclencheur, netteté, base indisponible, OCR)
  python -P tools/scan_bench.py api [--no-offscreen]                  API publique (import, ocrFallback, erreurs)
  python -P tools/scan_bench.py ocr [--ocr-mode net]                  lecture du numéro (tesseract.js)
  python -P tools/scan_bench.py all --real DIR --cases JSON           tout, avec un résumé final

Fichiers générés : .cache/sc/bench/ (photos synthétiques, clips, résultats JSON). Port local : 8775 (--port N).
Décision « hors ligne » (*_off) : la même décision sans images high.webp (réimpressions et sosies → choix).
"""
import argparse
import functools
import glob
import http.server
import json
import math
import os
import random
import shutil
import statistics
import sys
import threading
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tools", "scanbench"))
CACHE = os.path.join(ROOT, ".cache", "sc")
IMG = os.path.join(CACHE, "tcgdex")
BENCH = os.path.join(CACHE, "bench")
PORT = int(os.environ.get("CARDEX_SCAN_PORT", "8775"))     # --port pour un autre banc en parallèle
BASE = f"http://127.0.0.1:{PORT}"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ----------------------------------------------------------------------------------------------------------
# Serveur local : dépôt + /__bench/ (cache du banc) + /__img/ (images TCGdex en cache) + /__real/

class Handler(http.server.SimpleHTTPRequestHandler):
    real_dir = None
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript",
                      ".mjs": "text/javascript", ".wasm": "application/wasm", ".webp": "image/webp",
                      ".json": "application/json", ".bin": "application/octet-stream", ".gz": "application/gzip",
                      ".y4m": "application/octet-stream"}

    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0]
        for prefix, base in (("/__bench/", BENCH), ("/__img/", IMG), ("/__real/", self.real_dir or BENCH)):
            if p.startswith(prefix):
                rel = urllib_unquote(p[len(prefix):])
                return os.path.join(base, *rel.split("/"))
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *a):
        pass


def urllib_unquote(s):
    import urllib.parse
    return urllib.parse.unquote(s)


def serve():
    handler = functools.partial(Handler, directory=ROOT)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.request_queue_size = 128   # file d'attente : 5 par défaut, Windows refuse les rafales
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class Browser:
    """Chromium sans interface ; console et erreurs de page relevées."""

    def __init__(self, args=None, page="tools/scanbench/bench.html", permissions=None, init_script=None, routes=None):
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        self.b = self.pw.chromium.launch(args=args or [])
        self.ctx = self.b.new_context(viewport={"width": 390, "height": 844}, permissions=permissions or [])
        for pattern, handler in routes or []:
            self.ctx.route(pattern, handler)
        self.page = self.ctx.new_page()
        if init_script:
            self.page.add_init_script(init_script)
        self.errors = []
        self.warnings = []
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else
                     (self.warnings.append(m.text) if m.type == "warning" else None))
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.goto(f"{BASE}/{page}")
        self.page.wait_for_function("window.__ready === true", timeout=60000)
        self.cdp = self.ctx.new_cdp_session(self.page)

    def cpu(self, rate):
        self.cdp.send("Emulation.setCPUThrottlingRate", {"rate": rate})

    def ev(self, expr, arg=None):
        return self.page.evaluate(expr, arg)

    def close(self):
        self.b.close()
        self.pw.stop()


def load_cards():
    with open(os.path.join(ROOT, "data", "scan", "cards.json"), encoding="utf8") as f:
        return json.load(f)


def groups_of(cards):
    g = {}
    for grp in cards["dups"]:
        s = set(grp)
        for i in grp:
            g[i] = s
    return g


def pct(a, b):
    return 100.0 * a / b if b else 0.0


def q(vals, p):
    if not vals:
        return float("nan")
    s = sorted(vals)
    return s[min(len(s) - 1, int(round(p * (len(s) - 1))))]


# ----------------------------------------------------------------------------------------------------------
# prep : images haute définition (requêtes synthétiques et départage des réimpressions)

def high_index():
    """{id: chemin relatif dans IMG} des images haute définition en cache."""
    cards = load_cards()
    out = {}
    for lang in ("fr", "en"):
        for p in glob.glob(os.path.join(IMG, f"img_{lang}_high", "*", "*.webp")):
            sid = os.path.basename(os.path.dirname(p))
            lid = os.path.splitext(os.path.basename(p))[0]
            cid = f"{sid}-{lid}"
            out.setdefault(cid, os.path.relpath(p, IMG).replace(os.sep, "/"))
    row = {c: i for i, c in enumerate(cards["ids"])}
    return {k: v for k, v in out.items() if k in row}


def cmd_prep(a):
    os.makedirs(IMG, exist_ok=True)
    cards = load_cards()
    src = {c: cards["src"][i] for i, c in enumerate(cards["ids"])}
    n = 0
    for seed in a.seed:
        # mise en page « img_<lang>_high/<set>/<n°>.webp »
        for p in glob.glob(os.path.join(seed, "img_*_high", "*", "*.webp")):
            rel = os.path.relpath(p, seed)
            n += link(p, os.path.join(IMG, rel))
        # mises en page plates : « <lang>_<id>.webp » ou « <id>.webp » (FR)
        for p in glob.glob(os.path.join(seed, "high_cache", "*.webp")) + glob.glob(os.path.join(seed, "img_ref_high", "*.webp")):
            name = os.path.splitext(os.path.basename(p))[0]
            lang, cid = (name.split("_", 1) if name[:3] in ("fr_", "en_") else ("fr", name))
            if cid not in src or os.path.getsize(p) == 0:
                continue
            sid, lid = cid.rsplit("-", 1)
            n += link(p, os.path.join(IMG, f"img_{lang}_high", sid, lid + ".webp"))
    print(f"{n} images haute définition ajoutées au cache")
    if a.fetch:
        fetch_high(cards, a.fetch, a.seed_val)
    have = high_index()
    print(f"{len(have)} cartes avec image haute définition en cache")


def link(src, dst):
    if os.path.exists(dst):
        return 0
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copyfile(src, dst)
    return 1


def fetch_high(cards, n, seed):
    """Télécharge n images high.webp réparties sur les ères peu représentées (≤ 4 requêtes/s)."""
    import build_scan
    have = high_index()
    by_era = {}
    for i, cid in enumerate(cards["ids"]):
        sid = cid.rsplit("-", 1)[0]
        era = cards["sets"].get(sid, {}).get("era", "?")
        by_era.setdefault(era, []).append(i)
    rnd = random.Random(seed)
    counts = {e: sum(1 for c in have if cards["sets"].get(c.rsplit("-", 1)[0], {}).get("era") == e) for e in by_era}
    want = []
    eras = sorted(by_era, key=lambda e: counts.get(e, 0))
    per = max(1, n // max(1, len(eras)))
    for e in eras:
        pool = [i for i in by_era[e] if cards["ids"][i] not in have]
        rnd.shuffle(pool)
        want += pool[:max(0, per - counts.get(e, 0) // 4)]
    want = want[:n]
    f = build_scan.Fetcher()
    got = 0
    for i in want:
        cid = cards["ids"][i]
        sid, lid = cid.rsplit("-", 1)
        lang = "en" if cards["src"][i] == "e" else "fr"
        base = cards.get("img", {}).get(cid)
        s = cards["sets"].get(sid)
        url = f"https://assets.tcgdex.net/{base}/high.webp" if base else f"https://assets.tcgdex.net/{lang}/{s['s']}/{sid}/{lid}/high.webp"
        try:
            b = f.get(url, timeout=60)
        except Exception as e:  # noqa: BLE001
            print("  !", url, e)
            continue
        if b and b[:4] == b"RIFF":
            build_scan.write_bytes_atomic(os.path.join(IMG, f"img_{lang}_high", sid, lid.replace("/", "_") + ".webp"), b)
            got += 1
    print(f"{got} images haute définition téléchargées ({f.count} requêtes)")


# ----------------------------------------------------------------------------------------------------------
# bitexact

def cmd_bitexact(a, br=None):
    cards = load_cards()
    import build_scan  # noqa: F401  (même dossier d'images que le builder)
    meta = json.load(open(os.path.join(ROOT, "data", "scan", "meta.json"), encoding="utf8"))
    rnd = random.Random(a.seed)
    idx = list(range(len(cards["ids"])))
    rnd.shuffle(idx)
    lst = []
    for i in idx:
        cid = cards["ids"][i]
        sid, lid = cid.rsplit("-", 1)
        lang = "en" if cards["src"][i] == "e" else "fr"
        var = meta["var"].get(cid, "low.webp")
        sub = {"low.webp": "low", "high.webp": "high", "low.png": "lowpng"}[var]
        ext = "png" if var == "low.png" else "webp"
        # la carte peut être rangée dans une autre série (pl4-AR1 dans pl3) : on cherche le fichier
        cands = glob.glob(os.path.join(IMG, f"img_{lang}_{sub}", "*", lid.replace("/", "_") + "." + ext))
        cands = [c for c in cands if os.path.basename(os.path.dirname(c)) == sid] or cands
        if not cands:
            continue
        lst.append({"id": cid, "url": "/__img/" + os.path.relpath(cands[0], IMG).replace(os.sep, "/")})
        if len(lst) >= a.n:
            break
    # quelques images de repli (high.webp) dans l'échantillon
    for cid, var in list(meta["var"].items())[:3]:
        sid, lid = cid.rsplit("-", 1)
        p = os.path.join(IMG, "img_fr_high", sid, lid + ".webp")
        if os.path.exists(p) and all(x["id"] != cid for x in lst):
            lst.append({"id": cid, "url": "/__img/" + os.path.relpath(p, IMG).replace(os.sep, "/")})
    own = br is None
    br = br or Browser()
    try:
        br.ev("bench.init()")
        res = br.ev("l => bench.bitexact(l)", lst)
    finally:
        if own:
            br.close()
    worst = max(r["dh"] + r["ph"] for r in res)
    exact = sum(1 for r in res if r["dh"] + r["ph"] == 0)
    print(f"bit-exactitude : {len(res)} références, {exact} identiques au bit près, pire écart {worst}/512 bits "
          f"(seuil ≤ 4) → {'OK' if worst <= 4 else 'ÉCHEC'}")
    return {"n": len(res), "exact": exact, "worst": worst, "ok": worst <= 4}


# ----------------------------------------------------------------------------------------------------------
# synth

def era_of(cards, cid):
    return cards["sets"].get(cid.rsplit("-", 1)[0], {}).get("era", "?")


def gen_synth(preset, n, seed):
    """Génère (ou relit) n photos synthétiques ; renvoie le dossier et la vérité terrain."""
    from synth import PRESETS, load_rgb, make_photo
    import cv2
    out = os.path.join(BENCH, f"{preset}_{n}_s{seed}")
    tp = os.path.join(out, "truth.json")
    if os.path.exists(tp):
        return out, json.load(open(tp, encoding="utf8"))
    os.makedirs(out, exist_ok=True)
    cards = load_cards()
    have = high_index()
    ids = sorted(have)
    rnd = np.random.default_rng(seed)
    rnd.shuffle(ids)
    # tirage équilibré : au plus 40 % de cartes SV/ME
    sv = [c for c in ids if era_of(cards, c) in ("sv", "me")]
    other = [c for c in ids if era_of(cards, c) not in ("sv", "me")]
    k_sv = min(len(sv), int(round(0.4 * n)))
    pick = sv[:k_sv] + other[:n - k_sv]
    if len(pick) < n:
        pick += [c for c in sv[k_sv:]][:n - len(pick)]
    pool_ids = ids[-30:]
    pool = [cv2.resize(load_rgb(os.path.join(IMG, have[c])), (256, 352), interpolation=cv2.INTER_AREA) for c in pool_ids]
    truth = []
    t0 = time.time()
    for k, cid in enumerate(pick):
        rng = np.random.default_rng(seed * 100003 + k)
        img, corners, guide, meta = make_photo(load_rgb(os.path.join(IMG, have[cid])), rng, pool, **PRESETS[preset])
        name = f"p{k:04d}.jpg"
        cv2.imwrite(os.path.join(out, name), cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
        truth.append({"file": name, "id": cid, "corners": corners.round(2).tolist(), "guide": [round(v, 2) for v in guide], "meta": meta})
        if k % 50 == 0:
            print(f"  synthèse {k}/{len(pick)} ({time.time() - t0:.0f} s)", flush=True)
    json.dump(truth, open(tp, "w", encoding="utf8"))
    return out, truth


def run_cases(br, cases, opts, chunk=10, label=""):
    res = []
    t0 = time.time()
    for s in range(0, len(cases), chunk):
        res += br.ev("([c, o]) => bench.runCases(c, o)", [cases[s:s + chunk], opts])
        if label and (s // chunk) % 5 == 0:
            print(f"  {label} {min(len(cases), s + chunk)}/{len(cases)} ({time.time() - t0:.0f} s)", flush=True)
    return res


def corner_err(quad, corners):
    if not quad:
        return None
    c = np.array(corners)
    qd = np.array(quad)
    ch = float(np.linalg.norm(c[3] - c[0]))
    return float(np.max(np.linalg.norm(qd - c, axis=1)) / ch)


REGION_MARGIN = 0.01    # js/scan/loop.js LOOP.regionMargin
SELF_MIN = None         # contrôle de la zone de la seule carte n° 1 : mesuré (--self), non appliqué (voir loop.js)


def settle_py(r, margin=REGION_MARGIN, self_min=SELF_MIN, offline=False):
    """Décision finale comme js/scan/loop.js settle() sur une seule image : (« accept » | « choose » | None, id).
    offline = images high.webp indisponibles (hors ligne, réseau lent, image manquante) : pas de zone du numéro."""
    top = r.get("top") or []
    if not top:
        return None, None
    top1 = top[0][0]
    if r.get("level") not in ("strong", "normal"):
        return ("choose" if r.get("d1", 9) <= 1.45 else None), top1
    fam = list(dict.fromkeys([top1] + (r.get("group") or []) + (r.get("rivals") or [])))
    twins = r.get("twins") or []
    if len(fam) > 1:
        regs = None if offline else r.get("regions")
        if not regs or len(regs) < len(fam) or any(sc is None for _, sc in regs):
            return "choose", top1                       # versions non comparables : jamais acceptées
        best = regs[0][0]
        m = regs[0][1] - regs[1][1] if len(regs) > 1 else 1
        if twins or m < margin or (self_min is not None and regs[0][1] < self_min):
            return "choose", best
        return "accept", best
    if twins:
        return "choose", top1
    sc = None if offline else r.get("self")
    if self_min is not None and sc is not None and sc < self_min:
        return "choose", top1
    return "accept", top1


LOOKALIKE_NN = 1.1
_NN = {}


def ref_nn(cards):
    """{id: distance de référence (hashes.bin) à la carte la plus proche hors de son groupe de réimpressions}."""
    if "nn" not in _NN:
        h = np.unpackbits(np.frombuffer(open(os.path.join(ROOT, "data", "scan", "hashes.bin"), "rb").read(), np.uint8).reshape(-1, 64), axis=1)
        hf = h.astype(np.float32)
        s1 = hf.sum(1)
        row = {c: i for i, c in enumerate(cards["ids"])}
        gid = np.full(len(row), -1)
        for k, g in enumerate(cards["dups"]):
            for c in g:
                gid[row[c]] = k
        out = np.full(len(row), 999.0)
        for a in range(0, len(row), 2048):
            b = min(len(row), a + 2048)
            d = s1[a:b, None] + s1[None, :] - 2 * (hf[a:b] @ hf.T)
            d[np.arange(b - a), np.arange(a, b)] = 999
            same = (gid[a:b, None] == gid[None, :]) & (gid[a:b, None] >= 0)
            d[same] = 999
            out[a:b] = d.min(1)
        _NN["nn"] = {c: float(out[i]) / 128 for c, i in row.items()}
    return _NN["nn"]


def score(results, truth, cards, absent=False):
    """Métriques d'une série de résultats (voir FINAL-scanner §8.3). « accept_final » / « prec_final » : décision
    finale de la boucle (départage et contrôle par la zone du numéro compris), sur une seule image (sans vote 2 sur 3).
    « *_off » : même décision sans images high.webp (hors ligne)."""
    grp = groups_of(cards)
    n = len(results)
    m = {"n": n}
    if absent:
        acc_s = sum(1 for r in results if r.get("level") == "strong")
        acc = sum(1 for r in results if r.get("level") in ("strong", "normal"))
        fin = [settle_py(r)[0] == "accept" for r in results]
        off = sum(1 for r in results if settle_py(r, offline=True)[0] == "accept")
        # carte sans réimpression de même illustration dans la base (plus proche voisin de référence hors de son
        # groupe à d > 1,1) / avec : une carte réellement absente de la base est une carte sans image (jumelles → choix)
        # ou d'une série pas encore construite
        nn = ref_nn(cards)
        uni = [f for f, t in zip(fin, truth) if nn.get(t["id"], 9) > LOOKALIKE_NN]
        lka = [f for f, t in zip(fin, truth) if nn.get(t["id"], 9) <= LOOKALIKE_NN]
        m.update(fa_strong=pct(acc_s, n), fa=pct(acc, n), fa_final=pct(sum(fin), n), fa_off=pct(off, n),
                 fa_unique=pct(sum(uni), len(uni)), n_unique=len(uni), fa_lookalike=pct(sum(lka), len(lka)), n_lookalike=len(lka))
        return m
    oacc = ook = 0
    s1 = t1 = t5 = 0
    acc_s = acc = ok_s = ok = 0
    strict_after = 0
    errs, ms, nev, regms = [], [], [], []
    by_era = {}
    reprint_n = reprint_ok = 0
    facc = fok = fstrict = 0
    for r, t in zip(results, truth):
        cid = t["id"]
        g = grp.get(cid, {cid})
        top = [x[0] for x in r.get("top") or []]
        a1 = bool(top) and top[0] == cid
        b1 = bool(top) and top[0] in g
        c5 = any(x in g for x in top)
        s1 += a1
        t1 += b1
        t5 += c5
        e = era_of(cards, cid)
        by_era.setdefault(e, [0, 0])
        by_era[e][0] += 1
        by_era[e][1] += b1
        lvl = r.get("level")
        if lvl == "strong":
            acc_s += 1
            ok_s += b1
        if lvl in ("strong", "normal"):
            acc += 1
            ok += b1
        # identifiant final après départage par la zone du numéro
        final = top[0] if top else None
        regs = r.get("regions")
        if regs and len(regs) >= 1:
            final = regs[0][0]
        strict_after += final == cid
        dec, fid = settle_py(r)
        if dec == "accept":
            facc += 1
            fok += fid in g
            fstrict += fid == cid
        dec, fid = settle_py(r, offline=True)
        if dec == "accept":
            oacc += 1
            ook += fid == cid
        if len(g) > 1:
            reprint_n += 1
            reprint_ok += final == cid
        err = corner_err(r.get("quad"), t["corners"])
        if err is not None:
            errs.append(err)
        ms.append(r["ms"])
        nev.append(r["nev"])
        if "regionMs" in r:
            regms.append(r["regionMs"])
    m.update(top1_strict=pct(s1, n), top1=pct(t1, n), top5=pct(t5, n),
             accept_strong=pct(acc_s, n), prec_strong=pct(ok_s, acc_s), accept=pct(acc, n), prec=pct(ok, acc),
             wrong_accepts=acc - ok, strict_after_region=pct(strict_after, n),
             accept_final=pct(facc, n), prec_final=pct(fok, facc), prec_final_strict=pct(fstrict, facc), wrong_final=facc - fok,
             accept_off=pct(oacc, n), prec_off_strict=pct(ook, oacc), wrong_off_strict=oacc - ook,
             reprints=f"{reprint_ok}/{reprint_n}",
             err_p50=q(errs, 0.5) * 100, err_p90=q(errs, 0.9) * 100,
             ms_p50=q(ms, 0.5), ms_p90=q(ms, 0.9), nev_p50=q(nev, 0.5), nev_p90=q(nev, 0.9),
             region_ms_p50=q(regms, 0.5) if regms else None,
             by_era={e: f"{v[1]}/{v[0]}" for e, v in sorted(by_era.items())})
    return m


def fmt(m):
    keys = ["n", "top1", "top1_strict", "top5", "accept_strong", "prec_strong", "accept", "prec", "wrong_accepts",
            "accept_final", "prec_final", "prec_final_strict", "wrong_final", "accept_off", "prec_off_strict", "wrong_off_strict",
            "strict_after_region", "reprints", "err_p50", "err_p90", "ms_p50", "ms_p90", "nev_p50", "nev_p90",
            "region_ms_p50", "fa_strong", "fa", "fa_final", "fa_off", "fa_unique", "n_unique", "fa_lookalike", "n_lookalike"]
    parts = []
    for k in keys:
        if k in m and m[k] is not None:
            v = m[k]
            parts.append(f"{k}={v:.1f}" if isinstance(v, float) else f"{k}={v}")
    return "  ".join(parts)


def cmd_synth(a, br=None):
    cards = load_cards()
    d, truth = gen_synth(a.preset, a.n, a.seed)
    rel = os.path.relpath(d, BENCH).replace(os.sep, "/")
    cases = [{"url": f"/__bench/{rel}/{t['file']}", "id": t["id"], "guide": t["guide"]} for t in truth]
    own = br is None
    br = br or Browser()
    out = {}
    try:
        br.ev("bench.init()")
        br.ev("l => bench.setLocal(l)", sorted(set(high_index().values())))
        for rate in [int(x) for x in a.cpu.split(",") if x.strip() and int(x) > 0]:
            br.cpu(rate)
            sub = cases if rate == 1 else cases[:a.n_slow]
            res = run_cases(br, sub, {"exclude": False, "self": a.self}, label=f"{a.preset} ×{rate}")
            m = score(res, truth[:len(sub)], cards)
            print(f"[{a.preset} CPU ×{rate}] {fmt(m)}")
            if rate == 1:
                print(f"    par ère : {m['by_era']}")
            out[f"x{rate}"] = m
            json.dump(res, open(os.path.join(BENCH, f"res_{a.preset}_x{rate}.json"), "w"))
        br.cpu(1)
        if a.absent:
            sub = cases[:a.n_absent]
            res = run_cases(br, sub, {"exclude": True, "self": a.self}, label=f"{a.preset} absente")
            m = score(res, truth[:len(sub)], cards, absent=True)
            print(f"[{a.preset} carte absente] n={m['n']}  fausses acceptations : forte {m['fa_strong']:.1f} %  "
                  f"forte+normale {m['fa']:.1f} %  décision finale {m['fa_final']:.1f} % (hors ligne {m['fa_off']:.1f} %) ; "
                  f"illustration unique {m['fa_unique']:.1f} % (n={m['n_unique']}), réimpression de même illustration "
                  f"dans la base {m['fa_lookalike']:.1f} % (n={m['n_lookalike']})")
            out["absent"] = m
            json.dump(res, open(os.path.join(BENCH, f"res_{a.preset}_absent.json"), "w"))
        if br.errors:
            print("erreurs console :", br.errors[:5])
    finally:
        if own:
            br.close()
    return out


def cmd_rescore(a):
    """Recalcule les métriques depuis les résultats enregistrés (sans relancer le navigateur)."""
    cards = load_cards()
    _, truth = gen_synth(a.preset, a.n, a.seed)
    for tag in ("x1", "x4", "absent"):
        p = os.path.join(BENCH, f"res_{a.preset}_{tag}.json")
        if not os.path.exists(p):
            continue
        res = json.load(open(p))
        m = score(res, truth[:len(res)], cards, absent=tag == "absent")
        print(f"[{a.preset} {tag}] {fmt(m)}")


# ----------------------------------------------------------------------------------------------------------
# calib : règles d'acceptation évaluées sur les résultats enregistrés (synthèse standard / difficile / large,
# carte absente, photos réelles). Les distances d1, d2 de chaque image sont rejouées avec chaque règle.

def level_with(r, strong=(0.60, 0.60), normal=(1.10, 0.30), ratio=None):
    d1, d2 = r.get("d1"), r.get("d2")
    if d1 is None:
        return "none"
    if d1 <= strong[0] and d1 <= strong[1] * d2:
        return "strong"
    if ratio is not None:
        if d1 <= normal[0] and d1 <= ratio * d2:
            return "normal"
    elif d1 <= normal[0] and d2 - d1 >= normal[1]:
        return "normal"
    return "none" if d1 > 1.45 else "weak"


def cmd_calib(a):
    cards = load_cards()
    grp = groups_of(cards)
    sets = {}
    for preset in ("standard", "hard", "wide"):
        p = os.path.join(BENCH, f"res_{preset}_x1.json")
        if os.path.exists(p):
            res = json.load(open(p))
            n = len(res)
            _, truth = gen_synth(preset, {"standard": 300, "hard": 300, "wide": 150}.get(preset, n), a.seed)
            sets[preset] = (res, [t["id"] for t in truth[:n]])
    absent = json.load(open(os.path.join(BENCH, "res_standard_absent.json"))) if os.path.exists(os.path.join(BENCH, "res_standard_absent.json")) else []
    real = json.load(open(os.path.join(BENCH, "res_real.json"))) if os.path.exists(os.path.join(BENCH, "res_real.json")) else []
    rules = [("R1 (0,86 ; ×0,7)", dict(normal=(0.86, 0), ratio=0.7)),
             ("FC A (1,05 ; ×0,8)", dict(normal=(1.05, 0), ratio=0.8)),
             ("FC B (1,10 ; marge 0,30)", dict(normal=(1.10, 0.30))),
             ("1,10 ; marge 0,40", dict(normal=(1.10, 0.40))),
             ("1,00 ; marge 0,30", dict(normal=(1.00, 0.30))),
             ("0,90 ; marge 0,30", dict(normal=(0.90, 0.30))),
             ("0,86 ; marge 0,30", dict(normal=(0.86, 0.30))),
             ("0,80 ; marge 0,30", dict(normal=(0.80, 0.30))),
             ("0,75 ; marge 0,30", dict(normal=(0.75, 0.30))),
             ("forte seule (0,6 ; ×0,6)", dict(normal=(0.0, 9))),
             ("forte 0,5 + 0,80 ; 0,30", dict(strong=(0.50, 0.60), normal=(0.80, 0.30)))]
    print("règle                       | " + " | ".join(f"{k:^24}" for k in sets) + " | absente (FA) | réel (acc./faux)")
    for name, kw in rules:
        cells = []
        for k, (res, ids) in sets.items():
            acc = ok = 0
            for r, cid in zip(res, ids):
                rr = dict(r, level=level_with(r, **kw))
                dec, fid = settle_py(rr)
                if dec == "accept":
                    acc += 1
                    ok += fid in grp.get(cid, {cid})
            cells.append(f"acc {pct(acc, len(res)):5.1f} % préc {pct(ok, acc):5.1f} %")
        fa = sum(1 for r in absent if settle_py(dict(r, level=level_with(r, **kw)))[0] == "accept")
        ra = rw = 0
        for r in real:
            dec, fid = settle_py(dict(r, level=level_with(r, **kw)))
            if dec == "accept":
                ra += 1
                rw += fid not in grp.get(r["truth"], {r["truth"]})
        print(f"{name:<27} | " + " | ".join(cells) + f" | {pct(fa, len(absent)):5.1f} % ({fa}) | {ra}/{len(real)} / {rw}")


# ----------------------------------------------------------------------------------------------------------
# real : photos réelles (FINAL-scanner §11). Les photos ne sont jamais copiées dans le dépôt.

# Liste des cas : { "cases": [{ "photo", "id", "box": [x0, x1, y0, y1] (fractions, facultatif : sinon import sans
# guide), "rot": quarts de tour horaires, "holder": "nue" | "sleeve" | "toploader" … }] }
REAL_CASES = os.path.join(ROOT, "tools", "scanbench", "real.json")


def prep_real(real_dir, cases_path):
    """Applique l'orientation EXIF (+ rotation éventuelle) et écrit des JPEG dans le cache du banc."""
    from PIL import Image, ImageOps
    spec = json.load(open(cases_path, encoding="utf8"))
    out = os.path.join(BENCH, "real")
    os.makedirs(out, exist_ok=True)
    done = {}
    for c in spec["cases"]:
        key = (c["photo"], c.get("rot", 0))
        if key in done:
            continue
        name = os.path.splitext(os.path.basename(c["photo"]))[0] + (f"_r{c['rot']}" if c.get("rot") else "") + ".jpg"
        dst = os.path.join(out, name)
        if not os.path.exists(dst):
            im = ImageOps.exif_transpose(Image.open(os.path.join(real_dir, c["photo"]))).convert("RGB")
            if c.get("rot"):
                im = im.rotate(-90 * c["rot"], expand=True)
            im.save(dst, quality=95)
        with Image.open(dst) as im:
            done[key] = (name, im.size)
    return spec, done


def cmd_real(a, br=None):
    cards = load_cards()
    if not a.real or not os.path.exists(a.cases or REAL_CASES):
        print("photos réelles : --real DOSSIER et une liste de cas (--cases, ou tools/scanbench/real.json) sont nécessaires")
        return {}
    spec, done = prep_real(a.real, a.cases or REAL_CASES)
    guided, unguided = [], []
    for c in spec["cases"]:
        name, (W, H) = done[(c["photo"], c.get("rot", 0))]
        url = f"/__bench/real/{name}"
        if c.get("box"):
            x0, x1, y0, y1 = c["box"]
            guided.append(({"url": url, "id": c["id"], "guide": [x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H]}, c))
        else:
            unguided.append(({"url": url, "id": c["id"], "guide": None}, c))
    imports = []
    seen = set()
    for c in spec["cases"]:
        if c.get("box") and (c["photo"], c.get("rot", 0)) not in seen:
            seen.add((c["photo"], c.get("rot", 0)))
            name, _ = done[(c["photo"], c.get("rot", 0))]
            ids = sorted({x["id"] for x in spec["cases"] if x["photo"] == c["photo"]})
            imports.append(({"url": f"/__bench/real/{name}", "id": ids[0], "guide": None}, {"ids": ids, "holder": "scène"}))
    own = br is None
    br = br or Browser()
    out = {}
    try:
        br.ev("bench.init()")
        br.ev("l => bench.setLocal(l)", sorted(set(high_index().values())))
        rows = []
        det = br.ev("c => bench.detectCases(c)", [g[0] for g in guided])
        res = br.ev("([c, o]) => bench.runCases(c, o)", [[g[0] for g in guided], {"self": a.self}])
        res += br.ev("([c, o]) => bench.runCases(c, o)", [[g[0] for g in unguided], {"unguided": True, "self": a.self}])
        grp = groups_of(cards)
        stats = {}
        gate = {}
        for (case, c), r, dt in zip(guided, res, det):
            s = gate.setdefault(c["holder"], {"n": 0, "seen": 0, "auto": 0})
            s["n"] += 1
            s["seen"] += dt["present"]
            s["auto"] += dt["present"] and settle_py(r)[0] == "accept"
            if not dt["present"]:
                print(f"    détection de la boucle : {c['id']} {c['holder']} côtés {dt['found']} quad {dt['quad']} → carte non vue")
        for h, s in gate.items():
            print(f"[réel · boucle · {h}] n={s['n']} carte vue par la détection {s['seen']} ; vue et acceptée (capture auto) {s['auto']}")
        out["gate"] = gate
        for (case, c), r in zip(guided + unguided, res):
            g = grp.get(c["id"], {c["id"]})
            top = [x[0] for x in r.get("top") or []]
            ok1 = bool(top) and top[0] in g
            dec, fid = settle_py(r)
            acc = dec == "accept"
            deo, fio = settle_py(r, offline=True)
            h = c["holder"]
            s = stats.setdefault(h, {"n": 0, "top1": 0, "top5": 0, "accept": 0, "wrong": 0, "accept_off": 0, "wrong_off": 0, "d": []})
            s["n"] += 1
            s["top1"] += ok1
            s["top5"] += any(x in g for x in top)
            s["accept"] += acc
            s["wrong"] += acc and fid not in g
            s["accept_off"] += deo == "accept"
            s["wrong_off"] += deo == "accept" and fio != c["id"]
            if ok1:
                s["d"].append(r["d1"])
            rows.append(f"    {c['id']:<16} {h:<10} {'ok ' if ok1 else 'NON'} top1={top[0] if top else None} d1={r.get('d1', 0):.3f} "
                        f"d2={r.get('d2', 0):.3f} {r.get('level')} {r.get('stage')} self={r.get('self')} → {dec} {fid} "
                        f"nev={r.get('nev')} {r.get('ms', 0):.0f} ms")
        print("\n".join(rows))
        for h, s in stats.items():
            print(f"[réel · {h}] n={s['n']} top1={s['top1']} top5={s['top5']} acceptées={s['accept']} fausses={s['wrong']} "
                  f"(hors ligne {s['accept_off']} / {s['wrong_off']}) d médiane={statistics.median(s['d']) if s['d'] else float('nan'):.3f}")
        out["holders"] = {h: {k: v for k, v in s.items() if k != "d"} | {"d_med": statistics.median(s["d"]) if s["d"] else None}
                          for h, s in stats.items()}
        json.dump([dict(r, truth=c["id"], holder=c["holder"]) for (case, c), r in zip(guided + unguided, res)],
                  open(os.path.join(BENCH, "res_real.json"), "w"))
        # import d'une photo entière (plusieurs cartes) : la meilleure carte trouvée doit être l'une d'elles
        res2 = br.ev("([c, o]) => bench.runCases(c, o)", [[i[0] for i in imports], {"unguided": True}])
        ok = 0
        for (case, c), r in zip(imports, res2):
            top = [x[0] for x in r.get("top") or []]
            hit = bool(top) and top[0] in set(c["ids"])
            ok += hit
            print(f"    import {case['url'].rsplit('/', 1)[1]:<34} {'ok ' if hit else 'NON'} {top[0] if top else None} d1={r.get('d1', 0):.3f} "
                  f"{r.get('level')} {r.get('ms', 0):.0f} ms")
        print(f"[réel · import de scènes] {ok}/{len(imports)}")
        out["imports"] = f"{ok}/{len(imports)}"
        if br.errors:
            print("erreurs console :", br.errors[:5])
    finally:
        if own:
            br.close()
    return out


# ----------------------------------------------------------------------------------------------------------
# live : fausse caméra (clip y4m) → vraie API js/scan/index.js (camera, worker, boucle) dans tools/scanbench/live.html

def cmd_live(a, br=None):
    from clip import FPS, make_clip
    cards = load_cards()
    grp = groups_of(cards)
    have = high_index()
    out = {}
    # base1-4 a une jumelle sans image (Collection Classique cel25cc-CC002) : un choix attendu, jamais d'acceptation
    ids = a.clip or ["sv03.5-025", "base1-4", "neo1-9"]
    twins = cards.get("twins", {})
    for cid in ids:
        if cid not in have:
            print(f"  ! pas d'image haute définition pour {cid}")
            continue
        path = os.path.join(BENCH, f"clip_{cid}.y4m")
        tpath = path + ".json"
        if not os.path.exists(path) or not os.path.exists(tpath):
            os.makedirs(BENCH, exist_ok=True)
            t0 = time.time()
            truth = make_clip(os.path.join(IMG, have[cid]), path)
            json.dump(truth, open(tpath, "w"))
            print(f"  clip {cid} : {truth['frames']} images ({time.time() - t0:.0f} s, {os.path.getsize(path) / 1e6:.0f} Mo)")
        truth = json.load(open(tpath))
        args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-video-capture={path}"]
        b = Browser(args=args, page="tools/scanbench/live.html?auto&portrait", permissions=["camera"])
        try:
            b.page.wait_for_function("window.live && window.live.loop", timeout=30000)
            secs = a.seconds
            b.page.wait_for_timeout(int(secs * 1000))
            ev = b.ev("() => window.live.events")
            frames = b.ev("() => window.live.frames")
        finally:
            b.close()
        n = truth["frames"]
        s0, s1 = truth["stop"]
        # passages du clip : l'index d'image repart de 0 à chaque boucle
        bounds = []
        prev = None
        for t, f in frames:
            if f < 0 or f >= n:
                continue
            if prev is None or f < prev - n // 2:
                bounds.append(t)
            prev = f
        def pass_of(t):
            k = -1
            for i, b0 in enumerate(bounds):
                if t >= b0:
                    k = i
            return k
        res = [e for e in ev if e["type"] == "result"]
        acc = [e for e in res if e["decision"] == "accept"]
        cho = [e for e in res if e["decision"] == "choose"]
        full = [i for i in range(len(bounds) - 1)]          # passages complets
        ok_pass = 0
        rows = []
        tw = set(twins.get(cid, []))
        for i in full:
            pa = [e for e in acc if pass_of(e["t"]) == i]
            good = [e for e in pa if e["best"]["id"] in grp.get(cid, {cid})]
            early = [e for e in pa if e["f"] < s0]           # pendant l'entrée de la carte
            late = [e for e in pa if e["f"] > s0 + 2 * FPS]   # plus de 2 s après l'arrêt
            stop_t = bounds[i] + s0 / FPS * 1000
            delay = [round(e["t"] - stop_t) for e in pa]
            if tw:
                # jumelle sans image : un choix (image) qui la liste, dans les 2 s après l'arrêt, aucune acceptation
                pc = [e for e in cho if pass_of(e["t"]) == i]
                listed = all(tw & {c["id"] for c in e["candidates"]} for e in pc)
                delay = [round(e["t"] - stop_t) for e in pc]
                ok = not pa and bool(pc) and listed and pc[0]["f"] >= s0 and pc[0]["f"] <= s0 + 2 * FPS
            else:
                ok = len(pa) == 1 and len(good) == 1 and not early and not late
            ok_pass += ok
            rows.append(f"    passage {i + 1} : {len(pa)} acceptation(s) {[(e['best']['id'], e['f'], e['ms']) for e in pa]} "
                        f"délai après l'arrêt {delay} ms, choix {len([e for e in cho if pass_of(e['t']) == i])} → {'OK' if ok else 'ÉCHEC'}")
        print(f"[live {cid}] clip {n} images (arrêt {s0}–{s1}), {len(full)} passages complets")
        print("\n".join(rows))
        states = {}
        for e in ev:
            if e["type"] == "state":
                states[e["state"]] = states.get(e["state"], 0) + 1
        print(f"    états : {states} ; erreurs console : {b.errors[:3]}")
        out[cid] = {"passes": len(full), "ok": ok_pass, "errors": b.errors[:5]}
        json.dump({"events": ev, "frames": frames[-400:]}, open(os.path.join(BENCH, f"live_{cid}.json"), "w"))
    return out


# ----------------------------------------------------------------------------------------------------------
# ocr : lecture du numéro (et du code SV/ME) sur des photos synthétiques de cartes connues, et sur des lignes de
# texte rendues pour les galeries sans image (TG, GG). Première mesure de la précision de l'OCR.

GALLERY_FETCH = ["g1-RC1", "g1-RC5", "g1-RC12", "g1-RC20", "g1-RC27", "sma-SV1", "sma-SV10", "sma-SV33", "sma-SV60", "sma-SV88"]


def ocr_pick(cards, have, seed):
    rnd = random.Random(seed)
    sets = cards["sets"]

    def era(cid):
        return sets.get(cid.rsplit("-", 1)[0], {})

    pools = {"sv/me (code)": [], "bas droite (base→xy)": [], "bas gauche (sm/swsh)": [], "galeries (RC, SV)": []}
    for cid in sorted(have):
        s = era(cid)
        sid, lid = cid.rsplit("-", 1)
        if sid in ("svp", "mep", "swshp", "smp", "xyp", "bwp", "dpp", "hgssp"):
            continue
        if not lid.isdigit():
            if lid[:2] in ("RC", "SV") and sid in ("g1", "sma"):
                pools["galeries (RC, SV)"].append(cid)
            continue
        if s.get("c"):
            pools["sv/me (code)"].append(cid)
        elif s.get("num") == "br":
            pools["bas droite (base→xy)"].append(cid)
        elif s.get("era") in ("sm", "swsh"):
            pools["bas gauche (sm/swsh)"].append(cid)
    want = {"sv/me (code)": 40, "bas droite (base→xy)": 30, "bas gauche (sm/swsh)": 24, "galeries (RC, SV)": 10}
    out = []
    for k, lst in pools.items():
        rnd.shuffle(lst)
        out += [(k, c) for c in lst[:want[k]]]
    return out


def render_lines(out_dir):
    """Lignes « TG05/TG30 », « GG12/GG70 »… rendues (police grasse, flou, bruit, JPEG) : cartes sans image."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    os.makedirs(out_dir, exist_ok=True)
    font = None
    for f in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(f):
            font = ImageFont.truetype(f, 34)
            break
    rng = np.random.default_rng(5)
    cases = []
    for sid, pre, tot, nums in (("swsh9tg", "TG", 30, [1, 5, 12, 23, 30]), ("swsh11tg", "TG", 30, [7, 18]),
                                ("swsh12.5gg", "GG", 70, [3, 12, 44, 58, 70])):
        for n in nums:
            cid = f"{sid}-{pre}{n:02d}"
            text = f"{pre}{n:02d}/{pre}{tot}"
            im = Image.new("L", (360, 70), int(rng.integers(200, 245)))
            d = ImageDraw.Draw(im)
            d.text((24, 14), text, fill=int(rng.integers(10, 50)), font=font)
            im = im.filter(ImageFilter.GaussianBlur(float(rng.uniform(0.6, 1.4))))
            a = np.asarray(im).astype(np.float32) + rng.normal(0, 5, (70, 360))
            name = f"{cid}.jpg"
            Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGB").save(os.path.join(out_dir, name), quality=85)
            cases.append({"url": f"/__bench/ocr_lines/{name}", "id": cid})
    return cases


def cmd_ocr(a, br=None):
    from synth import PRESETS, load_rgb, make_photo
    import build_scan
    import cv2
    cards = load_cards()
    have = high_index()
    # quelques cartes de galerie (numéros RC / SV) : images haute définition téléchargées si absentes (≤ 4 req/s)
    miss = [c for c in GALLERY_FETCH if c not in have and c in set(cards["ids"])]
    if miss:
        f = build_scan.Fetcher()
        for cid in miss:
            sid, lid = cid.rsplit("-", 1)
            s = cards["sets"][sid]
            b = f.get(f"https://assets.tcgdex.net/fr/{s['s']}/{sid}/{lid}/high.webp", timeout=60)
            if b and b[:4] == b"RIFF":
                build_scan.write_bytes_atomic(os.path.join(IMG, "img_fr_high", sid, lid + ".webp"), b)
        have = high_index()
    picks = ocr_pick(cards, have, a.seed)
    # « standard » : photo 1200×1600 (carte ≈ 1 150 px), flou 0,3–1 px ; « net » : carte ≈ 860 px (résolution de
    # l'image source, pas de suréchantillonnage), flou ≤ 0,5 px, sans reflet
    clean = a.ocr_mode == "net"
    d = os.path.join(BENCH, f"ocr{'net' if clean else '2'}_s{a.seed}")
    os.makedirs(d, exist_ok=True)
    pool = [cv2.resize(load_rgb(os.path.join(IMG, have[c])), (256, 352), interpolation=cv2.INTER_AREA) for c in sorted(have)[:12]]
    cases, kinds = [], {}
    for k, (kind, cid) in enumerate(picks):
        name = f"o{k:03d}.jpg"
        p = os.path.join(d, name)
        tp = p + ".json"
        # l'image en cache doit être celle de la même carte (la liste change si de nouvelles images arrivent)
        if not os.path.exists(tp) or json.load(open(tp)).get("id") != cid:
            rng = np.random.default_rng(a.seed * 7919 + k)
            if clean:
                img, corners, guide, meta = make_photo(load_rgb(os.path.join(IMG, have[cid])), rng, pool, res=1200,
                                                       blur=(0.0, 0.5), jpeg=(85, 95), **{**PRESETS["standard"], "glare_p": 0.0})
            else:
                img, corners, guide, meta = make_photo(load_rgb(os.path.join(IMG, have[cid])), rng, pool, res=1600,
                                                       blur=(0.3, 1.0), **{**PRESETS["standard"], "glare_p": 0.3})
            cv2.imwrite(p, cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
            json.dump({"id": cid, "corners": corners.round(2).tolist(), "guide": [round(v, 2) for v in guide]}, open(tp, "w"))
        t = json.load(open(tp))
        cases.append({"url": f"/__bench/{os.path.basename(d)}/{name}", "id": cid, "guide": t["guide"], "corners": t["corners"]})
        kinds[cid] = kind
    raw = render_lines(os.path.join(BENCH, "ocr_lines"))
    own = br is None
    br = br or Browser()
    try:
        br.ev("bench.init()")
        info = br.ev("bench.ocrInit()")
        print(f"OCR : chargement de tesseract.js + fra {info['loadMs']:.0f} ms")
        res = []
        for s in range(0, len(cases), 8):
            res += br.ev("([c, o]) => bench.ocrCases(c, o)", [cases[s:s + 8], {}])
        rres = br.ev("c => bench.ocrRaw(c)", raw)
        if br.errors:
            print("erreurs console :", br.errors[:5])
    finally:
        if own:
            br.close()
    norm = lambda s: "".join(ch for ch in s.upper() if ch.isalnum() or ch == "/")  # noqa: E731
    stats = {}
    lines_ms = []
    rows = []
    for r in res:
        k = kinds[r["id"]]
        s = stats.setdefault(k, {"n": 0, "exact": 0, "num": 0, "code": 0, "free_ok": 0, "free_in": 0, "free_wrong": 0, "ver_ok": 0, "ver_wrong": 0})
        s["n"] += 1
        if r.get("error"):
            continue
        exp = r["exp"]
        code, num = (exp.split("FR", 1) if "FR" in exp[3:5] else ("", exp))
        has_num = any(num in norm(t["text"]) for t in r["texts"])
        has_code = bool(code) and any(code in norm(t["text"]) for t in r["texts"])
        exact = has_num and (not code or has_code)
        s["exact"] += exact
        s["num"] += has_num
        s["code"] += has_code
        fr, ve = r["free"], r["ver"]
        if fr:
            s["free_in"] += r["id"] in fr["ids"]
            if fr["decision"] == "accept":
                s["free_ok"] += fr["ids"][0] == r["id"]
                s["free_wrong"] += fr["ids"][0] != r["id"]
        if ve and ve["decision"] == "accept":
            s["ver_ok"] += ve["ids"][0] == r["id"]
            s["ver_wrong"] += ve["ids"][0] != r["id"]
        lines_ms += r["ms"]
        if not exact:
            rows.append(f"    {r['id']:<16} attendu {exp:<18} lu {[t['text'] for t in r['texts']]}")
    print("\n".join(rows[:30]))
    for k, s in stats.items():
        print(f"[OCR · {k}] n={s['n']} numéro lu {s['num']}" + (f", code lu {s['code']}" if k.startswith("sv") else "") +
              f" · grammaire seule (carte sans image) : acceptée juste {s['free_ok']}, fausse {s['free_wrong']}, "
              f"carte parmi les propositions {s['free_in']} · vérification (candidats de l'image) : juste {s['ver_ok']}, "
              f"fausse {s['ver_wrong']}")
    ok_raw = sum(1 for r in rres if any(r["exp"] in norm(t) for t in r["texts"]))
    in_raw = sum(1 for r in rres if r["free"] and r["id"] in r["free"]["ids"])
    print(f"[OCR · lignes rendues TG/GG] n={len(rres)} lecture exacte {ok_raw} · carte parmi les candidats {in_raw} "
          f"(TG : 4 séries ont les mêmes numéros → choix)")
    for r in rres:
        if not any(r["exp"] in norm(t) for t in r["texts"]):
            print(f"    {r['id']:<18} attendu {r['exp']:<12} lu {r['texts']}")
    print(f"    temps par ligne : p50 {q(lines_ms, 0.5):.0f} ms, p90 {q(lines_ms, 0.9):.0f} ms ({len(lines_ms)} lignes)")
    json.dump({"res": res, "raw": rres}, open(os.path.join(BENCH, f"res_ocr_{a.ocr_mode}.json"), "w"))
    return {"stats": stats, "raw": f"{ok_raw}/{len(rres)}", "line_ms_p50": q(lines_ms, 0.5), "load_ms": info["loadMs"]}


# ----------------------------------------------------------------------------------------------------------
# api : l'API publique (js/scan/index.js) dans une vraie page : preload, identifyImage (photos synthétiques et
# réelles importées), ocrFallback, erreurs de caméra typées, forme des résultats, erreurs console.

def cmd_api(a):
    cards = load_cards()
    grp = groups_of(cards)
    _, truth = gen_synth("standard", 300, a.seed)
    cases = [{"url": f"/__bench/standard_300_s{a.seed}/{t['file']}", "id": t["id"]} for t in truth[:12]]
    reals = []
    rdir = os.path.join(BENCH, "real")
    for f in ("NolanAmblard__testImages__tiltleft.jpg", "NolanAmblard__testImages__tiltright.jpg"):
        if os.path.exists(os.path.join(rdir, f)):
            reals.append({"url": f"/__bench/real/{f}", "id": "xy12-20"})
    # --no-offscreen : comme Safari < 16.4 (pas d'OffscreenCanvas sur la page) → images préparées sur le fil principal
    b = Browser(page="tools/scanbench/live.html", init_script="delete window.OffscreenCanvas" if a.no_offscreen else None)
    try:
        if a.no_offscreen:
            print("    OffscreenCanvas sur la page :", b.ev("() => typeof OffscreenCanvas"))
        info = b.ev("() => window.live.ready")
        print(f"preload : {info}")
        out = b.ev("""async cases => {
          const S = window.live.scan, res = [];
          for (const c of cases) {
            const blob = await (await fetch(c.url)).blob();
            const t0 = performance.now();
            const r = await S.identifyImage(blob);
            res.push({ id: c.id, ms: performance.now() - t0, r });
          }
          return res;
        }""", cases + reals)
        ok = 0
        for x in out:
            r = x["r"]
            good = bool(r) and r["best"]["id"] in grp.get(x["id"], {x["id"]})
            shape = bool(r) and r["decision"] in ("accept", "choose") and isinstance(r["candidates"], list) and                 len(r["candidates"]) <= 5 and isinstance(r["alternatives"], list) and r["source"] == "image"
            ok += good and shape
            print(f"    import {x['id']:<16} {'ok ' if good else 'NON'} {r and r['decision']} {r and r['best']} "
                  f"forme {'ok' if shape else 'NON'} {x['ms']:.0f} ms")
        print(f"[api · identifyImage] {ok}/{len(out)}")
        o = b.ev("""async cases => {
          const S = window.live.scan, res = [];
          for (const c of cases) {
            const blob = await (await fetch(c.url)).blob();
            const t0 = performance.now();
            const r = await S.ocrFallback(blob, { candidates: [c.id] });
            res.push({ id: c.id, ms: performance.now() - t0, r });
          }
          return res;
        }""", cases[:4])
        for x in o:
            r = x["r"]
            print(f"    ocrFallback {x['id']:<16} {r and r['decision']} {r and r['best']['id']} lu {r and r.get('text')} {x['ms']:.0f} ms")
        bad = b.ev("""async () => { try { await window.live.scan.identifyImage(new Blob(['bonjour'], { type: 'text/plain' })); return 'pas d’erreur'; }
                      catch (e) { return e.name + ' / ' + e.kind + ' / ' + e.message; } }""")
        print(f"    fichier qui n'est pas une image : {bad}")
        warm = b.ev("async () => { const S = window.live.scan; const t0 = performance.now(); const n = await S.warmOcr(); return [n, performance.now() - t0]; }")
        print(f"    warmOcr : {warm[0]} octets en {warm[1]:.0f} ms")
        cam = b.ev("""async () => { try { await window.live.scan.openCamera(document.getElementById('v')); return 'ouverte'; }
                      catch (e) { return e.name + ' / ' + e.kind + ' / ' + e.message; } }""")
        print(f"    caméra sans périphérique : {cam}")
        print(f"    erreurs console : {b.errors[:5]}")
    finally:
        b.close()


# ----------------------------------------------------------------------------------------------------------
# loop : scénarios de la boucle et de l'API (vraie page tools/scanbench/live.html, worker, flux de canvas)

def cmd_loop(a):
    cards = load_cards()
    grp = groups_of(cards)
    twins = cards.get("twins", {})
    _, truth = gen_synth("standard", 300, a.seed)
    rel = f"standard_300_s{a.seed}"

    def url(t):
        return f"/__bench/{rel}/{t['file']}"

    def frac(t):
        from PIL import Image
        with Image.open(os.path.join(BENCH, rel, t["file"])) as im:
            W, H = im.size
        g = t["guide"]
        return [g[0] / W, g[1] / H, g[2] / W, g[3] / H]

    def block(route):
        route.abort()

    out = {}
    # carte sans réimpression ni jumelle, reconnue « forte » (voir res_standard_x1.json si présent)
    strong = set()
    rp = os.path.join(BENCH, "res_standard_x1.json")
    if os.path.exists(rp):
        strong = {r["id"] for r in json.load(open(rp)) if r.get("level") == "strong"}
    single = next(t for t in truth if t["id"] not in grp and t["id"] not in twins and (not strong or t["id"] in strong))

    # 1. hors ligne (high.webp bloquées) : réimpressions et sosies jamais acceptés sur l'image seule
    b = Browser(page="tools/scanbench/live.html", routes=[("https://assets.tcgdex.net/**", block)])
    try:
        b.ev("() => window.live.ready")
        fam = [t for t in truth if t["id"] in grp]
        res = [b.ev("([u, g]) => window.live.identifyGuided(u, g)", [url(t), t["guide"]]) for t in fam]
        acc = [(t["id"], r["res"]["best"]) for t, r in zip(fam, res) if r["res"] and r["res"]["decision"] == "accept"]
        wrong = [x for x in acc if x[0] != x[1]]
        ok = not acc
        print(f"[loop · hors ligne] {len(fam)} cartes avec réimpressions : acceptées {len(acc)}, mauvaise série {len(wrong)} → {'OK' if ok else 'ÉCHEC'}")
        out["offline"] = ok
    finally:
        b.close()

    # 2. stop() / destroy() pendant l'identification (zone du numéro lente) : plus aucun événement
    t = next(t for t in truth if t["id"] in grp)

    def slow(route):
        time.sleep(3)
        route.abort()
    b = Browser(page="tools/scanbench/live.html", routes=[("https://assets.tcgdex.net/**", slow)])
    try:
        b.ev("() => window.live.ready")
        b.ev("([u, f]) => window.live.startSeq(u, f)", [url(t), frac(t)])
        b.page.wait_for_function("window.live.events.some(e => e.state === 'identifying')", timeout=20000)
        b.page.wait_for_timeout(300)
        n0 = b.ev("() => { const l = window.live.loop; l.stop(); l.destroy(); window.live.scan.closeCamera(); return window.live.events.length; }")
        b.page.wait_for_timeout(7000)
        after = b.ev("n => window.live.events.slice(n)", n0)
        ok = not after
        print(f"[loop · destroy] événements après destroy() : {len(after)} → {'OK' if ok else 'ÉCHEC ' + str(after[:3])}")
        out["destroy"] = ok
    finally:
        b.close()

    # 3. stop() puis shutter() : une seule identification, la boucle reste arrêtée ; auto: false
    b = Browser(page="tools/scanbench/live.html", routes=[("https://assets.tcgdex.net/**", block)])
    try:
        b.ev("() => window.live.ready")
        b.ev("([u, f]) => window.live.startSeq(u, f)", [url(single), frac(single)])
        b.page.wait_for_function("window.live.events.some(e => e.type === 'result')", timeout=20000)
        b.ev("() => { window.live.loop.stop(); return 1; }")
        b.page.wait_for_timeout(800)
        n0 = b.ev("() => window.live.events.length")
        b.ev("() => { window.live.loop.shutter(); return 1; }")
        b.page.wait_for_timeout(2500)
        after = b.ev("n => window.live.events.slice(n)", n0)
        st = b.ev("() => window.live.loop.state")
        res = [e for e in after if e["type"] == "result"]
        ok = len(res) == 1 and not st["running"] and len(after) <= 4
        print(f"[loop · stop puis shutter] {len(after)} événements, {len(res)} résultat, en marche {st['running']} → {'OK' if ok else 'ÉCHEC'}")
        out["shutter"] = ok
    finally:
        b.close()
    b = Browser(page="tools/scanbench/live.html", routes=[("https://assets.tcgdex.net/**", block)])
    try:
        b.ev("() => window.live.ready")
        b.ev("([u, f]) => window.live.startSeq(u, f, { auto: false })", [url(single), frac(single)])
        b.page.wait_for_timeout(3000)
        res0 = b.ev("() => window.live.events.filter(e => e.type === 'result').length")
        hints = b.ev("() => [...new Set(window.live.events.map(e => e.hint))]")
        b.ev("() => { window.live.loop.shutter(); return 1; }")
        b.page.wait_for_timeout(2000)
        res1 = b.ev("() => window.live.events.filter(e => e.type === 'result')")
        # hold() (carte choisie par l'utilisateur) : pause jusqu'à ce que la carte sorte, même après un nouvel appui
        b.ev("() => { window.live.loop.start(); window.live.loop.hold(); return 1; }")
        b.page.wait_for_timeout(1500)
        held = b.ev("() => window.live.loop.state")
        res2 = b.ev("() => window.live.events.filter(e => e.type === 'result').length")
        ok = res0 == 0 and len(res1) == 1 and res1[0]["best"]["id"] == single["id"] and held["phase"] == "paused" and res2 == 1
        print(f"[loop · auto: false] résultats avant l'appui {res0}, après {len(res1)} ({res1[0]['best']['id'] if res1 else None}) ; "
              f"hold() → {held['phase']}, résultats ensuite {res2 - len(res1)} ; indications {hints} → {'OK' if ok else 'ÉCHEC'}")
        out["manual"] = ok
    finally:
        b.close()

    # 4. carte peu contrastée après une carte très contrastée : résultat rapide (netteté propre à chaque carte)
    b = Browser(routes=[("https://assets.tcgdex.net/**", block)])
    try:
        b.ev("bench.init()")
        cand = [t for t in truth[:100] if t["id"] not in grp and t["id"] not in twins and (not strong or t["id"] in strong)][:60]
        det = b.ev("c => bench.detectCases(c)", [{"url": url(t), "id": t["id"], "guide": t["guide"]} for t in cand])
        vis = sorted([(d["sharp"], t) for d, t in zip(det, cand) if d["present"]], key=lambda x: x[0])
        lo_t, hi_t = vis[0][1], vis[-1][1]
        print(f"    force des bords : {vis[0][0]:.1f} ({lo_t['id']}) → {vis[-1][0]:.1f} ({hi_t['id']})")
    finally:
        b.close()
    b = Browser(page="tools/scanbench/live.html", routes=[("https://assets.tcgdex.net/**", block)])
    try:
        b.ev("() => window.live.ready")
        b.ev("([u, f]) => window.live.startSeq(u, f)", [url(hi_t), frac(hi_t)])
        b.page.wait_for_function("window.live.events.some(e => e.type === 'result')", timeout=20000)
        b.ev("() => window.live.seqShow(null)")
        b.page.wait_for_timeout(1500)
        t_show = b.ev("u => window.live.seqShow(u)", url(lo_t))
        b.page.wait_for_timeout(6000)
        ev = b.ev("t => window.live.events.filter(e => e.t >= t)", t_show)
        res = [e for e in ev if e["type"] == "result"]
        blur = sum(1 for e in ev if (e.get("hint") or "").startswith("Image floue"))
        delay = (res[0]["t"] - t_show) / 1000 if res else None
        ok = bool(res) and delay < 3
        print(f"[loop · netteté] carte peu contrastée après une très contrastée : résultat après {delay} s, "
              f"« Image floue » ×{blur} → {'OK' if ok else 'ÉCHEC'}")
        out["sharp"] = ok
    finally:
        b.close()

    # 5. base des cartes indisponible au départ (hashes.bin refusé 6 s) : état 'error', puis reprise et résultat
    t_block = time.time() + 6

    def hashes(route):
        if time.time() < t_block:
            route.abort()
        else:
            route.continue_()
    b = Browser(page="tools/scanbench/live.html", routes=[("**/data/scan/hashes.bin*", hashes), ("https://assets.tcgdex.net/**", block)])
    try:
        b.ev("([u, f]) => window.live.startSeq(u, f)", [url(single), frac(single)])
        b.page.wait_for_function("window.live.events.some(e => e.type === 'result')", timeout=40000)
        ev = b.ev("() => window.live.events")
        errs = [e for e in ev if e.get("state") == "error"]
        res = [e for e in ev if e["type"] == "result"]
        ok = bool(errs) and bool(res) and res[0]["best"]["id"] == single["id"]
        print(f"[loop · base indisponible] états 'error' {len(errs)} ({errs[0]['hint'] if errs else '-'}), puis résultat "
              f"{res[0]['best']['id'] if res else None} à {res[0]['t'] / 1000 if res else 0:.1f} s → {'OK' if ok else 'ÉCHEC'}")
        out["retry"] = ok
    finally:
        b.close()

    # 6. carte absente de la base (masquée) : le choix de l'image, puis la proposition de l'OCR arrive à la vue
    d = os.path.join(BENCH, f"ocrnet_s{a.seed}")
    picks = []
    for k in range(40):
        p = os.path.join(d, f"o{k:03d}.jpg.json")
        if os.path.exists(p):
            tt = json.load(open(p))
            if cards["sets"].get(tt["id"].rsplit("-", 1)[0], {}).get("c"):
                picks.append((f"/__bench/ocrnet_s{a.seed}/o{k:03d}.jpg", tt))
    oks = []
    for u, tt in picks[1:4]:
        from PIL import Image
        with Image.open(os.path.join(d, os.path.basename(u))) as im:
            W, H = im.size
        g = tt["guide"]
        b = Browser(page="tools/scanbench/live.html", routes=[("https://assets.tcgdex.net/**", block)])
        try:
            b.ev("() => window.live.ready")
            b.ev("id => window.live.call('exclude', { ids: [id] })", tt["id"])
            b.ev("([u, f]) => window.live.startSeq(u, f)", [u, [g[0] / W, g[1] / H, g[2] / W, g[3] / H]])
            b.page.wait_for_timeout(10000)
            res = b.ev("() => window.live.events.filter(e => e.type === 'result')")
            o = [e for e in res if e["source"] == "ocr"]
            ok = bool(o) and tt["id"] in [c["id"] for c in o[-1]["candidates"]]
            oks.append(ok)
            print(f"[loop · carte masquée + OCR] {tt['id']} : résultats {[(e['decision'], e['source'], e['best']['id']) for e in res]} "
                  f"→ {'OK' if ok else 'ÉCHEC'}")
            if b.errors:
                print("    erreurs console :", b.errors[:3])
        finally:
            b.close()
    out["ocr"] = f"{sum(oks)}/{len(oks)}"
    return out


# ----------------------------------------------------------------------------------------------------------
# all : tout le banc, puis le résumé face aux objectifs de la SPEC §12

def cmd_all(a):
    import copy
    out = {}
    out["bitexact"] = cmd_bitexact(copy.copy(a) if a.n != 300 else type("A", (), {**vars(a), "n": 50})())
    for preset, n, absent in (("standard", 300, True), ("hard", 300, False), ("wide", 150, True)):
        b = copy.copy(a)
        b.preset, b.n, b.absent, b.n_absent = preset, n, absent, n
        b.cpu = "1,4" if preset == "standard" else "1"
        out[preset] = cmd_synth(b)
    if a.real:
        out["real"] = cmd_real(a)
    out["live"] = cmd_live(a)
    out["ocr"] = cmd_ocr(a)
    st, hd, ab = out["standard"]["x1"], out["hard"]["x1"], out["standard"].get("absent", {})
    x4 = out["standard"].get("x4", {})
    rows = [
        ("top-1 synthétique (réimpressions tolérées)", f"{st['top1']:.1f} %", "≥ 97 %", st["top1"] >= 97),
        ("précision des acceptations (décision finale)", f"{st['prec_final']:.1f} %", "≥ 99,5 %", st["prec_final"] >= 99.5),
        ("précision des acceptations, difficile", f"{hd['prec_final']:.1f} %", "≥ 99 %", hd["prec_final"] >= 99),
        ("précision hors ligne (sans high.webp, stricte)", f"{st['prec_off_strict']:.1f} %", "≥ 99,5 %", st["prec_off_strict"] >= 99.5),
        ("fausses acceptations, carte absente", f"{ab.get('fa_final', float('nan')):.1f} %", "≤ 2 %", ab.get("fa_final", 99) <= 2),
        ("  dont illustration unique", f"{ab.get('fa_unique', float('nan')):.1f} %", "≤ 2 %", ab.get("fa_unique", 99) <= 2),
        ("  dont même illustration dans la base", f"{ab.get('fa_lookalike', float('nan')):.1f} %", "(choix via jumelles)", True),
        ("identification p50 à CPU ×4", f"{x4.get('ms_p50', float('nan')):.0f} ms", "≤ 300 ms", x4.get("ms_p50", 9999) <= 300),
        ("bit-exactitude JS / Python", f"{out['bitexact']['worst']}/512", "≤ 4/512", out["bitexact"]["ok"]),
        ("boucle en direct (fausse caméra)", ", ".join(f"{k} {v['ok']}/{v['passes']}" for k, v in out["live"].items()), "1 acceptation par passage", all(v["ok"] == v["passes"] > 0 for v in out["live"].values())),
    ]
    print()
    print("Résumé (SPEC §12)")
    for name, val, target, ok in rows:
        print(f"  {'OK ' if ok else 'NON'} {name:<48} {val:>14}   objectif {target}")
    json.dump(out, open(os.path.join(BENCH, "summary.json"), "w"), indent=1, default=str)
    return out


# ----------------------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["prep", "bitexact", "synth", "rescore", "real", "live", "loop", "ocr", "calib", "api", "all"])
    ap.add_argument("--seed", action="append", default=[], help="(prep) dossier de téléchargements existants")
    ap.add_argument("--fetch", type=int, default=0, help="(prep) images high.webp supplémentaires à télécharger")
    ap.add_argument("--preset", default="standard", choices=["standard", "hard", "wide"])
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--n-slow", type=int, default=100, help="photos mesurées sous ralentissement CPU")
    ap.add_argument("--n-absent", type=int, default=200)
    ap.add_argument("--seed-val", type=int, default=1)
    ap.add_argument("--cpu", default="1,4")
    ap.add_argument("--absent", action="store_true")
    ap.add_argument("--real", default=None, help="dossier des photos réelles (jamais versionnées)")
    ap.add_argument("--clip", action="append", default=None, help="(live) carte du clip de test (plusieurs possibles)")
    ap.add_argument("--seconds", type=float, default=11.0, help="(live) durée d'observation")
    ap.add_argument("--ocr-mode", default="standard", choices=["standard", "net"], help="(ocr) netteté des photos")
    ap.add_argument("--cases", default=None, help="(real) liste des cas (défaut : tools/scanbench/real.json)")
    ap.add_argument("--self", action="store_true", help="(synth, real) mesure la corrélation de la zone du numéro avec la carte n° 1")
    ap.add_argument("--no-offscreen", action="store_true", help="(api) page sans OffscreenCanvas (repli du fil principal)")
    ap.add_argument("--port", type=int, default=None, help="port du serveur local (défaut 8775 ou CARDEX_SCAN_PORT)")
    a = ap.parse_args()
    global PORT, BASE
    if a.port:
        PORT, BASE = a.port, f"http://127.0.0.1:{a.port}"
    if a.cmd != "prep":
        a.seed = a.seed_val
    # serveur local seulement pour les commandes qui lancent Chromium (un seul banc à la fois sur le port 8775)
    srv = serve() if a.cmd not in ("prep", "rescore", "calib") else None
    Handler.real_dir = a.real
    try:
        if a.cmd == "prep":
            cmd_prep(a)
        elif a.cmd == "bitexact":
            a.n = min(a.n, 50) if a.n == 300 else a.n
            cmd_bitexact(a)
        elif a.cmd == "synth":
            cmd_synth(a)
        elif a.cmd == "rescore":
            cmd_rescore(a)
        elif a.cmd == "calib":
            cmd_calib(a)
        elif a.cmd == "real":
            cmd_real(a)
        elif a.cmd == "live":
            cmd_live(a)
        elif a.cmd == "ocr":
            cmd_ocr(a)
        elif a.cmd == "api":
            cmd_api(a)
        elif a.cmd == "loop":
            cmd_loop(a)
        elif a.cmd == "all":
            cmd_all(a)
        else:
            print("commande pas encore disponible :", a.cmd)
    finally:
        if srv:
            srv.shutdown()


if __name__ == "__main__":
    main()
