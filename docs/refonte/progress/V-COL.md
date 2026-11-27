# V-COL — journal (vue Collection, page Pokémon, Réglages, succès, courbe de la valeur)

Port local : 8801. Scripts et captures : scratchpad `work-V-COL\`.

## Statut : TERMINÉ (27/11), rapport remis

## Fait
- Lecture : SPEC §0–5, 8–12 + changelog, WAVE1 §5, FINAL-design §3.2/4/6/8 (W-I…W-M, W-V, W-W)/9, legacy (collection,
  pokédex, Pokémon, doubles, succès, courbe, sauvegarde), modules F1/F2 (appbar, sheet, list, tile, chart, collection,
  prices, catalog, dex, prefs, net). Pas de tentative précédente (fichiers = ébauches F1).

- Écrits : js/features/valuehistory.js, js/features/achievements.js, js/views/collection.js + js/views/collection/
  {cartes,pokedex,doubles,succes,shared,backup}.js, js/views/pokemon.js, js/views/reglages.js, css/views/collection.css,
  tools/shotsteps/V-COL.json.
- work-V-COL/func.py : 60/60 (Cartes tri/finition/filtre/rechargement, patchs onChange, courbe + feuille, Doubles + liste
  d'échange presse-papiers/feuille, Pokédex, page Pokémon (Méga-Évolution), succès + toasts + reprise v1, rappel de
  sauvegarde, Réglages export/import/messages/copies de secours/tout effacer + Annuler/thème/grille compacte).
- Bogue trouvé et corrigé : écouteur posé sur le corps partagé de la feuille (s.el) -> double history.back() à la feuille
  suivante (Réglages). Les feuilles de confirmation ont maintenant leur propre conteneur.

- Sélecteurs renommés (name="cq", data-dexf, data-pf) : router_test visait le premier input[name=q] / .chip[data-f]
  de la page. router_test (copie dans work-V-COL, lien Scanner tolérant) : 97/98, seul échec 91 = vue Scanner (V-SCAN).
- Perf (work-V-COL/perf.py, 2 000 cartes, 2 493 tuiles, CPU ×4) : INP max 128 ms (retour sur la vue Collection depuis
  la fiche, bascule display de la vue = main.js), puces 32–64 ms, tri 56–72 ms, filtre 16–24 ms, Pokédex 32 ms,
  Doubles 16 ms, Succès 16–24 ms, feuille valeur 80–96 ms ; « + » : add + onChange 15–27 ms. Lots de rendu 60 tuiles.
- Premier écran allégé : courbe/variation/feuille/textes ⓘ dans collection/shared.js (chargé au repos avec les
  cotes), outils de grille dans collection/grid.js. Essai content-visibility: hidden pour les sections quittées :
  abandonné (les tuiles cachées gardent leur ancien rectangle, faussent « premier contenu » et Playwright).
- Correctifs : rendus par lots arrêtés avant un contenu fixe (grid.fill), saisie différée sans setParams si l'écran a
  été quitté, import au clavier (bouton), dates inconnues (0) pour les succès notés au premier calcul.

## Derniers essais (état final)
- func.py 60/60, 0 erreur JS ; shots V-COL 320/390/768/1280 × clair/sombre : 168 captures, 0 problème (avant :
  360/430 aussi, 252 captures) ; shots shell : routes Collection/Pokémon/Réglages OK (échecs Séries = V-SER) ;
  router_test (copie) 97/98 (91 = Scanner) ; wave1_test OK.
- perf.py (2 000 cartes, CPU ×4) : INP ≤ 120 ms partout ; 0 longue tâche au démarrage dans la dernière mesure ;
  « + » : 15–26 ms de onChange.
- Rien d'écrit hors de mes fichiers ; données de test seulement dans le navigateur et work-V-COL.

## Si reprise
- Rien en cours. Relancer : work-V-COL/func.py, perf.py 4 2000, tools/shots.py --only V-COL --port 8801 --fresh
  --out <scratch>.
