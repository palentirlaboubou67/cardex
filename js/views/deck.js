// Page d'un deck (FINAL-design W-O) : cartes possédées / à acheter (par nom, toutes impressions confondues),
// prix du deck et du reste, ajout des manquantes aux envies (alerte 10 % sous l'offre la moins chère, comme la fiche carte),
// liste sur Limitless. Collection ou cotes changées : la page est corrigée en place (jamais refaite).
import { setBar } from '../core/appbar.js';
import { html, raw, setHTML, delegate } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { eur, num, plural, localNo } from '../core/format.js';
import { param, cardHref, back } from '../core/router.js';
import { MESSAGES } from '../core/net.js';
import { toast } from '../core/toast.js';
import * as decks from '../data/decks.js';
import * as prices from '../data/prices.js';
import * as catalog from '../data/catalog.js';
import * as col from '../state/collection.js';
import { artHTML, cardImgHTML, restText, stateIcon, infoDecks, footText, sleep } from './decks/ui.js';
import { suggestOf } from './carte/alert.js';

const GROUPS = [['pokemon', 'Pokémon'], ['trainer', 'Dresseurs'], ['energy', 'Énergies']];
// paintedId : deck dont les lignes sont à l'écran (pas le squelette) ; painted : état de collection et de cotes affiché
let el = null, deck = null, curId = '', sig = null, visible = false, painted = '', paintedId = '', frame = 0, wishSeq = 0, busy = false;

const keyNow = () => `${col.rev()}|${prices.version()}|${deck?.id}`;
const subtitle = d => [d.period.label, decks.placeLabel(d.placing)].filter(Boolean).join(' · ');
const openList = () => { if (deck?.list) window.open(deck.list, '_blank', 'noopener'); };

function bar(d) {
  setBar({
    title: d?.name || 'Deck', subtitle: d ? subtitle(d) : '', back: true, signal: sig,
    menu: d ? [
      ...(d.list ? [{ icon: 'external', label: 'Liste sur Limitless', onClick: openList }] : []),
      { icon: 'info', label: 'À propos des decks', onClick: () => infoDecks() },
    ] : [],
  });
}

// ---------- en-tête ----------
function moneyHTML(st) {
  return html`Deck <b>${eur(st.value)}</b>${st.ready ? '' : html` · ${st.missing > 0 ? html`reste ≈ <b>${eur(st.missing)}</b>` : restText(st)}`}`;
}

const pcOf = st => Math.round(st.pct * 1000) / 10;
const heroHTML = st => html`<b>${st.have} / ${st.total}</b> cartes`;
const pcHTML = st => (st.ready ? html`${icon('check')}Prêt à jouer` : `${Math.floor(pcOf(st))} %`);

function headHTML(st) {
  const meta = [decks.shareLabel(deck.share), deck.event].filter(Boolean).join(' · ');
  return html`<div class="dk-head">${artHTML(deck, 'lg')}<div class="dk-sum">
    <p class="dk-hero num">${heroHTML(st)}</p>
    <div class="prog${st.ready ? ' done' : ''}"><span class="progress wide${st.ready ? ' done' : ''}"><i style="width:${pcOf(st)}%"></i></span><span class="pc">${pcHTML(st)}</span></div>
    <p class="dk-money num">${moneyHTML(st)}</p>
    ${meta ? html`<p class="dk-meta">${meta}</p>` : ''}
    ${deck.list ? html`<a class="btn text sm dk-ll" href="${deck.list}" target="_blank" rel="noopener">Liste sur Limitless${icon('external')}</a>` : ''}
  </div></div>
  ${wishActs(st)}`;
}

// bouton des envies posé tout de suite (pas de saut de mise en page) ; son état exact arrive avec la base des envies
function wishActs(st) {
  const on = !!W() && decks.toBuy(st).length > 0;
  return html`<div class="btns dk-acts"${on ? '' : raw(' hidden')}><span class="dk-wish">${on ? addBtn() : ''}</span></div>`;
}
const addBtn = () => html`<button type="button" class="btn" data-wish${busy ? raw(' disabled') : ''}>${icon('bell')}Ajouter les manquantes aux envies</button>`;

// ---------- lignes de cartes ----------
const stateOf = r => (r.got >= r.c.count ? 'ok' : r.got ? 'part' : 'buy');

function subOf(c) {
  if (c.basic) return 'Comptée comme possédée';
  if (c.id && decks.linked(c)) {
    const m = catalog.metaSync(catalog.setIdOf(c.id));
    if (m) return `${m.name} · ${localNo(catalog.localIdOf(c.id))}`;
  }
  return c.ref;
}

function labelOf(r, sub) {
  const { c, got } = r, state = stateOf(r);
  const what = state === 'ok' ? (c.basic ? 'comptée comme possédée' : 'tu l’as') : state === 'part' ? `${got} sur ${c.count}, en partie` : 'à acheter';
  return `${c.count} × ${c.name}, ${sub}, ${what}, ${r.price == null ? 'sans cote' : eur(r.price)}`;
}

const stHTML = (r, state) => html`${stateIcon(state)}<span class="num">${r.got}/${r.c.count}</span>`;

function cardRow(r, i) {
  const { c } = r;
  const state = stateOf(r);
  const sub = subOf(c);
  const inner = html`<span class="thumb">${cardImgHTML(c)}</span><span class="dkc-n num">${c.count}×</span><span class="body"><span class="t">${c.name}</span><span class="s"><span>${sub}</span></span></span><span class="end"><span class="dkc-st ${state}">${stHTML(r, state)}</span><span class="price dkc-p">${eur(r.price)}</span></span>`;
  if (!decks.linked(c)) return html`<div class="row dkc" data-i="${i}">${inner}</div>`;
  return html`<a class="row dkc" data-i="${i}" href="${cardHref(c.id)}" aria-label="${labelOf(r, sub)}">${inner}</a>`;
}

// cartes d'un groupe (Pokémon, Dresseurs, Énergies) : nombre et possédées
function groupOf(st, type) {
  const rows = st.rows.map((r, i) => [r, i]).filter(([r]) => r.c.type === type);
  return { rows, n: rows.reduce((a, [r]) => a + r.c.count, 0), got: rows.reduce((a, [r]) => a + r.got, 0) };
}
const gownHTML = (got, n) => html`${got === n ? icon('check') : ''}${got} / ${n}`;

function groupsHTML(st) {
  return GROUPS.map(([type, label]) => {
    const { rows, n, got } = groupOf(st, type);
    if (!rows.length) return '';
    return html`<section class="dk-grp" data-type="${type}" aria-labelledby="dk-g-${type}"><h2 class="sect" id="dk-g-${type}"><span class="grow">${label} · ${n}</span><span class="num dk-gown">${gownHTML(got, n)}</span></h2><div class="group">${rows.map(([r, i]) => cardRow(r, i))}</div></section>`;
  });
}

function render() {
  const st = decks.status(deck);
  const focusI = document.activeElement?.closest?.('.dkc')?.dataset.i;
  setHTML(el, html`<div class="dk-page"><div class="dk-side">${headHTML(st)}</div><div class="dk-main">${groupsHTML(st)}<p class="caption dk-foot">${footText()}</p></div></div>`);
  if (focusI != null) el.querySelector(`.dkc[data-i="${focusI}"]`)?.focus({ preventScroll: true });
  painted = keyNow();
  paintedId = deck.id;
  wishButton();
}

const setText = (e, v) => { if (e && e.textContent !== v) e.textContent = v; };
const setH = (e, safe) => { if (e) setHTML(e, safe); };

// Collection modifiée ou cotes arrivées : lignes (état, possédées, prix, libellé), totaux des groupes, résumé
// (cartes, progression, prix) et bouton des envies corrigés en place ; les images et le focus ne bougent pas.
function patch() {
  const st = decks.status(deck);
  for (const row of el.querySelectorAll('.dkc[data-i]')) {
    const r = st.rows[+row.dataset.i];
    if (!r) continue;
    const state = stateOf(r), s = row.querySelector('.dkc-st');
    if (s && (!s.classList.contains(state) || s.querySelector('.num')?.textContent !== `${r.got}/${r.c.count}`)) {
      s.className = `dkc-st ${state}`;
      setHTML(s, stHTML(r, state));
    }
    setText(row.querySelector('.dkc-p'), eur(r.price));
    if (row.tagName === 'A') {
      const label = labelOf(r, subOf(r.c));
      if (row.getAttribute('aria-label') !== label) row.setAttribute('aria-label', label);
    }
  }
  for (const g of el.querySelectorAll('.dk-grp[data-type]')) {
    const { n, got } = groupOf(st, g.dataset.type);
    const own = g.querySelector('.dk-gown');
    if (own && own.textContent !== `${got} / ${n}`) setHTML(own, gownHTML(got, n));
  }
  const sum = el.querySelector('.dk-sum');
  if (sum) {
    const hero = sum.querySelector('.dk-hero');
    if (hero && hero.textContent !== `${st.have} / ${st.total} cartes`) setHTML(hero, heroHTML(st));
    sum.querySelector('.prog')?.classList.toggle('done', st.ready);
    sum.querySelector('.prog .progress')?.classList.toggle('done', st.ready);
    const bar = sum.querySelector('.prog .progress > i');
    if (bar) bar.style.width = `${pcOf(st)}%`;
    setH(sum.querySelector('.prog .pc'), pcHTML(st));
    setH(sum.querySelector('.dk-money'), moneyHTML(st));
  }
  setText(el.querySelector('.dk-foot'), footText());
  painted = keyNow();
  wishButton();
}

// cotes arrivées ou collection modifiée : une mise à jour en place à l'image suivante, si la page est à l'écran
function schedule() {
  if (!visible || !deck || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (visible && deck && paintedId === deck.id && painted !== keyNow()) patch();
  });
}

// ---------- envies ----------
const W = () => window.WishDB || null;

// bouton « Ajouter les manquantes aux envies », ou « Dans tes envies » quand elles y sont toutes
async function wishButton() {
  const box = el.querySelector('.dk-wish');
  if (!box) return;
  const my = ++wishSeq;
  const todo = decks.toBuy(decks.status(deck));
  const acts = box.closest('.dk-acts');
  if (!todo.length || !W()) { box.textContent = ''; if (acts) acts.hidden = true; return; }
  let have = null;
  try { have = new Set((await W().all()).map(w => w.id)); } catch { have = null; }
  if (my !== wishSeq || !box.isConnected) return;
  const left = have ? todo.filter(r => !have.has(r.c.id)).length : todo.length;
  const focused = box.contains(document.activeElement);
  if (left && box.querySelector('[data-wish]')) { box.querySelector('[data-wish]').disabled = busy; }
  else setHTML(box, left ? addBtn() : html`<a class="btn" href="#/marche/envies" data-push>${icon('check')}Manquantes dans tes envies</a>`);
  if (focused && !box.contains(document.activeElement)) box.querySelector('.btn')?.focus({ preventScroll: true });
  if (acts) acts.hidden = false;
}

// prix max proposé : même règle que l'alerte de la fiche carte (10 % sous l'offre la moins chère du moment, ou sous
// la cote si elle est plus basse) : l'envie ne naît pas déjà « dans ta fourchette », elle prévient quand ça baisse
const maxOf = best => suggestOf(best) ?? 0.01;

// une envie par carte manquante (finition jouable la moins chère), sous l'offre la moins chère : prévenu dès qu'une
// offre passe à ce prix ou moins. Celles déjà dans la fourchette (rare : cote sans offre connue) sont comptées dans le
// message. « Annuler » retire les envies ajoutées.
async function addMissing() {
  const db = W();
  if (!db || busy || !deck) return;
  busy = true;
  el.querySelector('[data-wish]')?.setAttribute('disabled', '');
  const d = deck;
  try {
    const todo = decks.toBuy(decks.status(d));
    let have;
    try { have = new Set((await db.all()).map(w => w.id)); } catch {
      toast('Tes envies ne sont pas accessibles dans ce navigateur');
      return;
    }
    const list = todo.filter(r => !have.has(r.c.id));
    if (!list.length) { toast('Ces cartes sont déjà dans tes envies'); return; }
    const sets = [...new Set(list.map(r => catalog.setIdOf(r.c.id)))];
    await Promise.all([catalog.loadSets(sets).catch(() => {}), prices.ensure(sets)]);
    const added = [];
    let noPrice = 0, inRange = 0;
    for (const r of list) {
      const card = catalog.cardSync(r.c.id) || { ...decks.brief(r.c), finishes: ['normal'] };
      const fins = card.finishes?.length ? card.finishes : ['normal'];
      let best = null;
      for (const f of fins) {
        if (!decks.PLAY_FINISHES.includes(f)) continue;
        const p = prices.get(r.c.id, f);
        if (p?.eur != null && (!best || p.eur < best.eur)) best = { f, eur: p.eur, low: p.low, trend: p.trend };
      }
      if (!best && r.c.price != null) best = { f: fins.includes('normal') ? 'normal' : fins[0], eur: r.c.price, low: null };
      if (!best) { noPrice++; continue; }
      const meta = catalog.metaSync(card.setId);
      const w = db.make({ ...card, setName: card.setName || meta?.name || '', setTotal: card.setTotal || meta?.total || null },
        best.f, { min: 0, max: maxOf(best) });
      if (r.c.en && !w.en) w.en = r.c.en;                  // nom anglais : lien Cardmarket d'Envies sans requête
      // comme la fiche carte : offre la moins chère connue tout de suite (dans la fourchette ou non, dit dans le message)
      db.update(w, { low: best.low ?? null, trend: best.trend ?? best.eur });
      try { await db.put(w); added.push(w.key); if (w.inRange) inRange++; } catch { /* base indisponible : carte ignorée */ }
    }
    if (!added.length) {
      toast(noPrice ? 'Pas de cote connue pour ces cartes : aucune alerte possible' : 'Tes envies ne sont pas accessibles dans ce navigateur');
      return;
    }
    // alertes déjà dans la fourchette (une offre est déjà à ce prix) : dites tout de suite, comme sur la fiche carte
    const range = !inRange ? '' : inRange < added.length ? `, dont ${num(inRange)} déjà dans ta fourchette`
      : added.length > 1 ? ', toutes déjà dans ta fourchette' : ', déjà dans ta fourchette';
    const extra = range + (noPrice ? ` · ${plural(noPrice, 'carte sans cote', 'cartes sans cote')}` : '');
    toast(`${plural(added.length, 'carte ajoutée', 'cartes ajoutées')} à tes envies${extra}`, {
      action: 'Annuler',
      onAction: async () => {
        for (const k of added) { try { await db.del(k); } catch { /* déjà retirée */ } }
        toast('Envies retirées');
      },
    });
    // comme l'ancienne appli : la permission des notifications est demandée après le premier ajout
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') db.enableAlerts?.().catch(() => {});
  } finally {
    busy = false;
    if (deck) wishButton();
  }
}

// ---------- états ----------
const SK_ROW = '<span class="row sk-row"><span class="sk-a"></span><span class="body"><span class="sk-t"></span><span class="sk-s"></span></span></span>';
const skeleton = () => `<div class="dk-page" aria-busy="true" aria-label="Chargement"><div class="dk-side"><div class="dk-head"><span class="dk-art lg dk-sk-art"></span><div class="dk-sum"><span class="sk-t"></span><span class="sk-s"></span></div></div></div><div class="dk-main"><div class="sect"><span class="sk-s"></span></div><div class="group">${SK_ROW.repeat(6)}</div></div></div>`;

function errorHTML(e) {
  return html`<div class="empty" data-content><span class="ic">${icon(e?.kind === 'offline' ? 'wifi-off' : 'alert')}</span><b>Deck indisponible</b><p>${MESSAGES[e?.kind] || 'La liste n’a pas pu être chargée'}. Vérifie ta connexion, puis réessaie.</p><button type="button" class="btn" data-retry>Réessayer</button></div>`;
}
const missingHTML = () => html`<div class="empty" data-content><span class="ic">${icon('decks')}</span><b>Ce deck n’est plus dans la liste</b><p>Les listes suivent la méta et changent chaque semaine.</p><button type="button" class="btn" data-back>Voir les decks</button></div>`;

// toutes les cotes du deck sont chargées : rendu immédiat ; sinon squelette, et le rendu les attend un court instant
const pricesIn = d => decks.setsOf(d).every(s => prices.has(s));

async function fill(id, signal) {
  curId = id;
  deck = decks.deckSync(id);
  if (deck && pricesIn(deck)) { bar(deck); render(); return; }
  paintedId = '';
  el.innerHTML = skeleton();
  try { await decks.load(); } catch (e) {
    if (signal?.aborted) return;
    deck = null;
    setHTML(el, errorHTML(e));
    return;
  }
  if (signal?.aborted) return;
  deck = decks.deckSync(id);
  bar(deck);
  if (!deck) { setHTML(el, missingHTML()); return; }
  await Promise.race([decks.ensurePrices(deck), sleep(500)]);
  if (signal?.aborted) return;
  render();
}

export default {
  mount(section) {
    el = section;
    delegate(el, 'click', '[data-wish]', () => { addMissing(); });
    delegate(el, 'click', '[data-retry]', () => { fill(curId, sig); });
    delegate(el, 'click', '[data-back]', () => back());
    prices.on(() => schedule());
    W()?.on?.(() => { if (visible && deck && paintedId === deck.id) wishButton(); });
  },

  async show(r) {
    sig = r.signal;
    visible = true;
    const id = param(r);
    bar(decks.deckSync(id));
    await fill(id, r.signal);
  },

  // retour sur la page gardée : corrigée en place si la collection ou les cotes ont changé entre-temps
  resume(r) {
    visible = true;
    sig = r?.signal || sig;
    if (!deck || paintedId !== deck.id) return;
    if (painted !== keyNow()) patch(); else wishButton();
  },

  hide() {
    visible = false;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
  },

  // collection modifiée : possédées / à acheter corrigées en place (à l'écran tout de suite, sinon au retour)
  onChange(events) {
    if (events?.some?.(e => e.type === 'qty' || e.type === 'reload') ?? true) schedule();
  },
};
