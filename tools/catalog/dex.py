"""Numéros de Pokédex devinés d'après le nom français d'une carte (portage de guessDex de legacy/js/app.js).

Les noms les plus longs d'abord (« Mewtwo » avant « Mew »), sur des mots entiers, et chaque nom trouvé est
retiré du texte : une carte duo (« Méga-Ténéfix et Tyranocif ») donne plusieurs numéros, sans faux positif
sur une partie de mot. Normalisation identique à words() de js/data/dex.js (œ → oe, « Nidoran ♀ »).
"""
import re
import unicodedata


def norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn').lower()
    return s.replace('œ', 'oe').replace('æ', 'ae')


def words(s):
    s = re.sub(r'\s+(?=[♀♂])', '', norm(s))
    return ' ' + re.sub(r'[^a-z0-9♀♂]+', ' ', s).strip() + ' '


class Dex:
    def __init__(self, names):
        self.names = names  # index i -> Pokémon n° i + 1
        self.index = sorted(((words(n), i + 1) for i, n in enumerate(names) if words(n).strip()),
                            key=lambda x: -len(x[0]))

    def guess(self, name):
        if not name:
            return []
        s = words(name)
        hits = []
        for w, n in self.index:
            i = s.find(w)
            if i >= 0:
                if all(n != h[1] for h in hits):
                    hits.append((i, n))
                s = s[:i] + ' ' * len(w) + s[i + len(w):]  # même longueur : les positions restent valables
        return [n for _, n in sorted(hits)]  # ordre du nom (« Ténéfix et Tyranocif » -> [302, 248])
