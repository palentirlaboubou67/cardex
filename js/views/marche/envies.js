// Marché › Envies (W-T) : alertes de prix (js/state/wishes.js, IndexedDB partagée avec le service worker), état des
// notifications avec la demande de permission, vérification des prix, lien Cardmarket et suppression (Annuler).
import { html, setHTML, delegate } from '../../core/dom.js';
import { eur, dateShort, timeFr, plural, cardNo } from '../../core/format.js';
import { icon } from '../../core/icons.js';
import { cardHref } from '../../core/router.js';
import { infoSheet } from '../../core/sheet.js';
import { toast } from '../../core/toast.js';
import { setProgress, updateAction } from '../../core/appbar.js';
import { imgHTML } from '../../data/images.js';
import { LABEL, DOT } from '../../data/finishes.js';
import { metaSync } from '../../data/catalog.js';
import { gql } from '../../data/tcgdex.js';
import { whenIdle } from '../../core/idle.js';

const W = () => window.WishDB || null;
let box = null, ctx = null, visible = false, dirty = true, list = [], status = null, checking = false, inRange = false;
let focusAt = null;          // après une suppression au clavier : le focus va à la ligne suivante

// « Voir sur Cardmarket » : recherche par le nom anglais (SPEC §8) ; le nom français tant qu'il n'est pas connu
const EN = new Map(), tried = new Set();       // id -> nom anglais, pour la session
const enOf = w => (typeof w.en === 'string' && w.en) || EN.get(w.id) || '';
const cmUrl = w => `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(enOf(w) || w.name || '')}`;
// « ≤ 6,00 € » quand le minimum est 0, sinon « 2,00–6,00 € »
const range = w => { const lo = Number(w.min) || 0, hi = Number(w.max); return lo > 0 ? `${eur(lo).replace(/\s€$/, '')}–${eur(hi)}` : `≤ ${eur(hi)}`; };

// ---------- notifications ----------
const NOTIF = {
  unsupported: { t: 'Notifications indisponibles ici', s: 'Les envies dans ta fourchette s’affichent en vert ici',
    info: ['Ce navigateur ne peut pas afficher de notifications pour Cardex.', 'Sur iPhone et iPad, ajoute d’abord Cardex à l’écran d’accueil (Partager, puis « Sur l’écran d’accueil »), puis ouvre l’appli depuis son icône.', 'En attendant, les cartes dans ta fourchette s’affichent en vert ici et l’onglet Marché porte un point.'] },
  default: { t: 'Notifications désactivées', s: 'Sois prévenu quand une carte entre dans ta fourchette',
    info: ['Choisis une carte, fixe une fourchette de prix depuis sa fiche, et Cardex te prévient quand elle est en vente dans ta fourchette sur Cardmarket.'] },
  denied: { t: 'Notifications bloquées', s: 'Réautorise-les dans les réglages du navigateur',
    info: ['Les notifications de Cardex sont bloquées par ton navigateur. Réautorise-les dans ses réglages (site, puis Notifications).', 'En attendant, les cartes dans ta fourchette s’affichent en vert ici et l’onglet Marché porte un point.'] },
  bg: { t: 'Notifications activées', s: 'Prix vérifiés environ toutes les 12 h',
    info: ['Les prix sont vérifiés en arrière-plan environ toutes les 12 h, et à chaque ouverture de l’appli.', 'Tu es prévenu quand l’offre la moins chère d’une envie entre dans ta fourchette (une seule fois, à l’entrée).'] },
  open: { t: 'Notifications activées', s: 'Prix vérifiés à chaque ouverture de l’appli',
    info: ['Les prix sont vérifiés à chaque ouverture de l’appli. La vérification en arrière-plan demande Chrome sur Android, avec Cardex installé sur l’écran d’accueil.', 'Tu es prévenu quand l’offre la moins chère d’une envie entre dans ta fourchette (une seule fois, à l’entrée).'] },
};
const notifKey = s => (!s ? 'default' : s.perm === 'granted' ? (s.background ? 'bg' : 'open') : NOTIF[s.perm] ? s.perm : 'unsupported');

function notifHTML() {
  const k = notifKey(status);
  const n = NOTIF[k];
  const on = k === 'bg' || k === 'open';
  return html`<div class="group mk-notif"><div class="row"><span class="lead${on ? ' on' : ''}">${icon(on ? 'bell-ring' : 'bell')}</span><span class="body"><span class="t">${n.t}</span><span class="s"><span>${n.s}</span></span></span>${
    k === 'default' ? html`<span class="end"><button type="button" class="btn primary sm" data-enable>Activer</button></span>` : ''}<button type="button" class="ibtn sm mk-ninfo" data-ninfo aria-label="En savoir plus sur les notifications">${icon('info')}</button></div></div>`;
}

// ---------- lignes ----------
function wishHTML(w) {
  const card = { id: w.id, localId: w.localId, setId: w.setId, name: w.name, image: w.image || '', setTotal: w.setTotal };
  const total = w.setTotal || metaSync(w.setId)?.total || 0;
  const no = cardNo(w.localId, total);
  const fin = LABEL[w.variant] || w.variant || 'Normale';
  const status = w.inRange
    ? html`<span class="mk-ok">${icon('check', { size: 14 })}<span>Dans ta fourchette · ${range(w)}</span></span>`
    : html`<span>Voulu ${range(w)} · ${w.low == null ? (w.checkedAt ? 'prix inconnu' : 'pas encore vérifié') : 'pas encore'}</span>`;
  const label = [w.name, w.setName, no, fin, w.low != null ? `dès ${eur(w.low)}` : 'prix inconnu', w.inRange ? 'dans ta fourchette' : `voulu ${range(w)}`].filter(Boolean).join(', ');
  return html`<div class="row mk-wrow${w.inRange ? ' ok' : ''}" data-key="${w.key}"><a class="mk-wlink" href="${cardHref(w.id, w.variant && w.variant !== 'normal' ? w.variant : null)}" aria-label="${label}"><span class="thumb">${imgHTML(card, { q: 'low' })}</span><span class="body"><span class="t">${w.name}</span><span class="s"><span>${[w.setName, no].filter(Boolean).join(' · ')}</span><span class="mk-fin"><i class="${DOT[w.variant] || 'fd'}" aria-hidden="true"></i>${fin}</span></span><span class="s mk-wst">${status}</span></span></a><span class="end mk-wend"><span class="price">${w.low != null ? eur(w.low) : '—'}</span><span class="mk-wacts"><a class="ibtn sm" href="${cmUrl(w)}" data-cm="${w.key}" target="_blank" rel="noopener" aria-label="Voir ${w.name} sur Cardmarket">${icon('external')}</a><button type="button" class="ibtn sm" data-del="${w.key}" aria-label="Retirer ${w.name} de tes envies">${icon('trash')}</button></span></span></div>`;
}

function headHTML() {
  const n = list.filter(w => w.inRange).length;
  const last = Math.max(0, ...list.map(w => w.checkedAt || 0));
  const when = last ? `vérifié le ${dateShort(last)} à ${timeFr(last)}` : 'pas encore vérifié';
  return html`<div class="sect mk-whead"><span class="grow" aria-live="polite">${checking ? 'Vérification des prix…' : `${n ? `${plural(n, 'envie', 'envies')} dans ta fourchette` : 'Aucune envie dans ta fourchette'} · ${when}`}</span><button type="button" class="link" data-check${checking ? ' disabled' : ''}>Vérifier</button></div>`;
}

function render() {
  dirty = false;
  if (!W()) {
    setHTML(box, html`<div class="empty" data-content><span class="ic">${icon('alert')}</span><b>Envies indisponibles</b><p>Ce navigateur ne permet pas d’enregistrer des alertes de prix (stockage IndexedDB bloqué).</p></div>`);
    return;
  }
  const sorted = list.slice().sort((a, b) => (b.inRange - a.inRange) || ((b.createdAt || 0) - (a.createdAt || 0)));
  const body = sorted.length
    ? html`${headHTML()}<div class="group mk-list mk-wlist">${sorted.map(wishHTML)}</div><p class="caption mk-credit">Prix : offre la moins chère en vente sur Cardmarket, toutes langues et états.</p>`
    : html`<div class="empty"><span class="ic">${icon('bell')}</span><b>Aucune envie pour l’instant</b><p>Ouvre une carte (scan, recherche ou série) et crée une alerte prix depuis sa fiche.</p><a class="btn" href="#/series">Parcourir les séries</a></div>`;
  setHTML(box, html`<div class="mk-nbox" data-content>${notifHTML()}</div>${body}`);
  fetchEn();
  if (focusAt != null) {
    const dels = box.querySelectorAll('[data-del]');
    (dels[Math.min(focusAt, dels.length - 1)] || box.querySelector('.mk-nbox button, .empty a'))?.focus({ preventScroll: true });
    focusAt = null;
  }
}

// noms anglais des envies : une seule requête GraphQL groupée (alias), au repos, une fois par carte et par session
function fetchEn() {
  const ids = [...new Set(list.filter(w => w.id && !enOf(w) && !tried.has(w.id)).map(w => w.id))].slice(0, 60);
  if (!ids.length || navigator.onLine === false) return;
  for (const id of ids) tried.add(id);
  whenIdle(async () => {
    try {
      const d = await gql(`{ ${ids.map((id, i) => `c${i}: card(id: ${JSON.stringify(String(id))}) { name }`).join(' ')} }`, { timeout: 10000 });
      ids.forEach((id, i) => { const n = d?.[`c${i}`]?.name; if (typeof n === 'string' && n && n.length <= 120) EN.set(id, n); });
    } catch { return; }                       // recherche avec le nom français
    for (const a of box.querySelectorAll('a[data-cm]')) {
      const w = list.find(x => x.key === a.dataset.cm);
      if (w) a.href = cmUrl(w);
    }
  });
}

async function reload() {
  const D = W();
  if (!D) { list = []; return; }
  try { list = (await D.all()) || []; } catch { list = []; }
  try { status = await D.alertStatus?.(); } catch { status = null; }
  inRange = list.some(w => w.inRange);
}

// barre d'app : progression et ↻ désactivé pendant la vérification
function busyBar() {
  const signal = ctx.signal();
  setProgress(checking, { signal });
  updateAction(0, { disabled: checking }, { signal });
}

async function check() {
  const D = W();
  if (!D || checking) return;
  if (!list.length) { toast('Aucune envie à vérifier'); return; }
  checking = true;
  busyBar();
  if (visible) render();                      // « Vérification des prix… »
  let hits = [];
  try {
    hits = (await D.check()) || [];
  } catch {
    toast(navigator.onLine === false ? 'Hors ligne : vérification impossible' : 'Vérification impossible pour l’instant');
  }
  checking = false;
  busyBar();                                  // signal du dernier affichage du Marché (ignoré si la vue a été quittée)
  await reload();
  if (visible) render();
  ctx.refreshTabs();
  if (hits.length) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { const reg = await navigator.serviceWorker?.getRegistration?.(); if (reg) await D.notify(reg, hits); } catch { /* pas de service worker */ }
    }
    toast(hits.length === 1 ? `${hits[0].name} est dans ta fourchette` : `${plural(hits.length, 'carte', 'cartes')} dans ta fourchette`);
  } else if (navigator.onLine === false) toast('Hors ligne : prix gardés de la dernière vérification');
  else toast('Prix à jour');
}

const api = {
  mount(el, c) {
    box = el;
    ctx = c;
    delegate(box, 'click', '[data-enable]', async () => {
      const D = W();
      if (!D?.enableAlerts) return;
      try { status = await D.enableAlerts(); } catch { /* refus */ }
      if (status?.perm === 'granted') toast('Notifications activées');
      else if (status?.perm === 'denied') toast('Notifications refusées');
      render();
    });
    delegate(box, 'click', '[data-ninfo]', () => { const n = NOTIF[notifKey(status)]; infoSheet(n.t, n.info); });
    delegate(box, 'click', '[data-check]', () => check());
    delegate(box, 'click', '[data-del]', async (e, b) => {
      const D = W();
      const w = list.find(x => x.key === b.dataset.del);
      if (!D || !w) return;
      if (b.contains(document.activeElement) || document.activeElement === b) focusAt = [...box.querySelectorAll('[data-del]')].indexOf(b);
      try { await D.del(w.key); } catch { focusAt = null; toast('Suppression impossible'); return; }
      toast('Envie retirée', { action: 'Annuler', onAction: async () => { try { await D.put(w); } catch { toast('Impossible de la remettre'); } } });
    });
    // permission changée dans les réglages du navigateur pendant que l'appli est ouverte
    try {
      navigator.permissions?.query({ name: 'notifications' }).then(st => {
        st.addEventListener('change', async () => { try { status = await W()?.alertStatus?.(); } catch {} if (visible && !checking) render(); });
      }, () => {});
    } catch { /* API absente */ }
    // envie ajoutée, retirée ou vérifiée (cette page, un autre onglet ou le service worker)
    W()?.on?.(async () => {
      if (!visible) { dirty = true; const D = W(); try { inRange = ((await D.all()) || []).some(w => w.inRange); } catch {} return; }
      await reload();
      if (visible && !checking) render();
      ctx.refreshTabs();
    });
  },
  async show() {
    visible = true;
    if (checking) busyBar();
    if (!box.firstChild) setHTML(box, html`<div class="group" data-content aria-busy="true">${Array.from({ length: 4 }, () => html`<span class="row sk-row"><span class="sk-a"></span><span class="body"><span class="sk-t"></span><span class="sk-s"></span></span></span>`)}</div>`);
    await reload();
    render();
    ctx.refreshTabs();
  },
  async resume() {
    visible = true;
    busyBar();                                  // la barre remise par main.js peut dater d'une vérification en cours
    if (dirty) { await reload(); render(); ctx.refreshTabs(); }
  },
  hide() { visible = false; },
  actions: () => [{ icon: 'refresh', label: 'Vérifier les prix', disabled: checking, onClick: () => check() }],
  info: () => ({
    title: 'Envies',
    body: ['Les cartes que tu veux acheter, avec le prix que tu es prêt à payer. Crée une alerte depuis la fiche d’une carte.',
      'Cardex compare l’offre la moins chère en vente sur Cardmarket (toutes langues et états) à ta fourchette, à chaque ouverture de l’appli et en arrière-plan quand c’est possible.',
      'Une envie dans ta fourchette s’affiche en vert, et l’onglet Marché porte un point.'],
  }),
  anyInRange: () => inRange,
};
export default api;
