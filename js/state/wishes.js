// Liste d'envies + alertes de prix. Script classique (global self.WishDB) : utilisé par la page (window.WishDB)
// ET par le service worker (importScripts), qui n'a pas accès au localStorage, d'où IndexedDB.
// Enregistrements (IndexedDB 'cardex' / 'wishes', clé 'key' = « id|finition », comme l'ancienne appli) :
// { key, id, name, setName, setId, localId, image, variant, min, max, low, trend, checkedAt, inRange, createdAt, v: 2 }
// Prix : data/market/prices/<setId>.json (hash via data/manifest.json), sinon TCGdex /v2/fr/cards/:id avec cmFor().
// Alerte = « low » (offre la moins chère) dans [min, max] ; on ne prévient qu'à l'entrée dans la fourchette.
(function (g) {
  'use strict';
  const API = 'https://api.tcgdex.net/v2/fr/cards/';
  const DB = 'cardex', STORE = 'wishes';
  const FINISHES = ['normal', 'reverse', 'holo', 'cosmos', 'pokeball', 'masterball', 'firstEdition', 'stamp'];
  const URL_ENVIES = './#/marche/envies';

  const setIdOf = id => { const s = String(id); const i = s.lastIndexOf('-'); return i > 0 ? s.slice(0, i) : s; };
  const keyOf = (id, variant) => `${id}|${variant}`;
  // racine de l'appli : portée du service worker, ou la page
  const base = () => (g.registration && g.registration.scope) || g.location.href;
  const abs = p => new URL(p, base()).href;

  // ---------- IndexedDB ----------
  function req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  let dbP = null;
  function db() {
    dbP = dbP || new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      r.onsuccess = () => {
        const d = r.result;
        d.onversionchange = () => { d.close(); dbP = null; };
        res(d);
      };
      r.onerror = () => { dbP = null; rej(r.error); };
      r.onblocked = () => { dbP = null; rej(new Error('IndexedDB bloquée')); };
    });
    return dbP;
  }
  const os = async mode => (await db()).transaction(STORE, mode).objectStore(STORE);

  // ---------- changements (tous les contextes : onglets et service worker) ----------
  const subs = new Set();
  let chan = null;
  try {
    chan = new BroadcastChannel('cardex-wishes');
    chan.onmessage = () => subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  } catch (e) { chan = null; }
  function changed() {
    subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    try { if (chan) chan.postMessage('changed'); } catch (e) { /* rien */ }
  }
  const on = fn => { subs.add(fn); return () => subs.delete(fn); };

  const all = async () => req((await os('readonly')).getAll());
  const getOne = async key => req((await os('readonly')).get(key));
  async function put(w) { const r = await req((await os('readwrite')).put(w)); changed(); return r; }
  async function del(key) { const r = await req((await os('readwrite')).delete(key)); changed(); return r; }
  const putQuiet = async w => req((await os('readwrite')).put(w));
  const delQuiet = async key => req((await os('readwrite')).delete(key));

  // ---------- réseau ----------
  function getJSON(url, { timeout = 10000, cache } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    return fetch(url, { signal: ctl.signal, cache: cache || 'default' }).then(r => {
      if (r.status === 404) return null;            // absent : ce n'est pas une panne
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }).finally(() => clearTimeout(t));
  }

  // TCGdex : au plus 4 requêtes par seconde (une tous les 250 ms pour tout ce contexte), et sur 429 / 503,
  // nouvel essai après 1,5 s puis 4 s (SPEC §1.7)
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let nextSlot = 0;
  async function slot() {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + 250;
    if (at > now) await sleep(at - now);
  }
  async function tcgdex(url, opts) {
    for (let attempt = 0; ; attempt++) {
      await slot();
      try { return await getJSON(url, opts); }
      catch (e) {
        if ((e.status === 429 || e.status === 503) && attempt < 2) { await sleep(attempt ? 4000 : 1500); continue; }
        throw e;
      }
    }
  }

  // fichiers de la vérification en cours (un seul téléchargement par série)
  function context() { return { manifest: undefined, files: new Map(), sets: new Map() }; }
  async function manifestOf(ctx) {
    if (ctx.manifest === undefined) {
      try {
        const m = await getJSON(abs('data/manifest.json'), { timeout: 5000, cache: 'no-cache' });
        ctx.manifest = m && m.files ? m : null;
      } catch (e) { ctx.manifest = null; }
    }
    return ctx.manifest;
  }
  // data/<path> versionné par le manifest ; null si le fichier n'existe pas
  async function dataFile(ctx, path) {
    const m = await manifestOf(ctx);
    if (m) {
      const h = m.files[path];
      return h ? getJSON(abs(`${path}?h=${h}`)) : null;
    }
    return getJSON(abs(path), { cache: 'no-cache' });
  }
  function priceFile(ctx, setId) {
    if (!ctx.files.has(setId)) ctx.files.set(setId, dataFile(ctx, `data/market/prices/${setId}.json`));
    return ctx.files.get(setId);
  }
  function setFile(ctx, setId) {
    // null : pas de fichier pour cette série ; undefined : injoignable (hors ligne)
    if (!ctx.sets.has(setId)) ctx.sets.set(setId, dataFile(ctx, `data/sets/${setId}.json`).catch(() => undefined));
    return ctx.sets.get(setId);
  }

  // ---------- prix ----------
  const pos = v => (typeof v === 'number' && v > 0 ? v : null);
  const c2e = v => (typeof v === 'number' && v > 0 ? v / 100 : null);
  function saneTrend(trend, a7, a30) {
    const ref = a7 || a30;
    return trend && ref && !(trend >= ref / 5 && trend <= ref * 5) ? ref : (trend || a30 || a7 || null);
  }

  // ----- correspondance Cardmarket des fiches TCGdex (même règle que js/data/prices.js cmFor) -----
  const lc = s => String(s || '').toLowerCase();
  const simple = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  function foilKey(d) {
    const f = simple(d && d.foil);
    if (f.includes('cosmo')) return 'cosmos';
    if (f.includes('pokeball')) return 'pokeball';
    if (f.includes('masterball')) return 'masterball';
    return null;
  }
  function cmFor(full, finish) {
    const cm = (full && full.pricing && full.pricing.cardmarket) || null;
    const v = (full && full.variants) || {};
    const vd = Array.isArray(full && full.variants_detailed) ? full.variants_detailed : [];
    if (finish === 'cosmos' || finish === 'pokeball' || finish === 'masterball') {
      const d = vd.find(x => foilKey(x) === finish);
      if (!d) return [null, '', false];
      const dc = d.pricing && d.pricing.cardmarket;
      const reverseType = finish !== 'cosmos' || lc(d.type) === 'reverse';
      if (dc && dc.idProduct !== (cm && cm.idProduct)) return [dc, reverseType ? '-holo' : '', true];
      const plainReverse = vd.some(x => lc(x.type) === 'reverse' && !foilKey(x));
      if (reverseType) return plainReverse ? [null, '', false] : [cm, '-holo', false];
      return v.normal ? [null, '', false] : [cm, '', false];
    }
    if (finish === 'reverse') return [cm, '-holo', false];
    if (finish === 'holo' && v.normal) {
      const d = vd.find(x => lc(x.type) === 'holo' && !foilKey(x));
      const dc = d && d.pricing && d.pricing.cardmarket;
      return dc && dc.idProduct !== (cm && cm.idProduct) ? [dc, '', true] : [null, '', false];
    }
    return [cm, '', false];
  }
  function readCm(cm, s) {
    const n = k => pos(cm && cm[k + s]);
    const low = n('low'), trend = saneTrend(n('trend') || n('avg'), n('avg7'), n('avg30'));
    return low != null || trend != null ? { low, trend } : null;
  }
  // { low, trend } d'une fiche TCGdex complète (fiche carte : alerte proposée), ou { low: null, trend: null }
  function prices(full, variant) {
    const [cm, sfx, separate] = cmFor(full, variant);
    const r = cm ? (readCm(cm, sfx) || (separate ? readCm(cm, sfx ? '' : '-holo') : null)) : null;
    return r || { low: null, trend: null };
  }

  // Prix d'une envie : fichier de cotes du jour, sinon TCGdex en direct.
  // -> { low, trend, source, date } ; rejette seulement si aucune source n'a répondu (hors ligne).
  async function priceFor(w, ctx) {
    ctx = ctx || context();
    const setId = w.setId || setIdOf(w.id);
    const lid = String(w.id).slice(setId.length + 1);
    let answered = false;
    try {
      const f = await priceFile(ctx, setId);
      answered = true;
      const a = f && f.c && f.c[lid] && f.c[lid][w.variant];
      if (a) {
        const low = c2e(a[4]), trend = saneTrend(c2e(a[0]), c2e(a[2]), c2e(a[3]));
        if (low != null || trend != null) return { low, trend, source: 'cardmarket', date: f.d || null };
      }
    } catch (e) { /* injoignable : TCGdex ci-dessous */ }
    try {
      const full = await tcgdex(API + encodeURIComponent(w.id), { timeout: 12000 });
      answered = true;
      if (full) {
        const p = prices(full, w.variant);
        if (p.low != null || p.trend != null) return { low: p.low, trend: p.trend, source: 'tcgdex', date: null };
      }
    } catch (e) { /* injoignable */ }
    if (!answered) throw new Error('Hors ligne');
    return { low: null, trend: null, source: null, date: null };
  }

  // applique un prix ; renvoie true si l'envie vient d'entrer dans sa fourchette
  function update(w, p) {
    if (p && p.pricing) p = prices(p, w.variant);          // ancienne signature : fiche TCGdex
    w.low = p ? (p.low ?? null) : null;
    w.trend = p ? (p.trend ?? null) : null;
    w.checkedAt = Date.now();
    const min = Number(w.min) || 0, max = Number(w.max);
    const inRange = w.low != null && max > 0 && w.low >= min && w.low <= max;
    const entered = inRange && !w.inRange;
    w.inRange = inRange;
    return entered;
  }

  // Anciennes envies (v1) : setId manquant ; deux choix seulement dans l'ancienne appli :
  // « normal » = champs de base de Cardmarket (pour une carte holo seulement, c'est la holo),
  // « holo » = « Reverse / Holo » (champs -holo, donc la reverse quand la carte en a une).
  // La finition est ramenée à une de celles de la carte (fichier de sa série), sinon son prix ne serait jamais trouvé.
  async function migrate(w, ctx) {
    if (w.v === 2) return w;
    const old = w.key;
    w.setId = w.setId || setIdOf(w.id);
    w.localId = w.localId || String(w.id).slice(w.setId.length + 1);
    if (!FINISHES.includes(w.variant)) w.variant = 'normal';
    const f = await setFile(ctx, w.setId);
    if (f === undefined) return w;                             // série injoignable : migration au prochain passage
    const c = f && Array.isArray(f.cards) ? f.cards.find(x => String(x.l) === w.localId || `${w.setId}-${x.l}` === w.id) : null;
    const fins = c && Array.isArray(c.f) ? c.f.filter(x => FINISHES.includes(x)) : [];
    if (fins.length) {
      if (w.variant === 'holo' && fins.includes('reverse')) w.variant = 'reverse';
      else if (!fins.includes(w.variant)) w.variant = w.variant === 'normal' && fins.includes('holo') ? 'holo' : fins[0];
    }
    w.key = keyOf(w.id, w.variant);
    w.v = 2;
    if (w.key !== old) {
      const exists = await getOne(w.key).catch(() => null);
      await delQuiet(old);
      if (exists) return null;                                 // doublon : on garde l'envie déjà là
    }
    return w;
  }

  // Vérifie les prix (4 en parallèle). minAge (ms) : ignore les envies vérifiées plus récemment.
  async function check({ minAge = 0 } = {}) {
    const list = await all();
    const ctx = context();
    const hits = [];
    let i = 0, touched = false;
    async function worker() {
      while (i < list.length) {
        let w = list[i++];
        try {
          w = await migrate(w, ctx);
          if (!w) { touched = true; continue; }
          if (minAge && w.checkedAt && Date.now() - w.checkedAt < minAge) { await putQuiet(w); continue; }
          const p = await priceFor(w, ctx);
          if (update(w, p)) hits.push(w);
          await putQuiet(w);
          touched = true;
        } catch (e) { /* hors ligne : on garde l'état précédent */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
    if (touched) changed();
    return hits;
  }

  // nouvelle envie à partir d'une carte (brève, fiche ou entrée de collection)
  function make(card, variant, { min = 0, max } = {}) {
    const setId = card.setId || (card.set && card.set.id) || setIdOf(card.id);
    return {
      key: keyOf(card.id, variant), id: card.id, v: 2,
      name: card.name || '', setName: card.setName || (card.set && card.set.name) || '',
      setId, localId: String(card.localId || String(card.id).slice(setId.length + 1)),
      setTotal: card.setTotal || (card.set && card.set.cardCount && card.set.cardCount.official) || null,
      image: card.image || '', variant, min: Number(min) || 0, max: Number(max),
      low: null, trend: null, checkedAt: 0, inRange: false, createdAt: Date.now(),
    };
  }

  const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const eur = v => EUR.format(v || 0);
  async function notify(reg, hits) {
    if (!reg || !reg.showNotification || !hits || !hits.length) return;
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;
    for (const w of hits) {
      try {
        await reg.showNotification(`${w.name} est dans ta fourchette`, {
          body: `Dès ${eur(w.low)} sur Cardmarket${w.setName ? ` (${w.setName})` : ''}. Ta fourchette : ${eur(w.min)} – ${eur(w.max)}`,
          icon: 'icon.svg',
          tag: w.key,
          data: { url: URL_ENVIES },
        });
      } catch (e) { /* notification refusée */ }
    }
  }

  // ---------- page : permission des notifications et vérification en arrière-plan ----------
  // Vérification périodique (tag 'cardex-prices', ~12 h) : Chrome Android, appli installée. -> true si inscrite
  async function registerPeriodic() {
    try {
      const reg = g.navigator && g.navigator.serviceWorker ? await g.navigator.serviceWorker.getRegistration() : null;
      if (!reg || !('periodicSync' in reg)) return false;
      const st = await g.navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st.state !== 'granted') return false;
      await reg.periodicSync.register('cardex-prices', { minInterval: 12 * 3600 * 1000 });
      return true;
    } catch (e) { return false; }
  }
  // État pour l'écran Envies : { perm: 'granted'|'denied'|'default'|'unsupported', background: bool }
  async function alertStatus() {
    const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    return { perm, background: perm === 'granted' ? await registerPeriodic() : false };
  }
  // Demande la permission (geste de l'utilisateur), puis inscrit la vérification en arrière-plan quand c'est possible.
  async function enableAlerts() {
    if (typeof Notification === 'undefined') return alertStatus();
    if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { /* refus */ } }
    return alertStatus();
  }

  g.WishDB = { all, get: getOne, put, del, check, notify, priceFor, prices, update, make, migrate, on, keyOf, cmFor,
    enableAlerts, alertStatus, URL: URL_ENVIES };
})(self);
