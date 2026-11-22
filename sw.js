// Service worker : l'appli marche hors-ligne et garde les images de cartes déjà vues.
importScripts('js/wishdb.js');

const SHELL = 'cardex-shell-v7';
const IMAGES = 'cardex-images-v1';
const FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/api.js', 'js/store.js', 'js/scanner.js', 'js/wishdb.js', 'data/logos.json', 'data/pokedex.json', 'data/decks.json', 'icon.svg', 'manifest.webmanifest'];

// Vérification des prix en arrière-plan (Chrome Android, appli installée).
self.addEventListener('periodicsync', e => {
  if (e.tag === 'cardex-prices') e.waitUntil(WishDB.check().then(hits => WishDB.notify(self.registration, hits)));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || './';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    const c = list[0];
    if (c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== IMAGES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Images (cartes, logos, sprites du Pokédex) : cache d'abord.
  if (['assets.tcgdex.net', 'images.pokemontcg.io', 'raw.githubusercontent.com'].includes(url.hostname)) {
    e.respondWith(caches.open(IMAGES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // Fichiers de l'appli : réseau d'abord (pour les mises à jour), cache si hors-ligne.
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request, { cache: 'no-cache' }) // revalide : évite de mélanger deux versions des fichiers
      .then(res => { caches.open(SHELL).then(c => c.put(e.request, res.clone())); return res; })
      .catch(() => caches.match(e.request)));
  }
});
