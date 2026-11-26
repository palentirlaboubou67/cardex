"""Petits outils partagés : JSON compact et stable, écriture atomique, dates, normalisation des noms."""
import json
import os
import re
import unicodedata
from datetime import datetime


def read_json(path, default=None):
    try:
        with open(path, encoding="utf8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def dumps(obj, sort=True):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=sort)


def write_text(path, text):
    """Écriture atomique (fichier temporaire puis remplacement), fin de ligne LF, UTF-8."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def write_json(path, obj, sort=True):
    write_text(path, dumps(obj, sort) + "\n")


def num(v):
    """Prix exploitable (> 0) ou None."""
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def cents(v):
    v = num(v)
    return int(round(v * 100)) if v is not None else None


def created_day(created_at):
    """'2026-11-25T02:42:31+0100' -> '2026-11-25' (date locale du fichier, jamais la date de capture)."""
    return datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%S%z").date().isoformat()


def created_dt(created_at):
    return datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%S%z")


def ascii_fold(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def straight(s):
    """Apostrophes et tirets typographiques -> ASCII (avant toute comparaison)."""
    return (s.replace("’", "'").replace("‘", "'").replace("ʼ", "'").replace("`", "'")
            .replace("–", "-").replace("—", "-").replace("‑", "-").replace(" ", " "))


def norm_words(s):
    """Clé de comparaison souple : minuscules ASCII, mots séparés par une espace."""
    s = ascii_fold(straight(s)).lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())
