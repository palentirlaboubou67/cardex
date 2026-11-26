"""Prépare un déploiement de Cardex (bibliothèque standard uniquement).

- sw.js : VERSION = hash du contenu des fichiers de l'appli (fins de ligne normalisées en LF, donc identique
  sous Windows et sous Linux), SHELL = index.html, manifest, icône et tous les fichiers de css/, js/, fonts/,
  VENDOR = hash de vendor/ (cache séparé, gardé d'une version à l'autre tant que vendor/ ne change pas).
- data/manifest.json : {"v": "<date ISO>", "files": {"data/…": "<8 hex>"}} pour chaque data/**/*.json et *.bin.

    python tools/release.py                  écrit sw.js et data/manifest.json
    python tools/release.py --check          vérifie seulement que sw.js est à jour (code de sortie 1 sinon)
    python tools/release.py --manifest-only  écrit seulement data/manifest.json (développement, tests : sans
                                             manifest, l'appli demande aussi les fichiers absents, d'où des 404)
    python tools/release.py --root D         travaille sur un autre dossier (tests)
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys

TOPS = ('css', 'js', 'fonts')
FIXED = ['index.html', 'manifest.webmanifest', 'icon.svg']
TEXT = ('.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt', '.md')


def lf(path, data):
    """Contenu à hacher : fins de ligne LF pour les fichiers texte (CRLF d'un poste Windows = même hash)."""
    return data.replace(b'\r\n', b'\n') if path.lower().endswith(TEXT) else data


def walk(root, top):
    base = os.path.join(root, top)
    out = []
    for d, dirs, files in os.walk(base):
        dirs[:] = sorted(x for x in dirs if not x.startswith('.') and x != '__pycache__')
        for f in files:
            if f.startswith('.') or f.endswith(('.pyc', '.map')):
                continue
            out.append(os.path.relpath(os.path.join(d, f), root).replace(os.sep, '/'))
    return sorted(out)


def shell_files(root):
    files = [f for f in FIXED if os.path.isfile(os.path.join(root, f))]
    for t in TOPS:
        files += walk(root, t)
    return files


def digest(root, files, extra=b''):
    h = hashlib.sha256()
    for f in files:
        with open(os.path.join(root, f), 'rb') as fh:
            data = lf(f, fh.read())
        h.update(f.encode('utf8') + b'\0' + str(len(data)).encode() + b'\0' + data)
    h.update(extra)
    return h.hexdigest()


STAMPS = (
    (re.compile(r"^const VERSION = '[^']*';", re.M), 'VERSION'),
    (re.compile(r"^const SHELL = \[[^\]]*\];", re.M), 'SHELL'),
    (re.compile(r"^const VENDOR = '[^']*';", re.M), 'VENDOR'),
)


def stamp_sw(root):
    sw_path = os.path.join(root, 'sw.js')
    with open(sw_path, 'rb') as fh:
        raw = fh.read()
    crlf = b'\r\n' in raw
    sw = raw.decode('utf8').replace('\r\n', '\n')
    for rx, name in STAMPS:
        if not rx.search(sw):
            sys.exit(f'sw.js : constante {name} introuvable')
    # le code du service worker compte aussi (sans ses constantes tamponnées)
    body = sw
    for rx, name in STAMPS:
        body = rx.sub(f'const {name} = 0;', body)
    files = shell_files(root)
    version = digest(root, files, body.encode('utf8'))[:10]
    vendor_files = walk(root, 'vendor') if os.path.isdir(os.path.join(root, 'vendor')) else []
    vendor = digest(root, vendor_files)[:10] if vendor_files else 'none'
    shell = ['./'] + files
    new = STAMPS[0][0].sub(f"const VERSION = '{version}';", sw)
    new = STAMPS[1][0].sub('const SHELL = [\n' + ''.join(f'  {json.dumps(f)},\n' for f in shell) + '];', new)
    new = STAMPS[2][0].sub(f"const VENDOR = '{vendor}';", new)
    return sw_path, sw, new, crlf, version, len(shell), vendor


def data_manifest(root):
    files = {}
    base = os.path.join(root, 'data')
    for f in walk(root, 'data') if os.path.isdir(base) else []:
        if f == 'data/manifest.json' or not f.lower().endswith(('.json', '.bin')):
            continue
        with open(os.path.join(root, f), 'rb') as fh:
            files[f] = hashlib.sha256(lf(f, fh.read())).hexdigest()[:8]
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {'v': now, 'files': dict(sorted(files.items()))}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true', help='vérifie que sw.js est à jour, sans rien écrire')
    ap.add_argument('--root', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument('--no-manifest', action='store_true', help="n'écrit pas data/manifest.json")
    ap.add_argument('--manifest-only', action='store_true', help='écrit seulement data/manifest.json')
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root)
    if a.manifest_only:
        write_manifest(root)
        return 0
    sw_path, sw, new, crlf, version, n, vendor = stamp_sw(root)
    if a.check:
        if new != sw:
            print('sw.js n’est pas à jour : lance python tools/release.py', file=sys.stderr)
            return 1
        print(f'sw.js à jour (VERSION {version}, {n} fichiers)')
        return 0
    if new != sw:
        out = new.replace('\n', '\r\n') if crlf else new
        with open(sw_path, 'wb') as fh:
            fh.write(out.encode('utf8'))
    print(f'sw.js : VERSION {version}, SHELL {n} fichiers, VENDOR {vendor}')
    if not a.no_manifest:
        write_manifest(root)
    return 0


def write_manifest(root):
    m = data_manifest(root)
    path = os.path.join(root, 'data', 'manifest.json')
    old = None
    if os.path.isfile(path):
        try:
            with open(path, encoding='utf8') as fh:
                old = json.load(fh)
        except ValueError:
            old = None
    # même contenu : on garde l'ancien fichier (et sa date), le service worker n'a rien à purger
    if old and old.get('files') == m['files']:
        print(f'data/manifest.json inchangé : {len(m["files"])} fichiers')
        return
    with open(path, 'w', encoding='utf8', newline='\n') as fh:
        json.dump(m, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'data/manifest.json : {len(m["files"])} fichiers')


if __name__ == '__main__':
    sys.exit(main())
