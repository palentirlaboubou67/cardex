"""Lecture des fichiers .ts du dépôt TCGdex cards-database comme du texte (jamais exécutés).

Les fichiers contiennent un littéral d'objet (`const card: Card = { … }`) : on le transforme en dict Python.
Identifiants (`Set`, `serie`…) -> {"$ref": nom} ; propagations `...x` ignorées.
"""
import re

_TOK = re.compile(r"""
    (?P<ws>\s+|//[^\n]*|/\*.*?\*/)
  | (?P<str>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)
  | (?P<num>-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)
  | (?P<id>[A-Za-z_$][\w$]*)
  | (?P<spread>\.\.\.)
  | (?P<p>[{}\[\]:,.()<>|?;=&!+*/-])
  | (?P<other>.)
""", re.S | re.X)

_ESC = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def _unquote(s):
    body, out, i = s[1:-1], [], 0
    while i < len(body):
        c = body[i]
        if c != "\\":
            out.append(c)
            i += 1
            continue
        n = body[i + 1] if i + 1 < len(body) else ""
        if n == "u" and re.match(r"[0-9a-fA-F]{4}", body[i + 2:i + 6]):
            out.append(chr(int(body[i + 2:i + 6], 16)))
            i += 6
        elif n == "x" and re.match(r"[0-9a-fA-F]{2}", body[i + 2:i + 4]):
            out.append(chr(int(body[i + 2:i + 4], 16)))
            i += 4
        elif n == "\n":
            i += 2
        else:
            out.append(_ESC.get(n, n))
            i += 2
    return "".join(out)


def _tokens(text):
    for m in _TOK.finditer(text):
        k = m.lastgroup
        if k != "ws":
            yield k, m.group(k)


class _P:
    def __init__(self, toks):
        self.t, self.i = toks, 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def take(self):
        tok = self.peek()
        self.i += 1
        return tok

    def skip_expr(self):
        """Saute la fin d'une expression non gérée (ex. `as const`, `serie.id`) jusqu'au séparateur."""
        depth = 0
        while self.i < len(self.t):
            k, v = self.peek()
            if k == "p" and v in "{[(":
                depth += 1
            elif k == "p" and v in "}])":
                if depth == 0:
                    return
                depth -= 1
            elif k == "p" and v == "," and depth == 0:
                return
            self.i += 1

    def value(self):
        k, v = self.take()
        if k == "p" and v == "{":
            return self.obj()
        if k == "p" and v == "[":
            return self.arr()
        if k == "str":
            out = _unquote(v)
            self.skip_expr()
            return out
        if k == "num":
            self.skip_expr()
            return float(v) if any(c in v for c in ".eE") else int(v)
        if k == "p" and v == "-":
            nk, nv = self.take()
            if nk == "num":
                return -(float(nv) if "." in nv else int(nv))
            return None
        if k == "id":
            self.skip_expr()
            return {"true": True, "false": False, "null": None, "undefined": None}.get(v, {"$ref": v})
        self.skip_expr()
        return None

    def obj(self):
        out = {}
        while True:
            k, v = self.peek()
            if k is None:
                return out
            if k == "p" and v == "}":
                self.i += 1
                return out
            if k == "p" and v == ",":
                self.i += 1
                continue
            if k == "spread":
                self.i += 1
                self.value()
                continue
            self.i += 1
            key = _unquote(v) if k == "str" else v
            k2, v2 = self.peek()
            if k2 == "p" and v2 == ":":
                self.i += 1
                out[key] = self.value()
            else:  # propriété abrégée `{ set }`
                out[key] = {"$ref": key}

    def arr(self):
        out = []
        while True:
            k, v = self.peek()
            if k is None:
                return out
            if k == "p" and v == "]":
                self.i += 1
                return out
            if k == "p" and v == ",":
                self.i += 1
                continue
            if k == "spread":
                self.i += 1
                self.value()
                continue
            out.append(self.value())


def parse_object(text):
    """Premier littéral d'objet affecté (`= {`) du fichier -> dict, ou None."""
    m = re.search(r"=\s*\{", text)
    if not m:
        return None
    p = _P(list(_tokens(text[m.end() - 1:])))
    p.take()
    return p.obj()
