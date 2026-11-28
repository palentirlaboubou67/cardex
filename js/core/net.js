// Réseau : fetch JSON avec délai maximal et erreurs typées, cache local avec copie périmée, fichiers statiques versionnés.

export const MESSAGES = {
  offline: 'Hors ligne',
  timeout: 'Le serveur ne répond pas',
  notfound: 'Introuvable',
  server: 'Service indisponible',
  network: 'Connexion impossible',
};

export class NetError extends Error {
  constructor(kind, status = 0, url = '') {
    super(MESSAGES[kind] || kind);
    this.name = 'NetError';
    this.kind = kind;     // offline | timeout | notfound | server | network
    this.status = status;
    this.url = url;
  }
}

// GET JSON. Une annulation par l'appelant (signal) est relancée telle quelle (AbortError), jamais déguisée en erreur réseau.
// Le délai vient de notre propre AbortController (Chrome 103–123 rejettent AbortSignal.timeout avec AbortError).
export async function getJSON(url, { timeout = 10000, signal, init = {} } = {}) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  const relay = () => ctl.abort();
  signal?.addEventListener('abort', relay, { once: true });
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new NetError(r.status === 404 || r.status === 410 ? 'notfound' : 'server', r.status, url);
    try { return await r.json(); }
    catch (e) {
      if (signal?.aborted) throw e;
      if (timedOut) throw new NetError('timeout', 0, url);
      throw new NetError('server', r.status, url); // JSON illisible
    }
  } catch (e) {
    if (e instanceof NetError) throw e;
    if (signal?.aborted) throw signal.reason ?? e;
    if (timedOut) throw new NetError('timeout', 0, url);
    throw new NetError(globalThis.navigator?.onLine === false ? 'offline' : 'network', 0, url);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

// Lecture avec durée de vie (localStorage) : une copie périmée l'emporte toujours sur une erreur.
// Les appels simultanés pour la même clé partagent la même promesse.
const inflight = new Map();
export async function cached(key, ttl, load) {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(key)); } catch { c = null; }
  if (c && typeof c === 'object' && 't' in c && Date.now() - c.t < ttl) return c.d;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const d = await load();
      try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch { /* quota : on garde en mémoire */ }
      return d;
    } catch (e) {
      if (c && typeof c === 'object' && 'd' in c) return c.d;
      throw e;
    }
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

// ---------- Fichiers statiques sous data/ ----------
// data/manifest.json (écrit au déploiement par tools/release.py) donne un hash par fichier : data/x.json?h=<hash>,
// mis en cache pour toujours par le service worker. Sans manifest (développement local) : chemin simple + cache 'no-cache'.
const files = new Map();     // chemin -> promesse (mémoire de session)
let manifestP = null, manifestAt = 0;
const MANIFEST_TTL = 3600e3; // appli ouverte longtemps : le manifest est revu au plus toutes les heures

const fetchManifest = () => getJSON('data/manifest.json', { timeout: 4000, init: { cache: 'no-cache' } })
  .then(m => (m && typeof m.files === 'object' && m.files ? m : null), () => null);

// data/manifest.json ou null (développement local, hors ligne sans copie)
export function manifest() {
  if (!manifestP) { manifestP = fetchManifest(); manifestAt = Date.now(); }
  else if (Date.now() - manifestAt > MANIFEST_TTL) {
    manifestAt = Date.now();
    const cur = manifestP;
    fetchManifest().then(m => { if (m && manifestP === cur) manifestP = Promise.resolve(m); });
  }
  return manifestP;
}

// Hash connu d'un fichier (ou null) : utilisé aussi par js/state/wishes.js côté page.
export async function hashOf(path) {
  const m = await manifest();
  return m?.files?.[normPath(path)] || null;
}

const normPath = p => String(p).replace(/^\.?\//, '').replace(/^(?!data\/)/, 'data/');

export function data(path, { timeout = 15000 } = {}) {
  const p = normPath(path);
  if (!files.has(p)) {
    const prom = (async () => {
      const m = await manifest();
      if (m) {
        const h = m.files[p];
        // fichier absent du manifest = absent du déploiement : inutile de le demander
        if (!h) throw new NetError('notfound', 404, p);
        return getJSON(`${p}?h=${h}`, { timeout });
      }
      return getJSON(p, { timeout, init: { cache: 'no-cache' } });
    })();
    files.set(p, prom);
    prom.catch(() => files.delete(p)); // pas de mémoire des échecs : on pourra réessayer
  }
  return files.get(p);
}

// Pour les tests et le rechargement après mise à jour des données.
export function _reset() { files.clear(); manifestP = null; manifestAt = 0; inflight.clear(); }

// ---------- Première visite ----------
// La page a tout chargé avant que le service worker prenne la main : quand il la prend, on lui donne la liste
// (fichiers de l'appli, données, images déjà affichées) pour qu'il en garde une copie (rechargement hors ligne).
// Ce qui était encore en route à ce moment-là (modules d'une vue, fichiers de données) n'est ni dans cette liste ni
// passé par le service worker : un second envoi le donne quelques secondes plus tard.
const LATE_MS = 3000;
try {
  const sw = globalThis.navigator?.serviceWorker;
  if (sw && !sw.controller && typeof performance?.getEntriesByType === 'function') {
    sw.addEventListener('controllerchange', () => {
      const send = urls => {
        try { sw.controller?.postMessage({ type: 'seen', urls: urls.filter(u => /^https?:/.test(u)) }); } catch { /* rien */ }
      };
      const t0 = performance.now();
      try { send([location.href.split('#')[0], ...performance.getEntriesByType('resource').map(e => e.name)]); } catch { /* rien */ }
      try {
        const late = new Set();
        const po = new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.startTime <= t0) late.add(e.name); });
        po.observe({ type: 'resource' });
        setTimeout(() => { po.disconnect(); if (late.size) send([...late]); }, LATE_MS);
      } catch { /* pas de PerformanceObserver : la première liste suffit presque toujours */ }
    }, { once: true });
  }
} catch { /* pas de service worker (http local, navigation privée) */ }
