"""Tests du service worker v2 et de tools/release.py (F2) dans Chromium (Playwright, API asynchrone).

    python -P tools/tests/sw_test.py

Sur une copie de l'appli (.cache/f2/swsite) tamponnée par tools/release.py : installation et précache, rechargement
hors ligne, aucune réponse opaque ni en erreur dans Cache Storage, TCGdex réseau d'abord (copie après 4 s seulement
si elle existe), données versionnées (?h=) : toutes les séries hors ligne puis purge, mise à jour (nouvelle VERSION,
toast « Nouvelle version disponible », ancien cache supprimé, caches des autres applis intacts), passage depuis la v1,
plafonds des caches d'images (FIFO). Les hôtes externes (TCGdex, Scrydex, TCGplayer, GitHub, jsDelivr) sont simulés
par Playwright : aucune requête ne sort. Port 8772 (ou --port N).
Aussi : le sw.js du dépôt tel quel (mode développement, SHELL vide) recharge l'appli hors ligne après une première
visite ; logos et symboles des séries enregistrés pour le hors ligne ; clic sur une notification -> les envies.
"""
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'f2'))
from kit import ROOT, PORT, serve, Runner, check, eq  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

SITE = os.path.join(ROOT, '.cache', 'f2', 'swsite')
RELEASE = os.path.join(ROOT, 'tools', 'release.py')
GIF = (b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,'
       b'\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;')
CORS = {'Access-Control-Allow-Origin': '*'}

# ---------- copie du site et tampon ----------


def make_site():
    if os.path.isdir(SITE):
        shutil.rmtree(SITE)
    os.makedirs(SITE)
    skip = shutil.ignore_patterns('__pycache__', '*.pyc', 'manifest.json')
    for f in ['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png', 'sw.js']:
        if os.path.isfile(os.path.join(ROOT, f)):
            shutil.copy2(os.path.join(ROOT, f), SITE)
    for d in ['css', 'js', 'fonts', 'img', 'data', 'vendor']:
        if os.path.isdir(os.path.join(ROOT, d)):
            shutil.copytree(os.path.join(ROOT, d), os.path.join(SITE, d), ignore=skip)


def release(root, *args):
    # release.py doit écrire en UTF-8 de lui-même, quelle que soit la console (PowerShell règle PYTHONIOENCODING,
    # Git Bash et la CI non) : on retire la variable pour tester le cas difficile, et on décode strictement
    env = {k: v for k, v in os.environ.items() if k.upper() != 'PYTHONIOENCODING'}
    r = subprocess.run([sys.executable, '-P', RELEASE, '--root', root, *args], capture_output=True, env=env)
    return r.returncode, (r.stdout + r.stderr).decode('utf8').strip()


def stamped(root):
    with open(os.path.join(root, 'sw.js'), encoding='utf8') as fh:
        sw = fh.read()
    version = re.search(r"^const VERSION = '([^']*)';", sw, re.M).group(1)
    shell = json.loads(re.search(r'^const SHELL = (\[[^\]]*\]);', sw, re.M).group(1).replace(',\n]', '\n]'))
    return sw, version, shell


def manifest(root):
    with open(os.path.join(root, 'data', 'manifest.json'), encoding='utf8') as fh:
        return json.load(fh)


# ---------- hôtes externes simulés ----------
class Ext:
    def __init__(self):
        self.hits, self.blocked = [], []
        self.api_mode, self.api_delay, self.api_name = 'ok', 0.0, 'v1'


def external_handler(ext):
    async def handle(route):
        req = route.request
        u = urlsplit(req.url)
        host = u.hostname or ''
        ext.hits.append((host, req.url))
        if host == 'api.tcgdex.net':
            delay, mode, name = ext.api_delay, ext.api_mode, ext.api_name
            if delay:
                await asyncio.sleep(delay)
            if mode == 'abort':
                return await route.abort('internetdisconnected')
            if mode == 'error':
                return await route.fulfill(status=503, body='{"error":"busy"}', headers={**CORS, 'Content-Type': 'application/json'})
            return await route.fulfill(status=200, body=json.dumps({'id': 'sv03.5-025', 'name': name}),
                                       headers={**CORS, 'Content-Type': 'application/json'})
        if host in ('assets.tcgdex.net', 'images.scrydex.com', 'cdn.jsdelivr.net'):
            if '/missing/' in u.path:
                return await route.fulfill(status=404, body='introuvable', headers=CORS)
            return await route.fulfill(status=200, body=GIF, headers={**CORS, 'Content-Type': 'image/gif'})
        if host == 'raw.githubusercontent.com':
            # simulé ici comme un hôte sans CORS valable pour nous (fulfill ajouterait sinon lui-même un en-tête ACAO)
            return await route.fulfill(status=200, body=GIF, headers={'Content-Type': 'image/gif',
                                                                      'Access-Control-Allow-Origin': 'https://example.org'})
        if host == 'tcgplayer-cdn.tcgplayer.com':                     # comme le vrai : ACAO seulement avec Origin
            h = {'Content-Type': 'image/gif'}
            if req.headers.get('origin'):
                h.update(CORS)
            return await route.fulfill(status=200, body=GIF, headers=h)
        ext.blocked.append(req.url)
        return await route.abort('blockedbyclient')
    return handle


# ---------- petits scripts exécutés dans la page ----------
DUMP = '''async () => { const out = {};
  for (const k of await caches.keys()) { const c = await caches.open(k); const items = [];
    for (const r of await c.keys()) { const res = await c.match(r); items.push({ url: r.url, type: res.type, status: res.status, ok: res.ok }); }
    out[k] = items; }
  return out; }'''
ASK = '''(type) => new Promise((res, rej) => {
  const sw = navigator.serviceWorker; sw.startMessages();
  const t = setTimeout(() => rej(new Error('pas de réponse du service worker : ' + type)), 8000);
  const f = e => { if (e.data && e.data.type === type) { clearTimeout(t); sw.removeEventListener('message', f); res(e.data); } };
  sw.addEventListener('message', f); sw.controller.postMessage({ type }); })'''
FETCH = '''async (url) => { const t = performance.now();
  try { const r = await fetch(url); const j = await r.json(); return { ms: performance.now() - t, status: r.status, name: j.name }; }
  catch (e) { return { ms: performance.now() - t, error: e.name }; } }'''
LOAD_IMG = '''([src, cors]) => new Promise(res => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous';
  i.onload = () => res('ok'); i.onerror = () => res('error'); i.src = src; })'''
CONTROLLED = "() => !!navigator.serviceWorker.controller && navigator.serviceWorker.controller.state === 'activated'"

LEGACY_SW = '''// service worker « v1 » simulé : prend la main tout de suite, laisse tout passer au réseau
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});'''
LEGACY_PAGE = '''<!doctype html><meta charset="utf-8"><title>v1</title><body><script>
(async () => {
  const a = await caches.open('cardex-shell-v8'); await a.put('/old.js', new Response('old'));
  const b = await caches.open('cardex-images-v1'); await b.put('https://assets.tcgdex.net/old/low.webp', new Response('x'));
  const c = await caches.open('someone-else'); await c.put('/y', new Response('y'));
  await navigator.serviceWorker.register('legacy-sw.js');
  await navigator.serviceWorker.ready;
  window.done = true;
})();
</script>'''


def rel(srv, url):
    return url[len(srv.url):].split('?')[0].split('#')[0] if url.startswith(srv.url) else None


async def main():
    os.makedirs(os.path.dirname(SITE), exist_ok=True)
    make_site()
    code, out = release(SITE)
    if code:
        print(out)
        return 1
    sw_text, VERSION, SHELL = stamped(SITE)
    print(f'site : {SITE}\nrelease.py : {out}')
    srv = serve(SITE, PORT)
    R = Runner('sw_test')
    state = {'version': VERSION, 'shell': SHELL}

    async with async_playwright() as p:
        # nouveau mode headless (Chromium complet) : notifications disponibles ; l'ancien « headless shell » les refuse
        try:
            b = await p.chromium.launch(channel='chromium')
        except Exception:
            b = await p.chromium.launch()

        async def new_ctx():
            ctx = await b.new_context(locale='fr-FR', viewport={'width': 390, 'height': 844})
            ext = Ext()
            await ctx.route(lambda url: not url.startswith(srv.url), external_handler(ext))
            return ctx, ext

        ctx, ext = await new_ctx()
        pg = await ctx.new_page()
        console = []
        pg.on('console', lambda m: console.append(f'{m.type}: {m.text} @ {(m.location or {}).get("url", "")}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console.append(f'pageerror: {e}'))

        # ---------- 1. installation ----------
        async def t_install():
            await pg.goto(srv.url)
            await pg.wait_for_function(CONTROLLED, timeout=30000)
            dump = await pg.evaluate(DUMP)
            app = f'cardex-app-{VERSION}'
            check(app in dump, 'cache de l’appli', list(dump))
            urls = {x['url'] for x in dump[app]}
            want = {srv.url + ('' if u == './' else u) for u in SHELL}
            eq(sorted(want - urls), [], 'tous les fichiers de SHELL précachés')
            check(all(x['ok'] and x['type'] == 'basic' for x in dump[app]), 'précache : réponses 200 du site')
            v = await pg.evaluate(ASK, 'version')
            eq(v['version'], VERSION, 'VERSION annoncée par le service worker')
            script = await pg.evaluate('navigator.serviceWorker.controller.scriptURL')
            eq(script, srv.url + 'sw.js', 'script')
            return f'{len(SHELL)} fichiers précachés, VERSION {VERSION}'

        # ---------- 2. rechargement hors ligne ----------
        async def t_offline():
            await pg.goto(srv.url + '#/series')           # une 2e vue, en ligne (données mises en cache)
            await pg.wait_for_timeout(1500)
            failed = []
            pg.on('requestfailed', lambda r: failed.append(r.url))
            await ctx.set_offline(True)
            try:
                await pg.reload(wait_until='load')
                await pg.wait_for_function("document.documentElement.classList.contains('ready') && !!window.__cardex", timeout=20000)
                await pg.wait_for_timeout(800)
                title = await pg.title()
                outlet = await pg.evaluate("document.querySelector('#outlet') && document.querySelector('#outlet').children.length")
                await pg.screenshot(path=os.path.join(ROOT, '.cache', 'f2', 'sw_offline.png'))
            finally:
                await ctx.set_offline(False)
            shell = set(SHELL)
            lost = [u for u in failed if rel(srv, u) in shell or rel(srv, u) == '']
            eq(lost, [], 'aucun fichier de l’appli manquant hors ligne')
            check(outlet, 'vue affichée hors ligne')
            other = [u for u in failed if u.startswith(srv.url)]
            return f'« {title} » ; requêtes locales échouées hors ligne (hors appli) : {len(other)} {other[:4]}'

        # ---------- 3. images : CORS, réponses ok seulement, jamais d'opaque ----------
        async def t_images():
            base = 'https://assets.tcgdex.net/fr/sv/sv03.5/'
            sprite = 'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@c0542f7c51215d9672439012838c99f520596cbd/sprites/pokemon/25.png'
            cases = {
                'tcgdex': (base + '025/low.webp', True),
                'tcgdex-sans-attribut': (base + '004/low.webp', False),      # balise sans crossorigin : le SW passe en CORS
                'scrydex': ('https://images.scrydex.com/pokemon/sv3pt5-25/small', True),
                'sans-cors': ('https://raw.githubusercontent.com/x/y/1.png', False),   # affichée, jamais gardée
                '404': ('https://assets.tcgdex.net/fr/missing/1/low.webp', True),
                'tcgplayer': ('https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg', True),
                'sprite': (sprite, True),
            }
            got = {}
            for k, (u, cors) in cases.items():
                got[k] = await pg.evaluate(LOAD_IMG, [u, cors])
            again = await pg.evaluate(LOAD_IMG, [base + '025/low.webp', True])   # 2e fois : depuis le cache
            await pg.wait_for_timeout(500)
            dump = await pg.evaluate(DUMP)
            opaque = [(k, x['url']) for k, items in dump.items() for x in items if x['type'] == 'opaque']
            bad = [(k, x['url'], x['status']) for k, items in dump.items() for x in items if not x['ok']]
            eq(opaque, [], 'aucune réponse opaque dans Cache Storage')
            eq(bad, [], 'aucune réponse en erreur dans Cache Storage')
            eq(got, {'tcgdex': 'ok', 'tcgdex-sans-attribut': 'ok', 'scrydex': 'ok', 'sans-cors': 'ok', '404': 'error',
                     'tcgplayer': 'ok', 'sprite': 'ok'}, 'affichage')
            eq(again, 'ok', 'image en cache')
            cards = {x['url'] for x in dump.get('cardex-img-cards', [])}
            for k in ('tcgdex', 'tcgdex-sans-attribut', 'scrydex'):
                check(cases[k][0] in cards, f'{k} dans cardex-img-cards', sorted(cards))
            check(cases['404'][0] not in cards, '404 pas gardé')
            check(cases['tcgplayer'][0] in {x['url'] for x in dump.get('cardex-img-sealed', [])}, 'TCGplayer dans cardex-img-sealed')
            dex = {x['url'] for x in dump.get('cardex-img-dex', [])}
            check(sprite in dex and cases['sans-cors'][0] not in dex, 'sprites gardés, hôte sans CORS jamais', sorted(dex))
            hits = [h for h in ext.hits if h[1] == base + '025/low.webp']
            eq(len(hits), 1, 'une seule requête réseau pour une image déjà vue')
            return ', '.join(f'{k}: {len(v)}' for k, v in sorted(dump.items()))

        # ---------- 4. TCGdex : réseau d'abord, copie après 4 s seulement si elle existe ----------
        async def t_api():
            url = 'https://api.tcgdex.net/v2/fr/cards/sv03.5-025'
            ext.api_mode, ext.api_delay, ext.api_name = 'ok', 5.0, 'v1'
            r1 = await pg.evaluate(FETCH, url)          # aucune copie : on attend le réseau, même au-delà de 4 s
            check(r1.get('name') == 'v1' and r1['ms'] >= 4800, 'sans copie : la réponse lente arrive (pas d’abandon à 4 s)', r1)
            ext.api_delay, ext.api_name = 7.0, 'v2'
            r2 = await pg.evaluate(FETCH, url)          # copie existante : servie après 4 s
            check(r2.get('name') == 'v1' and 3800 <= r2['ms'] <= 5800, 'copie servie après 4 s', r2)
            await asyncio.sleep(3.8)                    # la réponse lente arrive et remplace la copie
            ext.api_delay, ext.api_mode = 0, 'error'
            r3 = await pg.evaluate(FETCH, url)
            check(r3.get('name') == 'v2' and r3['ms'] < 2000, 'erreur 503 : copie (mise à jour par la réponse lente)', r3)
            ext.api_mode = 'abort'
            r4 = await pg.evaluate(FETCH, url)
            check(r4.get('name') == 'v2', 'réseau coupé : copie', r4)
            ext.api_mode, ext.api_name = 'ok', 'v3'
            r5 = await pg.evaluate(FETCH, url)
            check(r5.get('name') == 'v3' and r5['ms'] < 2000, 'réseau d’abord quand il répond', r5)
            ext.api_mode = 'abort'
            r6 = await pg.evaluate(FETCH, 'https://api.tcgdex.net/v2/fr/cards/sv03.5-999')
            eq(r6.get('error'), 'TypeError', 'sans copie et sans réseau : erreur (la page affiche son message)')
            ext.api_mode = 'ok'
            post = await pg.evaluate('''async () => { const r = await fetch('https://api.tcgdex.net/v2/graphql', { method: 'POST',
              headers: { 'Content-Type': 'application/json' }, body: '{"query":"{ sets { id } }"}' }); return r.status; }''')
            eq(post, 200, 'GraphQL (POST) passe sans cache')
            dump = await pg.evaluate(DUMP)
            api = [x['url'] for x in dump.get('cardex-api', [])]
            check(url in api and not any('sv03.5-999' in u or 'graphql' in u for u in api), 'cardex-api : seulement les GET réussis', api)
            return f"lente sans copie {r1['ms']:.0f} ms · copie après {r2['ms']:.0f} ms · 503 {r3['ms']:.0f} ms"

        # ---------- 5. données versionnées : toutes les séries hors ligne, purge des anciens hashes ----------
        async def t_data():
            m = manifest(SITE)
            await pg.evaluate("fetch('data/manifest.json').then(r => r.text())")
            st = await pg.evaluate(ASK, 'offline-status')
            n_sets = sum(1 for k in m['files'] if re.match(r'^data/sets/[^/]+\.json$', k))
            eq(st['sets'], n_sets, 'séries listées dans le manifest')
            await pg.evaluate("navigator.serviceWorker.controller.postMessage({ type: 'warm' })")
            for _ in range(240):
                st = await pg.evaluate(ASK, 'offline-status')
                if st['cached'] >= st['sets'] and st['picturesCached'] >= st['pictures']:
                    break
                await asyncio.sleep(0.5)
            eq(st['cached'], st['sets'], 'toutes les séries enregistrées pour le hors ligne')
            check(st['pictures'] > 100 and st['picturesCached'] == st['pictures'], 'logos et symboles enregistrés pour le hors ligne', st)
            # Séries hors ligne, liste entière parcourue : aucun logo ni symbole manquant
            await pg.goto(srv.url + '#/series')
            await pg.wait_for_timeout(600)
            # vague 2 : les blocs sont repliables (seul le premier est ouvert sans collection) : on les ouvre tous
            await pg.evaluate('''async () => { const P = await import('./js/state/prefs.js'); const C = await import('./js/data/catalog.js');
              P.set('openBlocs', (await C.sets()).blocs.map(b => b.id)); }''')
            failed = []

            def on_failed(r):
                failed.append(r.url)
            pg.on('requestfailed', on_failed)
            await ctx.set_offline(True)
            try:
                await pg.reload(wait_until='load')
                await pg.wait_for_function("document.documentElement.classList.contains('ready') && !!window.__cardex", timeout=20000)
                await pg.wait_for_timeout(600)
                await pg.evaluate('''async () => { const h = () => document.documentElement.scrollHeight;
                  for (let y = 0; y < h(); y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } }''')
                await pg.wait_for_timeout(600)
                imgs = await pg.evaluate('''[...document.images].filter(i => new URL(i.src).pathname.includes('/img/'))
                  .map(i => ({ src: i.src, ok: i.complete && i.naturalWidth > 0 }))''')
                await pg.screenshot(path=os.path.join(ROOT, '.cache', 'f2', 'sw_series_offline.png'))
            finally:
                await ctx.set_offline(False)
                pg.remove_listener('requestfailed', on_failed)
                await pg.evaluate('scrollTo(0, 0)')
            eq([u for u in failed if '/img/' in u], [], 'aucun logo ni symbole manquant hors ligne')
            check(len(imgs) > 50 and all(i['ok'] for i in imgs), 'logos affichés hors ligne', len(imgs), [i for i in imgs if not i['ok']][:5])
            pics = f"{st['picturesCached']}/{st['pictures']} logos et symboles, {len(imgs)} affichés hors ligne"
            sid = 'base1' if 'data/sets/base1.json' in m['files'] else sorted(m['files'])[0].split('/')[-1][:-5]
            await ctx.set_offline(True)
            try:
                r = await pg.evaluate('''async (sid) => { const CAT = await import('./js/data/catalog.js');
                  try { const s = await CAT.set(sid); return { n: s.cards.length }; } catch (e) { return { error: String(e) }; } }''', sid)
            finally:
                await ctx.set_offline(False)
            check(r.get('n', 0) > 10, f'série {sid} ouverte hors ligne', r)
            # nouveau contenu -> nouveau hash dans le manifest -> l'ancienne copie est purgée
            old_h = m['files'][f'data/sets/{sid}.json']
            with open(os.path.join(SITE, 'data', 'sets', f'{sid}.json'), 'a', encoding='utf8', newline='\n') as fh:
                fh.write('\n')
            code, out = release(SITE, '--manifest-only')
            check(code == 0, 'release --manifest-only', out)
            new_h = manifest(SITE)['files'][f'data/sets/{sid}.json']
            check(new_h != old_h, 'hash changé')
            await pg.evaluate("fetch('data/manifest.json', { cache: 'no-cache' }).then(r => r.text())")
            data_urls = []
            for _ in range(40):
                await asyncio.sleep(0.25)
                dump = await pg.evaluate(DUMP)
                data_urls = [x['url'] for x in dump.get('cardex-data', [])]
                if not any(f'data/sets/{sid}.json?h={old_h}' in u for u in data_urls):
                    break
            check(not any(f'data/sets/{sid}.json?h={old_h}' in u for u in data_urls), 'ancien hash purgé')
            check(any(u.endswith('data/manifest.json') for u in data_urls), 'manifest gardé (secours hors ligne)')
            return f"{st['cached']}/{st['sets']} séries hors ligne, {pics}, {len(data_urls)} entrées dans cardex-data"

        # ---------- 6. mise à jour : nouvelle VERSION ----------
        async def t_update():
            await pg.evaluate("caches.open('other-app-v1').then(c => c.put('/other', new Response('x')))")
            with open(os.path.join(SITE, 'js', 'core', 'idle.js'), 'a', encoding='utf8', newline='\n') as fh:
                fh.write('\n// test de mise à jour\n')
            code, out = release(SITE)
            check(code == 0, 'release', out)
            _, v2, _ = stamped(SITE)
            check(v2 != VERSION, 'nouvelle VERSION', v2)
            await pg.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
            await pg.wait_for_function('navigator.serviceWorker.getRegistration().then(r => !!(r && r.waiting))', timeout=30000)
            toast = None
            try:
                await pg.wait_for_function("(document.querySelector('#toasts') || document.body).innerText.includes('Nouvelle version disponible')", timeout=8000)
                toast = await pg.evaluate("document.querySelector('#toasts').innerText")
            except Exception:
                pass
            check(toast and 'Recharger' in toast, 'toast « Nouvelle version disponible · Recharger » (main.js)', toast)
            before = await pg.evaluate('caches.keys()')
            async with pg.expect_navigation(timeout=20000):
                await pg.click('#toasts button.act')
            await pg.wait_for_function(CONTROLLED, timeout=20000)
            v = await pg.evaluate(ASK, 'version')
            eq(v['version'], v2, 'nouvelle version active après « Recharger »')
            keys = await pg.evaluate('caches.keys()')
            check(f'cardex-app-{v2}' in keys and f'cardex-app-{VERSION}' not in keys, 'ancien cache de l’appli supprimé', keys)
            for k in ('other-app-v1', 'cardex-img-cards', 'cardex-data', 'cardex-api'):
                check(k in keys, f'{k} gardé', keys)
            state['version'] = v2
            return f'{VERSION} → {v2} ; caches avant {len(before)}, après {len(keys)}'

        # ---------- 6 bis. alertes de prix : periodicsync -> WishDB dans le service worker -> notification ----------
        async def t_periodic():
            os.makedirs(os.path.join(SITE, 'data', 'market', 'prices'), exist_ok=True)
            with open(os.path.join(SITE, 'data', 'market', 'prices', 'sv03.5.json'), 'w', encoding='utf8') as fh:
                json.dump({'v': 1, 'd': '2026-11-25', 'c': {'025': {'normal': [23, 25, 24, 17, 15]}}}, fh)
            code, out = release(SITE, '--manifest-only')
            check(code == 0, 'manifest', out)
            await ctx.grant_permissions(['notifications'], origin=srv.url.rstrip('/'))
            await pg.evaluate('''async () => { const W = window.WishDB;
              for (const w of await W.all()) await W.del(w.key);
              await W.put(W.make({ id: 'sv03.5-025', name: 'Pikachu', setName: '151', localId: '025' }, 'normal', { min: 0, max: 1 })); }''')
            cdp = await ctx.new_cdp_session(pg)
            regs = []
            cdp.on('ServiceWorker.workerRegistrationUpdated', lambda e: regs.extend(e['registrations']))
            await cdp.send('ServiceWorker.enable')
            for _ in range(20):
                if any(r['scopeURL'] == srv.url for r in regs):
                    break
                await asyncio.sleep(0.1)
            reg_id = next(r['registrationId'] for r in regs if r['scopeURL'] == srv.url)
            await cdp.send('ServiceWorker.dispatchPeriodicSyncEvent',
                           {'origin': srv.url.rstrip('/'), 'registrationId': reg_id, 'tag': 'cardex-prices'})
            n = []
            for _ in range(60):
                n = await pg.evaluate('''async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications())
                  .map(x => ({ title: x.title, body: x.body, tag: x.tag, url: x.data && x.data.url }))''')
                if n:
                    break
                await asyncio.sleep(0.25)
            w = await pg.evaluate("window.WishDB.all().then(l => l[0])")
            perm = await pg.evaluate('Notification.permission')
            await cdp.detach()
            check(w['checkedAt'] > 0, 'periodicsync reçu : envie vérifiée par le service worker', w, perm, regs[:2])
            check(w['inRange'] and abs(w['low'] - 0.15) < 1e-9, 'envie dans sa fourchette (prix du fichier de cotes)', w)
            check(len(n) == 1, 'une notification', n, perm, w)
            eq(n[0]['title'], 'Pikachu est dans ta fourchette', 'titre')
            check('Dès 0,15' in n[0]['body'] and 'Cardmarket' in n[0]['body'] and '!' not in n[0]['title'], 'texte', n[0])
            eq((n[0]['tag'], n[0]['url']), ('sv03.5-025|normal', './#/marche/envies'), 'tag et lien vers les envies')
            check(w['inRange'] and w['checkedAt'] > 0 and abs(w['low'] - 0.15) < 1e-9, 'envie mise à jour par le service worker', w)
            st = await pg.evaluate('window.WishDB.alertStatus()')
            return f"« {n[0]['title']} » — {n[0]['body']} ; alertStatus {st}"

        # ---------- 7. passage depuis la v1 (ancien service worker actif, caches opaques) ----------
        async def t_from_v1():
            ctx2, _ = await new_ctx()
            srv.pages['legacy-sw.js'] = (LEGACY_SW, 'text/javascript; charset=utf-8')
            srv.pages['__legacy.html'] = LEGACY_PAGE
            try:
                q = await ctx2.new_page()
                await q.goto(srv.url + '__legacy.html')
                await q.wait_for_function('window.done === true && !!navigator.serviceWorker.controller', timeout=15000)
                legacy = await q.evaluate('navigator.serviceWorker.controller.scriptURL')
                await q.goto(srv.url)                     # la nouvelle appli enregistre sw.js
                await q.wait_for_function("!!navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.endsWith('/sw.js')"
                                          " && navigator.serviceWorker.controller.state === 'activated'", timeout=40000)
                await q.wait_for_timeout(500)
                keys = await q.evaluate('caches.keys()')
                waiting = await q.evaluate('navigator.serviceWorker.getRegistration().then(r => !!r.waiting)')
            finally:
                del srv.pages['legacy-sw.js'], srv.pages['__legacy.html']
                await ctx2.close()
            check(legacy.endswith('legacy-sw.js'), 'ancien service worker actif au départ', legacy)
            check('cardex-shell-v8' not in keys and 'cardex-images-v1' not in keys, 'caches v1 supprimés', keys)
            check('someone-else' in keys, 'cache d’une autre appli du domaine intact', keys)
            check(f"cardex-app-{state['version']}" in keys, 'nouvelle appli précachée', keys)
            check(not waiting, 'pas d’attente : la v2 prend la main tout de suite (images v1 opaques)')
            return ', '.join(sorted(keys))

        # ---------- 8. plafonds des caches d'images (FIFO), avec des plafonds réduits pour le test ----------
        async def t_caps():
            sw, _, _ = stamped(SITE)
            # 1) plafond exact quand chaque ajout peut couper (pas d'écart minimal entre deux coupes)
            patched = sw.replace("['cardex-img-cards', 3000]", "['cardex-img-cards', 5]").replace('TRIM_GAP = 60000', 'TRIM_GAP = 0')
            check(patched.count("['cardex-img-cards', 5]") == 2 and 'TRIM_GAP = 0' in patched, 'plafonds remplacés dans la copie de sw.js')
            urls = [f'https://assets.tcgdex.net/fr/test/t/{i:03d}/low.webp' for i in range(12)]

            async def run(code, pause_ms):
                srv.pages['sw.js'] = (code, 'text/javascript; charset=utf-8')
                ctx3, ext3 = await new_ctx()
                try:
                    q = await ctx3.new_page()
                    await q.goto(srv.url)
                    await q.wait_for_function(CONTROLLED, timeout=30000)
                    for u in urls:
                        eq(await q.evaluate(LOAD_IMG, [u, True]), 'ok', 'image')
                    await q.wait_for_timeout(300)
                    burst = [x['url'] for x in (await q.evaluate(DUMP)).get('cardex-img-cards', [])]
                    await q.wait_for_timeout(pause_ms)
                    after = [x['url'] for x in (await q.evaluate(DUMP)).get('cardex-img-cards', [])]
                finally:
                    del srv.pages['sw.js']
                    await ctx3.close()
                return burst, after

            _, kept = await run(patched, 500)
            eq(kept, urls[-5:], 'les 5 plus récentes gardées (FIFO)')
            # 2) une coupe par intervalle : un afflux dépasse le plafond de moins de TRIM_BURST entrées, puis la coupe
            # prévue à la fin de l'intervalle revient au plafond même sans nouvel ajout
            gap = sw.replace("['cardex-img-cards', 3000]", "['cardex-img-cards', 5]").replace('TRIM_GAP = 60000', 'TRIM_GAP = 2500').replace('TRIM_BURST = 20', 'TRIM_BURST = 4')
            check('TRIM_GAP = 2500' in gap and 'TRIM_BURST = 4' in gap, 'intervalle et afflux remplacés dans la copie de sw.js')
            burst, after = await run(gap, 3500)
            check(5 <= len(burst) <= 5 + 3, 'afflux : au plus plafond + TRIM_BURST − 1 entrées', len(burst))
            eq(after, urls[-5:], 'coupe prévue en fin d’intervalle : retour au plafond (FIFO)')
            return f'12 images : {len(kept)} gardées ; afflux {len(burst)} puis {len(after)}'

        # ---------- 9. sw.js du dépôt (mode développement) : hors ligne après une première visite ----------
        async def t_dev():
            with open(os.path.join(ROOT, 'sw.js'), encoding='utf8') as fh:
                dev = fh.read()
            check("const VERSION = 'dev';" in dev and 'const SHELL = [];' in dev, 'sw.js du dépôt en mode développement')
            srv.pages['sw.js'] = (dev, 'text/javascript; charset=utf-8')
            srv.fail['data/manifest.json'] = 404                 # comme en développement : pas de manifest
            ctx4, _ = await new_ctx()
            failed, errs = [], []
            try:
                q = await ctx4.new_page()
                q.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'manifest.json' not in (m.location or {}).get('url', '') else None)
                await q.goto(srv.url + '#/collection/cartes')
                await q.wait_for_function(CONTROLLED, timeout=30000)
                prev, t_ctl = -1, time.monotonic()
                for _ in range(80):                            # copie de ce que la page a chargé avant la prise de main
                    n = await q.evaluate("caches.open('cardex-app-dev').then(c => c.keys()).then(k => k.length)")
                    # js/core/net.js envoie une seconde liste 3 s après la prise de main (fichiers encore en route)
                    if n == prev and n >= 20 and time.monotonic() - t_ctl > 4.5:
                        break
                    prev = n
                    await asyncio.sleep(0.3)
                dump = await q.evaluate(DUMP)
                q.on('requestfailed', lambda r: failed.append(r.url))
                await ctx4.set_offline(True)
                try:
                    await q.reload(wait_until='load')
                    await q.wait_for_function("document.documentElement.classList.contains('ready') && !!window.__cardex", timeout=20000)
                    await q.wait_for_timeout(800)
                    title = await q.title()
                    outlet = await q.evaluate("document.querySelector('#outlet') && document.querySelector('#outlet').innerText.length")
                    await q.screenshot(path=os.path.join(ROOT, '.cache', 'f2', 'sw_dev_offline.png'))
                finally:
                    await ctx4.set_offline(False)
            finally:
                del srv.pages['sw.js'], srv.fail['data/manifest.json']
                await ctx4.close()
            app = [x['url'] for x in dump.get('cardex-app-dev', [])]
            opaque = [x['url'] for items in dump.values() for x in items if x['type'] == 'opaque' or not x['ok']]
            eq(opaque, [], 'mode dev : rien d’opaque ni en erreur')
            check(srv.url + 'index.html' in app and srv.url + 'js/main.js' in app and srv.url + 'js/state/collection.js' in app,
                  'mode dev : la page de la première visite et ses modules gardés', app[:8])
            exists = lambda u: os.path.isfile(os.path.join(SITE, *rel(srv, u).split('/'))) if rel(srv, u) else True
            lost = [u for u in failed if u.startswith(srv.url) and exists(u) and 'manifest.json' not in u]
            eq(lost, [], 'mode dev : aucun fichier existant manquant hors ligne')
            check(outlet and outlet > 20, 'mode dev : vue affichée hors ligne', title, outlet)
            return f"« {title} » hors ligne ; {len(app)} fichiers de l'appli et {len(dump.get('cardex-data', []))} données gardés à la 1re visite"

        # ---------- 10. clic sur une notification : la fenêtre de Cardex passe sur les envies ----------
        async def t_click():
            sw, _, _ = stamped(SITE)
            check('async function openApp(' in sw, 'openApp() dans sw.js')
            hook = ("\nself.addEventListener('message', e => { if (e.data && e.data.type === '__open') "
                    "e.waitUntil(openApp(e.data.url).catch(() => {})); });\n")
            srv.pages['sw.js'] = (sw + hook, 'text/javascript; charset=utf-8')
            ctx5, _ = await new_ctx()
            try:
                q = await ctx5.new_page()
                await q.goto(srv.url + '#/series')
                await q.wait_for_function(CONTROLLED, timeout=30000)
                await q.wait_for_function("document.documentElement.classList.contains('ready') && !!window.__cardex", timeout=20000)
                await q.evaluate("(url) => navigator.serviceWorker.controller.postMessage({ type: '__open', url })", './#/marche/envies')
                await q.wait_for_url('**/#/marche/envies', timeout=10000)
                await q.wait_for_function("document.documentElement.classList.contains('ready') && !!window.__cardex", timeout=20000)
                await q.wait_for_timeout(500)
                title = await q.title()
                pages = len(ctx5.pages)
            finally:
                del srv.pages['sw.js']
                await ctx5.close()
            eq(pages, 1, 'pas de deuxième fenêtre')
            check('Cardex' in title, 'appli affichée', title)
            return f'« {title} »'

        for name, fn in [('installation et précache', t_install),
                         ('rechargement hors ligne', t_offline),
                         ('images : CORS, ok seulement, jamais d’opaque', t_images),
                         ('TCGdex : réseau d’abord, copie après 4 s', t_api),
                         ('données ?h= : séries hors ligne et purge', t_data),
                         ('mise à jour : nouvelle VERSION', t_update),
                         ('alertes : periodicsync → notification', t_periodic),
                         ('passage depuis la v1', t_from_v1),
                         ('plafonds des caches d’images', t_caps),
                         ('sw.js du dépôt (mode dev) : hors ligne après la 1re visite', t_dev),
                         ('notification : la fenêtre ouverte passe sur les envies', t_click)]:
            await R.arun(name, fn)
        blocked = sorted({u for u in ext.blocked})
        print(f'requêtes externes non simulées (bloquées) : {len(blocked)} {blocked[:5]}')
        # fichier absent du site (404 en ligne, ERR_FAILED hors ligne), ex. css/views/*.css liés par index.html avant que
        # leurs auteurs les écrivent. Les autres sont attendus : 404 et TCGdex coupé voulus par les tests, logos pas
        # encore enregistrés au premier rechargement hors ligne (avant la mise en cache de toutes les séries).
        def absent(c):
            m = re.search(r'(?:status of 404|net::ERR_FAILED).*@ (\S+)', c)
            p = m and rel(srv, m.group(1))
            return bool(p) and not os.path.exists(os.path.join(SITE, *p.split('/')))
        other = sorted({c for c in console if not absent(c)})
        print(f"erreurs de console de l'appli pendant les tests : {len(console)}, dont {len(console) - sum(1 for c in console if not absent(c))}"
              f" pour des fichiers absents du site (404, ou échec hors ligne) ; autres (attendus) : {len(other)}")
        for c in other[:20]:
            print('   ', c[:220])
        await b.close()
    srv.close()
    return R


def release_tests(R):
    """tools/release.py sur un petit site : VERSION stable, CRLF sans effet, --check, manifest, CRLF de sw.js gardé."""
    def t():
        d = tempfile.mkdtemp(prefix='f2rel-')
        try:
            files = {'index.html': '<!doctype html>\n<title>x</title>\n', 'manifest.webmanifest': '{}\n', 'icon.svg': '<svg/>\n',
                     'js/a.js': 'export const a = 1;\nexport const b = 2;\n', 'css/b.css': 'a{color:red}\n', 'fonts/c.woff2': '\x00\x01',
                     'data/x.json': '{"a":1}', 'data/sub/y.bin': '\x00\x02\x03', 'data/z.txt': 'non', 'js/__pycache__/q.pyc': 'x'}
            for k, v in files.items():
                os.makedirs(os.path.dirname(os.path.join(d, k)) or d, exist_ok=True)
                with open(os.path.join(d, k), 'w', encoding='utf8', newline='\n') as fh:
                    fh.write(v)
            with open(os.path.join(ROOT, 'sw.js'), encoding='utf8') as fh:
                sw = fh.read().replace('\r\n', '\n')
            sw = re.sub(r"^const VERSION = '[^']*';", "const VERSION = 'dev';", sw, flags=re.M)
            sw = re.sub(r'^const SHELL = \[[^\]]*\];', 'const SHELL = [];', sw, flags=re.M)
            with open(os.path.join(d, 'sw.js'), 'w', encoding='utf8', newline='\r\n') as fh:     # sw.js en CRLF
                fh.write(sw)
            code, out = release(d)
            check(code == 0, 'release', out)
            raw = open(os.path.join(d, 'sw.js'), 'rb').read()
            check(b'\r\n' in raw and b'\n' not in raw.replace(b'\r\n', b''), 'fins de ligne CRLF de sw.js gardées')
            _, v1, shell = stamped(d)
            eq(shell, ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'css/b.css', 'js/a.js', 'fonts/c.woff2'], 'SHELL')
            check(re.fullmatch(r'[0-9a-f]{10}', v1), 'VERSION = hash', v1)
            m = manifest(d)
            eq(sorted(m['files']), ['data/sub/y.bin', 'data/x.json'], 'manifest : .json et .bin sous data/')
            check(all(re.fullmatch(r'[0-9a-f]{8}', h) for h in m['files'].values()), 'hashes de 8 caractères hexadécimaux')
            code, out = release(d, '--check')
            eq(code, 0, '--check : à jour')
            check('sw.js à jour' in out, 'sortie en UTF-8 (accents lisibles)', out)
            before = open(os.path.join(d, 'sw.js'), 'rb').read()
            release(d)
            eq(open(os.path.join(d, 'sw.js'), 'rb').read(), before, 'deuxième passage : rien ne change')
            m2 = manifest(d)
            eq(m2['v'], m['v'], 'manifest inchangé gardé tel quel')
            js = os.path.join(d, 'js', 'a.js')
            data = open(js, 'rb').read()
            open(js, 'wb').write(data.replace(b'\n', b'\r\n'))
            code, out = release(d, '--check')
            eq(code, 0, 'fichier passé en CRLF : même VERSION (' + out + ')')
            open(js, 'wb').write(data + b'// changement\n')
            code, out = release(d, '--check')
            eq(code, 1, '--check : fichier modifié détecté')
            release(d)
            _, v2, _ = stamped(d)
            check(v2 != v1, 'nouvelle VERSION après modification')
            return f'VERSION {v1} → {v2}'
        finally:
            shutil.rmtree(d, ignore_errors=True)
    R.run('release.py : VERSION, SHELL, CRLF, --check, manifest', t)


if __name__ == '__main__':
    R = asyncio.run(main())
    if isinstance(R, int):
        sys.exit(R)
    release_tests(R)
    sys.exit(R.done())
