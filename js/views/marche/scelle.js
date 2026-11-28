// Marché › Scellé : Pistes (W-Q, 6 sections) ou Catalogue (W-R : recherche, tri, langue, puces de type avec compte).
// Paramètres dans l'adresse : vue=pistes|catalogue, q, type, tri, langue (int|ja|tout ; défaut : prefs sealedLang).
import { html, raw, setHTML, delegate, selectChip } from '../../core/dom.js';
import { num, plural, dateFr } from '../../core/format.js';
import { icon } from '../../core/icons.js';
import { setParams } from '../../core/router.js';
import { infoSheet } from '../../core/sheet.js';
import { yieldToMain, whenIdle } from '../../core/idle.js';
import * as col from '../../state/collection.js';
import * as prefs from '../../state/prefs.js';
import { MESSAGES } from '../../core/net.js';
import * as sealed from '../../data/sealed.js';
import { ptileHTML, prowHTML, ready as ptileReady } from '../ptile.js';

const PAGE = 60;
const RAIL = 12;            // tuiles par rail
const LANGS = [['int', 'International'], ['ja', 'Japonais'], ['tout', 'Toutes les langues']];
const PREF_OF = { int: 'int', ja: 'ja', tout: 'int+ja' };
const FROM_PREF = { int: 'int', ja: 'ja', 'int+ja': 'tout' };
const WARN = ['Ce ne sont pas des conseils financiers.',
  'Les pistes classent les produits d’après l’évolution passée de leur cote Cardmarket, qui ne dit rien de l’avenir. Vérifie le prix et l’état avant d’acheter, et garde tes produits bien scellés.'];

let box = null, ctx = null, visible = false;
let st = { vue: 'pistes', q: '', type: '', tri: 'new', lang: 'int' };
let shown = PAGE, cur = [], keyP = '', keyC = '', wrev = 0, qT = 0, failed = null;
let catK = null, counts0 = null, ptok = 0, navRaf = 0, navAll = false, navOne = null;
let pend = null, pendStop = null, ownSig = '', warmed = false;

const defLang = () => FROM_PREF[prefs.get('sealedLang', 'int')] || 'int';

// paramètre changé : adresse mise à jour (sans entrée d'historique) et lien de l'onglet « Scellé » aussi
function params(obj) {
  setParams(obj);
  ctx?.refreshTabs();
}

function readParams(r) {
  const q = r.q;
  const lang = LANGS.some(([k]) => k === q.get('langue')) ? q.get('langue') : defLang();
  const type = q.get('type') || '';
  const tri = sealed.SORTS[q.get('tri')] ? q.get('tri') : 'new';
  return { vue: q.get('vue') === 'catalogue' ? 'catalogue' : 'pistes', q: (q.get('q') || '').slice(0, 80), type: type === 'suivis' || sealed.KIND[type] ? type : '', tri, lang };
}

// ---------- squelette de la section ----------
function build() {
  setHTML(box, html`<div class="mk-tool"><div class="seg" role="group" aria-label="Affichage du scellé"><button type="button" data-vue="pistes" aria-pressed="true">Pistes</button><button type="button" data-vue="catalogue" aria-pressed="false">Catalogue</button></div></div>
<div class="mk-pistes"></div>
<div class="mk-cat" hidden>
<label class="search mk-search">${icon('search')}<input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" aria-label="Rechercher un produit scellé" placeholder="Série ou produit (ex. Dracaufeu, 151)"><button type="button" class="search-clear" aria-label="Effacer la recherche">${icon('close')}</button></label>
<div class="chips mk-cchips" role="group" aria-label="Trier et filtrer"></div>
<div class="group mk-list mk-plist"></div><div class="mk-pempty"></div>
<div class="btns"><button type="button" class="btn block" data-more hidden>Afficher plus</button></div>
<p class="caption mk-credit"></p>
</div>`);
  box.dataset.built = '1';
}

function skeleton() {
  const tiles = Array.from({ length: 3 }, () => html`<span class="mk-sktile"><span class="sk mk-sk-sq"></span><span class="sk mk-sk-line"></span><span class="sk mk-sk-line s"></span></span>`);
  const rows = Array.from({ length: 6 }, () => html`<span class="row sk-row"><span class="sk-a"></span><span class="body"><span class="sk-t"></span><span class="sk-s"></span></span></span>`);
  return st.vue === 'catalogue' ? html`${rows}`
    : html`<div class="mk-skrail" aria-busy="true" data-content>${tiles}</div><div class="mk-skrail">${tiles}</div>`;
}

// ---------- pistes ----------
// tuiles visibles dans la largeur d'un rail (140 px + 12, 160 px + 12 sur ordinateur), sans mesurer la page
const fitN = () => Math.min(RAIL, Math.ceil(innerWidth / (innerWidth >= 900 ? 172 : 152)));
// après l'affichage de l'image en cours (le passage suivant ne s'ajoute pas à sa mise en page)
const afterPaint = fn => requestAnimationFrame(() => setTimeout(fn, 0));

// une section avec ses n premières tuiles (data-rest : la suite viendra au passage suivant)
function ideaHTML(s, { first = false, n = RAIL } = {}) {
  const langQ = st.lang === defLang() ? '' : `&langue=${st.lang}`;
  const more = s.type ? `#/marche/scelle?vue=catalogue&type=${s.type}${langQ}` : `#/marche/scelle?vue=catalogue&tri=${s.tri}${langQ}`;
  const rest = n < RAIL && s.list.length > n;
  return html`<section class="mk-idea" data-idea="${s.id}" aria-labelledby="mk-i-${s.id}"${first ? raw(' data-content') : ''}><div class="sect"><span class="grow" id="mk-i-${s.id}">${s.title}</span><span class="mk-rnav" hidden><button type="button" class="ibtn sm" data-rail="-1" aria-label="Produits précédents">${icon('chevron-left')}</button><button type="button" class="ibtn sm" data-rail="1" aria-label="Produits suivants">${icon('chevron-right')}</button></span>${
    s.list.length > 3 || s.type ? html`<a href="${more}" data-replace aria-label="Tout voir : ${s.title}">Tout voir${icon('chevron-right')}</a>` : ''}</div><p class="mk-isub">${s.sub}</p><div class="mk-rail" data-per="${s.per || ''}"${rest ? raw(' data-rest') : ''}>${
    s.list.slice(0, n).map(p => ptileHTML(p, { key: s.per || null }))}</div></section>`;
}

function renderPistes() {
  const key = `${st.lang}|${wrev}|${sealed.loaded() ? 1 : 0}`;
  if (key === keyP) return;
  keyP = key;
  ownSig = sigOf();
  const tok = ++ptok;
  const S = sealed.ideas({ lang: st.lang, watch: col.watchList() });
  const lang = st.lang === 'int' ? '' : st.lang === 'ja' ? ' · produits japonais' : ' · toutes les langues';
  const n = fitN();
  setHTML(box.querySelector('.mk-pistes'), html`<button type="button" class="mk-warn" data-warn>${icon('info', { size: 18 })}<span class="grow">Tendances passées, pas des conseils financiers${lang}</span>${icon('chevron-right', { size: 18 })}</button>
${S.length ? S.map((s, i) => ideaHTML(s, { first: !i, n }))
    : html`<div class="empty" data-content><span class="ic">${icon('box')}</span><b>Pas encore de piste</b><p>Les pistes se calculent sur l’historique des cotes : reviens dans quelques jours.</p></div>`}
<p class="caption mk-credit">${creditLine()}</p>`);
  railNavSoon();
  const pistes = box.querySelector('.mk-pistes');
  if (!pistes.querySelector('.mk-rail[data-rest]')) return;
  // suite des rails (hors écran, à droite) après l'affichage : toutes les sections sont là dès le premier passage
  // (hauteur de page juste pour le défilement rendu par le routeur), seules leurs tuiles cachées attendent
  afterPaint(() => {
    if (tok !== ptok) return;
    const byId = new Map(S.map(s => [s.id, s]));
    for (const rail of pistes.querySelectorAll('.mk-rail[data-rest]')) {
      rail.removeAttribute('data-rest');
      const s = byId.get(rail.closest('.mk-idea')?.dataset.idea);
      if (s) rail.insertAdjacentHTML('beforeend', s.list.slice(rail.children.length, RAIL).map(p => String(ptileHTML(p, { key: s.per || null }))).join(''));
    }
    railNavSoon();
  });
}

const creditLine = () => { const d = sealed.loaded()?.priceDate; return d ? `Cotes Cardmarket du ${dateFr(d)} · photos TCGplayer (version anglaise)` : ''; };

// flèches des rails (ordinateur avec souris) : masquées quand tout tient, inactives en bout de rail
const NAVQ = typeof matchMedia === 'function' ? matchMedia('(min-width: 900px) and (hover: hover)') : null;
function railNav(rail) {
  const nav = rail.closest('.mk-idea')?.querySelector('.mk-rnav');
  if (!nav) return;
  const over = rail.scrollWidth > rail.clientWidth + 2;
  nav.hidden = !over;
  if (!over) return;
  const l = Math.abs(rail.scrollLeft);
  const [prev, next] = nav.querySelectorAll('button');
  prev.setAttribute('aria-disabled', l <= 2 ? 'true' : 'false');
  next.setAttribute('aria-disabled', l + rail.clientWidth >= rail.scrollWidth - 2 ? 'true' : 'false');
}
function railNavAll() {
  if (!NAVQ?.matches || !visible || box.querySelector('.mk-pistes')?.hidden) return;
  for (const r of box.querySelectorAll('.mk-pistes .mk-rail')) railNav(r);
}
// mesure groupée à l'image suivante (rail : celui qui défile ; sans rail : tous)
function railNavSoon(rail = null) {
  if (!NAVQ?.matches) return;
  if (rail) navOne = rail; else navAll = true;
  if (navRaf) return;
  navRaf = requestAnimationFrame(() => {
    navRaf = 0;
    const all = navAll, one = navOne;
    navAll = false; navOne = null;
    if (all) railNavAll(); else if (one?.isConnected) railNav(one);
  });
}

// ---------- catalogue ----------
function chipsHTML(counts) {
  const sort = selectChip({ label: 'Trier', options: sealed.sortOptions(st.tri), value: st.tri, name: 'tri', cls: 'mk-sel' });
  const lang = selectChip({ label: 'Langue', options: LANGS, value: st.lang, name: 'langue', cls: 'mk-sel' });
  const chip = (k, label, n) => html`<button type="button" class="chip" data-type="${k}" aria-pressed="${st.type === k ? 'true' : 'false'}">${
    k === 'suivis' ? icon('star-fill', { size: 14 }) : ''}${label}<span class="n">${num(n || 0)}</span></button>`;
  const kinds = sealed.KIND_ORDER.filter(k => counts[k] || st.type === k);
  return [sort, lang, chip('', 'Tous', counts.all),
    counts.suivis || st.type === 'suivis' ? chip('suivis', 'Suivis', counts.suivis) : '',
    ...kinds.map(k => chip(k, sealed.CHIP[k], counts[k]))];
}

function emptyCat() {
  if (st.type === 'suivis' && !st.q) return html`<div class="empty"><span class="ic">${icon('star')}</span><b>Aucun produit suivi</b><p>Touche l’étoile d’une fiche produit pour le suivre.</p></div>`;
  const what = st.q ? html`Rien ne correspond à « ${st.q} »${st.type ? ' dans ce type' : ''}.` : 'Aucun produit de ce type dans cette langue.';
  const btn = st.type ? html`<button type="button" class="btn" data-type="">Chercher dans tous les types</button>`
    : st.lang !== 'tout' ? html`<button type="button" class="btn" data-lang="tout">Chercher dans toutes les langues</button>` : '';
  return html`<div class="empty"><span class="ic">${icon('search')}</span><b>Aucun produit</b><p>${what}</p>${btn}</div>`;
}

// puces (tri, langue, types) ; le focus clavier reste sur la même puce
function paintChips(counts) {
  counts0 = counts;
  const chips = box.querySelector('.mk-cchips');
  const focused = chips.contains(document.activeElement) ? document.activeElement : null;
  const fk = focused?.dataset.type ?? (focused?.tagName === 'SELECT' ? `sel:${focused.getAttribute('aria-label')}` : null);
  const sx = chips.scrollLeft;
  setHTML(chips, html`${chipsHTML(counts)}`);
  chips.scrollLeft = sx;
  // arrivée par un lien (« Tout voir ») : la puce du type choisi est visible
  const on = !sx && st.type ? chips.querySelector('.chip[aria-pressed="true"]') : null;
  if (on && on.offsetLeft + on.offsetWidth > chips.clientWidth) chips.scrollLeft = on.offsetLeft - 16;
  if (fk != null) {
    const back = fk.startsWith?.('sel:') ? chips.querySelector(`select[aria-label="${fk.slice(4)}"]`) : chips.querySelector(`[data-type="${fk}"]`);
    back?.focus({ preventScroll: true });
  }
}

function renderCat(force = false) {
  const key = `${st.q}|${st.type}|${st.tri}|${st.lang}|${wrev}|${sealed.loaded() ? 1 : 0}`;
  if (key === keyC && !force) return;
  keyC = key;
  ownSig = sigOf();
  const input = box.querySelector('.mk-search input');
  if (input && input.value !== st.q && document.activeElement !== input) input.value = st.q;
  const { list, counts } = sealed.catalogue({ q: st.q, type: st.type, tri: st.tri, lang: st.lang, watch: col.watchList() });
  cur = list;
  if (!warmed) { warmed = true; whenIdle(sealed.warmSearch); }
  paintChips(counts);
  const g = box.querySelector('.mk-plist');
  const k = catK = sealed.sortKey(st.tri);
  g.hidden = !list.length;
  setHTML(g, html`${list.slice(0, shown).map(p => prowHTML(p, { key: k }))}`);
  g.removeAttribute('aria-busy');
  if (list.length) g.setAttribute('data-content', ''); else g.removeAttribute('data-content');
  setHTML(box.querySelector('.mk-pempty'), list.length ? '' : emptyCat());
  if (!list.length) box.querySelector('.mk-pempty .empty')?.setAttribute('data-content', '');
  moreBtn();
  box.querySelector('.mk-cat .mk-credit').textContent = [plural(list.length, 'produit', 'produits'), creditLine()].filter(Boolean).join(' · ');
}

function moreBtn() {
  const b = box.querySelector('[data-more]');
  const left = cur.length - shown;
  b.hidden = left <= 0;
  b.textContent = `Afficher plus (${num(Math.max(0, left))})`;
}

function appendMore() {
  const k = catK;
  const from = shown;
  shown += PAGE;
  box.querySelector('.mk-plist').insertAdjacentHTML('beforeend', cur.slice(from, shown).map(p => String(prowHTML(p, { key: k }))).join(''));
  moreBtn();
}

// ---------- ☆ ou Mon scellé changés (fiche produit) : seules les tuiles et lignes concernées sont refaites ----------
const nodeOf = safe => { const t = document.createElement('template'); t.innerHTML = String(safe); return t.content.firstElementChild; };

function patchProducts(ids, watchChanged) {
  const watch = col.watchList();
  if (keyP) {
    const pistes = box.querySelector('.mk-pistes');
    for (const id of ids) {
      const p = sealed.get(id);
      if (!p) continue;
      for (const t of pistes.querySelectorAll(`.ptile[data-product="${id}"]`)) t.replaceWith(nodeOf(ptileHTML(p, { key: t.closest('.mk-rail')?.dataset.per || null })));
    }
    if (watchChanged) {
      // section « Tes produits suivis » : refaite seule (ajoutée, retirée) ; pistes vides : tout est redessiné
      const idea = sealed.followedIdea(watch);
      const old = pistes.querySelector('.mk-idea[data-idea="suivis"]');
      if (!pistes.querySelector('.mk-idea')) keyP = '';
      else {
        if (!idea) old?.remove();
        else {
          const n = nodeOf(ideaHTML(idea));
          if (old) old.replaceWith(n); else pistes.querySelector('.mk-warn').after(n);
        }
        pistes.querySelectorAll('.mk-idea[data-content]').forEach(e => e.removeAttribute('data-content'));
        pistes.querySelector('.mk-idea')?.setAttribute('data-content', '');
      }
    }
  }
  if (keyC) {
    if (watchChanged && st.type === 'suivis') keyC = '';            // la liste elle-même change
    else {
      const g = box.querySelector('.mk-plist');
      for (const id of ids) {
        const p = sealed.get(id);
        const row = p && g.querySelector(`.row[data-product="${id}"]`);
        if (row) row.replaceWith(nodeOf(prowHTML(p, { key: catK })));
      }
      if (watchChanged && counts0) paintChips({ ...counts0, suivis: sealed.followedCount(st.q, watch) });
    }
  }
}

// changements vus section cachée (fiche produit ouverte) : appliqués au repos, ou au retour s'il n'est pas venu,
// jamais pendant le toucher de ☆
function queuePatch(ids, watchChanged) {
  pend ??= { ids: new Set(), watch: false };
  for (const id of ids) pend.ids.add(id);
  pend.watch ||= watchChanged;
  pendStop ??= whenIdle(flushPatch);
}
function flushPatch() {
  pendStop?.();
  pendStop = null;
  const q = pend;
  pend = null;
  if (q && sealed.loaded() && box.dataset.built) patchProducts([...q.ids], q.watch);
}
function dropPatch() { pendStop?.(); pendStop = pend = null; }

// la seule partie de la collection que montre la section : produits suivis et scellé possédé (quantités)
const sigOf = () => `${col.watchList().join(',')}|${col.sealedAll().map(o => `${o.id}:${o.qty}`).join(',')}`;

function renderVue() {
  for (const b of box.querySelectorAll('[data-vue]')) b.setAttribute('aria-pressed', b.dataset.vue === st.vue ? 'true' : 'false');
  box.querySelector('.mk-pistes').hidden = st.vue !== 'pistes';
  box.querySelector('.mk-cat').hidden = st.vue !== 'catalogue';
  if (st.vue === 'pistes') { renderPistes(); railNavSoon(); } else renderCat();
}

function setLang(lang) {
  st.lang = lang;
  prefs.set('sealedLang', PREF_OF[lang]);
  params({ langue: null });         // le choix est mémorisé : l'adresse n'en a plus besoin
  shown = PAGE;
  renderVue();
}

// ---------- chargement ----------
async function load(signal) {
  failed = null;
  try { await Promise.all([sealed.load(), ptileReady()]); }
  catch (e) { failed = e; }
  if (signal?.aborted) return false;
  if (failed) {
    const msg = MESSAGES[failed.kind] || 'Connexion impossible';
    setHTML(box, html`<div class="empty" data-content><span class="ic">${icon('wifi-off')}</span><b>Catalogue indisponible</b><p>${msg}. Le catalogue du scellé s’affichera dès que la connexion reviendra.</p><button type="button" class="btn" data-reload>Réessayer</button></div>`);
    box.dataset.built = '';
    keyP = keyC = '';
    return false;
  }
  return true;
}

export default {
  mount(el, c) {
    box = el;
    ctx = c;
    delegate(box, 'click', '[data-vue]', (e, b) => {
      if (b.dataset.vue === st.vue) return;
      st.vue = b.dataset.vue;
      params({ vue: st.vue === 'catalogue' ? 'catalogue' : null });
      renderVue();
    });
    delegate(box, 'input', '.mk-search input', (e, input) => {
      clearTimeout(qT);
      qT = setTimeout(() => {
        const q = input.value.trim().slice(0, 80);
        if (q === st.q) return;
        st.q = q;
        shown = PAGE;
        params({ q: q || null });
        renderCat();
      }, input.value ? 200 : 0);
    });
    delegate(box, 'keydown', '.mk-search input', e => { if (e.key === 'Enter') e.target.blur(); });
    delegate(box, 'click', '[data-type]', (e, b) => {
      const t = b.dataset.type;
      if (t === st.type) return;
      st.type = t;
      shown = PAGE;
      params({ type: t || null });
      renderCat();
      if (b.classList.contains('btn')) box.querySelector('.mk-cchips [data-type=""]')?.focus({ preventScroll: true });
    });
    delegate(box, 'click', '[data-lang]', (e, b) => setLang(b.dataset.lang));
    delegate(box, 'change', '.mk-cchips select', (e, s) => {
      if (s.name === 'tri') {
        st.tri = sealed.SORTS[s.value] ? s.value : 'new';
        shown = PAGE;
        params({ tri: st.tri === 'new' ? null : st.tri });
        renderCat();
      } else if (s.name === 'langue') setLang(s.value);
    });
    delegate(box, 'click', '[data-more]', () => appendMore());
    delegate(box, 'click', '[data-warn]', () => infoSheet('Tendances passées', WARN));
    delegate(box, 'click', '[data-rail]', (e, b) => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      const rail = b.closest('.mk-idea')?.querySelector('.mk-rail');
      if (!rail) return;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      rail.scrollBy({ left: Number(b.dataset.rail) * Math.max(172, rail.clientWidth - 172), behavior: still ? 'auto' : 'smooth' });
    });
    box.addEventListener('scroll', e => { if (e.target.classList?.contains('mk-rail')) railNavSoon(e.target); }, { capture: true, passive: true });
    addEventListener('resize', () => { if (visible) railNavSoon(); }, { passive: true });
    delegate(box, 'click', '[data-reload]', async () => {
      if (!(await load(ctx.signal()))) return;
      build();
      renderVue();
    });
  },

  async show(r) {
    visible = true;
    const p = readParams(r);
    if (p.q !== st.q || p.type !== st.type || p.tri !== st.tri || p.lang !== st.lang) shown = PAGE;
    st = p;
    if (!sealed.loaded()) {
      if (!box.dataset.built) build();
      for (const b of box.querySelectorAll('[data-vue]')) b.setAttribute('aria-pressed', b.dataset.vue === st.vue ? 'true' : 'false');
      const holder = box.querySelector(st.vue === 'pistes' ? '.mk-pistes' : '.mk-plist');
      box.querySelector('.mk-pistes').hidden = st.vue !== 'pistes';
      box.querySelector('.mk-cat').hidden = st.vue !== 'catalogue';
      if (holder) {
        setHTML(holder, skeleton());
        holder.hidden = false;
        if (st.vue === 'catalogue') { holder.setAttribute('data-content', ''); holder.setAttribute('aria-busy', 'true'); }
      }
      keyP = keyC = '';
      if (!(await load(r.signal))) return;
      await yieldToMain();          // lecture du catalogue et premier rendu : deux tâches distinctes
    } else await ptileReady();
    if (r.signal.aborted) return;
    if (!box.dataset.built) build();
    const input = box.querySelector('.mk-search input');
    if (input && input.value.trim() !== st.q) input.value = st.q;     // adresse ouverte (lien, Retour) : le champ la suit
    flushPatch();
    renderVue();
  },

  resume() { visible = true; if (sealed.loaded() && box.dataset.built) { flushPatch(); renderVue(); } },
  hide() { visible = false; clearTimeout(qT); },

  // ☆ ou Mon scellé : tuiles et lignes corrigées sur place (au repos si la section est cachée) ; 'reload' (import,
  // autre onglet…) : tout refait, seulement si le suivi ou le scellé possédé ont changé (pas pour les cartes seules)
  onChange(events, isVisible) {
    if (events.some(e => e.type === 'reload')) {
      const sig = sigOf();
      if (sig === ownSig) return;
      ownSig = sig;
      dropPatch();
      wrev++;
      if (isVisible && sealed.loaded() && box.dataset.built) renderVue();
      return;
    }
    const mine = events.filter(e => e.type === 'watch' || e.type === 'sealed');
    if (!mine.length) return;
    ownSig = sigOf();
    if (!sealed.loaded() || !box.dataset.built) return;
    const ids = [...new Set(mine.map(e => Number(e.id)))], w = mine.some(e => e.type === 'watch');
    if (mine.length > 40) { dropPatch(); wrev++; }
    else if (isVisible) patchProducts(ids, w);
    else queuePatch(ids, w);
    if (isVisible) renderVue();     // ne refait que ce qui a été invalidé (liste « Suivis », pistes vides)
  },

  // adresse de la section avec sa vue et ses filtres : lien de l'onglet « Scellé »
  href() {
    if (/^#\/marche\/scelle(\?|$)/.test(location.hash)) return location.hash;      // section affichée : son adresse
    const q = new URLSearchParams();
    if (st.vue === 'catalogue') q.set('vue', 'catalogue');
    if (st.q) q.set('q', st.q);
    if (st.type) q.set('type', st.type);
    if (st.tri !== 'new') q.set('tri', st.tri);
    if (st.lang !== defLang()) q.set('langue', st.lang);
    const t = q.toString();
    return `#/marche/scelle${t ? `?${t}` : ''}`;
  },

  info() {
    const S = sealed.loaded() ? sealed.ideas({ lang: st.lang, watch: col.watchList() }) : [];
    return {
      title: 'Scellé',
      body: [
        'Les produits scellés du JCC vendus sur Cardmarket (displays, coffrets, bundles, blisters, Pokébox…), avec leur cote et son évolution, calculée sur l’historique que Cardex enregistre chaque jour.',
        ...WARN,
        ...S.filter(s => s.id !== 'suivis').map(s => `${s.title} : ${s.sub}`),
        'International : les produits vendus en Europe (Cardmarket ne sépare pas leurs langues). Japonais : les produits japonais, vendus à part. Les cartons et présentoirs (vente aux boutiques) ont leur propre puce dans le catalogue. Les produits que tu suis restent visibles dans toutes les langues.',
        sealed.creditText(),
        sealed.PHOTO_CREDIT,
      ],
    };
  },
};
