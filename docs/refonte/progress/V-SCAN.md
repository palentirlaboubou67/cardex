# V-SCAN — journal (vue Scanner)

Port local : 8804. Scripts et captures : scratchpad `work-V-SCAN\` (h.py = serveur + Chromium, t_*.py = tests).

## Statut : TERMINÉ (27/11) — rapport remis

## Fait
- Lecture : SPEC §0–5, 8–12 + changelog, WAVE1 §5, FINAL-design §3.2/4/8 (W-A, W-B)/9, FINAL-scanner §0/5.7,
  legacy (scanner app.js l.249-360, index.html, style.css), API js/scan (index, camera, loop, client), modules F1/F2.
  Pas de tentative précédente (scanner.js = ébauche F1, scanner.css vide).
- js/views/scanner.js : viseur (guide 63:88 en unités de conteneur, extérieur assombri, quad SVG, coins verts à 4 côtés,
  ligne de lecture pendant l'identification), pastille aria-live filtrée (300 ms) + annonces, déclencheur, import,
  lampe, zoom (paliers 1 / 1,5 / 2 / 3 dans les capacités), états caméra (off, insecure, unsupported, denied,
  nocamera, busy, lost, unknown), caméra coupée sur hide / page cachée, relancée sur show / resume / retour visible,
  préférence scanCam (caméra arrêtée par l'utilisateur = gardée éteinte), base préchargée avec progression et reprise
  au retour du réseau, panneau (résultat, choix top 3, non reconnue, analyse photo), même illustration = dups + twins
  de cards.json (les sosies vont dans « Pas la bonne ? »), ajout explicite + toast Annuler, onChange (quantité),
  menu ⋯ (scan automatique, liste de la séance, arrêter la caméra), Échap ferme le panneau, crochet _test.
- js/views/scanner/panel.js (gabarits), js/views/scanner/session.js (séance en sessionStorage, annulation).
- css/views/scanner.css (téléphone : panneau sur le bas du viseur ; ≥ 900 px : colonne de droite ; toasts en haut
  du viseur sous 900 px ; commandes masquées sous le panneau ouvert).
- tools/shotsteps/V-SCAN.json : 13 étapes (chacune repart de #/scanner).

## Tests (port 8804)
- shots.py --only V-SCAN,scanner, 6 largeurs × clair/sombre : 168 captures, 0 problème.
- t_live.py (fausse caméra, clip Pikachu 151 dans le guide, clips/pika_390.y4m généré par gen_clip.py) : 15/15
  (clair et sombre) : reconnaissance, ajout, Annuler, séance, fermeture quand la carte part, caméra coupée / relancée.
- t_features.py : 23/24 (le seul échec : messages de tesseract en console.error, voir demandes à SC).
- router_test.py : 97/98 (test 91 suppose un Scanner sans onChange : demande à F1).
- Ajouts de fin : focus clavier (titre du panneau après déclencheur / photo, retour au déclencheur à la fermeture),
  Échap global sur la vue, commandes et bloc caméra masqués sous le panneau ouvert (< 900 px), « Chercher une carte
  par son nom » dans les blocs caméra inutilisable, reprise du scan en direct après une photo sans résultat.
- t_import.py (photos réelles, 2 tirages de 14) : graine 5 : 9 justes, 3 choix avec la bonne, 2 non reconnues ;
  graine 11 : 12 justes, 1 fausse (xy1-30 → xy12-22, M Tortank EX, paire absente de dups), 1 choix sans la bonne ;
  image illisible et photos sans carte OK.
- t_sizes.py : panneau entier sans défilement de 360×640 à 1280×800 (320×568 : défile de 71 px, accepté).
- t_offline.py : base coupée → pastille + panneau « Base des cartes indisponible », reprise 1,1 s après « online ».
- t_perf.py (CPU ×4, 2 000 cartes, Collection montée) : +1 64 ms puis 32 ms, vignette 24, séance 24, puce 24,
  fermer 16 ; scan en direct ×4 : 0 tâche longue.

## Si reprise
- Lire ce journal, puis les fichiers ci-dessus ; ne pas repartir de zéro. Relancer les t_*.py du scratchpad.
