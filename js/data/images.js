// Images des cartes : FR -> même carte en anglais (TCGdex, puis Scrydex vérifié) -> même illustration (réimpression)
// -> vignette sobre. Table de correspondance : data/cardimg.json (FINAL-images §3.1–3.3, version corrigée).
// Jamais d'identifiant Scrydex deviné : seuls ceux de la liste « ok » (vérifiés au build) sont utilisés,
// car Scrydex répond 200 avec un dos de carte pour un identifiant inconnu.
import { data } from '../core/net.js';
// balisage construit ici (échappement local), rendu « sûr » pour html`` de js/core/dom.js (pas de double échappement)
import { raw as toSafe } from '../core/dom.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

const FR = 'https://assets.tcgdex.net/fr/';
const EN = 'https://assets.tcgdex.net/en/';
const SX = 'https://images.scrydex.com/pokemon/';
const sxSize = q => (q === 'high' ? 'large' : 'small');
const sxUrl = (id, q) => `${SX}${id}/${sxSize(q)}`;
// numéro Scrydex : chiffres sans zéros de tête (001 → 1), holos ecard2 « H01 » → « H1 », le reste tel quel
const sxNum = l => (/^\d+$/.test(l) ? String(+l) : l.replace(/^H0+(?=\d)/, 'H'));
const setIdOf = id => { const s = String(id); const i = s.lastIndexOf('-'); return i > 0 ? s.slice(0, i) : s; };
const decode = s => { try { return decodeURIComponent(s); } catch { return s; } };

let CI = { en: {}, sx: {}, id: {}, alt: {}, png: new Set(), fix: {} };
const OK = new Map();      // série -> Set des localId dont l'id Scrydex a été vérifié au build
const SETS = new Map();    // série -> { name, total, sym, serie } (fourni par catalog.js)

function load(d) {
  if (!d || typeof d !== 'object') return;
  CI = {
    en: d.en || {}, sx: d.sx || {}, id: d.id || {}, alt: d.alt || {}, fix: d.fix || {},
    from: d.from && typeof d.from === 'object' ? d.from : null,   // carte d'origine d'une illustration empruntée
    png: new Set(Array.isArray(d.png) ? d.png : []),
  };
  OK.clear();
  for (const [s, ids] of Object.entries(d.ok || {})) {
    OK.set(s, new Set(Array.isArray(ids) ? ids.map(String) : String(ids).split(' ').filter(Boolean)));
  }
}

// data/cardimg.json chargé (à attendre avant le premier rendu ; ne rejette jamais)
export const ready = data('data/cardimg.json').then(load, () => {});

// catalog.js enregistre les séries connues (nom, total imprimé, symbole, série TCGdex)
export function registerSets(metas) {
  for (const m of metas || []) {
    if (m?.id) SETS.set(m.id, { name: m.name || '', total: m.total || 0, sym: m.sym || '', serie: m.serie || m.bloc || '' });
  }
}

// ---------- résolution ----------
// c : carte TCGdex (brève ou complète) ou entrée de collection {id, image, localId}. q : 'low' | 'high'.
// Renvoie { urls, en, same, ref } : urls vide = pas d'image ; en = image anglaise ;
// same = illustration d'une autre carte (réimpression) ; ref = id TCGdex de cette carte quand il est connu.
export function cardImg(c, q = 'low') {
  return resolve(c, q, 0);
}

function resolve(c, q, depth) {
  const none = { urls: [], en: false, same: false, ref: null };
  const id = c?.id;
  if (!id) return none;
  const fx = CI.fix[id];
  if (fx) return { urls: [sxUrl(fx, q)], en: true, same: false, ref: null };
  // base d'image FR de TCGdex seulement (une autre URL, venue d'une sauvegarde ou d'une fiche, est ignorée)
  if (typeof c.image === 'string' && c.image.startsWith(FR) && !/[\s"'<>`]/.test(c.image)) {
    const w = `${c.image}/${q}.webp`, p = `${c.image}/${q}.png`;   // seul low.webp manque parfois (liste png)
    return { urls: q === 'low' && CI.png.has(id) ? [p] : [w, p], en: false, same: false, ref: null };
  }
  const set = setIdOf(id), raw = String(c.localId ?? id.slice(set.length + 1));
  const lid = decode(raw), urls = [];
  if (CI.en[set]) urls.push(`${EN}${CI.en[set]}/${set}/${encodeURIComponent(lid)}/${q}.webp`);
  const sx = CI.id[set]?.[raw] || (OK.get(set)?.has(raw) && CI.sx[set] ? `${CI.sx[set]}-${encodeURIComponent(sxNum(lid))}` : '');
  if (sx) urls.push(sxUrl(sx, q));
  if (urls.length) return { urls, en: true, same: false, ref: null };
  return depth ? none : altOf(id, q) || none;
}

// Carte de réimpressions (« alt ») : « sx:<id Scrydex> » (jumelle anglaise exacte des McDonald's),
// « fr:<serie>/<set>/<num> » ou « en:<serie>/<set>/<num> » (base d'image TCGdex), une URL, ou un id de carte TCGdex.
// Plusieurs jetons possibles (tableau ou séparés par des espaces) : ils se suivent comme secours.
function altOf(id, q) {
  const v = CI.alt[id];
  if (!v) return null;
  const tokens = Array.isArray(v) ? v.map(String) : String(v).split(/\s+/).filter(Boolean);
  const from = CI.from ? CI.from[id] || null : undefined;   // « from » absent : ancien format
  let first = null;
  const urls = [];
  for (const t of tokens) {
    const r = altToken(t, q, from);
    if (!r || !r.urls.length) continue;
    first ??= r;
    for (const u of r.urls) if (!urls.includes(u)) urls.push(u);
  }
  return first ? { urls, en: first.en, same: first.same, ref: first.ref ?? from ?? null } : null;
}

function altToken(t, q, from) {
  if (t.startsWith('sx:')) {
    const sid = t.slice(3);
    // sans carte d'origine (« from »), c'est la jumelle anglaise exacte (McDonald's anglais) : la même carte, en anglais
    const twin = from === undefined ? /^mcd\d/i.test(sid) : !from;
    return { urls: [sxUrl(sid, q)], en: true, same: !twin, ref: twin ? null : from || null };
  }
  if (t.startsWith('fr:') || t.startsWith('en:')) {
    const lang = t.slice(0, 2), path = t.slice(3).replace(/\/+$/, '');
    const b = (lang === 'fr' ? FR : EN) + path;
    const parts = path.split('/');
    const ref = parts.length >= 3 ? `${parts[parts.length - 2]}-${parts[parts.length - 1]}` : null;
    return { urls: lang === 'fr' ? [`${b}/${q}.webp`, `${b}/${q}.png`] : [`${b}/${q}.webp`], en: lang === 'en', same: true, ref };
  }
  if (/^https:\/\//.test(t)) {
    const isFile = /\.(webp|png|jpe?g|avif)$/i.test(t);
    return { urls: [isFile ? t : `${t}/${q}.webp`], en: t.startsWith(EN) || t.startsWith(SX), same: true, ref: null };
  }
  if (/^[\w.%!-]+-[\w.%!]+$/.test(t)) {
    // id de la carte d'origine : son image FR si la série est connue, sinon sa propre résolution (EN, Scrydex)
    const s = setIdOf(t), info = SETS.get(s);
    const lidRaw = t.slice(s.length + 1);
    const frBase = info?.serie ? `${FR}${info.serie}/${s}/${lidRaw}` : '';
    const own = resolve({ id: t, localId: lidRaw, image: '' }, q, 1);
    if (own.urls.length) return { urls: own.urls, en: true, same: true, ref: t };
    if (frBase) return { urls: [`${frBase}/${q}.webp`, `${frBase}/${q}.png`], en: false, same: true, ref: t };
    return null;
  }
  return null;
}

// ---------- libellés ----------
const total = c => c.setTotal || c.set?.cardCount?.official || SETS.get(setIdOf(c.id))?.total || 0;
// « 025/165 » ; numéros non numériques tels quels (« TG05 », « SWSH001 »)
export function cardNo(c) {
  if (!c?.id) return '';
  const set = setIdOf(c.id);
  const lid = decode(String(c.localId ?? c.id.slice(set.length + 1)));
  const t = total(c);
  return /^\d+$/.test(lid) && t ? `${lid}/${t}` : lid;
}
const symOf = c => SETS.get(setIdOf(c?.id || ''))?.sym || '';
const refLabel = ref => {
  if (!ref) return '';
  const s = setIdOf(ref), info = SETS.get(s);
  const lid = decode(ref.slice(s.length + 1));
  if (!info) return ref;
  return `${info.name} ${/^\d+$/.test(lid) && info.total ? `${lid}/${info.total}` : lid}`.trim();
};

// légende de la fiche carte (« » si l'image est la française)
export function imgCaption(card) {
  const r = cardImg(card);
  if (r.same) {
    const what = refLabel(r.ref);
    const base = what ? `Même illustration que ${what}` : 'Même illustration qu’une réimpression';
    return r.en ? `${base} (version anglaise)` : base;
  }
  return r.en ? 'Illustration de la version anglaise' : '';
}

// ---------- balisage ----------
const crossAttr = u => (/^https?:\/\//.test(u) && !u.startsWith(location.origin) ? ' crossorigin="anonymous"' : '');

function phHTML(no, sym, cls) {
  return `<span class="card-ph${cls ? ` ${esc(cls)}` : ''}" role="img" aria-label="Pas d'illustration">`
    + (sym ? `<img class="card-ph-sym"${crossAttr(sym)} src="${esc(sym)}" alt="">` : '')
    + `<span class="card-ph-no">${esc(no)}</span></span>`;
}

// <img> de la carte (chaîne de secours dans data-fb) ou vignette « Pas d'illustration » (symbole + numéro, jamais le nom)
export function imgHTML(card, { q = 'low', cls = '', alt = '', eager = false } = {}) {
  const r = cardImg(card, q);
  const no = cardNo(card), sym = symOf(card);
  if (!r.urls.length) return toSafe(phHTML(no, sym, cls));
  const [src, ...fb] = r.urls;
  return toSafe(`<img class="card-img${cls ? ` ${esc(cls)}` : ''}" crossorigin="anonymous" loading="${eager ? 'eager' : 'lazy'}"`
    + `${eager ? ' fetchpriority="high"' : ''} decoding="async" width="245" height="337" alt="${esc(alt)}" src="${esc(src)}"`
    + ` data-fb="${esc(fb.join(' '))}" data-ph-no="${esc(no)}" data-ph-sym="${esc(sym)}">`);
}

// pastille « EN » (image anglaise) ou « ≈ » (même illustration qu'une autre carte) — tuiles d'au moins 56 px
export function enBadge(card) {
  const r = cardImg(card);
  if (!r.urls.length) return '';
  if (r.same) {
    const what = refLabel(r.ref);
    const title = (what ? `Même illustration que ${what}` : 'Même illustration qu’une réimpression') + (r.en ? ' (version anglaise)' : '');
    return toSafe(`<span class="pill-en" title="${esc(title)}">≈</span>`);
  }
  return r.en ? toSafe('<span class="pill-en" title="Illustration de la version anglaise">EN</span>') : '';
}

// Un seul écouteur 'error' (phase de capture) : URL suivante de data-fb, puis la vignette.
const installed = new WeakSet();
export function installFallback(root = document) {
  if (!root || installed.has(root)) return;
  installed.add(root);
  root.addEventListener('error', e => {
    const el = e.target;
    if (!el || el.tagName !== 'IMG') return;
    if (el.classList.contains('card-img')) {
      const fb = (el.getAttribute('data-fb') || '').split(' ').filter(Boolean);
      if (fb.length) {
        const [next, ...rest] = fb;
        el.setAttribute('data-fb', rest.join(' '));
        el.src = next;
        return;
      }
      const cls = [...el.classList].filter(k => k !== 'card-img').join(' ');
      const tpl = document.createElement('template');
      tpl.innerHTML = phHTML(el.getAttribute('data-ph-no') || '', el.getAttribute('data-ph-sym') || '', cls);
      el.replaceWith(tpl.content.firstChild);
    } else if (el.classList.contains('card-ph-sym')) {
      el.remove();
    }
  }, true);
}

// Pour les tests
export const _state = () => ({ CI, OK, SETS });
