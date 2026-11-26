"""Historique des prix du scellé : data/market/hist/<shard>.json = {"d":[dates],"p":{"<idProduct>":[centimes|null,…]}}.

- un point par jour de guide (date = createdAt du fichier), jamais deux fois le même jour ;
- compactage : quotidien sur 120 jours, puis le premier point de chaque semaine ISO jusqu'à 2 ans, puis de chaque mois ;
  la valeur gardée pour une semaine (un mois) est la première connue du produit dans la période, donc rien ne se perd ;
- l'historique ne rétrécit jamais : un produit sorti du catalogue garde sa colonne, un fichier existant n'est jamais vidé ;
- répartition par extension Cardmarket, les grosses extensions « fourre-tout » découpées par type puis par paquets ;
  un produit garde son fichier pour toujours (pas de déplacement d'un jour à l'autre).
"""
import os
import re
from collections import defaultdict
from datetime import date, timedelta

from .util import read_json, write_json

CAP = 120          # produits par fichier au plus
DAILY, WEEKLY = 120, 730
SHARD_RX = re.compile(r"^[0-9a-z-]+$")


class History:
    def __init__(self, folder):
        self.folder = folder
        self.series = defaultdict(dict)   # id (str) -> {date: centimes}
        self.shard = {}                   # id -> nom du fichier
        self.loaded_files = set()
        if os.path.isdir(folder):
            for fn in sorted(os.listdir(folder)):
                if not fn.endswith(".json") or not SHARD_RX.match(fn[:-5]):
                    continue
                h = read_json(os.path.join(folder, fn))
                if not isinstance(h, dict) or not isinstance(h.get("d"), list) or not isinstance(h.get("p"), dict):
                    raise ValueError(f"historique illisible : {fn}")  # on ne réécrit rien plutôt que de perdre des données
                name = fn[:-5]
                self.loaded_files.add(name)
                for pid, col in h["p"].items():
                    if not isinstance(col, list) or len(col) != len(h["d"]):
                        raise ValueError(f"historique incohérent : {fn} / {pid}")
                    self.shard.setdefault(pid, name)
                    s = self.series[pid]
                    for d, v in zip(h["d"], col):
                        if isinstance(v, int) and v > 0:
                            s[d] = v

    # ---------- lecture ----------
    def days(self):
        return sorted({d for s in self.series.values() for d in s})

    def points(self, pid):
        s = self.series.get(str(pid)) or {}
        return sorted(s.items())

    # ---------- écriture ----------
    def add(self, day, prices):
        """prices = {id: centimes} ; écrase la valeur du même jour (relecture du même fichier)."""
        n = 0
        for pid, v in prices.items():
            if isinstance(v, int) and v > 0:
                self.series[str(pid)][day] = v
                n += 1
        return n

    def assign(self, groups):
        """groups = {id (str): (extension, type)} pour les produits du catalogue ; donne un fichier aux nouveaux.
        Extension de plus de CAP produits : un fichier par type (« 1645-tin »), puis des paquets (« 1645-tin-2 »)."""
        count = defaultdict(int)
        for sh in self.shard.values():
            count[sh] += 1
        per_exp = defaultdict(int)
        for e, k in groups.values():
            per_exp[e] += 1
        for pid in sorted(groups, key=lambda x: (len(x), x)):
            if pid in self.shard or not self.series.get(pid):
                continue  # déjà rangé, ou pas encore de prix (pas de colonne vide)
            e, k = groups[pid]
            base = f"{e}-{k}" if per_exp[e] > CAP else f"{e}"
            n, name = 1, base
            while count[name] >= CAP:
                n += 1
                name = f"{base}-{n}"
            self.shard[pid] = name
            count[name] += 1

    def compact(self, today):
        """Applique la règle 120 j / 2 ans / mensuel fichier par fichier (dates communes dans un fichier)."""
        by = defaultdict(list)
        for pid, sh in self.shard.items():
            by[sh].append(pid)
        for sh, pids in by.items():
            days = sorted({d for pid in pids for d in self.series[pid]})
            bucket_of, rep = {}, {}
            for d in days:
                b = _bucket(date.fromisoformat(d), today)
                bucket_of[d] = b
                if b is None:
                    continue
                if b not in rep or d < rep[b]:
                    rep[b] = d
            for pid in pids:
                s = self.series[pid]
                out = {}
                for d in sorted(s):
                    b = bucket_of[d]
                    key = d if b is None else rep[b]
                    if key not in out:  # première valeur connue de la période
                        out[key] = s[d]
                self.series[pid] = out

    def files(self):
        """-> {nom: {"d": [...], "p": {...}}} (seulement les produits rangés)."""
        by = defaultdict(list)
        for pid, sh in self.shard.items():
            if self.series.get(pid):
                by[sh].append(pid)
        out = {}
        for sh, pids in by.items():
            days = sorted({d for pid in pids for d in self.series[pid]})
            idx = {d: i for i, d in enumerate(days)}
            p = {}
            for pid in sorted(pids, key=lambda x: int(x) if x.isdigit() else x):
                col = [None] * len(days)
                for d, v in self.series[pid].items():
                    col[idx[d]] = v
                p[pid] = col
            out[sh] = {"d": days, "p": p}
        return out

    def prepare(self):
        """-> {nom: contenu} des fichiers à écrire ; lève ValueError si un fichier perdait un produit ou disparaissait
        (l'historique ne rétrécit jamais)."""
        files = self.files()
        for name in sorted(self.loaded_files - set(files)):
            raise ValueError(f"historique : le fichier {name} disparaîtrait")
        out = {}
        for name, h in sorted(files.items()):
            path = os.path.join(self.folder, name + ".json")
            old = read_json(path)
            if old is not None and set(old.get("p", {})) - set(h["p"]):
                raise ValueError(f"historique : {name} perdrait des produits")
            if old != h:
                out[name] = h
        return out, len(files)

    def commit(self, changed):
        os.makedirs(self.folder, exist_ok=True)
        for name, h in changed.items():
            write_json(os.path.join(self.folder, name + ".json"), h, sort=False)


def _bucket(d, today):
    age = (today - d).days
    if age <= DAILY:
        return None
    if age <= WEEKLY:
        y, w, _ = d.isocalendar()
        return ("w", y, w)
    return ("m", d.year, d.month)


# ---------- variations et repères, d'après l'historique ----------
def value_at(points, target, slack):
    """Valeur du point le plus proche de `target` à ±slack jours (le plus ancien à égalité), ou None."""
    best, bd = None, None
    for d, v in points:
        dd = abs((date.fromisoformat(d) - target).days)
        if dd <= slack and (bd is None or dd < bd):
            best, bd = v, dd
    return best


SPANS = (("c7", 7, 2), ("c30", 30, 4), ("c90", 90, 10), ("c365", 365, 30))


def summary(points, today):
    """points = [(date, centimes)] triés, dernier = aujourd'hui.
    -> {c7, c30, c90, c365 (en %), first (€), since (date), max (€), chg (date depuis laquelle le prix ne bouge pas)}."""
    out = {k: None for k, _, _ in SPANS}
    out.update(first=None, since=None, max=None, chg=None)
    if not points:
        return out
    now = points[-1][1]
    past = points[:-1]
    for key, days, slack in SPANS:
        old = value_at(past, today - timedelta(days=days), slack)
        if old:
            out[key] = round((now - old) / old * 100, 1)
    out["first"] = round(points[0][1] / 100, 2)
    out["since"] = points[0][0]
    out["max"] = round(max(v for _, v in points) / 100, 2)
    chg = points[-1][0]
    for d, v in reversed(points[:-1]):
        if v != now:
            break
        chg = d
    out["chg"] = chg
    return out
