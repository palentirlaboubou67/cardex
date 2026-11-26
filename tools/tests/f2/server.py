"""Petit serveur HTTP de test (F2) : sert un dossier, avec des surcouches et des pages virtuelles.

    srv = serve(root, port=8772, overlays={'data/': fixture_dir}, pages={'__f2.html': html})
    ...
    srv.close()

- overlays : un chemin qui commence par la clé est d'abord cherché dans le dossier associé.
- exclusive : préfixes dont les fichiers viennent seulement des surcouches (absent de la surcouche = 404, jamais le
  vrai fichier du dépôt) : ex. ('data/market/prices/',) pour des tests qui ne doivent voir que les cotes des fixtures.
- pages : chemins virtuels (pages de test à la racine, pour que 'data/…' se résolve comme dans l'appli) ;
  valeur = texte HTML, ou (contenu, type MIME).
- srv.delay[path_prefix] = secondes, srv.fail[path_prefix] = code HTTP : pour simuler un réseau lent ou en panne.
- srv.log : liste des chemins demandés (avec la requête).
"""
import http.server
import os
import threading
import time
import urllib.parse

TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
    '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
}


class Server:
    def __init__(self, root, port, overlays=None, pages=None, exclusive=()):
        self.root = os.path.abspath(root)
        self.exclusive = tuple(exclusive)
        self.overlays = {k: os.path.abspath(v) for k, v in (overlays or {}).items()}
        self.pages = dict(pages or {})
        self.delay, self.fail, self.log = {}, {}, []
        self.lock = threading.Lock()
        srv = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *a):
                pass

            def do_GET(self):
                srv._handle(self, head=False)

            def do_HEAD(self):
                srv._handle(self, head=True)

        http.server.ThreadingHTTPServer.request_queue_size = 128   # file d'attente : 5 par défaut, Windows refuse les rafales
        self.httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), H)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{port}/'

    def _resolve(self, path):
        for k, d in self.overlays.items():
            if path.startswith(k):
                p = os.path.join(d, path[len(k):])
                if os.path.isfile(p):
                    return p
        if any(path.startswith(x) for x in self.exclusive):
            return None
        p = os.path.normpath(os.path.join(self.root, path))
        if not p.startswith(self.root):
            return None
        if os.path.isdir(p):
            p = os.path.join(p, 'index.html')
        return p if os.path.isfile(p) else None

    def _handle(self, h, head):
        u = urllib.parse.urlsplit(h.path)
        path = urllib.parse.unquote(u.path).lstrip('/')
        with self.lock:
            self.log.append(h.path)
        for k, s in list(self.delay.items()):
            if path.startswith(k):
                time.sleep(s)
        for k, code in list(self.fail.items()):
            if path.startswith(k):
                return self._send(h, code, b'{"error":"test"}', 'application/json', head)
        if path in self.pages:
            body, ctype = self.pages[path], 'text/html; charset=utf-8'
            if isinstance(body, tuple):          # (contenu, type) : ex. un sw.js modifié pour le test
                body, ctype = body
            body = body.encode('utf8') if isinstance(body, str) else body
            return self._send(h, 200, body, ctype, head)
        p = self._resolve(path or 'index.html')
        if not p:
            return self._send(h, 404, b'not found', 'text/plain', head)
        with open(p, 'rb') as fh:
            body = fh.read()
        ext = os.path.splitext(p)[1].lower()
        self._send(h, 200, body, TYPES.get(ext, 'application/octet-stream'), head)

    def _send(self, h, code, body, ctype, head, headers=None):
        # le navigateur peut abandonner une requête (page fermée) : ce n'est pas une erreur du test
        try:
            h.send_response(code)
            h.send_header('Content-Type', ctype)
            h.send_header('Content-Length', str(len(body)))
            h.send_header('Cache-Control', 'no-cache')
            for k, v in (headers or {}).items():
                h.send_header(k, v)
            h.end_headers()
            if not head:
                h.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            h.close_connection = True

    def requests(self, prefix=''):
        with self.lock:
            return [p for p in self.log if p.lstrip('/').startswith(prefix)]

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def serve(root, port=8772, overlays=None, pages=None, exclusive=()):
    return Server(root, port, overlays, pages, exclusive)


# page de test minimale : importe un module et expose ses exports dans window.M
HARNESS = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>F2 test</title></head>
<body><main id="out"></main>
<script>
window.errors = [];
addEventListener('error', e => window.errors.push(String(e.message || e)));
addEventListener('unhandledrejection', e => window.errors.push('rejet : ' + String(e.reason && (e.reason.stack || e.reason))));
window.load = async (...paths) => { const out = []; for (const p of paths) out.push(await import(p)); return out; };
</script>
<script src="js/state/wishes.js"></script>
</body></html>"""
