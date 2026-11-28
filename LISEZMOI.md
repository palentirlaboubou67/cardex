# Cardex

Appli web installable sur téléphone pour scanner ses cartes Pokémon et suivre sa collection, avec les cotes du marché
français (Cardmarket, en euros).

En ligne : **https://palentirlaboubou67.github.io/cardex/**. L'ouvrir sur le téléphone puis « Ajouter à l'écran d'accueil ».

## Les cinq onglets

- **Collection** : cartes possédées (filtres, tris, finitions), Pokédex et page de chaque Pokémon, doubles et liste
  d'échange, 18 succès, courbe de la valeur. Réglages (thème, sauvegarde) dans le menu ⋯.
- **Séries** : toutes les séries par bloc, avec leur logo et la progression ; recherche de cartes et de séries.
  Dans une série : grille, liste à cocher ou classeur (9 par page), master set (Poké Ball, Master Ball…), valeur de la
  série, tri par prix. Chaque carte a sa fiche : cotes par finition, quantités, alerte prix.
- **Scanner** : la caméra reconnaît la carte à son image (empreintes calculées sur l'appareil, sans serveur) ; la
  lecture du numéro (Tesseract) sert seulement en secours. L'ajout se fait toujours d'un geste, avec « Annuler ».
  On peut aussi importer une photo.
- **Marché** : cotes de la collection (hausses, baisses), produits scellés Cardmarket avec historique et pistes
  (ce ne sont pas des conseils), « Mon scellé » (investi, valeur, plus-value), envies avec alertes prix.
- **Decks** : decks de la méta actuelle et des saisons passées depuis l'ère XY (Limitless TCG), prix et cartes manquantes.

Une flèche ← en haut à gauche ramène à l'écran précédent sur toutes les sous-pages ; le bouton retour d'Android aussi.
La collection reste sur l'appareil (avec export/import d'un fichier `.json`). L'appli marche hors ligne.

## Données

- Cartes et séries : [TCGdex](https://tcgdex.dev) en français. Quand l'illustration française manque, l'anglaise est
  utilisée (pastille « EN »), puis la même illustration d'une réimpression (« ≈ »). Logos des séries hébergés ici.
- Cotes : fichiers publics de Cardmarket (price guide et catalogue), lus deux fois par jour au plus. Cardex n'est pas
  affilié à Cardmarket.
- Tout est construit par `.github/workflows/site.yml` (« Données et mise en ligne ») : cotes chaque jour à 04:15 et
  10:15 UTC, catalogue et base du scanner le lundi, puis publication sur GitHub Pages (source « GitHub Actions »).
  Les fichiers de cotes ne sont pas versionnés : ils n'existent que dans le site publié.
- Decks : `tools/build_decks.py`, chaque lundi (`.github/workflows/decks.yml`).

## Lancer sur le PC

Double-clic sur `lancer.bat` (il faut Python), puis ouvrir http://localhost:8000. Les cotes n'apparaissent en local
qu'après `python -P tools/build_market.py` (qui télécharge les fichiers Cardmarket du jour).

## Pour les développeurs

Appli statique sans étape de build (modules JavaScript). Le contrat de l'architecture est dans `docs/refonte/SPEC.md` ;
l'état et les tests sont dans `docs/refonte/WAVE1.md`, `WAVE2.md` et `QA.md`. Tests : `tools/tests/*.py`,
`tools/shots.py`, `tools/scan_bench.py`, `tools/market/test_market.py` (Python 3.12 avec Playwright, lancer avec
`python -P`).

## Conseils de scan

Carte bien éclairée, sans reflet, qui remplit le cadre. Dans un étui rigide ou un boîtier gradé, le scan marche moins
bien : sors la carte, ou cherche-la par son nom.
