"""Photo de téléphone synthétique d'une carte (repris de la recherche, FINAL-scanner §4.1) : perspective,
placement par rapport au guide affiché, fond, éclairage, reflets, holo, flou, bruit, JPEG.
Coordonnées continues : les coins renvoyés sont les vrais coins extérieurs de la carte (pixel i centré en i + 0,5)."""
import math

import cv2
import numpy as np

CARD_RATIO = 63 / 88

PRESETS = {
    # placement 0,90–1,06 × le guide, décalage ±6 %, inclinaison ±12° (conditions de la recherche)
    "standard": dict(tilt=12.0, roll=5.0, scale=(0.90, 1.06), offset=0.06, glare_p=0.6, holo_p=0.3),
    # inclinaison ±20°, reflet sur chaque photo, holo 70 %
    "hard": dict(tilt=20.0, roll=5.0, scale=(0.90, 1.06), offset=0.06, glare_p=1.0, holo_p=0.7),
    # placement large : 0,75–1,10 × le guide, décalage ±10 %
    "wide": dict(tilt=12.0, roll=5.0, scale=(0.75, 1.10), offset=0.10, glare_p=0.6, holo_p=0.3),
}


def load_rgb(path, bg=(255, 255, 255)):
    from PIL import Image
    with Image.open(path) as im:
        a = np.asarray(im.convert("RGBA")).astype(np.float32)
    rgb = a[..., :3] * (a[..., 3:4] / 255) + np.array(bg, np.float32) * (1 - a[..., 3:4] / 255)
    return rgb.astype(np.uint8)


def _background(rng, W, H, pool):
    kind = rng.choice(["solid", "gradient", "noise", "cards", "wood"], p=[0.2, 0.2, 0.2, 0.25, 0.15])
    if kind == "solid":
        bg = np.ones((H, W, 3), np.float32) * rng.integers(0, 256, 3)
    elif kind == "gradient":
        c1, c2 = rng.integers(0, 256, 3), rng.integers(0, 256, 3)
        t = np.linspace(0, 1, H)[:, None, None]
        bg = (c1 * (1 - t) + c2 * t) * np.ones((H, W, 3))
    elif kind == "noise":
        small = rng.integers(0, 256, (H // 40 + 2, W // 40 + 2, 3)).astype(np.float32)
        bg = cv2.resize(small, (W, H), interpolation=cv2.INTER_CUBIC)
    elif kind == "wood":
        base = rng.integers(60, 200, 3).astype(np.float32)
        x = np.linspace(0, rng.uniform(20, 60), W)[None, :] + rng.normal(0, 1, (H, 1)).cumsum(0) * 0.05
        stripes = (np.sin(x) * 0.5 + 0.5)[..., None]
        bg = base * (0.7 + 0.3 * stripes) * np.ones((H, W, 3))
    else:  # d'autres cartes posées autour
        bg = np.ones((H, W, 3), np.float32) * rng.integers(20, 120, 3)
        for _ in range(rng.integers(2, 6)):
            o = pool[rng.integers(len(pool))]
            h = int(H * rng.uniform(0.4, 0.8))
            w = int(h * CARD_RATIO)
            o = cv2.resize(o, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32)
            M = cv2.getRotationMatrix2D((w / 2, h / 2), rng.uniform(-40, 40), 1.0)
            cx, cy = rng.uniform(0, W), rng.uniform(0, H)
            M[0, 2] += cx - w / 2
            M[1, 2] += cy - h / 2
            mask = cv2.warpAffine(np.ones((h, w), np.float32), M, (W, H))[..., None]
            ow = cv2.warpAffine(o, M, (W, H))
            bg = bg * (1 - mask) + ow * mask
    return bg.astype(np.float32)


def project(H, card_h_px, cx, cy, rx, ry, rz):
    """Coins (hg, hd, bd, bg) d'une carte tournée en 3D vue par une caméra sténopé (f = 0,9 H)."""
    f = 0.9 * H
    cw = CARD_RATIO
    P = np.array([[-cw / 2, -0.5, 0], [cw / 2, -0.5, 0], [cw / 2, 0.5, 0], [-cw / 2, 0.5, 0]])
    a, b, c = map(math.radians, (rx, ry, rz))
    Rx = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    Ry = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    Rz = np.array([[math.cos(c), -math.sin(c), 0], [math.sin(c), math.cos(c), 0], [0, 0, 1]])
    Q = P @ (Rz @ Ry @ Rx).T
    Q[:, 2] += f / card_h_px
    u = f * Q[:, 0] / Q[:, 2] + cx
    v = f * Q[:, 1] / Q[:, 2] + cy
    return np.stack([u, v], 1).astype(np.float32)


def render_card(frame, card_rgb, corners):
    """Colle la carte (coins arrondis) dans l'image ; renvoie image float32 et masque."""
    H, W = frame.shape[:2]
    ch_, cw_ = card_rgb.shape[:2]
    src = np.float32([[-0.5, -0.5], [cw_ - 0.5, -0.5], [cw_ - 0.5, ch_ - 0.5], [-0.5, ch_ - 0.5]])
    Hm = cv2.getPerspectiveTransform(src, np.float32(corners) - 0.5)
    card = cv2.warpPerspective(card_rgb.astype(np.float32), Hm, (W, H), flags=cv2.INTER_LINEAR)
    m = np.zeros((ch_, cw_), np.uint8)
    r = int(0.045 * cw_)
    cv2.rectangle(m, (r, 0), (cw_ - r, ch_), 255, -1)
    cv2.rectangle(m, (0, r), (cw_, ch_ - r), 255, -1)
    for (x, y) in [(r, r), (cw_ - r, r), (r, ch_ - r), (cw_ - r, ch_ - r)]:
        cv2.circle(m, (x, y), r, 255, -1)
    mask = cv2.warpPerspective(m.astype(np.float32) / 255, Hm, (W, H), flags=cv2.INTER_LINEAR)[..., None]
    return frame * (1 - mask) + card * mask, mask


def add_glare(img, mask, corners, gw, rng, n=None, strength=None):
    H, W = img.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    for _ in range(n or rng.integers(1, 3)):
        u, v = rng.uniform(0.1, 0.9), rng.uniform(0.1, 0.9)
        p = corners[0] * (1 - u) * (1 - v) + corners[1] * u * (1 - v) + corners[2] * u * v + corners[3] * (1 - u) * v
        rad = rng.uniform(0.06, 0.28) * gw
        sx, sy = rad, rad * rng.uniform(0.3, 1.0)
        th = rng.uniform(0, math.pi)
        dx, dy = xx - p[0], yy - p[1]
        X = dx * math.cos(th) + dy * math.sin(th)
        Y = -dx * math.sin(th) + dy * math.cos(th)
        g = np.exp(-0.5 * ((X / sx) ** 2 + (Y / sy) ** 2))[..., None]
        img = img + g * mask * 255 * (strength if strength is not None else rng.uniform(0.35, 1.0))
    return img


def finish(img, H, rng, blur=(0.3, 2.2), noise=(1.5, 7.0), jpeg=(50, 92), light=(0.6, 1.25)):
    """Éclairage, optique, capteur et compression JPEG."""
    Hh, W = img.shape[:2]
    gain = rng.uniform(*light)
    cast = rng.uniform(0.86, 1.14, 3)
    yy, xx = np.mgrid[0:Hh, 0:W].astype(np.float32)
    grad = 1 + (xx / W - 0.5) * rng.uniform(-0.4, 0.4) + (yy / Hh - 0.5) * rng.uniform(-0.4, 0.4)
    img = img * gain * cast * grad[..., None]
    con = rng.uniform(0.75, 1.15)
    img = np.clip((img - 128) * con + 128, 0, 255)
    sig = rng.uniform(*blur) * H / 1440
    if sig > 0.3:
        img = cv2.GaussianBlur(img, (0, 0), sig)
    if rng.random() < 0.25:
        L = int(rng.integers(3, 10) * H / 1440) | 1
        k = np.zeros((L, L), np.float32)
        k[L // 2, :] = 1 / L
        M = cv2.getRotationMatrix2D((L / 2 - 0.5, L / 2 - 0.5), rng.uniform(0, 180), 1)
        k = cv2.warpAffine(k, M, (L, L))
        k /= k.sum()
        img = cv2.filter2D(img, -1, k)
    img = img + rng.normal(0, rng.uniform(*noise), img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    q = int(rng.integers(*jpeg))
    _, enc = cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.cvtColor(cv2.imdecode(enc, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB), q, sig


def make_photo(card_rgb, rng, pool, *, tilt=12.0, roll=5.0, scale=(0.9, 1.06), offset=0.06, glare_p=0.6,
               holo_p=0.3, res=None, **kw):
    """Image (H×0,75H), coins vrais, guide (x, y, w, h) à 72 % de la hauteur, métadonnées."""
    H = int(res or rng.choice([960, 1280, 1440, 1920]))
    W = int(H * 0.75)
    gh = 0.72 * H
    gw = gh * CARD_RATIO
    gcx, gcy = W / 2, 0.47 * H
    guide = (gcx - gw / 2, gcy - gh / 2, gw, gh)
    s = rng.uniform(*scale)
    cx = gcx + rng.uniform(-offset, offset) * gw
    cy = gcy + rng.uniform(-offset, offset) * gh
    rx, ry = rng.uniform(-tilt, tilt), rng.uniform(-tilt, tilt)
    rz = rng.uniform(-roll, roll)
    corners = project(H, gh * s, cx, cy, rx, ry, rz)
    img, mask = render_card(_background(rng, W, H, pool), card_rgb, corners)
    if rng.random() < holo_p:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        ang = rng.uniform(0, math.pi)
        t = (xx * math.cos(ang) + yy * math.sin(ang)) / (W * rng.uniform(0.05, 0.25))
        rain = np.stack([np.sin(t), np.sin(t + 2.1), np.sin(t + 4.2)], -1) * 0.5 + 0.5
        a = rng.uniform(0.08, 0.25)
        img = img * (1 - a * mask) + rain * 255 * a * mask
    if rng.random() < glare_p:
        img = add_glare(img, mask, corners, gw, rng)
    img, q, sig = finish(img, H, rng, **kw)
    meta = dict(H=H, W=W, s=round(float(s), 4), rx=round(rx, 2), ry=round(ry, 2), rz=round(rz, 2), q=q, sig=round(float(sig), 3))
    return img, corners, guide, meta
