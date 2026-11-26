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
