# Cardex — overhaul spec (branch `refonte`)

This is the **contract** for every agent working on the overhaul. When this file and a research report
disagree, this file wins. When this file is silent, follow the research report named in the section.

`$SP` = `C:\Users\lomif\AppData\Local\Temp\claude\f3478f947e9a2b1d\809dffbe-a208-457d-9d45-be0fedf28e32\scratchpad`
Research reports (fact-checked, read the sections you need, they are long):
- `$SP\research\FINAL-design.md` — UX, navigation, tokens, components, wireframes (W-A…W-X), copy (§9)
- `$SP\research\FINAL-perf.md` — architecture, router mechanics, list rendering, SW v2, budgets
- `$SP\research\FINAL-cardmarket.md` — Cardmarket files, card price defects, sealed catalogue, history
- `$SP\research\FINAL-images.md` — card image fallbacks, `cardimg.json`, logos, symbols
- `$SP\research\FINAL-scanner.md` — scanner pipeline, hashes, detector, thresholds, OCR, benchmark
Prototypes and data from the research are next to them (`$SP\scripts-*`, `$SP\dl-*`): reuse them.

## 0. What the user asked (in French, verbatim)

- « ameliore le scan car il marche pas tres bien »
- « utilise uniquement le marché français que ce soit pour les cartes et les items scellés » → **Cardmarket, in euros, only.**
- « il manque des cartes qui n'affiche pas leur illustration … si tu n'as pas toutes les illu en français met
  l'anglais ou le jap mais choisis un des deux » → **FR first, otherwise English. Never Japanese.**
- « le déplacement entre les pages est compliqué, mets une flèche en haut à gauche » → **← back arrow top-left on every sub-page, real history (Android back works).**
- « je souhaite un réel changement et une vraie optimisation, faut vraiment que ce soit le menu, les cartes,
  les covers de séries, le scanner de cartes etc. soit parfait »
- « refonte du design : un outil plus sobre avec toutes les infos certes mais moins brouillon »
- Keep **every existing feature** (feature map: FINAL-design §3.2, and §11 below).

## 1. Ground rules for every agent

1. **Stack**: static PWA, vanilla ES modules, **no build step, no bundler, no npm, no Node** (Node is not installed
   and must not be installed). Python 3.12 is available with numpy, Pillow, OpenCV (`cv2`), py7zr, fontTools,
   brotli, scipy and Playwright (Chromium). **Run Python that needs these with `python -P`** (never `-I`, it hides
   the user site-packages).
2. **Git**: do **not** run git commands that change state (no commit, checkout, stash, reset, rebase, push).
   Read-only git (`git status`, `git diff`, `git log`, `git show`) is fine. The orchestrator commits.
3. **File ownership**: only create/modify files you own (table §2). If you need a change in someone else's file,
   do not edit it: put the request in your final report under "Requests to other owners".
   You may read anything, including `legacy/` (the old app, for feature parity and existing logic).
4. **Local server port**: use the port given in your task (each agent has its own), never 8765.
5. **Language**: all UI text in **French**, tutoiement, sentence case, no "!" except success toasts, no emoji,
   no ALL CAPS with letter-spacing (copy rules: FINAL-design §9). Code comments in French, short.
   Numbers/dates with `Intl` fr-FR (helpers in `js/core/format.js`).
6. **Quality bar**: this is the "parfait" overhaul. Test what you build in Chromium (Playwright) at 390×844 and at
   1280×800, light and dark. No console errors. No horizontal overflow. Look at your screenshots yourself.
7. **Network etiquette**: TCGdex ≤ 4 requests/s with back-off on 429/503 and timeouts (it answers in 0.2–7 s);
   Scrydex: never bulk-download images, only HEAD-verify new ids (their terms forbid mirroring);
   Cardmarket files: at most twice a day, with ETag; Internet Archive: ≥ 10 s between requests.
   Cache downloads under `.cache/` (gitignored) so reruns are cheap.
8. **Final report** (your last message): what you built (files), how you tested it (commands + results),
   measured numbers, known limitations, requests to other owners, and anything you decided that this spec did not.

## 2. Repository layout and ownership

```
index.html                     F1   app shell (app bar, <main id="outlet">, tab bar, <dialog id="sheet">, toast)
manifest.webmanifest, icon.svg, icon-180.png, icon-512.png   F1
fonts/instrument-sans-latin.woff2 + fonts/OFL.txt          F1 (self-hosted, latin subset, wdth 75–100, wght 400–700)
css/tokens.css                 F1   design tokens (FINAL-design §5) light + dark
css/base.css                   F1   reset, layout, every shared component (§6 of FINAL-design), holo fx for tiles
css/views/<view>.css           view owners (see W2), linked from index.html by F1 (empty placeholders since wave 1)
js/main.js                     F1   boot: theme, router start, view registry, tab bar, link interception, SW registration + update toast
js/core/router.js              F1   corrected router (FINAL-design §4.3 bis) — see §3
js/core/dom.js                 F1   html`` auto-escaping template, raw(), esc(), $, $$, delegate()
js/core/appbar.js              F1   setBar() — see §5.1
js/core/sheet.js               F1   bottom sheets on <dialog> with a history entry
js/core/toast.js               F1   toast with optional action (Annuler)
js/core/list.js                F1   renderChunked(), sentinel(), patchByKey()
js/core/icons.js               F1   inline SVG sprite + icon()
js/core/idle.js                F1   whenIdle()
js/core/format.js              F1   eur, eurDelta, pct, dir, dateFr, … (FINAL-design §5.4)
js/core/net.js                 F2   getJSON() with timeout + typed errors, cached(), data() (manifest-hashed static files)
js/components/tile.js          F1   card tile template + patch
js/components/chart.js         F1   line chart (readout, ranges) + sparkline
js/components/setlogo.js       F1   set logo / symbol / monogram
js/views/*.js                  F1 creates minimal stubs; view owners (W2) replace them
js/features/achievements.js    F1 stub (init(), list()) → W2 collection owner implements
js/features/valuehistory.js    F1 stub → W2 collection owner implements
js/state/collection.js         F2   collection store v2 (schema, events, migration, import validation, multi-tab)
js/state/prefs.js              F2   remembered UI choices
js/state/wishes.js             F2   classic script (was legacy/js/wishdb.js), shared with sw.js
js/data/catalog.js             F2   static catalogue reader (+ live TCGdex fallback)
js/data/images.js              F2   card image resolver (FINAL-images §3.2 corrected runtime) + <img> helper
js/data/prices.js              F2   per-set Cardmarket price files reader (+ TCGdex fallback with the cmFor fix)
js/data/tcgdex.js              F2   live TCGdex calls (card details, search fallback, set fallback, GraphQL @locale)
js/data/finishes.js            F2   finish keys, labels, dots, foil mapping
js/data/dex.js                 F2   Pokédex names (data/pokedex.json), guessDex(), sprite URLs
js/data/decks.js               W2 decks owner
js/data/sealed.js              W2 market owner
js/scan/*                      SC   scanner core (no UI): camera, worker, detector, descriptors, matcher, OCR fallback
vendor/tesseract/*             SC   self-hosted tesseract.js 7.0.0 files (worker, core wasm.js, fra best_int)
sw.js                          F2   service worker v2 (FINAL-perf §4.8 + wish handlers)
tools/release.py               F2   stamps sw.js VERSION/SHELL and writes data/manifest.json (CRLF-safe)
tools/build_catalog.py         CA   sets.json, sets/<id>.json, cards-index.json, cardimg.json, logos, symbols
data/sets.json, data/sets/*.json, data/cards-index.json, data/cardimg.json, img/sets/*, img/sym/*   CA
tools/build_market.py          MK   replaces legacy/tools/build_sealed.py
data/market/*                  MK   prices/<setId>.json (generated, gitignored), sealed.json (generated, gitignored),
                                    hist/<shard>.json, meta.json, sealed-img.json, cm-map.json (committed)
tools/build_scan.py            SC   data/scan/hashes.bin, data/scan/cards.json (committed)
tools/scan_bench.py, tools/scanbench/*   SC
tools/shots.py                 F1   rewritten: route-based steps loaded from tools/shotsteps/*.json, measurements
tools/shotsteps/<owner>.json   each owner its own steps file
tools/tests/router_test.py     F1   (port of $SP\scripts-designcheck\router_fixed_test.py, against the real app)
tools/tests/store_test.py, tools/tests/data_test.py, tools/tests/sw_test.py, tools/tests/f2/*   F2
tools/kitchen.html             F1   component gallery (every component, light/dark) for visual checks
data/decks.json, tools/build_decks.py   existing (W2 decks owner may adapt reading code, not the builder unless needed)
data/pokedex.json              existing (read by js/data/dex.js)
data/logos.json                legacy, replaced by sets.json logo fields (CA may delete it at the end)
legacy/                        the old app, read-only reference; deleted at the end of the overhaul
.github/workflows/*            orchestrator (site.yml: data + Pages deploy; decks.yml)
docs/refonte/WAVE1.md          integrator (state after wave 1, how-to for view owners)
```
Agent codes: **F1** shell & design system · **F2** state, data layer, SW · **CA** catalogue, images, logos ·
**MK** Cardmarket market data · **SC** scanner core · **W2** view owners (second wave) · **QA** (third wave).

## 3. Navigation

Use the corrected router of FINAL-design **§4.3 bis** (`$SP\scripts-designcheck\routerfixed\router.js`), which passes
23/23 scenarios (`$SP\scripts-designcheck\router_fixed_test.py`). Keep its behaviour: per-tab stacks owned by the
tab, fixed start destination (Collection; Scanner when the collection is empty), stacks kept in sessionStorage,
traversal lock, null-state adoption, deep links insert the parent underneath, `setParams()` with replaceState.

Tabs (bottom bar, in this order; rail on the left at ≥ 900 px): `collection` Collection · `series` Séries ·
`scan` Scanner · `market` Marché · `decks` Decks.

| Route | View name | Tab | Parent (deep link) | Query params |
|---|---|---|---|---|
| `#/collection/cartes` · `/pokedex` · `/doubles` · `/succes` | `collection` | collection | — | cartes: `q`, `tri`, `finition` · pokedex: `q`, `filtre` |
| `#/pokemon/:n` | `poke` | collection | `#/collection/pokedex` | `filtre` |
| `#/reglages` | `settings` | collection | `#/collection/cartes` | |
| `#/series` | `sets` | series | — | `q` (search), `filtre=miennes\|en-cours` |
| `#/serie/:setId` | `set` | series | `#/series` | `vue=grille\|liste\|classeur`, `filtre=possedees\|manquantes`, `master=1`, `page` |
| `#/carte/:cardId` | `card` | stays in the current tab | `#/serie/<setId>` | `finition` |
| `#/scanner` | `scan` | scan | — | |
| `#/marche/cotes` · `/scelle` · `/mon-scelle` · `/envies` | `market` | market | — | scelle: `vue=pistes\|catalogue`, `q`, `type`, `tri`, `langue` |
| `#/produit/:id` | `product` | market | `#/marche/scelle` | `periode=7j\|30j\|3m\|1a\|tout` |
| `#/decks/actuelle` · `/passees` | `decks` | decks | — | `saison`, `q`, `filtre`, `tri` |
| `#/deck/:id` | `deck` | decks | `#/decks/actuelle` | |
| legacy `#wishlist` | → `#/marche/envies` | | | |

- Card ids can contain `.` and `%` (`sv03.5-025`, `exu-%3F`, `tk-xy-latia-1`). Set id of a card = `id.slice(0, id.lastIndexOf('-'))`.
- Every internal link is `<a href="#/…">`; `main.js` intercepts clicks on `a[href^="#/"]` and calls `router.go(href)`;
  `a[data-replace]` (primary tabs, sibling switches) uses `{replace: true}`.
- Bottom sheets push a history entry with the same hash (`{...history.state, d: d+1, sheet: 1}`), so Back closes them.
- **View cache**: each view has one `<section class="view" id="v-<name>" hidden>` created on first use and kept.
  Back to a view that still shows the same params must not re-render it (instant, scroll restored by the router).
- On route change: focus moves to the app-bar title (`tabindex="-1"`), `document.title = "<title> · Cardex"`.

### 3.1 View module contract (`js/views/<file>.js`)

```js
export default {
  // once, when the section is created; el = <section>
  mount(el) {},
  // every time the route resolves to this view. r = { hash, path, view, tab, m (regex match), q (URLSearchParams) }.
  // Must call setBar() and resolve once the first screen of content is in the DOM (skeletons are fine).
  async show(r, el) {},
  // the view is hidden (another view shown): stop camera, timers, abort fetches
  hide() {},
  // optional: batched collection events (see §5.3); patch the DOM, do not re-render everything
  onChange(events) {},
};
```
View registry in `main.js` (lazy `import()`): `collection → views/collection.js`, `poke → views/pokemon.js`,
`settings → views/reglages.js`, `sets → views/series.js`, `set → views/serie.js`, `card → views/carte.js`,
`scan → views/scanner.js`, `market → views/marche.js`, `product → views/produit.js`, `decks → views/decks.js`,
`deck → views/deck.js`. A view file may import its own sub-modules from `js/views/<name>/…`.

## 4. Design system (summary — details in FINAL-design §5–§7, apply every [FC] correction)

- Tokens exactly as FINAL-design §5.1 (neutral greys, **one accent** `#3451c6` / dark `#91a5ff`, `--up`/`--down`
  only for price direction, completion and destructive). **No gold. No red buttons.** `--text-3` never for
  information or placeholders (use `--text-2`). Theme: `auto | light | dark` (prefs), applied by an inline `<head>`
  script before first paint; `<meta name="theme-color">` updated.
- **One font**: Instrument Sans, self-hosted (`font-stretch: 75% 100%` in `@font-face`), tabular figures for every
  number (`.num`), captions/badges/tab labels at `font-stretch: 90%`. No text under 11 px.
- Type scale, spacing, radii, motion: FINAL-design §5.2–§5.3. Safe areas (`env(safe-area-inset-*)`) on every sticky
  or fixed bar and the viewfinder. `-webkit-` prefixes for `backdrop-filter` and `mask-image`.
- Components (FINAL-design §6): app bar · tab bar / rail · primary underline tabs · segmented control · one
  horizontally scrolling chip row (sort = chip-styled `<select>`, font-size 16px on iOS to avoid zoom) · search field ·
  grouped list + rows with hairlines (no boxed rows) · card tile with badges (×N only for N ≥ 2, "+N" in Doubles, finish
  pill 11 px with dot, EN pill) · set row with logo · progress (4 px, numeric label) · summary header (hero number +
  one line, replaces stat tiles) · price cell + delta (SVG triangle, never text glyphs ▲▼) · buttons (max one accent
  button per screen), stepper, toast · bottom sheet / menu / info sheet · empty / skeleton / error row.
- Explanations leave the screens (no `.lede` paragraphs): one-line subtitles or an ⓘ info sheet (FINAL-design §9).
  First content item ≤ 260 px from the top on every tab root.
- Holo finishes (FINAL-design §7): static overlays on grid tiles, one sheen on hover/press, full tilt + glare only on
  the card page (±8°), `prefers-reduced-motion` respected. No infinite animation when idle.
- Card edge: draw it **inside** the image box (pseudo-element `inset` ring), so `content-visibility: auto` on tiles
  does not clip it. `content-visibility: auto` + `contain-intrinsic-size` on every repeated tile/row (not on `<details>`).
- Icons: one inline SVG sprite, stroke 1.75, 24 grid (Lucide-style paths are fine, ISC licence, credit in Réglages).
  The back icon is an arrow-left (`M19 12H5M11 5l-7 7 7 7`), `aria-label="Retour"`.
- Desktop ≥ 900 px: navigation rail (80 px) on the left, grids `repeat(auto-fill, minmax(150px, 1fr))`, card and product
  pages in two columns, sheets become centred dialogs (max 480 px). 600–899 px: bottom bar, 4–5 columns.
- Accessibility: tiles are links with an accessible name (`aria-label="Pikachu, 151, 025/165, possédée ×2"`),
  `aria-current="page"` on the active tab, `aria-pressed` on toggles, labels on inputs, 44 px targets, focus visible,
  `aria-live="polite"` for status (scanner, toasts).

## 5. Module APIs (the contract between F1, F2, CA, MK, SC and the view owners)

### 5.1 Core (F1 unless noted)

```js
// js/core/dom.js
export const esc = s => …;                    // HTML-escape
export const raw = s => Safe;                 // mark trusted HTML
export const html = (strings, ...vals) => Safe; // every interpolation escaped unless Safe/array of Safe
export const $ = (sel, root = document) => …, $$ = (sel, root) => [...];
export function delegate(root, event, selector, handler) {}  // handler(e, matchedEl); returns unsubscribe
export function setHTML(el, safe) {}          // el.innerHTML = String(safe)

// js/core/appbar.js
export function setBar({
  title, subtitle = '', back = false,          // back=true on every non-root route → ← calls router.back()
  titleHidden = false,                         // card page: title appears when revealTitle(true) is called
  actions = [],                                // ≤ 2: { icon, label, onClick } | { icon, label, href } ; { pressed } ; { badge }
  menu = [],                                   // ⋯ menu rows: { icon, label, onClick, danger } — "Réglages et sauvegarde" is appended automatically
  progress = false,                            // 2 px indeterminate bar under the bar (background refresh)
}) {}
export function revealTitle(on) {}
export function setProgress(on) {}

// js/core/sheet.js  (one sheet at a time; Back / Esc / backdrop / ✕ close it)
export function openSheet({ title, body /* Safe | Node */, onClose, wide = false }) → { el, close() }
export function menuSheet(items /* [{icon,label,onClick,danger}] */, title?) → Promise<void>
export function infoSheet(title, body) → { el, close }
export const isOpen = () => bool, hide = () => {}   // used by the router deps

// js/core/toast.js
export function toast(message, { action, onAction, ms = 4000 } = {}) {}

// js/core/list.js  (FINAL-perf §4.5)
export async function renderChunked(el, items, tpl, { first = 48, batch = 120, empty = '' } = {}) → bool
export function sentinel(el, onNear) → disconnect
export function patchByKey(root, id, fn) {}   // elements with [data-card="<id>"]

// js/core/icons.js
export function icon(name, { size = 24, cls = '' } = {}) → Safe   // <svg class="i …"><use href="#i-name"/></svg>
// names at least: back, search, filter, more, info, close, chevron-right, chevron-down, chevron-left, check, plus, minus,
// trash, bell, bell-ring, star, star-fill, camera, image, flash, flash-off, scan, collection, series, market, decks,
// settings, copy, refresh, external, grid, list, binder, sort, up, down, alert, wifi-off, zoom, sparkle

// js/core/format.js  (FINAL-design §5.4; typographic minus U+2212)
export const eur = v => '1 430,00 €' | '—';   export const eurC = cents => eur(cents / 100);
export const eurDelta = v => '+12,30 €';      export const pct = v => '+41,2 %';  // v in percent units
export const dir = v => 'up' | 'down' | 'flat';   // ±0.5 % threshold
export const dateFr = 'YYYY-MM-DD' => '25 nov. 2026'; export const dateShort = d => '25/11';
export const relDay = d => 'aujourd’hui' | 'hier' | 'il y a 3 jours';   // RelativeTimeFormat numeric:'auto'
export const num = n => '1 234';  export const plural = (n, one, many) => `${num(n)} ${n > 1 ? many : one}`;
export const norm = s => accent- and case-insensitive key for search;
export const cardNo = (localId, total) => '025/165' | 'SWSH001';

// js/core/net.js  (F2; FINAL-perf §4.9 corrected)
export class NetError extends Error { kind /* offline|timeout|notfound|server|network */; status }
export async function getJSON(url, { timeout = 10000, signal } = {}) → data   // re-throws caller aborts unchanged
export async function cached(key, ttl, load) → data                          // stale copy wins over an error
export async function data(path, { timeout } = {}) → data   // static file under data/: adds ?h=<hash> from data/manifest.json
                                                             // (manifest optional: works without it in dev), memoised in memory
export const MESSAGES = { offline: 'Hors ligne', timeout: 'Le serveur ne répond pas', notfound: 'Introuvable',
                          server: 'Service indisponible', network: 'Connexion impossible' };
```

### 5.2 Card brief (the one card shape every view uses)

```js
{ id: 'sv03.5-025', localId: '025', name: 'Pikachu', setId: 'sv03.5',
  image: 'https://assets.tcgdex.net/fr/sv/sv03.5/025' | '',   // TCGdex FR base URL ('' = no FR image → resolver)
  rarity: 'Commune', category: 'Pokémon' | 'Dresseur' | 'Énergie', dexId: [25], finishes: ['normal', 'reverse'] }
```
Collection records (§5.3) are briefs plus `qty`, `addedAt`, `setName`, `setTotal`. TCGdex full cards (card page) are
compatible (`image`, `localId`, `rarity`, `category`, `dexId`, `variants`…).

### 5.3 State (F2)

```js
// js/state/collection.js — key 'cardex.collection.v1', schema v2 inside ({ v: 2, cards, sealed, watch, savedAt })
export const FINISHES = ['normal', 'reverse', 'holo', 'cosmos', 'pokeball', 'masterball', 'firstEdition', 'stamp'];
export const all = () => records;  export const get = id => record | undefined;
export const qtyOf = (id, finish?) => n;          // total when finish omitted
export function setQty(card /* brief or full */, finish, n) {}   // stores meta (name, localId, setId, setName, setTotal, image, rarity, category, dexId)
export function add(card, finish, n = 1) {}
export const on = fn => unsubscribe;              // fn(events) once per microtask; events:
//   { type: 'qty', id, finish, before, after, added /* first copy of the card */, removed /* last copy gone */ }
//   { type: 'sealed', id } · { type: 'watch', id } · { type: 'reload' } (import, clear, other tab)
export const rev = () => n;                        // increments on every change (memo key)
export function stats() → { total, unique, sets, value, priced, unpriced }   // value from js/data/prices.js (loaded sets only)
export function ownedBySet() → Map<setId, distinct cards>;  ownedByDex() → Map<n, distinct>;  ownedByName() → Map<normName, qty>
export function value(rec) → euros | null
// sealed products I own (purchase price) and products I follow — same semantics as legacy/js/store.js
export sealedAll, sealedGet, sealedSet(id, entry|null), watching(id), toggleWatch(id), watchList()
export function exportFile() {}  export function importText(text) → { cards, sealed, watch }  // validated merge
export function clearAll() {}    export const lastSave = () => ms;
```
- v1 → v2 migration is pure, runs on load and on import; v2 drops the stored `prices` (prices come from price files).
- `save()` in try/catch; a corrupt JSON is backed up to `cardex.collection.v1.corrupt.<ts>` before resetting.
- Import whitelist: finish keys in `FINISHES`, integer qty 1–999, strings ≤ 200 chars, ids `/^[\w.%-]+-[\w.%]+$/`.
- `storage` event → reload data + emit `reload` (installed app + browser tab).

```js
// js/state/prefs.js — key 'cardex.prefs.v1'
export const get = (key, fallback) => …, set = (key, value) => …;
// keys used: theme ('auto'|'light'|'dark'), openBlocs (array), sealedLang ('int'|'int+ja'), compact (bool),
// scanFinish ('normal'…), scanAuto (bool), lastBackupReminder (ms)

// js/state/wishes.js — classic script, global self.WishDB (used by the page through window.WishDB and by sw.js)
// IndexedDB 'cardex' / 'wishes' (keyPath 'key'), same records as legacy/js/wishdb.js:
// { key, id, name, setName, setId, localId, image, variant /* finish key */, min, max, low, trend, checkedAt, inRange }
// prices: from data/market/prices/<setId>.json (via data/manifest.json hash), fallback TCGdex /v2/fr/cards/:id with cmFor.
// WishDB = { all, put, del, check(), notify(reg, hits), priceFor(entry) }
```

### 5.4 Data (F2)

```js
// js/data/catalog.js — static files from CA (§6.1–6.3), live TCGdex fallback for sets/cards not in them
export async function sets() → { blocs: [bloc…], sets: [setMeta…] /* visible, newest first */, byId: Map }
export async function set(id) → { meta: setMeta, cards: [brief…] }      // data/sets/<id>.json, else live
export async function card(id) → brief | null                            // via its set file
export function cardSync(id) → brief | null                              // only if its set file is loaded
export async function search(query, { limit = 120 } = {}) → { sets: [setMeta…], cards: [brief…] }
//   name (accent/case-insensitive, prefix > word > substring), "025/165", "25", set code + number ("MEW 25"), "#25" Pokédex
export async function cardsOfDex(n) → [brief…]                          // every card of a Pokémon (dexId, incl. name-guessed)
export const setIdOf = cardId => …;
// setMeta: { id, name, bloc, date, total, count, code, logo, logoLang, sym, legal: { standard, expanded }, tag, dark }
// bloc:    { id, name, logo, first }

// js/data/images.js — FINAL-images §3.2 "corrected runtime" + §3.3 marking
export const ready: Promise;                                   // data/cardimg.json loaded (await before first render)
export function cardImg(card, q = 'low' | 'high') → { urls: [], en: bool, same: bool }
export function imgHTML(card, { q = 'low', cls = '', alt = '', eager = false } = {}) → Safe
//   <img crossorigin="anonymous" loading="lazy" decoding="async" width="245" height="337" src=… data-fb="next urls">
//   or the no-image placeholder (card-shaped, set symbol + number, never the name, never a Scrydex card back)
export function installFallback(root = document) {}           // one global 'error' listener: walk data-fb, then placeholder
export function enBadge(card) → Safe | ''                      // « EN » pill (tiles ≥ 56 px only); « ≈ » for same-art reprints

// js/data/prices.js — MK files (§6.4); Cardmarket only, euros
export async function ensure(setIds) {}                          // loads data/market/prices/<set>.json (≤ 6 in parallel)
export function get(cardId, finish) → { eur, trend, avg1, avg7, avg30, low } | null   // euros; eur = trend (sane) else avg30
export function eur(cardId, finish) → number | null
export function change(cardId, finish) → { now, a1, a7, a30, pct30 /* now vs avg30 */, pct7 } | null
export const date = () => 'YYYY-MM-DD' | null;                  // price guide date (Cardmarket createdAt)
export async function live(full, finish) → same shape | null    // TCGdex pricing with the cmFor() fix (FINAL-cardmarket §4.2)
export const CREDIT = 'Cotes Cardmarket (tendance, toutes langues), mises à jour chaque nuit';

// js/data/tcgdex.js — live only
export async function card(id, { signal } = {}) → full card (attacks, illustrator, hp, types…) // SW caches it for offline
export async function searchLive(name) → [brief…]; export async function setLive(id) → { meta, cards }
export async function gql(query) → data   // POST https://api.tcgdex.net/v2/graphql, cards(...) with @locale(lang:"fr")

// js/data/finishes.js
export const FINISHES, LABEL /* long FR */, SHORT /* FR pill */, DOT /* css class per finish */;
export function foilKey(variantDetailed) → 'cosmos' | 'pokeball' | 'masterball' | null   // case-insensitive, FR + EN labels

// js/data/dex.js
export async function pokedex() → [{ n, name }]; export function guessDex(name) → [n…]; export const sprite = n => url;
```

### 5.5 Components (F1)

```js
// js/components/tile.js
export function tileHTML(card, { qty = 0, finish = null, missing = false, price = null, meta = '', href, badge = 'qty' /* 'qty'|'extra'|'none' */, fx = true } = {}) → Safe
//   <a class="tile" data-card="<id>" href="#/carte/<id>[?finition=…]" aria-label="…"> image + badges + caption </a>
export function patchTile(el, { qty, missing, price }) {}
// js/components/chart.js
export function lineChart(el, points /* [{d:'YYYY-MM-DD', v}] */, { ranges = ['30j','90j','tout'], format = eur }) → { update(points), destroy() }
export function sparkline(values, { w = 96, h = 32 }) → Safe   // accent stroke, no axes
// js/components/setlogo.js
export function setLogoHTML(setMeta, { size = 'row' /* row 64×36 | hero 160×64 | bloc 16 */ }) → Safe  // light plate in dark mode when meta.dark
export function setSymHTML(setMeta, { size = 20 }) → Safe
```

### 5.6 Features (stubs by F1, implemented by the W2 collection owner)

```js
// js/features/achievements.js
export function init() {}            // main.js calls it on idle; subscribes to collection changes; toasts "Succès débloqué"
export function list() → [{ id, group, title, desc, done, progress: [n, goal] }]
// js/features/valuehistory.js
export function init() {}            // records today's collection value once prices are loaded (key cardex.history.v1)
export function points() → [{ d, v }]
```

### 5.7 Scanner core (SC) — `js/scan/index.js`

```js
export async function preload(onProgress?) {}   // fetch data/scan/hashes.bin + cards.json, start the worker
export async function openCamera(video) → { stream, caps: { torch, zoom: { min, max } | null, focus } }
export function closeCamera() {}
export function setTorch(on) → Promise<bool>;  export function setZoom(z) → Promise<bool>
export function createLoop({ video, guide /* DOMRect of the guide in video CSS pixels */, onState, onResult }) → { start(), stop(), shutter(), destroy() }
//   onState({ state: 'searching'|'detected'|'identifying'|'uncertain'|'paused', quad /* 4 points in video CSS px */, hint })
//   onResult({ decision: 'accept'|'choose', best: { id, d }, candidates: [{ id, d }] /* top 5 */,
//              alternatives: [id…] /* same-art reprints / look-alikes */, source: 'image'|'ocr', ms })
//   After 'accept' the loop pauses until the card leaves the frame (or resume() / shutter()).
export async function identifyImage(source /* ImageBitmap | HTMLImageElement | Blob */) → same result object | null   // photo import
export async function ocrFallback(source, hint?) → result | null   // lazy-loads vendor/tesseract
```
Thresholds (FINAL-scanner §5.4, starting values, calibrate with the benchmark): strong = `d1 ≤ 0.6 && d1 ≤ 0.6·d2`
(accept on one frame); normal = `d1 ≤ 1.1 && d2 − d1 ≥ 0.30` confirmed by 2 of the last 3 frames; look-alike /
reprint group → code-region NCC or chooser; stable but uncertain ~1 s → `choose` with top 3 and OCR in parallel.
Adding to the collection is always an explicit tap in the UI (with Annuler), never automatic.

## 6. Static data contracts

All JSON minified (`separators=(',', ':')`), UTF-8, `ensure_ascii=False`, stable ordering (small git diffs).

### 6.1 `data/sets.json` (CA)
```json
{"v":1,"built":"2026-11-25T05:00:00Z",
 "blocs":[{"id":"me","name":"Méga-Évolution","logo":"img/sets/me01.1a2b3c4d.webp","first":"2025-09-26"}],
 "sets":[{"id":"sv03.5","name":"151","bloc":"sv","date":"2023-09-22","total":165,"count":207,"code":"MEW",
          "logo":"img/sets/sv03.5.9f8e7d6c.webp","logoLang":"fr","sym":"img/sym/sv03.5.0a1b2c3d.webp",
          "legal":{"standard":false,"expanded":true},"tag":null,"dark":false}],
 "hidden":["wp","jumbo","rc"]}
```
- Non-Pocket FR sets only (TCGdex FR `/v2/fr/sets`, minus Pocket series A*, B*, P-A and the 3 empty sets).
  Include `pl4`'s AR cards problem (FINAL-images §3.2 note) if it can be fixed cleanly.
- `code` = `abbreviation.official`, else a hand-picked code (6 sets, FINAL-design §6.9 [FC]); never the full name.
- `tag` = small text for subsets that reuse their parent's logo (« Coffre », « Galerie », « Énergies », « Classique »…).
- `dark` = the logo is dark and needs a light plate in dark mode (luminance computed at build).
- Logos and symbols are self-hosted WebP with a **content hash in the file name** (immutable, cache-first forever).
  Logo ≤ 240×96, trimmed; symbol ≤ 64×64. Sources and choices: FINAL-images §4 (FR first; subsets reuse the parent's
  FR logo; one shared McDonald's logo; bloc logos §5). Scrydex-only logos (20): hotlink-free → self-host is "mirroring",
  so for those 20 prefer a generated cover (symbol + code) unless another free source exists; note what you chose.

### 6.2 `data/sets/<setId>.json` (CA)
```json
{"v":1,"id":"sv03.5","serie":"sv","cards":[
  {"l":"025","n":"Pikachu","i":1,"r":"Commune","c":"P","d":[25],"f":["normal","reverse"]}]}
```
- `l` localId, `n` French name, `r` rarity (FR), `c` category `P|D|E`, `d` dexIds (TCGdex, **plus name-guessed ids for
  sets without dexId** such as the Méga-Évolution sets: use data/pokedex.json names, duo cards give several),
  `f` finishes in `FINISHES` order from GraphQL `variants` + `variants_detailed` with `@locale(lang:"fr")`
  (one request per set, no pagination; check the directive works on every run, else REST per card).
- `i`: `1` = FR image at `https://assets.tcgdex.net/fr/<serie>/<setId>/<localId>` (verify the derived URL equals the
  API's `image`), `0` = no FR image (the resolver uses cardimg.json), or an explicit base-URL string.
- Card order = TCGdex order (numeric where possible).

### 6.3 `data/cards-index.json` (CA) — lazy, for search and the Pokémon page
```json
{"v":1,"sets":{"sv03.5":[["025","Pikachu",[25],1],["026","Raichu",[26],1]]}}
```
Rows `[localId, name, dexIds, i]` (same `i` convention). Target ≈ 145 KB gzip (wave 1: 142.8 KB).

### 6.4 `data/cardimg.json` (CA) — exactly the format read by FINAL-images §3.2 corrected runtime
Keys `v, built, en, sx, id, ok, alt, png, fix` (§3.1 + [FC] `ok` allowlist + `alt` reprint map). McDonald's order:
the exact English McDonald's card first, then the French image of the original printing, then its English image.
Simulate the resolver in Python over every card and HEAD-check every produced URL (gently, Scrydex: new ids only).

### 6.5 Market (MK) — FINAL-cardmarket §1.4, §2, §4, §5, §7 with every [Corrected]/[Added] fix
- `data/market/prices/<setId>.json` (generated daily, **gitignored**):
  `{"v":1,"d":"2026-11-25","c":{"025":{"normal":[23,25,24,17,15],"reverse":[57,null,61,60,40]}}}`
  Values are **cents** `[trend, avg1, avg7, avg30, low]` (null when absent), one key per finish the card has, chosen at
  build time with the finish→field rules (holo-only cards: base fields; reverse: `-holo`; Poké Ball / Master Ball
  separate products: `-holo` fields; cosmos holo-type: base fields; 1st edition / stamp: base product), the broken-trend
  guard (`trend` outside [ref/5, ref×5] with ref = avg7‖avg30 → ref), validated links (strict name check keeping ☆),
  re-linked and recovered cards (manual expansion table + name/attack matching). `d` = guide `createdAt` date.
- `data/market/cm-map.json` (committed, weekly): TCGdex card id + finish → Cardmarket idProduct (+ which fields), and
  the set → expansion mapping (keep declared expansion when ≥ 1 card agrees, else majority; manual extras table).
- `data/market/sealed.json` (generated daily, gitignored):
```json
{"updatedAt":"…","priceDate":"2026-11-25","source":"Cardmarket","products":[
 {"id":719691,"k":"etb","l":"int","e":5402,"sid":"sv03.5","set":"151","rel":"2023-09-22",
  "fr":"Coffret Dresseur d'Élite – 151","n":"151 Elite Trainer Box","img":"https://tcgplayer-cdn.tcgplayer.com/product/…_200w.jpg",
  "eur":377.89,"low":320,"c7":null,"c30":null,"c90":null,"c365":null,"first":null,"since":null,"max":null,"chg":"2026-11-20","h":"5402"}]}
```
  `k` ∈ `box halfbox etb bundle prerelease tin blister booster deck kit coffret case` (labels FINAL-cardmarket §2.1,
  [Corrected] names: « Boîtier Stratégies et Combats », « Mini Tin », « Coffre de collection », « Deck Combat de Ligue »).
  `l` ∈ `int ja` only (others dropped). `eur` = trend, else avg; `low` only within [0.3×, 3×] eur. `chg` = date of the
  last trend change (frozen trends: show « prix inchangé depuis … », not « 0 % »). `fr` never empty (fallback: French
  type + English expansion name). `img` = matched TCGplayer photo (English packaging) or "".
- `data/market/hist/<shard>.json` (committed, appended daily): `{"d":["2024-12-30",…],"p":{"719691":[37789,null,…]}}`
  cents of `eur`, sharded by expansion (split the big buckets). Compaction: daily 120 days, weekly to 2 years, then
  monthly. Backfill once from the Internet Archive (FINAL-cardmarket §5.1; date = the file's `createdAt`).
- `data/market/meta.json` (committed): ETags, last processed `createdAt` per file, build stats.
- `data/market/sealed-img.json` (committed, weekly): Cardmarket idProduct → TCGplayer product id (photo match).
- The builder is stdlib-only for the daily part (runs in GitHub Actions), records a history point only when the guide
  `createdAt` is new, never shrinks history, and exits non-zero without writing if a source is broken.

### 6.6 Scanner (SC) — FINAL-scanner §6
`data/scan/hashes.bin` (64 B per card, rows in `cards.json.ids` order, stable/append-only) and `data/scan/cards.json`
(`ids, src, noimg, dups, near, codes, sets{t, era, num}`), built by `tools/build_scan.py` with the **same canonical
resize and hash algorithm as the JS** (bit-exactness test: ≤ 4 differing bits of 512 on 50 references).

### 6.7 `data/manifest.json` (F2 `tools/release.py`, generated at deploy, gitignored)
`{"v":"<iso>","files":{"data/sets.json":"3f9a1c2e","data/sets/sv03.5.json":"…","data/market/prices/sv03.5.json":"…"}}` —
8-hex content hashes of every file under `data/` (JSON and .bin). `net.data()` appends `?h=<hash>`; without a
manifest (local dev) it fetches the plain path with `cache: 'no-cache'`.

## 7. Service worker and release (F2) — FINAL-perf §4.8 with its [FC] fixes, FINAL-images §3.5

- App shell precached under `cardex-app-<VERSION>`; `tools/release.py` stamps `VERSION` (content hash, CRLF-normalised)
  and `SHELL` (index.html, manifest, icon, every file under css/, js/, fonts/), writes data/manifest.json.
  New version → toast « Nouvelle version disponible · Recharger » (skipWaiting on tap, reload on controllerchange).
- `data/manifest.json` network-first 3 s; `data/**?h=` cache-first (`cardex-data`, purge hashes not in the manifest);
  `img/**` cache-first; `vendor/**` cache-first; `api.tcgdex.net` GET network-first, cached copy after 4 s **only if
  one exists**, cap 400; images (assets.tcgdex.net, images.scrydex.com, tcgplayer-cdn.tcgplayer.com,
  raw.githubusercontent.com, cdn.jsdelivr.net sprites) cache-first with **CORS fetch, `res.ok` only**, FIFO caps
  (`cardex-img-cards` 3000, `cardex-img-sealed` 800, `cardex-img-dex` 1100). Never cache opaque or error responses.
- `activate` deletes only `cardex-` caches that are old (`cardex-app-*` ≠ current, `cardex-shell-*`, `cardex-images-v1`);
  never touch other caches of the shared github.io origin.
- Keep `periodicsync` (tag `cardex-prices`) and `notificationclick` (opens `./#/marche/envies`).
- Every `<img>` of those hosts carries `crossorigin="anonymous"` (consistently for a given URL).

## 8. Prices: rules and wording

- Cards: price files first (§6.4); TCGdex live pricing with the cmFor() fix only as a fallback on the card page.
  A finish without a price shows « — » (never the normal price instead). Collection value = Σ known prices; show the
  number of cards without a price in the value sheet.
- Sealed: `eur` (trend) as headline, « dès X € » when `low` is plausible; changes only from our history.
- Credits (Réglages and the ⓘ sheets, plain text, no Cardmarket logo): « Cotes Cardmarket (tendance, toutes langues),
  mises à jour chaque nuit · prix du JJ/MM/AAAA. Cardex n'est pas affilié à Cardmarket. » · « Données des cartes :
  TCGdex » · « Noms des Pokémon : PokéAPI » · « Photos des produits : TCGplayer (version anglaise) » ·
  « Certaines illustrations : version anglaise (TCGdex, Scrydex) ».
- Never show USD, never mention TCGplayer prices, never « marché américain ».
- Links: « Voir sur Cardmarket » = `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=<English name>`.

## 9. Images and set visuals

- Card images: FR → same card in English (TCGdex EN, then Scrydex allowlisted ids) → same illustration from a reprint
  (`alt`) → sober placeholder. « EN » pill on tiles ≥ 56 px, caption on the card page (« Illustration de la version
  anglaise »), « ≈ » + « Même illustration que … » for reprint art. Thumbnails `low`, card page `high` after `low`.
- "Covers de séries" = **set logos** (decision: logos, as Dex and Pokécardex do; booster photos rejected, FINAL-images §6).
  185/185 sets show a real logo or a generated cover, never a text plate repeating the name. Set page header: large
  logo + symbol + code + date + legality + counts + progress.

## 10. Scanner UX (W2 scanner owner, on top of SC's API) — FINAL-design W-A/W-B + FINAL-scanner §5.7

Full-width viewfinder (safe areas), overlaid photo / shutter / torch / zoom, status pill (`aria-live`), detected quad
drawn (green corners when 4 sides found), « Ajout : Normale ▾ » preset chip. Result panel over the bottom of the
viewfinder (fully visible on 375×667): image, name, set, number, price, finish chips (+1 each, Annuler toast), other
candidates / reprint alternatives as one-tap chips, « Pas la bonne ? » top-5, « Chercher par nom » → `#/series?q=`.
Uncertain state « Laquelle est-ce ? » with top 3 at once. Photo import uses `identifyImage`. Camera stops on hide and
restarts on show. Permission states (not https, refused, no camera) as empty states. Session list of cards added in
this scan session (with undo) — new feature.

## 11. Feature parity checklist (nothing is removed)

FINAL-design §3.2 table, plus: master set (Poké Ball, Master Ball, Cosmo) per set from the static finishes (no more
« Analyser » loop), checklist ticks with double-tap safety, binder 9 per page with swipe and ←/→ keys, Doubles trade
list copy (clipboard + fallback sheet, includes envies), 18 achievements with toasts, value curve, Pokédex with counts
and the Pokémon page (every card of a Pokémon, incl. Méga-Évolution sets, owned first), decks by season with search,
playable/almost filters, add missing cards to envies, Limitless link, sealed ideas (6 sections), catalogue with type
chips and counts, product chart with ranges and readout, Mon scellé (invested, value, gain, yield), Envies with
notification permission and price check, tab badge when an alert is in range, backup export/import/clear, theme setting.
New: global search (cards + series) on Séries, offline browsing of every set, set value (sum of prices) on the set
page, sort a set by price, scan session list, « prix inchangé depuis », backup reminder, storage status in Réglages.

## 12. Acceptance (checked by QA, measurable)

- Widths 320, 360, 390, 430, 768, 1280: `scrollWidth === innerWidth` on every route; light and dark.
- First content ≤ 260 px from the top on every tab root; scan result fully visible on 375×667 and 390×844.
- ← top-left on every non-root route; browser/Android Back returns to the previous screen with its scroll; reload
  restores route + filters; re-tapping the active tab returns to its root; Back from a non-start root → Collection → exit.
- Router scenarios (tools/tests/router_test.py) all pass against the real app; store tests pass (migration, import
  validation incl. the HTML-injection payload, multi-tab).
- No console error on any route; no request to pokemontcg.io; no opaque responses in Cache Storage.
- Performance (CPU ×4, compare A/B in one run): INP ≤ 200 ms on Collection / Série / Pokédex with a 2 000-card
  collection; "+" on a visible tile ≤ 50 ms; set page = ≤ 2 static data requests (+ images); Séries fully scrolled ≤ 1 MB;
  ≤ 180 KB before the first screen is usable; no long task > 50 ms at startup.
- Images: no grey box for a card that has an image in FR or EN; no text plate for a set logo.
- Prices: only euros/Cardmarket anywhere; holo / reverse / Poké Ball / Master Ball prices follow §6.5.
- Scanner benchmark (tools/scan_bench.py): synthetic dup-tolerant top-1 ≥ 97 %, accepted precision ≥ 99.5 %, false
  accept with the card absent ≤ 2 %, identify p50 ≤ 300 ms at CPU ×4; bit-exactness ≤ 4/512 bits.

## Changelog (wave 1)

Changes made while integrating wave 1 (26/11/2026). The sections above stay the contract; this list says what moved.
Details and examples for view owners: `docs/refonte/WAVE1.md`.

**§2 Layout and ownership**
- `icon-180.png`, `icon-512.png` (manifest and apple-touch icons) belong to F1; `tools/release.py` precaches them.
- `css/views/<view>.css` exist as empty commented placeholders (no 404); view owners fill them.
- `tools/tests/sw_test.py` and `tools/tests/f2/*` belong to F2; `tools/catalog/*` to CA; `tools/market/*` to MK.
- `.github/workflows/site.yml` replaces `sealed.yml` (its builder `tools/build_sealed.py` is gone): daily Cardmarket
  data, weekly catalogue + scanner, `tools/release.py`, GitHub Pages deploy. The repository's Pages source must be
  switched to « GitHub Actions » when `refonte` is merged (price files are not committed: a branch deploy would
  serve a site without prices).
- Test servers use a listen backlog of 128 (`request_queue_size`): the default 5 made Windows refuse bursts.
- `tools/tests/wave1_test.py` (integrator): storage-failure toast, service-worker `navigate` message, v1 finish
  repair, bloc order and flags, progress goal, in the real app.

**§3.1 View contract** (added by F1, binding for W2)
- `r.signal` (AbortSignal) is aborted as soon as the route changes. Pass it to `setBar({ …, signal: r.signal })`,
  `revealTitle(on, { signal })`, `setProgress`, `updateAction`, and to fetches; stop after every `await` if
  `r.signal.aborted`. A bar set by a view that was left is ignored.
- `resume(r, el)` (optional) is called instead of `show()` when the view cache is hit (same hash, `show()` had
  completed). A view without `onChange` is marked stale on collection changes and fully re-shown next time: a view
  that displays collection data must implement `onChange`.
- Links and ids: `router.cardHref(id, finish?)`, `router.setHref(id)` (encode once); read ids with
  `router.cardId(r)` / `router.param(r, i)` (decoded, never throws; old unencoded links still work); display numbers
  with `format.localNo(localId)` / `format.cardNo(localId, total)` (`exu-%3F` shows « ? »).
- `primaryTabs(items, current)` goes directly in the view's `<section>` or in a `.ptabs-slot` (display: contents),
  otherwise the tabs cannot stick under the app bar.

**§5 Module APIs** (additions only; every signature above still holds)
- appbar: `setBar(cfg, { signal })` (or `cfg.signal`), `updateAction(i, patch, { signal })` patches in place,
  `primaryTabs(items, current, label)`, `getBar()`, `focusTitle()`. dom: `selectChip({ label, options, value, name })`,
  `enhance(root)`, `isSafe`. format: `localNo`, `dateDay`, `timeFr`, `toDate`. toast: returns `{ el, close }`;
  `ms: 0` = persistent (comes back after passing toasts). idle: `yieldToMain()`. net: `manifest()`, `hashOf(path)`.
- collection: `storageState()` `{ readOnly, error, notice, message, corrupt, backups[{key, at, size}], bytes }`,
  `corruptText(key?)`, `deleteBackup(key)`, `discardCorrupt()`, `STORAGE_MESSAGES`, window event `cardex:storage`
  (`detail { error, message, repeat, recovered, readOnly, corrupt }`, shown by main.js as a persistent toast with
  « Exporter »); `importText()` also returns `saved`; `clearAll()` returns whether it was saved; `has`, `total(rec)`,
  `inSet(setId)`, `updateMeta(card)`, `ensurePrices()`, `exportText()`, `lastExport()`, `legacySealed()`,
  `linkLegacySealed(map?)`; `stats()` also returns `pending`. New (INT): `needsFinishCheck()`,
  `repairFinishes(cards)`, `finishCheckDone()`: v1 data recorded « normale » on holo-only cards (old scanner
  preset); main.js loads the owned sets at idle and turns those into « holo » (the only finish Cardmarket prices).
- catalog: `metaSync(id)`, `setSync(id)`, `loadSets(ids)`, `warmIndex()`, `onUpdate(fn)`, `localIdOf(id)`,
  `goalOf(meta)` (INT: progress goal = `count` when the French catalogue has fewer cards than the printed `total`,
  else `total`); briefs carry `setName`, `setTotal`; `search()` also returns `count`; `cardsOfDex(n, { full })`.
  Blocs keep the order of `sets.json` (main eras newest first, then `special` blocs) and carry `dark`, `special`.
- images: `imgCaption(card)`, `cardNo(card)`, `registerSets(metas)`; `cardImg()` also returns `ref` (source card of
  a borrowed illustration). Only `https://assets.tcgdex.net/fr/` image bases are trusted.
- prices: `on(fn)`, `version()`, `has(setId)`, `sum(entries)`, `cmFor(full, finish)`, `liveSync(full, finish)`,
  `creditText()` (INT: full §8 line with the guide date). `get()` adds `allEditions: true` (INT) when a
  `firstEdition` / `stamp` entry is the base card's price (MK copies it when Cardmarket has no separate product):
  show « prix toutes éditions », never as a real 1st-edition price.
- dex: `nameOf(n)`, `loaded()`, `count()`, `artwork(n)`, `words(s)`, `dexNums(card)`. finishes: `FOIL`, `isFinish`,
  `order`, `sortFinishes`, `finishesOf(full)`. tcgdex: `toBrief`, `toMeta`, `setList`, `setInfo`, `isPocket`.
- tile: `tileHTML(card, { …, label })`, `refreshImages(root)`. chart: `deltaHTML(v, { kind, per })`,
  `lineChart(el, points, { ranges, format, range, onRange, label })`.
- scan (§5.7): `createLoop({ video, guide, onState, onResult, auto = true })` →
  `{ start, stop, shutter, resume, hold, setAuto, setGuide, state, destroy }`; states add `error`
  (`s.error` = NetError kind, automatic retry); several `choose` results may arrive for one card (each replaces the
  previous); results add `why`, `token`, `level`, `region`; image-less twins appear with `d: null`. After the user
  picks from a chooser, call `loop.hold()`. Also `ScanError` (kind `decode`, « Image illisible »), `imageSize(blob)`,
  `scanData()`, `warmOcr()`, `ocrFallback(null, { token })`; `preload()` returns `canvas`.

**§6 Data**
- §6.1 `sets.json`: bloc entries gain `dark` and `special`; image names are a hash of the *source* bytes + settings
  (stable across Pillow/libwebp versions, existing files never rewritten), not of the output; logos are WebP q70.
  `pl4` has `total = count = 9`. `count` can be lower than `total` (svp, swshp, dpp, np, basep, tk-sm-l, tk-sm-r):
  use `catalog.goalOf()` for progress.
- §6.3 target ≈ 145 KB gzip (measured 142.8 KB).
- §6.4 `cardimg.json` also has `from` (source card of an `alt` illustration).
- §6.5 measured sizes replace the targets: price files 306 KB gzip (186 files), `sealed.json` 143 KB gzip.
  `cm-map.json` has an additive `unlinked` key (app cards the weekly build could not link; the daily build rebuilds
  the table when the app has cards it never saw). Price keys are always kept for normal, reverse, holo, cosmos,
  Poké Ball and Master Ball (collections from the old app), 1st edition / stamp only where CA's `f` lists them.
  Sealed: `eur: null` = « Pas de vente récente » (history may still exist); `sid` can name a set that is not in the
  French catalogue (bw11, gym1, base4…): show `set`, no link.
- §6.6 `cards.json` also has `algo`, `img` and `twins` (image-less or same-art twins; a card with a twin always
  gives `choose`). Same-name twins (trainer kits, McDonald's, Classic Collection) are dropped when both TCGdex
  illustrators are known and clearly different (INT; GraphQL `illustrator`, cached in `.cache/sc/tcgdex/illus/`,
  typos such as « Rya Ueda » / « Ryo Ueda » tolerated); unknown illustrators keep the twin (safe side).
- §6.7 / §7: the committed `sw.js` stays in development mode (empty `SHELL`); it keeps what the first visit loaded
  (offline reload works). Only the deploy (`site.yml`) stamps it. Never commit a stamped `sw.js` or
  `data/manifest.json` (gitignored; a stale manifest makes newer data files look absent).

**Open (decision for the orchestrator)**
- §12 scanner « card absent ≤ 2 % »: 4.7 % overall (SC, standard preset, 300 cases), 3.5 % after the illustrator
  check of the twins (INT, 200 cases); 0.6–1.2 % on unique-art cards, 18–20 % when a same-art reprint of the masked
  card is in the database (in real use both are). Target kept, not met.

## Changelog (wave 2)

Changes made by the wave 2 view owners and while integrating them (28/11/2026). The sections above stay the
contract; this list says what moved. State, tests and open items: `docs/refonte/WAVE2.md`.

**§2 Layout and ownership**
- Shared view helpers: `js/views/setrow.js` (V-SER: set row and progress, used by Séries and Série) and
  `js/views/ptile.js` (V-MKT: product tile and row, used by Marché and the product page). Sub-modules live in
  `js/views/{collection,carte,scanner,marche,decks}/`. `js/features/*` belong to V-COL, `js/data/sealed.js` to V-MKT,
  `js/data/decks.js` to V-DECK.
- `tools/shotsteps/V-COL.json`, `V-SER.json`, `V-CARD.json`, `V-SCAN.json`, `V-MKT.json`, `V-DECK.json` (133 steps)
  next to F1's `shell.json` (26): `tools/shots.py` plays all 159.
- Tests adapted at integration (no app code changed): `tools/tests/router_test.py` 91 removes the Scanner's
  `onChange` for the duration of the check (every view has one now); `tools/tests/sw_test.py` « données ?h= » opens
  every bloc (prefs `openBlocs`) before browsing Séries offline (blocs are collapsible, only the first one is open in
  an empty collection).

**§3 Navigation** (query parameters added or made precise; all go through `setParams`, kept on reload)
- `#/serie/:setId`: `tri=prix|prix-asc|nom` (sort by price, SPEC §11 « new »; the binder has no filter or sort),
  `page` = binder page (9 pockets).
- `#/collection/pokedex`: `filtre=possedes|manquants`; `#/pokemon/:n`: `filtre=possedees|manquantes`.
- `#/marche/cotes`: `filtre=hausse|baisse|cheres`. `#/marche/scelle`: `langue=int|ja|tout` (default from prefs
  `sealedLang`), `type` = a product kind or `suivis`, `tri` = `new`, `c7…c365` (up), `b7…b365` (down), `mult`, `asc`,
  `desc`. The Scellé and Cotes tabs reopen the last view and filters.
- `#/decks/*`: `filtre=jouables|presque`, `tri=joues|complets|reste|prix`, `saison=<period id>` (Saisons passées only;
  the last season is kept when passing through Méta actuelle); `q`, `tri` and `filtre` follow from one section to
  the other.
- Unknown ids show an empty state with a way out: « Série introuvable », « Carte introuvable », « Produit
  introuvable · Voir le catalogue », « Ce deck n'est plus dans la liste · Voir les decks ».

**§3.1 View contract**
- All eleven views implement `onChange` (the Scanner too: it patches an open result) and `resume()`, which redoes
  only what changed while the view was hidden (prices arrived, collection changed, failed load retried).
- Collection grids (Cartes, Pokédex, Doubles, Pokémon page) render in batches paced by `requestAnimationFrame` then a
  task (`js/views/collection/grid.js`); the other long lists still use `core/list.js` `renderChunked` (open item in
  WAVE2.md §7).

**§5 Module APIs** (additions by the view owners)
- `js/features/achievements.js`: `list()` → 18 achievements in 5 groups; storage `cardex.ach.v2` (v1 migrated);
  date 0 = reached before tracking (no toast on migration or first launch); « Tout effacer » then « Annuler » within
  2 min restores the earlier dates. `js/features/valuehistory.js`: `cardex.history.v1`, one point per day `{ d, v, n }`.
- `js/data/sealed.js` (V-MKT): `load()`, `get(id)`, `KIND`, `CHIP`, `SORTS`, `PERIODS`, `change()`, `stillSince()`,
  `matcher()`, `warmSearch()`, catalogue and ideas helpers. `js/data/decks.js` (V-DECK): `load()`, `current()`,
  `past()`, `status(deck)` (memoised on collection rev + price version), `priceOf()`, `cheapest()`, `toBuy()`,
  `linked()` (`OUTSIDE` = sets known to be absent from the French catalogue: `bw11`), `best()`.
- Prefs keys added: `scanCam` (camera left off by the user stays off), `setListTip`, `backupReminder` (Réglages
  switch); `sealedLang` also takes `'ja'`. Session storage: `cardex.scanSession.v1` (scan session list).
- Wishes created by the card page and by « Ajouter les manquantes aux envies » get a max of 90 % of the cote, and the
  toast says when they are already in range. A `firstEdition` / `stamp` price with `allEditions` never suggests a max
  and is never written into a wish (card page) and is kept out of En hausse / En baisse (Cotes).

**§11 Feature parity**: where each feature lives is in `docs/refonte/WAVE2.md` §2. Decks count only the 9 basic
energies as owned basic energy (special energies such as Jet or Mist are cards to collect).

**§12 Acceptance** (measured at integration, details in WAVE2.md §3 and §5)
- Exception pending a decision: Collection › Cartes with the backup reminder shows its first tile at 293 px (253 px
  without it); the summary value is at 149 px. The reminder is one line at the top (FINAL-design W-V), temporary.
- Router scenarios 98/98, store 16/16, data 21/21, `wave1_test` 13/13, `sw_test` 11/12 (development worker only);
  `tools/shots.py`, 159 steps × 320/360/390/430/768/1280 × light/dark: 1 908 captures, 0 problems; no request to
  pokemontcg.io on any route.
- « ≤ 180 KB before the first screen is usable » (CPU ×4, gzip, before the first content): Collection 172, Séries 181,
  Série 191, card page 202, Scanner 192 (its card database follows); screens that need a large data file are above
  (Scellé 342, Decks 299, Pokémon page 461). Open for QA: count only the shell, or trim it (font 56, view CSS 20).
- « No long task > 50 ms at startup »: none in 3 cold starts of 11 routes at CPU ×4 at integration; owners saw a
  49–57 ms task (`main.js` evaluation, shell's first frame) in about one run in three. Open (F1).
