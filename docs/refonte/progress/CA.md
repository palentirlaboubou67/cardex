# CA — catalogue statique, images de secours, logos et symboles (journal de reprise)

Port local : 8773. Travail : `tools/build_catalog.py` + `tools/catalog/*`, sorties `data/sets.json`,
`data/sets/*.json`, `data/cards-index.json`, `data/cardimg.json`, `img/sets/*`, `img/sym/*`.
Scripts d'essai et planches (scratchpad `$SP\work-ca\`) : `app_test.py` (vrais modules F1/F2 dans Chromium,
captures clair/sombre 390/1280), `contract_test.py` (format SPEC §6 + contrôles de tools/tests/data_test.py,
port 8773), `cold_test.py` (cache vide), `weigh.py` (poids de l'écran Séries), `darksheet.py` / `darkzoom.py`
(calibrage de la plaque claire), `webp_exp.py` (réglages WebP), `stats.py` (chiffres du rapport).

## Fait — TERMINÉ (25/11/2026, 23:30)
- 1re tentative (jusqu'à 21:32) : constructeur complet, deux exécutions réelles.
- Reprise (22:40 → 23:30) :
  - `dark` recalculé : plaque claire seulement si le logo est illisible sur #17171b (p90 du contraste < 3, ou
    médiane < 1,5 et ≥ 45 % presque noir) -> 22 séries (PROMO ×10, POP ×6, kits EX ×4, me05, me03) au lieu de 97.
  - me06 : logo anglais Scrydex lié (adresse de pokemontcg-data, vérifiée, CORS *) ; symboles introuvables
    ailleurs liés chez Scrydex (21 : 16 kits, me05, me06, mee, mcd23, mcd24) ; kits DP→SM : couverture générée.
  - Symboles : base1 sans symbole, exu/sous-séries : symbole de la mère sauf code différent (mee),
    2018sm-fr/2019sm-fr : symboles mcd18/mcd19. 184/186 (2013bw, base1 sans).
  - Logos WebP q70 / alpha 70 (−25 %, invisible) : écran Séries entièrement parcouru = 832 Ko d'images (< 1 Mo).
  - Étiquettes des 4 kits EX. Dex : normalisation identique à F2 (œ, ♀), ordre du nom.
  - alt : image anglaise de l'impression d'origine via le résolveur (jeton `en:` possible).
  - write_if_changed compare le texte ; adresses déjà servies par la sortie précédente tenues pour vérifiées
    (cache vide : ~40 HEAD au lieu de ~17 300).
  - data/logos.json supprimé (plus lu par personne).

## État des tests (final)
- Exécution complète --refresh : 362 s, 1 112 requêtes, 1 reprise sur 503 ; incrémentale : 13 s, 0 requête ;
  --verify : 131 s, 0 échec (2 518 adresses TCGdex, 2 869 ids Scrydex, 400 images FR fraîches) ;
  --offline / --only sv03.5 / --skip-logos : OK, 0 fichier modifié.
- contract_test.py : 0 échec. app_test.py : 186 lignes, 16 couvertures générées, 302 images (0 échec),
  84 cartes d'échantillon (0 échec, 8 vignettes attendues), 0 erreur console hors 404 data/manifest.json (dev),
  0 débordement. Planches regardées (logos clair/sombre, symboles, 84 cartes de secours).
