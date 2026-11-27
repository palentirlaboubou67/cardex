// Fiche carte : alertes de prix (les « envies » du Marché). IndexedDB via window.WishDB (js/state/wishes.js).
// Une alerte par carte et par finition (clé « id|finition ») ; prévenu quand l'offre la moins chère entre dans la fourchette.
import { html, raw } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { eur } from '../../core/format.js';
import { openSheet } from '../../core/sheet.js';
import { toast } from '../../core/toast.js';
import { openRoot } from '../../core/router.js';
import { LABEL, order } from '../../data/finishes.js';

const W = () => (typeof window !== 'undefined' ? window.WishDB : null);
export const available = () => !!W()?.all;

// alertes de cette carte, dans l'ordre des finitions ; rejette si IndexedDB est indisponible
export async function wishesOf(id) {
  const all = (await W().all()) || [];
  return all.filter(w => w?.id === id).sort((a, b) => order(a.variant) - order(b.variant));
}

const range = w => (Number(w.min) > 0 ? `${eur(Number(w.min))} – ${eur(Number(w.max))}` : `jusqu’à ${eur(Number(w.max))}`);
function stateOf(w) {
  if (w.inRange) return html`<span class="cp-in">Dans ta fourchette${w.low != null ? ` · dès ${eur(w.low)}` : ''}</span>`;
  if (w.low != null) return `En vente dès ${eur(w.low)}`;
  return w.checkedAt ? 'Aucune offre connue' : 'Prix pas encore vérifié';
}

// prix proposé : 90 % de la cote (arrondi au centime inférieur) ; aucun sur un prix toutes éditions (pas le sien)
export const suggestOf = p => {
  if (!p || p.allEditions) return null;
  const ref = p.eur ?? p.trend ?? p.low;
  return ref ? Math.floor(ref * 90) / 100 : null;
};
const NO_OWN = 'Pas de prix propre à cette version';

// lignes : alertes existantes (toucher = modifier, « Retirer ») + création.
// allEditions(f) : la cote de f est celle de la carte de base (1re édition, tampon) : ni « en vente dès » ni « dans ta fourchette »
export function rowsHTML(list, { fin, suggest, allEditions = () => false }) {
  const rows = list.map(w => { const ae = allEditions(w.variant), ring = w.inRange && !ae; return html`<div class="row cp-wish" data-key="${w.key}"><button type="button" class="cp-wb" data-edit="${w.key}"><span class="lead">${icon(ring ? 'bell-ring' : 'bell')}</span><span class="body"><span class="t">${LABEL[w.variant] || w.variant} · ${range(w)}</span><span class="s"><span>${ae ? NO_OWN : stateOf(w)}</span></span></span></button><button type="button" class="btn text cp-del" data-del="${w.key}" aria-label="${`Retirer l’alerte ${LABEL[w.variant] || w.variant}`}">Retirer</button></div>`; });
  const has = list.some(w => w.variant === fin);
  // W-H : « Me prévenir sous 7,12 € » (90 % de la cote de la finition en aperçu)
  const title = suggest ? `Me prévenir sous ${eur(suggest)}` : 'Créer une alerte prix';
  const sub = `${LABEL[fin] || fin} · rejoint tes envies`;
  const add = has ? '' : html`<button type="button" class="row" data-new><span class="lead">${icon('bell')}</span><span class="body"><span class="t">${title}</span><span class="s"><span>${sub}</span></span></span>${icon('chevron-right', { cls: 'chev' })}</button>`;
  return html`<div class="group cp-alerts">${rows}${add}</div>`;
}

// « 7,5 », « 7.50 », « 7,50 € » → 7.5 ; vide → null ; illisible → NaN
const parse = s => {
  const t = String(s ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (!t) return null;
  return /^\d+(\.\d{0,2})?$/.test(t) ? Number(t) : NaN;
};
const fmt = v => (v == null ? '' : v.toFixed(2).replace('.', ','));

// Feuille « Alerte prix » (W-W). card : carte brève ; finishes : finitions proposées ; fin : celle choisie ;
// existing : l'alerte modifiée (ou null) ; priceOf(f) → { eur, low, trend, allEditions? } | null ; onDone() après enregistrement.
export function openAlertSheet({ card, finishes, fin, existing = null, priceOf, onDone }) {
  const DB = W();
  const p0 = priceOf(fin);
  const max0 = existing ? Number(existing.max) : suggestOf(p0);
  const min0 = existing ? Number(existing.min) || 0 : 0;
  const opts = finishes.map(f => html`<option value="${f}"${f === fin ? raw(' selected') : ''}>${LABEL[f] || f}</option>`);
  const body = html`<form class="form cp-aform" novalidate>
    ${finishes.length > 1 ? html`<label class="field">Version<select name="f">${opts}</select></label>` : ''}
    <div class="two">
      <label class="field">Prix min (€)<input name="min" type="text" inputmode="decimal" autocomplete="off" value="${fmt(min0)}"></label>
      <label class="field">Prix max (€)<input name="max" type="text" inputmode="decimal" autocomplete="off" value="${fmt(max0)}" placeholder="ex. 15,00"></label>
    </div>
    <p class="cp-now" aria-live="polite"></p>
    <p class="cp-err" role="alert" hidden></p>
    <button type="submit" class="btn primary block">${existing ? 'Enregistrer' : 'Me prévenir'}</button>
    ${existing ? html`<button type="button" class="btn text danger cp-adel">Retirer l’alerte</button>` : ''}
  </form>`;
  const s = openSheet({ title: existing ? 'Modifier l’alerte' : 'Alerte prix', body });
  const form = s.el.querySelector('form');
  const now = form.querySelector('.cp-now');
  const err = form.querySelector('.cp-err');
  const sel = form.querySelector('select[name="f"]');
  const mx = form.querySelector('input[name="max"]');
  // prix toutes éditions (1re édition, tampon) : la cote de la carte de base, jamais montrée comme la sienne
  const showNow = f => {
    const p = priceOf(f);
    now.textContent = p?.allEditions ? `${NO_OWN}${p.eur != null ? ` · prix toutes éditions : cote ${eur(p.eur)}` : ''}`
      : p?.low != null ? `En vente dès ${eur(p.low)}${p.eur != null ? ` · cote ${eur(p.eur)}` : ''}`
      : p?.eur != null ? `Cote ${eur(p.eur)}` : 'Pas de prix connu pour cette version';
  };
  showNow(fin);
  let typed = false;                               // prix max tapé : on ne le remplace plus
  mx.addEventListener('input', () => { typed = true; });
  sel?.addEventListener('change', () => {
    showNow(sel.value);
    if (!existing && !typed) mx.value = fmt(suggestOf(priceOf(sel.value)));
  });
  form.querySelector('.cp-adel')?.addEventListener('click', async () => {
    await s.close();
    remove(existing, onDone);
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = sel?.value || fin;
    const min = parse(form.querySelector('input[name="min"]').value) ?? 0;
    const max = parse(mx.value);
    if (!(max > 0) || !(min >= 0) || min > max) {
      err.textContent = 'Indique un prix max au-dessus de 0 et un prix min qui ne le dépasse pas.';
      err.hidden = false;
      form.querySelector(max > 0 ? 'input[name="min"]' : 'input[name="max"]').focus();
      return;
    }
    err.hidden = true;
    // la permission se demande pendant le geste (Safari l'exige) ; l'alerte est enregistrée quoi qu'il arrive
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') DB.enableAlerts?.().catch?.(() => {});
    const w = DB.make(card, f, { min, max });
    if (existing?.key === w.key && existing.createdAt) w.createdAt = existing.createdAt;
    const p = priceOf(f);
    if (p && !p.allEditions && (p.low != null || p.eur != null)) DB.update(w, { low: p.low ?? null, trend: p.trend ?? p.eur ?? null });
    try {
      if (existing && existing.key !== w.key) await DB.del(existing.key);
      await DB.put(w);
    } catch {
      err.textContent = 'Enregistrement impossible : le stockage du navigateur est bloqué.';
      err.hidden = false;
      return;
    }
    await s.close();
    onDone?.();
    const msg = w.inRange ? `Déjà dans ta fourchette : dès ${eur(w.low)}` : existing ? 'Alerte modifiée' : 'Ajoutée à tes envies';
    toast(msg, { action: 'Voir', onAction: () => openRoot('#/marche/envies') });
  });
  return s;
}

// retire une alerte, « Annuler » la remet telle quelle
export async function remove(w, onDone) {
  const DB = W();
  if (!w || !DB) return;
  try { await DB.del(w.key); } catch { toast('Suppression impossible : le stockage du navigateur est bloqué.'); return; }
  onDone?.();
  toast('Alerte retirée', { action: 'Annuler', onAction: async () => { try { await DB.put(w); } catch { /* bloqué */ } onDone?.(); } });
}
