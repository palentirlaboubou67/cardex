# B. Legitimate price and stock sources for Cardex (28/11/2026)

**Method.** One robots.txt per shop, one product-page check (Play-in), official API docs and terms. No protection bypassed. Cardmarket product pages and the robots.txt of Fnac, Cultura, King Jouet, Maxi Toys and Coursesu returned HTTP 403. **Gap:** the shared web-search budget ran out partway through, so these are unverified: affiliate programmes of Leclerc, Auchan, Carrefour, Micromania, Philibert, Maxi Toys and Smyths FR; Kwanko and CJ; eBay Partner Network rates in France.

## 1. Matrix: sealed products at French shops

"robots" is what `User-agent: *` says about product pages. "PS" is the Poké Stock test of 21/11/2026 (✅ read, ❌ blocked).

| Shop | robots | Anti-bot | Machine-readable data, price + stock | Legit route | Effort |
|---|---|---|---|---|---|
| Pokémon Center | pages allowed; API paths `/availabilities`, `/prices`, `/items`, `/offers` disallowed | PS ❌ | sitemap only | link + official alerts | – |
| Amazon.fr | `/dp/` allowed; `/gp/offer-listing` and availability disallowed; Claude-User/ChatGPT-User fully disallowed | blocks | Creators API only (licence excludes "robots… data gathering") | affiliate link, API later | High |
| Fnac | robots.txt 403 | PS ❌ | JSON-LD (per Poké Stock notes); **Awin feed XML/CSV** | Awin | Med |
| Cdiscount | `/f-…html` allowed; no sitemap | PS ❌ | Awin programme (feed unverified) | Awin | Med |
| Cultura | robots.txt 403 | PS ⚠️ DataDome after 1st page | JSON-LD; Awin (feed not stated) | Awin | Med |
| E.Leclerc | `/fp/` allowed; sitemap index | PS ✅ | JSON-LD/meta: price + stock | polite read | Low |
| Auchan | `/pr-` allowed; sitemap | PS ✅ | JSON-LD/meta: price + stock | polite read | Low |
| Carrefour | `/p/` allowed | PS ❌ | – | link only | – |
| Intermarché | `/produit/` allowed, search disallowed | untested | unknown (store-based) | test once | ? |
| Coursesu | robots.txt 403 | protected | – | link only | – |
| JouéClub | allowed; `anthropic-ai` disallowed; sitemap | PS ✅ | JSON-LD/meta; affiliation via Affilae | polite read | Low |
| King Jouet | robots.txt 403 | PS ❌ | Awin programme listed closed | link only | – |
| La Grande Récré | plain URLs allowed (query strings, search disallowed); sitemap | PS ✅ | JSON-LD/meta | polite read | Low |
| Maxi Toys | robots.txt 403 | protected | – | link only | – |
| Smyths | allowed (only cart/account blocked); FR sitemap | PS ❌ | Awin UK programme; FR not found | link only | – |
| Micromania | empty response | PS ❌ | – | link only | – |
| Action | `/fr-fr/p/` allowed except `?page=` | untested | – | link only | – |
| Lidl | `/p/` allowed, `*id=*` disallowed; sitemap | untested | unknown | test once | ? |
| Ludum | PrestaShop; every `?param` URL disallowed except `?aff=` (suggests in-house affiliation) | PS ✅ | JSON-LD/meta | polite read / ask for feed | Low |
| Play-in (Magic Bazar's robots.txt now 301-redirects here) | allowed (only buy-back pages blocked); sitemap_index | Cloudflare script | my fetch got an app shell: title "Playin", only BreadcrumbList JSON-LD, no price | dedicated reader or ask shop | High |
| Philibert | PrestaShop; product URLs explicitly kept crawlable; sitemap | PS: not read yet | unverified | test once | Med |
| UltraJeux | only search/cart/account/checkout blocked | untested | unverified | test once | Med |
| Investcollect | `Allow: /` (cart/user/wishlist blocked); sitemap | PS ✅ | JSON-LD/meta | polite read | Low |
| Shopify shops (LorenZone, Zatu…) | Shopify default allows products; no `.json` rule | PS ✅ (most reliable) | `/products/<handle>.js`, `/products.json` (my one request got 429); **Storefront Catalog** `https://{shop}/api/ucp/mcp` | `.js` for a few items; UCP is the sanctioned route | Low |

## 2. Matrix: feeds, APIs, comparators, marketplaces

| Source | Data | Access | Legitimacy | Effort |
|---|---|---|---|---|
| **Awin** | advertiser product feeds (CSV/XML; JSONL Product API for upgraded advertisers) | free publisher account (small refundable deposit, €1–5 depending on market); apply to each advertiser; Create-a-Feed key; at most 5 concurrent downloads and 5 duplicates per hour; €20 payout threshold | ✅ contractual | Med |
| Fnac FR (Awin 12665) | feed XML/CSV, ~8M items | up to 10%, 10-day cookie; Google Shopping, brand bidding and automated scripts banned | ✅ | Med |
| Cultura FR (Awin 113876) | feed not stated | 1–6%, **price comparators accepted**, 30-day cookie | ✅ | Med |
| Cdiscount FR (Awin 6948) | unverified | up to 8%, marketplace sellers excluded, 7-day cookie | ✅ | Med |
| Effiliation (now Effinity) | product feeds with price and availability (third-party source) | advertiser approval | ✅ | Med |
| Amazon Creators API (replaced PA-API 5, whose calls now return 403) | price, availability | Associates account for amazon.fr + **10 qualifying sales in 30 days**; access lost after 30 days without sales; starts at 1 request/s and 8,640/day; prices only from the API, with a timestamp and disclaimer; non-image cache ≤24 h | ✅ but out of reach at friends scale | High |
| Shopify Global Catalog | search across all Shopify merchants, availability, checkout links | `catalog.shopify.com/api/ucp/mcp`, agent profile, no key; rate-limited; no bulk harvesting or redistribution; price/stock cache ≤10 min | ✅ (FR coverage unverified) | Med |
| idealo | no public data API (merchant-side APIs only; affiliate programme on Awin) | – | ❌ for data | – |
| PriceRunner / leDénicheur (Klarna) | "packaged APIs" | sales contact form | commercial | High/€ |
| Google Shopping | no third-party read API; Content API sunset 18/08/2026; the Merchant API only manages your own products | – | ❌ | – |
| Cardmarket price guide (already in CI) | trend/avg/low per product, daily | public S3 download | ✅ (check reuse terms before going public) | done |
| Cardmarket API | live offers | "Currently, we are not accepting applications" | closed | – |
| eBay Browse API | live listings, EBAY_FR | free developer account; 5,000 calls/day | ✅ with display rules (§3) | Med |
| CardTrader API | listings with language and condition, in EUR | token for account holders (docs returned 403 to me, unverified) | probably ✅ | Med |
| Vinted / Leboncoin | – | no API; scraping forbidden | ❌ exclude | – |

## 3. Singles: details

**Cardmarket deep link.**
`https://www.cardmarket.com/fr/Pokemon/Products/Singles/{Expansion-Slug}/{Card-Slug}?language=2&minCondition=2&sellerType=1,2`, with optional `isReverseHolo=Y` and `isFirstEd=Y`.
- `language=2` is French: in the Cardmarket API docs, idLanguage 1 is English and 2 is French.
- `minCondition` runs from 1 (MT) to 7 (PO); 2 is NM and 3 is EX.
- `sellerType` takes 0 (private), 1 (professional) or 2 (powerseller), comma-separated.
- These values come from community libraries and scraper docs, not from Cardmarket. Cardmarket returned 403 to my fetch, so **check the link once by hand in a browser**.
- Problem: `products_singles_6.json` has idProduct, name, idExpansion and idMetacard but **no slug**. Cardex links to `Products/Search?searchString=…`, and filters do nothing on a results list. Either store slugs, or test whether the parameters survive Cardmarket's redirect when a search has only one match.

**price_guide_6.json.** Fields in the Cardex cache (createdAt 2026-11-26): idProduct, idCategory, avg, low, trend, avg1, avg7, avg30, each with a `-holo` twin (reverse-holo listings in Cardex's cm-map). Cardmarket's API doc defines Low as "the lowest price at the market for non-foils"; its API guide had a separate "Low Price Ex+" that this file lacks, and the file has no language or condition dimension. So **`low` is the cheapest current listing in any language and any condition.** avg1/avg7/avg30 are average sale prices; trend is the site's trend. Cardex already says "toutes langues"; add "tous états" and never present `low` as "dès X € en français". Wish alerts (`wishes.js`) fire on `low`, so a played or foreign copy can trigger them: label them "à vérifier".

**Cardmarket API.** It is closed to new applicants. The old documentation returns 410, and dedicated credentials may not be shared with third-party apps. There is no legitimate way to get live offers filtered by language.

**eBay Browse API.**
- It is free, with a default of 5,000 calls/day for all methods. You can get more after eBay's "Application Growth Check" review.
- The Buy APIs requirements say "production use … is intended for eBay partners only", and you apply through the eBay Partner Network. One developer forum thread says search works with an ordinary production keyset, but nobody from eBay has settled it.
- API licence (footer dated 3 Sept 2025):
  - public display is allowed, but eBay content "may not be co-mingled or combined with non-eBay Content" and must be "visually isolated" (§8.1(b));
  - listing data must be no more than 6 h old (§8.1(c));
  - eBay content may not be used "to suggest or model prices" (§9.5), and average selling prices may not be derived (§8.1(d)).
- Display rules: show the eBay logo, title, price, shipping cost (separately), seller and condition; fixed-price listings only.
- Consequences: a separate "Sur eBay maintenant" block is fine; merging eBay into one best-price ranking with shops, or using eBay prices as a cote, is not. The client secret needs a small server-side proxy (e.g. a Cloudflare Worker), not the static PWA, and a daily CI job breaks the 6-hour rule.

**Vinted and Leboncoin: excluded.**
- Leboncoin's robots.txt says: "It's forbidden to use search robots or other automatic methods to access Leboncoin.fr … only … with special permission".
- Vinted has no public search API. Its robots.txt forbids building datasets and threatens legal action. Its terms page loads in the browser and showed no text to my fetch, so I could not quote the scraping clause.
- A plain search link that the user clicks is fine.

## 4. Recommendation

**Friends scale (now):**
1. **Singles.** Keep the daily price guide. Relabel `low` as "toutes langues, tous états". Add a "Offres FR, NM+, pros" Cardmarket link once the URL has been checked by hand. Optionally add an eBay block, served by a small Worker, kept separate from the rest and cached ≤6 h.
2. **Sealed best price.** Show the Cardmarket sealed trend/low (already there) plus a "Où acheter" list of shop links.
   - Live shop price and stock only for items on the friends' wishlists. Poké Stock reads them from the PC, only on shops that are readable and allowed: Leclerc, Auchan, JouéClub, La Grande Récré, Ludum, Investcollect and Shopify shops.
   - Poké Stock writes a small status JSON (price, in stock, seen at) that Cardex reads; alerts stay on Discord.
   - Never scrape shops from GitHub Actions.
3. **Blocked shops** (Fnac, Cdiscount, Cultura, Carrefour, King Jouet, Micromania, Smyths, Amazon, Pokémon Center): link only, with "vérifier sur le site" and the official alerts.

**Public:**
1. **Open an Awin account and apply to Fnac FR, Cultura FR and Cdiscount FR.** A CI job downloads the feeds daily, keeps the Pokémon TCG items, and matches them to the Cardex sealed catalogue by EAN. That gives a legitimate daily price and availability for the biggest shops that block bots. Restock alerts from feeds can lag by up to a day; say so in the app.
2. **Shopify shops via Storefront/Global Catalog (UCP)** instead of `.js` polling. Ask the independent PrestaShop shops (Ludum with its `?aff=` links, Philibert, UltraJeux, Play-in) for a feed or permission.
3. **Amazon:** affiliate links first; switch to the Creators API only once the site makes 10 sales in 30 days.
4. **eBay:** join the eBay Partner Network and get production approval.
5. **Compliance:**
   - mark affiliate links as such and declare the commissions as income;
   - rank offers by total price including shipping, never by commission;
   - put a timestamp on every price.
6. **Revenue:** about €2–4 per €60 ETB (Fnac up to 10%, Cdiscount up to 8%, Cultura 1–6%). That is nothing at friends scale, and it could cover hosting once public.

## Sources
- Poké Stock: `poke-stock-bot\LISEZMOI.md`, `detection.py`, `bot.py`; Cardex: `tools\market\prices.py`, `sources.py`, `js\state\wishes.js`
- robots.txt (28/11): pokemoncenter.com, amazon.fr, cdiscount.com, e.leclerc, auchan.fr, carrefour.fr, intermarche.com, joueclub.fr, lagranderecre.fr, smythstoys.com, action.com, lidl.fr, ludum.fr, play-in.com, philibertnet.com, ultrajeux.com, investcollect.com, lorenzone.fr, cardmarket.com, leboncoin.fr, vinted.fr (each at `/robots.txt`)
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation · https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/api-rates · https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api · https://affiliate-program.amazon.com/help/operating/policies (updated 14/04/2026)
- https://help.cardmarket.com/en/cardmarket-api · https://news.cardmarket.com/en/FoW/adding-non-singles-and-accessories-to-the-price-guide · https://api.cardmarket.com/ws/documentation/API_2.0:PriceGuide (now 410) · https://api.cardmarket.com/ws/documentation/API_2.0:Entities:Article · https://github.com/batuzyn/cardmarket-api
- https://developer.ebay.com/develop/apis/api-license-agreement · https://developer.ebay.com/develop/api/buy/api_call_limits · https://www.developer.ebay.com/api-docs/buy/buy-requirements.html · https://community.ebay.com/forum/ebay-developers-program-57950/topic/browse-api-production-scope-for-an-existing-production-keyset-and-exemption-semantics-480672/
- https://shopify.dev/docs/agents/catalog · https://shopify.dev/docs/apps/build/storefront-mcp/servers/storefront
- https://ui.awin.com/merchant-profile/12665 · https://ui.awin.com/merchant-profile/113876 · https://ui.awin.com/merchant-profile/6948 · https://success.awin.com/articles/en_US/Knowledge/Why-do-I-have-to-pay-the-sign-up-fee · https://success.awin.com/articles/en_US/Knowledge/What-are-the-payment-thresholds · https://wiki.awin.com/index.php/Product_Feed_List_Download · https://developer.awin.com/docs/product-feed-publisher · https://affi.io/m/king-jouet · https://affilae.com/en/usecases/marketing-strategy-joueclub/ · https://www.leptidigital.fr/logiciels/effiliation/
- https://idealo.github.io/partner-web-service/docs/v2 · https://www.pricerunner.com/register/api · https://developers.google.com/shopping-content/guides/sunset
