# INT — intégration de la vague 1 (journal de reprise)

## Statut : TERMINÉ (27/11, ~00:00), rapport remis

Port local : 8799. Scripts : scratchpad `work-INT\` (smoke.py = toutes les routes de SPEC §3 sur les vraies données,
run_base.sh = router/store/data/sw à la suite).

## Fait (26/11, 23:05 →)
- Base : router_test 98/98, store_test 15/15, data_test 21/21, sw_test 12/12 (avant toute modification).
- css/views/*.css (6 fichiers vides commentés) : plus de 404 ; shots.py : allowlist css/views retirée.
- release.py FIXED + icon-180.png / icon-512.png ; sw_test copie aussi ces icônes.
- Serveurs de test (shots, router_test, f2/server, scan_bench) : request_queue_size 128 (5 par défaut : rafales
  refusées sous Windows, ERR_CONNECTION_REFUSED au hasard).
- catalog.js : ordre des blocs de sets.json (grandes périodes puis special), dark/special transmis, goalOf(meta).
- series.js / serie.js (ébauches) : plaque des logos de blocs (dark), objectif = goalOf (count < total).
- prices.js : allEditions (1re éd. / tampon = cote de base), creditText() (mention complète avec la date).
- main.js : toast persistant 'cardex:storage' (« Exporter » / « Réglages »), storageState() au démarrage, message
  'navigate' du service worker, checkFinishes() au repos (collection v1).
- collection.js : fixFin (données v1/import v1) + repairFinishes(cartes) + finishCheckDone() : « normale » -> « holo »
  sur les cartes qui n'existent qu'en holo (Cardmarket ne cote que holo). store_test + 1 test (16/16).
- Ébauches : collection (cotes chargées, valeur + prix par finition des tuiles), carte (cote par finition, « — »,
  « prix toutes éditions », mention), réglages (toutes les mentions de SPEC §8 + Poképédia + Tesseract).
- smoke.py : 33 routes, 0 erreur console (hors 404 manifest en dev).

- base.css : plaque des logos de blocs sombres (POP) en thème sombre, sans rogner le logo.
- .github/workflows/site.yml (quotidien cotes, lundi catalogue + scanner, release.py, Pages) ; sealed.yml supprimé.
- SPEC : lignes §2 / §6.3 mises à jour ; changelog prêt dans work-INT/changelog.md (à coller à la fin).
- docs/refonte/WAVE1.md écrit (chiffres de tests RESULT_* à remplir).
- Tests après modifications : router 98/98, store 16/16, data 21/21, sw 12/12, shots 156 captures 0 problème,
  test_market OK, scan_bench rapide (bitexact 0/512, synth 100 : top-1 99 %, final 96 % à 100 %, ×4 p50 210 ms,
  absente 5 % / illustration unique 0 %, api 14/14).
- build_scan.py : jumelles homonymes filtrées par illustrateur TCGdex (GraphQL, cache .cache/sc/tcgdex/illus/,
  fautes de frappe tolérées) ; sonde : 24 cartes sans image perdent une fausse jumelle, 137 en gagnent une vraie.

- scan_bench après les jumelles : real 14/21 acceptées 0 fausse (inchangé), absente n=200 : 3,5 % (illustration unique
  0,6 %), loop 6/6 OK (+ 3 OCR), live 3 clips OK ; data/scan/cards.json : seules les jumelles changent (437 -> 455).
- release.py sur le dépôt : prod.py (SW actif, 33 routes) 0 erreur, 0 opaque, tout data/ en ?h=, hors ligne OK ;
  sw_test 11/12 avec sw.js tamponné (seul « mode dev » échoue, attendu), puis sw.js remis en dev + manifest retiré :
  12/12.
- perf CPU ×4 : Collection 150,6 Ko gzip avant le premier écran (cotes chargées au repos), Séries 153,9, Série 158,3.
- tools/tests/wave1_test.py (repris de integ.py) ; SPEC changelog collé (fin de SPEC.md).

- Tour final : router 98/98, store 16/16, data 21/21, sw 12/12 (dev), shots 320/360/390/430/768/1280 × clair/sombre
  312 captures 0 problème, smoke 33/33 (390 clair, 1280 sombre), wave1_test 13/13, prod.py OK, test_market OK.
- WAVE1.md complété ; SPEC : changelog + points ouverts (carte absente 3,5–4,7 %).
- État laissé : sw.js en mode dev, pas de data/manifest.json, aucun changement git (rien de commité).

## Si reprise
- Rien en cours. Relancer : run_final.sh (work-INT) ; prod.py après `python -P tools/release.py`, puis remettre
  sw.js (copie work-INT/sw.js.dev ou `git diff`) et supprimer data/manifest.json.
