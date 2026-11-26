"""Base du scanner : data/scan/hashes.bin + data/scan/cards.json (+ data/scan/meta.json).

Pour chaque carte FR de TCGdex (hors Pocket) qui a une image, calcule le descripteur 64 octets
(dHash 256 + pHash 256) avec exactement l'algorithme de js/scan/describe.js (même ordre des opérations,
même table de cosinus), puis les groupes de réimpressions (même illustration), les paires de cartes qui se
ressemblent, la table des codes de série imprimés (SV/ME) et les infos de numérotation par série.

Image utilisée : FR low.webp → FR high.webp → FR low.png → EN low.webp → EN high.webp → EN low.png.
L'ordre des lignes est stable : les cartes déjà présentes gardent leur rang, les nouvelles s'ajoutent à la fin
(diffs git réduits). Un descripteur existant est réutilisé tant que sa source n'a pas changé.

Usage :
  python -P tools/build_scan.py                 # incrémental (réseau pour la liste des séries, TTL 12 h)
  python -P tools/build_scan.py --full          # recalcule tout ce qui est en cache
  python -P tools/build_scan.py --seed DIR ...  # dossiers de téléchargements existants (même structure que le cache)
  python -P tools/build_scan.py --offline       # aucune requête réseau
Dépendances : numpy, Pillow.
"""
import argparse
import collections
import concurrent.futures
import hashlib
import io
import json
import math
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "scan")
CACHE = os.path.join(ROOT, ".cache", "sc", "tcgdex")
API = "https://api.tcgdex.net/v2"
ASSETS = "https://assets.tcgdex.net"
UA = "cardex-build-scan/1.0"
ALGO = {"v": 2, "canon": [256, 352], "region": [10, 11, 246, 341], "dhash": "17x16 area",
        "phash": "64x64 area, DCT-II 16x16, > median excl. DC", "ref": "alpha on white, area resize"}

# ----------------------------------------------------------------------------------------------------------
# Descripteur (doit rester identique à js/scan/describe.js)

CW, CH = 256, 352
REGION = (10, 11, 246, 341)
C128 = [1.0, 0.9996988186962042, 0.9987954562051724, 0.9972904566786902, 0.9951847266721969,
        0.99247953459871, 0.989176509964781, 0.9852776423889412, 0.9807852804032304, 0.9757021300385286,
        0.970031253194544, 0.9637760657954398, 0.9569403357322088, 0.9495281805930367, 0.9415440651830208,
        0.932992798834739, 0.9238795325112867, 0.9142097557035307, 0.9039892931234433, 0.8932243011955153,
        0.881921264348355, 0.8700869911087115, 0.8577286100002721, 0.8448535652497071, 0.8314696123025452,
        0.8175848131515837, 0.8032075314806449, 0.7883464276266062, 0.773010453362737, 0.7572088465064846,
        0.7409511253549592, 0.724247082951467, 0.7071067811865476, 0.6895405447370669, 0.6715589548470183,
        0.6531728429537769, 0.6343932841636455, 0.6152315905806268, 0.5956993044924335, 0.5758081914178453,
        0.5555702330196023, 0.5349976198870973, 0.5141027441932217, 0.4928981922297841, 0.4713967368259978,
        0.4496113296546066, 0.4275550934302822, 0.40524131400498986, 0.38268343236508984, 0.3598950365349883,
        0.33688985339222005, 0.3136817403988916, 0.29028467725446233, 0.2667127574748984, 0.24298017990326398,
        0.21910124015686977, 0.19509032201612833, 0.17096188876030136, 0.14673047445536175, 0.12241067519921628,
        0.09801714032956077, 0.07356456359966745, 0.049067674327418126, 0.024541228522912264, 0.0]


def _cos_matrix():
    m = np.zeros((16, 64), np.float64)
    for k in range(16):
        a = math.sqrt(1 / 64) if k == 0 else math.sqrt(2 / 64)
        for n in range(64):
            j = ((2 * n + 1) * k) % 256
            if j <= 64:
                c = C128[j]
            elif j <= 128:
                c = -C128[128 - j]
            elif j <= 192:
                c = -C128[j - 128]
            else:
                c = C128[256 - j]
            m[k, n] = a * c
    return m


COS = _cos_matrix()
_WCACHE = {}


def area_weights(sn, dn):
    """Poids de recouvrement exacts (comme areaWeights() en JS)."""
    key = (sn, dn)
    if key not in _WCACHE:
        s = sn / dn
        res = []
        for i in range(dn):
            a = i * s
            b = a + s
            lst = []
            for j in range(math.floor(a), math.ceil(b - 1e-9)):
                cov = min(b, j + 1) - max(a, j)
                if cov > 1e-9:
                    lst.append((j, cov / s))
            res.append(lst)
        _WCACHE[key] = res
    return _WCACHE[key]


def area_resize(src, x0, y0, sw, sh, dw, dh):
    """src (B, H, W) float64 → (B, dh, dw). Somme des contributions dans le même ordre que le JS."""
    b = src.shape[0]
    reg = src[:, y0:y0 + sh, x0:x0 + sw]
    tmp = np.empty((b, sh, dw), np.float64)
    for x, taps in enumerate(area_weights(sw, dw)):
        s = np.zeros((b, sh), np.float64)
        for j, c in taps:
            s = s + reg[:, :, j] * c
        tmp[:, :, x] = s
    out = np.empty((b, dh, dw), np.float64)
    for y, taps in enumerate(area_weights(sh, dh)):
        s = np.zeros((b, dw), np.float64)
        for j, c in taps:
            s = s + tmp[:, j, :] * c
        out[:, y, :] = s
    return out


def canon_from_rgba(rgba):
    """rgba (B, h, w, 4) uint8 → cartes canoniques grises (B, CH, CW) float64 (alpha composé sur blanc)."""
    f = rgba.astype(np.float64)
    a = f[..., 3]
    k = 255.0 * (255.0 - a)
    r = (f[..., 0] * a + k) / 255.0
    g = (f[..., 1] * a + k) / 255.0
    bl = (f[..., 2] * a + k) / 255.0
    gray = 0.299 * r + 0.587 * g + 0.114 * bl
    h, w = gray.shape[1:]
    return area_resize(gray, 0, 0, w, h, CW, CH)


def describe(canon):
    """canon (B, CH, CW) float64 → descripteurs (B, 64) uint8 (dHash puis pHash, bits MSB d'abord)."""
    x0, y0, x1, y1 = REGION
    sw, sh = x1 - x0, y1 - y0
    b = canon.shape[0]
    d = area_resize(canon, x0, y0, sw, sh, 17, 16)
    dbits = (d[:, :, 1:] > d[:, :, :-1]).reshape(b, 256)
    p = area_resize(canon, x0, y0, sw, sh, 64, 64)
    t = np.zeros((b, 16, 64), np.float64)
    for i in range(64):
        t = t + COS[None, :, i, None] * p[:, None, i, :]
    low = np.zeros((b, 16, 16), np.float64)
    for n in range(64):
        low = low + t[:, :, n, None] * COS[None, None, :, n]
    low = low.reshape(b, 256)
    med = np.sort(low[:, 1:], axis=1)[:, 127]
    pbits = low > med[:, None]
    return np.concatenate([np.packbits(dbits, axis=1), np.packbits(pbits, axis=1)], axis=1)


def load_rgba(path):
    with Image.open(path) as im:
        return np.asarray(im.convert("RGBA"))


def describe_files(paths, batch=128, log=None):
    """Descripteurs d'une liste de fichiers image (regroupés par taille pour vectoriser)."""
    out = np.zeros((len(paths), 64), np.uint8)
    groups = collections.defaultdict(list)
    imgs = {}
    for i, p in enumerate(paths):
        a = load_rgba(p)
        groups[a.shape].append(i)
        imgs[i] = a
        if len(groups[a.shape]) >= batch:
            idx = groups.pop(a.shape)
            out[idx] = describe(canon_from_rgba(np.stack([imgs.pop(j) for j in idx])))
            if log:
                log(f"  descripteurs {i + 1}/{len(paths)}")
    for shape, idx in groups.items():
        out[idx] = describe(canon_from_rgba(np.stack([imgs.pop(j) for j in idx])))
    return out


# ----------------------------------------------------------------------------------------------------------
# Réseau (TCGdex ≤ 4 requêtes/s, reprises avec attente sur 429/5xx/délai dépassé)

class Fetcher:
    def __init__(self, offline=False, rate=4.0):
        self.offline = offline
        self.gap = 1.0 / rate
        self.lock = threading.Lock()
        self.next = 0.0
        self.count = 0

    def get(self, url, timeout=30):
        """Contenu (bytes), None si 404. Lève une exception après plusieurs échecs."""
        if self.offline:
            raise RuntimeError("hors ligne : " + url)
        delay = 1.0
        for attempt in range(6):
            with self.lock:
                now = time.monotonic()
                wait = self.next - now
                self.next = max(now, self.next) + self.gap
            if wait > 0:
                time.sleep(wait)
            try:
                self.count += 1
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if e.code not in (429, 500, 502, 503, 504) or attempt == 5:
                    raise
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
                if attempt == 5:
                    raise
            time.sleep(delay)
            delay *= 2
        return None


def read_json(path):
    with open(path, encoding="utf8") as f:
        return json.load(f)


def write_bytes_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


class Source:
    """Cache local des réponses TCGdex et des images, alimenté par des dossiers « seed » existants."""

    def __init__(self, fetcher, seeds, ttl_h):
        self.f = fetcher
        self.seeds = [s for s in seeds if os.path.isdir(s)]
        self.ttl = ttl_h * 3600
        self.miss_path = os.path.join(CACHE, "miss.json")
        self.miss = read_json(self.miss_path) if os.path.exists(self.miss_path) else {}
        self.miss_lock = threading.Lock()
        self.downloaded = 0

    def _seed(self, rel):
        for s in self.seeds:
            p = os.path.join(s, rel)
            if os.path.exists(p) and os.path.getsize(p) > 0:
                return p
        return None

    def _adopt(self, rel):
        """Copie (ou lien) un fichier seed dans le cache ; retourne le chemin en cache ou None."""
        dst = os.path.join(CACHE, rel)
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            return dst
        src = self._seed(rel)
        if not src:
            return None
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            os.link(src, dst)
        except OSError:
            shutil.copyfile(src, dst)
        return dst

    def json(self, rel, url):
        p = os.path.join(CACHE, rel)
        fresh = os.path.exists(p) and (self.f.offline or time.time() - os.path.getmtime(p) < self.ttl)
        if not fresh and not os.path.exists(p):
            if self._adopt(rel):
                fresh = self.f.offline or time.time() - os.path.getmtime(p) < self.ttl
        if fresh:
            return read_json(p)
        gone = p + ".404"                      # absente côté serveur lors d'un passage récent
        if os.path.exists(gone) and (self.f.offline or time.time() - os.path.getmtime(gone) < self.ttl):
            return None
        if self.f.offline:                     # hors ligne et jamais téléchargée : considérée absente
            return read_json(p) if os.path.exists(p) else None
        try:
            b = self.f.get(url)
        except Exception as e:  # noqa: BLE001
            if os.path.exists(p):
                print(f"  ! {url} : {e} (copie en cache utilisée)")
                return read_json(p)
            raise
        if b is None:
            write_bytes_atomic(gone, b"")
            return None
        data = json.loads(b.decode("utf8"))
        write_bytes_atomic(p, b)
        return data

    def image(self, rel, url):
        """Chemin local de l'image (téléchargée si besoin) ou None (absente côté serveur)."""
        p = self._adopt(rel)
        if p:
            return p
        if self.f.offline:
            return None
        seen = self.miss.get(url)              # absente lors d'un passage précédent : on réessaie après 30 jours
        if seen and time.time() - time.mktime(time.strptime(seen, "%Y-%m-%d")) < 30 * 86400:
            return None
        try:
            b = self.f.get(url, timeout=60)
        except Exception as e:  # noqa: BLE001
            print(f"  ! image {url} : {e}")
            return None
        ok = b is not None and (b[:4] == b"RIFF" or b[:8] == b"\x89PNG\r\n\x1a\n")
        if not ok:
            with self.miss_lock:
                self.miss[url] = time.strftime("%Y-%m-%d")
            return None
        dst = os.path.join(CACHE, rel)
        write_bytes_atomic(dst, b)
        self.downloaded += 1
        return dst

    def save_miss(self):
        os.makedirs(CACHE, exist_ok=True)
        write_bytes_atomic(self.miss_path, dumps(self.miss).encode("utf8"))


# ----------------------------------------------------------------------------------------------------------
# Catalogue et règles de mise en page

def is_pocket(set_id, serie=None):
    return serie == "tcgp" or set_id == "P-A" or (len(set_id) >= 2 and set_id[0] in "AB" and set_id[1].isdigit())


def layout_era(set_id, serie):
    """Ère de mise en page (position du numéro) d'une série."""
    if serie == "tk":                                   # kits du dresseur : tk-<ère>-…
        e = set_id.split("-")[1]
        return {"hs": "hgss"}.get(e, e)
    if serie == "mc":                                   # McDonald's : 2011bw … 2024sv
        e = set_id[4:].split("-")[0]
        return e or "bw"
    if set_id == "cel25cc":                             # Collection Classique : numéros d'origine
        return "base"
    if serie == "misc":
        return "base"
    return serie


def num_pos(era, set_id):
    if era in ("sm", "swsh", "sv", "me"):
        return "bl"                                     # en bas à gauche (depuis Soleil et Lune)
    if era == "ecard":
        return "ec"                                     # à droite du centre, au-dessus de la bande de points
    return "br"                                         # en bas à droite


def set_of(card_id):
    return card_id[:card_id.rindex("-")]


def local_of(card_id):
    return card_id[card_id.rindex("-") + 1:]


def load_catalog(src, log):
    lst = src.json("sets_fr.json", f"{API}/fr/sets")
    if not lst:
        raise SystemExit("liste des séries TCGdex indisponible")
    ids = [s["id"] for s in lst if not is_pocket(s["id"])]
    log(f"{len(ids)} séries FR (hors Pocket)")
    sets, en = {}, {}

    def one(sid):
        return sid, src.json(f"sets_fr/{sid}.json", f"{API}/fr/sets/{sid}")

    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        for sid, d in ex.map(one, ids):
            if not d or is_pocket(sid, (d.get("serie") or {}).get("id")):
                continue
            sets[sid] = d
    need_en = [sid for sid, d in sets.items() if any(not c.get("image") for c in d.get("cards") or [])]

    def one_en(sid):
        return sid, src.json(f"sets_en/{sid}.json", f"{API}/en/sets/{sid}")

    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        for sid, d in ex.map(one_en, need_en):
            if d:
                en[sid] = {c["id"]: c for c in d.get("cards") or []}
    return sets, en


def ordered_sets(sets):
    return sorted(sets.values(), key=lambda d: (d.get("releaseDate") or "9999", d["id"]))


def image_candidates(card, en_card, set_id):
    """Liste ordonnée (langue, variante, url, chemin relatif en cache)."""
    lid = card["localId"].replace("/", "_")
    out = []
    for lang, base in (("fr", card.get("image")), ("en", (en_card or {}).get("image"))):
        if not base:
            continue
        for var, sub, ext in (("low.webp", "low", "webp"), ("high.webp", "high", "webp"), ("low.png", "lowpng", "png")):
            out.append((lang, var, f"{base}/{var}", f"img_{lang}_{sub}/{set_id}/{lid}.{ext}"))
    return out


# ----------------------------------------------------------------------------------------------------------
# Groupes de réimpressions et sosies

# Sosies : deux cartes différentes dont les références sont à d ≤ 1,0 (128 bits sur 512). La boucle ne les accepte
# jamais sur l'image seule : la zone du numéro départage (sinon choix). 0,86 (FINAL-scanner) laissait passer des
# paires de même illustration (e-card holo / non holo 0,89, Évolutions / Set de base 0,98).
NEAR_BITS = 128


def pair_tables(desc, log):
    """Distances de Hamming toutes paires (dHash, pHash) par blocs ; renvoie paires dup et proches."""
    n = len(desc)
    dh = np.unpackbits(desc[:, :32], axis=1).astype(np.float32)
    ph = np.unpackbits(desc[:, 32:], axis=1).astype(np.float32)
    sd, sp = dh.sum(1), ph.sum(1)
    dup, near = [], []
    nn = np.full(n, 999, np.int32)
    step = 2048
    for s in range(0, n, step):
        e = min(n, s + step)
        hd = sd[s:e, None] + sd[None, :] - 2 * (dh[s:e] @ dh.T)
        hp = sp[s:e, None] + sp[None, :] - 2 * (ph[s:e] @ ph.T)
        hd = np.rint(hd).astype(np.int32)
        hp = np.rint(hp).astype(np.int32)
        tot = hd + hp
        tot[np.arange(e - s), np.arange(s, e)] = 9999
        nn[s:e] = tot.min(1)
        ii, jj = np.nonzero(tot <= NEAR_BITS)
        for i, j in zip(ii.tolist(), jj.tolist()):
            gi = s + i
            if gi >= j:
                continue
            if hp[i, j] <= 20 and hd[i, j] <= 24:
                dup.append((gi, j))
            else:
                near.append((gi, j, int(tot[i, j])))
        log(f"  paires {e}/{n}")
    return dup, near, nn


def groups_from(dup, n):
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j in dup:
        a, b = find(i), find(j)
        if a != b:
            parent[max(a, b)] = min(a, b)
    g = collections.defaultdict(list)
    for i in range(n):
        g[find(i)].append(i)
    return [sorted(v) for v in g.values() if len(v) > 1]


# ----------------------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", action="append", default=[], help="dossier de téléchargements existants")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--full", action="store_true", help="recalcule tous les descripteurs dont l'image est en cache")
    ap.add_argument("--ttl", type=float, default=12, help="durée de validité du cache des séries (heures)")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    t0 = time.time()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    def log(m):
        print(f"[{time.time() - t0:6.1f}s] {m}", flush=True)

    fetcher = Fetcher(offline=args.offline)
    src = Source(fetcher, args.seed, args.ttl)
    sets, en = load_catalog(src, log)

    # Ancienne base (ordre stable, réutilisation des descripteurs)
    old_cards = read_json(os.path.join(args.out, "cards.json")) if os.path.exists(os.path.join(args.out, "cards.json")) else None
    old_meta = read_json(os.path.join(args.out, "meta.json")) if os.path.exists(os.path.join(args.out, "meta.json")) else {}
    old_rows = {}
    if old_cards and os.path.exists(os.path.join(args.out, "hashes.bin")):
        raw = np.frombuffer(open(os.path.join(args.out, "hashes.bin"), "rb").read(), np.uint8).reshape(-1, 64)
        same_algo = old_meta.get("algo") == ALGO
        vsrc = old_meta.get("var", {})
        for i, cid in enumerate(old_cards["ids"]):
            if same_algo:
                old_rows[cid] = (raw[i], old_cards["src"][i] + "/" + vsrc.get(cid, "low.webp"))

    # Source d'image de chaque carte
    log("images…")
    jobs = []
    order = []
    for d in ordered_sets(sets):
        for c in d.get("cards") or []:
            order.append((d, c))

    def pick(dc):
        d, c = dc
        enc = en.get(d["id"], {}).get(c["id"])
        for lang, var, url, rel in image_candidates(c, enc, d["id"]):
            p = src.image(rel, url)
            if p:
                return c["id"], lang, var, p
        return c["id"], None, None, None

    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        picked = list(ex.map(pick, order))
    src.save_miss()
    log(f"images prêtes ({src.downloaded} téléchargées, {fetcher.count} requêtes)")

    info = {}
    for (d, c), (cid, lang, var, path) in zip(order, picked):
        info[cid] = (d, c, lang, var, path)

    # Ordre des lignes : anciennes (toujours présentes) puis nouvelles
    with_img = [cid for cid, v in info.items() if v[2]]
    present = set(with_img)
    ids = [cid for cid in (old_cards["ids"] if old_cards else []) if cid in present]
    known = set(ids)
    ids += [cid for cid in with_img if cid not in known]
    pos = {cid: i for i, cid in enumerate(ids)}

    desc = np.zeros((len(ids), 64), np.uint8)
    todo = []
    reused = 0
    for cid in ids:
        d, c, lang, var, path = info[cid]
        key = ("f" if lang == "fr" else "e") + "/" + var
        if not args.full and cid in old_rows and old_rows[cid][1] == key:
            desc[pos[cid]] = old_rows[cid][0]
            reused += 1
        else:
            todo.append(cid)
    log(f"{len(ids)} cartes avec image ; {reused} descripteurs réutilisés, {len(todo)} à calculer")
    if todo:
        res = describe_files([info[cid][4] for cid in todo], log=log)
        for cid, r in zip(todo, res):
            desc[pos[cid]] = r
    log("descripteurs prêts")

    # Réimpressions (même illustration) et sosies
    dup, near, nn = pair_tables(desc, log)
    groups = groups_from(dup, len(ids))
    gid = {}
    for k, g in enumerate(groups):
        for i in g:
            gid[i] = k
    near = [(i, j, t) for i, j, t in near if not (i in gid and gid.get(j) == gid[i])]
    near_cards = len({i for i, j, _ in near} | {j for i, j, _ in near})
    in_groups = sum(len(g) for g in groups)
    log(f"réimpressions : {len(groups)} groupes, {in_groups} cartes ; sosies : {len(near)} paires, {near_cards} cartes ; "
        f"plus proche voisin ≤ 0,86 : {(nn <= 110).sum()} cartes, ≤ 1,0 : {(nn <= 128).sum()} cartes")

    # Tables par série
    set_info, codes = {}, {}
    for d in ordered_sets(sets):
        sid = d["id"]
        serie = (d.get("serie") or {}).get("id", "")
        era = layout_era(sid, serie)
        cc = d.get("cardCount") or {}
        e = {"t": cc.get("official") or 0, "era": era, "num": num_pos(era, sid), "s": serie}
        ab = (d.get("abbreviation") or {}).get("official")
        if ab and serie in ("sv", "me"):
            e["c"] = ab
            if ab in codes:
                codes[ab] = (codes[ab] if isinstance(codes[ab], list) else [codes[ab]]) + [sid]
            else:
                codes[ab] = sid
        set_info[sid] = e

    # Cartes rangées dans une autre série que celle de leur id (pl4-AR1… dans pl3) : même mise en page que la série
    # qui les contient, sans total imprimé connu
    for cid, (d, c, lang, var, path) in info.items():
        sid = set_of(cid)
        if sid not in set_info and d["id"] in set_info:
            set_info[sid] = dict(set_info[d["id"]], t=0, host=d["id"])
            set_info[sid].pop("c", None)

    # Exceptions d'URL d'image (chemin TCGdex différent de <lang>/<serie>/<série de l'id>/<localId>)
    img_exc, var_exc = {}, {}
    for cid in ids:
        d, c, lang, var, path = info[cid]
        base = c.get("image") if lang == "fr" else en[d["id"]][cid].get("image")
        sid = set_of(cid)                   # la série déduite de l'id (pl4-AR1 est rangée dans pl3)
        derived = f"{ASSETS}/{lang}/{set_info[sid]['s']}/{sid}/{local_of(cid)}" if sid in set_info else None
        if base != derived:
            img_exc[cid] = base[len(ASSETS) + 1:]
        if var != "low.webp":
            var_exc[cid] = var
    noimg = [cid for cid, v in info.items() if not v[2]]

    cards = {
        "v": 1,
        "built": time.strftime("%Y-%m-%d", time.gmtime()),
        "algo": ALGO,
        "ids": ids,
        "src": "".join("f" if info[cid][2] == "fr" else "e" for cid in ids),
        "noimg": noimg,
        "dups": [[ids[i] for i in g] for g in sorted(groups)],
        "near": [[ids[i], ids[j]] for i, j, _ in sorted(near)],
        "codes": dict(sorted(codes.items())),
        "sets": set_info,
        "img": dict(sorted(img_exc.items())),
    }
    meta = {"v": 1, "algo": ALGO, "rows": len(ids), "var": dict(sorted(var_exc.items())),
            "sha256": hashlib.sha256(desc.tobytes()).hexdigest()}

    # Écriture (rien n'est réécrit si le contenu n'a pas changé)
    os.makedirs(args.out, exist_ok=True)
    old_cmp = dict(old_cards or {}, built=None)
    if old_cards and dumps(old_cmp) == dumps(dict(cards, built=None)) and old_meta.get("sha256") == meta["sha256"]:
        log("aucun changement")
        return
    write_bytes_atomic(os.path.join(args.out, "hashes.bin"), desc.tobytes())
    write_bytes_atomic(os.path.join(args.out, "cards.json"), dumps(cards).encode("utf8"))
    write_bytes_atomic(os.path.join(args.out, "meta.json"), dumps(meta).encode("utf8"))
    raw = os.path.getsize(os.path.join(args.out, "cards.json"))
    import gzip
    gz = len(gzip.compress(dumps(cards).encode("utf8"), 9))
    log(f"écrit : hashes.bin {desc.nbytes} o, cards.json {raw} o ({gz} o gzip), {len(noimg)} cartes sans image, "
        f"{len(codes)} codes, {len(img_exc)} URL particulières, {len(var_exc)} images hors low.webp")


if __name__ == "__main__":
    main()
