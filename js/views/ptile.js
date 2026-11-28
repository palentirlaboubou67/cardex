// Produit scellé : tuile (pistes, 140 px), ligne de liste (catalogue, Mon scellé), image avec secours (couverture
// générée : logo de la série, pictogramme et type ; pictogramme seul sans série connue ; jamais un carré gris vide),
// variation ou « prix inchangé depuis … » quand la cote est figée.
// Photos TCGplayer (emballage anglais) : toujours crossorigin="anonymous" (le service worker ne garde que le lisible).
import { html, raw, esc } from '../core/dom.js';
import { eur, dateDay, dateFr } from '../core/format.js';
import { icon } from '../core/icons.js';
import { deltaHTML } from '../components/chart.js';
import { setLogoHTML } from '../components/setlogo.js';
import * as col from '../state/collection.js';
import * as catalog from '../data/catalog.js';
import * as sealed from '../data/sealed.js';

// ---------- pictogrammes par type (grille 24, trait 1,75 comme les icônes) ----------
const BOX = '<path d="M3 9.5h18V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M5.5 9.5V5.6L9 4.2v5.3M10.5 9.5V5l3.5-1.4v5.9M15.5 9.5V5.6L19 4.2v5.3"/>';
const PICTO = {
  box: BOX, halfbox: BOX,
  etb: '<rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M2 5h20v4H2zM9.5 14h5"/>',
  bundle: '<rect x="4" y="11" width="16" height="10" rx="1.5"/><path d="M6 11V7.5h12V11M8 7.5V4h8v3.5"/>',
  coffret: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8.5h14V12M12 8v12.5M12 8c-1.2-2.8-5-3.6-5-1.3C7 8.4 10.6 8 12 8c1.4 0 5 .4 5-1.3 0-2.3-3.8-1.5-5 1.3"/>',
  tin: '<rect x="3" y="6" width="18" height="14" rx="4"/><path d="M3 10.5h18"/>',
  blister: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M10.5 5.5h3"/><rect x="7.5" y="8.5" width="9" height="10.5" rx="1.5"/>',
  booster: '<path d="M6 3h12l-1 2 1 2v10l-1 2 1 2H6l1-2-1-2V7l1-2z"/><path d="M9.5 10.5h5M9.5 13.5h5"/>',
  deck: '<rect x="8" y="3.5" width="11" height="15" rx="2"/><path d="M5 7.5v11a2 2 0 0 0 2 2h8"/>',
  prerelease: '<rect x="3" y="8.5" width="18" height="12" rx="1.5"/><path d="M9 8.5V5.5h6v3M3 13.5h18"/>',
  kit: '<rect x="3" y="4.5" width="8" height="12" rx="1.5"/><rect x="13" y="4.5" width="8" height="12" rx="1.5"/><path d="M3 20h18"/>',
  case: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
};
export const pictoHTML = (k, cls = '') => raw(`<svg class="i p-picto${cls ? ` ${esc(cls)}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PICTO[k] || PICTO.case}</svg>`);

// Produit sans photo (la moitié du catalogue, tous les japonais) : couverture générée quand sa série est dans le
// catalogue (logo de la série, pictogramme et type dans un coin, FINAL-cardmarket §3.2), sinon le pictogramme seul.
// Le catalogue des séries est chargé par ready() avant tout rendu.
export function genHTML(p) {
  const m = p.sid ? catalog.metaSync(p.sid) : null;
  if (!m) return pictoHTML(p.k);
  return html`<span class="p-gen" aria-hidden="true">${setLogoHTML(m, { size: 'row' })}<span class="p-gen-k">${pictoHTML(p.k)}<span>${sealed.KIND[p.k] || 'Produit'}</span></span></span>`;
}

// <img> du produit, ou sa couverture générée ; big : photo 400 px (la 200 px en secours)
export function pimgHTML(p, { big = false, eager = false } = {}) {
  if (!p.img) return genHTML(p);
  const src = big ? sealed.bigImg(p.img) : p.img;
  const fb = big && src !== p.img ? p.img : '';
  return raw(`<img class="p-img" crossorigin="anonymous" decoding="async" loading="${eager ? 'eager' : 'lazy'}"${eager ? ' fetchpriority="high"' : ''} alt="" src="${esc(src)}" data-k="${esc(p.k)}"${p.sid ? ` data-sid="${esc(p.sid)}"` : ''}${fb ? ` data-fb="${esc(fb)}"` : ''}>`);
}

// une seule écoute (capture) : photo 400 px → 200 px → couverture générée (ou pictogramme)
if (typeof document !== 'undefined' && !document.__ptileFb) {
  document.__ptileFb = true;
  document.addEventListener('error', e => {
    const el = e.target;
    if (!(el instanceof HTMLImageElement) || !el.classList.contains('p-img')) return;
    const fb = el.getAttribute('data-fb');
    if (fb) { el.removeAttribute('data-fb'); el.src = fb; return; }
    const tpl = document.createElement('template');
    tpl.innerHTML = String(genHTML({ k: el.getAttribute('data-k') || 'case', sid: el.getAttribute('data-sid') || null }));
    el.closest('.mk-pimg')?.classList.add('nophoto');
    el.replaceWith(tpl.content.firstChild);
  }, true);
}

// ---------- blocs (« Méga-Évolution ») des séries du catalogue ----------
let BLOC = null;
export async function ready() {
  if (BLOC) return;
  try {
    const s = await catalog.sets();
    BLOC = new Map(s.blocs.map(b => [b.id, b.name]));
  } catch { BLOC = BLOC || null; }
}
export const blocOf = sid => {
  const m = sid ? catalog.metaSync(sid) : null;
  return (m && BLOC?.get(m.bloc)) || '';
};
export const inCatalog = sid => !!(sid && catalog.metaSync(sid));

// ---------- textes ----------
export const priceText = p => (p.eur == null ? 'Pas de vente récente' : eur(p.eur));
const ownText = o => (o ? (o.qty > 1 ? `${o.qty} possédés` : '1 possédé') : '');
export const dayText = d => (d.slice(0, 4) === String(new Date().getFullYear()) ? dateDay(d) : dateFr(d));
export const stillText = d => `Prix inchangé depuis le ${dayText(d)}`;
export const shortStill = d => `inchangé depuis le ${dayText(d)}`;      // tuiles et lignes (la place manque)

// variation montrée pour un produit : celle de la période demandée, sinon la plus longue connue.
// { html, text, still } ; cote figée depuis le début de la période : still = date du dernier changement
export function changeOf(p, key = null) {
  const c = key ? (p[key] != null ? { key, v: p[key], per: sealed.PER[key] } : null) : sealed.change(p);
  if (p.eur == null) return { html: '', text: '', still: null };
  const still = sealed.stillSince(p, c ? sealed.DAYS[c.key] : 30);
  if (still) return { html: '', text: stillText(still), still };
  if (!c) return { html: '', text: '', still: null };
  return { html: deltaHTML(c.v, { per: c.per }), text: `${c.v > 0 ? 'en hausse' : c.v < 0 ? 'en baisse' : 'stable'} de ${Math.abs(c.v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % sur ${sealed.PER_LONG[c.key]}`, still: null };
}

function label(p, ch, own, watched) {
  return [p.fr, sealed.isJa(p) ? 'japonais' : '', priceText(p), ch.text, watched ? 'suivi' : '', ownText(own)].filter(Boolean).join(', ');
}

// ---------- tuile (pistes) ----------
export function ptileHTML(p, { key = null } = {}) {
  const { type, name } = sealed.split(p);
  const own = col.sealedGet(p.id), watched = col.watching(p.id);
  const ch = changeOf(p, key);
  return html`<a class="ptile mk-ptile" href="#/produit/${p.id}" data-product="${p.id}" aria-label="${label(p, ch, own, watched)}"><span class="ptile-img">${pimgHTML(p)}${
    own ? html`<span class="qty">×${own.qty}</span>` : ''}${watched ? html`<span class="mk-star">${icon('star-fill', { size: 12 })}</span>` : ''}${
    sealed.isJa(p) ? html`<span class="pill-en mk-ja">JP</span>` : ''}</span><span class="cap"><span><i>${type}</i></span><b>${name}</b><span>${
    p.eur == null ? html`<i>Pas de vente récente</i>` : html`<em>${eur(p.eur)}</em>`}${ch.html}${ch.still ? html`<i class="mk-still">${shortStill(ch.still)}</i>` : ''}</span></span></a>`;
}

// ---------- ligne (catalogue) ----------
// sub : seconde ligne imposée (sinon bloc · année · japonais)
export function prowHTML(p, { key = null, sub = null } = {}) {
  const own = col.sealedGet(p.id), watched = col.watching(p.id);
  const ch = changeOf(p, key);
  const bloc = blocOf(p.sid);
  const s2 = sub ?? [bloc || (p.set && !p.fr.includes(p.set) ? p.set : ''), sealed.year(p), sealed.isJa(p) ? 'Japonais' : ''].filter(Boolean).join(' · ');
  // notes : « suivi » et « 3 possédés » ne sont jamais coupés ; seule la date (« inchangé depuis … ») se raccourcit
  const notes = [watched ? html`<span class="mk-flag">${icon('star-fill', { size: 12 })}<span class="mk-flagt">suivi</span></span>` : '', own ? html`<span class="mk-own">${ownText(own)}</span>` : '',
    ch.still ? html`<span class="mk-since">${shortStill(ch.still)}</span>` : ''].filter(Boolean);
  return html`<a class="row mk-prow" href="#/produit/${p.id}" data-product="${p.id}" aria-label="${label(p, ch, own, watched)}"><span class="sq">${pimgHTML(p)}</span><span class="body"><span class="t">${p.fr}</span>${
    s2 ? html`<span class="s"><span>${s2}</span></span>` : ''}${
    notes.length ? html`<span class="s mk-note">${notes.map((n, i) => html`${i ? html`<i aria-hidden="true">·</i>` : ''}${n}`)}</span>` : ''}</span><span class="end">${
    p.eur == null ? html`<span class="mk-nosale">Pas de vente récente</span>` : html`<span class="price">${eur(p.eur)}</span>`}${ch.html}</span></a>`;
}

// date de sortie lisible (fiche)
export const relText = p => (p.rel ? `sortie le ${dateFr(p.rel)}` : '');
