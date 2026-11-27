# V-SER — vues Séries et Série (journal de reprise)

## Statut : TERMINÉ (27/11), correctifs de la relecture appliqués (27/11, passe FIXER)

Port local : 8822 (passe FIXER ; 8802 avant). Scripts et captures : scratchpad `work-V-SER\` (kit.py serveur + navigateur + collection
synthétique ; smoke.py captures ; func.py 26 tests de comportement ; perf.py INP ×4 ; ttfc.py appui → tuiles ;
net.py requêtes et poids ; widths.py débordement 320–1280 ; rt\router_test_vser.py = copie de router_test avec
2 sélecteurs corrigés).
Fichiers : js/views/series.js, js/views/serie.js, js/views/setrow.js, css/views/series.css, tools/shotsteps/V-SER.json.

## Fait
- setrow.js : progression (cartes hors secrètes / goalOf), ligne de série (colonnes fixes : barres alignées), patch.
- series.js : recherche globale (?q, warmIndex à l'affichage, 160 ms, « Afficher plus » par 120, puces actives
  pendant la recherche, statut lu par les lecteurs d'écran), puces Toutes / Les miennes / En cours avec comptes,
  blocs repliables mémorisés (prefs openBlocs), lignes rendues à l'ouverture d'un bloc, menu ⋯ (À propos,
  Déplier / Replier tous les blocs), mises à jour en place, coche sur une carte possédée en 1 exemplaire.
- serie.js : en-tête (logo, symbole, code, légalité, cartes + secrètes, progression Cartes et Master set, ligne
  Valeur → feuille « Valeur de la série »), filtre segmenté, Grille / Liste / Classeur, tri (numéro, prix ↓,
  prix ↑, nom), master set statique, coches (double appui ignoré, Annuler, ×N → fiche), classeur 9 pochettes
  (glisser, ← →, ?page, pages suivantes préchargées, double page ≥ 1100 px), cotes en retard corrigées en place,
  hors ligne (Réessayer) / série introuvable.

## Correctifs de la relecture (passe FIXER, 27/11)
- series.js : listes filtrées périmées. `listed` garde les séries de la liste affichée ; onChange (carte ajoutée ou
  retirée, filtre actif) marque la liste à refaire si une série entre ou sort, et les résultats filtrés toujours ;
  refait tout de suite si la vue est affichée, sinon au retour. resume() recompte toujours les puces ; refresh()
  aussi pendant une recherche ; catalog.onUpdate recompte les puces pendant une recherche.
- series.js : statut lu (`p.sr role=status`) placé dans un `div.pad` (position statique dans la marge) : il était
  à x = -1 px et shots.py signalait 34 problèmes à 390 px (l'ancien « 144 captures 0 problème » était faux).
- serie.js : « Réessayer » passe le signal du dernier show()/resume() (`lastSig`) ; open() sort tout de suite si le
  signal est annulé ; barFor() ne pose rien si la vue est cachée. Nouveau resume() : série en erreur (ou nouvel
  essai quitté en route) redemandée au retour, sauf « introuvable » ; cotes manquantes redemandées.
- serie.js : focus clavier. Filtre, affichage et master set corrigés en place (patchTools, aria-pressed) ; barre
  refaite seulement en entrant ou sortant du classeur, focus rendu au bouton équivalent (seulement s'il était
  visible au clavier). Classeur tourné en place (flèches, étiquette aria-live, pages) ; dernière page : focus sur
  l'autre flèche.
- serie.js : cotes absentes. askPrices() note les séries dont le fichier n'a pas pu être chargé : ligne « Valeur ·
  Cotes indisponibles » (bouton, chevron) au lieu du squelette éternel ; la feuille réessaie, explique (« Vérifie ta
  connexion, puis rouvre cette feuille ») et n'affiche plus « N sans cote » quand le fichier manque.
- Tests : work-V-SER\fix.py (52 vérifications, les scénarios de la relecture + retours par le cache, Entrée deux fois,
  dernière page du classeur, clic souris sans anneau, cotes revenues en ligne) ; perf2.py (nouveaux chemins).

## Tests (derniers résultats, passe FIXER)
- shots.py --only V-SER --width 320,390,1280 --themes light,dark --fresh : 216 captures, 0 problème (sortie 0).
- shots.py étapes de shell.json qui touchent Séries/Série (series, series-recherche, serie, series-sous-series,
  serie-exu, serie-logo-sombre, feuille-menu) × 320/390/1280 × clair/sombre : 42 captures, 0 problème.
- fix.py 52/52 ; func.py 26/26 ; widths.py 320…1280 : aucun débordement.
- perf ×4, 2 000 cartes : INP max 56 ms ; retour sur « Les miennes » refaite 53 ms jusqu'à l'image ; « En cours »
  refaite sous les yeux : une image de 67 ms (chemin rare) ; classeur tourné en place : aucune image > 50 ms.
- net.py : page série ouverte dans l'appli = 2 requêtes de données (sets/<id>.json + prices/<id>.json).

## Tests (passe précédente, pour mémoire)
- shots.py --only V-SER : annoncé « 390/1280 × clair/sombre 144 captures 0 problème » — faux à 390 px (statut .sr,
  corrigé ci-dessus) ; 320/768 clair 72 captures ; étapes de shell.json : 36 captures 0 problème.
- func.py 26/26 ; widths.py 320…1280 : aucun débordement ; outils sur une ligne dès 360 px.
- router_test (copie avec sélecteurs `#v-sets input[name="q"]` et lien injecté) 97/98 (échec 91 = Scanner).
- wave1_test OK ; sw_test : « logos affichés hors ligne 26 » (blocs repliés par défaut) → demande à F2.
- perf ×4, 2 000 cartes : INP max 64 ms (Séries) / 56 ms (Série) ; appui → premières tuiles 76–159 ms.
- Page série : 2 requêtes de données (sets/<id>.json + prices/<id>.json) ; Séries parcourue : 0,50 Mo d'images
  par défaut, 0,91 Mo tout déplié (+ index de recherche 143 Ko gzip, 580 Ko bruts).

## Décisions
- Blocs : sans état gardé, premier bloc + blocs où j'ai des cartes (comme l'ancienne appli). Filtre : tout ouvert.
- Progression « Cartes » : cartes dont le numéro est dans le total imprimé ; secrètes comptées à part.
- Tri `tri=prix|prix-asc|nom` (paramètre ajouté). Valeur de l'en-tête = une version par carte (normale, sinon holo…).
- Coches : bascule immédiate depuis le store ; 2e appui sur la même coche < 450 ms ignoré ; retrait avec Annuler.
- Recherche + puce : « Les miennes » = mes cartes et mes séries ; « En cours » = séries commencées et leurs cartes.
- Classeur : ni filtre ni tri ; master set possible ; légendes masquées (comme un vrai classeur).
