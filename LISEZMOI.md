# Cardex

Appli web (installable sur téléphone) pour scanner ses cartes Pokémon et suivre sa collection.

- **Scanner** : la caméra lit le numéro en bas de la carte (ex. `025/165`) et le nom, puis retrouve la carte.
- **Recherche** : par nom, si le scan ne trouve pas.
- **Collection** : quantités par variante (normale, reverse, holo, 1re édition), valeur estimée (cote Cardmarket).
- **Séries** : progression de chaque série, cartes possédées et manquantes.
- **Envies** : alertes prix. On fixe une fourchette ; Cardex prévient quand l'offre la moins chère sur Cardmarket y entre
  (vérification en arrière-plan toutes les ~12 h sur Chrome Android avec l'appli installée, sinon à chaque ouverture).
- **Decks** : les meilleurs decks de la méta actuelle et de chaque saison depuis l'ère XY (2014-2015), d'après Limitless TCG, avec le prix
  (cote Cardmarket), les cartes déjà dans la collection et celles à acheter. `data/decks.json` est reconstruit
  par `python tools/build_decks.py`, et automatiquement chaque lundi par une GitHub Action.
- **Sauvegarde** : automatique sur l'appareil, plus export/import d'un fichier `.json` (bouton en haut à droite).

Les données des cartes viennent de l'API gratuite [TCGdex](https://tcgdex.dev), en français.
La lecture des cartes (OCR) utilise Tesseract.js ; le premier scan télécharge quelques Mo.

## Lancer sur le PC

Double-clic sur `lancer.bat` (il faut Python), puis ouvrir http://localhost:8000.

## Sur le téléphone

En ligne sur **https://palentirlaboubou67.github.io/cardex/** (GitHub Pages, mis à jour à chaque `git push`).
L'ouvrir sur le téléphone puis « Ajouter à l'écran d'accueil ».

## Conseils de scan

Carte à plat, bien éclairée, qui remplit le cadre ; le numéro du bas doit être net.
