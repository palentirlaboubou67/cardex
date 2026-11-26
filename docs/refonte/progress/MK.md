# MK — cotes Cardmarket (journal de reprise)

## Fait (première passe, terminée)
- tools/build_market.py (quotidien, --weekly, --backfill, --offline, --report) + tools/market/ :
  sources (ETag, garde la copie la plus récente), cmap (table TCGdex -> Cardmarket, finitions de l'appli),
  prices, sealed (types, langues, catalogue), names (noms FR), images (photos TCGplayer), hist, wayback, report,
  test_market (tests unitaires + bout en bout hors ligne).
- data/sealed.json et data/sealed/ (ancienne source TCGplayer) supprimés.
- Lecture réelle par js/data/prices.js vérifiée dans Chromium.

## Relecture (fixer) — corrections faites
1. Scellé : tendance 0,02 € (plancher Cardmarket) = absente ; pic d'un booster récent (sorti depuis 2020, offre
   ≤ 10 €, tendance > 5 × offre et > 5 € d'écart, moyenne qui ne confirme pas) écarté ; moyenne seule seulement si
   l'offre la confirme (×3). sealed_price(g, type, sortie) sert au catalogue, au point du jour et au --backfill.
   hist : 2 centimes jamais relus, set_day() remplace les valeurs d'un jour recalculé (même guide relu ou
   --backfill), colonne / fichier qui n'avaient que des valeurs fausses retirés ; summary() ignore le plancher.
2. Noms : « 1 carte », Rouge Feu et Vert Feuille, Deck de combat légendaire, Kit de decks SP, Présentoir de
   coffrets Premium Tournoi, « Palkia Originel », japonais sans mot à mot (+ type d'énergie, Shiny Star V),
   Foudre Noire / Flamme Blanche ; report.py : contrôles mot à mot / accord / adjectif seul / énergie / forme.
3. Langues : High Class Deck, Silver Lance / Jet-Black Spirit, VMAX Climax, VSTAR Universe, Shiny Star V,
   « Strike Master Limited » = japonais (règles lues avant EXP_LANG).
4. sealed.json réécrit seulement s'il change (updatedAt gardé).
5. Cotes : seulement les cartes de l'appli ; 1re édition / tampon seulement là où la fiche les liste (finitions de
   l'ancienne appli toujours gardées pour les collections importées).
6. 1re édition / tampon sans produit à part = tableau identique à la carte de base (testé) : convention pour F2.
7. Quotidien : refait cm-map.json (sans photos) si l'appli a des cartes que la table n'a pas vues
   (cm-map.json "unlinked"), ou une fois par jour s'il manque des cartes d'une série sortie depuis < 3 semaines.

8. Noms : séries internationales citées dans le détail traduites (« Vainqueurs Suprêmes »), « (jour) / (nuit) ».

## État des tests (26/11/2026)
- python -P tools/market/test_market.py : tous les tests passent (23 s).
- Passage réel --weekly --backfill --report : code 0, 127 s ; guide du 26/11 (09:08+0100) ajouté ; second passage :
  304 partout, 0 fichier modifié, sealed.json identique ; cache vide : 3 s ; réseau coupé : code 2, rien modifié ;
  --backfill --offline : identique. Plus aucune valeur à 2 centimes (historique ni catalogue).
- Lecture par js/data/prices.js dans Chromium (port 8794) : exemples justes, seule erreur console = manifest.json 404.

## Pour reprendre
- Relancer : python -P tools/build_market.py [--weekly] [--backfill] [--report] ; tests : python -P tools/market/test_market.py
- Sauvegarde de data/market d'avant la relecture : scratchpad work-MK/before/.
- Rien en cours.
