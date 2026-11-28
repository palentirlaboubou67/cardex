# INT2 — intégration de la vague 2 (journal de reprise)

## Statut : TERMINÉ (28/11), rapport remis

Port local : 8899. Scripts et captures : scratchpad `work-INT2\` (start.diff = état du dépôt au départ, non commité :
correctifs V-COL, V-DECK, V-MKT, V-SCAN après le commit df8d4fa ; end.diff identique pour les fichiers des
propriétaires).

## Fait
- Base (run_base.sh → work-INT2/base1) : router 97/98 (91 : Scanner a maintenant onChange), store 16/16,
  data 21/21, sw 7/12 puis 10/12 relancé seul (mise à jour / periodicsync / v1 : instables une fois, passent seuls ;
  « logos affichés hors ligne 26 » : blocs repliés par défaut ; mode dev : modules en vol au controllerchange),
  wave1_test OK, test_market OK (88).
- imports.py : 371 imports statiques et dynamiques vérifiés, 0 problème (1 faux positif : `export const CW, CH`).
- Changements (tests seulement) : router_test 91 retire l'onChange du Scanner le temps du test ; sw_test t_data ouvre
  tous les blocs (prefs openBlocs) avant le passage hors ligne. Après : router 98/98, sw 11/12 (reste : mode dev).
- devsw.py : course confirmée (controllerchange à ~80–100 ms ; modules en vol = ni dans « seen » ni passés par le
  SW) → demande F2 (net.js), mode dev seulement.
- CSS des vues : aucun sélecteur global qui déborde sur une autre vue. Aucun console.log/debugger, aucun emoji ni
  « ! » dans les textes de js/.
- shots.py (run_shots.sh → shots1) : 159 étapes × 320/360/390/430/768/1280 × clair/sombre = 1 908 captures,
  0 problème (1er contenu max sur une racine 260 px), ~7,5 min par largeur. Planches regardées : 320 clair et
  sombre, 768 clair, 1280 sombre (+ 4 écrans en grand). --big 2000 --cpu 4 à 390 : 159 captures, 0 problème.
- smoke2 (54 routes) à 390 clair, 1280 sombre, 320 clair, 768 sombre, 430 sombre, 360 clair + collection vide 390 :
  mêmes 2 écarts partout (serie/zz-nope : 404 locaux d'une série inconnue ; cartes?q= : 1er contenu 301, le champ
  ouvert est le 1er contenu). 1280 : ← à x = 124 = bord gauche de la colonne centrée (seuil du script trop strict).
  Vide : racine → Scanner, états vides propres. Jamais pokemontcg.io.
- boot.py (remplace perf.py de la vague 1, chiffres incohérents) : 11 routes × 3 démarrages × CPU ×1/×4 → WAVE2 §5.
- Tour final (base2) : router 98/98, store 16/16, data 21/21, sw 11/12, wave1 OK, test_market OK.
- Écrits : docs/refonte/WAVE2.md, « Changelog (wave 2) » à la fin de SPEC.md. Rien de commité ; sw.js en mode dev,
  pas de data/manifest.json.

## Si reprise
- Rien en cours. Relancer : run_base.sh <dossier>, run_shots.sh <dossier> [largeurs], run_smoke.sh, boot.py,
  rep.py shots1 (résumé des report.json).
