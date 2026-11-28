// Fiche carte (#/carte/:cardId, FINAL-design W-H) : image (basse puis haute qualité, inclinaison, calque de la finition),
// nom, série et numéro, quantités par finition (compteurs, toast « Annuler »), cote Cardmarket de la finition choisie,
// alerte prix (envies), détails et attaques (fiche TCGdex en direct). Reste dans l'onglet d'où on l'ouvre ;
// ?finition= garde la finition en aperçu. Deux colonnes à partir de 900 px (image collante à gauche).
import { setBar, revealTitle, updateAction } from '../core/appbar.js';
import { html, raw, setHTML, delegate } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { cardNo, eur, plural, dateFr } from '../core/format.js';
import { toast } from '../core/toast.js';
import { infoSheet, openSheet } from '../core/sheet.js';
import { cardId, setParams, setHref, cardHref, back as goBack, depth } from '../core/router.js';
import { MESSAGES, NetError } from '../core/net.js';
import { whenIdle } from '../core/idle.js';
import { deltaHTML } from '../components/chart.js';
import { imgHTML, imgCaption, enBadge, cardImg } from '../data/images.js';
import { LABEL, DOT, FOIL, FINISHES, sortFinishes, finishesOf } from '../data/finishes.js';
import * as catalog from '../data/catalog.js';
import * as prices from '../data/prices.js';
import * as tcgdex from '../data/tcgdex.js';
import * as dex from '../data/dex.js';
import * as col from '../state/collection.js';
import { bindTilt, sheen } from './carte/holo.js';
import { linksHTML, factsHTML, movesHTML, rarityOf } from './carte/details.js';
import * as alerts from './carte/alert.js';

const ID_RE = /^[\w.%!-]+-[\w.%!]+$/;          // même règle que la collection (exu-%3F, exu-!)
const EN = new Map();                           // id -> nom anglais (lien Cardmarket)

let el = null;          // <section id="v-card">
let S = null;           // fiche affichée (remplacée à chaque show)
let lastR = null, io = null, unTilt = null;
let retryCtl = null;    // signal de Réessayer quand main.js a annulé celui de la route en gardant la fiche affichée

// ---------- données ----------
// finitions affichées : celles de la carte, plus celles possédées hors catalogue et celles déjà montrées pendant la visite
function shownOf(s) {
  const own = Object.keys(col.get(s.id)?.qty || {});
  const base = s.card.finishes?.length ? s.card.finishes : s.full ? finishesOf(s.full) : [];
  const list = sortFinishes([...base, ...own, ...s.extras]);
  return list.length ? list : s.fullState === 'wait' ? [] : ['normal'];
}
const cardFinishes = s => sortFinishes(s.card.finishes?.length ? s.card.finishes : s.full ? finishesOf(s.full) : ['normal']);
// finition d'une nouvelle alerte : celle en aperçu si la carte l'a, sinon sa première (la feuille ne propose que celles-là)
function alertFin(s) {
  const fins = cardFinishes(s);
  return fins.includes(s.fin) ? s.fin : fins[0];
}
// finition en aperçu par défaut : une finition de la carte que je possède, sinon sa première, sinon une possédée
function defaultFin(s, list) {
  const own = f => col.qtyOf(s.id, f) > 0, real = f => s.card.finishes?.includes(f);
  return list.find(f => real(f) && own(f)) || list.find(real) || list.find(own) || list[0] || 'normal';
}

// la carte figure-t-elle dans le fichier de cotes de sa série (au moins une finition cotée) ?
const inFile = id => FINISHES.some(f => prices.get(id, f));

// Cote d'une finition : fichier du jour (MK) ; TCGdex en direct seulement si la carte manque au fichier.
// undefined = en cours de chargement ; null = pas de cote (« — », jamais la normale à la place).
function priceOf(f, s = S) {
  if (!s?.card) return null;
  if (prices.has(s.card.setId)) {
    const p = prices.get(s.id, f);
    if (p) return p;
    if (inFile(s.id)) return null;
  } else if (!s.pricesDone) return undefined;
  if (s.fullState === 'wait') return undefined;
  if (!s.full) return null;
  const p = prices.liveSync(s.full, f);
  if (!p) return null;
  const separate = prices.cmFor(s.full, f)[2];
  return { ...p, live: true, ...((f === 'firstEdition' || f === 'stamp') && !separate ? { allEditions: true } : {}) };
}

const setNameOf = s => s.meta?.name || s.card.setName || s.full?.set?.name || '';
const totalOf = s => s.meta?.total || s.card.setTotal || s.full?.set?.cardCount?.official || 0;
const cmUrl = s => `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(s.en || s.card.name)}`;
const SK_ROW = '<div class="row sk-row" aria-hidden="true"><span class="body"><span class="sk-t"></span><span class="sk-s"></span></span></div>';

// Signal du rendu de la fiche. main.js refait parfois la même route sans rappeler la vue (même vue, même adresse :
// le signal de son show() est alors annulé alors qu'elle reste affichée) : la fiche visible garde la main sur sa
// barre et ses chargements ; une fiche quittée, jamais.
const alive = s => !!s && S === s && (!s.sig?.aborted || !el.hidden);
const sigOf = s => (s.sig?.aborted && !el.hidden ? undefined : s.sig);
const barOpt = s => (alive(s) ? { signal: sigOf(s) } : { signal: s?.sig });

// ---------- gabarits ----------
function skeletonHTML() {
  return raw(`<div class="cp" aria-busy="true"><div class="cp-media"><div class="cp-hero"><div class="cp-card cp-cardsk"></div></div></div>`
    + `<div class="cp-info"><div class="cp-head"><span class="sk cp-sk1"></span><span class="sk cp-sk2"></span></div>`
    + `<div class="sect">Ma collection</div><div class="group">${SK_ROW.repeat(2)}</div></div></div>`);
}

function heroHTML(s) {
  const c = s.card;
  const has = cardImg(c, 'low').urls.length > 0;
  const fx = FOIL.has(s.fin) ? `fx fx-${s.fin}` : 'fx';
  const imgs = has
    ? html`${imgHTML(c, { q: 'low', eager: true, cls: 'cp-lo' })}${imgHTML(c, { q: 'high', eager: true, cls: 'cp-hi' })}`
    : imgHTML(c, { q: 'low' });
  // pastille « EN » / « ≈ » : dans la légende sous l'image, jamais sur l'illustration (elle cachait le nom imprimé)
  const inner = html`<span class="cp-img">${imgs}</span><i class="${fx}" aria-hidden="true"></i><i class="cp-glare" aria-hidden="true"></i>`;
  const box = has
    ? html`<button type="button" class="cp-card" aria-label="${`Agrandir l’illustration de ${c.name}`}">${inner}</button>`
    : html`<div class="cp-card">${inner}</div>`;
  // « Illustration de la version anglaise », « Même illustration que … » (lien vers la carte d'origine quand elle est connue)
  const text = imgCaption(c);
  const ref = cardImg(c).ref;
  const cap = !text ? '' : ref && ref !== c.id && ID_RE.test(ref) ? html`<a href="${cardHref(ref)}">${text}</a>` : text;
  const pill = has ? enBadge(c) : '';
  return html`<div class="cp-hero${cap ? ' has-cap' : ''}">${box}</div>${cap ? html`<p class="cp-cap">${pill ? html`<span class="cp-capill" aria-hidden="true">${pill}</span>` : ''}${cap}</p>` : ''}`;
}

function headHTML(s) {
  const c = s.card, name = setNameOf(s);
  const rarity = rarityOf(c.rarity);
  const parts = [name ? html`<a href="${setHref(c.setId)}" data-up>${name}</a>` : '', html`<span class="num">${cardNo(c.localId, totalOf(s))}</span>`, rarity].filter(Boolean);
  return html`<div class="cp-head"><h2 class="cp-name">${c.name}</h2><p class="cp-meta">${parts.map((p, i) => (i ? html` · ${p}` : p))}</p></div>`;
}

// ----- Ma collection -----
function priceCell(s, f) {
  const p = priceOf(f, s);
  if (p === undefined) return { text: raw('<span class="sk cp-psk"></span><span class="sr">Cote en cours de chargement</span>'), na: false, ae: false };
  return { text: p?.eur != null ? eur(p.eur) : '—', na: p?.eur == null, ae: !!p?.allEditions };
}

function finRowHTML(s, f, multi) {
  const n = col.qtyOf(s.id, f);
  const sel = multi && f === s.fin;
  const lab = LABEL[f] || f;
  const pc = priceCell(s, f);
  const inner = html`<i class="${DOT[f] || 'dot'}"></i><span class="body"><span class="t">${lab}${multi ? html`<span class="cp-pvl"> · aperçu</span>` : ''}</span><span class="s cp-ae"${pc.ae ? '' : raw(' hidden')}><span>Prix toutes éditions</span></span></span><span class="price cp-pr${pc.na ? ' na' : ''}">${pc.text}</span>`;
  const pv = multi
    ? html`<button type="button" class="cp-pv" aria-pressed="${sel ? 'true' : 'false'}">${inner}</button>`
    : html`<span class="cp-pv">${inner}</span>`;
  return html`<div class="row cp-fin${sel ? ' sel' : ''}" data-f="${f}">${pv}<span class="stepper"><button type="button" data-step="-1" aria-label="${`Retirer un exemplaire ${lab}`}"${n ? '' : raw(' disabled')}>${icon('minus')}</button><span class="v">${n}</span><button type="button" data-step="1" aria-label="${`Ajouter un exemplaire ${lab}`}"${n >= 999 ? raw(' disabled') : ''}>${icon('plus')}</button></span></div>`;
}

function sumText(s) {
  const rec = col.get(s.id);
  if (!rec) return '';
  let v = 0, any = false;
  for (const [f, q] of Object.entries(rec.qty)) {
    const p = priceOf(f, s);
    if (p?.eur != null) { v += p.eur * q; any = true; }
  }
  return [plural(col.total(rec), 'exemplaire', 'exemplaires'), any ? eur(Math.round(v * 100) / 100) : ''].filter(Boolean).join(' · ');
}

function ownHTML(s) {
  const list = shownOf(s);
  const rows = list.length ? list.map(f => finRowHTML(s, f, list.length > 1)) : raw(SK_ROW);
  return html`<div class="sect"><span class="grow">Ma collection</span><span class="cp-sum">${sumText(s)}</span></div><div class="group cp-own">${rows}</div>`;
}

// ----- cote de la finition en aperçu -----
function priceHTML(s) {
  const f = s.fin, p = priceOf(f, s);
  const head = html`<div class="sect"><span class="grow">Cote Cardmarket · ${LABEL[f] || f}</span><button type="button" class="ibtn" data-info aria-label="À propos des cotes">${icon('info')}</button></div>`;
  const cm = html`<a class="row cp-cm" href="${cmUrl(s)}" target="_blank" rel="noopener"><span class="body"><span class="t">Voir sur Cardmarket</span></span>${icon('external', { cls: 'chev' })}</a>`;
  if (p === undefined) {
    return html`${head}<div class="group cp-price" aria-busy="true"><div class="cp-p1"><span class="sk cp-bsk"></span></div><div class="kv">${raw('<div><span class="sk cp-ksk"></span></div>'.repeat(4))}</div></div>`;
  }
  if (!p) {
    return html`${head}<div class="group cp-price"><div class="cp-p1"><span class="price big na">—</span></div><p class="cp-note">Pas de cote Cardmarket pour cette finition.</p>${cm}</div>`;
  }
  const pct = p.eur != null && p.avg30 ? ((p.eur - p.avg30) / p.avg30) * 100 : null;
  const cell = (k, v) => html`<div><small>${k}</small><b>${eur(v)}</b></div>`;
  const note = p.allEditions ? html`<p class="cp-note">Prix toutes éditions : Cardmarket ne vend pas cette version à part.</p>` : '';
  const d = prices.date();
  const foot = p.live ? 'Cote Cardmarket en direct (TCGdex), toutes langues.'
    : d ? `Tendance Cardmarket du ${dateFr(d)}, toutes langues.` : 'Tendance Cardmarket, toutes langues.';
  return html`${head}<div class="group cp-price"><div class="cp-p1"><span class="price big${p.eur == null ? ' na' : ''}">${eur(p.eur)}</span>${
    pct != null ? deltaHTML(pct, { per: '30 j' }) : ''}</div>${note}<div class="kv">${cell('Moy. 7 j', p.avg7)}${cell('Moy. 30 j', p.avg30)}${cell('Hier', p.avg1)}${cell('Prix bas', p.low)}</div>${cm}</div><p class="caption">${foot}</p>`;
}

// ----- alerte prix -----
function alertsHTML(s) {
  const head = html`<div class="sect"><span class="grow">Alerte prix</span></div>`;
  if (s.wishErr) return html`${head}<div class="errrow">${icon('alert')}<span class="grow">Alertes indisponibles : le stockage du navigateur est bloqué</span></div>`;
  if (!s.wishes) return html`${head}<div class="group">${raw(SK_ROW)}</div>`;
  const fin = alertFin(s);
  return html`${head}${alerts.rowsHTML(s.wishes, {
    fin, suggest: alerts.suggestOf(priceOf(fin, s) || null), allEditions: f => !!priceOf(f, s)?.allEditions,
  })}`;
}

// ----- détails, attaques -----
function detailsHTML(s) {
  const err = s.fullState === 'err'
    ? html`<div class="errrow">${icon(s.fullErr?.kind === 'offline' ? 'wifi-off' : 'alert')}<span class="grow">Détails indisponibles · ${MESSAGES[s.fullErr?.kind] || 'Connexion impossible'}</span><button type="button" class="btn text" data-retry>Réessayer</button></div>`
    : '';
  return html`<div class="sect">Détails</div>${linksHTML(s.card, s.meta, s.bloc, s.dex)}${factsHTML(s.card, s.meta, s.full, { loading: s.fullState === 'wait' })}${err}`;
}

function movesPart(s) {
  const m = movesHTML(s.full);
  return m ? html`<div class="sect">${m.title}</div>${m.body}` : '';
}

function pageHTML(s) {
  return html`<div class="cp" data-card="${s.id}">
    <div class="cp-media">${heroHTML(s)}</div>
    <div class="cp-info">${headHTML(s)}
      <div data-part="own">${ownHTML(s)}</div>
      <div data-part="price">${priceHTML(s)}</div>
      <div data-part="alerts">${alertsHTML(s)}</div>
      <div data-part="details">${detailsHTML(s)}</div>
      <div data-part="moves">${movesPart(s)}</div>
      <p class="caption cp-credit">Données des cartes : TCGdex</p>
    </div>
  </div>`;
}

// ---------- mises à jour en place ----------
const part = name => el.querySelector(`[data-part="${name}"]`);
function patch(name, s, fn) { const box = part(name); if (box && S === s) setHTML(box, fn(s)); }

// quantités et cotes des lignes, sans les recréer (le focus clavier reste sur le compteur).
// reload (import, autre onglet, réparation des finitions v1) : les lignes repartent de la collection.
function syncOwn(s, reload = false) {
  const box = part('own');
  if (!box || S !== s) return;
  const rows = [...box.querySelectorAll('.cp-fin[data-f]')];
  if (reload) s.extras.clear();
  else for (const r of rows) if (!s.card.finishes?.includes(r.dataset.f)) s.extras.add(r.dataset.f);   // une ligne ne disparaît pas sous le doigt
  const list = shownOf(s);
  if (list.join() !== rows.map(r => r.dataset.f).join()) {
    if (list.length && !list.includes(s.fin)) {
      s.fin = defaultFin(s, list);
      const fx = el.querySelector('.cp-card .fx');
      if (fx) fx.className = FOIL.has(s.fin) ? `fx fx-${s.fin}` : 'fx';
      patch('price', s, priceHTML);
      patch('alerts', s, alertsHTML);
    }
    patch('own', s, ownHTML);
    return;
  }
  for (const r of rows) {
    const f = r.dataset.f, n = col.qtyOf(s.id, f), pc = priceCell(s, f);
    r.querySelector('.v').textContent = String(n);
    r.querySelector('[data-step="-1"]').disabled = !n;
    r.querySelector('[data-step="1"]').disabled = n >= 999;
    const pr = r.querySelector('.cp-pr');
    if (pr) { setHTML(pr, html`${pc.text}`); pr.classList.toggle('na', pc.na); }
    r.querySelector('.cp-ae')?.toggleAttribute('hidden', !pc.ae);
  }
  const sum = box.querySelector('.cp-sum');
  if (sum) sum.textContent = sumText(s);
}

function patchPrices(s) {
  syncOwn(s);
  patch('price', s, priceHTML);
  patch('alerts', s, alertsHTML);
}

function updateBell(s) {
  const has = !!s.wishes?.length;
  updateAction(0, { icon: has ? 'bell-ring' : 'bell', label: has ? 'Modifier l’alerte prix' : 'Alerte prix' }, barOpt(s));
}

// ---------- chargements de fond ----------
function loadPrices(s) {
  if (prices.has(s.card.setId)) { s.pricesDone = true; return; }
  prices.ensure([s.card.setId]).then(() => {
    if (S !== s) return;
    s.pricesDone = true;
    patchPrices(s);
  });
}

async function loadFull(s) {
  if (s.loadingFull) return;
  s.loadingFull = true;
  if (s.fullState !== 'wait') { s.fullState = 'wait'; patch('details', s, detailsHTML); }
  try {
    const full = await tcgdex.card(s.id, { signal: sigOf(s) });
    if (S !== s) return;
    s.full = full && typeof full === 'object' ? full : null;
    s.fullState = s.full ? 'ok' : 'err';
    if (s.full) {
      if (!s.card.finishes?.length) s.card.finishes = finishesOf(s.full);
      const n = dex.dexNums(s.full);
      if (n.length) s.dex = n;
      fetchEnName(s);
    }
  } catch (e) {
    if (S !== s) return;
    if (e?.name === 'AbortError') {                // fiche quittée : reprise par resume() ; encore affichée : on relance
      s.fullState = 'wait';
      setTimeout(() => { if (alive(s) && !el.hidden && !s.full) loadFull(s); }, 0);
      return;
    }
    s.fullState = 'err';
    s.fullErr = e;
  } finally {
    s.loadingFull = false;
  }
  patch('details', s, detailsHTML);
  patch('moves', s, movesPart);
  patchPrices(s);
}

// nom anglais de la carte (recherche Cardmarket, SPEC §8) : une petite requête GraphQL, au repos
function fetchEnName(s) {
  if (EN.has(s.id)) { s.en = EN.get(s.id); el.querySelector('.cp-cm')?.setAttribute('href', cmUrl(s)); return; }
  if (navigator.onLine === false) return;
  whenIdle(async () => {
    if (S !== s) return;
    try {
      const d = await tcgdex.gql(`{ card(id: ${JSON.stringify(s.id)}) { name } }`, { timeout: 8000 });
      const n = d?.card?.name;
      if (typeof n !== 'string' || !n || n.length > 120) return;
      EN.set(s.id, n);
      if (S !== s) return;
      s.en = n;
      el.querySelector('.cp-cm')?.setAttribute('href', cmUrl(s));
    } catch { /* recherche avec le nom français */ }
  });
}

async function loadWishes(s) {
  s.wishStale = false;
  if (!alerts.available()) { s.wishErr = true; patch('alerts', s, alertsHTML); return; }
  try {
    const list = await alerts.wishesOf(s.id);
    if (S !== s) return;
    s.wishes = list;
    s.wishErr = false;
  } catch {
    if (S !== s) return;
    s.wishErr = true;
  }
  patch('alerts', s, alertsHTML);
  updateBell(s);
}

function loadContext(s) {
  Promise.allSettled([dex.pokedex(), catalog.sets()]).then(([, st]) => {
    if (S !== s) return;
    const all = st.value;
    s.meta ??= catalog.metaSync(s.card.setId);
    s.bloc = all?.blocs?.find(b => b.id === s.meta?.bloc)?.name || s.full?.set?.serie?.name || '';
    const n = dex.dexNums(s.full || s.card);
    if (n.length) s.dex = n;
    patch('details', s, detailsHTML);
  });
}

// ---------- interactions ----------
function preview(s, f) {
  if (!s || !f || s.fin === f) return;
  s.fin = f;
  for (const r of el.querySelectorAll('[data-part="own"] .cp-fin[data-f]')) {
    const on = r.dataset.f === f;
    r.classList.toggle('sel', on);
    r.querySelector('button.cp-pv')?.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const fx = el.querySelector('.cp-card .fx');
  if (fx) { fx.className = FOIL.has(f) ? `fx fx-${f}` : 'fx'; sheen(fx); }
  patch('price', s, priceHTML);
  patch('alerts', s, alertsHTML);
  setParams({ finition: f });
}

function step(b) {
  const s = S;
  const f = b.closest('[data-f]')?.dataset.f;
  if (!s?.card || !f) return;
  const before = col.qtyOf(s.id, f);
  const n = Math.max(0, Math.min(999, before + Number(b.dataset.step)));
  if (n === before) return;
  const c = s.card;
  try { col.setQty(c, f, n); } catch (e) { console.error(e); return; }
  const tot = col.qtyOf(s.id), lab = LABEL[f] || f;
  const msg = n > before ? `Ajoutée en ${lab} · ${tot} au total` : tot ? `Retirée en ${lab} · ${tot} au total` : 'Retirée de ta collection';
  toast(msg, { action: 'Annuler', onAction: () => col.setQty(c, f, before) });
  if (n > before) { try { navigator.vibrate?.(12); } catch { /* rien */ } }
  if (f !== s.fin && shownOf(s).length > 1) preview(s, f);
}

function openAlert(key) {
  const s = S;
  if (!s?.card) return;
  if (!alerts.available() || s.wishErr) { toast('Alertes indisponibles : le stockage du navigateur est bloqué'); return; }
  const list = s.wishes || [], fin = alertFin(s);
  const existing = key ? list.find(w => w.key === key) || null
    : list.find(w => w.variant === s.fin) || list.find(w => w.variant === fin) || null;
  const fins = sortFinishes([...cardFinishes(s), ...(existing ? [existing.variant] : [])]);
  alerts.openAlertSheet({
    card: { ...s.card, setName: setNameOf(s), setTotal: totalOf(s), en: s.en || '' },
    finishes: fins, fin: existing?.variant || fin, existing,
    priceOf: f => priceOf(f, s) || null,
    onDone: () => loadWishes(s),
  });
}

// finition absente du catalogue pour cette carte (ancienne appli : « Ma carte a une autre finition… »)
function otherFinish() {
  const s = S;
  if (!s?.card) return;
  const shown = shownOf(s);
  const others = FINISHES.filter(f => !shown.includes(f));
  if (!others.length) { toast('Toutes les finitions sont déjà proposées'); return; }
  const body = html`<p class="cp-other-note">Ces finitions ne sont pas répertoriées pour cette carte. Ajoute-en une seulement si ton exemplaire existe ainsi.</p><div class="menu list">${others.map(f => html`<button type="button" class="row" data-add="${f}"><span class="lead"><i class="${DOT[f] || 'dot'}"></i></span><span class="body"><span class="t">${LABEL[f] || f}</span></span>${icon('plus', { cls: 'chev' })}</button>`)}</div>`;
  const sh = openSheet({ title: 'Autre finition', body });
  // écouteur sur le contenu neuf (le corps de la feuille est partagé et garde ses écouteurs) ; un seul choix
  let done = false;
  sh.el.querySelector('.menu')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-add]');
    if (!b || done || S !== s) return;
    done = true;
    const f = b.dataset.add, c = s.card;
    await sh.close();
    if (S !== s) return;
    const before = col.qtyOf(s.id, f);
    try { col.setQty(c, f, before + 1); } catch (err) { console.error(err); return; }
    s.extras.add(f);
    patch('own', s, ownHTML);
    preview(s, f);
    toast(`Ajoutée en ${LABEL[f] || f} · ${col.qtyOf(s.id)} au total`, { action: 'Annuler', onAction: () => col.setQty(c, f, before) });
  });
}

function priceInfo() {
  infoSheet('Cotes Cardmarket', [
    'La cote est la tendance Cardmarket de la finition choisie, toutes langues confondues. Moy. 7 j et Moy. 30 j : prix moyens des ventes ; Hier : moyenne des ventes de la veille ; Prix bas : l’offre la moins chère du moment.',
    'Une finition sans cote affiche « — » : ce n’est jamais le prix d’une autre finition. « Prix toutes éditions » : Cardmarket ne vend pas cette version à part, la cote est celle de la carte de base.',
    prices.creditText(),
  ]);
}

function zoom() {
  const c = S?.card;
  if (!c) return;
  openSheet({ title: c.name, wide: true, body: html`<div class="cp-zoom">${imgHTML(c, { q: 'high', eager: true, alt: c.name, cls: 'cp-zimg' })}</div>` });
}

// ---------- titre de la barre, effet de l'image ----------
function observe() {
  io?.disconnect();
  io = null;
  const name = el.querySelector('.cp-name');
  if (!name || typeof IntersectionObserver !== 'function') return;
  const top = document.getElementById('appbar')?.offsetHeight || 56;
  io = new IntersectionObserver(([e]) => {
    if (!S) return;
    revealTitle(!e.isIntersecting && e.boundingClientRect.top < top, barOpt(S));
  }, { rootMargin: `-${top}px 0px 0px 0px` });
  io.observe(name);
}

function bindHero() {
  unTilt?.();
  unTilt = bindTilt(el.querySelector('button.cp-card'), () => zoom());
}

function cleanup() {
  io?.disconnect(); io = null;
  unTilt?.(); unTilt = null;
}

// « Réessayer » (fiche en échec) : la route affichée, avec un signal vivant pour que la barre soit bien posée
function reload() {
  let r = lastR;
  if (!r || el.hidden) return;
  if (r.signal?.aborted) {
    retryCtl?.abort();
    retryCtl = new AbortController();
    r = { ...r, signal: retryCtl.signal };
  }
  view.show(r);
}

// ---------- états vides ----------
function notFound(s) {
  setBar({ title: 'Carte introuvable', back: true, signal: s.sig });
  setHTML(el, html`<div class="empty" data-content><span class="ic">${icon('alert')}</span><b>Carte introuvable</b><p>Cette carte n’est pas dans le catalogue de Cardex.</p><a class="btn" href="#/series" data-push>Chercher une carte</a></div>`);
}
function failed(s, e) {
  setBar({ title: 'Carte', back: true, signal: s.sig });
  const off = e?.kind === 'offline' || navigator.onLine === false;
  setHTML(el, html`<div class="empty" data-content><span class="ic">${icon(off ? 'wifi-off' : 'alert')}</span><b>Carte indisponible</b><p>${off ? 'Tu es hors ligne et cette carte n’est pas encore enregistrée sur l’appareil.' : `${MESSAGES[e?.kind] || 'Connexion impossible'}. Réessaie dans un instant.`}</p><button type="button" class="btn" data-reload>Réessayer</button></div>`);
}

// ---------- vue ----------
const view = {
  mount(section) {
    el = section;
    delegate(el, 'click', '[data-step]', (e, b) => step(b));
    delegate(el, 'click', 'button.cp-pv', (e, b) => preview(S, b.closest('[data-f]')?.dataset.f));
    delegate(el, 'click', '[data-info]', () => priceInfo());
    delegate(el, 'click', '[data-retry]', () => { if (S?.card) loadFull(S); });
    delegate(el, 'click', '[data-reload]', () => reload());
    delegate(el, 'click', '[data-new]', () => openAlert());
    delegate(el, 'click', '[data-edit]', (e, b) => openAlert(b.dataset.edit));
    delegate(el, 'click', '[data-del]', (e, b) => {
      const s = S, w = s?.wishes?.find(x => x.key === b.dataset.del);
      if (w) alerts.remove(w, () => loadWishes(s));
    });
    // lien vers la série d'où l'on vient : Retour plutôt qu'une nouvelle entrée (défilement de la série retrouvé)
    delegate(el, 'click', 'a[data-up]', (e, a) => {
      const path = h => String(h || '').split('?')[0];
      if (depth() > 0 && path(history.state?.from) === path(a.getAttribute('href'))) { e.preventDefault(); goBack(); }
    });
    // image haute qualité posée sur la basse une fois chargée ; en échec complet, la basse reste
    el.addEventListener('load', e => { if (e.target?.classList?.contains('cp-hi')) e.target.classList.add('on'); }, true);
    el.addEventListener('error', e => {
      const t = e.target;
      if (t?.classList?.contains('cp-spr-img')) {
        const tpl = document.createElement('template');
        tpl.innerHTML = String(icon('pokeball'));
        t.replaceWith(tpl.content.firstChild);
        return;
      }
      const hiPh = el.querySelector('.cp-img > .card-ph.cp-hi');
      if (hiPh && el.querySelector('.cp-img > img.cp-lo')) hiPh.remove();
    }, true);
    // alertes changées ailleurs (Envies, autre onglet, vérification des prix)
    try { window.WishDB?.on?.(() => { if (!S?.card) return; if (el.hidden) S.wishStale = true; else loadWishes(S); }); } catch { /* rien */ }
  },

  async show(r) {
    const { signal } = r;
    lastR = r;
    if (retryCtl && signal !== retryCtl.signal) { retryCtl.abort(); retryCtl = null; }
    cleanup();
    const id = cardId(r);
    const s = S = {
      id, sig: signal, card: null, full: null, fullState: 'wait', fullErr: null, loadingFull: false, meta: null, bloc: '', dex: [],
      fin: 'normal', extras: new Set(), wishes: null, wishErr: false, wishStale: false, pricesDone: false, en: EN.get(id) || '',
    };
    setBar({ title: 'Carte', back: true, titleHidden: true, signal });
    if (!ID_RE.test(id)) { notFound(s); return; }

    let c = catalog.cardSync(id), err = null;
    if (!c) {
      setHTML(el, skeletonHTML());
      try { c = await catalog.card(id); } catch (e) { err = e; }
      if (S !== s) return;
    }
    if (!c) { const rec = col.get(id); if (rec) c = { ...rec, finishes: [] }; }
    if (!c) {
      // série absente du catalogue statique et de TCGdex en série entière : la fiche seule
      try {
        const full = await tcgdex.card(id, { signal });
        if (S !== s) return;
        if (full?.id) {
          s.full = full; s.fullState = 'ok';
          c = { ...tcgdex.toBrief(full), setName: full.set?.name || '', setTotal: full.set?.cardCount?.official || 0 };
        }
      } catch (e) {
        if (S !== s || signal.aborted) return;
        if (!(e instanceof NetError && e.kind === 'notfound')) err ??= e;
      }
    }
    if (!c) { if (err) failed(s, err); else notFound(s); return; }

    s.card = { ...c, finishes: Array.isArray(c.finishes) ? c.finishes.filter(f => FINISHES.includes(f)) : [] };
    s.meta = catalog.metaSync(c.setId) || null;
    s.dex = dex.dexNums(c);
    s.pricesDone = prices.has(c.setId);
    const shown = shownOf(s), want = r.q.get('finition');
    s.fin = shown.includes(want) ? want : defaultFin(s, shown);

    const no = cardNo(c.localId, totalOf(s));
    setBar({
      title: c.name, subtitle: [setNameOf(s), no].filter(Boolean).join(' · '), back: true, titleHidden: true, signal,
      actions: [{ icon: 'bell', label: 'Alerte prix', onClick: () => openAlert() }],
      menu: [{ icon: 'plus', label: 'Ajouter une finition non répertoriée', onClick: otherFinish }],
    });
    setHTML(el, pageHTML(s));
    bindHero();
    observe();

    loadPrices(s);
    if (s.fullState !== 'ok') loadFull(s); else fetchEnName(s);
    loadContext(s);
    loadWishes(s);
  },

  // retour sur la fiche gardée en cache : on rebranche l'image et le titre, on reprend ce qui avait été interrompu
  resume(r) {
    lastR = r;                                     // Réessayer d'une fiche en échec repart de la route vivante
    const s = S;
    if (s) s.sig = r.signal;
    if (!s?.card) return;
    bindHero();
    observe();
    if (!s.full && s.fullState === 'wait') loadFull(s);
    if (!s.pricesDone) loadPrices(s);
    if (s.wishStale || !s.wishes) loadWishes(s);
    else updateBell(s);
  },

  hide() { cleanup(); retryCtl?.abort(); retryCtl = null; },

  onChange(events) {
    const s = S;
    if (!s?.card) return;
    const reload = events.some(e => e.type === 'reload');
    if (reload || events.some(e => e.type === 'qty' && e.id === s.id)) syncOwn(s, reload);
  },
};

export default view;
