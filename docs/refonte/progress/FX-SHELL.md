# FX-SHELL — correctifs de la coque et des données après la QA (journal de reprise)

Port local : 8911. Scripts et captures : scratchpad `FX-SHELL\` (sync.py = copie de production du dépôt dans
`FX-SHELL\prod` + `tools/release.py --root` ; perf_boot.py, dbg_boot.py, trace_lt.py, common.py, srv.py repris de
QA-PERF avec SITE = `FX-SHELL\prod` et PORT = 8911 ; frames.py = tâches de plus de 30 ms par démarrage (trace) ;
prof_boot.py = profil JS du démarrage ; fontbench.py = coût d'un nouveau style de texte ; smoke.py = routes
principales en mode dev ; gap.py = largeur du séparateur des milliers ; dbg_import.py).
Fichiers : index.html, manifest.webmanifest, css/tokens.css, css/base.css, js/main.js, js/core/*, js/components/*,
js/state/*, js/data/{catalog,images,prices,tcgdex,finishes,dex}.js, sw.js, tools/release.py, tools/shots.py,
tools/tests/*.

## Statut : TERMINÉ (28/11), rapport remis

## Fait (constats QA)
- QA-VIS holo sur la vignette sans image : base.css `.card-ph ~ .fx`, `.cp-img:has(> .card-ph) ~ .fx / .cp-glare`
  masqués (tuiles et fiche carte). Le calque revient seul quand la table des images arrive en retard et remplace la
  vignette (refreshImages). Vu en sombre à 390 et 1280 (#/serie/2013bw?master=1, #/carte/2013bw-1).
- QA-VIS séparateur des milliers : format.js remplace U+202F (absent d'Instrument Sans) par U+00A0 dans eur, eurC,
  eurDelta, pct, num (donc plural) ; `nbsp()` exporté pour les modules qui appellent Intl eux-mêmes. Mesuré : 2,5 px à
  13 px (1,3 avant), 2,1 px à 12 px (1,0), 5,1 px dans le héros 28 px. Formateurs Intl créés au premier usage.
- QA-VIS numéro caché par le nom de série : tile.js, méta par défaut « numéro · série » (« 161 · Évolutions P… ») ; la
  fin de ligne est coupée, le numéro reste. pokemon.js passe encore sa propre méta « série · numéro » : demande FX-VIEWS.
- QA-FLOW sauvegarde v1 importée appli ouverte : main.js relance la revue des finitions sur chaque événement 'reload'
  tant que `needsFinishCheck()` (une seule à la fois, reprise sur 'online') ; `exportText()` écrit `fixFin: 1` tant que
  la revue est en attente (le fichier réimporté est corrigé ailleurs). wave1_test 6 (3 contrôles).
- QA-PERF longue tâche au démarrage : collection.js lue au premier usage (plus pendant l'évaluation des modules),
  `warm()` / `peekHasCards()` ; main.js : squelette, puis `nextPaint()`, puis lecture de la collection et route dans
  une autre tâche ; appbar.js ne lit plus scrollY au premier setBar (mise en page forcée) ; styles de texte des
  composants préparés dans l'image du squelette (TYPE_WARM : la première mise en page d'un style de la police variable
  coûte 2 à 5 ms à CPU ×4, fontbench.py). Évaluation de main.js 50–70 ms → 10–13 ms (+ 26–33 ms de lecture et route
  dans sa tâche) ; première image du contenu 38–65 ms → 33–50 ms.
- QA-PERF 180 Ko : feuilles des vues chargées à la première visite (main.js viewCss, show() les attend, préchargées au
  repos avec les modules des onglets) : −16 Ko sur chaque racine ; tcgdex.js chargé à la demande par catalog.js
  (−3,4 Ko sur les racines qui ne s'en servent pas : Collection, Séries, Série, Decks). Pas fait : manifest des historiques à part (−3 Ko, purge du service
  worker à refaire pour un gain de 1,7 %) ; police sans axe de largeur (−27,6 Ko) = choix de design (voir rapport).
- QA-PERF hors ligne dès la 1re séance : sw.js lance warmSoon() après la copie de ce que la page a chargé (message
  'seen' de la première prise de main).
- QA-PERF installation : `cache: 'no-cache'` à la première installation (revalidation ETag, 304), 'reload' pour une
  mise à jour.
- QA-PERF plafonds : coupe tous les TRIM_BURST = 20 ajouts même dans la minute, et coupe prévue en fin de minute
  (setTimeout, sans waitUntil). sw_test « plafonds » refait (FIFO exact ; afflux ≤ plafond + 19 puis retour au plafond).
- Trouvé en route : une attente longue dans un waitUntil de l'ancienne version (20 s avant la consultation hors ligne)
  retardait l'activation d'une mise à jour après « Recharger » (router_test 60/61 en échec, et sans doute l'échec
  intermittent « mise à jour » de sw_test en vague 2). sw.js : message 'yield' (envoyé par main.js avant
  « activate-now » et par la nouvelle version) qui arrête le travail de fond ; pause() interruptible.

## Fait (demandes de FX-DATA, docs/refonte/progress/FX-DATA.md)
- prices.js : `allEditions` aussi quand la 6e valeur vaut 1 (produit 1re édition / tampon qui sert aussi l'impression
  sans tampon : base1, 102 entrées) ; wishes.js priceFor : même règle.
- prices.js : la tendance des fichiers de cotes est prise telle quelle (MK la garde déjà : majorité des moyennes,
  sinon médiane) ; la garde [réf/5, réf×5] ne sert plus qu'à la cote TCGdex en direct (smp-SM163 : 233 € et non
  116 €). wishes.js : même lecture. data_test adapté (règle + contrôle de la 6e valeur).
- collection.js repairFinishes : « normale » de la v1 -> « cosmos » sur une carte qui n'existe qu'en Cosmo (ni normale
  ni holo). store_test « finitions de la v1 » complété (Cosmo seule ; ni holo ni Cosmo : rien deviné).

## Fait (WAVE2 §7)
- F1 main.js : longue tâche du démarrage (ci-dessus).
- F1 list.js : renderChunked, un lot par image (nextPaint de idle.js : rAF puis une tâche).
- F1 .sr : la marge −1 px reste (évite un débordement d'1 px au bord droit) ; shots.py ignore les éléments
  visuellement cachés (1 × 1 px ou dans un .sr).
- F2 net.js : second message 'seen' 3 s après la prise de main (PerformanceObserver : ce qui était en route) ;
  sw_test « mode dev » passe (12/12).
- F2 wishes.js priceFor : 1re édition / tampon égaux à la normale ou à la holo = pas de prix (allEditions), jamais
  TCGdex pour ces éditions (produit de base seulement) ; prices.liveSync marque aussi allEditions pour elles.
- F2 WishDB.make : champ `en` (option `en` ou `card.en`).
- F2 catalog/prices : pas de data/sets/<id>.json pour une série absente de data/sets.json (et pas de TCGdex si la
  liste TCGdex du jour ne la connaît pas non plus) ; pas de fichier de cotes sans manifest (développement) quand
  sets.json dit que la série n'existe pas.
- V-COL achievements → js/data/decks.js et build_decks.py basicEnergy : faits par FX-VIEWS et FX-DATA (pas mes fichiers).

## Tests (port 8911, tour final)
- router_test 98/98 ; store_test 16/16 (warm() après chargement du module, Cosmo, médiane) ; data_test 21/21 (règle de
  MK, 6e valeur : 102 entrées « toutes éditions », 0 tendance de fichier changée par la règle) ; wave1_test OK
  (18 contrôles, dont 6 nouveaux) ; sw_test 12/12 (était 11/12) ; test_market OK.
- smoke.py 22 routes à 390 : 0 erreur (#/serie/zz-nope à froid : un 404 de TCGdex en direct, plus de 404 local).
- shots.py 390 et 1280 × clair et sombre : 640 captures ; 16 échecs = 4 étapes × 4 passes (carte-alerte,
  carte-1re-edition-alerte, mkt-cotes, mkt-envies-vide), tous dus au profil Chromium partagé avec le shots.py de
  FX-VIEWS lancé en même temps (IndexedDB « UnknownError: Internal error ») ; shots.py corrigé (un profil par port),
  les 8 étapes concernées relancées : 48 captures, 0 problème.
- perf_boot.py (production, 2 000 cartes, CPU ×4, 14 racines × 3 démarrages à froid + 3 avec le service worker) :
  0 démarrage sur 84 avec une tâche de plus de 50 ms (QA : 81/84). Octets avant le premier contenu (corps gzip) :
  Cartes 166, Pokédex 175, Séries 178,5, Série 188, Carte 191, Scanner 190, Doubles 191, Mon scellé / Envies 197,
  Cotes 209, Decks 249, Succès 272, Scellé 349 (QA : 179, 182, 188, 199, 198, 261, 211, 201, 209, 182–264, 281, 353).
- first_session.py : installation du service worker 137 Ko (67 réponses 304, 24 de 200) au lieu de ~408 Ko ; toutes
  les séries et tous les logos hors ligne à 22 s pendant la 1re séance (QA : 85/186 et 25/280).

## Si reprise
- Rien en cours. sync.py puis perf_boot.py / frames.py pour mesurer ; smoke.py pour les routes.
