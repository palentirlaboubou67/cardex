# Cardex overhaul — state after wave 1

Wave 1 built the foundations: the app shell and design system (F1), state, data layer and service worker (F2), the
static catalogue with images and set logos (CA), Cardmarket market data (MK) and the scanner core (SC). Every view is
still a **stub** (`js/views/*.js`, « Écran en construction »): wave 2 view owners replace them. The contract is
`docs/refonte/SPEC.md`; its « Changelog (wave 1) » section lists what moved during integration. This file is the
practical guide: what exists, how to test it, and how to use the modules from a view.

Integration date: 26/11/2026 (branch `refonte`). Progress logs: `docs/refonte/progress/*.md`.

## 1. What exists

| Area | Files | Owner |
|---|---|---|
| Shell | `index.html` (app bar, `<main id="outlet">`, tab bar / rail, `<dialog id="sheet">`, toasts), `manifest.webmanifest`, icons, `fonts/instrument-sans-latin.woff2` | F1 |
| Design system | `css/tokens.css`, `css/base.css` (every shared component), `css/views/*.css` (empty, for W2), `tools/kitchen.html` (gallery, `?theme=dark`, `?side=1`) | F1 / W2 |
| Core | `js/main.js` (boot, view registry + cache, link interception, idle tasks, SW + update toast, storage toast), `js/core/{router,appbar,sheet,toast,dom,list,icons,idle,format}.js`, `js/core/net.js` (F2) | F1 |
| Components | `js/components/tile.js`, `chart.js`, `setlogo.js` | F1 |
| State | `js/state/collection.js` (v2 store), `prefs.js`, `wishes.js` (classic script, also used by `sw.js`) | F2 |
| Data | `js/data/catalog.js`, `images.js`, `prices.js`, `tcgdex.js`, `finishes.js`, `dex.js` | F2 |
| Service worker | `sw.js` (dev mode committed; stamped at deploy by `tools/release.py`) | F2 |
| Scanner core | `js/scan/*` (camera, worker, detector, descriptors, matcher, region check, OCR), `vendor/tesseract/*` | SC |
| Builders | `tools/build_catalog.py` + `tools/catalog/*` (CA), `tools/build_market.py` + `tools/market/*` (MK), `tools/build_scan.py` (SC), `tools/release.py` (F2), `tools/build_decks.py` (existing) | |
| Tests | `tools/tests/router_test.py`, `store_test.py`, `data_test.py`, `sw_test.py`, `wave1_test.py`, `tools/shots.py` + `tools/shotsteps/*.json`, `tools/scan_bench.py` + `tools/scanbench/*`, `tools/market/test_market.py` | |
| CI | `.github/workflows/site.yml` (data + Pages deploy), `decks.yml` | |

Views (stubs) and their routes: SPEC §3. The stubs already use real data where it exists: Collection (tiles,
value from the price files, per-finish prices), Pokémon page (every card of a Pokémon, owned first), Séries (186
sets by bloc with logos and progress), Série (hero logo, progress, card grid), Carte (image, finishes with
steppers and the Cardmarket price of each finish), Réglages (theme, every source credit). Scanner, Marché, Produit,
Decks and Deck are placeholders.

## 2. Data files (measured 26/11/2026)

| File | Count | Raw | Gzip | Built by | Committed |
|---|---|---|---|---|---|
| `data/sets.json` | 186 sets, 17 blocs | 52 KB | 8.7 KB | CA | yes |
| `data/sets/<id>.json` | 186 files, 20 226 cards | 1.79 MB | 278 KB (median 1.5 KB) | CA | yes |
| `data/cards-index.json` | 20 226 rows | 580 KB | 143 KB | CA | yes |
| `data/cardimg.json` | en 20 sets, ok 68, alt 86, fix 3 | 18 KB | 4.4 KB | CA | yes |
| `img/sets/*`, `img/sym/*` | 280 WebP | 869 KB | — | CA | yes |
| `data/market/prices/<id>.json` | 186 files, 20 172 cards | 1.01 MB | 306 KB | MK daily | **no** (deploy) |
| `data/market/sealed.json` | 3 059 products | 1.11 MB | 143 KB | MK daily | **no** (deploy) |
| `data/market/hist/*.json` | 333 shards, 63 days | 1.34 MB | 190 KB | MK daily | yes |
| `data/market/cm-map.json`, `sealed-img.json`, `meta.json` | | 878 KB | 165 KB | MK weekly | yes |
| `data/scan/hashes.bin` | 18 684 × 64 B | 1.20 MB | 1.16 MB | SC | yes |
| `data/scan/cards.json` | ids, sets, twins (455) | 322 KB | 63 KB | SC | yes |
| `data/decks.json` | 13 periods | 746 KB | 70 KB | decks.yml | yes |
| `data/pokedex.json` | 1 025 names | 12 KB | 5.6 KB | existing | yes |
| `data/manifest.json` | hashes of every `data/` file | | | `tools/release.py` | **no** (deploy) |

App code: `js/**` 48 files, 361 KB raw / 142 KB gzip (the boot path is about 147 KB gzip before Collection is
usable). `vendor/tesseract` 12.6 MB on disk, about 4.8 MB downloaded once per device when OCR is first needed.

Coverage: card images 99.96 % (FR 17 282, TCGdex EN 1 201, Scrydex 1 649, same-art reprints 86, none 8);
prices 20 167 / 20 226 cards (99.7 %), 30 427 / 30 767 finishes; sealed 3 050 / 3 059 with a price.

## 3. Tests (commands and results at integration)

All Python with `python -P` (never `-I`). Each test starts its own server: pass your own `--port`.

| Command | Result |
|---|---|
| `python -P tools/tests/router_test.py --port N` | 98/98, no JavaScript error |
| `python -P tools/tests/store_test.py --port N` | 16/16 (migration, injection payload, quota, corrupt JSON, two tabs, v1 finish repair…) |
| `python -P tools/tests/data_test.py --port N` | 21/21 (real CA catalogue and MK prices) |
| `python -P tools/tests/sw_test.py --port N` | 12/12 with the committed dev `sw.js` |
| `python -P tools/shots.py --port N --width 320,390,1280 --themes light,dark` | 312 captures (widths 320, 360, 390, 430, 768, 1280 × light, dark), 0 problems |
| `python -P tools/scan_bench.py bitexact --port N` / `synth --n 100 --cpu 1,4` / `api` / `loop` | bit-exact 53/53 (0/512 bits); synthetic standard n=100: top-1 99 %, final decision 96 % accepted at 100 % precision, CPU ×4 p50 210 ms; card absent n=200: 3.5 % (unique art 0.6 %); api 14/14; loop 6/6; live 3 clips OK; real photos 14/21 accepted, 0 wrong |
| `python -P tools/market/test_market.py` | all tests pass |
| `python -P tools/tests/wave1_test.py --port N` | 13/13 (storage toast, SW `navigate`, v1 finish repair, bloc order, progress goal) |
| `python -P tools/release.py` then `sw_test.py` again (production mode) | production copy (stamped `sw.js`, manifest): 33 routes, 0 console error, every `data/` request with `?h=`, 0 opaque or error entry in Cache Storage, offline reload of a set OK; `sw_test` 11/12 while the repository `sw.js` is stamped (only the « dev mode » guard fails, as it should), 12/12 once restored |

`tools/shots.py` fails on any JavaScript error, local 404 (except `data/manifest.json` in development), overflow,
clipped element, first content > 260 px on a root, missing or extra ←, wrong `document.title`, or non-sticky primary
tabs. Add your own steps in `tools/shotsteps/<view>.json` (format in the docstring of `tools/shots.py`).

Local development: `python -P -m http.server PORT --bind 127.0.0.1 --directory <repo>`. Without
`data/manifest.json` the app fetches plain paths (`cache: 'no-cache'`), so the only console error is the manifest 404.
Never commit `data/manifest.json` or a stamped `sw.js`.

## 4. Deploy

`.github/workflows/site.yml` runs on every push to `main`, daily at 04:15 and 10:15 UTC (Cardmarket prices) and on
Mondays at 03:45 UTC (also `build_market.py --weekly`, `build_catalog.py`, `build_scan.py --recheck 600`). It commits
the versioned data that changed, runs `tools/release.py` (stamps `sw.js`, writes `data/manifest.json`) and deploys
`_site/` with `actions/deploy-pages`. **When `refonte` is merged into `main`, set Settings → Pages → Source to
« GitHub Actions »**: price files are generated at deploy and never committed, so a branch deploy would have no prices.
The old `sealed.yml` (TCGplayer, `tools/build_sealed.py`) is removed.

## 5. For wave 2 view owners

### 5.1 View module

```js
// js/views/serie.js : one <section id="v-set"> per view, created once and kept (view cache)
import { setBar } from '../core/appbar.js';
import { html, setHTML, delegate } from '../core/dom.js';
import { param, setParams } from '../core/router.js';
import * as catalog from '../data/catalog.js';

let el = null;
export default {
  mount(section) { el = section; el.innerHTML = '<div class="head"></div><div class="grid"></div>'; },
  async show(r) {
    const { signal } = r;                         // aborted as soon as the route changes
    const id = param(r);                          // decoded, never throws
    setBar({ title: catalog.metaSync(id)?.name || 'Série', back: true, signal });
    const s = await catalog.set(id);
    if (signal.aborted) return;                   // after EVERY await
    setBar({ title: s.meta.name, subtitle: '…', back: true, signal, menu: [/* ⋯ rows */] });
    // … render the first screen, then resolve
  },
  resume(r) {},                                   // cache hit: same hash, show() had completed
  hide() {},                                      // stop camera, timers, abort fetches
  onChange(events) {},                            // REQUIRED if the view shows collection data
};
```

- Root routes have no ←; every other route passes `back: true`. Filters and sort live in the URL:
  `setParams({ tri: 'prix' })` (replaceState, no history entry). Links are plain `<a href="#/…">`; use
  `cardHref(id, finish)` / `setHref(id)` from `router.js` (ids are encoded once: `exu-%3F`). Primary tabs:
  `primaryTabs(items, current)` directly in the section or in `.ptabs-slot`, with `data-replace` links.
- Copy: French, tutoiement, sentence case, no « ! » except success toasts, no emoji. Numbers with `js/core/format.js`
  (`eur`, `eurDelta`, `pct`, `num`, `plural`, `dateFr`, `relDay`, `cardNo`, `localNo`).

### 5.2 Tiles, lists, patches

```js
import { tileHTML, patchTile } from '../components/tile.js';
import { renderChunked, patchByKey } from '../core/list.js';
import * as prices from '../data/prices.js';
import * as col from '../state/collection.js';

await prices.ensure([setId]);                                  // never rejects
await renderChunked(grid, cards, c => {
  const n = col.qtyOf(c.id);
  return tileHTML(c, { qty: n, missing: !n, price: prices.eur(c.id, 'normal'), meta: localNo(c.localId) });
}, { empty: html`<div class="empty" data-content>…</div>` });

// onChange(events): patch, do not re-render
for (const e of events) if (e.type === 'qty') patchByKey(el, e.id, t => patchTile(t, { qty: col.qtyOf(e.id), missing: !col.qtyOf(e.id) }));
// e.type === 'reload' (import, clear, other tab, v1 finish repair): refresh everything visible
```

Tile options: `{ qty, finish, missing, price (number = euros, or text), meta, href, badge: 'qty'|'extra'|'none', fx, label }`.
« ×N » only for N ≥ 2; `badge: 'extra'` shows « +N » (Doubles). Prices are loaded per set:
`prices.on(setIds => …)` fires when files arrive (`collection` stub: `patchPrices()`).

### 5.3 App bar, sheets, toasts

```js
setBar({ title, subtitle, back: true, titleHidden: true /* card page */, signal,
  actions: [{ icon: 'bell', label: 'Alerte prix', onClick, pressed: false, badge: 0 }],   // ≤ 2
  menu: [{ icon: 'info', label: 'À propos de cet écran', onClick }] });   // « Réglages et sauvegarde » is appended
updateAction(0, { pressed: true }, { signal });                           // patched in place (focus kept)
revealTitle(true, { signal });

const s = openSheet({ title: 'Ajouter', body: html`…`, onClose });     // Back / Esc / backdrop / ✕ close it
await menuSheet([{ icon: 'trash', label: 'Retirer', danger: true, onClick }], 'Options');
infoSheet('Cotes', [prices.creditText(), '…']);                        // body: text, array of paragraphs, or Safe
toast('Ajoutée en Reverse · 3 au total', { action: 'Annuler', onAction: () => col.setQty(card, 'reverse', before) });
```

### 5.4 Catalogue, images, prices

- `catalog.sets()` → `{ blocs: [{ id, name, logo, first, dark, special, sets }], sets, byId }` (blocs already in display
  order). `catalog.set(id)` → `{ meta, cards: [brief] }` (static file, else live TCGdex). `catalog.card(id)`,
  `cardSync(id)`, `metaSync(id)`, `search(q)` → `{ sets, cards, count }` (call `warmIndex()` when a search field is
  shown), `cardsOfDex(n)`. Progress: `owned / catalog.goalOf(meta)` (never `meta.total` alone).
- Set visuals: `setLogoHTML(meta, { size: 'row' | 'hero' | 'bloc' })` (pass `dark` for bloc logos too),
  `setSymHTML(meta, { size })`. Generated covers replace missing logos automatically.
- Card images: `imgHTML(card, { q: 'low' | 'high', eager, alt })`, `enBadge(card)` (« EN » / « ≈ »),
  `imgCaption(card)` for the card page (« Illustration de la version anglaise », « Même illustration que … »).
  `installFallback` is already installed by main.js.
- Prices (euros, Cardmarket only): `prices.get(id, finish)` → `{ eur, trend, avg1, avg7, avg30, low, allEditions? }`
  or null → show « — », never the normal price instead. `prices.change(id, finish)`, `prices.sum(entries)` (set value),
  `prices.date()`, `prices.creditText()` (ⓘ sheets, Réglages). Card page fallback: `prices.live(fullCard, finish)`.
  `allEditions: true` on `firstEdition` / `stamp` = the base card's price: label it « prix toutes éditions ».
- Sealed (W2 market owner writes `js/data/sealed.js`): `data/market/sealed.json` via `net.data()`; `eur: null` =
  « Pas de vente récente »; `low` only when plausible (« dès X € »); history in `data/market/hist/<h>.json`
  (`{ d: [dates], p: { id: [cents…] } }`); changes `c7/c30/c90/c365` come from our history; `chg` = last trend change
  (« prix inchangé depuis … »). `sid` may be a set absent from the French catalogue (no link then). Photos
  (`img`, TCGplayer) need `crossorigin="anonymous"`.

### 5.5 Collection and preferences

```js
col.setQty(card, 'reverse', 2); col.add(card, 'normal');           // card = brief, full TCGdex card or record
col.qtyOf(id, finish?); col.get(id); col.all(); col.inSet(setId); col.stats(); col.value(rec);
col.ownedBySet(); col.ownedByDex(); col.ownedByName(); col.ensurePrices();
col.sealedSet(id, { qty, cost, at }); col.toggleWatch(id); col.legacySealed(); await col.linkLegacySealed();
col.exportFile(); col.importText(text) /* { cards, updated, sealed, watch, skipped, saved } */; col.clearAll();
col.storageState() /* Réglages: size, backups, read-only */; col.corruptText(key); col.deleteBackup(key);
prefs.get('theme', 'auto'); prefs.set('scanFinish', 'reverse');
```

Only offer finishes the card has (`brief.finishes`). A preset finish the card does not have (scanner « Ajout :
Normale » on a holo-only card) must fall back to the card's first finish: the old app did not, and main.js repairs
those v1 records at idle (`repairFinishes`).

### 5.6 Scanner (W2 scanner owner, on `js/scan/index.js`)

```js
import * as scan from '../scan/index.js';
await scan.preload(p => …);                                        // hashes.bin + cards.json + worker
const { caps } = await scan.openCamera(video);                     // CameraError on refusal / no camera
const loop = scan.createLoop({ video, guide: guideEl, auto: prefs.get('scanAuto', true),
  onState: s => { /* searching | detected | identifying | uncertain | paused | error ; s.hint ; s.quad ; s.error */ },
  onResult: r => { /* r.decision 'accept' | 'choose' ; r.best ; r.candidates ; r.alternatives ; r.source */ } });
loop.start();
// a second 'choose' for the same card replaces the chooser; after the user picks: loop.hold()
// hide(): loop.destroy(); scan.closeCamera();
const res = await scan.identifyImage(file).catch(e => e instanceof scan.ScanError ? null : Promise.reject(e));
```

Adding to the collection is always an explicit tap with « Annuler ». Search by name: `#/series?q=`.

### 5.7 Things that are already decided

- Bloc order, logo plates, generated covers, EN pills, placeholders, price wording, credits: do not redo them.
- Deck lists (`data/decks.json`) still carry TCGdex Cardmarket prices; 3 deck cards (`bw11-45`, `bw11-87`, `bw11-88`)
  are not in the French catalogue: render them without a link.
- Images of other hosts always get `crossorigin="anonymous"` (the service worker only caches readable responses).

## 6. Known limitations and open items

- Scanner « card absent ≤ 2 % » (SPEC §12): 4.7 % (SC, 300 cases) then 3.5 % (200 cases, after the twins
  illustrator check); 0.6–1.2 % for unique art; every remaining false accept is a same-art reprint whose twin was
  masked. Pending a decision (SPEC changelog « Open »).
- SC asked CA for a verified same-art map (image-less trainer kit / McDonald's / Classic Collection card → imaged
  card). Done in `tools/build_scan.py` instead (where the heuristic lives): same-name twins whose TCGdex
  illustrators are both known and clearly different are dropped (957 candidate pairs); 24 image-less cards lost a
  false twin, 137 gained a verified one (homonym lists that were too long to use before). Twins 437 → 455.
- `me06` uses the English Scrydex logo until TCGdex publishes the French one; 8 cards have no image anywhere.
- Price file sizes and `sealed.json` are above the first estimates (accepted, SPEC changelog).
- OCR fallback reads the SV/ME set code in 7–15 of 40 synthetic cases; it never caused a wrong accept.
- Same-name twins are now checked by illustrator, but TCGdex has no illustrator for many promos: `swshp-SWSH233`
  keeps McDonald's 2021 #17 as twin, so the 4 sleeved photos of it give `choose` instead of `accept`.
- The Collection stub loads the owned sets' price files at idle; patching the tiles then costs one task of about
  50 ms at CPU ×4 in some runs (W2 rewrites this view: patch in batches if it matters).
- The progress bars of the Séries stub start at different x positions (number width): W2 Séries styling.
