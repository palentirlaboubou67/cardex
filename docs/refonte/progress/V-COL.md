# V-COL — journal (vue Collection, page Pokémon, Réglages, succès, courbe de la valeur)

Port local : 8801 (construction), 8821 (correctifs de la relecture). Scripts et captures : scratchpad `work-V-COL\`
(correctifs : `work-V-COL\fix\`).

## Statut : correctifs de la relecture faits (27/11), rapport remis

## Fait (construction)
- Lecture : SPEC §0–5, 8–12 + changelog, WAVE1 §5, FINAL-design §3.2/4/6/8 (W-I…W-M, W-V, W-W)/9, legacy (collection,
  pokédex, Pokémon, doubles, succès, courbe, sauvegarde), modules F1/F2 (appbar, sheet, list, tile, chart, collection,
  prices, catalog, dex, prefs, net). Pas de tentative précédente (fichiers = ébauches F1).

- Écrits : js/features/valuehistory.js, js/features/achievements.js, js/views/collection.js + js/views/collection/
  {cartes,pokedex,doubles,succes,shared,backup,grid}.js, js/views/pokemon.js, js/views/reglages.js,
  css/views/collection.css, tools/shotsteps/V-COL.json.
- work-V-COL/func.py : 60/60 (Cartes tri/finition/filtre/rechargement, patchs onChange, courbe + feuille, Doubles + liste
  d'échange presse-papiers/feuille, Pokédex, page Pokémon (Méga-Évolution), succès + toasts + reprise v1, rappel de
  sauvegarde, Réglages export/import/messages/copies de secours/tout effacer + Annuler/thème/grille compacte).
- Bogue trouvé et corrigé : écouteur posé sur le corps partagé de la feuille (s.el) -> double history.back() à la feuille
  suivante (Réglages). Les feuilles de confirmation ont maintenant leur propre conteneur.
- Sélecteurs renommés (name="cq", data-dexf, data-pf) : router_test visait le premier input[name=q] / .chip[data-f].
- Premier écran allégé : courbe/variation/feuille/textes ⓘ dans collection/shared.js (chargé au repos avec les
  cotes), outils de grille dans collection/grid.js. Essai content-visibility: hidden pour les sections quittées :
  abandonné (les tuiles cachées gardent leur ancien rectangle, faussent « premier contenu » et Playwright).
- Note : la mesure « 0 longue tâche au démarrage » de la construction était fausse (un seul essai) ; la relecture a
  trouvé 68–99 ms à chaque essai. Corrigé ci-dessous, mesuré en A/B.

## Correctifs de la relecture (9 constats)
Une première passe (interrompue, sans journal) avait corrigé une partie du code ; tout a été revu et re-testé.
1. Import perdu si Réglages se redessine pendant le sélecteur de fichier : le champ fichier est créé une fois dans
   mount(), hors du contenu redessiné (`.set-body`), avec son propre écouteur. r5 : avec les cotes retardées de 2,5 s,
   le champ reste en place, « Import réussi : 24 nouvelles cartes ».
2. Page Pokémon incomplète après un aller-retour avec un autre filtre : la fin du chargement des finitions est rattachée
   à `cur` (et non au jeton de show()) ; le chemin rapide (même Pokémon) la laisse finir. r19 : 252 tuiles, « Versions
   2 / 252 », nombres sur les puces, dans les deux scénarios.
   + trouvé en route : la passe interrompue avait remplacé le rendu par lots de grid.js sans changer les appels
   (Cartes, Doubles, Pokédex, Pokémon utilisaient encore renderChunked) : `fill()` n'arrêtait plus un rendu en cours.
   Tous passent maintenant par grid.renderGrid (f_cancel.py : Pikachu -> Dracaufeu sans tuile en trop, Doubles vidé
   pendant le rendu -> état vide seul).
3. « Exporter » à côté de l'avis « collection illisible » : l'alerte propose « Télécharger la copie » (la copie gardée)
   pour `notice === 'corrupt'`, « Exporter » seulement pour une vraie erreur d'enregistrement, rien en lecture seule.
   f26 : fichier téléchargé = texte illisible d'origine, export non noté (« Rien à exporter pour l'instant »).
4. Longue tâche au démarrage (2 000 cartes) : un lot par image (rAF puis tâche, au lieu de scheduler.yield qui reprend
   avant le rendu) et premier lot de 18 tuiles (CHUNK, partagé avec la page Pokémon ; Pokédex 32 cases). Trace : la
   première image coûte surtout la police et la 2e passe de content-visibility. A/B même exécution (f4_boot_ab.py,
   CPU ×4, arrivée sur Cartes) : ancien rythme 67–75 ms à chaque essai (6/6 à 390, 4/4 à 1280) ; nouveau : aucune
   longue tâche de la grille. Il reste la tâche d'évaluation de main.js (F1, 49–57 ms, environ 1 essai sur 3).
5. Succès après « Tout effacer » puis « Annuler » : les succès d'avant sont gardés 2 min et rendus si la collection
   revient (dates d'origine, c50 gardé). r24 : « Débloqué le 21 sept. 2026 » reste.
   + reprise v1 et premier lancement avec une collection : plus aucun toast, dates inconnues (0) jusqu'au premier
   calcul complet, qui attend aussi la correction des finitions v1 de main.js (20 s au plus) : avant, Petit trésor et
   Coffre-fort étaient datés du jour (la valeur passait de 36 € à 5 237 € après la correction). f_v1.py.
6. Message d'import quand tout est invalide : « Aucune carte valide dans ce fichier · 2 éléments ignorés (invalides) ».
7. Rappel de sauvegarde : une ligne courte (« Collection jamais exportée » / « Dernier export il y a … »), en-tête
   resserré dessous. Première tuile à 293 px avec le rappel (253 sans) à 360/390/1280 : exception gardée et assumée.
   Le rappel est lui-même du contenu, placé en haut comme le veut FINAL-design (W-V : « one-line row at the top of
   Collection »), temporaire (disparaît après un export, « Plus tard » le cache 7 jours, désactivable dans Réglages) ;
   la somme (valeur) est à 149 px. Tenir 260 px demanderait d'enlever une ligne d'information de l'en-tête.
8. « Débloqué » lu deux fois : la coche est aria-hidden, plus de texte caché en double (r11 : une seule fois).
9. Copies de secours coupées à 390 px : titre et sous-titre passent à la ligne (f9 : rien de coupé à 320 et 390).
   + 320 px : « Thème » n'est plus coupé (boutons Auto/Clair/Sombre resserrés), sous-titres Exporter/Importer à la ligne.

## Derniers essais (port 8821)
- func.py 60/60, 0 erreur JS (H1 mis à jour : texte court du rappel).
- Scripts de la relecture relancés : r5, r19, r24, r11, r27, r22 (293/253), f26, f9, f_cancel, f_v1 : tous conformes.
- tools/shots.py --only V-COL, 320/390/1280 × clair/sombre : 126 captures, 0 problème ; captures regardées
  (Cartes, Pokémon, Réglages 320, rappel 390 sombre/1280 clair, alerte illisible).
- perf.py 4 2000 (2 493 tuiles) : 0 longue tâche au démarrage ; puces 24–48 ms, tri 48 ms, filtre 16–32 ms, Pokédex
  32 ms, Doubles 16 ms, Succès 24 ms, page Pokémon 32 ms, feuille valeur 96 ms, retour sur Cartes 96 ms (bascule de
  la vue, 2 493 tuiles) ; « + » : 15–23 ms de onChange.
- f4_routes.py (arrivée sur chaque écran, 3 essais) : seules tâches > 50 ms = évaluation de main.js (50–56 ms, F1).
- tools/tests/router_test.py --port 8821 : 97/98 (91 = Scanner, V-SCAN) ; wave1_test : OK.
- Rien d'écrit hors de mes fichiers ; données de test seulement dans le navigateur et work-V-COL.

## Demandes aux autres
- F1 : l'évaluation de main.js est une tâche de 49–57 ms à CPU ×4 (dont style + mise en page forcés par
  appbar.js onScroll, appelé par setBar dans renderRoute) ; core/list.js renderChunked enchaîne ses lots avec
  scheduler.yield, qui reprend avant le rendu (lots mis en page d'un coup) : le rythme de grid.js (rAF puis tâche)
  éviterait la même longue tâche aux autres vues.

## Si reprise
- Rien en cours. Relancer (serveur : work-V-COL/fix/serve.py 8821) : fix/func.py, fix/perf.py 4 2000,
  fix/f4_boot_ab.py 2000 6 390, tools/shots.py --only V-COL --port 8821 --fresh --out <scratch> (serveur arrêté avant).
