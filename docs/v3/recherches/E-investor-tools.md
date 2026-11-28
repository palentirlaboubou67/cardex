# E — Tools for an « Investir » area (checked 28/11/2026)

**Limits.** The web-search budget ran out. Reddit, PriceCharting, Card Ladder, Alt, PSA, cardmarket.com and pcagrade.com blocked fetches. Community sources (r/PokeInvesting, French YouTube and Discord) were not read, so what users value is inferred from paywalls. **(UNV)** = secondary source only.

## 1. Existing tools
- **Collectr** ([site](https://getcollectr.com/)): cards and sealed priced daily, cost basis, gain/loss, graded sales and pop, scanner. Pro ($4.99/month) adds 5+ years of history and export.
- **Pokedata.io** ([pro](https://www.pokedata.io/pro)): free plan has 6 months of history, 1 portfolio and the current PSA pop. Gold ($8) adds unlimited history, 4 portfolios, 20 alerts and pop history. Platinum ($20) adds **sales volume**, custom charts and an API.
- **PokeInvest** ([site](https://www.pokeinvest.io/)): grading-ROI calculator, gem-rate rankings, grader comparison, pack simulator, alerts, deals.
- **TCGplayer:** market price, plus pull-rate articles that are the best public source.
- **PriceCharting, Card Ladder, Alt** (background knowledge, not re-verified): graded prices from eBay sales, PSA-owned indexes, and a graded marketplace with vault.
- **PSA pop report:** counts per grade. The public API only verifies certificates ([doc](https://www.psacard.com/publicapi/documentation)).
- **French resources** are calendars and news, not investment tools: [LorenZone](https://lorenzone.fr/blogs/calendrier/pokemon-tcg), [Play-in](https://www.play-in.com/fr/articles/3-pokemon/calendrier-des-prochaines-sorties-pokemon), Pokébip, Pokécardex.

**Valued, by paywalls:** long history, cost-basis portfolio, alerts, graded prices with pop, sales volume, EV and simulators. None of these tools covers France.

## 2. What Cardex's data supports
- **Price guide.** It has only `avg, low, trend, avg1, avg7, avg30` (+`-holo`).
  - **No offer counts, sales counts or graded prices.**
  - Trends mix **all languages**: FR and EN product prices are not separated.
  - The old API documentation returns HTTP 410.
- **Sealed history is sparse:** `hist/` holds 30/12/2024, 17/06/2026, then daily points since 09/09/2026 (64 dates).
- **Cards have no price history.** **Mon scellé** stores one lot per product, `{qty, cost, at}`, with no sales.
- **Set files** carry a FR rarity per card. `sets.json` carries `legal.standard`.

**What Cardex's own data shows** (read-only analysis):
- International box/ETB/bundle/half box released before December 2024, median change 30/12/2024 → 27/11/2026:
  - Épée et Bouclier: ×2.5 (63 products)
  - Écarlate et Violet: ×2.1 (58)
  - Soleil et Lune: ×2.95 (41)
  - XY: ×2.7 (32)
  - Older eras: ×1.00, frozen trends to exclude.
- Since 09/09/2026 (313 products): median annualised volatility 20 %, drawdown median −3 %, 10th percentile −19 %.

## 3. Candidate tools: formula, data, supported today?
- **Portfolio performance.** Supported if `at` is filled in.
  - Return = gain ÷ invested.
  - Annualised return = (V/C)^(365/days) − 1, shown only when days ≥ 365.
  - XIRR: solve Σ CFᵢ(1+r)^−(tᵢ−t₀)/365 = 0, with purchases on `at` and today's value as the final flow.
  - Livret A comparison: compound the same flows at a hand-kept rate table. The rate is **1.7 % from 01/08/2026 to 31/01/2027** ([service-public](https://www.service-public.gouv.fr/particuliers/vosdroits/F2365)).
  - Real return = (1+r)/(1+π) − 1, using INSEE's base-2025 CPI. Inflation is **+2.9 % year on year in November 2026, provisional** ([INSEE](https://www.insee.fr/fr/statistiques/9161375)).
  - Net resale = V × (1 − fees) − postage. Realised gains need a "vendu" record.
- **Sealed index by era.** Supported, but sparse before September.
  - I_t = I_{t−1} × geometric mean(p_i,t / p_i,t−1).
  - Same era and type, `l=int`. Exclude cases, single boosters, Japanese products and frozen trends (`chg` over 30 days).
  - Base 100 on 30/12/2024, written to `data/market/index.json`.
- **Multiple of prix public.** Supported with a hand-kept table.
  - Multiple = eur ÷ reference price.
  - There is no official FR MSRP, so use 2026 mass-retail prices: booster 6.99 €, tripack 17.99 €, bundle about 36 €, ETB 55.99 € ([Fnac/Cultura](https://www.chocobonplan.com/bons-plans/cartes-a-jouer/cartes-pokemon/etb-pokemon-me06-regne-delta)).
  - Displays: specialist shops only, 239.90 € ([Play-in](https://www.play-in.com/fr/produit/674993/display-de-36-boosters-pokemon-mega-evolution-regne-delta-me06-fr)).
  - Today: ETBs since 2025 median 2.04×, displays 0.78×. Label it « prix constaté ».
- **Price per booster.** Needs a booster-count field (display 36, half 18, ETB 9, bundle 6, tripack 3, mini tin 2), set by type plus a name regex.
- **Reprint and out-of-print signals.** Partly supported.
  - No free reprint database. TPCi says it prints "at maximum capacity" ([pokemon.com](https://www.pokemon.com/uk/pokemon-news/update-on-pokemon-trading-card-game-product-availability)).
  - Factual badges, never a score: months since release, « encore légale en Standard », price ≤ 1.2× prix public, hand-kept « réimpression annoncée » with source.
- **Expected value (EV).** Prices and rarity tiers are available; pull rates are not.
  - EV per pack = Σ over tiers of rate × mean tier price + bulk value.
  - Display = 36 × pack EV. ETB = 9 × pack EV + promo.
  - Also show P(≥1 hit) = 1 − (1 − rate)^n and a Monte-Carlo median.
  - Source: TCGplayer counts of 2,000 to 8,500 packs per set, e.g. [Mega Evolution](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Mega-Evolution-Pull-Rates/40cbeedc-21ce-473b-aef1-74e3969d9f91/).
  - Example, Pitch Black: SIR 1/80 per pack, so 36 % per display and 11 % per ETB (UNV).
  - FR shares the card list and tiers, but **FR rates were never measured**: label EN rates as estimates.
- **Liquidity.** No free counts exist. Proxies: days with non-null avg1 out of 30, spread (eur − low) ÷ eur, frozen trends. Start storing sealed avg1 now.
- **Volatility and drawdown.**
  - σ = std(ln returns) × √(365/Δdays).
  - Maximum drawdown = min(p_t ÷ running max − 1).
  - Meaningful after 6 to 12 months of daily data.
- **Seasonality.** Not supported: it needs 2 years of data. Option: research-only percentages from the [TCGCSV archive](https://tcgcsv.com/faq) (TCGplayer USD, daily since 08/02/2024). The spec forbids USD, so the owner decides.
- **Sell-fee calculator.** Net = price × (1 − commission) + shipping paid by the buyer − postage − packaging.
- **Grading calculator.**
  - Profit = Σ_g P(g) × price_g × (1 − fees) − raw value − grading fee − postage − import VAT (US only).
  - Break-even is the raw value where profit = 0.
  - Gem rate and graded prices are entered by the user.
- **Alerts.** Supported: eur or « dès » crosses a threshold; ±X % over 7 or 30 days; « plus bas depuis le … ».
- **Watchlist.** Exists (`watch`); add a target price and a note.
- **Calendar.** Link plus a short hand-kept JSON. There is no official FR page. Next release: **ME07 Poings Fluides, 06/02/2027** ([Pokébip](https://www.pokebip.com/news/7645/jcc-pokemon-nouvelle-extension-mega-evolution-poings-fluides)).

## 4. Reference figures
- **Cardmarket, private seller:**
  - **5 % of the item value, not of shipping** (UNV).
  - Tracked shipping is mandatory above 25 €. The packaging fee (0.30/0.50/1 €) goes to the seller; the buyer pays the trustee fee.
  - No international tracked letters for goods since 01/01/2026 ([help](https://help.cardmarket.com/en/ShippingCosts)).
- **Other platforms:** eBay.fr private sellers pay no commission ([help](https://www.ebay.fr/help/selling/fees-credits-invoices/frais-pour-les-vendeurs-particuliers?id=4822)). Vinted charges the buyer, not the seller ([pricelist](https://www.vinted.fr/pricelist)).
- **La Poste, 2026 → from 01/01/2027** ([courrier](https://www.laposte.fr/tarifs-postaux-courrier-lettres-timbres), [colis](https://www.laposte.fr/tarifs-postaux-colis)). The calculator should ship with the 2027 table.
  - Lettre verte: 20 g 1.52 → 1.67 €, 100 g 3.10 → 3.34 €.
  - Lettre verte suivie: 20 g 2.02 → 2.17 €, 100 g 3.60 → 3.84 €, 250 g 5.74 → 6.26 €.
  - R1: 20 g 6.11 → 6.47 €, with 16 € compensation.
  - Colissimo: 250 g 5.49 → 5.79 €, 500 g 7.59 → 7.99 €, 1 kg 9.59 → 10.09 €; EU 500 g 14.99 → 15.79 €.
- **Grading:**
  - **PSA Europe (Frankfurt)**, open to EU collectors since 15/09/2026 ([SI](https://www.si.com/collectibles/psa-reorganizes-services-levels-opens-new-tier-european-facility)), with no customs. Standard 49.99 € introductory, 59.99 € list, up to 900 € declared value (UNV).
  - PSA US Value: $39.99, plus 20 % import VAT on return (UNV).
  - CGC EU ([cgccards.de](https://www.cgccards.de/submit/services-fees/cgc-grading/)): Bulk 20.23 € (minimum 25 cards), Economy 22.61 €, Standard 61.88 €.
  - PCA (Paris): 12.90 € plus 19.90 € return (UNV).
  - Beckett EU: online submissions suspended (UNV).
- **Graded premiums:** modern PSA 10 median 4.3× raw ([Bill's Archive](https://billsarchive.com/articles/vintage-vs-modern-pokemon-cards-psa-10.html)); PSA 10 ÷ PSA 9 median 3.0× ([PokeInvest](https://www.pokeinvest.io/blog/psa-10-vs-psa-9-price-difference)).

## 5. French tax and regulation
- **Objets de collection:** taxe forfaitaire of **6 % of the sale price + 0.5 % CRDS = 6.5 %** ([CGI 150 VK](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036428328)). The LFSS 2026 CSG increase does not apply.
  - Exempt up to 5 000 € per object. A set sold together counts as one sale ([BOFiP](https://bofip.impots.gouv.fr/bofip/4151-PGP.html)).
  - The seller may opt for the plus-values regime by proving the purchase price ([BOFiP](https://bofip.impots.gouv.fr/bofip/4161-PGP.html)).
- **Ordinary biens meubles:** 19 % + prélèvements sociaux, charged on the gain.
  - Allowance of 5 % per year of holding beyond the 2nd year, so fully exempt after 22 years.
  - Exempt when the sale price is ≤ 5 000 €. Losses are not deductible. Declared on form 2048-M ([BOFiP](https://bofip.impots.gouv.fr/bofip/3788-PGP.html)).
  - **Prélèvements sociaux: 17.2 % on my reading of CSS [L136-8](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054336623); some advisers say 18.6 % since the LFSS 2026. Confirm before shipping.**
- **Classification of Pokémon cards** is a question of fact: age, rarity, end of production, price. [Bercy, 26/04/2026](https://www.economie.gouv.fr/bercy-decode/les-cartes-pokemon-sont-elles-desormais-dans-le-viseur-du-fisc):
  - a card with collection characteristics pays the taxe forfaitaire above 5 000 €;
  - no tax below 5 000 €;
  - the viral "new 36.2 % tax" is false.
  - Likely: rare, old or graded cards are collection objects; in-print sealed is an ordinary bien meuble. No rescrit found.
  - Calculator above 5 000 €: 6.5 % × price versus 36.2 % × gain × (1 − allowance).
- **DAC7:** platforms report sellers with **30 or more sales or over 2 000 € a year** ([BOFiP](https://bofip.impots.gouv.fr/bofip/13729-PGP.html)). Being reported does not mean being taxed. Cardmarket collects sellers' tax numbers ([news](https://news.cardmarket.com/en/Magic/DAC7-information)). Cardex only lists and links, so it is not a DAC7 platform ([§20](https://bofip.impots.gouv.fr/bofip/13742-PGP.html)).
- **Becoming a business:** buying in order to resell is BIC income ([impots.gouv](https://www.impots.gouv.fr/sites/default/files/media/1_metier/1_particulier/EV/1_declarer/141_autres_revenus/eco-collabo-fiscal-vente-biens.pdf)).
  - Micro-entreprise limit for 2026: 203 100 € ([F23267](https://entreprendre.service-public.gouv.fr/vosdroits/F23267)).
  - VAT exemption threshold: 85 000 €; the 25 000 € reform was abandoned ([F21746](https://entreprendre.service-public.gouv.fr/vosdroits/F21746)).
  - Social contributions: 12.3 % ([F36232](https://entreprendre.service-public.gouv.fr/vosdroits/F36232)).
- **AMF:** collectibles are high-risk « placements atypiques » ([AMF](https://www.amf-france.org/fr/espace-epargnants/proteger-son-epargne/placements-atypiques/placements-atypiques-des-investissements-considerer-avec-prudence)). Offering goods with a promised return falls under the « biens divers » rules. Price data alone carries low risk. Avoid « placement », « rendement garanti », buy/sell signals and personalised advice.

**Disclaimer:**
> « Les cotes et évolutions affichées sont indicatives : elles viennent de ventes passées sur Cardmarket et ne préjugent pas des prix futurs. Les cartes et produits scellés ne sont pas des produits financiers : leur valeur peut baisser fortement et leur revente n'est jamais garantie. Cardex ne donne aucun conseil en investissement ni recommandation d'achat ou de vente ; les règles fiscales présentées sont générales, vérifie sur impots.gouv.fr ou auprès d'un professionnel. »

## 6. Priorities
Effort: S ≤ 1 day, M = 2–4 days, L = 1–2 weeks.

**MVP**
1. Disclaimer; rename « Rendement » to « Évolution » (S).
2. Portfolio: annualised return, XIRR, Livret A, real return, net resale. Data: `sealed{cost, at}`, rate and CPI tables (M).
3. Sell-fee calculator: fee table, La Poste 2027 (S).
4. Price per booster and prix-public multiple: hand-kept tables (S–M).
5. Alerts on % change and new lows: `hist` (S).
6. Watchlist target and note (S).
7. Sealed index by era: `hist`, no frozen trends (M).
8. Calendar link and upcoming FR releases (S).
9. Tax sheet and calculator (5 000 € test, 6.5 % vs plus-values, DAC7 counter); needs a sales log (M).
10. Builder stores sealed avg1 and low daily (S).

**Later**
- Volatility and drawdown, after 6+ months of daily data (S).
- EV and pack simulator: hand-kept pull rates, EN as proxy (L).
- Grading calculator: user-entered gem rate and graded prices (M).
- Reprint badges (M).
- Seasonality (M).
- Liquidity score (S).
- Graded portfolio: no free source of graded prices (L).
