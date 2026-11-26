"""Tests de la collection v2 et des préférences (F2) dans Chromium (Playwright).

    python -P tools/tests/store_test.py

Migration v1 -> v2 (tools/sample_collection.json), validation de l'import (dont la charge d'injection HTML par les clés
de finition), quota plein, JSON illisible sauvegardé, deux pages + événement 'storage', événements groupés,
données dérivées mémorisées, cotes (finition sans cote = —), scellé et suivis, export/import, préférences.
Port 8772 ; les fichiers de données viennent de tools/tests/f2/fixtures/data (pas de manifest).
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'f2'))
from kit import ROOT, FIX, PORT, HARNESS, serve, Runner, check, eq, console_watch, expected_404s  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

KEY = 'cardex.collection.v1'
SAMPLE = open(os.path.join(ROOT, 'tools', 'sample_collection.json'), encoding='utf8').read()
COL = './js/state/collection.js'

# Charge d'injection (FINAL-perf §3.2) : clés de finition et identifiants piégés, quantités absurdes, champs inconnus
EVIL = {
    'version': 1,
    'cards': {
        'sv03.5-025': {'id': 'sv03.5-025', 'name': 'Pikachu', 'setId': 'sv03.5',
                       'qty': {'normal': 5, 'normal" onmouseover="window.pwned=1': 3,
                               '<img src=x onerror="window.pwned=2">': 2, 'reverse': '2', 'holo': 2.5, 'cosmos': -1,
                               'pokeball': 1000, 'masterball': 'NaN', '__proto__': 4},
                       'image': 'javascript:window.pwned=3', 'prices': {'normal': 999}, 'evil': '<script>1</script>'},
        'x"><img src=x onerror="window.pwned=4">-1': {'id': 'x"><img src=x onerror="window.pwned=4">-1', 'qty': {'normal': 1}},
        'sv03.5-001': {'id': 'sv03.5-001', 'qty': {'normal': 1}, 'name': 'A' * 201, 'rarity': '<b>rare</b>'},
        'sv03.5-150': {'id': 'sv03.5-150', 'qty': {}},
        'exu-!': {'id': 'exu-!', 'qty': {'holo': 1}, 'name': 'Zarbi'},
        'exu-%3F': {'id': 'exu-%3F', 'qty': {'holo': 1}, 'name': 'Zarbi'},
        'bad-id': {'id': 'sv03.5-999"', 'qty': {'normal': 1}},
    },
    'sealed': {'__proto__': {'qty': 1}, '719691': {'id': 719691, 'qty': 2, 'cost': 49.9, 'at': '2026-01-02'},
               'x<y': {'qty': 1}, '5402': {'qty': 0}},
    'watch': [719691, '719691', '<img>', 'abc-1', {'x': 1}],
}


def page_with(ctx, srv, ls=None, before=''):
    """Nouvelle page de test ; ls = contenu de la clé de la collection (None : stockage vidé)."""
    pg = ctx.new_page()
    errs = []
    console_watch(pg, errs, expected_404s())
    pg.goto(srv.url + '__f2.html')
    pg.evaluate('([k, v]) => { localStorage.clear(); if (v !== null) localStorage.setItem(k, v); }', [KEY, ls])
    if before:
        pg.evaluate(before)
    pg.evaluate(f'async () => {{ window.C = (await load("{COL}"))[0]; }}')
    pg.errs = errs
    return pg


def main():
    srv = serve(ROOT, PORT, overlays={'data/': FIX}, pages={'__f2.html': HARNESS})
    srv.fail['data/manifest.json'] = 404
    R = Runner('store_test')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(locale='fr-FR')

        def t_migration():
            pg = page_with(ctx, srv, SAMPLE)
            r = pg.evaluate('''async () => {
              const v1 = JSON.parse(localStorage.getItem('cardex.collection.v1'));
              const copy = JSON.stringify(v1);
              const m1 = C.migrate(v1), m2 = C.migrate(v1);
              const all = C.all();
              const stored0 = localStorage.getItem('cardex.collection.v1');
              C.add(all[0], 'normal');                       // une modification : écrit le v2
              await Promise.resolve(); await new Promise(r => setTimeout(r));
              const saved = JSON.parse(localStorage.getItem('cardex.collection.v1'));
              return { n: all.length, pure: JSON.stringify(v1) === copy, same: JSON.stringify(m1) === JSON.stringify(m2),
                       v: m1.v, anyPrices: all.some(r => 'prices' in r), keys: Object.keys(all[0]).sort(),
                       untouchedBeforeChange: stored0 === copy || JSON.parse(stored0).version === 1,
                       savedV: saved.v, savedHasPrices: Object.values(saved.cards).some(r => 'prices' in r),
                       savedHasVersion: 'version' in saved, total: C.stats().total, unique: C.stats().unique,
                       sets: C.stats().sets, mewtwo: C.qtyOf('sv03.5-150', 'holo'), ev: C.qtyOf('sv03.5-133'),
                       bytesV1: copy.length, bytesV2: JSON.stringify(saved).length };
            }''')
            eq(r['n'], 24, 'cartes migrées')
            check(r['pure'], 'migrate() ne doit pas modifier son entrée')
            check(r['same'], 'migrate() est déterministe')
            eq(r['v'], 2, 'schéma')
            check(not r['anyPrices'], 'les prix v1 doivent disparaître')
            eq(r['keys'], sorted(['id', 'qty', 'addedAt', 'name', 'localId', 'setId', 'setName', 'setTotal', 'image', 'rarity', 'category', 'dexId']), 'champs gardés')
            check(r['untouchedBeforeChange'], 'le chargement ne réécrit pas le stockage')
            eq(r['savedV'], 2, 'v2 écrit')
            check(not r['savedHasPrices'] and not r['savedHasVersion'], 'v2 sans prix ni "version"')
            eq(r['mewtwo'], 1, 'qty holo')
            eq(r['ev'], 3, 'qty totale')
            check(not pg.errs, 'erreurs', pg.errs)
            pg.close()
            return f"24 cartes, {r['bytesV1']} → {r['bytesV2']} octets, total {r['total']}, {r['sets']} séries"

        def t_import_validation():
            pg = page_with(ctx, srv, None)
            r = pg.evaluate('''async (evil) => {
              const res = C.importText(JSON.stringify(evil));
              await new Promise(r => setTimeout(r));
              const all = C.all();
              // gabarit naïf de l'ancienne appli : data-finish="${f}" et class="fb-${f}" sans échappement
              const box = document.createElement('div');
              box.innerHTML = all.map(r => Object.keys(r.qty).map(f =>
                `<div class="tile fb-${f}" data-finish="${f}" data-card="${r.id}"><img src="${r.image}" alt=""></div>`).join('')).join('');
              document.body.append(box);
              await new Promise(r => setTimeout(r, 50));
              const pika = C.get('sv03.5-025');
              return { res, ids: all.map(r => r.id).sort(), pikaQty: pika && pika.qty, pikaImg: pika && pika.image,
                       pikaKeys: pika && Object.keys(pika).sort(), injected: box.querySelectorAll('img[onerror], [onmouseover]').length,
                       imgs: box.querySelectorAll('img').length, pwned: window.pwned || 0,
                       longName: C.get('sv03.5-001') && C.get('sv03.5-001').name, rarity: C.get('sv03.5-001') && C.get('sv03.5-001').rarity,
                       legacy: C.legacySealed(), sealedV2: C.sealedAll(), proto: Object.getPrototypeOf(C._debug.data().sealed) === Object.prototype,
                       polluted: ({}).qty };
            }''', EVIL)
            # la même charge en v2 : scellé Cardmarket directement
            r2 = pg.evaluate('''async (evil) => { C.clearAll(); await new Promise(r => setTimeout(r));
              const res = C.importText(JSON.stringify({ ...evil, version: undefined, v: 2 }));
              return { res, sealed: C.sealedAll(), watch: C.watchList(), legacy: C.legacySealed() }; }''', EVIL)
            eq(r['ids'], ['exu-!', 'exu-%3F', 'sv03.5-001', 'sv03.5-025'], 'identifiants acceptés')
            eq(r['pikaQty'], {'normal': 5, 'reverse': 2}, 'finitions valides seulement (2 accepté, 2.5/-1/1000/NaN refusés)')
            eq(r['pikaImg'], '', 'URL javascript: refusée')
            check('prices' not in r['pikaKeys'] and 'evil' not in r['pikaKeys'], 'champs inconnus retirés', r['pikaKeys'])
            eq(r['injected'], 0, 'aucun attribut injecté')
            eq(r['pwned'], 0, 'aucun script exécuté')
            eq(r['longName'], '', 'texte > 200 caractères refusé')
            eq(r['rarity'], '<b>rare</b>', 'texte court gardé tel quel (échappé à l’affichage)')
            eq(sorted(str(s['id']) for s in r['legacy']['sealed']), ['719691'], 'v1 : scellé valide seulement, gardé à part (ids TCGplayer)')
            eq(r['legacy']['watch'], [719691, 'abc-1'], 'v1 : suivis valides, sans doublon, gardés à part')
            eq(r['sealedV2'], [], 'v1 : rien dans le scellé Cardmarket')
            eq(sorted(str(s['id']) for s in r2['sealed']), ['719691'], 'v2 : scellé valide seulement')
            eq(r2['watch'], [719691, 'abc-1'], 'v2 : suivis valides, sans doublon')
            eq(r2['legacy'], {'sealed': [], 'watch': []}, 'v2 : rien de côté')
            check(r['proto'] and r['polluted'] is None, 'pas de pollution de prototype')
            eq(r['res']['cards'], 4, 'nouvelles cartes')
            check(r['res']['skipped'] >= 4, 'enregistrements rejetés comptés', r['res'])
            check(not pg.errs, 'erreurs', pg.errs)
            # fichier illisible ou étranger
            e = pg.evaluate('''() => { const out = [];
              for (const t of ['{pas du json', '[]', '{"a":1}', 'null']) { try { C.importText(t); out.push('ok'); } catch (e) { out.push(e.message); } }
              return out; }''')
            check(all(x != 'ok' for x in e), 'fichiers invalides refusés', e)
            pg.close()
            return f"{r['res']}"

        def t_merge():
            pg = page_with(ctx, srv, SAMPLE)
            r = pg.evaluate('''async () => {
              const back = C.exportText();
              C.setQty(C.get('sv03.5-025'), 'normal', 1);      // 2 -> 1
              C.setQty({ id: 'sv03.5-007' }, 'normal', 0);       // retirée
              await new Promise(r => setTimeout(r));
              const res = C.importText(back);
              await new Promise(r => setTimeout(r));
              return { res, pika: C.qtyOf('sv03.5-025', 'normal'), cara: C.qtyOf('sv03.5-007'), n: C.all().length,
                       meta: C.get('sv03.5-007') && C.get('sv03.5-007').name };
            }''')
            eq(r['pika'], 2, 'fusion : la plus grande quantité')
            eq(r['cara'], 1, 'carte retirée revenue')
            eq(r['meta'], 'Carapuce', 'infos gardées')
            eq(r['n'], 24, 'aller-retour export/import')
            pg.close()
            return f"{r['res']}"

        def t_quota():
            pg = page_with(ctx, srv, SAMPLE, before='''() => {
              const orig = Storage.prototype.setItem;
              window.full = false; window.writes = 0; window.storageEvents = [];
              addEventListener('cardex:storage', e => window.storageEvents.push(e.detail));
              Storage.prototype.setItem = function (k, v) {
                if (k === 'cardex.collection.v1') window.writes++;
                if (window.full && k.startsWith('cardex.collection')) throw new DOMException('plein', 'QuotaExceededError');
                return orig.call(this, k, v);
              };
              localStorage.setItem('cardex.sets.cache', 'x'.repeat(1000));
              localStorage.setItem('cardex.fin.sv02', '{}');
              localStorage.setItem('cardex.prefs.v1', '{"theme":"dark"}');
            }''')
            r = pg.evaluate('''async () => {
              window.full = true;
              let threw = null;
              try { C.add({ id: 'sv03.5-025', name: 'Pikachu' }, 'normal'); } catch (e) { threw = String(e); }
              await new Promise(r => setTimeout(r));
              const st = C.storageState();
              const mem = C.qtyOf('sv03.5-025', 'normal');
              const caches = [localStorage.getItem('cardex.sets.cache'), localStorage.getItem('cardex.fin.sv02')];
              const prefs = localStorage.getItem('cardex.prefs.v1');
              const stored = JSON.parse(localStorage.getItem('cardex.collection.v1')).cards['sv03.5-025'].qty.normal;
              window.full = false;
              C.add({ id: 'sv03.5-025' }, 'normal');
              await new Promise(r => setTimeout(r));
              const after = JSON.parse(localStorage.getItem('cardex.collection.v1')).cards['sv03.5-025'].qty.normal;
              return { threw, st, mem, caches, prefs, stored, after, st2: C.storageState(), events: window.storageEvents };
            }''')
            check(r['threw'] is None, 'setQty ne doit pas lever d’exception', r['threw'])
            eq(r['mem'], 3, 'état en mémoire à jour malgré le quota')
            eq(r['st']['error'], 'quota', 'erreur signalée')
            eq(r['caches'], [None, None], 'caches évincés')
            eq(r['prefs'], '{"theme":"dark"}', 'préférences gardées')
            eq(r['stored'], 2, 'ancienne sauvegarde intacte')
            eq(r['after'], 4, 'sauvegarde reprise quand il y a de la place')
            eq(r['st2']['error'], None, 'erreur effacée')
            check(any(e.get('error') == 'quota' for e in r['events']), 'événement cardex:storage', r['events'])
            pg.close()

        def t_corrupt():
            pg = page_with(ctx, srv, '{"cards": {"sv03.5-025": tronqué')
            r = pg.evaluate('''async () => {
              const keys = Object.keys(localStorage).filter(k => k.startsWith('cardex.collection.v1.corrupt.'));
              const st = C.storageState();
              C.add({ id: 'sv03.5-001', name: 'Bulbizarre' }, 'normal');
              await new Promise(r => setTimeout(r));
              return { keys, raw: keys.length ? localStorage.getItem(keys[0]) : null, st, n: C.all().length,
                       saved: JSON.parse(localStorage.getItem('cardex.collection.v1')).v };
            }''')
            eq(len(r['keys']), 1, 'copie de secours')
            eq(r['raw'], '{"cards": {"sv03.5-025": tronqué', 'texte illisible conservé')
            check(r['st']['corrupt'] == r['keys'][0], 'clé signalée', r['st'])
            eq(r['saved'], 2, 'nouvelle collection enregistrée après la copie')
            pg.close()
            # pas de place pour la copie : lecture seule, rien n'est écrasé
            pg = page_with(ctx, srv, '{illisible', before='''() => {
              const orig = Storage.prototype.setItem;
              Storage.prototype.setItem = function (k, v) {
                if (k.includes('.corrupt.')) throw new DOMException('plein', 'QuotaExceededError');
                return orig.call(this, k, v);
              };
            }''')
            r = pg.evaluate('''async () => {
              C.add({ id: 'sv03.5-001' }, 'normal');
              await new Promise(r => setTimeout(r));
              return { st: C.storageState(), raw: localStorage.getItem('cardex.collection.v1'), text: C.corruptText() };
            }''')
            check(r['st']['readOnly'], 'lecture seule', r['st'])
            eq(r['raw'], '{illisible', 'données d’origine intactes')
            eq(r['text'], '{illisible', 'texte disponible pour téléchargement')
            pg.close()

        def t_two_pages():
            a = page_with(ctx, srv, SAMPLE)
            a.evaluate('() => { window.evs = []; C.on(e => window.evs.push(...e)); }')
            bpg = ctx.new_page()
            errs = []
            console_watch(bpg, errs, expected_404s())
            bpg.goto(srv.url + '__f2.html')
            bpg.evaluate(f'async () => {{ window.C = (await load("{COL}"))[0]; window.evs = []; C.on(e => window.evs.push(...e)); }}')
            a.evaluate('''async () => { C.add({ id: 'sv03.5-025', name: 'Pikachu' }, 'normal', 2);
                                        C.setQty({ id: 'me06-060', name: 'Ténéfix', setName: 'Règne Delta' }, 'pokeball', 1); }''')
            bpg.wait_for_function('() => window.evs.some(e => e.type === "reload")', timeout=5000)
            r = bpg.evaluate('''async () => ({ q: C.qtyOf('sv03.5-025', 'normal'), t: C.qtyOf('me06-060', 'pokeball'), evs: window.evs.map(e => e.type) })''')
            eq(r['q'], 4, 'autre onglet : quantité relue')
            eq(r['t'], 1, 'autre onglet : nouvelle carte')
            a.evaluate('() => { window.evs.length = 0; }')
            bpg.evaluate('''async () => { C.add({ id: 'sv03.5-004' }, 'normal'); }''')
            a.wait_for_function('() => window.evs.some(e => e.type === "reload")', timeout=5000)
            r2 = a.evaluate('() => ({ q: C.qtyOf("sv03.5-004", "normal"), t: C.qtyOf("me06-060"), p: C.qtyOf("sv03.5-025", "normal") })')
            eq(r2, {'q': 1, 't': 2, 'p': 4}, 'retour vers le premier onglet, sans perte')
            check(not errs and not a.errs, 'erreurs', errs, a.errs)
            a.close(); bpg.close()

        def t_events():
            pg = page_with(ctx, srv, None, before='''() => {
              const orig = Storage.prototype.setItem; window.writes = 0;
              Storage.prototype.setItem = function (k, v) { if (k === 'cardex.collection.v1') window.writes++; return orig.call(this, k, v); };
            }''')
            r = pg.evaluate('''async () => {
              const calls = [];
              const off = C.on(evs => calls.push(evs));
              const r0 = C.rev();
              const pika = { id: 'sv03.5-025', localId: '025', name: 'Pikachu', setId: 'sv03.5', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/025', rarity: 'Commune', category: 'Pokémon', dexId: [25], finishes: ['normal', 'reverse'] };
              C.add(pika, 'normal');
              C.add(pika, 'reverse', 2);
              C.setQty(pika, 'normal', 0);
              const syncCalls = calls.length;
              await Promise.resolve();
              const afterMicro = calls.length;
              C.setQty(pika, 'reverse', 0);
              C.setQty(pika, 'reverse', 0);               // sans effet : pas d'événement
              await new Promise(r => setTimeout(r));
              off();
              C.add(pika, 'normal');
              await new Promise(r => setTimeout(r));
              return { syncCalls, afterMicro, calls, rev: C.rev() - r0, writes: window.writes, after: calls.length };
            }''')
            eq(r['syncCalls'], 0, 'rien de synchrone')
            eq(r['afterMicro'], 1, 'un seul appel par microtâche')
            evs = r['calls'][0]
            eq([(e['finish'], e['before'], e['after'], e['added'], e['removed']) for e in evs],
               [('normal', 0, 1, True, False), ('reverse', 0, 2, False, False), ('normal', 1, 0, False, False)], 'événements du lot')
            eq([(e['finish'], e['after'], e['removed']) for e in r['calls'][1]], [('reverse', 0, True)], 'dernier exemplaire retiré')
            eq(len(r['calls']), 2, 'désabonnement')
            eq(r['rev'], 5, 'rev incrémenté à chaque changement')
            eq(r['writes'], 3, 'une écriture par lot (3 lots)')

        def t_derived():
            pg = page_with(ctx, srv, SAMPLE)
            r = pg.evaluate('''async () => {
              const a = C.ownedBySet(), b = C.ownedBySet(), s1 = C.stats();
              const dex1 = C.ownedByDex(), names = C.ownedByName();
              C.add({ id: 'sv03.5-007' }, 'normal');
              const c = C.ownedBySet();
              await new Promise(r => setTimeout(r));
              return { same: a === b, changed: a !== c, mew: a.get('sv03.5'), dex6: dex1.get(6), dex25: dex1.get(25), dex3: dex1.get(3),
                       dex495: dex1.get(495), name: names.get('dracaufeu-ex'), evoli: names.get('evoli'), s1 };
            }''')
            check(r['same'] and r['changed'], 'mémo par révision', r)
            eq(r['mew'], 8, 'cartes distinctes de 151')
            eq(r['dex6'], 4, 'Dracaufeu (4 cartes distinctes)')
            eq(r['dex3'], 2, 'Florizarre : carte duo comptée')
            eq(r['dex495'], 1, 'Vipélierre (duo)')
            eq(r['name'], 3, 'ownedByName : exemplaires par nom normalisé (006 ×2 + 199)')
            eq(r['evoli'], 3, 'ownedByName sans accents')
            pg.close()

        def t_prices():
            pg = page_with(ctx, srv, SAMPLE)
            r = pg.evaluate('''async () => {
              const before = C.stats();
              await C.ensurePrices();
              const s = C.stats();
              return { before, s, v025: C.value(C.get('sv03.5-025')), v150: C.value(C.get('sv03.5-150')),
                       v004: C.value(C.get('sv03.5-004')), v007: C.value(C.get('sv03.5-007')), v060: C.value(C.get('me06-060')) };
            }''')
            check(r['before']['pending'] == r['before']['total'] and r['before']['value'] == 0, 'avant chargement : tout en attente', r['before'])
            eq(r['v025'], 0.46, 'Pikachu ×2 normale')
            eq(r['v150'], 84.26, 'Mewtwo holo : tendance cassée → avg30')
            eq(r['v004'], 0.35, 'Salamèche reverse')
            eq(r['v007'], None, 'Carapuce sans cote : null (jamais un autre prix)')
            s = r['s']
            # 025 ×2, 004 reverse, 001 ×3, 150 holo, 133 normale, me06-060 normale ; 006 (normale + reverse) : le fichier
            # n'a que la holo, donc aucune des deux n'est cotée ; 133 reverse ×2 non cotée
            expect = round(0.23 * 2 + 0.35 + 0.10 * 3 + 84.26 + 0.30 + 0.12, 2)
            eq(s['value'], expect, 'valeur de la collection (cotes connues seulement)')
            eq(s['priced'] + s['unpriced'] + s['pending'], s['total'], 'priced + unpriced + pending = total')
            eq(s['pending'], 0, 'toutes les séries chargées (les absentes comptent comme sans cote)')
            eq(s['priced'], 2 + 1 + 3 + 1 + 1 + 1, 'exemplaires cotés')
            pg.close()
            return f"valeur {s['value']} €, {s['priced']} cotées, {s['unpriced']} sans cote"

        def t_sealed_watch():
            pg = page_with(ctx, srv, None)
            r = pg.evaluate('''async () => {
              const evs = []; C.on(e => evs.push(...e));
              C.sealedSet(719691, { qty: 2, cost: 49.9, at: '2026-01-02' });
              const one = C.sealedGet(719691), oneStr = C.sealedGet('719691');
              const w1 = C.toggleWatch(5402), w2 = C.watching('5402'), w3 = C.toggleWatch('5402');
              C.sealedSet(719691, null);
              await new Promise(r => setTimeout(r));
              return { one, same: JSON.stringify(one) === JSON.stringify(oneStr), w1, w2, w3, list: C.watchList(), all: C.sealedAll(), evs: evs.map(e => e.type) };
            }''')
            eq(r['one'], {'id': 719691, 'qty': 2, 'cost': 49.9, 'at': '2026-01-02'}, 'scellé enregistré')
            check(r['same'], 'id nombre ou texte')
            eq([r['w1'], r['w2'], r['w3']], [True, True, False], 'suivi')
            eq(r['all'], [], 'retrait')
            eq(r['evs'], ['sealed', 'watch', 'watch', 'sealed'], 'événements')
            pg.close()

        def t_legacy_sealed():
            # scellé de l'ancienne version (ids TCGplayer) : gardé à part, relié à Cardmarket par une table, jamais perdu
            v1 = json.dumps({'version': 1, 'cards': {}, 'sealed': {
                '735067': {'id': 735067, 'qty': 2, 'cost': 50, 'at': '2026-01-02'}, '999': {'id': 999, 'qty': 1, 'cost': None, 'at': ''}},
                'watch': [735052, 1]})
            pg = page_with(ctx, srv, v1)
            r = pg.evaluate('''async () => {
              const evs = []; C.on(e => evs.push(...e.map(x => x.type)));
              const before = { legacy: C.legacySealed(), sealed: C.sealedAll() };
              const res = await C.linkLegacySealed({ 735067: 719691, 735052: '719700' });
              await new Promise(r => setTimeout(r));
              const back = C.exportText();
              C.clearAll(); await new Promise(r => setTimeout(r));
              const re = C.importText(back);
              const after = C.legacySealed();
              // table de MK (fixture data/market/sealed-img.json : { idCardmarket: idTCGplayer })
              const res2 = await C.linkLegacySealed();
              return { before, res, got: C.sealedGet(719691), w: C.watching(719700), left: after, re, res2,
                       final: C.legacySealed(), stored: JSON.parse(localStorage.getItem('cardex.collection.v1')).tcg, evs };
            }''')
            eq(len(r['before']['legacy']['sealed']), 2, 'scellé v1 gardé à part')
            eq(r['before']['sealed'], [], 'pas mélangé au scellé Cardmarket')
            eq(r['res'], {'linked': 2, 'left': 2}, 'relié par la table')
            eq(r['left']['watch'], [1], 'reste à relier après export/import')
            eq(sorted(str(s['id']) for s in r['left']['sealed']), ['999'], 'scellé non relié exporté et réimporté')
            eq(r['res2'], {'linked': 1, 'left': 1}, 'table sealed-img.json inversée')
            eq(r['final'], {'sealed': [], 'watch': [1]}, 'le reste attend toujours')
            check('reload' in r['evs'], 'événement reload', r['evs'])
            pg.close()
            # le scellé relié garde quantité, prix d'achat et date
            pg = page_with(ctx, srv, v1)
            r = pg.evaluate('async () => { await C.linkLegacySealed({ 735067: 719691 }); return C.sealedGet(719691); }')
            eq(r, {'id': 719691, 'qty': 2, 'cost': 50, 'at': '2026-01-02'}, 'entrée reliée intacte')
            pg.close()

        def t_clear():
            pg = page_with(ctx, srv, SAMPLE)
            r = pg.evaluate('''async () => { const evs = []; C.on(e => evs.push(...e)); C.clearAll(); await new Promise(r => setTimeout(r));
              return { n: C.all().length, evs: evs.map(e => e.type), saved: JSON.parse(localStorage.getItem('cardex.collection.v1')) }; }''')
            eq(r['n'], 0, 'vidée')
            eq(r['evs'], ['reload'], 'événement reload')
            eq(r['saved']['cards'], {}, 'stockage vidé')
            pg.close()

        def t_prefs():
            pg = ctx.new_page()
            pg.goto(srv.url + '__f2.html')
            r = pg.evaluate('''async () => {
              localStorage.removeItem('cardex.prefs.v1');
              const [P] = await load('./js/state/prefs.js');
              const d = P.get('theme', 'auto');
              P.set('theme', 'dark'); P.set('openBlocs', ['sv', 'me']);
              const arr = P.get('openBlocs'); arr.push('x');
              return { d, t: P.get('theme'), blocs: P.get('openBlocs'), raw: JSON.parse(localStorage.getItem('cardex.prefs.v1')), miss: P.get('nope', 42) };
            }''')
            eq(r['d'], 'auto', 'valeur par défaut')
            eq(r['t'], 'dark', 'enregistrée')
            eq(r['blocs'], ['sv', 'me'], 'copie défensive')
            eq(r['raw'], {'theme': 'dark', 'openBlocs': ['sv', 'me']}, 'clé cardex.prefs.v1')
            eq(r['miss'], 42, 'clé absente')
            pg.close()

        def t_injection_render():
            # après import piégé, le rendu par html`` de F1 (s'il existe) n'injecte rien non plus
            if not os.path.isfile(os.path.join(ROOT, 'js', 'core', 'dom.js')):
                return 'js/core/dom.js absent : vérifié avec le gabarit naïf seulement'
            pg = page_with(ctx, srv, None)
            r = pg.evaluate('''async (evil) => {
              const [D] = await load('./js/core/dom.js');
              C.importText(JSON.stringify(evil));
              const box = document.createElement('div');
              box.innerHTML = String(D.html`${C.all().map(r => Object.keys(r.qty).map(f => D.html`<div data-finish="${f}" title="${r.name}">${r.rarity}</div>`))}`);
              document.body.append(box);
              await new Promise(r => setTimeout(r, 50));
              return { injected: box.querySelectorAll('img, b, [onmouseover]').length, pwned: window.pwned || 0 };
            }''', EVIL)
            eq(r, {'injected': 0, 'pwned': 0}, 'rendu html`` sûr')
            pg.close()

        for name, fn in [('migration v1 → v2 (sample_collection.json)', t_migration),
                         ('import validé (charge d’injection)', t_import_validation),
                         ('fusion export → import', t_merge),
                         ('quota plein', t_quota),
                         ('JSON illisible sauvegardé', t_corrupt),
                         ('deux pages + événement storage', t_two_pages),
                         ('événements groupés par microtâche', t_events),
                         ('données dérivées mémorisées', t_derived),
                         ('valeur et cotes (finition sans cote = —)', t_prices),
                         ('scellé et suivis', t_sealed_watch),
                         ('scellé de l’ancienne version (TCGplayer → Cardmarket)', t_legacy_sealed),
                         ('tout effacer', t_clear),
                         ('préférences', t_prefs),
                         ('rendu html`` après import piégé', t_injection_render)]:
            R.run(name, fn)
        b.close()
    srv.close()
    return R.done()


if __name__ == '__main__':
    sys.exit(main())
