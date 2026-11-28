# V-DECK — journal (onglet Decks : liste des decks, page d'un deck, données des decks)

Port local : 8806 (construction), 8826 (correctifs de la relecture). Scripts et captures : scratchpad `work-V-DECK\`
(test_decks.py = tests fonctionnels, perf_decks.py = délais d'interaction 2 000 cartes CPU ×4, fix_checks.py = les 7
constats de la relecture, serve.py = serveur sur 8826 pour fix_checks, shots_states.py = états jouable / envies,
shots*/ = captures de tools/shots.py).

## Statut : TERMINÉ (27/11), correctifs de la relecture faits et vérifiés, rapport remis

## Fichiers
- js/data/decks.js : load() (decks.json + sets() du catalogue, lecture période par période en rendant la main),
  status() mémorisé (rev collection + version cotes), priceOf()/cheapest(), toBuy(), art(), match() (texte de recherche
  calculé à la demande), linked(), brief(), enImage(), best() (succès « Prêt pour le tournoi »).
- js/views/decks/ui.js (pièces communes), js/views/decks.js (W-N), js/views/deck.js (W-O), css/views/decks.css.
- tools/shotsteps/V-DECK.json (21 étapes).

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
- Envies : finition jouable la moins chère, max = 90 % de sa cote (même règle que la fiche carte), low/trend posés
  depuis les fichiers ; le message dit combien sont déjà dans la fourchette (« dont N déjà… », « toutes déjà… ») ;
  « Annuler » ; permission des notifications demandée après le premier ajout (comme avant) ; bouton → « Manquantes
  dans tes envies ». La feuille ⓘ le dit aussi.
- Rendu : Saisons passées par lots de 2 saisons. Collection modifiée ou cotes arrivées = mise à jour en place, jamais un
  nouveau rendu (liste : chiffres, puces, lignes ajoutées / retirées / déplacées ; page deck : lignes, totaux des
  groupes, résumé, bouton des envies). L'ordre suit tout de suite si la liste n'est pas défilée (≤ 184 px), sinon au
  retour sur l'écran (resume). Barre de progression sous la barre d'app tant que des cotes manquent. Seul un
  changement de saisons affichées (filtre) refait la liste. Fichier des decks demandé dès l'appui sur l'onglet.
- États vides rédigés pour la saison choisie (« cette saison ») ; boutons : l'autre filtre s'il a des decks, « Voir N
  … dans toutes les saisons », l'autre section ; au plus deux, sinon « Voir tous les decks » / « Effacer ».
- Saison passée gardée en passant par Méta actuelle (lastSaison) ; Échap qui ferme la recherche rend le focus à la loupe.
- Cartes jamais reliées : séries connues hors du catalogue français (bw11), même si sets.json est injoignable.

## Relecture (27/11) : 7 constats, tous corrigés
1. Collection modifiée = nouveau rendu (liste et page deck) → mise à jour en place (sync() / patch()). Retour après un
   ajout, 125 decks, CPU ×4 : 64 ms, aucune longue tâche (avant : 128 ms, tâches de 60–92 ms) ; nœuds et images gardés.
2. Tri par prix faux quand les cotes arrivent après 400 ms → l'ordre suit à l'arrivée (liste en haut) ou au retour.
3. États vides sans la saison → texte « cette saison », bouton « toutes les saisons », Presque seulement s'il y en a.
4. Saison perdue après Méta actuelle → lastSaison dans le lien de l'onglet.
5. Échap → focus sur la loupe.
6. Envies déjà dans la fourchette à la création → 90 % de la cote (comme la fiche carte) et message qui le dit.
7. Sans sets.json, bw11 relié → liste OUTSIDE (bw11) dans js/data/decks.js.

## Tests (finaux)
- fix_checks.py (port 8826, serve.py) : 30/30 (les 7 constats, réseau lent CDP 400 ms / 1 Mbit/s pour le tri, sets.json
  en 503 + TCGdex bloqué pour bw11, 0 erreur console ; un ERR_ABORTED d'un fichier de cotes sous réseau lent = délai de
  15 s de net.js, pas une erreur de l'écran).
- test_decks.py --port 8826 : 53/53.
- tools/shots.py --port 8826 --only V-DECK --width 390,1280 --themes light,dark : 96 captures, 0 problème (2 étapes
  ajoutées : dk-saison-jouables-vide, dk-saison-recherche-vide).
- perf_decks.py --port 8826 (2 000 cartes, CPU ×4, 3 passes) : interactions 16–64 ms ; « ← retour après ajout » 64 ms
  sans longue tâche, lignes gardées ; une passe sur trois : une tâche de 56 ms à la toute première ouverture de l'onglet
  (sans doute la lecture de decks.json, 746 Ko ; cause non vérifiée, chemin non touché par les correctifs).

## Tests (construction)
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
