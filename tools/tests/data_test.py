"""Tests de la couche de données (F2) dans Chromium : net, catalogue, recherche, images, cotes, Pokédex, envies.

    python -P tools/tests/data_test.py            (vraies données de CA/MK quand elles existent, sinon les fixtures)
    python -P tools/tests/data_test.py --fixtures (fixtures seulement)
    python -P tools/tests/data_test.py --offline  (sans aucune requête vers TCGdex, Scrydex, jsDelivr)
    python -P tools/tests/data_test.py --prices DIR   (fichiers de cotes pris dans DIR)
    python -P tools/tests/data_test.py --port 8792    (port du serveur de test)

Les tests qui demandent le réseau sont comptés à part (SKIP) avec --offline, jamais comme réussis.

Port 8772 (ou --port N). Quelques requêtes réelles et légères (TCGdex ≤ 4/s) : une fiche, une recherche, une série en direct,
quelques images des cas limites.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'f2'))
from kit import ROOT, FIX, PORT, HARNESS, serve, Runner, Skip, check, eq, console_watch, expected_404s  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ARGS = set(sys.argv[1:])
REAL_CAT = os.path.isfile(os.path.join(ROOT, 'data', 'sets.json')) and '--fixtures' not in ARGS
# --prices DIR : fichiers de cotes pris dans DIR (ex. un aperçu construit avec le code de MK) au lieu de data/market/prices
PRICE_ARG = sys.argv[sys.argv.index('--prices') + 1] if '--prices' in sys.argv else None
PRICE_DIR = os.path.abspath(PRICE_ARG) if PRICE_ARG else os.path.join(ROOT, 'data', 'market', 'prices')
REAL_PRICES = os.path.isdir(PRICE_DIR) and any(f.endswith('.json') for f in os.listdir(PRICE_DIR)) and '--fixtures' not in ARGS
ONLINE = '--offline' not in ARGS

MODS = "['./js/core/net.js','./js/data/catalog.js','./js/data/images.js','./js/data/prices.js','./js/data/dex.js','./js/data/tcgdex.js','./js/data/finishes.js']"
LOAD = f"async () => {{ const m = await load(...{MODS}); [window.N, window.CAT, window.IMG, window.PR, window.DEX, window.TCG, window.FIN] = m; await IMG.ready; }}"


def jload(*p):
    with open(os.path.join(*p), encoding='utf8') as fh:
        return json.load(fh)


# dos de carte servi par Scrydex pour un identifiant inconnu : préfixe d'ETag stable quel que soit le format (§2.5)
SX_BACK = 'cfl2loWl84E8tUjrC-Q-I0D0J'


def scrydex_etag(url, tries=3):
    import urllib.error
    import urllib.request
    req = urllib.request.Request(url, method='HEAD', headers={
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 (cardex-test)'})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                e = res.headers.get('ETag') or ''
            return (e[2:] if e.startswith('W/') else e).strip('"')
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))      # connexion coupée (WinError 10054…) : on réessaie doucement


def main():
    overlays = {} if REAL_CAT else {'data/': FIX}
    if REAL_CAT and not REAL_PRICES:
        overlays = {'data/market/': os.path.join(FIX, 'market')}
    if REAL_PRICES and PRICE_ARG:
        overlays = {'data/market/prices/': PRICE_DIR, **overlays}
    srv = serve(ROOT, PORT, overlays=overlays, pages={'__f2.html': HARNESS})
    srv.fail['data/manifest.json'] = 404
    data_dir = os.path.join(ROOT, 'data') if REAL_CAT else FIX
    sets_json = jload(data_dir, 'sets.json')
    print(f"catalogue : {'réel (CA)' if REAL_CAT else 'fixtures'} · cotes : {'réelles (MK)' if REAL_PRICES else 'fixtures'} · réseau : {'oui' if ONLINE else 'non'}")
    R = Runner('data_test')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(locale='fr-FR')
        errs = []

        # erreurs provoquées exprès par les tests (404, 500, séries et cotes inexistantes)
        WANTED = ['/__missing/', '/__err500/', 'nope/zz', 'data/sets/zz-', 'sets/zz-inexistante', 'data/sets/2013bw.json',
                  'prices/zz-', 'cards/zz-']

        def fresh():
            pg = ctx.new_page()
            console_watch(pg, errs, expected_404s() + WANTED)
            pg.goto(srv.url + '__f2.html')
            pg.evaluate(LOAD)
            return pg

        pg = fresh()

        # ---------- net.js ----------
        def t_net():
            srv.delay['__slow/'] = 1.5
            srv.fail['__err500/'] = 500
            r = pg.evaluate('''async () => {
              const out = {};
              const kind = async f => { try { await f(); return 'ok'; } catch (e) { return e instanceof N.NetError ? e.kind + ':' + e.status : e.name; } };
              out.timeout = await kind(() => N.getJSON('__slow/x.json', { timeout: 300 }));
              out.notfound = await kind(() => N.getJSON('__missing/x.json'));
              out.server = await kind(() => N.getJSON('__err500/x.json'));
              out.syntax = await kind(() => N.getJSON('__f2.html'));
              const ctl = new AbortController(); setTimeout(() => ctl.abort(), 50);
              out.abort = await kind(() => N.getJSON('__slow/y.json', { signal: ctl.signal, timeout: 5000 }));
              const pre = new AbortController(); pre.abort();
              out.preAbort = await kind(() => N.getJSON('data/sets.json', { signal: pre.signal }));
              // cached() : copie fraîche, puis périmée qui l'emporte sur une erreur
              localStorage.setItem('t.cache', JSON.stringify({ t: Date.now() - 5000, d: { a: 1 } }));
              out.fresh = await N.cached('t.cache', 60000, async () => { throw new Error('ne doit pas être appelé'); });
              out.stale = await N.cached('t.cache', 1000, async () => { throw new N.NetError('offline'); });
              out.reload = await N.cached('t.cache', 1000, async () => ({ a: 2 }));
              out.noCopy = await kind(() => N.cached('t.none', 1000, async () => { throw new N.NetError('timeout'); }));
              // data() : sans manifest -> chemin simple, mémorisé
              const a = await N.data('data/sets.json'), b2 = await N.data('sets.json');
              out.memo = a === b2;
              out.msg = N.MESSAGES;
              return out;
            }''')
            del srv.delay['__slow/'], srv.fail['__err500/']
            eq(r['timeout'], 'timeout:0', 'délai dépassé')
            eq(r['notfound'], 'notfound:404', '404')
            eq(r['server'], 'server:500', '500')
            eq(r['syntax'], 'server:200', 'JSON illisible')
            eq(r['abort'], 'AbortError', 'annulation par l’appelant relancée telle quelle')
            eq(r['preAbort'], 'AbortError', 'signal déjà annulé')
            eq(r['fresh'], {'a': 1}, 'copie fraîche')
            eq(r['stale'], {'a': 1}, 'copie périmée plutôt qu’une erreur')
            eq(r['reload'], {'a': 2}, 'rechargé quand le réseau répond')
            eq(r['noCopy'], 'timeout:0', 'sans copie : l’erreur')
            check(r['memo'], 'data() mémorisé (une seule requête)')
            eq(len([x for x in srv.requests('data/sets.json')]), 1, 'sets.json demandé une fois')
            eq(r['msg']['offline'], 'Hors ligne', 'messages')

        def t_net_manifest():
            # avec un manifest : ?h=<hash> ; fichier absent du manifest = introuvable sans requête
            q = ctx.new_page()
            console_watch(q, errs, expected_404s())
            q.goto(srv.url + '__f2.html')
            srv.pages['data/manifest.json'] = json.dumps({'v': 't', 'files': {'data/sets.json': 'abcd1234', 'data/pokedex.json': '00ff00ff'}})
            del srv.fail['data/manifest.json']
            try:
                before = len(srv.requests('data/'))
                r = q.evaluate('''async () => { const [N] = await load('./js/core/net.js');
                  const s = await N.data('data/sets.json'); let miss;
                  try { await N.data('data/cardimg.json'); miss = 'ok'; } catch (e) { miss = e.kind; }
                  return { ok: Array.isArray(s.sets), miss, h: await N.hashOf('data/pokedex.json') }; }''')
                reqs = srv.requests('data/')[before:]
            finally:
                srv.fail['data/manifest.json'] = 404
                del srv.pages['data/manifest.json']
            check(r['ok'], 'fichier chargé')
            eq(r['miss'], 'notfound', 'absent du manifest')
            eq(r['h'], '00ff00ff', 'hashOf')
            check('/data/sets.json?h=abcd1234' in reqs and not any('cardimg' in x for x in reqs), 'requêtes', reqs)
            q.close()
            return ', '.join(reqs)

        # ---------- catalogue ----------
        def t_sets():
            r = pg.evaluate('''async () => { const s = await CAT.sets();
              return { n: s.sets.length, ids: s.sets.map(m => m.id), dates: s.sets.map(m => m.date), blocs: s.blocs.map(b => ({ id: b.id, n: b.sets.length, first: b.first })),
                       byId: s.byId.size, keys: Object.keys(s.sets[0]).sort(), meta: CAT.metaSync(s.sets[0].id) === s.sets[0] }; }''')
            hidden = set(sets_json.get('hidden') or [])
            visible = [m['id'] for m in sets_json['sets'] if m['id'] not in hidden]
            eq(r['n'], len(visible), 'séries visibles')
            eq(r['dates'], sorted(r['dates'], reverse=True), 'les plus récentes d’abord')
            check(not any(i.startswith(('A1', 'A2', 'A3', 'B1', 'P-A')) for i in r['ids']), 'pas de Pocket')
            eq(sum(x['n'] for x in r['blocs']), r['n'], 'chaque série dans un bloc')
            for k in ['id', 'name', 'bloc', 'date', 'total', 'count', 'code', 'logo', 'logoLang', 'sym', 'legal', 'tag', 'dark']:
                check(k in r['keys'], f'champ {k}', r['keys'])
            check(r['meta'], 'metaSync')
            return f"{r['n']} séries, {len(r['blocs'])} blocs"

        def t_set_file():
            sid = 'sv03.5'
            f = jload(data_dir, 'sets', f'{sid}.json')
            before = len(srv.requests('data/'))
            r = pg.evaluate('''async (sid) => { const t = performance.now(); const s = await CAT.set(sid); await PR.ensure([sid]);
              const ms = performance.now() - t; const s2 = await CAT.set(sid);
              return { ms, n: s.cards.length, again: s === s2, first: s.cards[0], last: s.cards[s.cards.length - 1], meta: s.meta.id,
                       sync: CAT.cardSync(s.cards[3].id) === s.cards[3], card: (await CAT.card(s.cards[5].id)).id === s.cards[5].id,
                       none: await CAT.card(sid + '-99999') }; }''', sid)
            reqs = [x for x in srv.requests('data/')[before:]]
            eq(r['n'], len(f['cards']), 'nombre de cartes')
            check(r['again'], 'mémorisé')
            c0 = f['cards'][0]
            eq(r['first']['id'], f"{sid}-{c0['l']}", 'id')
            eq(sorted(r['first'].keys()), sorted(['id', 'localId', 'name', 'setId', 'image', 'rarity', 'category', 'dexId', 'finishes', 'setName', 'setTotal']),
               'forme brève (SPEC §5.2) + setName / setTotal')
            m = next(x for x in sets_json['sets'] if x['id'] == sid)
            eq((r['first']['setName'], r['first']['setTotal']), (m['name'], m['total']), 'nom et total imprimé de la série')
            if c0['i'] == 1:
                eq(r['first']['image'], f"https://assets.tcgdex.net/fr/{f['serie']}/{sid}/{c0['l']}", 'image FR dérivée')
            eq(r['first']['category'], {'P': 'Pokémon', 'D': 'Dresseur', 'E': 'Énergie'}[c0['c']], 'catégorie')
            check(r['sync'] and r['card'], 'cardSync / card')
            eq(r['none'], None, 'carte inconnue')
            static = [x for x in reqs if x.startswith('/data/')]
            check(len(static) <= 2, 'page série : ≤ 2 fichiers de données', static)
            return f"{r['n']} cartes, {len(static)} requêtes ({', '.join(static)}), {r['ms']:.0f} ms"

        def t_set_missing():
            r = pg.evaluate('''async () => { try { await CAT.set('zz-inexistante'); return 'ok'; } catch (e) { return e.kind || e.name; } }''')
            check(r in ('notfound', 'network', 'offline', 'server'), 'série inconnue : erreur typée', r)
            return r

        def t_set_live():
            if not ONLINE:
                raise Skip('--offline : réseau non demandé')
            # fichier statique absent -> TCGdex en direct (REST + GraphQL @locale vérifié)
            sid = '2013bw'
            srv.fail[f'data/sets/{sid}.json'] = 404
            q = fresh()
            try:
                r = q.evaluate('''async (sid) => { const t = performance.now(); const s = await CAT.set(sid);
                  const live = await TCG.setLive(sid);
                  return { ms: performance.now() - t, n: s.cards.length, live: !!s.live, french: live.french, names: s.cards.slice(0, 3).map(c => c.name),
                           fin: s.cards[0].finishes, rar: s.cards[0].rarity, cat: s.cards[0].category, meta: s.meta.id }; }''', sid)
            finally:
                del srv.fail[f'data/sets/{sid}.json']
            q.close()
            check(r['live'] and r['n'] >= 10, 'série chargée en direct', r)
            check(r['french'], '@locale(lang:"fr") vérifié (noms français)', r)
            eq(r['names'][:2], ['Phyllali', 'Pyroli'], 'noms FR (série française uniquement)')
            check(r['fin'] and r['cat'] == 'Pokémon', 'finitions et catégorie', r)
            return f"{r['n']} cartes en {r['ms']:.0f} ms"

        def t_live_card():
            if not ONLINE:
                raise Skip('--offline : réseau non demandé')
            r = pg.evaluate('''async () => { const t = performance.now();
              const c = await TCG.card('exu-%3F'); const c2 = await TCG.card('exu-%3F');
              const ctl = new AbortController(); const p = TCG.card('sv03.5-025', { signal: ctl.signal }); ctl.abort();
              let ab; try { await p; ab = 'ok'; } catch (e) { ab = e.name; }
              const s = await TCG.searchLive('Pikachu');
              return { id: c.id, same: c === c2, ab, ms: performance.now() - t, n: s.length, pocket: s.some(x => /^(A\\d|B\\d|P-A)/.test(x.setId)), shape: Object.keys(s[0] || {}).sort() }; }''')
            eq(r['id'], 'exu-%3F', 'id avec % (encodeURIComponent)')
            check(r['same'], 'mémorisé')
            eq(r['ab'], 'AbortError', 'annulation')
            check(r['n'] > 20 and not r['pocket'], 'recherche en direct sans Pocket', r)
            return f"{r['ms']:.0f} ms, {r['n']} résultats"

        # ---------- recherche ----------
        def t_search():
            r = pg.evaluate('''async () => { const out = {};
              for (const q of ['pikachu', 'PIKACHU', 'évoli', 'evoli', 'dracaufeu ex', 'MEW 25', 'mew025', '025/165', '25', '#25', '#448', 'zarbi', 'a', 'mega lucario', 'TG05/TG30', 'xyzxyzxyz',
                             'SWSH001', 'swsh001', 'TG05', 'GG01', 'H01', 'RC5', 'SV49', 'XY01', 'pikachu 25', 'pikachu 025', 'pikachu 025/165', 'dracaufeu ex 199', 'sma SV49', 'sv03.5-025', 'pikachu 9999']) {
                const t = performance.now(); const s = await CAT.search(q, { limit: 50 });
                out[q] = { ms: performance.now() - t, count: s.count, n: s.cards.length, sets: s.sets.map(x => x.id), ids: s.cards.map(c => c.id), names: s.cards.map(c => c.name),
                           shape: s.cards[0] ? Object.keys(s.cards[0]).sort() : [] };
              }
              return out; }''')
            if REAL_CAT:
                check('sv03.5-025' in r['MEW 25']['ids'] and r['MEW 25']['n'] == 1, 'code + numéro', r['MEW 25'])
                eq(r['mew025']['ids'], ['sv03.5-025'], 'code collé au numéro')
                check('sv03.5-025' in r['025/165']['ids'], 'numéro/total', r['025/165'])
                check(all(n.lower().startswith('pikachu') or 'pikachu' in n.lower() for n in r['pikachu']['names']), 'noms', r['pikachu']['names'][:10])
                eq(r['pikachu']['ids'], r['PIKACHU']['ids'], 'insensible à la casse')
                eq(r['évoli']['ids'], r['evoli']['ids'], 'insensible aux accents')
                check(r['évoli']['names'][0] == 'Évoli', 'nom exact d’abord', r['évoli']['names'][:5])
                check(all('dracaufeu' in n.lower() and 'ex' in n.lower() for n in r['dracaufeu ex']['names']), 'plusieurs mots', r['dracaufeu ex']['names'][:8])
                check(r['#25']['count'] >= 150, 'Pokédex #25', r['#25']['count'])
                check(any('Méga-Lucario' in n for n in r['#448']['names']), 'Pokédex #448 avec Méga-Évolution (dexId deviné)', r['#448']['names'][:8])
                check('exu' in r['zarbi']['sets'], 'séries trouvées par nom', r['zarbi']['sets'])
                check(r['TG05/TG30']['n'] >= 1, 'numéros TG', r['TG05/TG30'])
                check(r['mega lucario']['n'] >= 3, 'sans tiret ni accent', r['mega lucario'])
                for q, sid in [('SWSH001', 'swshp-SWSH001'), ('swsh001', 'swshp-SWSH001'), ('XY01', 'xyp-XY01')]:
                    check(r[q]['ids'][:1] == [sid], f'numéro imprimé {q} : {sid} d’abord', r[q]['ids'][:5])
                # SV49 (Destinées Occultes) et SV049 (Destinées Radieuses) sont deux numéros imprimés « SV49 »
                check(sorted(r['SV49']['ids'][:2]) == ['sma-SV49', 'swsh4.5sv-SV049'], 'numéro imprimé SV49 : les cartes SV d’abord', r['SV49']['ids'][:5])
                check('pl3-49' in r['SV49']['ids'], 'SV49 : puis la 49 de la série de code SV', r['SV49']['ids'][:5])
                for q in ['TG05', 'GG01', 'H01', 'RC5']:
                    check(r[q]['n'] >= 1 and all(i.split('-')[-1].upper().replace('0', '') == q.upper().replace('0', '') for i in r[q]['ids']),
                          f'numéro imprimé {q}', r[q]['ids'][:8])
                for q in ['pikachu 25', 'pikachu 025']:
                    check(r[q]['n'] >= 3 and all(n.lower().startswith('pikachu') for n in r[q]['names'])
                          and all(i.split('-')[-1].lstrip('0') == '25' for i in r[q]['ids']), f'nom + numéro « {q} »', r[q]['ids'][:8])
                check('sv03.5-025' in r['pikachu 025/165']['ids'][:3] and all(i.split('-')[-1].lstrip('0') == '25' for i in r['pikachu 025/165']['ids']),
                      'nom + numéro/total', r['pikachu 025/165']['ids'])
                check(r['dracaufeu ex 199']['ids'][:1] == ['sv03.5-199'], 'nom de plusieurs mots + numéro', r['dracaufeu ex 199']['ids'][:5])
                eq(r['sma SV49']['ids'][:1], ['sma-SV49'], 'id de série TCGdex + numéro')
                eq(r['sv03.5-025']['ids'], ['sv03.5-025'], 'id de carte complet')
                eq(r['pikachu 9999']['count'], 0, 'nom + numéro inconnu : rien')
                exact = [n for n in r['pikachu']['names'] if n == 'Pikachu']
                check(r['pikachu']['names'][:len(exact)] == exact, 'exact avant préfixe', r['pikachu']['names'][:12])
            eq(r['a']['n'], 0, 'moins de 2 lettres : pas de cartes')
            eq(r['xyzxyzxyz']['count'], 0, 'aucun résultat')
            eq(r['25']['n'], min(50, r['25']['count']), 'limite')
            check('partial' in r['pikachu']['shape'] or 'finishes' in r['pikachu']['shape'], 'forme brève', r['pikachu']['shape'])
            slow = max(v['ms'] for k, v in r.items() if k != 'pikachu')
            return f"première recherche {r['pikachu']['ms']:.0f} ms (index), ensuite ≤ {slow:.0f} ms ; pikachu {r['pikachu']['count']}, #25 {r['#25']['count']}"

        def t_search_cpu4():
            q = ctx.new_page()
            console_watch(q, errs, expected_404s() + WANTED)
            q.goto(srv.url + '__f2.html')
            cdp = ctx.new_cdp_session(q)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
            r = q.evaluate('''async () => {
              const [CAT, IMG] = await load('./js/data/catalog.js', './js/data/images.js'); await IMG.ready; await CAT.sets();
              await (await fetch('data/cards-index.json')).text();          // fichier déjà là : on mesure le calcul
              // longues tâches (> 50 ms) et images bloquées (long-animation-frame, > 50 ms) pendant la construction
              const lt = [], lf = [];
              const po = new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)); });
              po.observe({ type: 'longtask' });
              const po2 = new PerformanceObserver(l => { for (const e of l.getEntries()) lf.push(Math.round(e.duration)); });
              try { po2.observe({ type: 'long-animation-frame' }); } catch { /* navigateur sans LoAF */ }
              let t = performance.now(); const s1 = await CAT.search('pikachu'); const first = performance.now() - t;
              t = performance.now(); await CAT.search('dracaufeu'); const second = performance.now() - t;
              t = performance.now(); const d = await CAT.cardsOfDex(25); const dex = performance.now() - t;
              t = performance.now(); await CAT.search('pikachu 25'); const named = performance.now() - t;
              await new Promise(r => setTimeout(r, 100)); po.disconnect(); po2.disconnect();
              return { first, second, dex, named, lt, lf, n: s1.count };
            }''')
            cdp.detach()
            q.close()
            check(not r['lt'] and not r['lf'], 'aucune longue tâche ni image bloquée > 50 ms pendant la construction de l’index (CPU ×4)', r)
            check(r['second'] < 50 and r['dex'] < 50 and r['named'] < 50, 'recherches suivantes < 50 ms au processeur ×4', r)
            return (f"CPU ×4 : première recherche {r['first']:.0f} ms (index par tranches), ensuite {r['second']:.0f} ms, "
                    f"cardsOfDex {r['dex']:.0f} ms, nom + numéro {r['named']:.0f} ms, longues tâches {r['lt']}, LoAF {r['lf']}")

        def t_dex():
            r = pg.evaluate('''async () => { const list = await DEX.pokedex(); const g = s => DEX.guessDex(s);
              const t = performance.now(); const cards = await CAT.cardsOfDex(448); const ms = performance.now() - t;
              return { n: list.length, first: list[0], lucario: g('Méga-Lucario-ex'), duo: g('Méga-Ténéfix et Tyranocif'), mewtwo: g('Mewtwo-ex'),
                       mew: g('Mew'), mime: g('M. Mime'), nido: g('Nidoran ♀'), nido2: g('Nidoran♂'), trainer: g('Ordres du Boss'),
                       pz: g('Porygon-Z'), hooh: g('Ho-Oh-EX'), dexNums: DEX.dexNums({ name: 'Méga-Dracaufeu X-ex', category: 'Pokémon', dexId: [] }),
                       dexTrainer: DEX.dexNums({ name: 'Pikachu', category: 'Dresseur' }),
                       sprite: DEX.sprite(25), cards: cards.length, ms, names: cards.slice(0, 50).map(c => c.name) }; }''')
            eq(r['n'], 1025, 'Pokédex')
            eq(r['first'], {'n': 1, 'name': 'Bulbizarre'}, 'premier')
            eq(r['lucario'], [448], 'Méga-Lucario-ex')
            eq(r['duo'], [302, 248], 'carte duo')
            eq(r['mewtwo'], [150], 'Mewtwo avant Mew')
            eq(r['mew'], [151], 'Mew')
            eq(r['mime'], [122], 'M. Mime')
            eq(r['nido'], [29], 'Nidoran ♀ (espace)')
            eq(r['nido2'], [32], 'Nidoran♂')
            eq(r['trainer'], [], 'dresseur')
            eq(r['pz'], [474], 'Porygon-Z')
            eq(r['hooh'], [250], 'Ho-Oh-EX')
            eq(r['dexNums'], [6], 'dexNums devine')
            eq(r['dexTrainer'], [], 'dexNums ignore les dresseurs')
            check('@c0542f7c51215d9672439012838c99f520596cbd/' in r['sprite'], 'sprite épinglé', r['sprite'])
            check(r['cards'] >= (20 if REAL_CAT else 1), 'cartes de Lucario', r['cards'])
            return f"cardsOfDex(448) : {r['cards']} cartes en {r['ms']:.0f} ms"

        # ---------- images ----------
        TRICKY = ['exu-%3F', 'exu-!', 'tk-xy-latia-1', '30th-c-001', 'cel25cc-CC001', 'cel25cc-CC003', '30th-R', 'base3-1',
                  '2018sm-fr-5', '2018sm-fr-1', '2013bw-1', 'sv03.5-025']

        def t_images():
            r = pg.evaluate('''async (ids) => { const out = {};
              for (const id of ids) { const c = await CAT.card(id) || { id, image: '' };
                out[id] = { low: IMG.cardImg(c), high: IMG.cardImg(c, 'high'), badge: String(IMG.enBadge(c)), cap: IMG.imgCaption(c), html: String(IMG.imgHTML(c)) }; }
              // jamais d'id Scrydex hors liste « ok » : carte imaginaire d'une série reliée à Scrydex
              out.unverified = IMG.cardImg({ id: 'exu-ZZ', image: '' });
              out.unverified2 = IMG.cardImg({ id: 'mep-999', localId: '999', image: '' });
              out.tracker = String(IMG.imgHTML({ id: 'sv03.5-025', localId: '025', image: 'https://tracker.example/p?u=1' }));
              out.quote = String(IMG.imgHTML({ id: 'sv03.5-025', localId: '025', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/025" onerror="x' }));
              return out; }''', TRICKY)
            sx = 'https://images.scrydex.com/pokemon/'
            eq(r['exu-%3F']['low']['urls'], [sx + 'ex10-%3F/small'], 'Zarbi « ? » (id encodé)')
            eq(r['exu-%3F']['high']['urls'], [sx + 'ex10-%3F/large'], 'Zarbi « ? » grande')
            eq(r['exu-!']['low']['urls'], [sx + 'ex10-!/small'], 'Zarbi « ! »')
            eq(r['tk-xy-latia-1']['low']['urls'], [sx + 'tk8b-1/small'], 'kit Latias = tk8b')
            eq(r['30th-c-001']['low']['urls'], [sx + 'me55c-4/small'], '30th-c par la table id')
            eq(r['cel25cc-CC001']['low']['urls'][0].split('/')[-2].split('-')[0], 'cel25c', 'cel25cc')
            eq(r['cel25cc-CC003']['low']['urls'], [sx + 'cel25c-15_A1/small'], 'cel25cc CC003')
            eq(r['30th-R']['low']['urls'], [sx + 'me55-R/small'], '30th-R (fix)')
            check(r['base3-1']['low']['urls'][0].endswith('/base3/1/low.png') and len(r['base3-1']['low']['urls']) == 1, 'base3-1 : low.png directement', r['base3-1']['low'])
            check(r['base3-1']['high']['urls'][0].endswith('/high.webp'), 'base3-1 high en webp')
            eq(r['2018sm-fr-5']['low'], {'urls': [sx + 'mcd18-1/small'], 'en': True, 'same': False, 'ref': None}, 'McDonald’s : jumelle anglaise exacte')
            check('>EN<' in r['2018sm-fr-5']['badge'], 'pastille EN', r['2018sm-fr-5']['badge'])
            check(r['2018sm-fr-1']['low']['same'] and not r['2018sm-fr-1']['low']['en'] and r['2018sm-fr-1']['low']['urls'][0].startswith('https://assets.tcgdex.net/fr/'),
                  'McDonald’s : image FR de l’impression d’origine', r['2018sm-fr-1']['low'])
            check('≈' in r['2018sm-fr-1']['badge'] and 'Même illustration que' in r['2018sm-fr-1']['badge'], 'pastille ≈', r['2018sm-fr-1']['badge'])
            check(r['2018sm-fr-1']['cap'].startswith('Même illustration que '), 'légende', r['2018sm-fr-1']['cap'])
            eq(r['2013bw-1']['low']['urls'], [], 'sans image')
            check(r['2013bw-1']['html'].startswith('<span class="card-ph" role="img" aria-label="Pas d\'illustration">') and 'card-ph-no' in r['2013bw-1']['html']
                  and 'Phyllali' not in r['2013bw-1']['html'], 'vignette (jamais le nom)', r['2013bw-1']['html'])
            eq(r['2013bw-1']['badge'], '', 'pas de pastille')
            eq(r['sv03.5-025']['badge'], '', 'image FR : pas de pastille')
            h = r['sv03.5-025']['html']
            expect = ('<img class="card-img" crossorigin="anonymous" loading="lazy" decoding="async" width="245" height="337" alt="" '
                      'src="https://assets.tcgdex.net/fr/sv/sv03.5/025/low.webp" data-fb="https://assets.tcgdex.net/fr/sv/sv03.5/025/low.png" '
                      'data-ph-no="025/165" data-ph-sym="')
            check(h.startswith(expect) and h.endswith('">'), 'balisage exact', h)
            eq(r['unverified']['urls'], [], 'pas d’id Scrydex non vérifié (exu-ZZ)')
            eq(r['unverified2']['urls'], [], 'pas d’id Scrydex non vérifié (mep-999)')
            check('tracker.example' not in r['tracker'], 'image d’un autre hôte ignorée', r['tracker'])
            check('onerror="x' not in r['quote'], 'base d’image avec guillemet ignorée', r['quote'])
            check(all('card back' not in json.dumps(v) for v in r.values()), 'jamais de dos de carte')

        def t_fallback_dom():
            pg.route('https://assets.tcgdex.net/fr/zz/**', lambda route: route.fulfill(status=404, body='introuvable'))
            r = pg.evaluate('''async (base) => {
              IMG.installFallback(document);
              const box = document.getElementById('out');
              box.innerHTML = String(IMG.imgHTML({ id: 'zz-1', localId: '1', setTotal: 99, image: base + 'nope/zz' }, { cls: 'big' }))
                + String(IMG.imgHTML({ id: 'sv03.5-025', localId: '025', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/025' }, { eager: true, alt: 'Pikachu' }));
              const t0 = performance.now();
              while (!box.querySelector('.card-ph') && performance.now() - t0 < 5000) await new Promise(r => setTimeout(r, 50));
              const ph = box.querySelector('.card-ph');
              return { ph: ph && ph.outerHTML, imgs: box.querySelectorAll('img.card-img').length, eager: box.querySelector('img.card-img') && box.querySelector('img.card-img').outerHTML };
            }''', 'https://assets.tcgdex.net/fr/zz/')
            pg.unroute('https://assets.tcgdex.net/fr/zz/**')
            check(r['ph'] and 'card-ph big' in r['ph'] and '1/99' in r['ph'], 'chaîne de secours puis vignette (classe gardée)', r)
            check(r['eager'] and 'loading="eager"' in r['eager'] and 'fetchpriority="high"' in r['eager'] and 'alt="Pikachu"' in r['eager'], 'eager', r['eager'])

        def t_images_load():
            if not ONLINE:
                raise Skip('--offline : réseau non demandé')
            # les cas limites s'affichent vraiment (une requête par image, pas plus)
            r = pg.evaluate('''async (ids) => {
              IMG.installFallback(document);
              document.head.insertAdjacentHTML('beforeend', `<style>
                .card-img{display:block;width:100%;height:auto;aspect-ratio:245/337;object-fit:cover;border-radius:4px}
                .card-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;aspect-ratio:63/88;
                  border:1px solid #ccc;border-radius:4px;background:#f2f2f4;color:#555;font:12px sans-serif}
                .card-ph-sym{width:24px;height:24px;object-fit:contain}</style>`);
              const box = document.getElementById('out'); box.innerHTML = '';
              for (const id of ids) { const c = await CAT.card(id) || { id, image: '' };
                box.insertAdjacentHTML('beforeend', `<figure data-id="${id}" style="display:inline-block;width:120px;margin:4px;font:10px sans-serif">${IMG.imgHTML(c, { eager: true })}<figcaption>${id} ${IMG.enBadge(c)}</figcaption></figure>`); }
              const t0 = performance.now();
              const done = () => [...box.querySelectorAll('img.card-img')].every(i => i.complete);
              while (!done() && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100));
              return [...box.querySelectorAll('figure')].map(f => { const i = f.querySelector('img.card-img');
                return { id: f.dataset.id, w: i ? i.naturalWidth : 0, h: i ? i.naturalHeight : 0, src: i ? i.currentSrc : '', ph: !!f.querySelector('.card-ph') }; });
            }''', TRICKY)
            pg.set_viewport_size({'width': 1100, 'height': 900})
            shot = os.path.join(os.environ.get('F2_SHOTS', os.path.join(ROOT, '.cache', 'f2')), 'tricky_cards.png')
            os.makedirs(os.path.dirname(shot), exist_ok=True)
            pg.locator('#out').screenshot(path=shot)
            bad = [x for x in r if not x['ph'] and x['w'] < 100]
            check(not bad, 'images chargées', bad)
            ph = [x['id'] for x in r if x['ph']]
            eq(ph, ['2013bw-1'], 'seule la carte sans image a la vignette')
            # Le dos de carte Scrydex (identifiant inconnu) se charge comme une vraie image (même taille) : on le reconnaît
            # à son ETag (FINAL-images §2.5), par une requête HEAD par image Scrydex affichée (quelques-unes, pas plus).
            sx = sorted({x['src'] for x in r if 'images.scrydex.com' in x['src']})
            backs = [u for u in sx if scrydex_etag(u).startswith(SX_BACK)]
            check(not backs, 'pas de dos de carte Scrydex', backs)
            # contrôle du test lui-même : un identifiant inventé renvoie bien le dos de carte
            check(scrydex_etag('https://images.scrydex.com/pokemon/zz9-999/small').startswith(SX_BACK), 'ETag du dos de carte reconnu')
            return f"{len(r)} cartes, {len(sx)} images Scrydex vérifiées (ETag), capture {shot}"

        # ---------- cotes ----------
        def t_prices():
            pdir = PRICE_DIR if REAL_PRICES else os.path.join(FIX, 'market', 'prices')
            sid = 'sv03.5' if os.path.isfile(os.path.join(pdir, 'sv03.5.json')) else sorted(os.listdir(pdir))[0][:-5]
            f = jload(pdir, f'{sid}.json')
            lid, fins = next(iter(f['c'].items()))
            fin, arr = next(iter(fins.items()))
            r = pg.evaluate('''async ([sid, lid, fin]) => { const id = sid + '-' + lid; await PR.ensure([sid, sid, 'zz-none']);
              return { g: PR.get(id, fin), e: PR.eur(id, fin), c: PR.change(id, fin), d: PR.date(), has: PR.has('zz-none'), none: PR.get('zz-none-1', 'normal'),
                       other: PR.get(id, 'stamp'), unknown: PR.get(sid + '-99999', 'normal'), credit: PR.CREDIT }; }''', [sid, lid, fin])
            cents = lambda v: None if v is None or v <= 0 else round(v / 100, 2)
            t, a1, a7, a30, low = (cents(v) for v in arr)
            eq(r['g']['low'], low, 'low en euros')
            eq(r['g']['avg30'], a30, 'avg30')
            ref = a7 or a30
            sane = t is not None and (not ref or ref / 5 <= t <= ref * 5)
            eq(r['g']['eur'], t if sane else (a30 or a7 or a1), 'eur = tendance plausible sinon avg30')
            eq(r['e'], r['g']['eur'], 'eur()')
            eq(r['d'], f['d'], 'date du guide')
            check(r['has'] and r['none'] is None, 'série sans fichier : chargée, sans cote')
            if 'stamp' not in fins:
                eq(r['other'], None, 'finition sans cote : null (jamais la normale)')
            eq(r['unknown'], None, 'carte inconnue')
            check(r['credit'].startswith('Cotes Cardmarket'), 'crédit')
            if r['c'] and r['g']['avg30']:
                check(abs(r['c']['pct30'] - (r['g']['eur'] - r['g']['avg30']) / r['g']['avg30'] * 100) < 1e-6, 'pct30')
            return f"{sid}-{lid} {fin} : {r['g']}"

        def t_prices_all():
            # tous les fichiers de cotes : chaque entrée relue par get(), règles de forme vérifiées (centimes -> euros,
            # tendance plausible sinon avg30, finition absente = null), temps de chargement
            pdir = PRICE_DIR if REAL_PRICES else os.path.join(FIX, 'market', 'prices')
            files = {x[:-5]: jload(pdir, x) for x in sorted(os.listdir(pdir)) if x.endswith('.json')}
            q = fresh()
            r = q.evaluate('''async (files) => {
              const t = performance.now(); await PR.ensure(Object.keys(files)); const ms = performance.now() - t;
              const e2 = v => (typeof v === 'number' && v > 0 ? v / 100 : null);
              let n = 0, bad = [], absent = 0, sum = 0;
              for (const [sid, f] of Object.entries(files)) {
                for (const [lid, fins] of Object.entries(f.c)) {
                  const id = sid + '-' + lid;
                  for (const [fin, a] of Object.entries(fins)) {
                    n++;
                    const g = PR.get(id, fin), [t1, a1, a7, a30, low] = a.map(e2);
                    const ref = a7 ?? a30, sane = t1 != null && (!ref || (t1 >= ref / 5 && t1 <= ref * 5));
                    const want = sane ? t1 : (a30 ?? a7 ?? a1);
                    if (!g ? (want != null || low != null) : (Math.abs((g.eur ?? -1) - (want ?? -1)) > 1e-9 || g.low !== low)) bad.push([id, fin, a, g]);
                    if (g && g.eur != null) sum += g.eur;
                  }
                  for (const fin of ['stamp', 'masterball']) if (!fins[fin]) { absent++; if (PR.get(id, fin) !== null) bad.push([id, fin, 'absente', PR.get(id, fin)]); }
                }
              }
              return { ms, n, bad: bad.slice(0, 5), nbad: bad.length, absent, sum, date: PR.date() };
            }''', files)
            q.close()
            eq(r['nbad'], 0, 'chaque entrée relue selon les règles')
            return f"{len(files)} fichiers chargés en {r['ms']:.0f} ms, {r['n']} entrées, {r['absent']} finitions absentes = null, guide du {r['date']}"

        def t_prices_parallel():
            # ≤ 6 fichiers en parallèle : le serveur ralentit chaque réponse et compte les requêtes simultanées
            pdir = PRICE_DIR if REAL_PRICES else os.path.join(FIX, 'market', 'prices')
            ids = [x[:-5] for x in sorted(os.listdir(pdir)) if x.endswith('.json')][:14]
            ids += [f'zz-fake{i}' for i in range(14 - len(ids))]
            srv.delay['data/market/prices/'] = 0.3
            q = fresh()
            t0 = time.time()
            try:
                q.evaluate('async (ids) => { await PR.ensure(ids); }', ids)
            finally:
                del srv.delay['data/market/prices/']
            dt = time.time() - t0
            q.close()
            # 14 fichiers à 0,3 s, 6 à la fois : au moins 3 vagues (≥ 0,9 s), jamais tout d'un coup (≈ 0,3 s)
            check(dt >= 0.85, f'pas plus de 6 en parallèle ({dt:.2f} s pour 14 fichiers)')
            return f'14 fichiers en {dt:.2f} s'

        def t_cmfor():
            r = pg.evaluate('''() => {
              const cm = (o) => ({ idProduct: 1, ...o });
              const holoOnly = { variants: { holo: true }, pricing: { cardmarket: cm({ trend: 4634.17, avg7: 4500, avg30: 4400, 'trend-holo': 1299.43, low: 4000 }) } };
              const normalHolo = { variants: { normal: true, holo: true }, pricing: { cardmarket: cm({ trend: 1, avg30: 1, 'trend-holo': 5 }) } };
              const normalHoloSep = { variants: { normal: true, holo: true }, pricing: { cardmarket: cm({ trend: 1 }) },
                variants_detailed: [{ type: 'Normal' }, { type: 'Holo', pricing: { cardmarket: { idProduct: 2, trend: 7, avg30: 7 } } }] };
              const rev = { variants: { normal: true, reverse: true }, pricing: { cardmarket: cm({ trend: 0.23, 'trend-holo': 0.57, 'low-holo': 0.4 }) } };
              const revNone = { variants: { normal: true, reverse: true }, pricing: { cardmarket: cm({ trend: 0.23 }) } };
              const pb = { variants: { normal: true, reverse: true }, pricing: { cardmarket: cm({ trend: 0.25 }) },
                variants_detailed: [{ type: 'Normal' }, { type: 'Reverse' },
                  { type: 'Reverse', foil: 'Pokéball', pricing: { cardmarket: { idProduct: 806408, trend: 0.25, avg: null, 'avg-holo': 0.32 } } },
                  { type: 'Reverse', foil: 'Masterball', pricing: { cardmarket: { idProduct: 806409, trend: 0, 'trend-holo': 1.63, 'avg-holo': 2.02 } } }] };
              const pbNoProduct = { variants: { normal: true, reverse: true }, pricing: { cardmarket: cm({ trend: 0.25, 'trend-holo': 0.6 }) },
                variants_detailed: [{ type: 'Normal' }, { type: 'Reverse' }, { type: 'Reverse', foil: 'Pokéball' }] };
              const cosmos = { variants: { normal: true, holo: true }, pricing: { cardmarket: cm({ trend: 0.3 }) },
                variants_detailed: [{ type: 'Normal' }, { type: 'Holo', foil: 'Cosmos', pricing: { cardmarket: { idProduct: 791827, trend: 1.21, 'trend-holo': 0 } } }] };
              const broken = { variants: { holo: true }, pricing: { cardmarket: cm({ trend: 0.02, avg7: 19.83, avg30: 84.26 }) } };
              const L = (c, f) => { const p = PR.liveSync(c, f); return p && p.eur; };
              return { holoOnly: L(holoOnly, 'holo'), normalHolo: L(normalHolo, 'holo'), normalHoloSep: L(normalHoloSep, 'holo'),
                       rev: L(rev, 'reverse'), revNone: L(revNone, 'reverse'), revLow: PR.liveSync(rev, 'reverse').low,
                       pb: L(pb, 'pokeball'), mb: L(pb, 'masterball'), pbNoProduct: L(pbNoProduct, 'pokeball'), cosmos: L(cosmos, 'cosmos'),
                       broken: L(broken, 'holo'), noCosmos: L(rev, 'cosmos'), first: L(holoOnly, 'firstEdition'), normal: L(rev, 'normal') };
            }''')
            eq(r['holoOnly'], 4634.17, 'holo seule : champs de base (pas trend-holo)')
            eq(r['normalHolo'], None, 'normale + holo sans produit séparé : pas de cote holo')
            eq(r['normalHoloSep'], 7, 'holo en produit séparé')
            eq(r['rev'], 0.57, 'reverse : champs -holo')
            eq(r['revLow'], 0.4, 'reverse : low-holo')
            eq(r['revNone'], None, 'reverse sans cote : null (jamais la normale)')
            eq(r['pb'], 0.32, 'Poké Ball : produit séparé, -holo')
            eq(r['mb'], 1.63, 'Master Ball : produit séparé, -holo')
            eq(r['pbNoProduct'], None, 'Poké Ball sans produit : pas la cote reverse')
            eq(r['cosmos'], 1.21, 'Cosmos holo : champs de base du produit séparé')
            eq(r['broken'], 84.26, 'tendance cassée -> avg30')
            eq(r['noCosmos'], None, 'finition absente')
            eq(r['normal'], 0.23, 'normale')

        # ---------- envies (script classique) ----------
        def t_wishes():
            pdir = PRICE_DIR if REAL_PRICES else os.path.join(FIX, 'market', 'prices')
            sid = 'sv03.5' if os.path.isfile(os.path.join(pdir, 'sv03.5.json')) else sorted(os.listdir(pdir))[0][:-5]
            f = jload(pdir, f'{sid}.json')
            lid, fin, arr = next((l, k, v) for l, fs in f['c'].items() for k, v in fs.items() if v[4])
            low = arr[4] / 100
            r = pg.evaluate('''async ([sid, lid, fin, low]) => {
              const W = window.WishDB;
              for (const w of await W.all()) await W.del(w.key);
              let changes = 0; const off = W.on(() => changes++);
              const card = { id: sid + '-' + lid, name: 'Test', setName: 'Série', localId: lid };
              const w = W.make(card, fin, { min: 0, max: low + 1 });
              await W.put(w);
              const p = await W.priceFor(w);
              const h1 = await W.check();
              const h2 = await W.check();                        // déjà dans la fourchette : pas de nouvelle alerte
              const a = (await W.all())[0];
              a.max = low / 2; await W.put(a);
              const h3 = await W.check();                        // sort de la fourchette
              const b = (await W.all())[0];
              b.max = low + 1; await W.put(b);
              const h4 = await W.check();                        // y revient : nouvelle alerte
              // ancienne envie v1 « holo » (= Reverse / Holo) sur une carte qui a une reverse
              await W.put({ key: 'sv03.5-025|holo', id: 'sv03.5-025', variant: 'holo', min: 0, max: 100, name: 'Pikachu', setName: '151', localId: '025', image: '', createdAt: 1 });
              // ancienne « normale » d'une carte holo seulement (champs de base = la holo) : finition « holo »
              await W.put({ key: 'sv03.5-006|normal', id: 'sv03.5-006', variant: 'normal', min: 0, max: 100, name: 'Dracaufeu-ex', setName: '151', localId: '006', image: '', createdAt: 1 });
              await W.check({ minAge: 0 });
              const keys = (await W.all()).map(x => x.key).sort();
              off();
              return { p, h1: h1.length, h2: h2.length, h3: h3.length, inRange3: b.inRange, h4: h4.length, keys, changes,
                       entry: Object.keys((await W.all())[0]).sort(), status: await W.alertStatus() };
            }''', [sid, lid, fin, low])
            eq(round(r['p']['low'], 2), round(low, 2), 'prix « low » du fichier de cotes')
            eq(r['p']['source'], 'cardmarket', 'source')
            eq([r['h1'], r['h2'], r['h3'], r['h4']], [1, 0, 0, 1], 'alerte à l’entrée dans la fourchette seulement')
            check(not r['inRange3'], 'hors fourchette')
            check('sv03.5-025|reverse' in r['keys'] and 'sv03.5-025|holo' not in r['keys'], 'migration « holo » v1 -> « reverse »', r['keys'])
            check('sv03.5-006|holo' in r['keys'] and 'sv03.5-006|normal' not in r['keys'], 'migration « normal » v1 d’une carte holo seulement -> « holo »', r['keys'])
            check(r['changes'] >= 5, 'abonnement on()', r['changes'])
            for k in ['key', 'id', 'name', 'setName', 'setId', 'localId', 'image', 'variant', 'min', 'max', 'low', 'trend', 'checkedAt', 'inRange']:
                check(k in r['entry'], f'champ {k}', r['entry'])
            check(r['status']['perm'] in ('default', 'denied', 'granted') and r['status']['background'] is False,
                  'alertStatus (pas de service worker ici : pas de vérification en arrière-plan)', r['status'])

        def t_wishes_fallback():
            if not ONLINE:
                raise Skip('--offline : réseau non demandé')
            # pas de fichier de cotes pour cette série : TCGdex en direct avec cmFor
            r = pg.evaluate('''async () => { const W = window.WishDB;
              const w = W.make({ id: 'swsh12-139', name: 'Lugia VSTAR', setName: 'Tempête Argentée', localId: '139' }, 'normal', { max: 1000 });
              w.setId = 'zz-noprices';                            // force l'absence de fichier
              const p = await W.priceFor({ ...w, id: 'swsh12-139' });
              return p; }''')
            check(r['source'] in ('tcgdex', 'cardmarket') and (r['low'] or r['trend']), 'secours TCGdex', r)
            return f"{r}"

        def t_wishes_rate():
            hits = []
            first = {}

            def api(route):
                url = route.request.url
                hits.append((time.time(), url))
                wid = url.rsplit('/', 1)[-1]
                if wid in ('zz-rl-1', 'zz-rl-2') and not first.get(wid):
                    first[wid] = True
                    return route.fulfill(status=503 if wid == 'zz-rl-1' else 429, body='{"error":"busy"}',
                                         headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'})
                body = {'id': wid, 'variants': {'normal': True},
                        'pricing': {'cardmarket': {'idProduct': 1, 'trend': 2, 'avg7': 2, 'avg30': 2, 'low': 1.5}}}
                return route.fulfill(status=200, body=json.dumps(body), headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'})
            pg.route('https://api.tcgdex.net/v2/fr/cards/zz-rl-*', api)
            try:
                r = pg.evaluate('''async () => { const W = window.WishDB;
                  for (const w of await W.all()) await W.del(w.key);
                  for (let i = 1; i <= 8; i++) await W.put(W.make({ id: 'zz-rl-' + i, name: 'Test ' + i, localId: String(i) }, 'normal', { max: 10 }));
                  const t = performance.now(); const hits = await W.check(); const ms = performance.now() - t;
                  const all = await W.all();
                  for (const w of all) await W.del(w.key);
                  return { ms, hits: hits.length, low: all.map(w => w.low) }; }''')
            finally:
                pg.unroute('https://api.tcgdex.net/v2/fr/cards/zz-rl-*')
            times = sorted(t for t, _ in hits)
            gaps = [b - a for a, b in zip(times, times[1:])]
            eq(len(hits), 10, '8 envies + 2 nouveaux essais')
            check(min(gaps) >= 0.2, f'au plus 4 requêtes par seconde (écart minimal {min(gaps) * 1000:.0f} ms)', [round(g, 3) for g in gaps])
            retry = {u.rsplit('/', 1)[-1]: [t for t, x in hits if x == u] for _, u in hits if u.endswith(('zz-rl-1', 'zz-rl-2'))}
            check(all(len(v) == 2 and v[1] - v[0] >= 1.4 for v in retry.values()), 'nouvel essai après 1,5 s sur 503 et 429', retry)
            eq(r['low'], [1.5] * 8, 'toutes les envies cotées (nouvel essai réussi)')
            return f"10 requêtes en {r['ms'] / 1000:.1f} s, écart minimal {min(gaps) * 1000:.0f} ms"

        for name, fn in [('net : délais, erreurs typées, annulation, cached(), data()', t_net),
                         ('net : manifest et ?h=', t_net_manifest),
                         ('catalogue : sets()', t_sets),
                         ('catalogue : set() depuis le fichier statique', t_set_file),
                         ('catalogue : série inconnue', t_set_missing),
                         ('catalogue : série en direct (fichier absent)', t_set_live),
                         ('tcgdex : fiche, annulation, recherche en direct', t_live_card),
                         ('recherche', t_search),
                         ('recherche : index par tranches (CPU ×4)', t_search_cpu4),
                         ('Pokédex et cardsOfDex', t_dex),
                         ('images : résolveur (cas limites)', t_images),
                         ('images : chaîne de secours dans le DOM', t_fallback_dom),
                         ('images : affichage réel des cas limites', t_images_load),
                         ('cotes : fichier par série', t_prices),
                         ('cotes : toutes les entrées de tous les fichiers', t_prices_all),
                         ('cotes : 6 fichiers en parallèle au plus', t_prices_parallel),
                         ('cotes en direct : cmFor (holo, reverse, Poké Ball, Master Ball, Cosmos)', t_cmfor),
                         ('envies : prix, alertes, migration v1', t_wishes),
                         ('envies : secours TCGdex', t_wishes_fallback),
                         ('envies : TCGdex au plus 4/s, nouvel essai sur 429 / 503', t_wishes_rate)]:
            R.run(name, fn)
        R.run('aucune erreur de console', lambda: check(not errs, 'erreurs', errs))
        b.close()
    srv.close()
    return R.done()


if __name__ == '__main__':
    sys.exit(main())
