# MK — cotes Cardmarket (journal de reprise)

## Fait (terminé)
- tools/build_market.py (quotidien, --weekly, --backfill, --offline, --report) + tools/market/ :
  sources (ETag, garde la copie la plus récente), cmap (table TCGdex -> Cardmarket, finitions de l'appli),
  prices, sealed (types, langues, catalogue), names (noms FR), images (photos TCGplayer), hist, wayback, report,
  test_market (tests unitaires + bout en bout hors ligne).
- data/market/ construit : cm-map.json, sealed-img.json, meta.json, hist/ (328 fichiers, 62 jours depuis le
  30/12/2024 grâce à l'Internet Archive), prices/ (185 séries) et sealed.json (3 061 produits) — ces deux derniers ignorés par git.
- data/sealed.json et data/sealed/ (ancienne source TCGplayer) supprimés.
- Contrôles : exemples FINAL-cardmarket justes, 99,69 % des cartes de l'appli cotées (98,89 % des finitions),
  liens relinkés/récupérés relus (50/50, 45/45, 19/19), top 300 du scellé relu (.cache/mk/report/sealed-top300.md).
- Lecture réelle par js/data/prices.js vérifiée dans Chromium (port 8774).

## Pour reprendre
- Relancer : python -P tools/build_market.py [--weekly] [--report] ; tests : python -P tools/market/test_market.py
- Rien en cours.
