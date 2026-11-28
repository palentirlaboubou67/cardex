# C. In-store stock coverage for Cardex (research, 28 Nov 2026)

## Key findings
1. **No retailer can be read automatically, store by store, without breaking a rule.** Every site ties store stock to a chosen store (cookie, account or URL) and loads it client-side, from paths disallowed in robots.txt or behind anti-bot. Leclerc Drive is the only, unverified, exception. So don't scrape store stock: use crowd reports plus a « vérifier sur le site » deep link the user confirms in one tap.
2. **OpenStreetMap is good enough for « mes magasins ».** It has 13,356 stores and 1,134 drives for the 15 brands in France, almost all tagged with `brand:wikidata`. The extract is 1.0 MB, or 273 KB gzipped.
3. **French restock communities are free-text.** They run on Discord and Dealabs, with no expiry, quantity buckets or votes. Cardex can beat them with little effort.

## 1. Retailers
Tested 28/11/2026 with at most three fetches per site. "403" means the site refused a plain fetch, sometimes even for robots.txt.

| Retailer | How store availability is shown | Store choice | Robots / ToS | Anti-bot | Verdict |
|---|---|---|---|---|---|
| **E.Leclerc** | « Vérifier la disponibilité », « Choisir mon magasin » ([cat](https://www.e.leclerc/cat/pokemon-jouets)) | Picker or account's « magasin préféré » | Loaded client-side. [robots](https://www.e.leclerc/robots.txt) disallows `*/offers`, `/*availability_status=` | None seen | Deep link |
| **Leclerc Drive** | Catalogue per drive | Drive first | [robots](https://www.leclercdrive.fr/robots.txt) allows `/` | Not tested | Only candidate. Check by hand |
| **Auchan** | « Retrait 1h en magasin » per product; delivery only until a store is chosen | `storeReference` cookie | [robots](https://www.auchan.fr/robots.txt) disallows `*storeReference=*`, `/journey*`. [CGU](https://www.auchan.fr/cgu/ep-cgu) art. 8 (12/06/2026) bans commercial or AI extraction | None seen | No |
| **Carrefour** | « Retrait 2h » for non-food stocked in store | `/set-store` | [robots](https://www.carrefour.fr/robots.txt) disallows `/set-store`, `/get-store` | 403 | No |
| **Intermarché** | « Indisponible » or drive status per store | `pdvref` | [robots](https://www.intermarche.com/robots.txt) disallows `/api/*`, `/?pdvref*` | 403 | No |
| **Super U** | Drive per store (coursesu.com) | Required | robots.txt 403 | 403 | No |
| **Fnac** | C&C 1h, subject to store stock. Paused for the Pokémon 30th-anniversary launch to favour in-store buyers ([JDG](https://www.journaldugeek.com/2026/09/17/cartes-pokemon-30-ans-la-fnac-a-reserve-la-vente-en-ligne-a-ses-adherents-comment-obtenir-vos-boosters/)) | Picker | robots.txt 403 | 403 | No |
| **Cultura** | « Retrait 2h … Gratuit »; can say « INDISPONIBLE EN LIGNE » yet show store stock | Picker | robots.txt 403 | DataDome (Poké Stock) | No |
| **JouéClub** | « Retrait gratuit en magasin en 1h », 300+ stores | Picker | [robots](https://www.joueclub.fr/robots.txt) disallows `ajax.php`, `rest.php`; **`anthropic-ai` Disallow: /** (I stopped) | n/a | No |
| **La Grande Récré** | Same platform as JouéClub | Picker | [robots](https://www.lagranderecre.fr/robots.txt): same ajax/rest bans | Browser check | No |
| **King Jouet** | « Vérifier le stock … dans votre magasin préféré »; 2h reservation, pay in store ([FAQ](https://www.king-jouet.com/foire-aux-questions.htm)) | Preferred store | robots.txt 403 | 403 | No |
| **Maxi Toys** | « Disponible en magasin », « Retrait magasin en 2h » | Store search | robots.txt 403 | 403 | No |
| **Micromania** | « Retrait 1h en magasin » filter with counts per store | Store filter | robots.txt empty | Challenge | No |
| **Smyths** (ex-PicWicToys) | Per-store stock; 1h C&C, held 2 days; warns stock can be wrong ([aide](https://www.smythstoys.com/fr/fr-fr/aide-disponibilite-des-stocks)) | Picker | [robots](https://www.smythstoys.com/robots.txt) permissive | « Pardon Our Interruption » | No |
| **Action** | No online sales in France, no per-store stock ([FAQ](https://www.action.com/fr-fr/service-clients/faq/gamme-stock-et-prix/)) | — | — | 403 | Crowd only |
| **Lidl** | In-store promos dated by the flyer. LiA chat gives per-store vert/jaune/rouge ([help](https://service-client.lidl.fr/SelfServiceFR/s/article/Vous-souhaitez-conna%C3%AEtre-la-disponibilit%C3%A9-d-un-article-non-alimentaire-en-promotion-dans-l-un-de-nos-supermarch%C3%A9s)) | In chat | No API | JS only | Crowd + flyer |
| **Toys"R"Us FR** | [toysrus.fr](https://www.toysrus.fr/) shows « site en construction ». 0 stores in OSM; stores became [Smyths](https://www.smythstoys.com/fr/fr-fr/picwictoys-devient-smyths-toys) | — | — | — | Drop |

What this means:
- The Poké Stock bot keeps reading online stock (Leclerc, Auchan, JouéClub, La Grande Récré).
- In-store coverage is crowd-first.
- Each (product, retailer) gets a product URL. « Vérifier en magasin » opens it in the user's own browser, with their own store cookie. If stock shows, one tap files a report with `source=site_vérifié`.

## 2. Store directory

**OSM via Overpass:** one query on 28/11/2026, data as of 11:55Z. Counted on the `shop` tag, which drops fuel and gas-bottle points.

| Brand family (brand:wikidata) | Stores | Drives |
|---|---|---|
| Carrefour (Q217599, Market Q2689639, City Q2940187, Express Q2940190, Contact Q2940188) | 4,250 | 39 |
| Intermarché (Q3153200, Super Q98278038, Contact Q98278049, Express Q98278043, Hyper Q98278022) | 2,176 | 102 |
| Système U Q2529029 (Super, Hyper, Express, Utile) | 1,892 | 22 |
| Lidl Q151954 | 1,696 | – |
| E.Leclerc Q1273376 | 886 | 831 |
| Action Q2634111 | 816 | – |
| Auchan (Q758603, Q105857776, Q115800307, Drive Q2870659) | 463 | 139 |
| King Jouet Q3197009 · Micromania Q3312221 · JouéClub Q3187152 | 274 · 227 · 215 | – |
| Fnac Q676585 · Cultura Q3007154 · La Grande Récré Q3209556 | 163 · 112 · 111 | – |
| Smyths Q7546779 · Maxi Toys Q16663879 | 39 · 36 | – |

- **Coverage.** 91–100% of shops carry `brand:wikidata`. Postcodes are sparse (20–35%), so derive the commune and département from coordinates once.
- **Size.** The raw answer was 12.8 MB, 21,520 elements, 123 s of server time. Trimmed to id, lat, lon, wikidata, name, postcode and city, it is 1.03 MB of JSON (273 KB gzipped), about 3–15 KB per département. The alternative is the 4.8 GB Geofabrik PBF filtered with osmium.
- **Overpass [policy](https://wiki.openstreetmap.org/wiki/Overpass_API).** ≤10,000 queries and ≤1 GB per day, divided by 100 for regular use, with an identifying User-Agent. Refresh monthly from the PC or a GitHub Action and serve a static `stores.json`. Never query from clients.
- **ODbL duties ([copyright](https://www.openstreetmap.org/copyright)).**
  - Show « © les contributeurs d'OpenStreetMap » with a link, on the store picker and the About page.
  - Publish the store table under ODbL.
  - Under the [Collective Database guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline), reports that only reference a store and contain no OSM data can stay private.
- **Stable IDs.** OSM IDs change when a node becomes a way. Keep Cardex's own `store_id` with an `osm_ref`, and re-match on brand plus distance under 150 m.
- **Official locators.** Not open data; Auchan, Intermarché and Carrefour disallow their store paths. Outbound links only.
- **[All The Places](https://www.alltheplaces.xyz/).** Weekly CC-0 scraper dumps; quality checks only.

## 3. Crowdsourcing
- **[Poképing](https://discord.com/servers/pokeping-alertes-restock-fr-en-1347874448577134632).** 8,669 members, free, pings by region; mostly online drops.
- **[Geekify FR](https://discord.com/servers/geekify-1319232070232440873).** 3,621 members. Bot alerts for online stock (Fnac, JouéClub, La Grande Récré and others); store stock « grâce aux partages de la communauté ».
- **[Dealabs « réassorts »](https://www.dealabs.com/discussions/pokemon-tcg-disponibilites-et-reassorts-des-cartes-pokemon-boosters-etb-coffrets-3337943).** Free-text posts such as « Confirmation auprès de plusieurs Cultura en Île de France », with purchase limits.
- **Apps, all US-centred.** [TCG Restock](https://apps.apple.com/us/app/-/id6754227978) has photo proof, « confirm or deny » votes and alerts by ZIP code and radius. [HiddenHolo](https://apps.apple.com/us/app/id6761502436) has local groups, check-ins (in stock, sold out, being restocked) and push for followed stores.
- **Expiry precedent.** In [Waze](https://support.google.com/waze/answer/13739290), a report lasts longer the more people react to it.
- **Facebook groups.** None found.

**Signals they use:** free text, store and town, photo, purchase limit, post time, and informal reputation. Staleness is handled at best by a 24 h feed; spam by moderators.

**Legal points:**
- **RGPD.** Pseudonymous user + store + time is location data. The [CNIL (07/07/2026)](https://cnil.fr/fr/geolocalisation-applications-mobiles-quelles-regles) says no consent is needed if location is strictly necessary, but no more precision than needed and no longer retention than needed. So:
  - use the store the user picks, not GPS;
  - store area follows as a postcode or département;
  - strip EXIF from photos;
  - drop `user_id` after 30 days and keep aggregates only.
- **Household exemption.** It may cover the friends phase, but not a public launch.
- **DSA.** A hosting service owes notice-and-action (art. 16), statements of reasons (art. 17), points of contact (arts 11–12) and T&Cs (art. 14). Micro and small platforms are exempt from arts 19–28 except 24(3) ([art. 19](https://www.springlex.eu/fr/packages/dsa/dsa-regulation/article-19/)).
- **Content rules.** Stock facts only. No faces, badges, staff names, schedules or accusations (« X cache le stock »). Reject photos that show people.

## 4. Recommended MVP

**Backend.** GitHub Pages cannot store reports or send push. Add a small EU serverless backend (Cloudflare Workers + D1 + R2, or Supabase EU) for reports, VAPID web push and expiry. iOS push needs the PWA installed on the home screen. Poké Stock can post its online alerts to the same endpoint.

**Report flow (3 taps):**
1. **Product.** Scan the EAN with Cardex's camera, or pick from the wishlist.
2. **Store.** « mes magasins » first, sorted by the user's postcode; otherwise search by brand and town.
3. **What.**
   - Type: « en rayon », « mise en rayon », or « rayon vide » (negative).
   - Quantity: 1–2, 3–10, or 10+.
   - Optional price and « limite par client ».
4. **Photo, optional.** Compressed on the device, EXIF stripped.
5. **Expiry, automatic.**
   - TTL is 3 h for hot items (released under 14 days ago) and 24 h otherwise.
   - Each « toujours là » adds 2 h, up to 48 h.
   - Two « plus rien » votes, or one « rayon vide » report, close it.
   - The UI shows « il y a 40 min » and fades with age.

**Who is notified:**
- **Product followers**, by wishlist × followed area.
- **Store followers**, for any Pokémon product there.
- **Area followers**, by département or postcode + radius, computed from store coordinates. The user's own location is never stored.
- **Throttling.** One push per (product, store) per TTL; a 15-minute digest when one product appears in several stores; quiet hours.

**Data model:**
- `stores(id, osm_ref, brand_wikidata, name, lat, lon, insee, dept, active)`, ODbL
- `products(id, ean[], name, set, kind, release_date, hot)`
- `users(id, pseudo, trust, invited_by, banned)`
- `reports(id, user_id, product_id, store_id, kind, qty_bucket, price, limit, photo_key, source[crowd|site_vérifié|bot], created_at, expires_at, status)`
- `votes(report_id, user_id, value[still|gone|fake])`, unique per user
- `follows(user_id, type[product|store|area], target, radius_km)`
- `push_subs(user_id, endpoint, p256dh, auth)`
- `flags(target, reporter_id, reason, decision_reason)`, which covers DSA arts 16–17
- `daily_agg(store_id, product_id, date, n)`: anonymous, kept for « arrivages habituels »

**Anti-abuse:**
- **Friends phase.** Invite codes, each new user linked to an inviter, and one tap revokes an inviter's whole branch.
- **Public phase.**
  - Sign in by magic link or passkey.
  - New accounts' reports show « non confirmé » and push nothing until confirmed by someone at trust 1 or above, or until they have a photo.
  - Trust rises with confirmed reports and falls with « fake » votes.
  - ≤10 reports per day.
  - Reject impossible travel: two stores more than 50 km apart within 30 min, checked from store coordinates.
  - Strangers see only time buckets.
  - Report button and appeals.
- **Scalpers.** Optionally delay public pushes on hot items by 10–15 min.

**Gaps** (search budget ran out): Leclerc Drive's Pokémon range and ToS, Fnac and Cultura ToS, Facebook groups.
