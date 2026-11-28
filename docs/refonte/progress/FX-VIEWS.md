# FX-VIEWS — correctifs des écrans après la QA (journal de reprise)

Port local : 8912. Scripts et captures : scratchpad `FX-VIEWS\` (h.py = aides Playwright, avec une cale de test
SHIM_WATCH pour un bogue passager d'un autre correcteur ; smoke.py, func.py, trunc.py, measure.py ; inp_plus.py,
net_doubles.py, scroll.py, perf_boot.py + common.py/srv.py repris de QA-PERF avec SITE = dépôt (ou qa-prod pour
l'avant) et PORT = 8912).
Fichiers : js/views/* (sauf scanner*), css/views/* (sauf scanner.css), js/features/*, js/data/decks.js,
js/data/sealed.js, tools/shotsteps/*.

## Statut : TERMINÉ (28/11), rapport remis

## Fait (constats QA)
- ptile.js + marche.css : produit sans photo dont la série est au catalogue → couverture générée (logo de la série,
  pictogramme + type dans un coin, aria-hidden) ; pictogramme seul sinon ; photo cassée → même couverture.
  produit.js : boîte « nophoto » 120 px (160 px ≥ 900, logo 220 × 76) au lieu de 200 px / carré de 380 px.
- ptile.js prowHTML : « suivi » et « N possédés » flex none, seule la date se raccourcit (« inchangé depuis le … ») ;
  < 360 px : l'étoile seule (comme les tuiles).
- cotes.js : moyennes « 7 j 1 726 € · 30 j 1 166 € » (sans centimes ≥ 100 €), numéro avant la série (jamais coupé),
  finition + ×N + moyennes sur la 3e ligne, qui passe à la ligne au « · » (insécables ailleurs).
- decks.js / data/decks.js : ligne « 36,7 % · 3e · São Paulo » (eventShort : ville ; « Mondiaux 2016 ») ; aria-label
  garde la forme longue ; decks.css ≥ 720 : colonnes 1fr / 100–200 / 140.
- carte/alert.js : objet = « envie » partout (Modifier l’envie, Retirer l’envie, Envie modifiée, Envie retirée) ;
  rangeText() partagé avec envies.js (« jusqu’à 2,00 € », « 1,00 à 2,00 € ») ; prix proposé = 90 % du plus bas de
  (offre la moins chère, cote), « Actuellement dès X € » ; « Voir » → router.go ; nom anglais gardé dans l'envie (en).
- deck.js : « Ajouter les manquantes aux envies » avec la même règle (suggestOf) + en ; lien « Manquantes dans tes
  envies » data-push.
- envies.js : « Réautorise-les dans le navigateur » (2 lignes à 320), en-tête « Aucune dans ta fourchette · jamais
  vérifié » en deux morceaux insécables ; « Parcourir les séries » data-push.
- carte.js / alert.js : plus de point final dans les erreurs ; « Chercher une carte » (introuvable) data-push.
- carte.js/carte.css : pastille EN/≈ devant la légende sous l'image (plus sur l'illustration).
- reglages.js : icône du stockage persistant selon l'état (check / alert / info) ; import via backup.pickFile.
- serie.js/series.css : en-tête en attente de la hauteur finale (68 px de progression, 16 + 16 px de lignes),
  « Master set » réservé pendant le chargement ; série absente du catalogue déjà lu : pas de fichier de cotes.
- achievements.js : « Succès débloqué » attend qu'un toast avec action (vu depuis < 12 s) soit parti, un seul toast
  pour tout ce qui attend ; « Voir » → router.go ; decks lus par js/data/decks.js (pctOf, même règle que l'écran
  Decks : 9 énergies de base) au premier changement de la collection ou sur Succès (plus de decks.json au démarrage).
- collection.js, series.js, marche.js, decks.js : ← quand la racine est empilée sur un autre écran (depth > 0, hors
  entrée de feuille) ; barre refaite dans resume() (même adresse en cache, racine ou empilée).
- monscelle.js : linkLegacySealed au repos dès le chargement du module (préchargé par main.js) et après un 'reload'.
- produit.js : prix d'achat vide pour un nouveau produit + bouton « Utiliser la cote ».
- cartes.js + backup.js : « Importer une sauvegarde » de l'état vide ouvre le sélecteur (pickFile, import partagé avec
  Réglages, id #set-import gardé) ; show() se termine après le premier lot ; vue cachée : corrections différées
  (120 ms, appliquées au retour ou au prochain rendu).
- pokedex.js, pokemon.js : show() n'attend plus tous les lots.
- doubles.js : rendu immédiat, cotes des séries des doubles demandées d'abord, ordre refait à leur arrivée (150 ms).
- series.js : warmIndex au focus / pointerdown du champ (ou q dans l'adresse), plus à chaque show().
- Séries, Série, Decks : renderGrid de collection/grid.js (un lot par image) au lieu de core/list.js renderChunked.
- shotsteps V-MKT : étape « mkt-produit-couverture » (#/produit/903944).

## Mesures (A/B même séance : qa-prod = avant, dépôt = après)
- Doubles, réseau téléphone (150 ms, 1,6 Mbit/s), CPU ×4, 2 000 cartes sur 177 séries : premier contenu 3 599 → 2 158 ms,
  0 Ko de cotes avant le contenu (84 avant).
- Collection à froid, CPU ×4, 2 000 cartes : show() fini Cartes 1 014–1 150 → 250–337 ms ; Pokédex 503–519 → 257–422 ;
  Doubles 505–584 → 258–267.
- Séries défilée, tous les blocs ouverts : 1 273 → 1 055 Ko (− cards-index 147, − decks.json 73) ; blocs par défaut
  769 → 551 Ko. Reste au-dessus de 1 Mo : logos 711 Ko (demande FX-DATA/CA).
- « + » Série liste (inp_plus.py, 16 appuis) : après médiane 40 / max 48 / 0 > 50 ms ; avant 40 / 48 / 0 dans la même
  séance : constat non reproduit (machine moins chargée) ; la correction cachée de la grille Collection est quand même
  sortie de l'image de l'appui.

## Tests
- func.py 26/26 (alerte, deck, toast, Voir, barre en cache racine/empilée, envies vide, v1, scellé, import,
  réglages, squelette, série inconnue, doubles, index).
- trunc.py (320/360/390/430/768, 390 sombre) : 0 texte coupé dans les lignes corrigées, 0 débordement.
- tools/tests (--port 8912) : router 98/98, store 16/16, data 21/21, wave1 OK, sw 12/12 (sw.js resté en « dev »,
  pas de data/manifest.json).
- tools/shots.py --width 390 --themes light,dark (V-COL, V-SER, V-CARD, V-MKT, V-DECK, shell) : 340 captures,
  0 problème. --width 320 (clair, 5 fichiers V-*) : 143 captures, 0 problème. --width 1280 --dark : 143 captures,
  6 échecs IndexedDB du profil partagé .cache/shots-profile (« Internal error », autre agent en parallèle) ; repris
  avec --fresh (V-CARD, V-MKT) : 62 captures, 0 problème.

## Demandes aux autres propriétaires
- F1 : core/toast.js option de file d'attente (un toast sans urgence ne remplace pas un toast avec action) ; main.js
  toast « Voir » des envies (maybeCheckWishes) → router.go au lieu d'openRoot ; base.css `.tile-img .pill-en` en bas
  à droite (couvre le nom sur les tuiles) ; core/list.js renderChunked (plus utilisé par les vues).
- F2 : prices.ensure() plus de 6 en parallèle (ou un paquet) ; wishes.js priceFor + allEditions ; WishDB.make copie
  card.en (les vues posent déjà w.en) ; catalog.set()/prices pour une série inconnue à l'ouverture à froid.
- FX-DATA (MK, CA, decks) : TCGCSV catégorie 85 pour les photos japonaises (nom exact `n`) ; build_decks.py
  basicEnergy limité aux 9 types (l'appli ne lit plus le drapeau) ; logos plus légers (Séries défilée 1 055 Ko).
- Scanner : data-push sur les liens « Chercher par nom » (#/series?q=…) : Séries s'empile avec ←.
