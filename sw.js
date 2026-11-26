// Service worker v2 : l'appli marche hors ligne, les données statiques versionnées et les images déjà vues sont gardées.
// VERSION, SHELL et VENDOR sont écrits par tools/release.py (ne pas les modifier à la main).
importScripts('js/state/wishes.js');

const VERSION = 'dev';
const SHELL = [];
const VENDOR = 'dev';

const APP = `cardex-app-${VERSION}`;
const DATA = 'cardex-data';          // data/** versionnés (?h=), manifest, logos et symboles (img/**)
const API = 'cardex-api';            // api.tcgdex.net (GET)
const VEND = `cardex-vendor-${VENDOR}`;
const DEV = VERSION === 'dev';       // sans tools/release.py : réseau d'abord pour les fichiers de l'appli

// hôtes d'images : CORS uniquement, réponses « ok » seulement, file d'attente bornée (les plus anciennes partent)
const IMG = {
  'assets.tcgdex.net': ['cardex-img-cards', 3000],
  'images.scrydex.com': ['cardex-img-cards', 3000],
  'tcgplayer-cdn.tcgplayer.com': ['cardex-img-sealed', 800],
  'raw.githubusercontent.com': ['cardex-img-dex', 1100],
};
const imgCache = url => {
  if (url.hostname === 'cdn.jsdelivr.net') return url.pathname.startsWith('/gh/PokeAPI/sprites') ? ['cardex-img-dex', 1100] : null;
  return IMG[url.hostname] || null;
};

const SCOPE = new URL(self.registration.scope);
const rel = url => (url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname) ? url.pathname.slice(SCOPE.pathname.length) : null);

// ---------- installation / activation ----------
// caches de la v1 : réponses opaques (images) et fichiers de l'ancienne appli
const isV1 = k => k.startsWith('cardex-shell-') || k === 'cardex-images-v1';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    // cache: 'reload' : jamais la copie HTTP d'un déploiement précédent
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    // Données du démarrage (manifest, séries, images, Pokédex) : la page qui a enregistré le service worker les a
    // chargées sans lui ; sans cette copie, un rechargement hors ligne juste après la première visite serait vide.
    await precacheData().catch(() => {});
    // Venant de la v1 : on prend la main tout de suite. L'ancien service worker servirait sinon ses copies opaques
    // aux <img crossorigin> de la nouvelle appli, et ces images seraient cassées jusqu'au prochain démarrage.
    if ((await caches.keys()).some(isV1)) await self.skipWaiting();
  })());
});

self.addEventListener('message', e => {
  const m = e.data;
  if (m === 'activate-now' || m?.type === 'activate-now' || m?.type === 'SKIP_WAITING') self.skipWaiting();
  else if (m?.type === 'version') e.source?.postMessage({ type: 'version', version: VERSION });
  else if (m?.type === 'offline-status') e.waitUntil(offlineStatus().then(s => e.source?.postMessage({ type: 'offline-status', ...s })));
  else if (m?.type === 'warm') e.waitUntil(warm(0));
  // seulement d'une page de Cardex (les autres applis du domaine github.io peuvent écrire à ce service worker)
  else if (m?.type === 'seen' && Array.isArray(m.urls) && String(e.source?.url || '').startsWith(SCOPE.href)) {
    e.waitUntil(keepSeen(m.urls).catch(() => {}));
  }
});

// Première visite : la page a tout chargé avant que le service worker prenne la main (js/core/net.js envoie alors
// la liste de ce qu'elle a chargé). On en garde une copie : le rechargement hors ligne qui suit fonctionne, même sans
// tools/release.py (développement, où SHELL est vide) et pour les données et images déjà vues.
async function keepSeen(urls) {
  const jobs = [];
  for (const u of new Set(urls.slice(0, 600))) {
    let url;
    try { url = new URL(u); } catch { continue; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const path = rel(url);
    if (path !== null) {
      url.hash = '';
      if (path === '' || path === 'index.html') { if (DEV) jobs.push(['app', new URL('index.html', SCOPE).href]); continue; }
      if (path === 'sw.js' || path === 'data/manifest.json') continue;
      if (path.startsWith('data/') || path.startsWith('img/')) jobs.push(['data', url.href]);
      else if (path.startsWith('vendor/')) jobs.push(['vendor', url.href]);
      else if (DEV && !url.search) jobs.push(['app', url.href]);
      continue;
    }
    if (url.origin === SCOPE.origin) continue;                 // autre appli du domaine
    const ic = imgCache(url);
    if (ic) jobs.push(['img', url.href, ic]);
  }
  const names = { app: APP, data: DATA, vendor: VEND };
  let i = 0;
  await Promise.all([0, 1, 2, 3].map(async () => {
    while (i < jobs.length) {
      const [kind, href, ic] = jobs[i++];
      try {
        const c = await caches.open(kind === 'img' ? ic[0] : names[kind]);
        if (await c.match(href)) continue;
        // copie HTTP déjà là le plus souvent : rien ne repart sur le réseau
        const res = kind === 'img' ? await fetch(href, { mode: 'cors', credentials: 'omit' }) : await fetch(href);
        if (res.ok && (res.type === 'basic' || res.type === 'cors') && !res.redirected) await c.put(href, res);
        if (kind === 'img') await trimSoon(ic[0], ic[1]);
      } catch { /* hors ligne ou hôte sans CORS : rien */ }
    }
  }));
}

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (!k.startsWith('cardex-')) continue;                       // jamais les caches des autres applis du domaine
      const oldApp = k.startsWith('cardex-app-') && k !== APP;
      const oldVendor = k.startsWith('cardex-vendor-') && k !== VEND;
      if (oldApp || oldVendor || isV1(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

// ---------- requêtes ----------
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const path = rel(url);
  if (path !== null) {
    if (req.mode === 'navigate') return e.respondWith(shell(e, path === '' ? 'index.html' : path));
    if (path === 'data/manifest.json') return e.respondWith(manifest(e));
    if (path.startsWith('data/')) {
      if (url.searchParams.has('h')) return e.respondWith(cacheFirst(e, DATA));      // versionné : immuable
      return e.respondWith(networkFirst(e, DATA, 3000, 0, true));                     // sans manifest : réseau d'abord
    }
    if (path.startsWith('img/')) return e.respondWith(cacheFirst(e, DATA));         // nom de fichier avec hash
    if (path.startsWith('vendor/')) return e.respondWith(cacheFirst(e, VEND));
    if (path === 'sw.js') return;
    return e.respondWith(shell(e, path));
  }
  if (url.origin === SCOPE.origin) return;                                           // autre appli du domaine
  if (url.hostname === 'api.tcgdex.net') return e.respondWith(networkFirst(e, API, 4000, 400));
  const ic = imgCache(url);
  if (ic) return e.respondWith(imageFirst(e, ic[0], ic[1]));
});

// fichiers de l'appli : précachés (cache d'abord) ; en développement, réseau d'abord
async function shell(e, path) {
  const c = await caches.open(APP);
  const key = new URL(path, SCOPE).href;
  const nav = e.request.mode === 'navigate';
  if (DEV) {
    try {
      const res = await fetch(nav ? e.request : new Request(e.request, { cache: 'no-cache' }));
      if (res.ok && res.type === 'basic' && !res.redirected) e.waitUntil(c.put(key, res.clone()).catch(() => {}));
      return res;
    } catch (err) {
      const hit = await c.match(key, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  }
  const hit = await c.match(key, { ignoreSearch: true }) || (nav && path === 'index.html' ? await c.match(new URL('./', SCOPE).href) : null);
  if (hit) return hit;
  return fetch(e.request);    // fichier ajouté depuis la version précachée : réseau, sans le mélanger au cache
}

async function cacheFirst(e, name) {
  const c = await caches.open(name);
  const hit = await c.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.ok && res.type === 'basic') e.waitUntil(c.put(e.request, res.clone()).catch(() => {}));
  return res;
}

// Réseau d'abord ; après `ms`, la copie en cache s'il y en a une (sinon on attend le réseau : la page a son délai).
// Une réponse en erreur ne remplace jamais une bonne copie. loose : un fichier de données demandé sans ?h= (manifest
// injoignable) peut être servi par sa copie versionnée.
async function networkFirst(e, name, ms, max = 0, loose = false) {
  const c = await caches.open(name);
  const net = fetch(e.request).then(res => {
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
      const copy = res.clone();
      e.waitUntil(c.put(e.request, copy).then(() => max && trimSoon(name, max)).catch(() => {}));
    }
    return res;
  });
  e.waitUntil(net.then(() => {}, () => {}));
  const hit = await c.match(e.request) || (loose ? await c.match(e.request, { ignoreSearch: true }) : undefined);
  if (!hit) return net;
  return Promise.race([
    net.then(r => (r.ok ? r : hit), () => hit),
    new Promise(r => setTimeout(() => r(hit), ms)),
  ]);
}

// Images : requête CORS (même si la balise l'a oubliée), seules les réponses « ok » non opaques sont gardées.
async function imageFirst(e, name, max) {
  const c = await caches.open(name);
  const key = e.request.url;
  const hit = await c.match(key);
  if (hit) return hit;
  const cors = cache => fetch(new Request(key, { mode: 'cors', credentials: 'omit', ...(cache ? { cache } : {}) }));
  let res;
  try {
    res = await cors();
  } catch (err) {
    // Copie HTTP d'une ancienne requête sans CORS (sans en-tête Access-Control-Allow-Origin) : on la contourne une fois.
    try { if (self.navigator?.onLine === false) throw err; res = await cors('reload'); }
    catch { return fetch(e.request); }       // hôte sans CORS ou hors ligne : on laisse passer, sans rien garder
  }
  if (res.ok && res.type === 'cors') {
    e.waitUntil(c.put(key, res.clone()).then(() => trimSoon(name, max)).catch(() => {}));
  }
  return res;
}

// File d'attente : keys() est dans l'ordre d'insertion ; au plus une coupe par minute et par cache.
const lastTrim = {};
async function trimSoon(name, max) {
  if (Date.now() - (lastTrim[name] || 0) < 60000) return;
  lastTrim[name] = Date.now();
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// ---------- données versionnées ----------
const MANIFEST = () => new URL('data/manifest.json', SCOPE).href;

// Garde le manifest ; s'il a changé, retire du cache les fichiers dont le hash n'y est plus. -> manifest | null
async function storeManifest(text) {
  let m = null;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m.files !== 'object' || !m.files) return null;
  const c = await caches.open(DATA);
  const old = await c.match(MANIFEST());
  if (old && (await old.text()) === text) return m;
  await c.put(MANIFEST(), new Response(text, { headers: { 'Content-Type': 'application/json' } }));
  await purge(m);
  return m;
}

// data/manifest.json : réseau d'abord (3 s), copie en secours. Ensuite, en arrière-plan : toutes les séries pour la
// consultation hors ligne (au plus une vérification par heure).
async function manifest(e) {
  const c = await caches.open(DATA);
  const net = fetch(e.request.url, { cache: 'no-cache' }).then(async res => {
    if (res.ok && res.type === 'basic') {
      if (await storeManifest(await res.clone().text())) e.waitUntil(warmSoon());
    } else if (res.status === 404) {
      await c.delete(MANIFEST());             // plus de manifest (développement) : chemins simples, pas de vieille copie
    }
    return res;
  });
  e.waitUntil(net.then(() => {}, () => {}));
  const hit = await c.match(MANIFEST());
  if (!hit) return net;
  return Promise.race([
    net.then(r => (r.ok || r.status === 404 ? r : hit), () => hit),
    new Promise(r => setTimeout(() => r(hit), 3000)),
  ]);
}

async function currentManifest(fetchIfMissing = false) {
  const c = await caches.open(DATA);
  const hit = await c.match(MANIFEST());
  if (hit) { try { return await hit.json(); } catch { return null; } }
  if (!fetchIfMissing) return null;
  try {
    const res = await fetch(MANIFEST(), { cache: 'no-cache' });
    return res.ok ? await storeManifest(await res.text()) : null;
  } catch { return null; }                    // hors ligne
}

// À l'installation : le manifest et les fichiers lus au démarrage, versionnés.
const BOOT = ['data/sets.json', 'data/cardimg.json', 'data/pokedex.json'];
async function precacheData() {
  const res = await fetch(MANIFEST(), { cache: 'no-cache' });
  if (!res.ok) return;                        // développement : pas de manifest
  const m = await storeManifest(await res.text());
  if (!m) return;
  const c = await caches.open(DATA);
  await Promise.all(BOOT.filter(p => m.files[p]).map(async p => {
    const u = new URL(`${p}?h=${m.files[p]}`, SCOPE).href;
    if (await c.match(u)) return;
    const r = await fetch(u, { cache: 'no-cache' });
    if (r.ok) await c.put(u, r);
  }));
}

async function purge(m) {
  const c = await caches.open(DATA);
  for (const req of await c.keys()) {
    const u = new URL(req.url), h = u.searchParams.get('h');
    if (!h) continue;
    const p = rel(u);
    if (p && m.files[p] !== h) await c.delete(req);
  }
}

// Consultation hors ligne de toutes les séries : sets.json, chaque data/sets/<id>.json, l'index, cardimg, Pokédex,
// puis les logos et symboles (img/sets, img/sym). Doucement (2 à la fois, priorité basse), jamais en mode
// « économie de données » ni sur une connexion lente.
const WARM = p => p === 'data/sets.json' || p === 'data/cards-index.json' || p === 'data/cardimg.json'
  || p === 'data/pokedex.json' || /^data\/sets\/[^/]+\.json$/.test(p);
let warming = null, warmedAt = 0;
function warmSoon() {
  if (Date.now() - warmedAt < 3600e3) return Promise.resolve();
  warmedAt = Date.now();
  return warm(20000).catch(() => {});
}
function warm(delay) {
  warming ??= (async () => {
    try {
      if (delay) await new Promise(r => setTimeout(r, delay));
      const cx = self.navigator?.connection;
      if (cx?.saveData || /(^|-)2g$/.test(cx?.effectiveType || '')) return;
      const m = await currentManifest(true);
      if (!m?.files) return;
      const c = await caches.open(DATA);
      const todo = [];
      for (const [p, h] of Object.entries(m.files)) {
        if (!WARM(p)) continue;
        const u = new URL(`${p}?h=${h}`, SCOPE).href;
        if (!(await c.match(u))) todo.push(u);
      }
      if (!(await fetchAll(c, todo))) return;    // hors ligne : on arrête
      // puis les logos et symboles des séries (noms avec hash, ~1 Mo en tout), et le ménage des anciens
      const pics = await setPictures(c, m);
      if (!pics) return;
      const want = [];
      for (const u of pics) if (!(await c.match(u))) want.push(u);
      if (!(await fetchAll(c, want))) return;
      const keep = new Set(pics);
      for (const req of await c.keys()) {
        const p = rel(new URL(req.url));
        if (p && /^img\/(sets|sym)\//.test(p) && !keep.has(req.url)) await c.delete(req);
      }
    } finally { warming = null; }
  })();
  return warming;
}

// 2 à la fois, priorité basse ; -> false si le réseau a lâché
async function fetchAll(c, urls) {
  let i = 0, ok = true;
  await Promise.all([0, 1].map(async () => {
    while (ok && i < urls.length) {
      const u = urls[i++];
      try {
        const res = await fetch(u, { priority: 'low' });
        if (res.ok && res.type === 'basic') await c.put(u, res);
      } catch { ok = false; }
    }
  }));
  return ok;
}

// URLs des logos (séries et blocs) et symboles de data/sets.json (copie versionnée du cache), null si illisible
async function setPictures(c, m) {
  const h = m.files['data/sets.json'];
  if (!h) return null;
  const res = await c.match(new URL(`data/sets.json?h=${h}`, SCOPE).href);
  let d = null;
  try { d = res ? await res.json() : null; } catch { return null; }
  if (!d || !Array.isArray(d.sets)) return null;
  const out = new Set();
  const add = p => { if (typeof p === 'string' && /^img\/[\w./-]+$/.test(p)) out.add(new URL(p, SCOPE).href); };
  for (const s of d.sets) { add(s?.logo); add(s?.sym); }
  for (const b of d.blocs || []) add(b?.logo);
  return [...out];
}

async function offlineStatus() {
  const m = await currentManifest(true);
  if (!m?.files) return { sets: 0, cached: 0, pictures: 0, picturesCached: 0 };
  const c = await caches.open(DATA);
  let sets = 0, cached = 0, picturesCached = 0;
  for (const [p, h] of Object.entries(m.files)) {
    if (!/^data\/sets\/[^/]+\.json$/.test(p)) continue;
    sets++;
    if (await c.match(new URL(`${p}?h=${h}`, SCOPE).href)) cached++;
  }
  const pics = (await setPictures(c, m)) || [];
  for (const u of pics) if (await c.match(u)) picturesCached++;
  return { sets, cached, pictures: pics.length, picturesCached };
}

// ---------- alertes de prix ----------
// Vérification en arrière-plan (Chrome Android, appli installée).
self.addEventListener('periodicsync', e => {
  if (e.tag === 'cardex-prices') {
    e.waitUntil(WishDB.check({ minAge: 3 * 3600 * 1000 }).then(hits => WishDB.notify(self.registration, hits)).catch(() => {}));
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(openApp(e.notification.data?.url || WishDB.URL || './#/marche/envies'));
});

// Une fenêtre de Cardex (le domaine github.io est partagé avec d'autres applis) : mise au premier plan tout de suite
// (le droit de le faire, donné par le clic, ne dure pas), puis ouverte sur la page voulue ; sinon une nouvelle fenêtre.
async function openApp(target) {
  const url = new URL(target, SCOPE).href;
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const c = list.find(x => x.url.startsWith(SCOPE.href) && x.focused) || list.find(x => x.url.startsWith(SCOPE.href));
  if (!c) return self.clients.openWindow(url);
  const focused = c.focus().catch(() => null);
  let n = null;
  if (c.url !== url) {
    // navigate() renvoie le nouveau client (autre document) ; une page non contrôlée refuse : on lui écrit
    n = await c.navigate(url).catch(() => null);
    if (!n) c.postMessage({ type: 'navigate', url });
  }
  const f = await focused;
  return n && !n.focused ? n.focus().catch(() => f) : f;
}
