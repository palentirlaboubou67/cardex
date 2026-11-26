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

## Correctifs de la relecture (26/11/2026, reprise « fixer », port 8793) — TERMINÉ
Scripts d'essai : scratchpad `work-CAfix\` (contract_test.py, app_test.py, appshots.py, fault_test.py,
naming_test.py, transient2.py, sxsample_test.py, sheet.py, weigh_series.py). Sauvegarde des sorties d'avant : `before\`.
- swsh3 : source FR opaque (RGB sur blanc) -> détourage du fond relié aux bords + liseré « couleur vers alpha »
  (logos.py unmatte), aussi pour les symboles bw1 et 2012bw ; contrôle de sortie (aucune image opaque à fond clair).
  swsh3 détouré tombe dans la règle « surtout noir » -> plaque claire en thème sombre (comme me03).
- Échecs passagers : une image FR n'est « absente » que sur 404/410 ; sinon i=1 gardé et signalé (rep.images.unsure),
  code de sortie 3. Logos/symboles : source mieux placée en échec passager -> choix précédent gardé (logoSure/symSure).
- --verify : tirage frais de 40 identifiants Scrydex (≤ 1 req/s, ETag du dos de carte) ; un identifiant absent ou dos
  de carte sort de `ok` ; ≥ 25 % d'échecs -> alerte, code 3.
- Robustesse : toute exception d'une série -> fichier précédent ; JSON illisible / réponse coupée -> HttpError
  (réessai) ; liste des séries qui perd > 3 séries publiées -> code 2, rien d'écrit ; @locale en panne -> pl4 gardé ;
  série en échec : légalité et entrées `fix` précédentes gardées.
- Noms des images : hash de la source (octets) + réglages + PIPE, fichier existant jamais réécrit (autre libwebp en CI
  = mêmes noms). Tous les fichiers renommés une fois (280).
- Tables : LOGO_SOURCE (swsh4.5 : logo FR de Poképédia), FR_LOGO_IS_EN, PARENT_SYMBOL (exu -> ex10),
  EXTRA_SETS pl4 ownTotal (total 9), SPECIAL_BLOCS (mc, tk, pop après les grandes périodes), étiquettes année
  McDonald's et numéro POP retirées. Cartes non-Pokémon : jamais de numéro de Pokédex (hgssp-HGSS18).
- sets.json : blocs avec `dark` et `special` (ajouts). @locale vérifié à chaque exécution (ttl 0).

## État des tests (fixer, final)
- Exécution normale 13 s (4 requêtes) ; incrémentale 6,5 s (1 requête : sonde @locale) ; --only sv03.5 6,9 s ;
  --verify 148 s (441 requêtes : 40 Scrydex, 400 FR fraîches), 0 échec. Code de sortie 0.
- contract_test 0 échec ; fault_test 9/9 ; naming_test 4/4 ; transient2 / sxsample_test conformes ;
  tools/tests/data_test.py (F2) 21/21 sur le port 8793 ; app_test : 186 lignes, 16 couvertures, 0 image en échec ;
  vraie appli (#/series, #/serie) clair/sombre 390/1280 : 0 image cassée, 0 débordement (404 hors CA :
  css/views/*, data/manifest.json). Planches logos clair/sombre et symboles regardées.
