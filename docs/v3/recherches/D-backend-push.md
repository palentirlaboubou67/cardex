# D. Minimal backend for Cardex Web Push (28 Nov 2026)

**Recommendation: one Cloudflare Worker + D1 (EU jurisdiction) + a Queue + one cron.** It costs nothing at 20 users and about $5/month at 5,000. It deploys with curl only. One new account: Cloudflare.

The `periodicSync` check in `wishes.js` only runs in Chrome on Android for installed apps, never on iOS.

## 1. Options

| Option | Free tier (official, Nov 2026) | 20 / 5,000 users | Deploy without Node | EU data | Lock-in |
|---|---|---|---|---|---|
| **Cloudflare Workers + D1/Queues** | 100k requests/day, **10 ms CPU and 50 subrequests per invocation**, 5 crons ([limits](https://developers.cloudflare.com/workers/platform/limits/)). D1: 5M rows read and 100k rows written per day, 5 GB. Queues: 10k operations/day. DO (SQLite): 100k requests/day ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | $0 / $5 (Paid: 10M requests, 30M CPU-ms/month) | REST `PUT …/workers/scripts/{name}` multipart ([IaC](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/)). Secrets, crons and D1 SQL also via REST. Dashboard editor | D1 `jurisdiction: "eu"` set at creation ([data location](https://developers.cloudflare.com/d1/configuration/data-location/)). DO too ([DO](https://developers.cloudflare.com/durable-objects/reference/data-location/)). Code runs at the nearest edge | Low–medium (SQLite, standard fetch/WebCrypto) |
| Supabase | 500 MB DB, 500k Edge Function calls, 2 projects. **Paused after 1 week of low activity** ([pricing](https://supabase.com/pricing)). Restorable for 1 year ([pausing](https://supabase.com/docs/guides/platform/project-pausing)) | $0 / likely $25 Pro | Dashboard editor, no versioning ([doc](https://supabase.com/docs/guides/functions/quickstart-dashboard)), or Management API deploy | Paris eu-west-3, Frankfurt ([regions](https://supabase.com/docs/guides/platform/regions)) | Low (Postgres) |
| Firebase | FCM free. Firestore: 50k reads and 20k writes per day, 1 GiB. **Cloud Functions not available on Spark** ([pricing](https://firebase.google.com/pricing)) | Blaze (card) ~$0 / a few $ | Functions need firebase-tools (Node). gcloud is Python-based | Firestore europe-west9 (Paris), fixed at creation ([locations](https://firebase.google.com/docs/firestore/locations)). FCM is global | **High** (FCM SDK and its own service worker ([FCM web](https://firebase.google.com/docs/cloud-messaging/js/client))) |
| Deno Deploy | 1M requests and 10 h CPU per month, KV 1 GiB ([pricing](https://deno.com/deploy/pricing)) | — | Dashboard, GitHub | — | **Shutting down**: "will continue operating for six months" from 9 Oct 2026 ([blog](https://deno.com/blog/cloudflare)). Excluded |
| Vercel | Hobby: 1M invocations, 4 h active CPU ([pricing](https://vercel.com/pricing)). **Crons once/day, ±59 min** ([cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)). No database (Marketplace) | $0 / $20 Pro | GitHub import (builds on Vercel) | Function region selectable | Medium (extra DB vendor) |
| Netlify | 300 credits/month hard cap. Deploy = 15 credits, 10k requests = 2. **Projects paused until the next cycle** ([credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [paused](https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/)) | $0 / $9+ | GitHub | Not verified | Medium |
| PythonAnywhere | 1 web app, **1-month expiry**, 100 CPU-s/day. No scheduled tasks for accounts created after 15 Jan 2026 ([free features](https://help.pythonanywhere.com/pages/FreeAccountsFeatures/), [pricing](https://www.pythonanywhere.com/pricing/)). Outbound allowlist includes `.googleapis.com` and `.apple.com` but **not Mozilla autopush** ([allowlist](https://www.pythonanywhere.com/whitelist/)) | $0 (fragile) / $10 | Web editor or console, `pywebpush` | EU system | Low |
| Fly.io | $1 credit without a card. $5/month usage with a card. Up to 3 machines. shared-cpu-1x 256 MB costs $2.19/month ([pricing](https://docs.fly.io/about/pricing)) | ~$0 (card) / ~$3–5 | `flyctl` is a Go binary. Docker with Python | `cdg` Paris | Low |
| PC + Cloudflare Tunnel | Free, but **a domain on Cloudflare is required** ([get started](https://developers.cloudflare.com/tunnel/get-started/)). Quick tunnels: random URL, no SLA, 200 in-flight requests ([quick tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)) | ~€10/yr domain | `cloudflared.exe` | At home | None, but **PC off = no subscriptions, no reports, Actions alerts lost** |

Cloudflare wins: free, no pausing, EU storage, cron and queue included, deploys by curl. The catch is 10 ms CPU per invocation, so pushes go out from a Queue consumer, 5 per message.

## 2. Web Push without npm

- **VAPID ([RFC 8292](https://www.rfc-editor.org/rfc/rfc8292)).** Sign a JWT `{aud: push-service origin, exp ≤ 24 h, sub: "mailto:…" or https URL}` with `crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"})`. WebCrypto returns raw r‖s, already JOSE format. Send it as `Authorization: vapid t=<jwt>, k=<public key>`. Apple rejects other `sub` values (`BadJwtToken`) and asks you not to refresh the JWT more than hourly, so cache it ~12 h per audience ([Apple](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)). Generate the P-256 keys with Python `cryptography`: private JWK in a Worker secret, public key as `applicationServerKey`.
- **aes128gcm ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html)).** Per message: ephemeral ECDH key, 16-byte salt, HKDF with the auth secret and `"WebPush: info"\0‖ua_pub‖as_pub`, then CEK and nonce, delimiter 0x02, AES-GCM. 86-byte header; plaintext ≤ **3,993 bytes**. Test against Appendix A.
- **Payload versus payload-less.** Prefer **encrypted payloads**. Safari "doesn't support invisible push notifications… Safari revokes the push notification permission" (Apple). Fetch-then-show can fail on a flaky network, and Declarative Web Push (iOS 18.4+) needs a JSON payload with `"web_push": 8030` ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)). Keep `GET /v1/inbox` only as a fallback.
- **iOS 16.4+.** Only for apps added to the Home Screen (manifest already `standalone`), permission asked "in response to direct user interaction" ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). Endpoints are on `*.push.apple.com`.
- **Android Chrome.** `userVisibleOnly: true` is mandatory ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)). The endpoint is FCM, no SDK needed. Chrome auto-revokes notifications for low-engagement, high-volume sites, but **installed apps are exempt** ([Google](https://blog.google/chromium/automatic-notification-permission/)).
- **Headers ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html)).** `TTL` is required. Stock: TTL 3600, `Urgency: high`; prices: 43200, `normal`; releases: 86400, `low`. `Topic` (≤32 base64url characters) replaces a pending message with the same topic: use the hashed card or product key.
- **Responses.** 201 is OK. **404 or 410: delete the subscription.** 413: payload too large. 429: honour `Retry-After` ([web.dev](https://web.dev/articles/push-notifications-web-push-protocol)). Browsers rarely fire `pushsubscriptionchange`, so re-send the subscription on every launch.
- **Libraries with no dependencies.** [PushForge `@pushforge/builder`](https://github.com/draphy/pushforge) is MIT, uses WebCrypto and has an example for Workers. curl its pinned ESM file from jsDelivr, read it, upload it as a second module. Alternatives: [@negrel/webpush](https://jsr.io/@negrel/webpush) (MIT, unaudited) or ~150 lines of your own.

## 3. Identity

- **Friends phase.** Revocable invite codes, one per friend. `POST /v1/devices {invite}` returns a random `device_id` and a 256-bit `token`. The server stores only SHA-256(token). The client keeps both in a **separate IndexedDB** (`cardex-push`), readable by the service worker, so the `cardex` database version stays untouched.
- **Going public.** Add an `accounts` table and link devices to it (`devices.account_id`). Pushes still target devices, so the push code doesn't change. Then add email magic links (needs an email provider) or passkeys (WebAuthn checked in the Worker).
- **Abuse.** Reports need a Turnstile token checked server-side (free, up to 20 widgets ([plans](https://developers.cloudflare.com/turnstile/plans/))). Limits per device in D1: 5 reports per hour and 20 per day. In public mode, relay a report once two devices confirm it, or straight away from a trusted invitee. Add a per-device kill switch.
- **Bot and Actions.** HMAC-SHA256 over `timestamp + "\n" + method + "\n" + path + "\n" + body`, sent as `X-Cardex-Sig: t=…,v1=…`. Reject requests more than 300 s off. One secret per caller (Worker secret, GitHub secret, the bot's git-ignored `config.yaml`); Python needs only `hmac`. Later, Actions can switch to GitHub OIDC (`id-token: write` is already set) and drop its secret.

## 4. RGPD

- **Personal data:** the push endpoint (an online identifier), device_id, invite attribution, follows (followed stores hint at home area), and reports (store + time + device = a person's location). Cloudflare also sees IPs.
- **Legal bases:** alerts the user asked for (art. 6(1)(b)), the browser permission prompt, and legitimate interest for anti-abuse. Storing the token is "strictement nécessaire" to the service the user requested, so no consent banner is needed ([CNIL](https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/que-dit-la-loi)).
- **Retention, proportionate to purpose** ([CNIL](https://www.cnil.fr/fr/les-durees-de-conservation-des-donnees)): delete a device immediately on 404/410, or when it hasn't been seen for 120 days. Follows go with their device. Unlink a report from its device after 48 h, then delete it after 30 days. Rate counters last 24 h. Never log payloads. Offer "Supprimer mes données".
- **Privacy notice (in the app, in French):** who is responsible and how to contact them, purposes, legal bases, recipients (Cloudflare as processor; Google, Apple and Mozilla push services, which only see ciphertext), transfers (D1 in the EU, Cloudflare DPA with SCCs and the Data Privacy Framework ([DPA](https://www.cloudflare.com/cloudflare-customer-dpa/))), retention, rights and complaint to the CNIL.
- **Friends-only versus public.** The household exemption (art. 2(2)(c)) is narrow, so even for friends publish a short notice and keep the retention rules. Going public adds: a full politique de confidentialité, mentions légales (since the SREN law, LCEN art. 1-1: a non-professional may stay anonymous if they give their identity to the host), an art. 30 register (the CNIL provides a template), accepting the Cloudflare DPA, Turnstile in the notice, and a way to flag false reports. Check DSA duties for user reports.

## 5. Proposal

**D1 (EU):**
`devices(id PK, token_hash, invite, endpoint UNIQUE, p256dh, auth, created, last_seen)`
`follows(device_id, kind ['card','product','set','store','releases'], ref, min_c, max_c, in_range, PK(device_id,kind,ref))`; card `ref` = `WishDB.keyOf`
`invites(code PK, label, uses_left, revoked)`
`reports(id, device_id NULL-able, store_id, product_id, status, created)`
`rate(device_id, bucket, n)`
`events(id, kind, ref, title, body, url, created)`

**Endpoints**
- Device-authenticated: `GET /v1/config` (VAPID public key, Turnstile site key) · `POST /v1/devices` · `PUT /v1/devices/me/subscription` · `PUT /v1/devices/me/follows` (full replace) · `DELETE /v1/devices/me` · `POST /v1/reports` · `GET /v1/inbox`.
- HMAC: `POST /v1/internal/stock` (bot) · `GET /v1/internal/watched` (Actions: distinct card refs, no device ids) · `POST /v1/internal/prices {date, lows:{ref:cents}}` · `POST /v1/internal/release`.
- Cron (daily): purges.
- CORS: Pages origin only (shared by all the account's Pages projects).

**Flow:** bot, Actions or report → Worker SQL picks devices (prices: low in [min, max] and `in_range=0`, then `in_range=1`, like `WishDB.update`) → batches of 5 into the Queue → consumer encrypts, POSTs, deletes on 404/410 → service worker shows it.

**sw.js:** add `push`. Parse `e.data.json()`, accept the declarative shape (`m.notification.title`), and **always** call `showNotification(title, {body, icon:'icon-512.png', tag: m.tag, data:{url}})`. For a price alert, also `WishDB.put` the new `low` and `inRange`. With `tag` = `w.key`, local and server alerts for one card replace each other. `pushsubscriptionchange` re-subscribes and PUTs. `notificationclick`/`openApp` stay.

**wishes.js:** keep `check` and `registerPeriodic` as the Android offline fallback. `enableAlerts()`, once granted: `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` and then `POST /v1/devices`. `alertStatus()` adds `push`. New `js/state/push.js`: `WishDB.on()` triggers a debounced follow sync (euros to cents).

**Deployment by hand (accounts: Cloudflare only; GitHub already exists):**
1. Free Cloudflare account; note the account ID; API token with Workers Scripts, D1 and Queues: Edit.
2. Dashboard → D1 → Create → *Specify jurisdiction: EU*. Run `schema.sql` with curl `POST …/d1/database/{id}/query` ([API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)).
3. Create the queue `cardex-push` in the dashboard. Later, set the Worker as its consumer.
4. Run `python tools/vapid.py` (uses `cryptography`) to get the public key and the private JWK.
5. curl multipart `PUT …/workers/scripts/cardex-push` with `worker.mjs` and `webpush.mjs`, plus bindings for D1 and the queue. Free `*.workers.dev` URL, no domain.
6. curl `PUT …/secrets` for `VAPID_JWK`, `HMAC_BOT`, `HMAC_CI` and `TURNSTILE_SECRET` ([API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/update/)). curl `PUT …/schedules` `[{"cron":"30 3 * * *"}]` ([API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/update/)).
7. Dashboard → Turnstile → add a widget for the github.io hostname.
8. GitHub secrets `CARDEX_PUSH_URL` and `CARDEX_HMAC_CI`; in `site.yml`, after "Cotes Cardmarket", run `python tools/push_alerts.py` (stdlib only). It must read prices the way `priceFor` does: no alert for `firstEdition`/`stamp` when the price covers all editions.
9. Bot: in `config.yaml`, add `cardex_push_url` and `cardex_hmac`. Write a signed `requests.post` next to `alertes_discord.py`.
10. Test on Android Chrome and an iPhone with the app installed; check that an invalidated subscription gets deleted.
