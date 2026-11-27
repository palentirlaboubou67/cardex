// Fiche d'un produit scellé (W-U) : photo, nom français et Cardmarket, cote (tendance) et « dès … », courbe de notre
// historique avec plages 7 j · 30 j · 3 mois · 1 an · Tout et lecture au doigt, dernière variation (ou « prix inchangé
// depuis … »), premier prix et plus haut, Mon scellé (quantité, prix d'achat), suivre ☆, lien Cardmarket.
import { setBar, updateAction } from '../core/appbar.js';
import { html, setHTML, delegate } from '../core/dom.js';
import { eur, eurDelta, pct, dateDay, toDate, plural } from '../core/format.js';
import { icon } from '../core/icons.js';
import { param, setParams, setHref } from '../core/router.js';
import { openSheet } from '../core/sheet.js';
import { toast } from '../core/toast.js';
import { MESSAGES } from '../core/net.js';
import { lineChart, deltaHTML } from '../components/chart.js';
import * as col from '../state/collection.js';
import * as sealed from '../data/sealed.js';
import { pimgHTML, ready as ptileReady, blocOf, inCatalog, stillText, relText, dayText } from './ptile.js';

const RANGES = ['7j', '30j', '3m', '1a', 'tout'];
const RKEY = { '7j': 'c7', '30j': 'c30', '3m': 'c90', '1a': 'c365', tout: null };
const RDAYS = { '7j': 7, '30j': 30, '3m': 92, '1a': 366, tout: Infinity };   // mêmes plages que chart.js
const DAY = 86400000;
let el = null, p = null, pts = null, chart = null, range = 'tout', sig = null, histFail = false;

const monthYear = d => toDate(d).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
const x2 = v => v.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const sign = v => (v > 0.004 ? 'up' : v < -0.004 ? 'down' : 'flat');
const cents = v => (v == null ? '' : x2(Math.round(v * 100) / 100).replace(/\s/g, ''));

// ---------- barre d'app ----------
const starAction = () => {
  const on = !!p && col.watching(p.id);
  return { icon: on ? 'star-fill' : 'star', label: on ? 'Ne plus suivre ce produit' : 'Suivre ce produit', pressed: on, onClick: toggleWatch };
};
function bar() {
  const { type } = sealed.split(p);
  setBar({
    title: type, subtitle: [p.set, sealed.isJa(p) ? 'Japonais' : ''].filter(Boolean).join(' · '), back: true, signal: sig,
    actions: [starAction()],
    menu: [{ icon: 'external', label: 'Voir sur Cardmarket', onClick: () => window.open(sealed.cmUrl(p), '_blank', 'noopener') }],
  });
}
function toggleWatch() {
  if (!p) return;
  const on = col.toggleWatch(p.id);
  updateAction(0, starAction(), { signal: sig });
  toast(on ? 'Produit suivi : il apparaît en tête des pistes' : 'Tu ne suis plus ce produit');
}

// ---------- contenu ----------
function kvHTML() {
  const cell = (k, label) => {
    const still = sealed.stillSince(p, sealed.DAYS[k]);
    return html`<div><small>${label}</small>${p.eur != null && still ? html`<b class="mk-flat">inchangé</b>` : p[k] != null ? deltaHTML(p[k]) : html`<b>—</b>`}</div>`;
  };
  return html`<div class="kv mk-pkv">${cell('c7', '7 jours')}${cell('c30', '30 jours')}${cell('c90', '3 mois')}${cell('c365', '1 an')}</div>`;
}

function ownHTML() {
  const o = col.sealedGet(p.id);
  if (!o) {
    return html`<button type="button" class="row mk-addown" data-own><span class="lead">${icon('plus')}</span><span class="body"><span class="t">Ajouter à mon scellé</span><span class="s"><span>Quantité et prix d’achat</span></span></span></button>`;
  }
  const value = p.eur != null ? p.eur * o.qty : null;
  const gain = p.eur != null && o.cost != null ? (p.eur - o.cost) * o.qty : null;
  const t = o.cost != null ? `${o.qty} × acheté ${eur(o.cost)}` : `${plural(o.qty, 'exemplaire', 'exemplaires')} · prix d’achat non renseigné`;
  const s = [value != null ? `Valeur ${eur(value)}` : 'Pas de vente récente', o.at ? `depuis le ${dayText(o.at)}` : ''].filter(Boolean).join(' · ');
  const y = gain != null && o.cost ? pct(((p.eur - o.cost) / o.cost) * 100) : '';
  return html`<button type="button" class="row" data-own aria-label="Modifier mon scellé : ${t}, ${s}${gain != null ? `, plus-value ${eurDelta(gain)}` : ''}${y ? `, rendement ${y}` : ''}"><span class="lead">${icon('box')}</span><span class="body"><span class="t">${t}</span><span class="s"><span>${s}</span></span></span><span class="end">${
    gain != null ? html`<span class="mk-gain ${sign(gain)}">${eurDelta(gain)}</span>${y ? html`<span class="mk-gain-p">${y}</span>` : ''}` : ''}</span>${icon('chevron-right', { cls: 'chev' })}</button>`;
}

function render() {
  const bloc = blocOf(p.sid);
  const meta = [bloc || (p.set && !p.fr.includes(p.set) ? p.set : ''), relText(p), sealed.isJa(p) ? 'produit japonais' : ''].filter(Boolean).join(' · ');
  const m = sealed.mult(p);
  const stats = [p.first ? `Premier prix ${eur(p.first)}${p.since ? ` (${monthYear(p.since)})` : ''}` : '', m ? `×${x2(m)}` : '', p.max ? `Plus haut ${eur(p.max)}` : ''].filter(Boolean).join(' · ');
  const links = [html`<a class="row" href="${sealed.cmUrl(p)}" target="_blank" rel="noopener"><span class="lead">${icon('external')}</span><span class="body"><span class="t">Voir sur Cardmarket</span><span class="s"><span>${p.n || p.fr}</span></span></span></a>`];
  if (inCatalog(p.sid)) links.push(html`<a class="row" href="${setHref(p.sid)}"><span class="lead">${icon('series')}</span><span class="body"><span class="t">Voir la série</span><span class="s"><span>${p.set}</span></span></span>${icon('chevron-right', { cls: 'chev' })}</a>`);
  setHTML(el, html`<div class="mk-pgrid">
<div class="mk-pside"><div class="mk-pimg">${pimgHTML(p, { big: true, eager: true })}</div></div>
<div class="mk-pmain">
<div class="mk-phead" data-content><h2 class="mk-ptitle">${p.fr}</h2>${meta ? html`<p class="mk-pmeta">${meta[0].toUpperCase() + meta.slice(1)}</p>` : ''}${p.n ? html`<p class="mk-pcm">Nom Cardmarket : ${p.n}</p>` : ''}</div>
<div class="mk-pprice"><div class="mk-pline">${p.eur != null ? html`<span class="price big">${eur(p.eur)}</span>` : html`<span class="price big mk-nosale">Pas de vente récente</span>`}<span class="mk-pdelta"></span></div>
${p.low != null ? html`<p class="mk-plow">Dès ${eur(p.low)} en vente (toutes langues et états)</p>` : ''}<p class="mk-pmove"></p></div>
<div class="mk-chart" aria-busy="true"><div class="chart-empty">Chargement de l’historique…</div></div>
${stats ? html`<p class="mk-pstats">${stats}</p>` : ''}
${kvHTML()}
<div class="sect">Mon scellé</div>
<div class="group mk-own">${ownHTML()}</div>
<div class="sect">Liens</div>
<div class="group">${links}</div>
<p class="caption mk-credit">${sealed.creditText()}${p.img ? ` ${sealed.PHOTO_CREDIT}` : ''}</p>
</div></div>`);
  headline();
}

// variation de la plage choisie (ou « prix inchangé depuis … ») et dernier mouvement de la cote
function headline() {
  const dEl = el.querySelector('.mk-pdelta'), mEl = el.querySelector('.mk-pmove');
  if (!dEl || !mEl) return;
  const lm = pts?.length ? sealed.lastMove(pts) : null;
  const last = pts?.length ? pts[pts.length - 1] : null;
  const days = RDAYS[range];
  const start = last ? (days === Infinity ? pts[0].d : new Date(toDate(last.d).getTime() - days * DAY).toISOString().slice(0, 10)) : null;
  const key = RKEY[range];
  let d = '';
  if (p.eur != null) {
    const frozenSince = lm ? (lm.since || (lm.date && start && lm.date <= start ? lm.date : null)) : sealed.stillSince(p, days === Infinity ? 0 : days);
    if (frozenSince && (lm || days !== Infinity)) d = html`<span class="mk-still">${stillText(frozenSince)}</span>`;
    else if (key && p[key] != null) d = deltaHTML(p[key], { per: sealed.PER[key] });
    else if (pts?.length > 1) {
      const vis = pts.filter(x => x.d >= start);
      const from = vis.length > 1 ? vis[0] : null;
      if (from) d = deltaHTML(((last.v - from.v) / from.v) * 100, { per: range === 'tout' ? `depuis ${monthYear(from.d)}` : `depuis le ${dateDay(from.d)}` });
    }
  }
  setHTML(dEl, html`${d}`);
  let move = '';
  if (p.eur == null && last) move = `Dernière cote connue ${eur(last.v)}, le ${dayText(last.d)}`;
  else if (lm?.date) move = html`Dernière variation le ${dayText(lm.date)} : ${deltaHTML(lm.pct)} <span class="muted">(avant ${eur(lm.prev)})</span>`;
  else if (!lm && p.chg && p.eur != null && sealed.stillSince(p, 1)) move = stillText(p.chg);
  setHTML(mEl, html`${move}`);
  mEl.hidden = !move;
}

async function loadHistory(my) {
  const box = el.querySelector('.mk-chart');
  histFail = false;
  let err = null;
  try { pts = await sealed.history(my); }
  catch (e) { pts = null; histFail = true; err = e; }
  // fiche quittée entre-temps : la courbe se dessine quand même (vue gardée en cache, Retour la retrouve)
  if (p !== my || !box.isConnected) return;
  box.removeAttribute('aria-busy');
  if (histFail) {
    setHTML(box, html`<div class="errrow">${icon('wifi-off')}<span class="grow">Historique indisponible · ${MESSAGES[err?.kind] || MESSAGES.network}</span><button type="button" class="btn text" data-hist>Réessayer</button></div>`);
    return;
  }
  if (!pts.length) { setHTML(box, html`<div class="chart-empty">Pas encore d’historique pour ce produit</div>`); headline(); return; }
  chart?.destroy();
  chart = lineChart(box, pts, {
    ranges: RANGES, range, format: eur, label: `Cote de ${p.fr}`,
    onRange: k => { range = k; setParams({ periode: k === 'tout' ? null : k }); headline(); },
  });
  if (pts.length < 2) box.insertAdjacentHTML('beforeend', '<p class="chart-empty mk-onept">Un seul relevé pour l’instant : la courbe se dessine au fil des jours.</p>');
  headline();
}

// ---------- Mon scellé : feuille quantité / prix d'achat ----------
function ownSheet() {
  const prod = p, id = p.id;      // la fiche peut changer avant « Annuler » : on agit toujours sur ce produit
  const o = col.sealedGet(id);
  const today = new Date().toLocaleDateString('sv');
  const cost = o ? cents(o.cost) : cents(prod.eur);
  const body = html`<form class="form mk-oform" novalidate>
<div class="two"><label class="field">Quantité<input name="qty" type="number" inputmode="numeric" min="1" max="999" step="1" value="${o?.qty || 1}" required></label>
<label class="field">Prix d’achat à l’unité<input name="cost" type="text" inputmode="decimal" autocomplete="off" value="${cost}" placeholder="ex. 150,00" aria-describedby="mk-fhint"></label></div>
<label class="field">Acheté le<input name="at" type="date" value="${o?.at || today}" max="${today}"></label>
<p class="mk-fhint" id="mk-fhint">${prod.eur != null ? `Cote du jour ${eur(prod.eur)}${prod.low != null ? ` · dès ${eur(prod.low)}` : ''}. Laisse le prix vide si tu ne le connais pas.` : 'Pas de vente récente. Laisse le prix vide si tu ne le connais pas.'}</p>
<p class="mk-ferr" role="alert" hidden></p>
<button type="submit" class="btn primary block">${o ? 'Enregistrer' : 'Ajouter à mon scellé'}</button>
${o ? html`<button type="button" class="btn block danger" data-remove>Retirer de mon scellé</button>` : ''}
</form>`;
  const s = openSheet({ title: o ? 'Mon scellé' : 'Ajouter à mon scellé', body });
  const form = s.el.querySelector('form');
  const err = form.querySelector('.mk-ferr');
  const fail = (msg, input) => { err.textContent = msg; err.hidden = false; input?.focus(); input?.setAttribute('aria-invalid', 'true'); };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const q = form.elements.qty, c = form.elements.cost, a = form.elements.at;
    for (const i of [q, c, a]) i.removeAttribute('aria-invalid');
    const qty = Number(q.value);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return fail('Indique une quantité entière entre 1 et 999.', q);
    const raw = c.value.replace(/[\s €]/g, '').replace(',', '.');
    const costV = raw === '' ? null : Number(raw);
    if (costV != null && !(Number.isFinite(costV) && costV >= 0 && costV < 1e7)) return fail('Indique un prix d’achat valide (ex. 150,00), ou laisse le champ vide.', c);
    const at = /^\d{4}-\d{2}-\d{2}$/.test(a.value) && a.value <= today ? a.value : (o?.at || today);
    const prev = o ? { ...o } : null;
    col.sealedSet(id, { qty, cost: costV, at });
    await s.close();
    toast(prev ? 'Mon scellé mis à jour' : 'Ajouté à ton scellé', prev ? {} : { action: 'Annuler', onAction: () => col.sealedSet(id, null) });
  });
  form.querySelector('[data-remove]')?.addEventListener('click', async () => {
    const prev = { ...col.sealedGet(id) };
    col.sealedSet(id, null);
    await s.close();
    toast('Retiré de ton scellé', { action: 'Annuler', onAction: () => col.sealedSet(id, prev) });
  });
}

function stateHTML(kind, e) {
  if (kind === 'missing') {
    return html`<div class="empty" data-content><span class="ic">${icon('box')}</span><b>Produit introuvable</b><p>Ce produit n’est plus dans le catalogue Cardmarket de Cardex.</p><a class="btn" href="#/marche/scelle?vue=catalogue">Voir le catalogue</a></div>`;
  }
  return html`<div class="empty" data-content><span class="ic">${icon('wifi-off')}</span><b>Fiche indisponible</b><p>${MESSAGES[e?.kind] || 'Connexion impossible'}. Le catalogue du scellé s’affichera dès que la connexion reviendra.</p><button type="button" class="btn" data-again>Réessayer</button></div>`;
}

let lastR = null;
const api = {
  mount(section) {
    el = section;
    el.classList.add('mk-prod');
    delegate(el, 'click', '[data-own]', () => { if (p) ownSheet(); });
    delegate(el, 'click', '[data-hist]', () => { if (p) { setHTML(el.querySelector('.mk-chart'), html`<div class="chart-empty">Chargement de l’historique…</div>`); loadHistory(p); } });
    delegate(el, 'click', '[data-again]', () => { if (lastR) api.show(lastR); });
  },

  async show(r) {
    lastR = r;
    sig = r.signal;
    const id = Number(param(r));
    const per = r.q.get('periode');
    range = RANGES.includes(per) ? per : 'tout';
    const known = sealed.get(id);
    setBar({ title: known ? sealed.split(known).type : 'Produit', back: true, signal: sig, actions: [{ icon: 'star', label: 'Suivre ce produit', pressed: false, disabled: true, onClick: () => {} }] });
    if (!known) setHTML(el, html`<div class="mk-pgrid" aria-busy="true"><div class="mk-pside"><div class="mk-pimg sk"></div></div><div class="mk-pmain" data-content><span class="sk mk-sk-title"></span><span class="sk mk-sk-line"></span><span class="sk mk-sk-hero"></span></div></div>`);
    try { await Promise.all([sealed.load(), ptileReady()]); }
    catch (e) {
      if (sig.aborted) return;
      p = null;
      setHTML(el, stateHTML('error', e));
      return;
    }
    if (sig.aborted) return;
    const next = sealed.get(id);
    if (!next) {
      p = null;
      setBar({ title: 'Produit', back: true, signal: sig });
      setHTML(el, stateHTML('missing'));
      return;
    }
    chart?.destroy();
    chart = null;
    p = next;
    pts = null;
    bar();
    render();
    loadHistory(p);       // la courbe arrive ensuite (place réservée : rien ne bouge)
  },

  // retour sur la fiche gardée en cache : la barre remise par main.js peut dater d'avant un changement (☆)
  resume(r) {
    lastR = r;
    sig = r.signal;
    // fiche restée en erreur (ou introuvable) : on retente, la connexion a pu revenir
    if (!p) { api.show(r); return; }
    updateAction(0, starAction(), { signal: sig });
    const own = el.querySelector('.mk-own');
    if (own) setHTML(own, ownHTML());
  },

  hide() {},

  onChange(events) {
    if (!p) return;
    const mine = events.some(e => e.type === 'reload' || ((e.type === 'watch' || e.type === 'sealed') && String(e.id) === String(p.id)));
    if (!mine) return;
    updateAction(0, starAction(), { signal: sig });
    const own = el.querySelector('.mk-own');
    if (own) setHTML(own, ownHTML());
  },
};
export default api;
