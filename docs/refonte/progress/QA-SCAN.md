# QA-SCAN — audit et amélioration du scanner (vague 3) : journal

Port local : 8905. Dossier de travail (hors dépôt) : scratchpad `QA-SCAN\` (photos préparées, vérité terrain,
résultats `res_<tag>.json`, scripts d'analyse `ana.py`, `fails.py`, `regstat.py`, `calib.py`, `why.py`, `exp*.py`).
Les 709 photos réelles (scratchpad `realphotos\`) ne sont jamais copiées dans le dépôt.

## Statut : terminé (28/11) — rapport remis

## Lu
SPEC §0, §1, §3, §5.7, §6.6, §8–12 et les deux changelogs ; WAVE2 ; SC.md, V-SCAN.md ; FINAL-scanner §0, §5, §8, §11 ;
js/scan/* ; tools/scan_bench.py ; tools/scanbench/bench.html ; README et STATS du jeu de photos.

## Banc des photos réelles (nouveau)
- `python -P tools/scan_bench.py photos --labels <labels.json> --work <dossier hors dépôt> [--tag T] [--what
  import,camera,oracle] [--detect JSON] [--rescore]` + `tools/scanbench/photos.py`. `--work` dans le dépôt est refusé.
- Préparation (en cache dans --work) : EXIF appliqué, côté ≤ 2 560 px (comme l'import) ; vérité terrain des bords
  par SIFT + RANSAC contre l'image de référence locale (567/568 quads plausibles ; planche des 24 plus faibles
  regardée : 1 faux, RD-070).
- Trois mesures sur le vrai code JS : **import** (identifyUnguided + décision finale), **caméra** (guide simulé
  autour de la vraie carte : carte 0,90–1,06 × le guide, décalage ±6 %, image redressée à ±10 °, comme le préréglage
  synthétique « standard » ; + détection de la boucle), **oracle** (empreinte prise au vrai quad).
- Catégories : positives = inDb, vérifiées, carte seule (506 ; caméra 532 avec les cartes des scènes) ; probables
  (36) ; absentes (72 : carte étiquetée hors base) ; négatifs (87) ; scènes (8).
- `bench.html` : `oracleCases`, `debugGuided`, `seedStats`, `proposalStats`, `profile`, `setDetect`, repli sur la
  low.webp locale pour la zone du numéro, décodage avec 3 essais ; navigateur neuf toutes les 120 photos importées
  (au-delà, la page finissait par refuser tous les `fetch` : 72 cas perdus au premier passage).
- Images high.webp : 165 téléchargées (4 requêtes/s, cache `.cache/sc/tcgdex`) = toutes les cartes des groupes,
  sosies et paires de même illustration des cartes étiquetées, pour mesurer la zone du numéro comme en production.

## Mesures de départ (code de la vague 2, tag `base`)
| | import (photo) | caméra (guide simulé) |
|---|---|---|
| top-1 (réimpressions tolérées) | 78,5 % | 92,1 % |
| top-5 | 81,0 % | 95,5 % |
| acceptées | 70,6 % | 83,8 % |
| précision des acceptations | 98,0 % (7 fausses) | 97,8 % (10 fausses) |
| choix / dont la bonne carte dans les 3 | 21,5 % / 49,5 % | 14,7 % / 79,5 % |
| rien | 7,9 % | 1,5 % |
| fausses acceptations, carte absente (72) | 5,6 % | 8,3 % |
| fausses acceptations, négatifs (87) | 24,1 % | 18,4 % |
| coins < 3 % de la hauteur | 323/505 | 364/531 |

Oracle (empreinte au vrai quad) : top-1 97,5 %, top-5 98,9 %, distance vraie p50 0,625 (synthèse 0,50).
Sensibilité aux coins (Python, quads vrais bruités) : ±1 % → 97,9 %, ±2 % → 96,8 %, ±3 % → 93,1 %, ±5 % → 67,5 %.
Par support, top-1 import / caméra : nue 83,8 / 94,1 ; slab 62,1 / 88,4 ; sleeve 90,0 / 96,7 ; toploader 42,9 / 80,4.

## Causes trouvées
1. **Fausses acceptations = même illustration** (10/10 en caméra) : holo / non holo WOTC (base5-2/19, base2-2/18,
   base3-4/19, base5-17/80), Évolutions (xy12-51/base1-10, base1-28/xy12-17), Légendes Ancestrales (col1-85 /
   hgss3-77). La moitié absente de `dups` / `near` (les scans FR de référence de deux impressions d'une même
   illustration diffèrent jusqu'à 1,62 : le scan FR de base3-4 est sombre), l'autre moitié mal départagée.
2. **Zone du numéro non fiable entre deux impressions d'une même illustration** : 147 départages réels (vraies
   high.webp) ; corrélation de la zone : erreurs jusqu'à 0,45 d'écart ; corrélation pondérée par l'écart entre
   candidats (essayée) : erreurs jusqu'à 1,41. Cause : bandes identiques à 95 % (seuls chiffres et symboles diffèrent),
   scans TCGdex recadrés différemment (base2-6 : texte plus haut), l'échelle du quad fait basculer la réponse.
   Fiable sur les groupes de réimpressions et les sosies (1 erreur sur 37, à 0,006 < seuil 0,01).
3. **Carte absente acceptée = réimpression sans image** : Collection Classique 30th (30th-c, 0 jumelle), Celebrations
   (cel25cc-CC024 : « M-Rayquaza-EX » ≠ « M-Rayquaza EX »), McDonald's 2024 (illustration d'une autre ère).
4. **Détection** : 37 des 42 échecs caméra sont des quads faux, souvent après « porte-carte » / « loin ». Les droites
   vraies sont souvent parmi les options, mais la descente part de « la plus forte partout » ; avec 2 côtés faux
   l'objectif est plat (≈ 1,4) et elle ne bouge plus ; dans un slab, la fenêtre du boîtier l'emporte.
5. **Import** : la vraie carte n'est parmi les propositions du détecteur global que pour 247 photos sur 505 (moitiés de
   carte prises pour des cartes couchées, bords de la photo ou de la table) ; les 8 propositions de plus ne changent
   rien ; le tri sur le quad brut ne voit pas une carte à 3 % près.
6. Négatifs acceptés : contrefaçons et cartes japonaises / coréennes / chinoises de même illustration (planche
   regardée : Mew ex, Galvaran, M-Gardevoir EX, Évoli GX, Champions Festival, Lugia V), scènes non étiquetées
   (CC-015, CC-016 : une des cartes visibles). Attendu (README du jeu).
7. Étiquettes fausses du jeu : RD-205 et RD-206 sont des M-Tortank EX d'Évolutions (xy12-22, « 22/108 » lu sur la
   photo), étiquetées xy1-30 ; le scanner avait raison.

## Changements
- `tools/build_scan.py` : table **`arts`** (cards.json) : même illustration d'après le nom — même série WOTC (base,
  neo) ≤ 1,75, ou séries de réimpression (Évolutions, Légendes Ancestrales, Générations, Destinées de Paldea…)
  ≤ 1,25 ; paire écartée si les deux illustrateurs sont connus et différents (cache `illus/`). 271 paires, 491 cartes.
  **Jumelles** : noms normalisés (accents, tirets), 30th-c ajoutée, Collection Classique 30th cherchée dans toutes les
  ères, McDonald's et Collections Classiques : homonymes de toute la base quand l'illustrateur est connu et le même
  (4 au plus). +115 jumelles, aucune perdue (545 cartes concernées au lieu de 455). Illustrateurs de 30th-c récupérés
  (1 requête GraphQL). hashes.bin inchangé (octet pour octet).
- `js/scan/match.js` : les partenaires `arts` sont toujours rivaux (quelle que soit la distance) ; `worker.js` : `arts`
  dans le résultat ; `loop.js` : `LOOP.artMargin = Infinity` → une famille de même illustration n'est jamais acceptée
  sur la zone du numéro seule (choix, l'OCR peut confirmer).
- `js/scan/detect.js` : `seedCombos()` (départs géométriques) ; `js/scan/identify.js` : `DETECT` (départs, recentrage),
  **recentrage** (nouvelles options autour du meilleur quad, entre « forte » et 1,35), **import réécrit** (`UNGUIDED` :
  propositions + guides centrés portrait / paysage de 4 tailles, chacun examiné comme un guide de caméra dans les deux
  sens, recherche complète sur les 3 meilleurs, images de détection partagées par demi-octave).
- `js/views/scanner.js` : les paires `arts` comptent comme « même illustration » ; `panel.js` : « Même illustration,
  autres versions » (au lieu de « … dans plusieurs séries », faux pour holo / non holo d'une même série).
- Seuils d1 ≤ 1,10 et marge ≥ 0,30 gardés : rejoués sur les photos réelles, les assouplir n'ajoute que 0,5–1 point
  d'acceptations (calib.py).

## Mesures après (tags `final` caméra / oracle, `final2` import ; règles finales)
| | import | caméra |
|---|---|---|
| top-1 | **87,2 %** (78,5) | 91,9 % (92,1) |
| top-5 | 90,1 % | 95,1 % |
| acceptées | 72,3 % (70,6) | 74,1 % (83,8, dont 10 fausses) |
| précision des acceptations | **100 %** (0 fausse ; 7 avant) | **100 %** (0 fausse ; 10 avant) |
| choix / dont la bonne carte dans les 3 | 26,1 % / 67,4 % | 24,2 % / 86,8 % |
| rien | 1,6 % (7,9) | 1,7 % |
| fausses acceptations, carte absente (72) | **1,4 %** (5,6) : 1 Set de Base 2, série absente du catalogue FR | **1,4 %** (8,3) |
| négatifs acceptés (même illustration) | 26,4 % | 19,5 % |
| coins < 3 % | 376/505 (323) | 405/531 (364) |

Par support (top-1 / acceptées / fausses) : import nue 91/78/0, slab 74/53/0, sleeve 100/90/0, toploader 57/43/0 ;
caméra nue 94/80/0, slab 86/61/0, toploader 87/48/0, sleeve 97/90/0. Par ère, caméra : sv 99/86, me 95/89, swsh 94/89,
sm 95/90, wotc 88/47 (les holo / non holo vont au choix), xy 83/57. Langue (caméra) : en 92/76, fr 94/73, it 88/56.
Oracle inchangé : 97,5 %. Caméra, 532 positives : 394 acceptées, 45 choix « même illustration », 22 choix « jumelle sans
image », 25 faibles, 43 top-1 faux (dont 12 paires de même illustration où le choix montre les deux, 2 erreurs
d'étiquette ; vrais échecs : ≈ 13 slabs, 6 toploaders, 8 cartes nues sans quad utilisable).
Temps de l'import : CPU ×1 p50 412 ms, ×4 p50 1,69 s, p90 2,5 s (avant ≈ 300 ms / ≈ 1,2 s) ; images de détection
partagées plafonnées à 1,2 Mpx (au-delà : zone du candidat), mémoire du worker bornée.

### Non-régression (`scan_bench.py all --port 8905 --real dl-scannercheck/real --cases work-sc/real_cases_fc.json`)
- bit-exactitude 0/512 ; standard top-1 99,0 % (98,7), décision finale 89,7 % acceptées à 100 % (95,0 avant : les
  paires de même illustration vont au choix) ; ×4 p50 171 ms ; difficile 98,7 %, précision 100 % ; large 97,3 %.
- carte absente 3,3 % (4,7 avant) : illustration unique 0,8 %, réimpression de même illustration dans la base 14,8 %
  (objectif SPEC ≤ 2 % non atteint en synthèse ; 1,4 % sur les 72 vraies cartes absentes).
- réel (21 photos de SC) : top-1 18/19 (17/19 avant), 10 acceptées, 0 fausse ; xy12-51 (Mewtwo d'Évolutions, même
  illustration que base1-10) et xy12-20 passent au choix.
- boucle en direct (fausse caméra) : 3 clips × 2 passages OK. Critère du clip sv03.5-025 ajusté : cette carte a une
  jumelle sans image (McDonald's 2024sv-2, déjà dans les données) ; le choix vient d'abord, puis la lecture OCR
  « MEW 025/165 » confirme la bonne carte (acceptation « ocr » après le choix = attendu).
- `loop` 6/6 scénarios OK ; `api` 14/14, 0 erreur console ; `ocr` : 0 fausse acceptation (1 avant : « L52/149 » lu
  152/149 sur sm1-52), carte parmi les propositions 9/24 au lieu de 7/24 en bas à gauche.
- `shots.py --only V-SCAN` 390 et 1280, clair et sombre : 52 captures, 0 problème.

### Aussi corrigé
- OCR : `debug_file: '/dev/null'` → plus aucun `console.error` de tesseract (11 lignes par lecture difficile avant ;
  demande de WAVE2 §7 à SC). Grammaire : une lettre en tête du numéro est aussi lue absente (symbole de série).
- cards.json : 335 Ko (66 Ko gzip, +6 Ko) ; hashes.bin et meta.json inchangés.

## Reste ouvert (voir rapport)
- Carte absente synthétique 3,3 % > 2 % (paires de même illustration dont une impression manque).
- Slabs et toploaders : quads faux quand la fenêtre du boîtier l'emporte (caméra 86–87 % top-1, import 57–74 %).
- WOTC : holo / non holo toujours au choix (un geste de plus) ; l'OCR lit rarement leur numéro (4/30 en synthèse).
- 9 cartes des Collections Classiques sans jumelle (cel25cc-CC007, CC012, CC020, CC021 ; 30th-c-005, 013, 015, 018,
  028) : plus de 4 homonymes du même illustrateur, ou illustrateur inconnu.
- Jeu de photos : RD-205 / RD-206 mal étiquetées (xy12-22, pas xy1-30) ; RD-106 probable douteuse.

## Si reprise
Scripts et résultats : scratchpad `QA-SCAN/`. Relancer : `python -P tools/scan_bench.py photos --port 8905 --labels
<scratchpad>/realphotos/labels.json --work <scratchpad>/QA-SCAN --tag T` (≈ 15 min ; `--what import` ≈ 8 min) puis,
dans `QA-SCAN/`, `python -P ana.py T camera` (ou `import`), `why.py T`, `calib.py T`, `regstat.py T camera,import`.
Builder : `python -P tools/build_scan.py --offline` (illustrateurs en cache `.cache/sc/tcgdex/illus/`).
