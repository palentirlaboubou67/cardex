"""Banc des photos réelles étiquetées (scan_bench.py photos) : tout le jeu, avec vérité terrain des bords.

Les photos (labels.json + raw/<src>/<file>, voir le README du jeu) restent hors du dépôt : la préparation écrit
dans --work (un dossier hors du dépôt), jamais ailleurs.

Préparation (une fois, en cache dans --work) :
  - orientation EXIF appliquée, côté max 2 560 px (comme l'import de l'appli), JPEG q95 → work/prep/
  - vérité terrain des bords : quad de la carte par SIFT + RANSAC contre l'image de référence de la base
    (low.webp en cache local, aucune requête réseau) → work/truth.json
  - cas « caméra » : image redressée (carte droite à ±10°) et guide simulé autour de la carte (échelle carte / guide
    0,90–1,06, décalage ±6 % : comme le préréglage synthétique « standard ») → work/guided/

Trois mesures sur le vrai code JS (tools/scanbench/bench.html) :
  import : identifyUnguided (photo importée, sans guide) + décision finale (départage par la zone du numéro)
  camera : identifyGuided avec le guide simulé (+ détection de la boucle : la carte est-elle « vue » ?)
  oracle : empreinte prise sur le vrai quad (plafond de la correspondance, sans détecteur)
"""
import json
import math
import os
import statistics
from concurrent.futures import ProcessPoolExecutor

import numpy as np

MAX_SIDE = 2560


# ----------------------------------------------------------------------------------------------------------
# Préparation

def _ref_path(img_dir, cards, row, cid):
    i = row.get(cid)
    if i is None:
        return None
    lang = "en" if cards["src"][i] == "e" else "fr"
    s, l = cid.rsplit("-", 1)
    for q in ("high", "low"):
        for ext in ("webp", "png"):
            p = os.path.join(img_dir, f"img_{lang}_{q}", s, f"{l}.{ext}")
            if os.path.exists(p):
                return p
    return None


def _load_ref(p):
    from PIL import Image
    im = Image.open(p)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg
    return np.asarray(im.convert("RGB"))


_SIFT = None


def _gt_quad(photo, ref):
    """Quad de la carte (pixels de la photo) par SIFT + RANSAC, et nombre d'appariements retenus."""
    import cv2
    global _SIFT
    if _SIFT is None:
        _SIFT = cv2.SIFT_create(nfeatures=6000)
    H, W = photo.shape[:2]
    k = min(1.0, 1400 / max(H, W))
    ph = cv2.resize(photo, (int(W * k), int(H * k)), interpolation=cv2.INTER_AREA) if k < 1 else photo
    rh, rw = ref.shape[:2]
    kr = 700 / rh
    rr = cv2.resize(ref, (int(rw * kr), int(rh * kr)), interpolation=cv2.INTER_CUBIC if kr > 1 else cv2.INTER_AREA)
    clahe = cv2.createCLAHE(2.0, (8, 8))
    k1, d1 = _SIFT.detectAndCompute(clahe.apply(cv2.cvtColor(ph, cv2.COLOR_RGB2GRAY)), None)
    k2, d2 = _SIFT.detectAndCompute(clahe.apply(cv2.cvtColor(rr, cv2.COLOR_RGB2GRAY)), None)
    if d1 is None or d2 is None or len(k1) < 8 or len(k2) < 8:
        return None, 0
    m = cv2.BFMatcher(cv2.NORM_L2).knnMatch(d2, d1, k=2)
    good = [a for a, b in (x for x in m if len(x) == 2) if a.distance < 0.78 * b.distance]
    if len(good) < 10:
        return None, len(good)
    src = np.float32([k2[g.queryIdx].pt for g in good])
    dst = np.float32([k1[g.trainIdx].pt for g in good])
    Hm, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0, maxIters=5000, confidence=0.999)
    if Hm is None:
        return None, 0
    c = np.float32([[0, 0], [rr.shape[1], 0], [rr.shape[1], rr.shape[0]], [0, rr.shape[0]]]).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(c, Hm).reshape(-1, 2) / k, int(mask.sum())


def _plausible(q, W, H):
    q = np.asarray(q, float)
    z = []
    for i in range(4):
        u, v = q[(i + 1) % 4] - q[i], q[(i + 2) % 4] - q[(i + 1) % 4]
        z.append(u[0] * v[1] - u[1] * v[0])
    if not (all(v > 0 for v in z) or all(v < 0 for v in z)):
        return False
    d = lambda i, j: float(np.linalg.norm(q[j] - q[i]))
    w, h = (d(0, 1) + d(3, 2)) / 2, (d(0, 3) + d(1, 2)) / 2
    if h < 0.08 * min(W, H):
        return False
    return (0.5 < w / h < 1.0 and min(d(0, 1), d(3, 2)) / max(d(0, 1), d(3, 2)) > 0.6
            and min(d(0, 3), d(1, 2)) / max(d(0, 3), d(1, 2)) > 0.6)


def _prep_one(job):
    from PIL import Image, ImageOps
    L, real, work, img_dir, cards, row = job
    name = os.path.splitext(L["file"])[0] + ".jpg"
    dst = os.path.join(work, "prep", name)
    if os.path.exists(dst):
        im = np.asarray(Image.open(dst).convert("RGB"))
    else:
        im0 = ImageOps.exif_transpose(Image.open(os.path.join(real, "raw", L["src"], L["file"]))).convert("RGB")
        W, H = im0.size
        k = min(1.0, MAX_SIDE / max(W, H))
        if k < 1:
            im0 = im0.resize((round(W * k), round(H * k)), Image.LANCZOS)
        im0.save(dst, quality=95)
        im = np.asarray(im0)
    H, W = im.shape[:2]
    gt = {}
    for cid in ([L["id"]] if L.get("id") else (L.get("ids") or [])):
        p = _ref_path(img_dir, cards, row, cid)
        if not p:
            continue
        try:
            q, inl = _gt_quad(im, _load_ref(p))
        except Exception as e:  # noqa: BLE001
            gt[cid] = {"quad": None, "inl": 0, "ok": False, "err": str(e)}
            continue
        ok = q is not None and inl >= 15 and _plausible(q, W, H)
        gt[cid] = {"quad": None if q is None else [[round(float(x), 1), round(float(y), 1)] for x, y in q], "inl": inl, "ok": bool(ok)}
    return name, {"w": W, "h": H, "gt": gt}


def _card_angle(q):
    """Angle (degrés) de l'axe vertical de la carte par rapport à la verticale de l'image."""
    q = np.asarray(q, float)
    down = (q[3] + q[2]) / 2 - (q[0] + q[1]) / 2
    return math.degrees(math.atan2(-down[0], down[1]))


def _guided_one(job):
    """Image « caméra » d'une carte : redressée si besoin, marge ajoutée si la carte touche le bord ; guide simulé."""
    from PIL import Image
    name, cid, quad, work, seed = job
    out = os.path.join(work, "guided", f"{os.path.splitext(name)[0]}__{cid.replace('%', '_')}.jpg")
    im = Image.open(os.path.join(work, "prep", name)).convert("RGB")
    q = np.asarray(quad, float)
    ang = _card_angle(q)
    if abs(ang) > 10:
        # rotation antihoraire de l'image (Image.rotate, y vers le bas) de « ang » : la carte devient droite
        W, H = im.size
        im = im.rotate(ang, resample=Image.BICUBIC, expand=True, fillcolor=(128, 128, 128))
        W2, H2 = im.size
        t = math.radians(ang)
        c, s = math.cos(t), math.sin(t)
        cx, cy = W / 2, H / 2
        q = np.array([[c * (x - cx) + s * (y - cy) + W2 / 2, -s * (x - cx) + c * (y - cy) + H2 / 2] for x, y in q])
        assert abs(_card_angle(q)) < 1, "redressement"
    W, H = im.size
    # marge si la carte touche le bord (une vraie image de caméra montre le fond autour de la carte)
    m = 0.03 * max(W, H)
    if q[:, 0].min() < m or q[:, 1].min() < m or q[:, 0].max() > W - m or q[:, 1].max() > H - m:
        p = int(0.12 * max(W, H))
        arr = np.asarray(im)
        arr = np.pad(arr, ((p, p), (p, p), (0, 0)), mode="edge")
        # fond flou : bord répliqué, adouci (pas de marche nette artificielle au bord de la photo)
        import cv2
        blur = cv2.GaussianBlur(arr, (0, 0), 0.02 * max(W, H))
        blur[p:p + H, p:p + W] = np.asarray(im)
        im = Image.fromarray(blur)
        q = q + p
        W, H = im.size
    im.save(out, quality=95)
    rng = np.random.default_rng(seed)
    ch = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    s = rng.uniform(0.90, 1.06)
    gh = ch / s
    gw = gh * 63 / 88
    cx, cy = q.mean(0)
    cx += rng.uniform(-0.06, 0.06) * gh
    cy += rng.uniform(-0.06, 0.06) * gh
    return {"file": os.path.basename(out), "guide": [cx - gw / 2, cy - gh / 2, gw, gh], "quad": q.round(1).tolist(),
            "angle": round(ang, 1), "w": W, "h": H, "scale": round(s, 3)}


def prepare(labels_path, work, img_dir, cards):
    real = os.path.dirname(os.path.abspath(labels_path))
    for d in ("prep", "guided"):
        os.makedirs(os.path.join(work, d), exist_ok=True)
    labels = json.load(open(labels_path, encoding="utf8"))
    tp = os.path.join(work, "truth.json")
    row = {c: i for i, c in enumerate(cards["ids"])}
    if os.path.exists(tp):
        truth = json.load(open(tp))
    else:
        jobs = [(L, real, work, img_dir, cards, row) for L in labels]
        truth = {}
        with ProcessPoolExecutor(min(16, os.cpu_count() or 4)) as ex:
            for k, (name, r) in enumerate(ex.map(_prep_one, jobs, chunksize=4)):
                truth[name] = r
                if k % 100 == 0:
                    print(f"  préparation {k}/{len(jobs)}", flush=True)
        json.dump(truth, open(tp, "w"))
    gp = os.path.join(work, "guided.json")
    if os.path.exists(gp):
        guided = json.load(open(gp))
    else:
        jobs = []
        for k, L in enumerate(labels):
            name = os.path.splitext(L["file"])[0] + ".jpg"
            for cid, g in truth[name]["gt"].items():
                if g["ok"]:
                    jobs.append((name, cid, g["quad"], work, 1000 + k))
        guided = {}
        with ProcessPoolExecutor(min(16, os.cpu_count() or 4)) as ex:
            for job, r in zip(jobs, ex.map(_guided_one, jobs, chunksize=4)):
                guided[f"{job[0]}|{job[1]}"] = r
        json.dump(guided, open(gp, "w"))
    return labels, truth, guided


# ----------------------------------------------------------------------------------------------------------
# Catégories et ventilations

def category(L):
    single = L["conditions"].get("single", True)
    if L.get("id") is None and not L.get("ids"):
        return "negative"
    if L.get("ids") or not single:
        return "multi"
    if not L.get("inDb"):
        return "absent"
    return "positive" if L.get("confidence") == "verified" else "probable"


def card_h(q):
    q = np.asarray(q, float)
    return (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2


def corner_err(quad, gt):
    if not quad or not gt:
        return None
    a, b = np.asarray(quad, float), np.asarray(gt, float)
    return float(np.max(np.linalg.norm(a - b, axis=1)) / card_h(b))


def bucket_fill(v):
    if v is None:
        return "?"
    return "≥0,85" if v >= 0.85 else "0,6–0,85" if v >= 0.6 else "<0,6"


def bucket_px(h):
    if h is None:
        return "?"
    return "<500" if h < 500 else "500–1000" if h < 1000 else "≥1000"


def breakdown(rows, key, metrics):
    """rows : [(label, rec)] ; key(label, rec) → valeur ; metrics(list of rec) → dict. Retourne {valeur: dict}."""
    g = {}
    for L, r in rows:
        g.setdefault(key(L, r), []).append((L, r))
    return {k: metrics(v) for k, v in sorted(g.items(), key=lambda kv: -len(kv[1]))}


def fmt_row(name, m, cols):
    return f"  {name:<22} " + "  ".join(f"{c}={m[c]}" if not isinstance(m[c], float) else f"{c}={m[c]:.1f}" for c in cols if c in m)
