"""Clip de test pour la fausse caméra de Chromium (FINAL-scanner §8.5) : une carte entre dans le guide en glissant,
s'arrête 1,5 s (un reflet la traverse pendant l'arrêt), puis ressort. Format YUV4MPEG2 1080×1920 30 i/s 4:2:0.
L'index de chaque image est écrit en haut à gauche (16 cases noir / blanc, valeur XOR 0xA5A5) : la page de test
le relit pour situer chaque événement dans le clip.

Le guide de tools/scanbench/live.html (viewport 390×844, object-fit: cover) correspond dans le flux à un rectangle
centré en (540, 960) de 1 130 px de haut (= 78 % du viseur de 523 px, échelle 0,361)."""
import math

import cv2
import numpy as np

from synth import CARD_RATIO, load_rgb, render_card

W, H, FPS = 1080, 1920, 30
GUIDE_C = (540.0, 960.0)
GUIDE_H = 1130.0
# chronologie (secondes)
T_EMPTY, T_IN, T_STOP, T_OUT, T_END = 0.5, 1.0, 1.5, 1.0, 0.5


def timeline():
    t1 = T_EMPTY
    t2 = t1 + T_IN
    t3 = t2 + T_STOP
    t4 = t3 + T_OUT
    t5 = t4 + T_END
    return t1, t2, t3, t4, t5


def barcode(img, n):
    v = n ^ 0xA5A5
    for b in range(16):
        bit = (v >> (15 - b)) & 1
        img[0:16, b * 16:(b + 1) * 16] = 255 if bit else 0


def corners_at(cx, cy, scale, angle):
    h = GUIDE_H * scale
    w = h * CARD_RATIO
    pts = np.array([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], np.float32)
    a = math.radians(angle)
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]], np.float32)
    return (pts @ R.T + np.array([cx, cy], np.float32)).astype(np.float32)


def rgb_to_i420(rgb):
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    sub = lambda c: cv2.resize(c, (W // 2, H // 2), interpolation=cv2.INTER_AREA)  # noqa: E731
    out = [np.clip(np.rint(p), 0, 255).astype(np.uint8) for p in (y, sub(cb), sub(cr))]
    return b"".join(p.tobytes() for p in out)


def make_clip(card_path, out_path, seed=3):
    rng = np.random.default_rng(seed)
    card = load_rgb(card_path)
    # fond : bois clair (table)
    xx = np.linspace(0, 40, W)[None, :] + rng.normal(0, 1, (H, 1)).cumsum(0) * 0.04
    bg = (np.array([170, 130, 90], np.float32) * (0.75 + 0.25 * (np.sin(xx) * 0.5 + 0.5))[..., None]) * np.ones((H, W, 3), np.float32)
    yy, xg = np.mgrid[0:H, 0:W].astype(np.float32)
    t1, t2, t3, t4, t5 = timeline()
    n = int(round(t5 * FPS))
    truth = {"fps": FPS, "frames": n, "stop": [int(round(t2 * FPS)), int(round(t3 * FPS))],
             "moving": [[int(round(t1 * FPS)), int(round(t2 * FPS))], [int(round(t3 * FPS)), int(round(t4 * FPS))]]}
    with open(out_path, "wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n".encode("ascii"))
        for k in range(n):
            t = k / FPS
            img = bg.copy()
            pos = None
            if t1 <= t < t2:                               # entrée par la droite, en tournant un peu
                u = (t - t1) / T_IN
                e = 1 - (1 - u) ** 2
                pos = (GUIDE_C[0] + (1 - e) * 900, GUIDE_C[1] + (1 - e) * 120, 0.95, (1 - e) * 12)
            elif t2 <= t < t3:                             # arrêt (léger tremblement < 1 px)
                pos = (GUIDE_C[0] + 0.4 * math.sin(7 * t), GUIDE_C[1] + 0.4 * math.cos(5 * t), 0.95, 0.0)
            elif t3 <= t < t4:                             # sortie par la gauche
                u = (t - t3) / T_OUT
                pos = (GUIDE_C[0] - u * u * 1000, GUIDE_C[1] + u * 60, 0.95, -u * 10)
            if pos:
                q = corners_at(*pos)
                img, mask = render_card(img, card, q)
                if t2 <= t < t3:                           # reflet qui traverse la carte pendant l'arrêt
                    u = (t - t2) / T_STOP
                    gx = q[0][0] + (q[1][0] - q[0][0]) * (-0.2 + 1.4 * u)
                    gy = q[0][1] + (q[3][1] - q[0][1]) * 0.45
                    g = np.exp(-0.5 * (((xg - gx) / 140) ** 2 + ((yy - gy) / 260) ** 2))[..., None]
                    img = img + g * mask * 255 * 0.55
            img = np.clip(img, 0, 255)
            img = cv2.GaussianBlur(img, (0, 0), 0.8)
            img = np.clip(img + rng.normal(0, 2.0, img.shape), 0, 255).astype(np.uint8)
            barcode(img, k)
            f.write(b"FRAME\n")
            f.write(rgb_to_i420(img))
    return truth
