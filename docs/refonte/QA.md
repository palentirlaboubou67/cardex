# Cardex overhaul — final QA (wave 3)

Wave 3 audited the overhaul from five angles (visual, user journeys, performance and offline, data, scanner), then
three fixers and the scanner auditor corrected what was found. This file is the final verification of the result:
what was audited, every finding and its status, the final test results with their commands, the SPEC §12 numbers,
the scanner before and after on real photos, what is still known to be missing, and a go/no-go for publishing.

Date: 28/11/2026. Branch `refonte`, commit `f715215` plus the uncommitted wave 3 changes (fixers, scanner auditor and
the final verifier, listed in §3). Nothing is committed; `sw.js` is still in development mode (`VERSION = 'dev'`)
and there is no `data/manifest.json` in the working tree. The live site (branch `main`) was not touched.

Progress logs: `docs/refonte/progress/QA-SCAN.md`, `FX-SHELL.md`, `FX-VIEWS.md`, `FX-DATA.md`. The contract is still
`docs/refonte/SPEC.md`; `docs/refonte/WAVE2.md` §7 listed the open items this wave closed.

## 0. Go / no-go

**GO for publishing, with the conditions of §8.** Every automated suite passes on the final tree, the 1 920 screen
captures show no problem at any width or theme, the production build works offline from the first visit with no
opaque response and no request to pokemontcg.io, the prices are Cardmarket euros only, and the scanner makes no wrong
automatic accept on the 506 verified real photos (it made 7 on import and 10 in camera mode before this wave).

Not met, and accepted as known limitations (§7): synthetic « card absent » false accepts 3.3 % (target ≤ 2 %; 1.4 % on
the 72 real absent cards); the 180 KB first-screen budget (met on Cartes, Pokédex and Séries, 188–349 KB on the other
roots); Séries fully scrolled with every bloc open 1 063 KB (target 1 MB). Nothing was tested on a real phone (iPhone
Safari, Android Chrome camera and Back button): do it right after the first deploy.

## 1. What was audited

| Audit | Scope | Method | Findings |
|---|---|---|---|
| QA-VIS | every screen, 6 widths × 2 themes, 375×667, empty states, skeletons, contrast, copy | `tools/shots.py` (1 908 captures) + contact sheets, WCAG contrast scan of 17 routes | 16 (4 major, 12 polish) |
| QA-FLOW | about 25 user journeys at 390×844 and 1280×800 | Playwright scripts f01–f23 (first launch, set page, card page, scanner photos and live, doubles, backup, v1 data, two tabs, Marché, Decks, navigation) | 8 |
| QA-PERF | production build, service worker, offline, `site.yml` | copy + `release.py`, GitHub Pages-like server (gzip, ETag), CPU ×4, 2 000-card collection | 10 |
| QA-DATA | prices, finishes, names, images, logos, sealed, decks, Pokédex | recomputation of all 30 981 price entries from the cached Cardmarket guide, 300-card sample, HEAD checks, 50 Pokémon pages in Chromium | 12 |
| QA-SCAN | scanner on 709 real photos | new real-photo bench (`scan_bench.py photos`), synthetic bench | 5 causes, fixed by the auditor |

Fix passes: FX-SHELL (shell, state, data layer, service worker, tests), FX-VIEWS (screens), FX-DATA (builders and data),
QA-SCAN (scanner core and screen). Then QA-FINAL (this file): every suite, shots at 6 widths, scanner benches,
production check, a re-run of the QA-FLOW journeys and targeted browser checks of the fixes.

## 2. Findings and their status

Status after QA-FINAL. « Re-checked » = seen again in Chromium on the final tree (scripts in §9).

### QA-VIS (16)

| Finding | Status |
|---|---|
| Sealed products without photo (1 586 of 3 059) | **Partly fixed.** 682 products whose set is in the catalogue get a generated tile (set logo + type); the others keep the type pictogram; product page placeholder 120 px instead of a grey slab. Japanese photos need the builder (TCGCSV category 85): open. |
| Card placeholders turn into a rainbow in dark mode | Fixed (holo layer hidden on placeholders). Re-checked: `#/serie/2013bw?master=1`, `#/carte/2013bw-1`, dark, 0 visible `.fx` on 5 placeholders. |
| Thousands separator invisible (U+202F not in the font) | Fixed in `format.js`. QA-FINAL found three new direct `Intl` paths still printing U+202F and fixed them (§3). Re-checked: 0 U+202F in the visible text of 26 routes × 2 themes. |
| Tile captions hide the card number | Fixed (« numéro · série » by default). The Pokémon page and Doubles still passed their own caption: done by QA-FINAL (§3). Re-checked. |
| Cotes: 30-day average cut | Fixed (« 7 j 1 726 € · 30 j 1 166 € », wraps at « · »). |
| Decks: meta line cut | Fixed (« 36,7 % · 3e · São Paulo »). |
| Catalogue rows: « suivi » flag cut | Fixed. |
| Alert / envie naming | Fixed (« envie » everywhere for the saved object). |
| Price ranges written two ways | Fixed (one `rangeText`). |
| Set page skeleton jump | Fixed (header reserved at its final height). |
| « EN » pill over the card name | **Fixed on the card page only.** On grid tiles the « EN » / « ≈ » pill still sits top-left over the printed name: open (polish, `base.css`). |
| Réglages check mark next to « Non » | Fixed. |
| Envies lines cut, trailing periods | Fixed. |
| Trainer-kit names (« Kit dresseur », Lougaroc, Pikachu Catcheur) | Fixed in the data; the Marché chip still said « Kit du Dresseur »: done by QA-FINAL. |
| Mixed apostrophes | Fixed (’ everywhere; search folds both). |
| (16th polish item) | Not named in any fix report, so its status is unknown; the 1 920 captures of this final pass show no problem. |

### QA-FLOW (8) — all re-checked by re-running the QA-FLOW scripts on the final tree

| Finding | Status |
|---|---|
| Price alerts created already in range (never notify) | Fixed (suggested max = 90 % of the lower of cheapest offer and cote). Re-checked: suggested wish « Ajoutée à tes envies », not in range. |
| First « Succès débloqué » replaces the « Annuler » toast | Fixed (achievement waits for action toasts). QA-FINAL follow-up: the « Ajout annulé » confirmation was then replaced within 0.4 s; it now stays at least 1.5 s (§3). |
| Scan session « Annuler » can remove a copy owned before the scan | **Not in any fix report: fixed by QA-FINAL** (§3). Re-checked with the QA-FLOW scenario: 2 owned, +1 scanned, −1 on the card page, session « Annuler » → still 2. |
| v1 followed products hidden until Mon scellé is opened | Fixed. Re-checked: « Tes produits suivis » in Pistes and watch `[719693, 719694]` before Mon scellé is opened. |
| v1 backup imported in a running app: finishes repaired only after reload | Fixed. Re-checked (import, export in the same session, re-import elsewhere: holo, no `fixFin` left). |
| Links to another tab (toast « Voir », scanner « Chercher par nom », empty states) | Fixed in the views; the scanner result links and the wish toast « Voir » were still switching tabs: done by QA-FINAL. Re-checked: scanner → « Chercher par nom » → Back returns to the scanner with its result; wish toast « Voir » from a set page → Back returns to the set. |
| Mon scellé price prefilled with the cote | Fixed (empty field + « Utiliser la cote »). |
| Empty Collection « Importer une sauvegarde » only opens Réglages | Fixed (opens the file picker). Re-checked. |

### QA-PERF (10)

| Finding | Status |
|---|---|
| Startup long task > 50 ms in 81 of 84 starts | Fixed. Final measure (§5): no task over 50 ms before the first content in 84 of 84 starts. |
| 180 KB before the first screen | **Partly fixed** (view CSS loaded on first visit, `tcgdex.js` on demand): Cartes, Pokédex and Séries under 180 KB; the others above (§5). |
| Doubles waits for every owned price file | Fixed (renders at once, re-sorts when prices arrive). |
| Séries fully scrolled 1.27 MB | **Improved, still over**: 1 063 KB with every bloc open (559 KB with the default blocs); set logos are 711 KB of it. |
| Offline browsing only from the second launch | Fixed. Re-checked §4: 186/186 sets and 280/280 logos offline 25 s into the first visit. |
| First install downloads the whole shell again | Fixed (`cache: 'no-cache'`, ETag revalidation). |
| Cache caps enforced once a minute only | Fixed (`sw_test` caps case). |
| « + » on a Série row over 50 ms | Not reproduced (median 40 ms, max 48 ms); the hidden Collection patch was moved out of the tap's frame anyway. |
| Collection `show()` waits for every tile | Fixed (first batch only). |
| `site.yml` could read Cardmarket more than twice a day | Fixed (Monday cron, one request per file per run, push = cache only). |

### QA-DATA (12)

| Finding | Status |
|---|---|
| 184 shared Cardmarket products (≥ 201 cards with another card's price) | Fixed (182 cards moved; 2 edge cases left: xy8-31/32, xyp-XY111/187). Re-checked in the app: xy2-100 281,61 €, sm10-205 889,87 €, sm10-201 428,77 €, sm12-237 11,59 € / sm12-29 0,11 €, ecard1-40 79,26 €, ecard1-55 36,94 €, g1-RC29 47,78 €. |
| 250 phantom « Holo » next to « Cosmo Holo » | Fixed. |
| bw8, bw9, bw10, me06: reverse and holo missing | Fixed, and extended to the XY and Sun & Moon eras by a rarity rule (see §7: master sets of those sets gained finishes). Re-checked: bw9-1 Reverse 1,32 €. |
| 89 plain finishes priced from a stamped print | Fixed. Re-checked: sv03-022 Holo only (0,81 €). |
| Jungle / Team Rocket 1st edition priced with the holo's product | Fixed. Re-checked: base2-17 « 1re édition » 2,47 €, « prix toutes éditions ». |
| Base Set 1st edition is the Shadowless price | Fixed (6th value read by `prices.js` and `wishes.js`). Re-checked: base1-4 1re édition 3 096,21 €, « Prix toutes éditions ». |
| me02.5 reverse priced from a Ball reverse | Fixed. Re-checked: me02.5-153 Reverse 2,35 €. |
| Broken-trend guard | Fixed with a majority rule (same in MK, `prices.js`, `wishes.js`). Re-checked: smp-SM163 233,38 €, ex5-94 77,32 €. |
| 59 cards without any price | Mostly fixed (26 → 5 unlinked; bwp-BW20/22/77/78 and dpp-DP53 show « — »). |
| Métamorph V in deck 2223-188 | Fixed. |
| me06 English logo, 21 Scrydex symbols hotlinked | Fixed (generated covers, no Scrydex logo or symbol). |
| tk-ex-p « Positi » | Fixed (« Posipi »). |

### QA-SCAN (5 causes, fixed by the auditor)

| Cause | Status |
|---|---|
| All 10 camera wrong accepts were one illustration in two prints | Fixed (`arts` table, 271 pairs; these pairs always go to « Laquelle est-ce ? »). |
| Number-zone check cannot separate two prints of one artwork | Fixed (never accepted on the number zone alone; OCR can still confirm). |
| Absent cards accepted as their reprinted original | Fixed (+115 image-less twins). 9 Classic Collection cards still have no twin. |
| Camera detection stuck on a frame or holder edge | Improved (geometric seeds, recentring). Slabs and toploaders remain the weak spot. |
| Photo import misses half the cards | Fixed (import rewritten): top-1 78.5 → 87.2 %. Slower (p50 1.7 s at CPU ×4). |

### WAVE2 §7 open items

All closed (FX-SHELL, FX-VIEWS, FX-DATA, QA-SCAN), except the two orchestrator decisions: the Collection backup-reminder
exception (first tile at 293 px when the reminder shows) and the scanner « card absent » target.

## 3. Changes made by the final verifier

Leftovers of the fixes: cross-owner requests that nobody did (the fixers worked in parallel and could only edit
their own files), one finding that fell between owners, and two small regressions of the fixes themselves.

| File | Change | Why |
|---|---|---|
| `js/views/marche/cotes.js` | `nbsp()` around the new « sans centimes » formatter | Regression of the fixes: the new short averages (FX-VIEWS) called `Intl` directly, so « 7 j 1 174 € » showed the near-invisible U+202F again |
| `js/data/decks.js`, `js/views/produit.js` | `nbsp()` around the share % and the « ×N » multiple | FX-SHELL request to FX-VIEWS, not done |
| `js/views/pokemon.js` | default tile caption (« 057 · Étincelles Déferl… ») | FX-SHELL request: the number was cut by long set names |
| `js/views/collection/doubles.js` | caption « 2 ex. · Stars… » (count first, also in the patch) | FX-SHELL request: the count was cut |
| `js/data/sealed.js` | chip « Kit du dresseur » | FX-DATA request (same spelling as sets and products) |
| `js/views/scanner/panel.js` | `data-push` on the three « Chercher par nom » links of the result panel | QA-FLOW finding, FX-VIEWS request: Séries now opens over the scanner and Back returns to the result. The camera-unusable state keeps its tab switch (router_test 40 uses it as the reference « link to another tab's root ») |
| `js/main.js` | wish toast « Voir » uses `router.go` | FX-VIEWS request (same as the achievement and card-page « Voir ») |
| `js/views/scanner/session.js`, `js/views/scanner.js` | session entries remember how many copies existed before the first scan of that card and finish (`base`); « Annuler » (session list and toast) never goes below it; « … : ajout déjà retiré de ta collection » when there is nothing left to undo; entries saved before this change behave as before | QA-FLOW finding absent from every fix report (data loss: it removed a copy owned before the scan) |
| `js/features/achievements.js` | a toast without action (« Ajout annulé ») stays at least 1.5 s before « Succès débloqué » replaces it | Regression of the toast fix: the queued achievement replaced the undo confirmation within 0.4 s |

Each change was re-checked in Chromium (§9) and is covered by the final runs of §4.

## 4. Final test results

Python with `python -P`, Chromium through Playwright, QA-FINAL ports 8920–8926 (one server per parallel run), outputs
in the scratch folder (§9). The six suites were run twice, the second time after the last QA-FINAL change (same results,
`logsinal_*.log`). The full shots run started before the last two small changes of §3 (camera-unusable link revert,
achievement toast delay); `shell`, `V-SCAN` and `V-COL` were run again at 390 light and dark on the final tree:
122 captures, 0 problems.

| Command | Result |
|---|---|
| `python -P tools/tests/router_test.py --port 8921` | **98/98**, no JavaScript error (a first run gave 96/98: tests 40/40b failed because QA-FINAL had also put `data-push` on the camera-unusable link; reverted, see §3) |
| `python -P tools/tests/store_test.py --port 8921` | **16/16** |
| `python -P tools/tests/data_test.py --port 8921` | **21/21** |
| `python -P tools/tests/sw_test.py --port 8921` | **12/12** (11/12 at wave 2) |
| `python -P tools/tests/wave1_test.py --port 8921` | **RESULTAT OK** (18 checks) |
| `python -P tools/market/test_market.py` | **113 checks, all pass** |
| `python -P tools/shots.py --port 8920 --width 320,360,390 --themes light,dark` and `--port 8926 --width 430,768,1280 --themes light,dark` (all 160 steps) | **1 920 captures (160 steps × 6 widths × 2 themes), 0 problems**: no JavaScript error, no local 404 apart from the allowed development `data/manifest.json`, no overflow, no clipped element, ← on every sub-page and never on a root, titles « … · Cardex », primary tabs sticky. TCGdex API answered 4 card-page steps with a CORS / network failure in one pass (rate limiting on their side; the page falls back and the tool lists it apart). Captures looked at: Cotes at 320, scanner result at 320, Séries at 1280 dark, plus the QA-FINAL targeted captures (§9) |
| `python -P tools/scan_bench.py all --port 8922 --real <scratch>/dl-scannercheck/real --cases <scratch>/work-sc/real_cases_fc.json` | 9 of 10 SPEC rows OK (§5); « card absent » 3.3 % (target 2 %) |
| `python -P tools/scan_bench.py loop --port 8922` / `api --port 8922` | loop 6/6 scenarios OK; api 14/14, 0 console error |
| `python -P tools/scan_bench.py photos --port 8922 --labels <scratch>/realphotos/labels.json --work <scratch>/QA-FINAL/photos --tag qafinal` | identical to the QA-SCAN « after » run (§6) |
| Production check: copy of the repository (without `.git`, `.cache`, `legacy`), `python -P tools/release.py` in the copy, `_site` built like `site.yml`, served gzip + ETag + max-age 600 (scratch `prodcheck/build.py`, `offline.py`) | VERSION stamped, SHELL 85 files (the six view stylesheets included), `release.py --check` OK, manifest 717 files; worker in control 0.3 s after the first load, `cardex-app` 85/85; 186/186 sets and 280/280 logos available offline 25 s into the first visit; Cache Storage types `basic`, `cors`, `default` only, **0 opaque, 0 error**; offline (server cut + browser offline), load and F5 work on the 12 tab roots, a visited set, card, Pokémon page, product and Réglages, and on unvisited sets (base1, swsh3, placeholders for uncached images); an unvisited card shows « Détails indisponibles · Hors ligne · Réessayer »; **0 request to pokemontcg.io** (4 590 local, 1 946 external requests: assets.tcgdex.net, api.tcgdex.net, cdn.jsdelivr.net, images.scrydex.com card images, tcgplayer-cdn photos). Run twice (after the first build and on the final build): same result; the only console messages are `net::ERR_FAILED` for card images not cached while offline |
| QA-FLOW journeys re-run (f02, f05, f07, f10, f12, f14, f17, f19, f21, f23) + QA-FINAL checks (`vis.py`, `q_session.py`, `q_toastundo2.py`, `q_wishrelaunch.py`, `q_panel.py`, `q_prices.py`) | all behave as described in §2; only console error the allowed development 404 of `data/manifest.json` |

The repository was left as found apart from §3 and this file: `sw.js` still `'dev'`, no `data/manifest.json`, no new
file outside `docs/refonte/QA.md` (the tests write into `.cache/` and the scratch folder).

## 5. SPEC §12 — measured vs target

| SPEC §12 item | Target | Measured (final tree) | |
|---|---|---|---|
| No horizontal overflow, 6 widths × light/dark | `scrollWidth === innerWidth` | 0 of 1 920 captures over (`scrollWidth` = `innerWidth` everywhere) | OK |
| First content on tab roots | ≤ 260 px | highest 260 px (Séries with a bloc folded); Collection › Cartes 253 px without the backup reminder (293 px with it: pending exception) | OK |
| Scan result fully visible | 375×667 and 390×844 | result panel 198–611 px at 375×667 (candidates end at 595, tab bar at 611), chooser 230–611; 375–788 at 390×844; 171–584 at 360×640; no inner scroll | OK |
| ←, Back, reload, re-tap, Back chain | all | router_test 98/98; QA-FLOW navigation journeys re-run | OK |
| Router and store tests | all pass | 98/98, 16/16 | OK |
| No console error, no pokemontcg.io, no opaque cache | 0 / 0 / 0 | 0 errors in every suite and capture (only the allowed development `manifest.json` 404); 0 pokemontcg.io; 0 opaque | OK |
| INP on Collection / Série / Pokédex, 2 000 cards, CPU ×4 | ≤ 200 ms | worst interaction 112 ms (tab bar → Collection with 2 493 tiles), Back from a card to Cartes 104 ms, value sheet 88 ms, keyboard sort 40–72 ms, Pokédex 16–40 ms, Série 16–40 ms (`prodcheck/inp.py --runs 2`, production build; the binder steps of the script time out on a stale selector, as in QA-PERF's runs: the binder is covered by the shots and QA-PERF's own measure) | OK |
| « + » on a visible tile | ≤ 50 ms | Série list « + » 40 ms; card page « + » with the 2 000-card grid mounted 32 ms | OK |
| Set page static data requests | ≤ 2 (+ images) | 2 (`data/sets/<id>.json`, `data/market/prices/<id>.json`; `sets.json` is shared and already loaded) | OK |
| Séries fully scrolled | ≤ 1 MB | default blocs 559 KB; every bloc open and scrolled **1 063 KB** (set logos 711 KB of it), `prodcheck/scroll.py` | **Not met** (+63 KB) |
| Before the first screen is usable (gzip) | ≤ 180 KB | Cartes 166, Pokédex 175, Séries 178.5 · Série 188, card page 188, Doubles 191, Mon scellé / Envies 197, Cotes 205, Decks 249, Scanner 254 (190 + its `cards.json`, 64 KB, which loads in parallel and often finishes first), Succès 272, Scellé 349 (body KB gzip before the first content, `prodcheck/perf_boot.py`, 3 cold starts each) | **Partly** (3 of 12 roots) |
| Long task at startup | none > 50 ms | 0 of 84 starts (14 roots × 3 cold + 3 with the service worker) had a task over 50 ms before the first content (QA: 81 of 84); 2 of 84 had one 52–59 ms task in the 3 s after it (Scellé cold, parsing `sealed.json`; Decks warm), with two shot runs loading the machine | OK |
| Images | no grey box when FR/EN exists; no text plate | QA-DATA: every card resolves except the 8 documented ones, none Japanese, 0 broken in 440 HEAD checks; 186 sets with a logo or a generated cover, 0 text plate | OK |
| Prices | euros / Cardmarket only; finish rules §6.5 | QA-DATA recomputation (30 981 entries) + FX-DATA fixes re-checked in the app; no USD in code or data | OK |
| Scanner synthetic top-1 (reprints tolerated) | ≥ 97 % | 99.0 % | OK |
| Scanner accepted precision | ≥ 99.5 % | 100 % (hard set 100 %, offline strict 100 %) | OK |
| Scanner false accept, card absent | ≤ 2 % | **3.3 %** (unique art 0.8 %, same-art reprint in the base 14.8 %); real absent cards 1.4 % | **Not met** |
| Identify p50 at CPU ×4 | ≤ 300 ms | 187 ms (machine loaded by parallel runs; 171 ms in QA-SCAN) | OK |
| Bit-exactness JS / Python | ≤ 4/512 | 0/512 | OK |

Performance rows: production build (`release.py` on a copy, served gzip + ETag), Chromium at 390×844, DPR 2, CPU ×4,
synthetic 2 000-card collection kept in the browser (never in the repository), scripts reused from QA-PERF and FX-SHELL
with QA-FINAL paths and port 8924. Two `shots.py` runs were loading the machine during the cold starts, so these numbers
are on the pessimistic side; all are in line with the FX-SHELL and FX-VIEWS measurements.

## 6. Scanner before / after on the real photos

`tools/scan_bench.py photos` (added by QA-SCAN) runs the real JavaScript on 709 labelled photos (scratch
`realphotos/`, never copied into the repository): **import** = the photo-import path; **camera** = a simulated guide
around the card (same placement as the synthetic « standard » preset); **oracle** = fingerprint at the true outline.
« Before » = the wave 2 code (QA-SCAN `base` runs), « after » = the final tree (QA-FINAL run `qafinal`, identical to
QA-SCAN's `final` / `final2`).

| 506 verified single-card photos (camera: 532 with the scene cards) | Import before | Import after | Camera before | Camera after |
|---|---|---|---|---|
| Right card first (top-1, reprints tolerated) | 78.5 % | **87.2 %** | 92.1 % | 91.9 % |
| Right card in the top 5 | 81.0 % | 90.1 % | 95.5 % | 95.1 % |
| Accepted automatically | 70.6 % | 72.3 % | 83.8 % | 74.1 % |
| Precision of the automatic accepts | 98.0 % (7 wrong) | **100 % (0 wrong)** | 97.8 % (10 wrong) | **100 % (0 wrong)** |
| Choice screen / right card among the 3 shown | 21.5 % / 49.5 % | 26.1 % / 67.4 % | 14.7 % / 79.5 % | 24.2 % / 86.8 % |
| Nothing found | 7.9 % | 1.6 % | 1.5 % | 1.7 % |
| False accepts, card absent from the base (72 photos) | 5.6 % | **1.4 %** | 8.3 % | **1.4 %** |
| Outline within 3 % | 323/505 | 376/505 | 364/531 | 405/531 |

- The camera accept rate is lower on purpose: the 10 wrong accepts were holo / non-holo or reprint pairs of one
  illustration, which now go to « Laquelle est-ce ? » with both prints shown.
- After, by holder (top-1 import / camera): bare 91 / 94 %, sleeve 100 / 97 %, slab 74 / 86 %, toploader 57 / 87 %.
  By era (camera top-1 / accepted): SV 99 / 86 %, ME 95 / 89 %, SWSH 94 / 89 %, SM 95 / 90 %, XY 83 / 57 %,
  WOTC 88 / 47 % (holo and non-holo prints of one illustration always need a tap).
- Oracle (fingerprint at the true outline): 97.5 % top-1, unchanged: matching is sound, outline detection is what
  limits slabs and toploaders.
- The one remaining absent false accept is a Base Set 2 card (a set the French catalogue does not have). Negatives
  accepted (26 % import, 20 % camera) are counterfeits and Japanese / Korean prints with the same art, as the dataset
  README expects.
- Photo import is slower: p50 412 ms at CPU ×1, 1.7 s at CPU ×4 (about 1.2 s before), measured by QA-SCAN.
- In the app (QA-FLOW's 6 photo imports re-run): 6 of 6 now give the right card, 5 accepted and 1 « Laquelle
  est-ce ? » with the right card first (base1-15, holo / non-holo of one illustration). QA-FLOW had seen 4 right,
  1 chooser without the right card and 1 « non reconnue ».

## 7. Remaining known limitations

- **Scanner « card absent » 3.3 % synthetic** (SPEC ≤ 2 %): an absent card whose illustration is reprinted in the base
  is accepted as that reprint 14.8 % of the time (unique art 0.8 %). On the 72 real absent photos: 1.4 %. Decision for
  the orchestrator (open since wave 1).
- **Scanner weak spots**: slabs and toploaders (camera top-1 86–87 %, import 57–74 %), WOTC holo / non-holo pairs always
  need a tap, photo import p50 1.7 s at CPU ×4, 9 Classic Collection cards without a twin (cel25cc-CC007, CC012, CC020,
  CC021; 30th-c-005, 013, 015, 018, 028). The real-photo test set has two wrong labels (RD-205 and RD-206 are xy12-22).
- **180 KB budget**: met on Cartes, Pokédex, Séries; over on the others (§5). The remaining weight is view JS and data
  (Marché imports its four sections up front; Scellé needs `sealed.json`, Decks `decks.json`). Options left: lazy
  Marché sections, a font without the width axis (−27.6 KB on every root, a design decision).
- **Séries fully scrolled 1 063 KB** with every bloc open (559 KB with the default blocs; set logos 711 KB): lighter
  logos needed (CA).
- **Sealed photos**: 1 586 products have no photo; 682 get a generated tile, the rest a pictogram; Japanese photos need
  TCGCSV category 85 in the weekly build.
- **« EN » / « ≈ » pill on grid tiles** sits over the printed card name (fixed on the card page only).
- **Collection value with a cold cache on a slow network** takes about 11 s to be complete (`prices.ensure()` loads 6
  price files at a time); Doubles no longer waits for it.
- **XY and Sun & Moon master sets changed**: commons, uncommons and rares now have a reverse (rarity rule, the sources
  only list « normal »); owners of those sets will see their master-set progress drop. XY/SM holo rares stay labelled
  « Normale » (TCGdex does not separate rare and holo rare there). g1, dc1, det1, xy0, kits and promos are excluded.
- **Data edge cases**: 2 shared Cardmarket products left (xy8-31/32, xyp-XY111/187); 5 unlinked cards show « — ».
- **A trainer kit or me06 set header** repeats its code next to a code-only cover (cosmetic).
- **Achievement « Prêt pour le tournoi »**: the decks are read on the first collection change, so a collection that
  already met it before tracking started can get its toast on that first change (rare).
- **Not tested**: real devices (iPhone Safari installed and in the browser, Android Chrome Back button, notifications,
  camera with torch and zoom), screen readers (VoiceOver, TalkBack), keyboard-only desktop pass.

## 8. Before publishing

1. Commit `refonte` (orchestrator), then merge into `main`. Never commit a stamped `sw.js` or a `data/manifest.json`.
2. Switch the repository's GitHub Pages source to « GitHub Actions » at the merge (price files are not committed: a
   branch deploy would serve a site without prices).
3. The first push to `main` has no Cardmarket copy in the Actions cache, so `site.yml` will warn and not deploy:
   start « Données et mise en ligne » by hand with « download » checked (counts as one of the two daily Cardmarket
   rounds), or wait for the next scheduled run.
4. Right after the first deploy: open the site on an Android phone and an iPhone (camera scan with a real card, Back
   button, install, offline reload, update toast after a second deploy).
5. Orchestrator decisions and SPEC updates still pending: scanner « card absent » target; backup-reminder exception
   (293 px); font width axis (−27.6 KB); SPEC changelog for §6.1 (no Scrydex art), §6.2 (finish sources and the XY/SM
   rule), §6.5 (majority trend guard, 6th price value, 3rd cm-map element), and the shell changes listed by FX-SHELL
   (view CSS on first visit, lazy collection read, `format.nbsp`, `idle.nextPaint`, `prices.saneTrend`, service
   worker `yield` message, one shots profile per port).

## 9. Where things are

Scratch `C:\Users\lomif\AppData\Local\Temp\claude\f3478f947e9a2b1d\809dffbe-a208-457d-9d45-be0fedf28e32\scratchpad\QA-FINAL\`:
`logs\` (every run above), `shotsA\`, `shotsB\` (captures and `report.json` per width group), `prod\` (production copy
and `_site`), `prodcheck\` (`build.py`, `offline.py`, `perf_boot.py`, `inp.py`, `scroll.py`, server), `prodout\`
(offline screenshots, JSON results), `photos\` (prepared real photos, `res_qafinal.json`), `recheck\` (QA-FLOW scripts
re-run on port 8923 and the QA-FINAL checks, screenshots in `shots\` and `vis\`).
