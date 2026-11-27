# V-CARD — fiche carte (`#/carte/:cardId`)

Propriétaire : `js/views/carte.js`, `js/views/carte/{details,holo,alert}.js`, `css/views/carte.css`,
`tools/shotsteps/V-CARD.json`. Port de test : 8823 (8803 avant la correction). Scripts et captures : `$SP\work-V-CARD\`
(check.py, interact.py, inp.py, cold.py, rt_part.py ; scripts de la relecture repris dans `rv\`, plus `rv\ae2.py`).

## Journal

- 27/11 — Reprise : pas de tentative précédente (seule l'ébauche F1 de la vague 1 existait). Lecture de SPEC §0–5, §8–12,
  WAVE1 §5, FINAL-design §3.2, §4, §5–9 (W-H, W-W, W-X), ancien code (`legacy/js/app.js` openCard, renderVariants,
  bindHolo, renderWishBox, trendBox). Échantillons TCGdex (8 fiches) pour les formes : attaques, talents, dresseur,
  énergie, faiblesse/résistance, `description`. GraphQL `{ card(id) { name } }` renvoie le nom anglais (lien Cardmarket).
- 27/11 — Écrit : vue complète (image, nom, collection, cote, alerte, détails, attaques), feuilles (alerte prix, image
  agrandie, finition non répertoriée), styles une et deux colonnes, clair et sombre.
- 27/11 — Corrigé après captures : ligne « Évolue de » fusionnée dans « Stade » ; raretés « Aucune » / « Sans Rareté »
  masquées ; à moins de 360 px la cote passe sous le nom de la finition (« Cosmo Holo » n'est plus coupé) ; collection
  rechargée (import, réparation des finitions v1) : les lignes repartent de la collection et l'aperçu revient sur une
  finition de la carte ; titre de la barre et chargements gardés quand main.js refait la même route sans rappeler la
  vue (signal annulé alors que la fiche reste affichée, vu avec `tools/shots.py --only`).
- 27/11 — Correction après relecture (5 constats, tous corrigés) :
  1. « Autre finition » : l'écouteur était posé sur le corps partagé de la feuille (jamais retiré), donc un de plus à
     chaque ouverture ; deux `close()` le même tour faisaient deux Retour et quittaient la fiche. Écouteur sur le
     `.menu` neuf + drapeau `done` (un seul choix, un seul `close()`), fiche vérifiée après la fermeture.
  2. Légende « Même illustration que … » : `.cp-hero` (perspective) est peint comme un élément positionné et
     recouvrait le haut du lien (marge −8 px). Légende en `position: relative`, plus de chevauchement (bas de l'image
     ramené à 12 px quand il y a une légende, classe `has-cap`), lien en `inline-block` avec une zone de 44 px de haut
     (marges négatives : la mise en page ne bouge pas).
  3. Prix toutes éditions (1re édition, tampon) dans l'alerte : `suggestOf` ne propose rien sur un tel prix (ligne
     « Créer une alerte prix », max vide) ; feuille : « Pas de prix propre à cette version · prix toutes éditions :
     cote X € » (plus de « En vente dès » de la carte de base) ; aucun low/trend écrit dans l'alerte (plus de « Déjà
     dans ta fourchette » immédiat) ; ligne d'une alerte existante sur une telle finition : « Pas de prix propre à
     cette version », cloche simple, même si une vérification y a écrit le prix de la carte de base. Changer de
     version remet le max proposé tant qu'il n'a pas été tapé.
  4. Réessayer après Retour puis Avancer (fiche en échec, cache) : `resume()` enregistre la route avant de sortir
     (`lastR`, `s.sig`). Si main.js a rejoué la même route (signal annulé, fiche affichée), Réessayer prend un signal
     à la fiche (`retryCtl`, annulé par `hide()` et par le `show()` suivant) : barre, cloche et ⋯ bien posées.
  5. Ligne d'alerte sur une finition hors catalogue en aperçu : elle nomme et chiffre la finition que la feuille
     utilisera (`alertFin` : l'aperçu si la carte l'a, sinon sa première) ; la cloche modifie l'alerte de l'aperçu ou
     de cette finition si elle existe.

## Ce que fait la fiche

- Route `#/carte/:id?finition=…` ; id lu par `router.cardId(r)` (décodé une fois, anciens liens non encodés, jamais
  d'exception) ; id invalide (`abc%`) → « Carte introuvable » sans requête. Reste dans l'onglet d'où on l'ouvre.
- Image : `imgHTML` basse (déjà en cache depuis la grille) puis haute posée dessus quand elle est chargée ; en échec, la
  basse reste. Pastille `enBadge`, légende `imgCaption` (lien vers la carte d'origine pour « Même illustration que … »).
  Inclinaison ±8° + reflet au pointeur (souris, ou glisser horizontal au doigt), calque de la finition en aperçu qui
  glisse, un reflet au changement de finition, rien quand le mouvement est réduit. Toucher l'image : feuille avec
  l'image en grand.
- Titre de la barre caché (`titleHidden`) puis `revealTitle` quand le nom passe sous la barre (IntersectionObserver).
- « Ma collection » : une ligne par finition de la carte (`brief.finishes`) + celles possédées hors catalogue ; cote de
  chaque finition (`prices.get`, « — » sans cote, « Prix toutes éditions » quand `allEditions`) ; compteurs
  `col.setQty`, toast « Ajoutée en Reverse · 3 au total » / « Retirée en … » + « Annuler » ; focus gardé (mise à jour
  en place) ; toucher une ligne = aperçu (`?finition=` par `setParams`, gardé au rechargement).
- Cote Cardmarket de la finition en aperçu : tendance, delta 30 j, moy. 7 j, moy. 30 j, hier, prix bas, « Voir sur
  Cardmarket » (recherche par le nom anglais, SPEC §8, nom français tant qu'il n'est pas arrivé), date du guide, ⓘ.
  Secours `prices.liveSync(fiche, finition)` (cmFor) seulement si la carte manque au fichier de cotes ; mention « en
  direct (TCGdex) ».
- Alerte prix (= envies, `window.WishDB`) : alertes de la carte (modifier, Retirer + Annuler), « Me prévenir sous X € »
  (90 % de la cote), feuille W-W (version parmi les finitions de la carte, min, max, prix en vente ; sur un prix toutes éditions : pas
  de prix proposé ni de prix en vente, « Pas de prix propre à cette version »), permission des
  notifications demandée pendant le geste, toast « Ajoutée à tes envies · Voir ». Cloche de la barre : même feuille,
  icône `bell-ring` quand une alerte existe.
- Détails : série (logo, période, date) et Pokémon (sprite, `#0006 · toutes ses cartes`) en lignes de navigation ;
  numéro, rareté, catégorie (dresseur, énergie), illustrateur, type · PV, stade (« évolue de … »), format (marque,
  Standard / Étendu), faiblesse · résistance · retraite, texte du Pokédex. Talents, attaques (coûts en pastilles
  d'énergie, codes `{R}` du texte remplacés), effet des dresseurs et énergies. Fiche TCGdex en échec : ligne « Détails
  indisponibles · Hors ligne » + Réessayer, le reste de la fiche marche.
- Lien vers la série d'où l'on vient = Retour (pas de nouvelle entrée, défilement de la série retrouvé).
- ⋯ : « Ajouter une finition non répertoriée » (ancien « Ma carte a une autre finition… ») ; « Réglages et sauvegarde ».
- ≥ 900 px : deux colonnes (image 360 px collante, le reste 640 px max) ; image agrandie en dialogue presque plein écran.

## Tests (27/11)

| Commande | Résultat |
|---|---|
| `python -P -X utf8 $SP\work-V-CARD\interact.py` | 38/38 (compteurs, Annuler, focus, aperçu + rechargement, titre au défilement, image agrandie, inclinaison, alerte créée / retirée / Annuler / modifiée / retirée depuis la feuille, finition non répertoriée, lien série = Retour, Avancer en cache, lien Pokédex, exu-%253F, abc%, carte inconnue, TCGdex coupé + Réessayer, secours TCGdex en direct, fiche quittée pendant le chargement, mouvement réduit, deux colonnes collantes, 0 erreur) |
| `python -P -X utf8 $SP\work-V-CARD\check.py --widths 390,1280 --themes light,dark` | 13 cartes × 4 passes, 0 problème (débordement, ←, erreurs) |
| `python -P tools/shots.py --port 8803 --only V-CARD --width 320,390,1280 --themes light,dark` | 132 captures, 0 problème |
| `python -P tools/tests/wave1_test.py --port 8803` | RESULTAT OK |
| `router_test.py` (shell + fixes via `$SP\work-V-CARD\rt_part.py`) | 39/40 ; tous ceux de la fiche passent (56–58, 72–73, 81–84) ; seul échec : 91 (vue Scanner, pas la fiche). Le `run()` complet s'arrête avant, sur `main .ptabs a[href="#/collection/pokedex"]` (vue Collection en cours de réécriture par son propriétaire) |

Mesures (Chromium, CPU ×4, collection synthétique de 2 000 cartes, `inp.py`, 3 passes, Event Timing) : ouvrir la
fiche depuis une tuile 40 ms ; « + » 24–32 ms ; « − » 24–32 ms ; Annuler 24 ms ; aperçu d'une finition 24 ms ; cloche
(feuille) 32–48 ms ; ← vers la Collection 96–152 ms (rendu de la Collection). Lien profond froid (`cold.py`) : nom à
236–308 ms, cote 264–335 ms, image basse 370–423 ms, haute 381–437 ms, détails TCGdex 503–582 ms ; une longue tâche
de 71 ms au démarrage sur 3 passes (hors fiche).

## Tests après correction (27/11, port 8823)

| Commande | Résultat |
|---|---|
| `python -P -X utf8 $SP\work-V-CARD\interact.py` | 38/38 |
| `python -P -X utf8 $SP\work-V-CARD\check.py --widths 320,390,1280 --themes light,dark` | 13 cartes × 6 passes, 0 problème |
| `python -P tools/shots.py --port 8823 --only V-CARD --width 320,390,1280 --themes light,dark` | 162 captures (2 étapes ajoutées : feuille d'alerte 1re édition), 0 problème ; seul « permis » : `data/manifest.json` 404 en local |
| `python -P tools/tests/wave1_test.py --port 8823` | RESULTAT OK |
| `rt_part.py` (routeur) | 39/40, même seul échec qu'avant : 91 (vue Scanner) |
| `rv\other.py` (constat 1) | Normale, Reverse, Cosmo : +1 chacune, la fiche reste (d = 2) |
| `rv\cap.py` (constat 2) | lien de 44 px, tous les points touchent le lien, clic au centre → #/carte/bw5-67, à 390 et 1280 |
| `rv\ae2.py` (constats 3, 4, 5) | 14/14 (1re édition : ligne, feuille, max, changement de version, enregistrement sans low, ligne existante ; finition hors catalogue ; Réessayer après une route rejouée) |
| `rv\retry.py` (constat 4) | après Réessayer : barre « Ptéra · Fossile · 1/62 », cloche, titre révélé au défilement |
| `rv\scen.py` (scénarios de la relecture) | 30/31 ; 9a attend « Ajoutée à tes envies » mais l'offre la moins chère (0,04 €) est sous le max proposé (0,53 €) : « Déjà dans ta fourchette : dès 0,04 € » est le bon message |

Mesures (CPU ×4, 2 000 cartes, `inp.py`) inchangées : ouvrir 40 ms, « + » 24–32, « − » 24–32, Annuler 24–32,
aperçu 24–32, cloche 32–40, ← vers la Collection 104–120.
