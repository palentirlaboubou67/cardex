# FX-DATA — correctifs des constructeurs, des données et de la CI (journal de reprise)

Port local : 8913. Scratch : `$SP\FX-DATA\` (sauvegarde des sorties d'avant : `before\`). Fichiers :
`tools/build_catalog.py`, `tools/catalog/*`, `tools/build_market.py`, `tools/market/*`, `tools/build_decks.py`,
`data/*` (sauf `data/scan`), `img/*`, `.github/workflows/*`. Sources Cardmarket : uniquement les copies de
`.cache/mk/cm/` (26/11) ; tous les passages en `--offline`. Réseau : 3 requêtes TCGdex et 6 HEAD sur
assets.tcgdex.net (me05/me06/mee : toujours ni logo ni symbole le 28/11).

## Fait (28/11/2026)

Catalogue (`tools/catalog/*`, `tools/build_catalog.py`) :
- Kits du dresseur : « Kit du dresseur » partout (DP et EX disaient « Kit dresseur »), tk-sm-l « Lougaroc »,
  tk-xy-p « Pikachu Catcheur », tk-ex-p « Posipi » (nom et étiquette) — `tables.NAME_FIX`, `SHARED.tkex.tags`.
- Apostrophe typographique « ’ » dans les noms de séries, de blocs et de cartes (`tables.typo`) ; la recherche
  replie les deux formes (format.norm, dex.words).
- Finitions (`cards.finishes`) :
  - holo dont toutes les impressions holo sont Cosmo -> seulement « Cosmo Holo » (246 cartes : swshp 66, svp 46,
    me01 13, mep 12, sv05 12…) ; reverse dont toutes les reverses sont Poké Ball / Master Ball / Cosmo -> retirée (sve,
    8 cartes) ;
  - API sans aucune variante (que « normale ») : variantes de cards-database (archive déjà téléchargée par MK,
    `.cache/mk/cards-database.zip`) -> bw8, bw9, bw10, me06 (497 cartes : reverses et holos) ;
  - XY et Soleil et Lune (extensions principales, `tables.ERA_RULE`) : ni l'API ni cards-database n'ont de variante,
    tout était « normale » (3 894 cartes) -> règle de l'époque (`cards.era_finishes`) : commune / peu commune / rare =
    normale + reverse ; EX, GX, Méga, Prisme ◇, TURBO, ultra rare, magnifique rare, versions « a » = holo ; énergies de
    base = normale. Pas g1, dc1, det1, xy0, kits, promos (existence des reverses pas sûre) ;
  - normale ou holo qui n'existe que tamponnée à part (decks des Championnats du monde, Gym Challenge, avant-première,
    Player Rewards…) alors que la carte a une impression courante : retirée (112 cartes ; jamais pour les séries
    entièrement tamponnées ni les promos).
  - Sans archive : finitions complétées reprises de la sortie précédente, code de sortie 3.
- Logos et symboles : plus aucune adresse Scrydex (SPEC §6.1) : me06 -> couverture générée (au lieu du logo anglais
  lié), 21 symboles liés retirés (16 kits DP → SM, me05, me06, mee, 2023sv, 2024sv) -> couverture au code seul ; un
  choix précédent lié n'est jamais gardé. TCGdex FR prendra le dessus dès qu'il publie ces images.

Cardmarket (`tools/market/*`, `tools/build_market.py`) :
- Produits jumeaux (`cmap.build` 2 bis) : un produit pris par plusieurs numéros d'une série alors que l'extension a
  des produits libres au nom identique (attaques comprises) -> répartis : numéros ↔ idProduct croissants, ou rareté ↔
  tendance quand les raretés diffèrent (Cardmarket a créé les secrètes de sm12 avant les communes) ; jumeaux de la même
  époque seulement (6 mois, réimpressions de decks exclues ; promos et versions « a/b » : toutes dates). 182 cartes
  (xy2-100 281,61 €, sm10-205 889,87 €, ecard1-40 79,26 €, sm12-237 / sm12-29, g1-RC29 47,78 €…). Reste 2 cas
  (xy8-31/32, xyp-XY111/187 : jumeau d'une autre époque ou attaques différentes).
- `resolve()` : un produit libre avant un produit déjà pris par une carte identique (sm10-198 -> 372480).
- Normale / holo cotées seulement sur une impression sans tampon (sauf tampon commun à toute la série) : sv03-022,
  bw5-60, hgss1-28, hgss3-89/90, ex5-8, me03-028… n'ont plus la cote d'un produit tamponné.
- Reverse : la reverse simple, puis logo de série, puis motif Énergie, puis autre motif sans tampon ; jamais une Ball
  de Héros Transcendants ni le motif Team Rocket (me02.5-153 : 2,35 € au lieu de 0,45 €) ; sinon les annonces
  reverse du produit de la carte (sauf si ses reverses sont Poké Ball / Master Ball / Cosmo).
- 1re édition / tampon : produit à part refusé s'il sert une autre carte de la série (base2 16, base5 17 : prix
  toutes éditions de la carte) ; produit à part qui sert aussi l'impression sans tampon (base1 « Shadowless », 102)
  -> 3e élément 1 dans cm-map, 6e valeur 1 dans prices/<série>.json (« prix toutes éditions », à lire par prices.js).
- Cartes sans lien 26 -> 5 : xya (table `CM_CARD_EXTRA`, produits « A jaune » du 19/05/2017, + xy10-54a), noms
  « Unit Energy [GRW] » / « Fairy Charm [L] », « Nidoran &female; » (entités HTML), « Rainbow Energy Delta ».
  Restent bwp-BW20/22/77/78 (aucun produit Cardmarket) et dpp-DP53 (ambigu) : « — ».
- Garde de la tendance cassée : tendance gardée si la majorité des moyennes 1 / 7 / 30 j la confirme (×5), sinon
  médiane de ces moyennes. Pas la règle proposée (« avg7 et avg30 tous deux contre ») : sur ce guide elle aurait
  remis 34 tendances que seule la moyenne 30 j confirme, dont bw1-63 Sablaireau 4,08 € (7 j 0,17 €, 1 j 0,05 €) ou
  sv08-065 1,70 € (0,15 €) ; ex5-94 reste à 77,32 € (veille 9,99 €, offre dès 12 €).
- Scellé : apostrophes typographiques dans `fr` et `set` (314 noms) ; « Kit du dresseur » (au lieu de « Kit du
  Dresseur »), comme les séries.
- Un fichier Cardmarket n'est lu qu'une fois par passage (`sources.cardmarket` mémorisé) ; l'hebdomadaire lit le
  guide des prix (ordre des jumeaux) et le quotidien le reprend. `sealed-img.json` n'est réécrit que si la table change.

Decks (`tools/build_decks.py`, `data/decks.json`) : `basicEnergy` = les 9 types de base seulement (69 drapeaux
corrigés : Jet, Mist, Capture…) ; sous-séries SV/TG/GG (SHF SV118 -> swsh4.5sv-SV118, HIF SV -> sma, TG, GG) ;
noms avec « ’ » ; `--relink` (sans réseau) réapplique ces règles au fichier existant (Métamorph V du deck 2223-188
relié, cote locale 4,95 €).

CI (`.github/workflows/site.yml`) : plus de passage de 04:15 le lundi (cron `15 4 * * 0,2-6`), le passage
hebdomadaire de 03:45 fait aussi le quotidien -> deux passages Cardmarket par jour au plus ; envoi de code et relance
à la main : cache seulement (`--offline`), sans copie en cache le site n'est pas republié (avertissement, le prochain
passage planifié publie) ; case « download » pour une relance qui télécharge.

Poids : data/sets/*.json 1 790 -> 1 819 Ko (gzip 278 -> 280 Ko), fichiers de cotes gzip 306 -> 337 Ko au total
(≈ 3 900 cotes reverse / holo de plus ; un fichier par série, chargé à la demande), cards-index.json inchangé en
taille (142,7 Ko gzip), sets.json 8,6 Ko gzip. Deux passages de suite : 0 fichier modifié (idempotent).

## Tests
- `tools/market/test_market.py` : 113 contrôles, tous passent (nouveaux : garde majoritaire, 6e valeur, choix de la
  reverse, normale tamponnée, tampon commun, noms Unit Energy / Fairy Charm / Nidoran / δ, aucun produit partagé avec
  un jumeau libre, exemples QA, apostrophes du scellé).
- `tools/tests/data_test.py --port 8913` : 21/21.
- `tools/tests/router_test.py` 98/98, `store_test.py` 16/16, `wave1_test.py` RESULTAT OK, `sw_test.py` 12/12
  (port 8913, arbre de travail avec les modifications en cours des deux autres correcteurs).
- Captures ciblées (scratch `look.py`, 390 × 844 et 1280 × 800, clair et sombre, 18 écrans : Séries kits et me06, pages
  me06 / tk-xy-p / xy2 master / bw9 liste, fiches xy2-100, sv03.5-004, bw9-1, sm12-237, me02.5-153, base1-4 1re éd.,
  base2-17, sv03-022, xya-24a, catalogue ETB, deck 2223-188, recherche « appel des legendes ») : 0 erreur console,
  0 fichier local absent, 0 débordement ; textes attendus présents (« Règne Delta » est dans la barre, pas dans la vue).

- `tools/shots.py --only V-SER,V-CARD,V-MKT,V-DECK,V-COL --width 390,1280 --themes light,dark --port 8913` :
  572 captures, 0 problème (seul 404 : data/manifest.json, permis). Planches regardées (Séries, kits, me06, fiches,
  catalogue ETB, decks).
- Contrôles de format de CA (`work-CAfix/contract_test.py`) : tous passent sauf « chaque série : logo, sinon symbole »
  (voulu : 16 kits et me06 ont une couverture au code seul, SPEC §6.1 / constat QA-DATA) ; sa partie navigateur
  attend une page d'essai qui n'existe plus (`__ca_mod.html`), sans rapport avec ces correctifs.
- Idempotence : `build_catalog.py --offline` puis `build_market.py --weekly --offline` relancés : 0 fichier modifié.

## Demandes aux autres propriétaires
- `js/data/sealed.js` KIND / CHIP : « Kit du dresseur » (QA-VIS : séries et noms de produits l'écrivent ainsi).
- `js/data/prices.js` `get()` : `allEditions = true` aussi quand `a[5] === 1` (6e valeur : base1, 102 cartes, et un
  tampon) ; `js/state/wishes.js` `priceFor()` : même règle (point F2 de WAVE2 §7). `shape()` : la règle de MK
  (`tools/market/prices.py` `sane_trend`) : tendance gardée si la majorité des moyennes 1 / 7 / 30 j présentes la
  confirme (×5), sinon leur médiane — ou ne pas regarder la tendance des fichiers de cotes (déjà gardée par MK) et
  garder la règle pour la cote TCGdex en direct. Aujourd'hui `shape()` remplace par la moyenne 30 j une tendance
  que la moyenne 7 j ne confirme pas (smp-SM163 : 233 € gardés par MK -> 116 € affichés).
- `js/state/collection.js` `repairFinishes()` : « normale » de la v1 -> « cosmos » quand la carte n'a ni normale ni
  holo mais une Cosmo (123 promos SWSH / SV / ME n'ont plus que « cosmos »).
- `tools/shotsteps/V-DECK.json` « dk-deck-non-relie » (deck 2223-188) : sa carte non reliée (Métamorph V) l'est
  maintenant ; il ne reste que des énergies de base sans fiche dans decks.json.
- Série (V-SER, `js/views/serie.js`) : une couverture générée sans symbole (16 kits, me06) répète le code juste à
  côté (« TK9P » dans la couverture et « TK9P · 30 cartes ») ; la ligne pourrait taire le code quand la couverture
  est le code seul (suggestion, rien de cassé).
- SPEC (orchestrateur) : §6.1 plus aucun logo ni symbole Scrydex (me06 et 16 kits : couverture générée, 21 séries
  sans symbole) ; §6.2 finitions = API + cards-database + règle XY / Soleil et Lune ; §6.5 garde de la tendance
  (majorité, médiane), 6e valeur 1 = prix toutes éditions, 3e élément 1 dans cm-map.
