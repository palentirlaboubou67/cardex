# SC — scanner core : journal

Statut : **terminé** (25/11/2026 ≈ 23 h 45). Rapport final remis à l'orchestrateur.

## Fait
- js/scan : describe.js (descripteurs bit-exacts), detect.js (détecteur guidé + options porte-carte + guide ×0,8,
  détecteur sans guide), identify.js (seuils T), match.js (recherche, rivaux = sosies connus), region.js (zone du
  numéro, 4 échelles), worker.js (tokens d'image), client.js (RPC), camera.js, loop.js, ocrprep.js, ocr.js, index.js.
- vendor/tesseract : tesseract.js 7.0.0, core 7.0.0 (3 variantes), fra 1.0.0 best_int, licences, LISEZMOI.md.
- data/scan : hashes.bin 1 195 776 o (18 684 lignes), cards.json 305 183 o (59 994 gzip), meta.json.
  tools/build_scan.py : séries alias (pl4-AR* dans pl3), --offline, sosies d ≤ 1,0 (2 021 paires).
- tools/scan_bench.py : prep, bitexact, synth (standard/hard/wide, --absent, --cpu), rescore, calib, real, live,
  ocr (--ocr-mode net), api, all. tools/scanbench : bench.html, live.html, synth.py, clip.py.

## Mesures finales (seed 1)
- bit-exactitude 53/53 identiques (0/512).
- standard 300 : top-1 98,7 % (strict 95,3 %), top-5 99,0 %, acceptées 96,3 % à 100 % (strict 99,7 %),
  coins p50 0,1 % p90 2,9 % ; ×1 p50 38 ms, ×4 p50 166 ms p90 354 ms.
- difficile 300 : top-1 97,7 %, acceptées 96,3 % à 100 %. Large 150 : top-1 98,0 %, acceptées 93,3 % à 100 %.
- carte absente : 4,7 % (standard 300), 4,0 % (large) — 0/180 sur SV/ME, 7–8 % sur les anciennes séries
  (réimpressions de même illustration) → objectif SPEC ≤ 2 % non atteint, voir rapport.
- réel (21) : top-1 20/21, acceptées 19/21, 0 fausse ; import de scènes 4/6.
- live (fausse caméra) : 2 clips × 2 passages, 1 acceptation par passage, 0,2–0,9 s après l'arrêt.
- OCR : vérification juste 44/100 (net 50/100), 0 fausse ; lignes TG/GG 12/12 ; ≈ 8 ms par ligne.

- `scan_bench.py all` (23 h 50) : 6 objectifs SPEC §12 sur 7 atteints (carte absente 4,7 % > 2 %) ; difficile 99,7 %
  (1 réimpression col1-85 ↔ hgss3-77 mal départagée) ; api 14/14 (aussi sans OffscreenCanvas, repli fil principal).

## Reprendre
- Relancer : `python -P tools/scan_bench.py all --real <dl-scannercheck/real> --cases <real_cases_fc.json>`
  (cas des 21 photos : scratchpad/work-sc/real_cases_fc.json ; photos jamais versionnées).
- Clips y4m supprimés (800 Mo) : régénérés automatiquement par `live`.

## Fixer pass (2026-11-26, port 8795) — 14 findings of the review (7 major, 7 minor)
- scripts : scratchpad\work-SCfix\ (review.py du relecteur adapté, ocr_dbg.py, ocr_var.py, patch_build.py)
- fait : loop.js réécrit (réimpressions sans zone complète → choose ; époque + AbortSignal : rien après stop/destroy ;
  netteté pente/marche + max par carte ; OCR tardif livré s'il diffère ; shutter sans relance ; auto:false ; état
  'error' + nouvel essai de la base) ; index.js (délai d'inactivité, ScanError decode, import réduit au décodage,
  ocrFallback en pixels source / token) ; worker (cancel, has, exclude, region {scores, complete}, canvas) ;
  region.js (null par candidat) ; ocrprep (cartouche SV/ME inversé + numéro seul) ; ocr.js (zones, accord,
  garde image) ; build_scan.py (réutilisation sans image, Transient, manifeste md5 = ETag, --recheck, twins) ;
  data/scan reconstruit hors ligne (hashes.bin identique, cards.json + twins 437 lignes).
- mesuré : contrôle « zone de la carte n° 1 » NON discriminant (absente 0,6–0,95, vraies sous sleeve 0,2–0,4) → retiré.
  Carte absente 4,7 % = réimpressions de même illustration ; illustration unique 1,2 % (std) / 0,8 % (large).
- fait aussi : detect.js (quad affiché : combinaisons des 3 premiers pics si le premier choix n'a pas les proportions
  d'une carte) ; bench.html (detectCases, twins, régions null) ; live.html (aides du banc) ; scan_bench.py (--port,
  décision hors ligne, absente : illustration unique / même illustration, real : porte de détection, loop : 6
  scénarios, api : erreur de décodage, ocr : numéro / code / grammaire / vérification séparés).
- tests (port 8795) : loop 6/6 OK (hors ligne 0/32 acceptée, destroy 0 événement, shutter arrêté, auto:false,
  netteté 0,44 s, base indisponible → 'error' puis reprise, carte masquée → OCR 3/3) ; api 14/14 (+ sans
  OffscreenCanvas : canvas false, réimpressions → choose) ; builder sans cache (work-SCfix/test_build.py) A/B/C OK ;
  OCR SV/ME : code lu 7→15/40, grammaire seule juste 7 / 14 sur 40, 0 fausse ; réel : détection 19/19.
- scan_bench all (port 8795) : bit-exact 0/512 ; standard top-1 98,7 %, décision finale 95,0 % acceptées à 100 %
  (hors ligne 84,0 % à 100 % stricte) ; ×4 p50 215 ms ; difficile 99,6 % ; large 100 % ; absente 4,7 % (illustration
  unique 1,2 %, large 0,8 %) ; réel : détection 19/19, auto 12/19 (jumelle SWSH233 → choix) ; live 3 clips × 2 OK
  (base1-4 : jumelle cel25cc → un choix par passage) ; OCR 0 fausse acceptation.
- statut : TERMINÉ (fixer) — rapport remis. Reprendre : `python -P tools/scan_bench.py all --port 8795 --real <dl-scannercheck/real>
  --cases <work-sc/real_cases_fc.json>` puis `loop`, `api`, `live` ; builder : `python -P tools/build_scan.py --offline`.
