"""Outils communs des tests F2 (Playwright, python -P) : serveur, navigateur, assertions, rapport."""
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
FIX = os.path.join(HERE, 'fixtures', 'data')
# port du serveur de test : --port N ou CARDEX_TEST_PORT (chaque agent a le sien), sinon 8772
PORT = int(os.environ.get('CARDEX_TEST_PORT') or 8772)
if '--port' in sys.argv:
    PORT = int(sys.argv[sys.argv.index('--port') + 1])
sys.path.insert(0, HERE)
from server import serve, HARNESS  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


class Fail(AssertionError):
    pass


def check(cond, msg, *detail):
    if not cond:
        raise Fail(msg + (' — ' + ' | '.join(json.dumps(d, ensure_ascii=False, default=str)[:600] for d in detail) if detail else ''))


def eq(a, b, msg):
    check(a == b, f'{msg} : attendu {b!r}, obtenu {a!r}')


class Skip(Exception):
    """Test sauté (ex. --offline) : compté à part, jamais comme réussi."""


class Runner:
    def __init__(self, title):
        self.title, self.results, self.t0 = title, [], time.time()

    def _record(self, name, t, out=None, exc=None, limit=3):
        dt = time.time() - t
        if exc is None:
            self.results.append((name, True, '', dt))
            return f'PASS  {name}' + (f'  ({out})' if out else '')
        if isinstance(exc, Skip):
            self.results.append((name, None, str(exc), dt))
            return f'SKIP  {name}  ({exc})'
        msg = str(exc) if isinstance(exc, Fail) else traceback.format_exc(limit=limit)
        self.results.append((name, False, msg, dt))
        return f'FAIL  {name}\n      {msg}'

    def run(self, name, fn, *a):
        t = time.time()
        try:
            line = self._record(name, t, fn(*a))
        except Exception as e:
            line = self._record(name, t, exc=e)
        print(line, flush=True)

    async def arun(self, name, fn, *a):
        """Même chose pour une fonction asynchrone (API asynchrone de Playwright)."""
        t = time.time()
        try:
            line = self._record(name, t, await fn(*a))
        except Exception as e:
            line = self._record(name, t, exc=e, limit=4)
        print(line, flush=True)

    def done(self):
        ok = sum(1 for r in self.results if r[1] is True)
        skipped = sum(1 for r in self.results if r[1] is None)
        ran = len(self.results) - skipped
        extra = f' ({skipped} sautés)' if skipped else ''
        print(f'\n{self.title} : {ok}/{ran} réussis{extra} en {time.time() - self.t0:.1f} s')
        return 0 if ok == ran else 1


def console_watch(page, bucket, ignore=()):
    """Erreurs de console et de page ; ignore = morceaux de texte ou d'URL attendus (ex. le 404 voulu du manifest)."""
    def on_console(m):
        if m.type != 'error':
            return
        where = (m.location or {}).get('url', '')
        if any(s in m.text or s in where for s in ignore):
            return
        bucket.append(f'console: {m.text} @ {where}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: bucket.append(f'pageerror: {e}'))


def expected_404s():
    """404 attendus pendant les tests : le manifest (absent en développement) et dom.js tant que F1 ne l'a pas écrit."""
    out = ['data/manifest.json']
    if not os.path.isfile(os.path.join(ROOT, 'js', 'core', 'dom.js')):
        out.append('js/core/dom.js')
    return out
