# Cardex overhaul — state after wave 2

Wave 2 replaced every stub of wave 1 with the real screens: Collection (with the Pokémon page, Réglages, achievements
and the value curve), Séries and Série, the card page, the Scanner, Marché (with the product page) and Decks. Each
screen was built by its owner, reviewed, then fixed (review findings in each progress log). The contract is still
`docs/refonte/SPEC.md`; its « Changelog (wave 2) » section lists what moved. `docs/refonte/WAVE1.md` §5 stays the
how-to for anyone writing a view. This file says what exists, how it was tested at integration, what is known to be
missing and what the QA wave should look at.

Integration date: 28/11/2026, branch `refonte` (on top of commit `df8d4fa`, with the owners' last fixes not committed
yet). Progress logs: `docs/refonte/progress/*.md` (integration: `INT2.md`).

## 1. Screens and owners

| Owner | Routes | Files |
|---|---|---|
| V-COL | `#/collection/cartes` · `/pokedex` · `/doubles` · `/succes`, `#/pokemon/:n`, `#/reglages` | `js/views/collection.js`, `js/views/collection/{cartes,pokedex,doubles,succes,shared,backup,grid}.js`, `js/views/pokemon.js`, `js/views/reglages.js`, `js/features/{achievements,valuehistory}.js`, `css/views/collection.css`, `tools/shotsteps/V-COL.json` |
| V-SER | `#/series`, `#/serie/:setId` | `js/views/series.js`, `js/views/serie.js`, `js/views/setrow.js`, `css/views/series.css`, `tools/shotsteps/V-SER.json` |
| V-CARD | `#/carte/:cardId` | `js/views/carte.js`, `js/views/carte/{details,holo,alert}.js`, `css/views/carte.css`, `tools/shotsteps/V-CARD.json` |
| V-SCAN | `#/scanner` | `js/views/scanner.js`, `js/views/scanner/{panel,session}.js`, `css/views/scanner.css`, `tools/shotsteps/V-SCAN.json` |
| V-MKT | `#/marche/cotes` · `/scelle` · `/mon-scelle` · `/envies`, `#/produit/:id` | `js/views/marche.js`, `js/views/marche/{cotes,scelle,monscelle,envies}.js`, `js/views/produit.js`, `js/views/ptile.js`, `js/data/sealed.js`, `css/views/marche.css`, `tools/shotsteps/V-MKT.json` |
| V-DECK | `#/decks/actuelle` · `/passees`, `#/deck/:id` | `js/views/decks.js`, `js/views/deck.js`, `js/views/decks/ui.js`, `js/data/decks.js`, `css/views/decks.css`, `tools/shotsteps/V-DECK.json` |

The shell, data layer, catalogue, market data and scanner core are unchanged since wave 1 (F1, F2, CA, MK, SC: no
diff since commit `17b2465` in their files), apart from the two test adjustments listed in §4.

## 2. Feature parity (SPEC §11 and FINAL-design §3.2)

Every feature of the old app has a place. The owners tested each one (their logs list the scripts); the integration
run checks that every route opens without error at every width (§3). Where each feature lives:

| Feature | Where | Notes |
|---|---|---|
| Camera scan, guide, scan line, torch, zoom, photo import, camera states (not https, refused, none, busy, lost) | Scanner | camera stops on hide and on a hidden page, restarts on show |
| Scan tips | Scanner ⓘ sheet + status pill (`aria-live`) | |
| Best match, finish chips (+1 each, Annuler), other candidates, « Pas la bonne ? » top 5, « Laquelle est-ce ? » top 3 | Scanner result panel | adding is always an explicit tap |
| « Chercher par nom » | Scanner → `#/series?q=` | also in the camera-unusable states |
| Scan session list with undo (new) | Scanner ⋯ / panel | `sessionStorage` `cardex.scanSession.v1` |
| Global search, cards + series (new; replaces the Recherche tab) | Séries search field | « Afficher plus » by 120 |
| Séries by bloc, collapsible and remembered, « Les miennes » | Séries (chips Toutes · Les miennes · En cours) | prefs `openBlocs` |
| Set page: master set, Toutes / Possédées / Manquantes, Grille / Liste / Classeur, binder swipe and ←/→, ticks with double-tap safety | Série | master set from the static finishes (no « Analyser ») |
| Set value (new), sort a set by price (new), offline browsing of every set (new) | Série (`tri=prix\|prix-asc\|nom`, « Valeur » sheet) | |
| Card sheet: finish preview, prices per finish, 7/30-day averages, quantities per finish, add a finish, price alerts, attacks, Pokédex link | Card page | holo tilt ±8° on the card page only |
| Collection stats, value curve with readout | Collection › Cartes summary + « Évolution de la valeur » sheet | `cardex.history.v1` |
| Filter, sort (Récentes, Nom, N° Pokédex, Série, Valeur), finish chips with counts | Collection › Cartes | |
| Pokédex (search, Tous / Possédés / Manquants, progress, counts) and the Pokémon page (every card, Méga-Évolution sets, owned first) | Collection › Pokédex, `#/pokemon/:n` | |
| Doubles and the trade list (clipboard + fallback sheet, includes envies) | Collection › Doubles | |
| 18 achievements with toasts | Collection › Succès | `cardex.ach.v2` (v1 migrated) |
| Backup reminder (new), export / import / clear, storage status (new), theme | Collection (one-line reminder), Réglages | |
| Decks by season with search, Jouables / Presque, sorts, credits | Decks | |
| Deck page: summary, add missing cards to envies, Limitless link, legend, grouped rows | `#/deck/:id` | |
| Cotes (value, 30-day change, up/down counts, En hausse / En baisse / Les plus chères) | Marché › Cotes | |
| Sealed ideas (6 sections) + catalogue (search, sort, type chips with counts, « Afficher plus ») | Marché › Scellé (Pistes · Catalogue) | |
| Product page (chart with ranges and readout, first price ×, max, 4 changes, Mon scellé form, follow, links), « prix inchangé depuis » (new) | `#/produit/:id` | |
| Mon scellé (invested, value, gain, yield) | Marché › Mon scellé | |
| Envies (notification permission, price check, Cardmarket links, delete) and the tab badge | Marché › Envies, tab bar | badge on Marché and dot on Envies |

## 3. Tests at integration

All Python with `python -P` (never `-I`), Chromium through Playwright, each test on its own server (`--port N`;
integration used 8899). The working tree tested is `df8d4fa` plus the owners' uncommitted fixes plus the two test
adjustments of §4.

| Command | Result |
|---|---|
| `python -P tools/tests/router_test.py --port N` | 98/98, no JavaScript error (97/98 before the test 91 adjustment) |
| `python -P tools/tests/store_test.py --port N` | 16/16 |
| `python -P tools/tests/data_test.py --port N` | 21/21 |
| `python -P tools/tests/sw_test.py --port N` | 11/12. The failure is « sw.js du dépôt (mode dev) : hors ligne après la 1re visite » (§6, development worker only). Before the « données ?h= » adjustment: 10/12. In one run of four, « mise à jour », « periodicsync » and « passage depuis la v1 » failed together (the update click did not activate the new worker, the next two tests depend on it); they passed in the three other runs. |
| `python -P tools/tests/wave1_test.py --port N` | 13/13 (RESULTAT OK) |
| `python -P tools/market/test_market.py` | 88 checks, all pass |
| `python -P tools/shots.py --port N --width W --themes light,dark` for W = 320, 360, 390, 430, 768, 1280 (all 159 steps: `shell.json` + the six `V-*.json`) | 1 908 captures, 0 problems: no JavaScript error, no local 404 (only the allowed development `data/manifest.json`), no horizontal overflow, no clipped element, ← on every sub-page and never on a root, `document.title` « … · Cardex » everywhere, primary tabs sticky; highest first content on a tab root 260 px. About 7.5 min per width. |
| `python -P tools/shots.py --port N --width 390 --big 2000 --cpu 4` | 159 captures, 0 problems with a synthetic 2 000-card collection (drawn from `data/cards-index.json` in the browser, never written to the repository) and the CPU slowed ×4 |
| Route smoke (scratch `smoke2.py`): the 54 routes below opened by a direct link with the sample collection, at 320 light, 360 light, 390 light, 430 dark, 768 dark, 1280 dark, and at 390 with an empty collection | Every route opens with its real content and no console error, no local 404, no overflow, the right ← and title, and **no request to pokemontcg.io** (hosts contacted: the local server, `assets.tcgdex.net`, `api.tcgdex.net`, `cdn.jsdelivr.net`, `images.scrydex.com`, `tcgplayer-cdn.tcgplayer.com`). Two expected exceptions: `#/serie/zz-nope` (unknown set: « Série introuvable », but two local 404s, §6) and `#/collection/cartes?q=pika` (first tile at 301 px: the open search field is the first content). Empty collection: the start destination is the Scanner, every screen shows its empty state. At 1280 px the ← sits at the left edge of the centred content column (x = 124, right of the rail), as F1 laid out the app bar. |

Routes of the smoke run: `#/collection/cartes` (also `?tri=nom&finition=reverse`, `?q=pika`, `?tri=valeur`),
`/pokedex` (also `?filtre=possedes&q=pi`), `/doubles`, `/succes`, `#/pokemon/25` (also `?filtre=possedees`),
`#/pokemon/6`, `#/reglages`, `#/series` (also `?q=flammes`, `?q=pikachu`, `?filtre=miennes`, `?filtre=en-cours`),
`#/serie/sv03.5` (also `?vue=liste&filtre=manquantes`, `?vue=classeur&page=2`, `?master=1&tri=prix`), `swsh3`, `pl4`,
`svp`, `exu`, `2013bw`, `zz-nope`, `#/carte/sv03.5-025` (also `?finition=reverse`), `exu-%253F`, `sm115-1` (English
image), `30th-c-001` (Scrydex image), `2013bw-10` (same-art reprint), `2013bw-1` (no image), `base1-4?finition=firstEdition`,
`#/scanner`, `#/marche/cotes` (also `?filtre=baisse`), `/scelle` (also `?vue=catalogue&type=etb&tri=desc&langue=tout`,
`?vue=catalogue&q=151`), `/mon-scelle`, `/envies`, `#/produit/903956?periode=30j`, `#/produit/719691?periode=tout`,
`#/produit/1`, `#/decks/actuelle` (also `?filtre=presque&tri=prix`), `/passees` (also `?saison=2425&q=dra`),
`#/deck/1months-284`, `#/deck/1`, legacy `#wishlist`, and no hash.

Screenshots were looked at as contact sheets (320 light and dark, 768 light, 1280 dark, empty collection) and full
size for a sample (Séries, card page, Pistes and the scanner result at 1280 dark, the not-found states at 390).
Owners' own suites (each in its scratch folder, listed in its progress log) passed at the end of their fix pass:
V-COL `func.py` 60/60, V-SER `fix.py` 52/52 and `func.py` 26/26, V-CARD `interact.py` 38/38 and `ae2.py` 14/14,
V-SCAN `t_live` 15/15 and the `t_fix_*` scripts, V-MKT `func_all.py` 45/45 and `fixcheck.py` 26/26, V-DECK
`fix_checks.py` 30/30 and `test_decks.py` 53/53.

## 4. Changes made by the integrator

No application file needed a change: every import resolves (371 static and dynamic imports checked, every imported
name exported by its target), the view registry in `js/main.js` already lists the eleven views with their final file
names, every file `index.html` references exists, and no route produces a local 404 apart from the development
`data/manifest.json` and a hand-typed unknown set id (§6). The F1 fixes of the wave 1 review are untouched (no file
of the shell changed in wave 2). The view stylesheets were checked for selectors that could leak into another view
(none: every rule is scoped by a view id or a view-specific class).

Two tests assumed the wave 1 stubs and were adapted (test code only):

| File | Change | Why |
|---|---|---|
| `tools/tests/router_test.py` (test 91) | removes the Scanner module's `onChange` for the duration of the check, then puts it back | The check is about `main.js` (a view without `onChange` is marked stale, not redrawn). The Scanner, used as the example, now has an `onChange` (it patches an open result), so the test failed for a correct view. |
| `tools/tests/sw_test.py` (« données ?h= ») | sets prefs `openBlocs` to every bloc before browsing Séries offline | Séries blocs are collapsible (old app behaviour, SPEC §11); in an empty collection only the first bloc is open, so 26 logos were shown instead of the whole list and the « > 50 logos » check failed. With every bloc open the check covers the whole list again (185 set images shown offline). |

Scratch tools used for integration (not in the repository): `smoke2.py` (every route of SPEC §3 opened by a direct
link: console errors, local 404s, pokemontcg.io, overflow, ←, title, first content), `imports.py`, `devsw.py`
(development service worker race), `rep.py` (summary of `shots.py` reports), `contact.py` (contact sheets).

## 5. Measurements

**Cold start** (scratch `boot.py`: new browser context, sample collection, 390 × 844, no service worker, local server;
« content » = the first tile, row or content block of the view is in the DOM; bytes = files finished before that
moment, gzip estimated from the local files, images excluded; long tasks over the next 3 s; 3 runs):

| Route | Content at CPU ×1 | Content at CPU ×4 | Before content at CPU ×4 (gzip) | Long tasks at CPU ×4 |
|---|---|---|---|---|
| `#/collection/cartes` | 85–116 ms | 217–228 ms | 172 KB (JS 76, font 56, CSS 33, `cardimg.json` 4) | none |
| `#/series` | 84–95 ms | 238–246 ms | 181 KB (+ `sets.json` 8.5) | none |
| `#/scanner` | 68–79 ms | 186–197 ms | 192 KB (JS 96); the card database (`hashes.bin` + `cards.json`, 1.2 MB) loads behind it | none |
| `#/marche/cotes` | 81–87 ms | 249–253 ms | 237 KB (+ price files 43) | none |
| `#/marche/scelle` | 84–86 ms | 281–298 ms | 342 KB (+ `sealed.json` 139) | none |
| `#/decks/actuelle` | 102–104 ms | 302–320 ms | 299 KB (+ `decks.json` 68, price files 48) | none in 3 runs; one 51 ms task in a 4th run |
| `#/serie/sv03.5` | 86–104 ms | 261–262 ms | 191 KB (+ set and price files 6) | none |
| `#/carte/sv03.5-025` | 70–80 ms | 208–218 ms | 202 KB | none |
| `#/pokemon/25` | 200–215 ms | 476–490 ms | 461 KB (+ `cards-index.json` 140, set files 134) | none |
| `#/produit/719691` | 75–84 ms | 232–246 ms | 328 KB (+ `sealed.json`) | none |
| `#/deck/1months-284` | 93–98 ms | 266–270 ms | 265 KB (+ `decks.json`) | none |

The shell part (JS, font, CSS, image table) is 169–190 KB depending on the route (JS 72–98 KB). SPEC §12's « ≤ 180 KB
before the first screen is usable » holds for Collection (172), is just reached on Séries (181) and is exceeded by
11–22 KB on Série (191), the card page (202) and the Scanner (192); the data-heavy screens add the files they need. The font (56 KB) and the six view stylesheets (all linked from
`index.html`, 20 KB gzip together) are the largest fixed parts. Owners measured INP-like delays with 2 000 cards at
CPU ×4 (every interaction 16–120 ms; worst: Back to Collection from a card 104–120 ms, Collection value sheet and
Back to Cartes 96 ms; « + » on a tile 15–32 ms): see their logs.

**Code size**: `js/**` 69 files, 714 KB raw / 269 KB gzip (views 30 files, 351 KB / 128 KB; scanner core 12 files,
137 KB / 52 KB, loaded with the Scanner view, which `main.js` preloads at idle with the other tab roots);
`css/views/*` 69 KB raw / 20 KB gzip.

## 6. Known limitations

- **Startup long task (SPEC §12 « no long task > 50 ms at startup »)**: borderline on every route at CPU ×4. The
  evaluation of `main.js` is one task of 49–57 ms (it includes a forced style and layout from `appbar.js` `onScroll`,
  called by `setBar` inside `renderRoute`), and the shell's first frame costs about 50 ms (layout ≈ 30 ms) in some
  runs (V-COL, V-MKT traces). The view code itself has no startup task over 50 ms. Integration runs (§5, 3 cold starts
  of 11 routes at CPU ×4) saw no long task at all, and one 51 ms task in a fourth run on Decks: the margin is thin.
- **Collection › Cartes with the backup reminder**: first tile at 293 px (253 px without the reminder). Kept as a
  documented exception (SPEC changelog wave 2, §12): the reminder is the first content, one line, temporary.
- **Tesseract** prints `console.error` lines during OCR (« Bottom=0, top=78 … », « Total count=0 ») when the scanner
  falls back to OCR. Not an app error, but it breaks « no console error » while scanning (SC).
- **Development service worker** (`sw.js` with `VERSION = 'dev'`, never deployed): modules that are still loading when
  the worker takes control (about 80–100 ms after a first visit) are neither in the « seen » list sent by `net.js` nor
  fetched through the worker, so an offline reload right after a first visit can miss a few lazily loaded view
  modules (`sw_test` « mode dev »). The deployed worker precaches the whole shell and is not affected.
- **Unknown set id** (`#/serie/zz-nope`): the page shows « Série introuvable », but the static file and the price file
  are still requested first (two local 404s in the console). Only a hand-typed or stale link does this.
- **Achievement « Prêt pour le tournoi »** uses its own copy of the deck rule (`deckPct` in `achievements.js`, reading
  `basicEnergy` from `decks.json`), which counts special energies (Jet, Mist…) as owned basic energy; the Decks screen
  does not. The two can disagree on « complete ». `tools/build_decks.py` marks those special energies as basic.
- **Wish price checks** (`js/state/wishes.js` `priceFor()`) read the raw price file entry of the wish's finish and do
  not apply the `allEditions` rule: a background check can put the base card's cheapest offer into a 1st-edition or
  stamp wish, mark it in range and notify (the card page no longer shows that state, the Envies list would).
- **Envies « Voir sur Cardmarket »** needs the English name: wishes do not store it, so Envies asks TCGdex GraphQL
  once per card and session (French name as a fallback).
- **Slow networks**: a price file that hits `net.data()`'s 15 s timeout is not retried until the next `ensure()`;
  decks of that set show the fallback prices of `decks.json` meanwhile.
- **Scanner benchmark « card absent ≤ 2 % »**: unchanged since wave 1 (3.5–4.7 %), still open (SPEC changelog wave 1).
- **Decks tab**, first opening: one run in three has a single 56 ms task (probably parsing `decks.json`, 746 KB; not
  confirmed).

## 7. Open items for the QA wave

Requests the owners made and that nobody has done yet (each owner may only edit their own files):

| For | Request |
|---|---|
| F1 | Split or defer the `main.js` boot work (the `appbar.js` `onScroll` measurement inside `setBar` during `renderRoute`) to remove the last startup long task. |
| F1 | `core/list.js` `renderChunked` chains batches with `scheduler.yield`, which resumes before rendering, so several batches are laid out in one frame; use the pacing of `views/collection/grid.js` (rAF, then a task). Séries (bloc list and search results), Série (grid and list) and Decks still use `renderChunked`. |
| F1 | `base.css` `.sr` uses `margin: -1px`, so a status line placed directly in a full-width section starts at x = −1 and `tools/shots.py` flags it as off-screen; either drop the negative margin or make `shots.py` skip `.sr` / 1 px clip elements (V-SER worked around it). |
| F2 | `js/core/net.js`: after `controllerchange`, also send the resources that finish loading afterwards (PerformanceObserver for a few seconds, or a second « seen » message at idle) so `sw_test` « mode dev » passes. |
| F2 | `js/state/wishes.js` `priceFor()`: treat a `firstEdition` / `stamp` entry equal to the `normal` / `holo` entry as « no price » (same rule as `prices.get()`'s `allEditions`). |
| F2 | `WishDB.make()`: add an `en` field (English name), filled by the card page, which already fetches it; Envies would stop its own GraphQL lookup. |
| F2 | `catalog.set()` / `prices.ensure()`: do not request `data/sets/<id>.json` and `data/market/prices/<id>.json` for an id that a loaded `sets.json` does not list (go live directly); optional: retry a price file after a timeout. |
| SC | Silence tesseract's `console.error` output during OCR (worker logger or a filtered `console`). |
| V-COL | `achievements.js`: use `decks.best()` / `decks.status()` from `js/data/decks.js` instead of its own `deckPct`. |
| Orchestrator | `tools/build_decks.py`: restrict the `basicEnergy` regex to the 9 basic types. |
| Orchestrator | Decide on the Collection backup-reminder exception (293 px) and on the scanner « card absent » target. |

What QA should check beyond the automated runs of §3:
- SPEC §12 end to end on real devices: iPhone Safari (installed PWA and browser), Android Chrome (Back button,
  notifications, camera with torch and zoom), a desktop browser with a mouse and with the keyboard only.
- The scanner with real cards under real light (accept / choose / non reconnue, reprints, sleeves), the photo import,
  camera permission refused then granted, the session list and Annuler.
- The production build: `python -P tools/release.py`, then the app served with the stamped `sw.js` and
  `data/manifest.json` (offline reload, update toast, no opaque responses), then restore the development `sw.js` and
  delete the manifest before any commit. When `refonte` is merged, switch GitHub Pages to « GitHub Actions ».
- A v1 collection from the live site (finish repair, achievements without toasts, sealed products linked), import of
  an old backup file, two tabs open at once.
- Performance at CPU ×4 with 2 000 cards on a cold start of every tab root (A/B in one run), and the 180 KB budget.
- Screen reader pass (VoiceOver, TalkBack) on the tab roots, a sheet, the card page, the scanner result panel.
- Copy review: French, tutoiement, sentence case, no « ! » outside success toasts, no emoji (a grep of `js/` finds
  none in strings).
