# Cardex: data pipeline for the "Calendrier des sorties" (checked 28 Nov 2026)

## Summary

- The only official machine feed for French announcements is the TPCi French press RSS (`https://pokemon.gamespress.com/fr/News/RSS`).
- The Cardmarket catalogue that Cardex already downloads every day lists products about 11 weeks before release.
- Every other good French source blocks bots or reserves text and data mining (TDM).
- **Recommendation:** a curated `data/calendar.json`, with machine detectors that propose entries and fill in links and status.
- Only one French release in the window is officially dated: **Méga-Évolution – Poings Fluides (ME07), Saturday 6 Feb 2027**.

## 1. Sources

| Source | Lead time and reliability | Format | robots / ToS | Role |
|---|---|---|---|---|
| **TPCi French press** (pokemon.gamespress.com/fr) | Primary. ME07 was announced 19 Nov, 11 weeks ahead. Covers sets, not every coffret (the Méga-Rayquaza collection is missing). No prices. | RSS 2.0 at `/fr/News/RSS`. pubDates end in "Z", so parse leniently. | `*` allowed, Crawl-Delay 5 s | **Automated "annonce" trigger** |
| **pokemon.com/fr** | Primary, same day as the press release | HTML | Imperva bot wall ("Pardon Our Interruption") on the news list and `/fr/jcc-pokemon/galerie-produits` | Manual citation only |
| **Pokécardex** calendar topic | Best list per product, with prix publics. Updated about weekly ("Dernière mise à jour : 19 novembre"). Stops at November 2026. | Forum HTML, plus Google/Apple calendar subscription | Blocks AI crawlers; TDM "expressly reserved and prohibited" | Manual reference, cited |
| **Pokébip**, Pokékalos | Relay the press release the same day, with French product names | HTML, no feed | Pokébip: ClaudeBot `Disallow: /` | Manual |
| **PokeBeach** | Earliest signal (trademarks, leaks, US product shots), weeks to months ahead. English only. | HTML | Blocks ClaudeBot and GPTBot; TDM reserved under EU 2019/790 art. 4 | Manual reading |
| **Bulbapedia** | After the fact | MediaWiki | Returned 403 to my fetcher; CC BY-NC-SA | Not needed |
| **TCGdex** | **No unreleased sets.** On 28 Nov `/v2/fr/sets/me07` returns 404 and series `me` ends at `me06`. Sets are committed on or just after release: `Delta Reign.ts` on 7 Nov 2026 (release 6 Nov), Pitch Black on 17 Jul (release day). `data-asia` has Japanese dates, which Cardex already reads (`cmap.asia`). | Git zip, REST | Open source | "sorti" confirmation, `tcgdexSet` link |
| **Cardmarket `products_nonsingles_6.json`** | **Lists products before release.** Delta Reign: 18 products added 2026-08-20, 11 weeks ahead. Pitch Black: 2026-04-30, also 11 weeks. Flowing Fists (`idExpansion` 6974): 19 products added 2026-11-19, the day of the announcement. Names are English; product ids are shared across languages. | Fields: `idProduct, name, idCategory, categoryName, idExpansion, idMetacard, dateAdded`, plus file-level `createdAt`. **No release-date field.** | Free catalogue, already fetched daily with ETag (`tools/market/sources.py`) | **New-product detection, Cardmarket id links** |
| **Cardmarket `price_guide_6.json`** | Seller pre-sale offers appear within days. 26 Nov copy: ME07 ETB 924662 `low` 89.99, display 924659 `low` 219.99. Not France-specific. | JSON, already fetched daily | Same | "précommande (Cardmarket)" signal |
| **Retailers**: Play-in, Fnac, Cultura, Philibert, Chocobonplan | French names and preorders. Dates can be wrong: Chocobonplan gives 5 Feb for ME07. The Play-in calendar (updated 12 Nov) has nothing after ME06. | Heavy HTML/JS | ToS usually forbid scraping | Manual |
| **Limitless** | English sets appear once released (newest: DLR, 06 Nov 26). The Japanese section already lists M7. | HTML | Allows all crawlers | Legality reference |
| **Japan** (pokemon-card.com) | Official. A Japanese main set precedes the French one by 10–14 weeks: M6 Storm Emeralda 31 Jul → Règne Delta 6 Nov; M7 Hadou Seeker 27 Nov → Poings Fluides 6 Feb. | Dynamic JS, no RSS | robots.txt returns 404 | "prévision" only, read through TCGdex `data-asia` |

**Cardmarket noise to filter out:**
- Asian lines such as "Aura Storm" (6978) and the CSV*C products. Classify them with `sealed.languages()` and keep `int`.
- US-only products such as the Valentine's Box (6968) and Costco packs.

I fetched no new Cardmarket file; the figures above come from the cached copy in `.cache/mk/cm`, dated 26 Nov.

## 2. Announced French releases, Nov 2026 → 2027

| Date (precision) | Product (FR) | Type | Prix public | Status | Source |
|---|---|---|---|---|---|
| 4 Dec 2026 → 21 Jan 2027 (day) | Happy Meal McDonald's 30 ans (15 cards) | promo | free with the menu | **UNCONFIRMED.** Leak relayed by Pokékalos. | journaldugeek.com/2026/10/06/pokemon-mcdonalds-confirme-enfin-larrivee-des-cartes-30-ans-dans-ses-happy-meal-en-france/ |
| 4 Dec 2026 (day) | "Dernière vague 30ᵉ Anniversaire" (English wave: Tin and Binder Collection) | coffret / tin | – | **UNCONFIRMED** for France | lorenzone.fr/blogs/calendrier/pokemon-tcg (updated 27 Nov) |
| 9 Dec 2026, 10:00 (day) | fnac.com exclusive, Fnac+ members drawn by lot: Coffret Collection avec figurine Mewtwo 30ᵉ and Coffret Collection Ultra-Premium 30ᵉ Journée (Mentali). Both moved from 27 Nov. | sale event | 37,99 € and 229,99 € (Pokécardex) | Confirmed by Fnac on 19 Nov | leclaireur.fnac.com/article/cp73072-pokemon-fete-ses-30-ans-un-rendez-vous-exclusif-sur-fnac-com-pour-les-coffrets-collector/ |
| from 23 Jan 2027 (day) | Avant-premières Poings Fluides, Boîtier Stratégies et Combats kit | prerelease | not announced (ME06 kit: 30 €) | Official | pokemon.gamespress.com/fr/AVIS-MEDIA-les-Pokemon-Mega-Evolution-Z-font-leurs-debuts-dans-la-nouv |
| 29 Jan 2027 (day, **US**) | Coffret Journée Pokémon 2027 (stamped Pikachu promo, 3 boosters) | coffret | – | **France not announced.** A French 2026 edition existed. | gamewave.fr/pokemon-tcg/pokemon-tcg-le-premier-coffret-de-2027-se-devoile/ |
| 4 Feb 2027 (day) | Poings Fluides on JCC Pokémon Live | digital | – | Official | TPCi press, above |
| **6 Feb 2027 (day, Saturday)** | **Méga-Évolution – Poings Fluides (ME07)**, "plus de 110 cartes": boosters, display of 36 and of 18, tripack, bundle of 6, Coffret Dresseur d'élite, 1- and 3-booster blisters, "diverses collections" | set + booster / box / halfbox / blister / bundle / etb | **Not announced.** ME06 for reference: booster 5,99 €, display 215,64 €, half display 107,82 €, ETB 55,99 €, tripack 17,99 €, bundle 35,99 € | **Official.** Sets now release on Saturdays. | TPCi press; pokemon.com/fr/actualites/lextension-mega-evolution-poings-fluides-du-jcc-pokemon-arrive-le-6-fevrier-2027; ME06 prices from Pokécardex |
| — | *ME07 Cardmarket ids (reference row)* | — | — | — | ETB 924662, Pokémon Center ETB 924661, display 924659, display of 18 924660, bundle 924646, booster 924658, sleeved booster 924657, Build & Battle 924644, 3-pack 924650, 1-pack 924649, checklane blisters 924647/48/51/52 |
| Printemps 2027 (season; US 12 Feb 2027) | Collection Tournoi Premium Méga-Rayquaza-ex (promos, 8 boosters, Dragon Shield) | premium coffret | not announced (US $49.99 reported) | Announced 29 Oct; **no French date** | gamewave.fr/pokemon-tcg/pokemon-tcg-presente-un-coffret-aux-couleurs-de-mega-rayquaza-ex/; icv2.com/articles/news/view/63760/; Cardmarket 920176 |
| 27 Jan 2027 (US) | Valentine's Box | coffret | – | **Not planned for France** | purebreak.com/news/dans-3-mois-une-box-historique-du-tcg-pokemon-sera-mise-en-vente-mais-elle-sera-dabord-pour-les-enfants/266321 |
| 19 Feb 2027 (**Japan**) | MEGA×MEGA Parade high-class pack (Méga-Raichu X/Y); an international version is predicted | early signal | – | **RUMOUR** (PokeBeach via Wargamer) | wargamer.com/pokemon-trading-card-game/mega-x-mega-parade-raichu |
| 2027 | Standard rotation. In 2026 it was announced 9 Jan and took effect 10 Apr (26 Mar on Live). The H mark is expected to leave, by inference. | event | – | Not announced | bulbapedia.bulbagarden.net/wiki/2026-27_Standard_format_(TCG) (search result only) |
| 2027 | Sets after ME07. The 2026 cadence was about one every 8 weeks. | set | – | Nothing official | — |

**Background:** Hadou Seeker (JP M7) came out 27 Nov 2026 at 200 yen per pack (pokemon-card.com/ex/m7/).

**Not checked:** my web-search budget ran out before I could look for a Japanese January 2027 set or a French ME07 prix public. Check both at the first weekly review.

## 3. Recommendation: curated file plus machine detectors

Full automation is not possible here. The product-level French sources are bot-walled or forbid TDM, and no machine-readable source gives a French release date.

**`data/calendar.json` is the source of truth.** It is edited by hand, with at least one source per entry. A push to `main` triggers the existing offline rebuild.

**Detectors run in the existing daily pass of `site.yml` (04:15 UTC).** The only new request is the RSS feed. They write `data/calendar-candidates.json` and the job summary, and never edit curated fields.
1. **RSS:** one GET with ETag. A new item matching `JCC|extension|coffret|collection` becomes an "annonce" candidate.
2. **Nonsingles diff:** a new `int` expansion with an ETB or display, or a new product in a known expansion, becomes a candidate. Cardmarket ids are linked automatically through `sealed.kind()` and the expansion.
3. **Price guide:** when a linked product still in `annonce` gets a non-null `low`, the detector sets `precommandeCardmarket` and emits a "précommande ouverte (vendeurs Cardmarket)" event.
4. **TCGdex:** the Monday zip, plus a daily check of `/v2/fr/sets/<id>` within 7 days of the date, sets `tcgdexSet`. Status becomes `sorti` on release day.

**Weekly by hand (Monday, about 10 minutes):** check Pokécardex, Pokébip, PokeBeach and retailer preorder pages for prices, French names, retailer preorders and date changes.

**Alerts:**
- The build appends to an **event log**: `{seq, at, id, kind: annonce|precommande|date|sortie}`.
- The PWA's existing `periodicsync` job (`cardex-prices`) also fetches calendar.json, through the `manifest.json` hash.
- It compares `seq` with the last value seen, stored in IndexedDB, and shows a local notification for each new event. An optional reminder fires the day before release.
- Periodic sync only runs in an installed Chromium PWA. Other browsers get a badge when the app opens.
- Optionally, the workflow can also post new events to a webhook kept in a secret.

## 4. Proposed schema (`data/calendar.json`)

```json
{
  "v": 1,
  "built": "2026-11-28T04:15:00Z",
  "entries": [{
    "id": "me07-etb",
    "parent": "me07",
    "name": { "fr": "Coffret Dresseur d'élite Méga-Évolution – Poings Fluides",
              "en": "Mega Evolution—Flowing Fists Elite Trainer Box" },
    "type": "etb",
    "region": "fr",
    "date": { "value": "2027-02-06", "precision": "day", "label": null },
    "extraDates": { "prerelease": "2027-01-23", "live": "2027-02-04" },
    "status": "annonce",
    "confidence": "officiel",
    "msrp": { "eur": null, "estimate": 55.99, "basis": "ME06" },
    "image": null,
    "sources": [{ "url": "https://pokemon.gamespress.com/fr/AVIS-MEDIA-les-Pokemon-Mega-Evolution-Z-font-leurs-debuts-dans-la-nouv",
                  "kind": "officiel", "seen": "2026-11-19" }],
    "links": { "tcgdexSet": null, "cardmarketExpansion": 6974, "cardmarket": [924662], "jp": "M7" },
    "precommandeCardmarket": "2026-11-26",
    "updated": "2026-11-28"
  }],
  "events": [{ "seq": 1, "at": "2026-11-19", "id": "me07", "kind": "annonce" }]
}
```

**Field rules:**
- **`id`:** a stable slug, `<set>-<kind>[-<variant>]`. `parent` points to the set entry, whose own `type` is `set`.
- **`type`:** reuses the kinds from `sealed.py`, so Cardmarket linking works as is: `set|booster|box|halfbox|etb|bundle|prerelease|tin|blister|deck|coffret|case`. Three are added: `event|promo|digital`.
- **`date.value`:** `YYYY-MM-DD` (day), `YYYY-MM` (month), `YYYY-Qn` (quarter) or `YYYY` (year). `label` holds wording like "printemps 2027". Sort on the earliest possible day.
- **`status`:** `annonce|precommande|sorti`.
- **`confidence`:** `officiel|revendeur|rumeur`. This marks unconfirmed items without adding statuses.
- **`msrp.eur`:** only when a source states it. An `estimate` must name its `basis`.
- **`image`:** self-hosted under `img/calendar/`; never hotlinked.
- **`sources[].kind`:** `officiel|presse|communaute|revendeur|marketplace`.
- **`links`:** stay `null` until a detector or the owner confirms them.

**Files:**
- This report: `A-calendar.md`
- Cardmarket dump of recent expansions: `cm_recent.txt`
