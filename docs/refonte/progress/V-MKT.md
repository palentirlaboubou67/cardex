# V-MKT — journal (Marché : Cotes, Scellé, Mon scellé, Envies ; fiche produit)

Port local : 8805 (construction), 8825 (correctifs de la relecture). Scripts et captures : scratchpad `work-V-MKT\`
(smoke.py, func.py, perf.py, shots-final\) et `work-V-MKT\fix\` (correctifs).

## Statut : TERMINÉ (27/11), relecture corrigée (11/11 constats)

## Fait
- Lecture : SPEC §0–5, 8–12 + changelog, WAVE1 §5, FINAL-design §3.2/4/5/6/8 (W-P…W-U, W-W, W-X)/9,
  FINAL-cardmarket §2.1, §4.1, §5.3, legacy (marché, scellé, fiche produit, mon scellé, envies, notifications).
- Pas de tentative précédente (fichiers = ébauches F1 ; MK.md est le journal des données Cardmarket, pas celui-ci).
- `js/data/sealed.js` : lecture sealed.json + hist (net.data, mémorisés), libellés (type, puces), périodes disponibles,
  variation, cote figée (chg), dernier mouvement, tri, catalogue filtré + comptes, pistes (6 sections), mention.
- `js/views/ptile.js` : tuile produit (pistes), ligne produit (catalogue), pictogrammes par type, secours d'image
  400 px → 200 px → pictogramme, blocs des séries.
- `js/views/marche.js` + `js/views/marche/{cotes,scelle,monscelle,envies}.js` : une section par onglet gardée dans le DOM.
- `js/views/produit.js` : fiche (photo, noms, cote, « dès », plage + variation, dernière variation / prix inchangé,
  courbe 7 j–Tout avec lecture, premier prix ×, plus haut, 4 variations, Mon scellé en feuille, ☆, liens).
- `css/views/marche.css`, `tools/shotsteps/V-MKT.json` (30 étapes ; écritures IndexedDB avec nouvel essai).

## Tests (27/11, fin)
- `python -P work-V-MKT/func.py` : 45/45 (cotes + onChange, pistes, catalogue recherche/puces/tri/langue/rechargement,
  fiche : plage, lecture clavier, ☆, feuille Mon scellé avec validation, Retour ; Mon scellé ; envies : vérification,
  pastille + point, suppression + Annuler, #wishlist ; permission simulée « default » → activées ; pannes réseau du
  catalogue et de l'historique + Réessayer). Aucune erreur console.
- `python -P tools/shots.py --port 8805 --only V-MKT --width 320,390,1280 --themes light,dark` : 204 captures, 0 problème.
  Plus tôt : 320–1280 × clair/sombre avec les étapes marché de shell.json : 480 captures, seuls 6 échecs IndexedDB
  intermittents de l'outil (voir demandes à F1).
- `python -P work-V-MKT/perf.py` (2 000 cartes, CPU ×4) : pire délai d'interaction 88 ms, longues tâches ≤ 69 ms.
- `python -P tools/tests/router_test.py --port 8805` : 97/98 (échec 91 = vue Scanner, pas ce lot).

## Décisions
- Pistes : la période de chaque section suit l'historique disponible (1 an → 3 mois → 30 j → 7 j), le titre dit la
  période réellement utilisée (aujourd'hui « sur 30 jours » / « sur 7 jours », c90 et c365 étant vides).
- Pistes : écarte les variations aberrantes (vente isolée) : bornes 7 j 50 %, 30 j 100 %, 3 mois 200 %, 1 an 500 %,
  et exige un « dès » plausible. Le catalogue, lui, montre tout.
- Cartons et présentoirs (B2B) hors de « Tous », dans leur propre puce. Langue : International / Japonais / Toutes
  (prefs sealedLang 'int' | 'ja' | 'int+ja').
- Cote figée : « Prix inchangé depuis le … » au lieu de « 0 % » (tuiles, lignes, fiche, cellules « inchangé »).
- Lien TCGplayer de l'ancienne fiche retiré (Cardmarket seul) ; « Voir la série » quand la série est au catalogue FR.

## Relecture : correctifs (27/11, fixeur, port 8825)
Scripts : scratchpad `work-V-MKT\fix\` (h.py, serve.py, reproductions func5–func12 de la relecture, keep.py, rails.py,
fixcheck.py, func_all.py = func.py sur 8825, perf.py, perf2.py, cold.py, cls.py, star.py, trace.py). Une première
passe du fixeur (interrompue) avait déjà corrigé 1, 2, 3, 4, 5, 6, 7, 9, 11 ; elle a été relue et gardée. Cette passe :
retrait de l'instrumentation de mesure laissée dans scelle.js (window.__pc / __pp), puis 8 et 10 refaits.
1. Annuler (Mon scellé) : `ownSheet()` capture l'id du produit (fiche changée avant Annuler : le bon produit). func5 OK.
2. Mon scellé vide après liaison de l'ancienne version : `onChange` passe par `refresh()` (chargement du catalogue si
   besoin, puis rendu). func9 OK.
3. « Suivis » : `catalogue()` garde les produits suivis de toutes les langues (compte et liste), comme les pistes. func7 OK.
4. Cotes, 1re édition / tampon `allEditions` : « Prix toutes éditions » à la place des moyennes (ligne et aria-label),
   hors des hausses et baisses, ⓘ l'explique. func8 OK.
5. Focus des onglets du Marché : liens dessinés une fois puis corrigés sur place (aria-current, point, href). func12 OK.
6. Fiche restée en erreur : `resume()` relance `show()` quand il n'y a pas de produit. func6 OK.
7. Envies, « Voir sur Cardmarket » : nom anglais (`w.en` si F2 l'ajoute, sinon une requête GraphQL groupée au repos,
   une fois par carte et par session) ; nom français en secours. func3 : Bulbasaur, Pikachu, Charizard ex.
8. ☆ / Mon scellé changés depuis la fiche : section cachée → changement mis en file et appliqué au repos (whenIdle), ou
   au retour s'il n'est pas venu ; seules les tuiles, lignes et la puce « Suivis » concernées sont refaites. 'reload'
   (import, autre onglet, réparation des finitions v1) : rendu complet seulement si le suivi ou le scellé possédé ont
   changé (signature). Mesures (2 000 cartes, CPU ×4) : ☆ 72 → 40 ms sans longue tâche (onChange scellé 23–37 →
   0,2–1,4 ms), Retour 80 → 48 ms.
9. Rails sur ordinateur : flèches précédent / suivant (≥ 900 px avec souris), masquées quand tout tient, inactives en
   bout de rail. rails.py OK (1280 clair/sombre ; rien à 390).
10. Démarrage à froid sur #/marche/scelle : toutes les sections au premier passage avec les seules tuiles visibles
   (3 sur téléphone, 8 sur ordinateur), le reste des rails après l'affichage (rAF + setTimeout) ; plus de double rendu au
   démarrage ('reload' de la réparation v1 sans changement du scellé). perf2.py : [[276,91]]…[[347,84]] → [], [52], [51]
   (même ordre que Collection, 50–52 ms : la première image de la coque, voir demande à F1). cls.py : aucun décalage
   quand la suite des rails arrive (320, 390, 1280).
11. Onglet « Scellé » : rouvre la vue et les filtres laissés (`scelle.href()`), « Cotes » aussi (`cotes.href()`, filtre).
   keep.py OK, fixcheck.py OK.
En plus : Cotes ne refait plus rien au retour sur la section si rien n'a changé (112 → 40 ms), et après +1 ailleurs
seules la synthèse et les comptes changent quand les lignes affichées sont les mêmes (96 → 64 ms, plus de longue
tâche) ; textes de recherche du catalogue préparés au repos (`sealed.warmSearch()`).

## Tests (27/11, fin de la passe du fixeur)
- `func_all.py` (func.py du lot, port 8825) : 45/45. `fixcheck.py` : 26/26 (390 et 1280). Reproductions de la relecture :
  toutes corrigées. Aucune erreur console.
- `python -P tools/shots.py --port 8825 --only V-MKT --width 390,1280 --themes light,dark` : 136 captures, 0 problème
  (captures regardées : pistes 390 clair, 1280 sombre avec flèches, cotes 390 sombre, catalogue suivis 1280).
- `perf.py` (2 000 cartes, CPU ×4) : pire délai 72 ms (segment Catalogue, premier rendu : une tâche de 50 ms) ; toutes
  les autres interactions 16–64 ms sans longue tâche (première recherche : plus de longue tâche grâce à warmSearch).
- `perf2.py` / `cold.py` (navigateur neuf, CPU ×4) : #/marche/scelle [], [52], [51] ; #/collection/cartes [52], [50].
- Demandes : F1, première image de la coque ≈ 50 ms à CPU ×4 sur toutes les routes (Layout ≈ 30 ms, trace.py) ;
  F2, champ `en` (nom anglais) dans `WishDB.make()` rempli par la fiche carte.
- `tools/tests/router_test.py --port 8825` : 97/98 (échec 91 = vue Scanner, pas ce lot).

## Si reprise
- Rien en cours. Relancer `work-V-MKT\fix\func_all.py`, `fixcheck.py`, `perf.py`, `perf2.py` (serveur : `serve.py`, port
  8825 ; arrêter le serveur avant shots.py et router_test.py, qui lancent le leur sur le même port).
