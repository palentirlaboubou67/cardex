# Cardex

Appli web (installable sur téléphone) pour scanner ses cartes Pokémon et suivre sa collection.

- **Scanner** : la caméra lit le numéro en bas de la carte (ex. `025/165`) et le nom, puis retrouve la carte.
- **Recherche** : par nom, si le scan ne trouve pas.
- **Collection** : quantités par variante (normale, reverse, holo, 1re édition), valeur estimée (cote Cardmarket).
- **Séries** : progression de chaque série, cartes possédées et manquantes.
- **Sauvegarde** : automatique sur l'appareil, plus export/import d'un fichier `.json` (bouton en haut à droite).

Les données des cartes viennent de l'API gratuite [TCGdex](https://tcgdex.dev), en français.
La lecture des cartes (OCR) utilise Tesseract.js ; le premier scan télécharge quelques Mo.

## Lancer sur le PC

Double-clic sur `lancer.bat` (il faut Python), puis ouvrir http://localhost:8000.

## Sur le téléphone

La caméra en direct exige une adresse **https**. Le plus simple : héberger le dossier
gratuitement (GitHub Pages, Netlify…), ouvrir l'adresse sur le téléphone, puis
« Ajouter à l'écran d'accueil ». Sans https, le bouton photo marche quand même.

## Conseils de scan

Carte à plat, bien éclairée, qui remplit le cadre ; le numéro du bas doit être net.
