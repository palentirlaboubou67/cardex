# V-DECK — journal (onglet Decks : liste des decks, page d'un deck, données des decks)

Port local : 8806. Scripts et captures : scratchpad `work-V-DECK\` (test_decks.py = tests fonctionnels,
perf_decks.py = délais d'interaction 2 000 cartes CPU ×4, shots_states.py = états jouable / envies, shots*/ = captures
de tools/shots.py).

## Statut : TERMINÉ (27/11), rapport remis

## Fichiers
- js/data/decks.js : load() (decks.json + sets() du catalogue, lecture période par période en rendant la main),
  status() mémorisé (rev collection + version cotes), priceOf()/cheapest(), toBuy(), art(), match() (texte de recherche
  calculé à la demande), linked(), brief(), enImage(), best() (succès « Prêt pour le tournoi »).
- js/views/decks/ui.js (pièces communes), js/views/decks.js (W-N), js/views/deck.js (W-O), css/views/decks.css.
- tools/shotsteps/V-DECK.json (18 étapes).

## Décisions
- Énergies de base : test sur le nom anglais (9 types). `basicEnergy` de build_decks.py marque aussi des énergies
  spéciales (Jet, Mist, Capture… : regex `^(Basic )?\w+ Energy$`), comptées à tort comme possédées par l'ancienne appli.
- Prix d'une carte : la moins chère des cotes normale / holo / reverse des fichiers MK (l'ancien builder prenait trend et
  trend-holo), sinon le prix de decks.json (bw11, série sans fichier, hors ligne). Deck = Σ nombre × prix ; reste = Σ
  manquantes × prix.
- Loupe dans la barre d'app (FINAL-design §6.6) plutôt qu'au bout de la rangée de puces (W-N : cachée par le fondu).
- Liens des onglets principaux : q, tri, filtre suivent ; saison reste sur Saisons passées. Recherche vide dans une
  section : bouton vers l'autre (« Voir 11 decks des saisons passées »).
- Recherche : noms de decks (FR, EN) et de cartes (FR, EN) ; trouvé par une carte : « Contient X ×N ».
- Page deck : lien Limitless en bouton texte dans le résumé + ⋯ ; ⓘ (légende, mentions) dans ⋯ ; lignes reliées à la
  fiche carte (reste dans l'onglet Decks), sous-titre « série · numéro » (code Limitless pour les cartes hors catalogue).
- Envies : finition jouable la moins chère, max = sa cote actuelle, low/trend posés depuis les fichiers, « Annuler » ;
  permission des notifications demandée après le premier ajout (comme avant) ; bouton → « Manquantes dans tes envies ».
- Rendu : Saisons passées par lots de 2 saisons ; cotes arrivées = chiffres corrigés en place (ni saut ni réordonnancement) ;
  collection modifiée = nouveau rendu d'un coup. Fichier des decks demandé dès l'appui sur l'onglet.

## Tests (finaux)
- test_decks.py : 53/53 (filtres, tri, recherche, saison, URL, rechargement, cache de vue + défilement, cotes nouvelles
  au retour, envies + Annuler, énergies de base, prix, bw11 sans lien, carte non reliée, deck inconnu, lien profond,
  panne decks.json + Réessayer, cotes injoignables -> secours, 0 erreur console).
- tools/shots.py --only V-DECK,decks-actuelle,decks-passees,deck, 320/360/390/430/768/1280 clair + sombre : 300 captures,
  0 problème, aucun débordement, premier contenu des racines ≤ 251 px (241 px après réglage, passe 320/390/1280).
- perf_decks.py (2 000 cartes, CPU ×4, médiane de 3) : interactions 16–48 ms, aucune longue tâche > 50 ms ; contenu :
  1re ouverture 202 ms, Saisons passées (125 decks) 255 ms, page deck 56–95 ms, retour 33 ms.
- router_test.py : 1–39b OK, arrêt à l'étape 40 (lien vers Séries dans l'écran Scanner, en cours chez V-SCAN).

## Demandes aux autres
- V-COL (achievements.js) : utiliser decks.best() / decks.status() (mêmes règles que l'écran, énergies spéciales non
  possédées) au lieu de la copie de deckPct qui lit `basicEnergy`.
- Orchestrateur : corriger la regex `basicEnergy` de tools/build_decks.py (9 types de base).

## Si reprise
- Lire ce journal, puis les fichiers ci-dessus ; ne pas repartir de zéro.
