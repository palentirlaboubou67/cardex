// Liste d'envies + alertes de prix. Script classique : utilisé par la page ET par le service worker
// (qui n'a pas accès au localStorage), d'où IndexedDB.
(function (g) {
  const API = 'https://api.tcgdex.net/v2/fr/cards/';

  function req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  let dbP;
  function db() {
    dbP ??= new Promise((res, rej) => {
      const r = indexedDB.open('cardex', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('wishes', { keyPath: 'key' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbP;
  }
  const os = async mode => (await db()).transaction('wishes', mode).objectStore('wishes');

  const all = async () => req((await os('readonly')).getAll());
  const put = async w => req((await os('readwrite')).put(w));
  const del = async key => req((await os('readwrite')).delete(key));

  // Prix Cardmarket : "low" = l'offre la moins chère en vente, "trend" = la tendance.
  function prices(card, variant) {
    const cm = card?.pricing?.cardmarket || {};
    const holo = variant === 'holo';
    const num = v => (typeof v === 'number' && v > 0 ? v : null);
    return { low: num(holo ? cm['low-holo'] : cm.low), trend: num(holo ? cm['trend-holo'] : cm.trend) };
  }

  function update(w, card) {
    Object.assign(w, prices(card, w.variant), { checkedAt: Date.now() });
    const inRange = w.low != null && w.low >= (w.min || 0) && w.low <= w.max;
    const entered = inRange && !w.inRange; // on ne prévient qu'à l'entrée dans la fourchette
    w.inRange = inRange;
    return entered;
  }

  async function check() {
    const hits = [];
    for (const w of await all()) {
      try {
        const r = await fetch(API + encodeURIComponent(w.id));
        if (!r.ok) continue;
        if (update(w, await r.json())) hits.push(w);
        await put(w);
      } catch {}
    }
    return hits;
  }

  const eur = v => v.toFixed(2).replace('.', ',') + ' €';
  async function notify(reg, hits) {
    for (const w of hits) {
      await reg.showNotification(`${w.name} est dans ta fourchette !`, {
        body: `Dispo dès ${eur(w.low)} sur Cardmarket (${w.setName}). Ta fourchette : ${eur(w.min || 0)} – ${eur(w.max)}`,
        icon: 'icon.svg',
        tag: w.key,
        data: { url: './#wishlist' },
      });
    }
  }

  g.WishDB = { all, put, del, prices, update, check, notify };
})(self);
