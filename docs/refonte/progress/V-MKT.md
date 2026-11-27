# V-MKT — journal (Marché : Cotes, Scellé, Mon scellé, Envies ; fiche produit)

Port local : 8805. Scripts et captures : scratchpad `work-V-MKT\` (smoke.py, func.py, perf.py, shots-final\).

## Statut : TERMINÉ (27/11)

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

## Si reprise
- Rien en cours. Relancer func.py / perf.py (scratchpad work-V-MKT) et shots.py --only V-MKT pour vérifier.
