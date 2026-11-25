import * as api from './api.js';
import * as store from './store.js';
import * as scanner from './scanner.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmtNum = c => (c.setTotal ? `${c.localId}/${c.setTotal}` : `n° ${c.localId}`);

// ---------- Petits utilitaires d'affichage ----------
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// Finitions sans effet de brillance : on affiche seulement l'étiquette.
const NO_FX = new Set(['normal', 'firstEdition', 'stamp']);
const fxLayer = f => (f && !NO_FX.has(f) ? `<i class="fxl fx-${f}"></i>` : '');
const finishBadge = f => (f && f !== 'normal' ? `<span class="fb fb-${f}">${store.SHORT[f]}</span>` : '');

// qty : quantité affichée (par défaut le total de la carte) ; finish : une finition précise.
function tile(c, { sub = '', missing = false, qty, finish } = {}) {
  const n = qty ?? store.count(c.id);
  const src = api.img(c.image);
  return `<div class="tile ${missing && !n ? 'missing' : ''}" data-card="${esc(c.id)}"${finish ? ` data-finish="${finish}"` : ''}>
    <div class="img">${src ? `<img loading="lazy" src="${esc(src)}" alt="">` : `<div class="noimg">${esc(c.name)}</div>`}${n || !missing ? fxLayer(finish) : ''}${finishBadge(finish)}</div>
    ${n ? `<span class="qty">${n}</span>` : ''}
    <div class="name">${esc(c.name)}</div>
    <div class="sub">${esc(sub)}</div>
  </div>`;
}

// Logo d'une série, ou une plaque avec son nom (jamais le petit symbole du bas des cartes).
const plate = name => `<span class="plate">${esc(name)}</span>`;
const setLogoHtml = s => {
  const l = api.setLogo(s);
  return l ? `<img loading="lazy" src="${esc(l)}" alt="${esc(s.name)}">` : plate(s.name);
};

const empty = (title, text) => `<div class="empty"><b>${esc(title)}</b>${esc(text)}</div>`;
const spinner = '<div class="spinner"></div>';

// Une image qui ne charge pas devient une vignette avec le nom.
document.addEventListener('error', e => {
  const el = e.target;
  if (el.tagName === 'IMG' && el.dataset.fallback && el.src !== el.dataset.fallback) { el.src = el.dataset.fallback; return; }
  if (el.tagName === 'IMG' && el.closest('.ptile, .mk-row')) { el.replaceWith(Object.assign(document.createElement('div'), { className: 'pimg-ph' })); return; }
  if (el.tagName === 'IMG' && (el.classList.contains('set-sym') || el.closest('.bloc-logo'))) el.remove();
  else if (el.tagName === 'IMG' && el.closest('.set-logo, .set-head')) el.outerHTML = plate(el.alt);
  else if (el.tagName === 'IMG' && el.closest('.tile')) {
    const name = el.closest('.tile').querySelector('.name')?.textContent || '';
    el.outerHTML = `<div class="noimg">${esc(name)}</div>`;
  }
}, true);

// Clic sur n'importe quelle carte → fiche détaillée.
document.addEventListener('click', e => {
  const pk = e.target.closest('[data-poke]');
  if (pk) { if (sheetOpen) closeSheet(); return openPoke(+pk.dataset.poke); }
  const t = e.target.closest('[data-card]');
  if (t) openCard(t.dataset.card, t.dataset.finish);
});

// ---------- Navigation ----------
let current = 'scan';
function show(view) {
  current = view;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  const tabView = { set: 'sets', poke: 'collection', deck: 'decks', wishlist: 'market' }[view] || view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === tabView));
  if (view !== 'scan') stopCam();
  if (view === 'collection') renderCollection();
  if (view === 'poke') renderPoke();
  if (view === 'sets') renderSets();
  if (view === 'wishlist') renderWishlist();
  if (view === 'market') renderMarket();
  if (view === 'decks') renderDecks();
  if (view === 'deck') renderDeck();
  if (view === 'search') setTimeout(() => $('#search-input').focus(), 50);
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));

// ---------- Fiche (bottom sheet) ----------
let sheetOpen = false;
function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').classList.add('open');
  $('#backdrop').classList.add('open');
  $('#sheet').scrollTop = 0;
  if (!sheetOpen) { history.pushState({ sheet: 1 }, ''); sheetOpen = true; }
}
function hideSheet() {
  sheetOpen = false;
  currentCard = null;
  $('#sheet').classList.remove('open');
  $('#backdrop').classList.remove('open');
}
const closeSheet = () => (sheetOpen ? history.back() : hideSheet());
window.addEventListener('popstate', () => { if (sheetOpen) hideSheet(); });
$('#backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// ---------- Détail d'une carte ----------
let currentCard = null, previewFinish = 'normal';

async function openCard(id, finish) {
  openSheet(spinner);
  try {
    const full = await api.card(id);
    if (!sheetOpen) return;
    currentCard = full;
    store.refresh(full);
    previewFinish = finish || ownedFinishes(full)[0] || api.finishesOf(full)[0];
    renderCard(full);
  } catch {
    openSheet(empty('Impossible de charger la carte', 'Vérifie ta connexion internet.'));
  }
}

const ownedFinishes = full => Object.keys(store.get(full.id)?.qty || {}).sort((a, b) => store.finishOrder(a) - store.finishOrder(b));

// Finitions affichées : celles connues de TCGdex + celles ajoutées à la main.
function shownFinishes(full) {
  return [...new Set([...api.finishesOf(full), ...ownedFinishes(full)])]
    .sort((a, b) => store.finishOrder(a) - store.finishOrder(b));
}

function renderCard(full) {
  const price = api.priceOf(full, 'normal');
  const priceHolo = api.priceOf(full, 'holo');
  const tags = [full.rarity, full.category, full.hp && `${full.hp} PV`, ...(full.types || []), full.stage]
    .filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('');
  const attacks = (full.attacks || []).map(a => `<div class="attack">
      <b><span>${esc(a.name)}</span><span>${esc(a.damage ?? '')}</span></b>
      ${a.effect ? `<p>${esc(a.effect)}</p>` : ''}
    </div>`).join('');
  const src = api.img(full.image, 'high');

  openSheet(`<div class="detail">
    <div class="holo-wrap"><div class="holo" id="holo">
      ${src ? `<img src="${esc(src)}" alt="${esc(full.name)}">` : `<div class="noimg" style="height:100%;display:grid;place-items:center">${esc(full.name)}</div>`}
      <i class="fxl" id="holo-fx"></i>
    </div></div>
    <div class="preview-label" id="preview-label"></div>
    <h2>${esc(full.name)}</h2>
    <div class="meta">${esc(full.set?.name)} · ${esc(fmtNum({ localId: full.localId, setTotal: full.set?.cardCount?.official }))}${full.illustrator ? ` · ill. ${esc(full.illustrator)}` : ''}</div>
    <div class="tags">${tags}</div>
    ${pokeLink(full)}
    ${price || priceHolo ? `<div class="price">
      <div><small>Cote Cardmarket (tendance)</small><br><b>${price ? euro.format(price) : '—'}</b></div>
      ${priceHolo ? `<div style="text-align:right"><small>Reverse / Holo</small><br><b>${euro.format(priceHolo)}</b></div>` : ''}
    </div>` : ''}
    ${trendBox(full)}
    <p class="section-title">Dans ma collection</p>
    <div class="variants" id="variants"></div>
    <p class="section-title">Alerte prix</p>
    <div id="wish-box"></div>
    ${attacks ? `<p class="section-title">Attaques</p>${attacks}` : ''}
  </div>`);
  renderVariants();
  renderWishBox();
  bindHolo($('#holo'));
}

function pokeLink(full) {
  const n = dexNums(full)[0];
  return n ? `<button class="chip poke-link" data-poke="${n}">${pad(n)} ${esc(DEX[n - 1] || '')} · voir dans le Pokédex</button>` : '';
}

function applyPreview() {
  const fx = $('#holo-fx');
  if (!fx) return;
  fx.className = `fxl ${NO_FX.has(previewFinish) ? '' : `fx-${previewFinish}`}`;
  $('#preview-label').textContent = `Aperçu : ${store.VARIANTS[previewFinish]}`;
  const tb = $('#trend-box');
  if (tb && currentCard) tb.outerHTML = trendBox(currentCard);
}

function renderVariants() {
  const full = currentCard, box = $('#variants');
  if (!full || !box) return;
  const rec = store.get(full.id);
  const shown = shownFinishes(full);
  const others = Object.keys(store.VARIANTS).filter(v => !shown.includes(v));
  box.innerHTML = shown.map(v => `<div class="variant ${v === previewFinish ? 'sel' : ''}" data-preview="${v}">
      <span><i class="dot dot-${v}"></i>${store.VARIANTS[v]}</span>
      <div class="stepper">
        <button data-step="${v}" data-d="-1" aria-label="Retirer">−</button>
        <span>${rec?.qty[v] || 0}</span>
        <button class="plus" data-step="${v}" data-d="1" aria-label="Ajouter">+</button>
      </div>
    </div>`).join('') + (others.length ? `<select class="add-finish" id="add-finish">
      <option value="">+ Ma carte a une autre finition…</option>
      ${others.map(v => `<option value="${v}">${store.VARIANTS[v]}</option>`).join('')}
    </select>` : '');
  $('#add-finish')?.addEventListener('change', e => {
    const v = e.target.value;
    if (!v) return;
    store.add(full, v);
    previewFinish = v;
    renderVariants();
    toast(`Ajoutée en ${store.VARIANTS[v]}`);
  });
  applyPreview();
}

$('#sheet-body').addEventListener('click', e => {
  if (e.target.closest('[data-wish-add]')) return addWish();
  const del = e.target.closest('[data-wish-del]');
  if (del) return WishDB.del(del.dataset.wishDel).then(() => { renderWishBox(); refreshWishDot(); toast('Alerte supprimée'); });
  if (!currentCard) return;
  const b = e.target.closest('[data-step]');
  if (b) {
    const v = b.dataset.step, d = +b.dataset.d;
    const n = Math.max(0, (store.get(currentCard.id)?.qty[v] || 0) + d);
    store.setQty(currentCard, v, n);
    previewFinish = v;
    renderVariants();
    if (d > 0) navigator.vibrate?.(15);
    return;
  }
  const p = e.target.closest('[data-preview]');
  if (p) { previewFinish = p.dataset.preview; renderVariants(); }
});

// Effet holographique qui suit le doigt / la souris.
function bindHolo(el) {
  if (!el) return;
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(x - 0.5) * 24}deg`);
    el.style.setProperty('--rx', `${(0.5 - y) * 24}deg`);
    el.style.setProperty('--mx', `${x * 100}%`);
    el.style.setProperty('--my', `${y * 100}%`);
    el.style.setProperty('--shine', '0.9');
  });
  el.addEventListener('pointerleave', () => {
    ['--rx', '--ry'].forEach(p => el.style.setProperty(p, '0deg'));
    el.style.setProperty('--shine', '0');
  });
}

// ---------- Scanner ----------
const video = $('#video');
let camOn = false, torchOn = false, busy = false;

async function startCam() {
  if (!scanner.cameraSupported()) {
    $('#camera-off-text').textContent = "La caméra en direct n'est pas disponible ici (il faut une adresse https). Utilise le bouton photo à gauche.";
    $('#btn-start-cam').textContent = 'Prendre une photo';
    $('#btn-start-cam').onclick = () => $('#file-input').click();
    return;
  }
  try {
    const caps = await scanner.startCamera(video);
    camOn = true;
    $('#camera-off').classList.add('hidden');
    $('#btn-torch').disabled = !caps.torch;
    scanner.warmUp(); // prépare l'OCR pendant qu'on cadre
  } catch {
    $('#camera-off-text').textContent = "Accès à la caméra refusé. Autorise-la dans les réglages du navigateur, ou utilise le bouton photo.";
  }
}

function stopCam() {
  if (!camOn) return;
  scanner.stopCamera();
  camOn = false; torchOn = false;
  $('#btn-torch').classList.remove('on');
  $('#camera-off').classList.remove('hidden');
}

$('#btn-start-cam').addEventListener('click', startCam);
$('#btn-torch').addEventListener('click', async () => {
  torchOn = !torchOn;
  try { await scanner.setTorch(torchOn); $('#btn-torch').classList.toggle('on', torchOn); } catch { torchOn = false; }
});
$('#btn-shutter').addEventListener('click', () => {
  if (camOn) process(scanner.captureGuide(video, $('#guide')));
  else $('#file-input').click();
});
$('#file-input').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) process(await scanner.fileToCanvas(f));
});

let lastWords = [];
async function process(canvas) {
  if (busy) return;
  busy = true;
  const status = $('#scan-status');
  $('#btn-shutter').disabled = true;
  $('.camera').classList.add('scanning');
  $('#scan-results').innerHTML = '';
  try {
    const read = await scanner.read(canvas, s => (status.textContent = s));
    lastWords = read.words;
    status.textContent = 'Identification…';
    const found = await scanner.identify(read);
    const hint = [read.number && `${read.number.num}/${read.number.total}`, read.words[0]].filter(Boolean).join(' · ');
    status.textContent = hint ? `Lu : ${hint}` : '';
    renderScanResults(found);
    if (found.length) navigator.vibrate?.(30);
  } catch (err) {
    status.textContent = '';
    $('#scan-results').innerHTML = empty('Oups', err.message || 'Erreur pendant le scan.');
  } finally {
    busy = false;
    $('#btn-shutter').disabled = false;
    $('.camera').classList.remove('scanning');
  }
}

function renderScanResults(list) {
  const box = $('#scan-results');
  if (!list.length) {
    box.innerHTML = `${empty('Carte non reconnue', 'Rapproche-toi pour que le numéro en bas de la carte soit net, ou cherche-la par son nom.')}
      <div style="text-align:center"><button class="btn primary" id="go-search">Chercher par nom</button></div>`;
    $('#go-search').onclick = () => {
      show('search');
      if (lastWords[0]) { $('#search-input').value = lastWords[0]; runSearch(); }
    };
    return;
  }
  const [best, ...others] = list;
  const src = api.img(best.image);
  box.innerHTML = `<div class="best">
      ${src ? `<img src="${esc(src)}" alt="" data-card="${esc(best.id)}">` : ''}
      <div class="info">
        <div class="label">Carte trouvée</div>
        <h2>${esc(best.name)}</h2>
        <div class="meta">${esc(best.setName)} · ${esc(fmtNum(best))}</div>
        <div style="font-size:13px;color:var(--muted)">Touche une version pour l'ajouter à ta collection :</div>
        <div class="quick" id="quick"><span class="chip">…</span></div>
        <div class="added-line" id="quick-done"></div>
      </div>
    </div>
    ${others.length ? `<p class="others-title">Ce n'est pas elle ? Autres possibilités :</p>
      <div class="others">${others.map(c => tile(c, { sub: c.setName })).join('')}</div>` : ''}`;

  // Une puce par finition connue + « Autre » pour la choisir à la main dans la fiche.
  api.card(best.id).then(full => {
    const q = $('#quick');
    if (!q) return;
    q.innerHTML = api.finishesOf(full).map(v => `<button class="chip" data-quick="${v}"><i class="dot dot-${v}"></i>${store.SHORT[v]}</button>`).join('')
      + `<button class="chip" data-card="${esc(full.id)}">Autre…</button>`;
    q.onclick = e => {
      const b = e.target.closest('[data-quick]');
      if (!b) return;
      store.add(full, b.dataset.quick);
      navigator.vibrate?.(20);
      toast(`${full.name} ajoutée en ${store.VARIANTS[b.dataset.quick]} (${store.get(full.id).qty[b.dataset.quick]})`);
      const n = dexNums(full)[0];
      $('#quick-done').innerHTML = `✓ Dans ta collection (${store.count(full.id)})${n ? ` · <button data-poke="${n}">voir ${esc(DEX[n - 1] || '')} dans le Pokédex</button>` : ''}`;
    };
  }).catch(() => { const q = $('#quick'); if (q) q.innerHTML = '<span class="chip">Hors-ligne</span>'; });
}

// ---------- Recherche ----------
let searchT, searchSeq = 0;
$('#search-input').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 350); });

async function runSearch() {
  const q = $('#search-input').value.trim();
  const box = $('#search-results');
  if (q.length < 2) { box.innerHTML = empty('Trouve n\'importe quelle carte', 'Tape au moins 2 lettres.'); return; }
  const seq = ++searchSeq;
  box.innerHTML = spinner;
  try {
    const [res, sets] = await Promise.all([api.search(q), api.setsById()]);
    if (seq !== searchSeq) return;
    const list = res
      .map(c => ({ ...c, set: sets.get(api.setIdOf(c.id)) }))
      .filter(c => c.set) // écarte les cartes Pokémon TCG Pocket
      .sort((a, b) => (!!b.image - !!a.image) || ((b.set?.order ?? 0) - (a.set?.order ?? 0)));
    box.innerHTML = list.length
      ? list.map(c => tile(c, { sub: `${c.set?.name || ''} · ${c.localId}` })).join('')
      : empty('Aucun résultat', `Rien pour « ${q} ».`);
  } catch {
    if (seq === searchSeq) box.innerHTML = empty('Erreur', 'Vérifie ta connexion internet.');
  }
}

// ---------- Collection ----------
let colMode = 'cards', colFinish = 'all';
$('#col-filter').addEventListener('input', renderCollection);
$('#col-sort').addEventListener('change', renderCollection);
$('#col-mode').addEventListener('click', e => {
  const b = e.target.closest('[data-m]');
  if (!b) return;
  colMode = b.dataset.m;
  document.querySelectorAll('#col-mode button').forEach(x => x.classList.toggle('active', x === b));
  renderCollection();
});
$('#col-finish').addEventListener('click', e => {
  const c = e.target.closest('[data-f]');
  if (!c) return;
  colFinish = c.dataset.f;
  renderCollection();
});

function renderCollection() {
  for (const m of ['cards', 'dex', 'dup', 'ach']) $(`#col-${m}`).hidden = colMode !== m;
  if (colMode === 'dex') return renderDex();
  if (colMode === 'dup') return renderDoubles();
  if (colMode === 'ach') return renderAchievements();

  const s = store.stats();
  $('#stats').innerHTML = `
    <div class="stat"><div class="v">${s.total}</div><div class="k">cartes</div></div>
    <div class="stat"><div class="v">${s.unique}</div><div class="k">différentes</div></div>
    <div class="stat"><div class="v">${s.sets}</div><div class="k">séries</div></div>
    <div class="stat gold"><div class="v">${euro.format(s.value)}</div><div class="k">valeur estimée</div></div>`;
  renderTrend();

  // Une entrée par carte ET par finition : une reverse et une normale sont deux cartes distinctes.
  const entries = store.all().flatMap(rec => Object.entries(rec.qty).map(([f, n]) => ({ rec, f, n })));
  const counts = {};
  for (const e of entries) counts[e.f] = (counts[e.f] || 0) + e.n;
  if (colFinish !== 'all' && !counts[colFinish]) colFinish = 'all';
  const finishes = Object.keys(counts).sort((a, b) => store.finishOrder(a) - store.finishOrder(b));
  $('#col-finish').innerHTML = finishes.length > 1
    ? `<button class="chip ${colFinish === 'all' ? 'active' : ''}" data-f="all">Toutes</button>` + finishes.map(f =>
      `<button class="chip ${colFinish === f ? 'active' : ''}" data-f="${f}"><i class="dot dot-${f}"></i>${store.SHORT[f]}<span class="n">${counts[f]}</span></button>`).join('')
    : '';

  const q = scanner.norm($('#col-filter').value.trim());
  const sort = $('#col-sort').value;
  const list = entries.filter(({ rec, f }) =>
    (colFinish === 'all' || f === colFinish) && (!q || scanner.norm(`${rec.name} ${rec.setName}`).includes(q)));
  const byFinish = (a, b) => store.finishOrder(a.f) - store.finishOrder(b.f);
  const dexNo = r => dexNums(r)[0] ?? 99999;
  const by = {
    recent: (a, b) => b.rec.addedAt - a.rec.addedAt || byFinish(a, b),
    name: (a, b) => a.rec.name.localeCompare(b.rec.name, 'fr') || byFinish(a, b),
    dex: (a, b) => dexNo(a.rec) - dexNo(b.rec) || a.rec.name.localeCompare(b.rec.name, 'fr') || byFinish(a, b),
    set: (a, b) => a.rec.setName.localeCompare(b.rec.setName, 'fr') || (parseInt(a.rec.localId) || 0) - (parseInt(b.rec.localId) || 0) || byFinish(a, b),
    price: (a, b) => store.priceFor(b.rec, b.f) * b.n - store.priceFor(a.rec, a.f) * a.n,
  };
  list.sort(by[sort]);
  if (sort === 'dex') backfillDex();
  $('#col-grid').innerHTML = list.length
    ? list.map(({ rec, f, n }) => tile(rec, { sub: `${rec.setName} · ${rec.localId}`, qty: n, finish: f })).join('')
    : entries.length
      ? empty('Aucune carte', 'Rien ne correspond au filtre.')
      : empty('Ta collection est vide', 'Scanne ta première carte avec l\'onglet Scanner !');
}

// ---------- Pokédex ----------
let DEX = [];
const dexReady = fetch('data/pokedex.json').then(r => r.json()).then(d => { DEX = d; }).catch(() => {});
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const sprite = n => `${SPRITES}/${n}.png`;
const artwork = n => `${SPRITES}/other/official-artwork/${n}.png`;
const pad = n => `#${String(n).padStart(4, '0')}`;
let dexFilter = 'all', dexT, backfilling = false;
const backfillFailed = new Set();

// Numéros de Pokédex d'une carte : ceux de TCGdex, sinon devinés d'après le nom
// (« Méga-Lucario-ex » → 448), pour qu'aucune carte possédée ne reste grisée dans le Pokédex.
let DEX_INDEX = null;
const words = s => ` ${scanner.norm(s).replace(/[^a-z0-9♀♂]+/g, ' ').trim()} `;
function guessDex(name) {
  if (!DEX.length || !name) return [];
  DEX_INDEX ??= DEX.map((n, i) => [words(n), i + 1]).sort((a, b) => b[0].length - a[0].length);
  // les noms longs d'abord (Mewtwo avant Mew), et tous ceux d'une carte duo (« Méga-Ténéfix et Tyranocif »)
  let s = words(name);
  const out = [];
  for (const [n, i] of DEX_INDEX) if (s.includes(n)) { out.push(i); s = s.replace(n, ' '); }
  return out;
}
const dexNums = c => (c.dexId?.length ? c.dexId : c.category && c.category !== 'Pokémon' ? [] : guessDex(c.name));
function ownedByDex() {
  const m = new Map();
  for (const r of store.all()) for (const n of dexNums(r)) m.set(n, (m.get(n) || 0) + 1);
  return m;
}

$('#dex-filter').addEventListener('input', () => { clearTimeout(dexT); dexT = setTimeout(renderDex, 150); });
$('#dex-chips').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  dexFilter = c.dataset.f;
  document.querySelectorAll('#dex-chips .chip').forEach(x => x.classList.toggle('active', x === c));
  renderDex();
});
$('#dex-grid').addEventListener('click', e => {
  const c = e.target.closest('[data-dex]');
  if (c) openPoke(+c.dataset.dex);
});

// Les cartes enregistrées avant le Pokédex n'ont pas leur numéro : on le récupère une fois.
async function backfillDex() {
  const todo = store.all().filter(r => r.dexId === undefined && !backfillFailed.has(r.id));
  if (!todo.length || backfilling) return;
  backfilling = true;
  let ok = 0;
  for (const r of todo) {
    try { store.refresh(await api.card(r.id), false); ok++; } catch { backfillFailed.add(r.id); }
  }
  backfilling = false;
  if (ok) store.flush();
}

async function renderDex() {
  await dexReady;
  backfillDex();
  const owned = ownedByDex();
  const raw = $('#dex-filter').value.trim();
  const q = scanner.norm(raw), num = parseInt(raw, 10);
  const items = DEX.map((name, i) => ({ n: i + 1, name }))
    .filter(p => (!raw || (num ? String(p.n).startsWith(String(num)) : scanner.norm(p.name).includes(q)))
      && (dexFilter === 'all' || (dexFilter === 'owned') === owned.has(p.n)));
  const have = DEX.filter((_, i) => owned.has(i + 1)).length;
  const pct = DEX.length ? (have / DEX.length) * 100 : 0;
  $('#dex-progress').innerHTML = `${have} / ${DEX.length} Pokémon dans ta collection<div class="bar"><i style="width:${pct}%"></i></div>`;
  $('#dex-grid').innerHTML = items.length ? items.map(p => {
    const c = owned.get(p.n);
    return `<button class="dex-cell ${c ? 'own' : ''}" data-dex="${p.n}">
      <img loading="lazy" src="${sprite(p.n)}" alt="">
      <span class="no">${pad(p.n)}</span><span class="nm">${esc(p.name)}</span>
      ${c ? `<span class="cnt">${c}</span>` : ''}
    </button>`;
  }).join('') : empty('Aucun Pokémon', 'Rien ne correspond à ta recherche.');
}

// ---------- Fiche d'un Pokémon : toutes ses cartes, possédées ou non ----------
let currentPoke = null, pokeCards = null, pokeFins = {}, pokeFilter = 'all';
async function openPoke(n) {
  currentPoke = n; pokeCards = null; pokeFilter = 'all';
  document.querySelectorAll('#poke-chips .chip').forEach(x => x.classList.toggle('active', x.dataset.f === 'all'));
  show('poke');
  try {
    const [res, byName, sets, fins] = await Promise.all([api.byDex(n), api.search(DEX[n - 1] || '-', 0).catch(() => []),
      api.setsById(), api.dexFinishes(n).catch(() => ({}))]);
    if (currentPoke !== n) return;
    // Les séries récentes n'ont pas encore de numéro de Pokédex dans TCGdex (ex. Règne Delta) :
    // on ajoute les cartes trouvées par le nom, puis celles de la collection.
    const all = new Map(res.map(c => [c.id, c]));
    for (const c of byName) if (!all.has(c.id) && guessDex(c.name).includes(n)) all.set(c.id, c);
    for (const r of store.all()) if (!all.has(r.id) && dexNums(r).includes(n)) all.set(r.id, r);
    pokeFins = fins;
    pokeCards = [...all.values()].filter(c => sets.has(api.setIdOf(c.id)))
      .map(c => ({ ...c, set: sets.get(api.setIdOf(c.id)) }))
      .sort((a, b) => b.set.order - a.set.order || (parseInt(a.localId, 10) || 0) - (parseInt(b.localId, 10) || 0));
    renderPoke();
    // finitions des cartes absentes de la recherche par numéro (fiche complète de chaque carte)
    const todo = pokeCards.filter(c => !pokeFins[c.id]);
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < todo.length && currentPoke === n) {
        const c = todo[i++];
        try { pokeFins[c.id] = api.finishesOf(await api.card(c.id)); } catch { /* reste « normale » */ }
      }
    }));
    if (currentPoke !== n) return;
  } catch { pokeCards = []; }
  renderPoke();
}

function renderPoke() {
  const n = currentPoke;
  if (!n) return;
  const mine = store.all().filter(r => dexNums(r).includes(n))
    .flatMap(rec => Object.entries(rec.qty).map(([f, q]) => ({ rec, f, q })))
    .sort((a, b) => a.rec.setName.localeCompare(b.rec.setName, 'fr') || store.finishOrder(a.f) - store.finishOrder(b.f));
  const ownedIds = new Set(mine.map(m => m.rec.id));
  // une entrée par version (normale, reverse, holo…) de chaque carte : les brillantes en plus des normales
  const versions = (pokeCards || []).flatMap(c => {
    const rec = store.get(c.id);
    return [...new Set([...(pokeFins[c.id] || ['normal']), ...Object.keys(rec?.qty || {})])]
      .sort((a, b) => store.finishOrder(a) - store.finishOrder(b))
      .map(f => ({ c, f, n: rec?.qty[f] || 0 }));
  });
  const vHave = versions.filter(v => v.n).length;
  const tot = pokeCards?.length;
  $('#poke-head').innerHTML = `<div class="poke-head">
    <img src="${artwork(n)}" alt="">
    <div class="body">
      <div class="no">${pad(n)}</div>
      <h1>${esc(DEX[n - 1] || '')}</h1>
      ${tot ? `<div class="count">${ownedIds.size} / ${tot} cartes différentes</div>
        <div class="bar ${ownedIds.size >= tot ? 'done' : ''}"><i style="width:${Math.min(100, ownedIds.size / tot * 100)}%"></i></div>
        <div class="count" style="margin-top:8px">${vHave} / ${versions.length} versions (normales et brillantes)</div>
        <div class="bar ${vHave >= versions.length ? 'done' : ''}"><i style="width:${Math.min(100, vHave / versions.length * 100)}%"></i></div>` : ''}
    </div>
  </div>`;
  $('#poke-mine').innerHTML = mine.length
    ? mine.map(({ rec, f, q }) => tile(rec, { sub: `${rec.setName} · ${rec.localId}`, qty: q, finish: f })).join('')
    : empty('Pas encore', 'Tu n\'as aucune carte de ce Pokémon.');
  if (!pokeCards) { $('#poke-all').innerHTML = spinner; return; }
  const list = versions.filter(v => pokeFilter === 'all' || (pokeFilter === 'owned') === !!v.n);
  $('#poke-all').innerHTML = list.length
    ? list.map(({ c, f, n }) => tile(c, { sub: `${c.set.name} · ${c.localId}`, qty: n, finish: f, missing: true })).join('')
    : empty(pokeFilter === 'missing' ? 'Tu les as toutes !' : 'Aucune carte', '');
}

$('#poke-back').addEventListener('click', () => show('collection'));
$('#poke-chips').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  pokeFilter = c.dataset.f;
  document.querySelectorAll('#poke-chips .chip').forEach(x => x.classList.toggle('active', x === c));
  renderPoke();
});

// ---------- Séries ----------
$('#sets-filter').addEventListener('input', renderSets);
$('#sets-mine').addEventListener('change', renderSets);

async function renderSets() {
  const box = $('#set-list');
  if (!box.children.length) box.innerHTML = spinner;
  let list, blocs;
  try { [list, blocs] = await Promise.all([api.sets(), api.series().catch(() => []), api.logosReady]); } catch { box.innerHTML = empty('Erreur', 'Vérifie ta connexion internet.'); return; }
  const owned = store.ownedBySet();
  const q = scanner.norm($('#sets-filter').value.trim());
  const mine = $('#sets-mine').checked;
  const keep = s => (!q || scanner.norm(s.name).includes(q)) && (!mine || owned.has(s.id));
  const row = s => {
    const have = owned.get(s.id) || 0;
    const tot = s.cardCount?.official || s.cardCount?.total || 0;
    const pct = tot ? Math.min(100, (have / tot) * 100) : 0;
    return `<button class="set-row" data-set="${esc(s.id)}">
      <div class="set-logo">${setLogoHtml(s)}</div>
      <div class="body">
        <div class="title">${esc(s.name)}</div>
        <div class="count">${have} / ${tot}</div>
        <div class="bar ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>
      </div>
    </button>`;
  };
  // Comme dans un classeur de collection : les séries rangées par bloc, le plus récent en haut.
  const byId = new Map(list.map(s => [s.id, s]));
  const seen = new Set();
  const groups = blocs.map(b => ({ ...b, sets: b.sets.map(id => byId.get(id)).filter(s => s && !seen.has(s.id) && seen.add(s.id)) }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const rest = list.filter(s => !seen.has(s.id));
  if (rest.length) groups.push({ id: 'autres', name: 'Autres séries', sets: rest });
  const html = groups.map((g, i) => {
    const sets = [...g.sets].reverse().filter(keep);
    if (!sets.length) return '';
    const mineIn = g.sets.filter(s => owned.has(s.id)).length;
    const cards = g.sets.reduce((n, s) => n + (owned.get(s.id) || 0), 0);
    const open = q || mine || (openBlocs ? openBlocs.has(g.id) : i === 0 || mineIn > 0);
    return `<details class="bloc" data-bloc="${esc(g.id)}"${open ? ' open' : ''}>
      <summary>
        <span class="bloc-logo">${g.logo ? `<img loading="lazy" src="${esc(g.logo)}.webp" alt="">` : ''}</span>
        <span class="bloc-name">${esc(g.name)}<small>${g.date ? `${g.date.slice(0, 4)} · ` : ''}${g.sets.length} séries${cards ? ` · ${cards} de tes cartes` : ''}</small></span>
        <svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
      </summary>
      <div class="set-list">${sets.map(row).join('')}</div>
    </details>`;
  }).join('');
  box.innerHTML = html || empty('Aucune série', mine ? 'Tu n\'as encore aucune carte.' : 'Rien ne correspond.');
}

// Blocs ouverts ou fermés : retenus sur l'appareil.
let openBlocs = (() => { try { const v = JSON.parse(localStorage.getItem('cardex.blocs')); return Array.isArray(v) ? new Set(v) : null; } catch { return null; } })();
$('#set-list').addEventListener('toggle', e => {
  const d = e.target.closest?.('.bloc');
  if (!d || $('#sets-filter').value.trim() || $('#sets-mine').checked) return;
  openBlocs ??= new Set([...document.querySelectorAll('#set-list .bloc[open]')].map(x => x.dataset.bloc));
  d.open ? openBlocs.add(d.dataset.bloc) : openBlocs.delete(d.dataset.bloc);
  try { localStorage.setItem('cardex.blocs', JSON.stringify([...openBlocs])); } catch {}
}, true);

$('#set-list').addEventListener('click', e => {
  const r = e.target.closest('[data-set]');
  if (r) openSet(r.dataset.set);
});

let currentSet = null, setFilter = 'all', setMode = 'master', setFinishMap = null, deepProgress = null;
let setView = 'grid', binderPage = 0;
async function openSet(id) {
  show('set');
  currentSet = null; setFinishMap = null; deepProgress = null; binderPage = 0;
  $('#set-head').innerHTML = '';
  $('#set-deep').innerHTML = '';
  $('#set-grid').innerHTML = spinner;
  try {
    const [s] = await Promise.all([api.set(id), api.logosReady]);
    currentSet = s;
    renderSet();
    if (setMode === 'master' || setView === 'list') loadFinishes();
  } catch {
    $('#set-grid').innerHTML = empty('Erreur', 'Vérifie ta connexion internet.');
  }
}

// Les séries Écarlate et Violet / Méga-Évolution ont des reverses Poké Ball, Master Ball, Cosmo : analysées d'office.
const autoDeep = id => /^(sv|me)\d/.test(id || '');

async function loadFinishes(deep) {
  const s = currentSet;
  if (!s) return;
  deep ??= autoDeep(s.id) && !api.finishesDeep(s.id);
  try {
    let map = await api.setFinishes(s); // rapide (GraphQL), ou complet si déjà analysé
    if (currentSet === s) { setFinishMap = map; renderSet(); }
    if (!deep) return;
    deepProgress = '0';
    if (currentSet === s) renderDeepBox();
    map = await api.setFinishes(s, (i, n) => {
      deepProgress = `${i} / ${n}`;
      if (currentSet === s) renderDeepBox();
    });
    deepProgress = null;
    if (currentSet === s) { setFinishMap = map; renderSet(); }
  } catch {
    deepProgress = null;
    if (currentSet === s) $('#set-grid').innerHTML = empty('Erreur', 'Impossible de charger les finitions.');
  }
}

// Master set : chaque finition de chaque carte (finitions connues + celles ajoutées à la main).
function masterEntries() {
  return currentSet.cards.flatMap(c => {
    const rec = store.get(c.id);
    const fins = [...new Set([...(setFinishMap[c.id] || ['normal']), ...Object.keys(rec?.qty || {})])]
      .sort((a, b) => store.finishOrder(a) - store.finishOrder(b));
    return fins.map(f => ({ c, f, n: rec?.qty[f] || 0 }));
  });
}

function renderDeepBox() {
  const box = $('#set-deep');
  if ((setMode !== 'master' && setView !== 'list') || setView === 'binder' || !currentSet) { box.innerHTML = ''; return; }
  box.innerHTML = deepProgress
    ? `<div class="deep-box"><span>Analyse des finitions spéciales… ${deepProgress}</span></div>`
    : api.finishesDeep(currentSet.id)
      ? '<div class="deep-box"><span>✓ Reverses Poké Ball, Master Ball et Cosmo incluses</span></div>'
      : `<div class="deep-box"><span>Le master set compte les versions normale, reverse et holo. Inclure aussi les reverses Poké Ball, Master Ball, Cosmo ?</span>
         <button class="btn" id="btn-deep">Analyser</button></div>`;
  $('#btn-deep')?.addEventListener('click', () => loadFinishes(true));
}

function renderSet() {
  const s = currentSet;
  if (!s) return;
  const tot = s.cardCount?.official || s.cards.length;
  const have = s.cards.filter(c => store.count(c.id)).length;
  const pct = Math.min(100, (have / tot) * 100);
  const master = setMode === 'master' && setFinishMap ? masterEntries() : null;
  const mHave = master?.filter(e => e.n).length, mTot = master?.length;
  const date = s.releaseDate ? new Date(s.releaseDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const facts = [s.serie?.name, date && `sortie le ${date}`].filter(Boolean).map(esc).join(' · ');
  const code = s.abbreviation?.official || s.abbreviation?.localized;
  const legal = s.legal?.standard ? '<span class="pill ok">Jouable en Standard</span>' : s.legal?.expanded ? '<span class="pill">Étendu</span>' : '';
  $('#set-head').innerHTML = `<div class="set-head">
    ${setLogoHtml(s)}
    <div class="body">
      <div class="set-facts">${s.symbol ? `<img class="set-sym" src="${esc(s.symbol)}.webp" alt="">` : ''}${code ? `<span class="pill code">${esc(code)}</span>` : ''}${legal}</div>
      <h1>${esc(s.name)}</h1>
      ${facts ? `<div class="count">${facts}</div>` : ''}
      <div class="count">${have} / ${tot} cartes${s.cards.length > tot ? ` (+${s.cards.length - tot} secrètes)` : ''}</div>
      <div class="bar ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>
      ${master ? `<div class="count" style="margin-top:8px">Toutes les versions (master set) : ${mHave} / ${mTot}</div>
        <div class="bar ${mHave >= mTot ? 'done' : ''}"><i style="width:${Math.min(100, mHave / mTot * 100)}%"></i></div>` : ''}
    </div>
  </div>`;
  renderDeepBox();
  $('#set-mode').hidden = setView !== 'grid';
  $('#set-chips').hidden = setView === 'binder';
  $('#set-hint').innerHTML = {
    grid: setMode === 'master'
      ? '<b>Toutes les versions</b> : chaque carte et chacune de ses brillantes (reverse, holo, Poké Ball…), pour un master set. <b>Une par carte</b> : une seule version suffit.'
      : '<b>Une par carte</b> : une carte compte dès que tu en as une version. <b>Toutes les versions</b> affiche aussi chaque brillante.',
    list: 'Coche directement les versions que tu possèdes : un appui ajoute la carte, un second la retire. Avec plusieurs exemplaires, l\'appui ouvre la fiche.',
    binder: 'Ta série rangée comme dans un vrai classeur, 9 cartes par page. Les pochettes vides sont les cartes qui te manquent. Glisse ou utilise les flèches pour tourner les pages.',
  }[setView];
  if (setView === 'list') return renderChecklist(tot);
  if (setView === 'binder') return renderBinder(tot);

  if (setMode === 'master') {
    if (!master) { $('#set-grid').innerHTML = spinner; return; }
    const list = master.filter(e => setFilter === 'all' || (setFilter === 'owned') === !!e.n);
    $('#set-grid').innerHTML = list.length
      ? list.map(({ c, f, n }) => tile(c, { sub: `${c.localId}/${tot} · ${store.SHORT[f]}`, qty: n, finish: f, missing: true })).join('')
      : empty(setFilter === 'owned' ? 'Aucune carte possédée' : 'Master set complet !', '');
    return;
  }
  const cards = s.cards.filter(c => setFilter === 'all' || (setFilter === 'owned') === !!store.count(c.id));
  $('#set-grid').innerHTML = cards.length
    ? cards.map(c => tile(c, { sub: `${c.localId}/${tot}`, missing: true })).join('')
    : empty(setFilter === 'owned' ? 'Aucune carte possédée' : 'Série complète !', '');
}

$('#set-back').addEventListener('click', () => show('sets'));
$('#set-mode').addEventListener('click', e => {
  const b = e.target.closest('[data-m]');
  if (!b) return;
  setMode = b.dataset.m;
  document.querySelectorAll('#set-mode button').forEach(x => x.classList.toggle('active', x === b));
  renderSet();
  if (setMode === 'master' && !setFinishMap) loadFinishes();
});
$('#set-chips').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  setFilter = c.dataset.f;
  document.querySelectorAll('#set-chips .chip').forEach(x => x.classList.toggle('active', x === c));
  renderSet();
});
$('#set-view').addEventListener('click', e => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  setView = b.dataset.v;
  document.querySelectorAll('#set-view button').forEach(x => x.classList.toggle('active', x === b));
  renderSet();
  if (setView === 'list' && !setFinishMap) loadFinishes();
});

// Liste à cocher : une ligne par carte, une case par version.
function renderChecklist(tot) {
  const s = currentSet;
  const cards = s.cards.filter(c => setFilter === 'all' || (setFilter === 'owned') === !!store.count(c.id));
  if (!setFinishMap && !cards.some(c => store.count(c.id))) { $('#set-grid').innerHTML = spinner; return; }
  $('#set-grid').innerHTML = cards.length ? `<div class="checklist">${cards.map(c => {
    const rec = store.get(c.id);
    const fins = [...new Set([...(setFinishMap?.[c.id] || ['normal']), ...Object.keys(rec?.qty || {})])]
      .sort((a, b) => store.finishOrder(a) - store.finishOrder(b));
    const src = api.img(c.image);
    return `<div class="chk-row ${rec ? 'own' : ''}">
      <span class="chk-no">${esc(c.localId)}<small>/${tot}</small></span>
      <div class="chk-img" data-card="${esc(c.id)}">${src ? `<img loading="lazy" src="${esc(src)}" alt="">` : ''}</div>
      <div class="chk-nm" data-card="${esc(c.id)}">${esc(c.name)}</div>
      <div class="chk-fins">${fins.map(f => {
        const q = rec?.qty[f] || 0;
        return `<button class="tick ${q ? 'on' : ''}" data-tick="${esc(c.id)}" data-fin="${f}" aria-pressed="${!!q}" title="${esc(store.VARIANTS[f])}">
          <i class="dot dot-${f}"></i>${store.SHORT[f]}${q > 1 ? ` <b>×${q}</b>` : ''}</button>`;
      }).join('')}</div>
    </div>`;
  }).join('')}</div>` : empty(setFilter === 'owned' ? 'Aucune carte possédée' : 'Série complète !', '');
}

$('#set-grid').addEventListener('click', async e => {
  const b = e.target.closest('[data-tick]');
  if (b && currentSet) {
    const s = currentSet, c = s.cards.find(x => x.id === b.dataset.tick), f = b.dataset.fin;
    const q = store.get(c.id)?.qty[f] || 0;
    if (q > 1) return openCard(c.id, f);
    // carte déjà en collection : on garde ses infos complètes (prix, Pokédex) en passant par sa fiche
    const brief = { ...c, set: { id: s.id, name: s.name, cardCount: s.cardCount } };
    const full = store.get(c.id) ? await api.card(c.id).catch(() => null) : null;
    store.setQty(full || brief, f, q ? 0 : 1);
    toast(q ? `${c.name} (${store.SHORT[f]}) retirée` : `${c.name} (${store.SHORT[f]}) ajoutée`);
    if (!full && !q) api.card(c.id).then(x => store.refresh(x)).catch(() => {});
    return;
  }
  const p = e.target.closest('[data-bp]');
  if (p) turnPage(+p.dataset.bp);
});

// Classeur : 9 pochettes par page, dans l'ordre des numéros.
const POCKETS = 9;
function renderBinder(tot) {
  const cards = currentSet.cards;
  const pages = Math.max(1, Math.ceil(cards.length / POCKETS));
  binderPage = Math.max(0, Math.min(binderPage, pages - 1));
  const slice = cards.slice(binderPage * POCKETS, (binderPage + 1) * POCKETS);
  const have = slice.filter(c => store.count(c.id)).length;
  const fill = Array.from({ length: POCKETS - slice.length }, () => '<div class="pocket blank"></div>').join('');
  $('#set-grid').innerHTML = `<div class="binder">
    <div class="binder-nav">
      <button class="btn" data-bp="-1" ${binderPage ? '' : 'disabled'} aria-label="Page précédente"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="binder-info"><b>Page ${binderPage + 1} / ${pages}</b><small>cartes ${esc(slice[0]?.localId || '')} à ${esc(slice.at(-1)?.localId || '')} · ${have} / ${slice.length} sur cette page</small></div>
      <button class="btn" data-bp="1" ${binderPage < pages - 1 ? '' : 'disabled'} aria-label="Page suivante"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>
    <div class="binder-page">${slice.map(c => `<div class="pocket">${tile(c, { sub: `${c.localId}/${tot}`, missing: true })}</div>`).join('')}${fill}</div>
    <div class="binder-dots">${Array.from({ length: pages }, (_, i) => `<i class="${i === binderPage ? 'on' : ''}"></i>`).join('')}</div>
  </div>`;
}
function turnPage(d) {
  const pages = Math.ceil((currentSet?.cards.length || 0) / POCKETS);
  const next = binderPage + d;
  if (next < 0 || next >= pages) return;
  binderPage = next;
  renderSet();
}
let swipeX = null;
$('#set-grid').addEventListener('touchstart', e => { swipeX = setView === 'binder' ? e.touches[0].clientX : null; }, { passive: true });
$('#set-grid').addEventListener('touchend', e => {
  if (swipeX === null) return;
  const dx = e.changedTouches[0].clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 60) turnPage(dx < 0 ? 1 : -1);
});
document.addEventListener('keydown', e => {
  if (current === 'set' && setView === 'binder' && !sheetOpen && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) turnPage(e.key === 'ArrowRight' ? 1 : -1);
});

// ---------- Decks de la méta (data/decks.json, construit par tools/build_decks.py) ----------
let DECKS = null, deckPeriod = 'current', deckFilter = 'all', currentDeck = null, deckT;
const decksReady = fetch('data/decks.json').then(r => r.json()).then(d => { DECKS = d; }).catch(() => { DECKS = { periods: [] }; });
const GROUPS = [['pokemon', 'Pokémon'], ['trainer', 'Dresseurs'], ['energy', 'Énergies']];

// Pour jouer, n'importe quelle impression d'une carte convient : on compare par nom, toutes finitions confondues.
function ownedByName() {
  const m = new Map();
  for (const r of store.all()) m.set(scanner.norm(r.name), (m.get(scanner.norm(r.name)) || 0) + store.total(r));
  return m;
}

// Les énergies de base sont considérées comme possédées (tout le monde en a).
function deckStatus(deck, owned) {
  const used = new Map();
  let have = 0, total = 0, missing = 0;
  const rows = deck.cards.map(c => {
    const key = scanner.norm(c.name || c.en);
    const left = c.basicEnergy ? Infinity : (owned.get(key) || 0) - (used.get(key) || 0);
    const got = Math.max(0, Math.min(c.count, left));
    used.set(key, (used.get(key) || 0) + got);
    have += got; total += c.count; missing += (c.count - got) * (c.price || 0);
    return { ...c, got };
  });
  return { rows, have, total, missing, pct: total ? have / total : 0 };
}

// Deux cartes pour illustrer le deck : de préférence le Pokémon qui donne son nom au deck.
function deckArt(d) {
  const key = d.en.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['mega', 'box', 'basic'].includes(w));
  const mons = d.cards.filter(c => c.type === 'pokemon' && c.image);
  const score = c => key.some(w => c.en.toLowerCase().includes(w.replace(/'s$/, ''))) * 100 + c.count;
  const seen = new Set();
  return mons.sort((a, b) => score(b) - score(a)).filter(c => !seen.has(c.en) && seen.add(c.en)).slice(0, 2);
}

const placeLabel = p => (p === 1 ? '1re place' : `${p}e place`);

$('#deck-period').addEventListener('click', e => {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  deckPeriod = b.dataset.p;
  document.querySelectorAll('#deck-period button').forEach(x => x.classList.toggle('active', x === b));
  $('#deck-season').hidden = deckPeriod !== 'past';
  renderDecks();
});
$('#deck-season').addEventListener('change', renderDecks);
$('#deck-filter').addEventListener('input', () => { clearTimeout(deckT); deckT = setTimeout(renderDecks, 150); });
$('#deck-chips').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  deckFilter = c.dataset.f;
  document.querySelectorAll('#deck-chips .chip').forEach(x => x.classList.toggle('active', x === c));
  renderDecks();
});
$('#deck-sort').addEventListener('change', renderDecks);
$('#deck-list').addEventListener('click', e => {
  const d = e.target.closest('[data-deck]');
  if (d) openDeck(d.dataset.deck);
});

async function renderDecks() {
  const box = $('#deck-list');
  if (!DECKS) box.innerHTML = spinner;
  await decksReady;
  const sel = $('#deck-season');
  if (!sel.options.length) {
    const past = DECKS.periods.filter(p => !p.current);
    sel.innerHTML = `<option value="">Toutes les saisons (${past.reduce((n, p) => n + p.decks.length, 0)} decks)</option>`
      + past.map(p => `<option value="${esc(p.id)}">${esc(p.label)}${p.era ? ` · ${esc(p.era)}` : ''}</option>`).join('');
  }
  const owned = ownedByName();
  const sort = $('#deck-sort').value;
  const by = {
    meta: (a, b) => (b.d.share || 0) - (a.d.share || 0),
    owned: (a, b) => b.st.pct - a.st.pct,
    missing: (a, b) => a.st.missing - b.st.missing,
    price: (a, b) => a.d.price - b.d.price,
  };
  const q = scanner.norm($('#deck-filter').value.trim());
  const season = $('#deck-season').value;
  // la recherche porte sur le nom du deck (français et anglais) et sur les noms de ses cartes
  const match = d => !q || [d.name, d.en, ...d.cards.map(c => c.name)].some(s => scanner.norm(s || '').includes(q));
  const keep = ({ d, st }) => match(d)
    && (deckFilter === 'all' || (deckFilter === 'ready' ? st.pct >= 1 : st.pct >= 0.7 && st.pct < 1));
  const html = DECKS.periods
    .filter(p => (deckPeriod === 'current') === !!p.current && (deckPeriod === 'current' || !season || p.id === season))
    .map(p => {
      const list = p.decks.map(d => ({ d, st: deckStatus(d, owned) })).filter(keep).sort(by[sort]);
      if (!list.length) return '';
      return (deckPeriod === 'past' ? `<h2 class="season-title">${esc(p.label)}${p.era ? ` <small>${esc(p.era)}</small>` : ''}</h2>` : '') + list.map(({ d, st }) => {
        const ready = st.pct >= 1;
        return `<button class="deck ${ready ? 'ready' : ''}" data-deck="${esc(d.id)}">
          <div class="deck-art">${deckArt(d).map(c => `<img loading="lazy" src="${esc(api.img(c.image))}" alt="">`).join('')}</div>
          <div class="body">
            <div class="title">${esc(d.name)}</div>
            <div class="meta">${d.share ? `${String(d.share).replace('.', ',')} % de la méta · ` : ''}liste ${placeLabel(d.placing)}${d.event ? ` · ${esc(d.event)}` : ''}</div>
            <div class="bar ${ready ? 'done' : ''}"><i style="width:${st.pct * 100}%"></i></div>
            <div class="nums"><span class="have">${st.have} / ${st.total} cartes</span>
              <span>${ready ? 'Prêt à jouer !' : `il manque ≈ <b>${euro.format(st.missing)}</b>`}</span></div>
            <div class="nums"><span>Prix du deck complet</span><b>${euro.format(d.price)}</b></div>
          </div>
        </button>`;
      }).join('');
    }).join('');
  box.innerHTML = html || empty(
    deckFilter === 'all' && !q ? 'Aucun deck' : 'Aucun deck pour ce filtre',
    deckFilter === 'ready' ? 'Il te manque encore des cartes pour chaque deck. Essaie « Presque ».' : 'Les données des decks n\'ont pas pu être chargées.');
  $('#deck-credits').textContent = DECKS.updatedAt
    ? `Listes : la mieux classée de chaque archétype sur Limitless TCG · cartes et cotes : TCGdex / Cardmarket · mis à jour le ${new Date(DECKS.updatedAt).toLocaleDateString('fr-FR')}`
    : '';
}

function openDeck(id) {
  currentDeck = DECKS?.periods.flatMap(p => p.decks.map(d => ({ ...d, period: p.label }))).find(d => d.id === id) || null;
  show('deck');
}

function renderDeck() {
  const d = currentDeck;
  if (!d) return;
  const st = deckStatus(d, ownedByName());
  const ready = st.pct >= 1;
  $('#deck-head').innerHTML = `<h1 style="margin-bottom:4px">${esc(d.name)}</h1>
    <div class="count">${esc(d.period)}${d.share ? ` · ${String(d.share).replace('.', ',')} % de la méta` : ''} · liste ${placeLabel(d.placing)}${d.event ? ` · ${esc(d.event)}` : ''}</div>
    <div class="deck-summary">
      <div class="stat"><div class="v" style="color:${ready ? 'var(--ok)' : 'inherit'}">${st.have}/${st.total}</div><div class="k">cartes possédées</div></div>
      <div class="stat gold"><div class="v">${euro.format(d.price)}</div><div class="k">prix du deck</div></div>
      <div class="stat"><div class="v">${ready ? '✓' : euro.format(st.missing)}</div><div class="k">${ready ? 'prêt à jouer' : 'pour le finir'}</div></div>
    </div>
    <div class="deck-actions">
      ${ready ? '' : '<button class="btn primary" id="deck-wish">🔔 Mettre les manquantes en envies</button>'}
      <a class="btn" href="${esc(d.list)}" target="_blank" rel="noopener">Liste sur Limitless</a>
    </div>
    <div class="legend"><span class="ok">Tu l'as</span><span class="part">En partie</span><span>À acheter</span></div>`;
  $('#deck-wish')?.addEventListener('click', addMissingToWishes);
  $('#deck-cards').innerHTML = GROUPS.map(([type, label]) => {
    const rows = st.rows.filter(r => r.type === type);
    if (!rows.length) return '';
    return `<div class="deck-group"><p class="section-title">${label} (${rows.reduce((a, r) => a + r.count, 0)})</p>
      ${rows.map(r => `<div class="deck-row ${r.got >= r.count ? 'ok' : r.got ? 'part' : ''}"${r.id ? ` data-card="${esc(r.id)}"` : ''}>
        ${r.image ? `<img loading="lazy" src="${esc(api.img(r.image))}" alt="">` : '<div class="ph"></div>'}
        <span class="n">${r.count}</span>
        <div class="nm"><div>${esc(r.name || r.en)}</div><small>${esc(r.ref)}${r.basicEnergy ? ' · énergie de base, comptée comme possédée' : ''}</small></div>
        <div class="own">${r.basicEnergy ? '✓' : `${r.got}/${r.count}`}<small>${r.price ? euro.format(r.price) : ''}</small></div>
      </div>`).join('')}
    </div>`;
  }).join('');
}

// Une alerte par carte manquante, au prix actuel : prévenu dès qu'elle est en vente à ce prix ou moins.
async function addMissingToWishes() {
  const st = deckStatus(currentDeck, ownedByName());
  const todo = st.rows.filter(r => r.id && r.got < r.count && !r.basicEnergy);
  const existing = new Set((await WishDB.all()).map(w => w.key));
  const btn = $('#deck-wish');
  if (btn) btn.disabled = true;
  let n = 0;
  for (const r of todo) {
    const key = `${r.id}|normal`;
    if (existing.has(key)) continue;
    existing.add(key);
    try {
      const full = await api.card(r.id);
      const ref = r.price || WishDB.prices(full, 'normal').trend || WishDB.prices(full, 'normal').low;
      if (!ref) continue;
      const w = {
        key, id: full.id, variant: 'normal', min: 0, max: Math.round(ref * 100) / 100,
        name: full.name, setName: full.set?.name || '', localId: full.localId,
        setTotal: full.set?.cardCount?.official || null, image: full.image || '', createdAt: Date.now(),
      };
      WishDB.update(w, full);
      await WishDB.put(w);
      n++;
    } catch {}
  }
  if (btn) btn.disabled = false;
  refreshWishDot();
  toast(n ? `${n} carte(s) ajoutée(s) à tes envies` : 'Ces cartes sont déjà dans tes envies');
  enableNotifications(false);
}

$('#deck-back').addEventListener('click', () => show('decks'));

// ---------- Envies / alertes de prix ----------
const fmtRange = w => `${euro.format(w.min || 0)} – ${euro.format(w.max)}`;
const VARIANT_LABEL = { normal: 'Normale', holo: 'Reverse / Holo' };
const hasHolo = full => !!(full.variants?.holo || full.variants?.reverse);
// serviceWorker.ready ne se résout jamais sans service worker (ex. http sur le réseau local).
const swReady = () => Promise.race([navigator.serviceWorker?.ready, new Promise(r => setTimeout(() => r(null), 3000))]);
const cardmarketUrl = w => `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(w.name)}`;

async function renderWishBox() {
  const full = currentCard, box = $('#wish-box');
  if (!full || !box) return;
  const mine = (await WishDB.all()).filter(w => w.id === full.id);
  const variants = hasHolo(full) ? ['normal', 'holo'] : ['normal'];
  const { low, trend } = WishDB.prices(full, variants[0]);
  const suggested = trend || low;
  box.innerHTML = `${mine.map(w => `<div class="alert-item" style="margin-bottom:8px">
      <span>🔔 ${VARIANT_LABEL[w.variant]} · ${fmtRange(w)}${w.inRange ? ' · <b style="color:var(--ok)">dans ta fourchette</b>' : ''}</span>
      <button data-wish-del="${esc(w.key)}">Retirer</button>
    </div>`).join('')}
    <div class="wish-form">
      ${variants.length > 1 ? `<label>Version<select id="w-variant">${variants.map(v => `<option value="${v}">${VARIANT_LABEL[v]}</option>`).join('')}</select></label>` : ''}
      <div class="range">
        <label>Prix min (€)<input id="w-min" type="number" inputmode="decimal" min="0" step="0.01" value="0"></label>
        <label>Prix max (€)<input id="w-max" type="number" inputmode="decimal" min="0" step="0.01" value="${suggested ? (Math.floor(suggested * 0.9 * 100) / 100) : ''}" placeholder="ex. 15"></label>
      </div>
      <button class="btn primary block" data-wish-add>
        <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>Me prévenir dans cette fourchette
      </button>
      <small id="w-now">${low ? `Moins chère en vente actuellement : ${euro.format(low)}` : 'Pas de prix Cardmarket connu pour cette carte pour l\'instant.'}</small>
    </div>`;
  $('#w-variant')?.addEventListener('change', e => {
    const p = WishDB.prices(full, e.target.value);
    $('#w-now').textContent = p.low ? `Moins chère en vente actuellement : ${euro.format(p.low)}` : 'Pas de prix connu pour cette version.';
  });
}

async function addWish() {
  const full = currentCard;
  const variant = $('#w-variant')?.value || 'normal';
  const min = parseFloat($('#w-min').value) || 0;
  const max = parseFloat($('#w-max').value);
  if (!(max > 0) || min > max) return toast('Indique une fourchette valide (min ≤ max)');
  const w = {
    key: `${full.id}|${variant}`, id: full.id, variant, min, max,
    name: full.name, setName: full.set?.name || '', localId: full.localId,
    setTotal: full.set?.cardCount?.official || null, image: full.image || '', createdAt: Date.now(),
  };
  WishDB.update(w, full);
  await WishDB.put(w);
  renderWishBox();
  refreshWishDot();
  toast(w.inRange ? `Déjà dans ta fourchette : dès ${euro.format(w.low)} !` : 'Alerte créée, tu seras prévenu');
  enableNotifications(false);
}

// Demande la permission puis programme la vérification en arrière-plan quand c'est possible.
async function enableNotifications(explicit = true) {
  if (!('Notification' in window)) { if (explicit) toast('Les notifications ne sont pas disponibles ici'); return; }
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'granted') await registerPeriodicCheck();
  if (current === 'wishlist') renderNotifBox();
}

async function registerPeriodicCheck() {
  try {
    const reg = await swReady();
    if (!reg || !('periodicSync' in reg)) return false;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state !== 'granted') return false;
    await reg.periodicSync.register('cardex-prices', { minInterval: 12 * 3600 * 1000 });
    return true;
  } catch { return false; }
}

async function renderNotifBox() {
  const box = $('#notif-box');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const bg = await registerPeriodicCheck();
  if (perm === 'granted') {
    box.innerHTML = bg
      ? '<b>Notifications activées.</b> Les prix sont vérifiés en arrière-plan environ toutes les 12 h, et à chaque ouverture de l\'appli.'
      : '<b>Notifications activées.</b> Les prix sont vérifiés à chaque ouverture de l\'appli (la vérification en arrière-plan demande Chrome sur Android avec l\'appli installée).';
  } else if (perm === 'denied') {
    box.innerHTML = '<b>Notifications bloquées.</b> Réautorise-les dans les réglages du navigateur. En attendant, les cartes dans ta fourchette s\'affichent en vert ici.';
  } else if (perm === 'unsupported') {
    box.innerHTML = '<b>Notifications indisponibles ici.</b> Sur iPhone, ajoute d\'abord l\'appli à l\'écran d\'accueil. Les cartes dans ta fourchette s\'affichent en vert ici.';
  } else {
    box.innerHTML = 'Choisis une carte, fixe une fourchette de prix, et Cardex te prévient quand elle est en vente dans ta fourchette sur Cardmarket.<br><button class="btn primary" id="btn-notif">Activer les notifications</button>';
    $('#btn-notif').onclick = () => enableNotifications(true);
  }
}

async function renderWishlist() {
  renderNotifBox();
  const list = (await WishDB.all()).sort((a, b) => (b.inRange - a.inRange) || (b.createdAt - a.createdAt));
  const last = Math.max(0, ...list.map(w => w.checkedAt || 0));
  $('#checked-at').textContent = last ? `Vérifié ${new Date(last).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : '';
  $('#wish-list').innerHTML = list.length ? list.map(w => {
    const src = api.img(w.image);
    return `<div class="wish-row ${w.inRange ? 'ok' : ''}">
      ${src ? `<img src="${esc(src)}" alt="" data-card="${esc(w.id)}">` : `<div class="ph" data-card="${esc(w.id)}"></div>`}
      <div class="body">
        <div class="title">${esc(w.name)}</div>
        <div class="sub">${esc(w.setName)} · ${esc(fmtNum(w))} · ${VARIANT_LABEL[w.variant]}</div>
        <div class="prices">
          <span class="now">${w.low ? euro.format(w.low) : '—'}</span>
          <span>voulu : ${fmtRange(w)}</span>
          <span class="badge">${w.inRange ? 'Dans ta fourchette !' : w.low ? 'Pas encore' : 'Prix inconnu'}</span>
        </div>
      </div>
      <div class="acts">
        <a href="${esc(cardmarketUrl(w))}" target="_blank" rel="noopener" aria-label="Voir sur Cardmarket">
          <svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>
        </a>
        <button data-del="${esc(w.key)}" aria-label="Supprimer">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
        </button>
      </div>
    </div>`;
  }).join('') : empty('Aucune envie pour l\'instant', 'Ouvre une carte (scan, recherche ou série) et crée une alerte prix en bas de sa fiche.');
}

$('#wish-list').addEventListener('click', async e => {
  const d = e.target.closest('[data-del]');
  if (!d) return;
  await WishDB.del(d.dataset.del);
  renderWishlist();
  refreshWishDot();
});

async function checkPrices(manual = false) {
  if (manual) { $('#btn-check').disabled = true; $('#checked-at').textContent = 'Vérification…'; }
  try {
    const hits = await WishDB.check();
    if (hits.length) {
      if ('Notification' in window && Notification.permission === 'granted') {
        swReady().then(reg => reg && WishDB.notify(reg, hits)).catch(() => {});
      }
      toast(hits.length === 1 ? `${hits[0].name} est dans ta fourchette !` : `${hits.length} cartes sont dans ta fourchette !`);
    } else if (manual) toast('Prix à jour');
  } finally {
    if (manual) $('#btn-check').disabled = false;
    if (current === 'wishlist') renderWishlist();
    refreshWishDot();
  }
}
$('#btn-check').addEventListener('click', () => checkPrices(true));

async function refreshWishDot() {
  const any = (await WishDB.all()).some(w => w.inRange);
  $('#tab-dot').classList.toggle('on', any);
}

// ---------- Évolution de la valeur de la collection ----------
const HIST_KEY = 'cardex.history.v1';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const today = () => new Date().toLocaleDateString('sv'); // AAAA-MM-JJ, heure locale

// Un point par jour (le dernier état de la journée), sur un peu plus d'un an.
function recordHistory() {
  const s = store.stats();
  const h = lsGet(HIST_KEY, []);
  const pt = { d: today(), v: Math.round(s.value * 100) / 100, n: s.total };
  if (h.at(-1)?.d === pt.d) h[h.length - 1] = pt; else h.push(pt);
  lsSet(HIST_KEY, h.slice(-400));
}

const shortDate = d => new Date(`${d}T12:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
function renderTrend() {
  const box = $('#value-trend');
  const h = lsGet(HIST_KEY, []).slice(-90);
  if (!store.all().length) { box.innerHTML = ''; return; }
  if (h.length < 2) {
    box.innerHTML = `<div class="trend-head"><b>Valeur de ta collection</b><span>La courbe se dessine à partir de demain : Cardex note la valeur chaque jour où tu ouvres l'appli.</span></div>`;
    return;
  }
  const W = 320, H = 64, P = 4;
  const t = h.map(p => new Date(`${p.d}T12:00`).getTime());
  const t0 = t[0], t1 = t.at(-1);
  const vs = h.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
  const x = i => P + ((t[i] - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = v => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const line = h.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(h.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const delta = vs.at(-1) - vs[0];
  const sign = delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : '';
  box.innerHTML = `<div class="trend-head">
      <b>Valeur de ta collection</b>
      <span class="delta ${sign}">${delta > 0 ? '+' : ''}${euro.format(delta)} depuis le ${shortDate(h[0].d)}</span>
    </div>
    <div class="trend-read" id="trend-read">${shortDate(h.at(-1).d)} : <b>${euro.format(vs.at(-1))}</b> · ${h.at(-1).n} cartes</div>
    <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Valeur de la collection du ${shortDate(h[0].d)} au ${shortDate(h.at(-1).d)}">
      <line class="grid-l" x1="0" x2="${W}" y1="${y(hi)}" y2="${y(hi)}"/><line class="grid-l" x1="0" x2="${W}" y1="${y(lo)}" y2="${y(lo)}"/>
      <path class="area" d="${area}"/><path class="line" d="${line}"/>
      <line class="cross" id="trend-cross" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/>
      <circle class="end" cx="${x(h.length - 1)}" cy="${y(vs.at(-1))}" r="3.5"/>
    </svg>
    <div class="trend-axis"><span>${shortDate(h[0].d)}</span><span>${euro.format(lo)} – ${euro.format(hi)}</span><span>${shortDate(h.at(-1).d)}</span></div>`;
  // au toucher ou au survol : la valeur du jour le plus proche
  const svg = box.querySelector('.spark');
  const read = i => {
    $('#trend-read').innerHTML = `${shortDate(h[i].d)} : <b>${euro.format(h[i].v)}</b> · ${h[i].n} cartes`;
    const c = $('#trend-cross');
    c.setAttribute('x1', x(i)); c.setAttribute('x2', x(i)); c.setAttribute('visibility', 'visible');
  };
  svg.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    h.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    read(best);
  });
  svg.addEventListener('pointerleave', () => read(h.length - 1) || $('#trend-cross').setAttribute('visibility', 'hidden'));
}

// ---------- Doubles et liste d'échange ----------
function doubles() {
  return store.all().flatMap(rec => Object.entries(rec.qty).filter(([, n]) => n > 1).map(([f, n]) => ({ rec, f, n })))
    .sort((a, b) => store.priceFor(b.rec, b.f) - store.priceFor(a.rec, a.f) || a.rec.name.localeCompare(b.rec.name, 'fr'));
}
function renderDoubles() {
  const list = doubles();
  const extra = list.reduce((a, e) => a + e.n - 1, 0);
  const val = list.reduce((a, e) => a + store.priceFor(e.rec, e.f) * (e.n - 1), 0);
  $('#dup-stats').innerHTML = `
    <div class="stat"><div class="v">${extra}</div><div class="k">cartes à échanger</div></div>
    <div class="stat"><div class="v">${list.length}</div><div class="k">différentes</div></div>
    <div class="stat gold"><div class="v">${euro.format(val)}</div><div class="k">valeur des doubles</div></div>`;
  $('#btn-trade').disabled = !list.length;
  $('#dup-grid').innerHTML = list.length
    ? list.map(({ rec, f, n }) => tile(rec, { sub: `${rec.setName} · ${n} exemplaires`, qty: n - 1, finish: f })).join('')
    : empty('Aucun double', 'Quand tu ajoutes une carte que tu as déjà, elle apparaît ici.');
}

const finLabel = f => (f && f !== 'normal' ? ` (${store.SHORT[f] || f})` : '');
async function tradeText() {
  const lines = ['Mes doubles à échanger :'];
  for (const { rec, f, n } of doubles()) lines.push(`• ${rec.name} – ${rec.setName} ${fmtNum(rec)}${finLabel(f)}${n > 2 ? ` ×${n - 1}` : ''}`);
  const wishes = await WishDB.all().catch(() => []);
  if (wishes.length) {
    lines.push('', 'Je cherche :');
    for (const w of wishes) lines.push(`• ${w.name} – ${w.setName} ${fmtNum(w)}${finLabel(w.variant)}`);
  }
  return lines.join('\n');
}
$('#btn-trade').addEventListener('click', async () => {
  const text = await tradeText();
  try {
    await navigator.clipboard.writeText(text);
    toast('Liste copiée : colle-la dans ta discussion');
  } catch {
    openSheet(`<div class="backup"><h2>Ta liste d'échange</h2><p>Sélectionne le texte pour le copier.</p>
      <textarea class="trade-text" id="trade-text" readonly>${esc(text)}</textarea></div>`);
    $('#trade-text').select();
  }
});

// ---------- Succès ----------
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
async function achievements() {
  await dexReady;
  const recs = store.all(), st = store.stats(), dex = ownedByDex();
  const fins = new Set(recs.flatMap(r => Object.keys(r.qty)));
  const got = ns => ns.filter(n => dex.has(n)).length;
  let setBest = 0, setName = '';
  try {
    const own = store.ownedBySet();
    for (const s of await api.sets()) {
      const t = s.cardCount?.official, p = t ? Math.min(1, (own.get(s.id) || 0) / t) : 0;
      if (p > setBest) { setBest = p; setName = s.name; }
    }
  } catch {}
  await decksReady;
  let deckBest = 0, deckName = '';
  const owned = ownedByName();
  for (const p of DECKS.periods) for (const d of p.decks) {
    const v = deckStatus(d, owned).pct;
    if (v > deckBest) { deckBest = v; deckName = d.name; }
  }
  const dups = recs.reduce((a, r) => a + Object.values(r.qty).reduce((x, n) => x + Math.max(0, n - 1), 0), 0);
  return [
    { id: 'first', g: 'Collection', t: 'Première carte', d: 'Ajoute une carte à ta collection', have: st.total, need: 1 },
    { id: 'c50', g: 'Collection', t: 'Collectionneur', d: 'Réunis 50 cartes', have: st.total, need: 50 },
    { id: 'c250', g: 'Collection', t: 'Classeur plein', d: 'Réunis 250 cartes', have: st.total, need: 250 },
    { id: 'c1000', g: 'Collection', t: 'Légende vivante', d: 'Réunis 1 000 cartes', have: st.total, need: 1000 },
    { id: 'set', g: 'Collection', t: 'Série complète', d: setName ? `Ta série la plus avancée : ${setName}` : 'Toutes les cartes d\'une série', have: Math.floor(setBest * 100), need: 100, unit: ' %' },
    { id: 'shiny', g: 'Brillantes', t: 'Ça brille !', d: 'Une reverse, une holo ou mieux', have: [...fins].some(f => f !== 'normal') ? 1 : 0, need: 1 },
    { id: 'fins', g: 'Brillantes', t: 'Arc-en-ciel', d: '4 finitions différentes', have: fins.size, need: 4 },
    { id: 'master', g: 'Brillantes', t: 'Master Ball', d: 'Une reverse Master Ball', have: fins.has('masterball') ? 1 : 0, need: 1 },
    { id: 'starters', g: 'Pokédex', t: 'Trio de départ', d: 'Bulbizarre, Salamèche et Carapuce', have: got([1, 4, 7]), need: 3 },
    { id: 'birds', g: 'Pokédex', t: 'Oiseaux légendaires', d: 'Artikodin, Électhor et Sulfura', have: got([144, 145, 146]), need: 3 },
    { id: 'eevee', g: 'Pokédex', t: 'Évolitions', d: 'Évoli et ses 8 évolutions', have: got([133, 134, 135, 136, 196, 197, 470, 471, 700]), need: 9 },
    { id: 'pika', g: 'Pokédex', t: 'Fan de Pikachu', d: '10 cartes Pikachu différentes', have: recs.filter(r => dexNums(r).includes(25)).length, need: 10 },
    { id: 'dex100', g: 'Pokédex', t: 'Dresseur confirmé', d: '100 Pokémon différents', have: dex.size, need: 100 },
    { id: 'kanto', g: 'Pokédex', t: 'Pokédex de Kanto', d: 'Les 151 premiers Pokémon', have: got(range(1, 151)), need: 151 },
    { id: 'deck', g: 'Jeu', t: 'Prêt pour le tournoi', d: deckName ? `Ton deck le plus avancé : ${deckName}` : 'Un deck de la méta au complet', have: Math.floor(deckBest * 100), need: 100, unit: ' %' },
    { id: 'dups', g: 'Jeu', t: 'Roi de l\'échange', d: '10 cartes en double', have: dups, need: 10 },
    { id: 'v100', g: 'Valeur', t: 'Petit trésor', d: 'Collection estimée à 100 €', have: Math.floor(st.value), need: 100, unit: ' €' },
    { id: 'v1000', g: 'Valeur', t: 'Coffre-fort', d: 'Collection estimée à 1 000 €', have: Math.floor(st.value), need: 1000, unit: ' €' },
  ];
}

const ACH_KEY = 'cardex.ach.v1';
let achT;
// Après chaque changement : un message pour chaque succès qui vient d'être débloqué.
function checkAchievements() {
  clearTimeout(achT);
  achT = setTimeout(async () => {
    const list = await achievements().catch(() => null);
    if (!list) return;
    const done = list.filter(a => a.have >= a.need).map(a => a.id);
    const known = lsGet(ACH_KEY, null);
    lsSet(ACH_KEY, done);
    if (!known) return; // premier lancement : on note sans féliciter
    const fresh = list.filter(a => done.includes(a.id) && !known.includes(a.id));
    if (fresh.length) toast(fresh.length === 1 ? `Succès débloqué : ${fresh[0].t} !` : `${fresh.length} succès débloqués !`);
  }, 700);
}

async function renderAchievements() {
  $('#ach-grid').innerHTML = spinner;
  const list = await achievements();
  if (colMode !== 'ach') return;
  const done = list.filter(a => a.have >= a.need).length;
  $('#ach-head').innerHTML = `<div class="ach-head"><b>${done} / ${list.length}</b> succès débloqués
    <div class="bar ${done === list.length ? 'done' : ''}"><i style="width:${done / list.length * 100}%"></i></div></div>`;
  const groups = [...new Set(list.map(a => a.g))];
  $('#ach-grid').innerHTML = groups.map(g => `<h2 class="season-title">${esc(g)}</h2>` + list.filter(a => a.g === g).map(a => {
    const ok = a.have >= a.need, u = a.unit || '';
    return `<div class="ach ${ok ? 'done' : ''}">
      <div class="medal"><svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z"/></svg></div>
      <div class="ach-body"><b>${esc(a.t)}</b><small>${esc(a.d)}</small>
        ${ok ? '<span class="ach-n ok">Débloqué</span>' : `<div class="bar"><i style="width:${Math.min(100, a.have / a.need * 100)}%"></i></div>
        <span class="ach-n">${Math.min(a.have, a.need).toLocaleString('fr-FR')}${u} / ${a.need.toLocaleString('fr-FR')}${u}</span>`}
      </div>
    </div>`;
  }).join('')).join('');
}

// ---------- Marché : cotes des cartes, produits scellés, mon scellé ----------
let marketMode = 'cotes', sealedMode = 'ideas', cotesFilter = 'up', sealedKind = 'all', sealedShown = 60, sealedT;
const pct = v => `${v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const chg = v => (v == null ? '' : `<span class="chg ${v > 0.5 ? 'up' : v < -0.5 ? 'down' : ''}">${v > 0.5 ? '▲' : v < -0.5 ? '▼' : '='} ${pct(v)}</span>`);

// Évolution de la cote dans la fiche d'une carte.
function trendBox(full) {
  const t = api.trendOf(full, previewFinish || 'normal');
  if (!t || !(t.a30 || t.a7)) return '<div id="trend-box"></div>';
  const cell = (k, v) => `<div><small>${k}</small><b>${v ? euro.format(v) : '—'}</b></div>`;
  return `<div class="trend-cells" id="trend-box" title="Cote de la version ${esc(store.VARIANTS[previewFinish] || '')}">
    ${cell('Moy. 30 jours', t.a30)}${cell('Moy. 7 jours', t.a7)}${cell('Hier', t.a1)}
    <div class="tc-chg"><small>Sur 30 jours</small>${t.change != null ? chg(t.change * 100) : '<b>—</b>'}</div>
  </div>`;
}

const MARKET_LEDE = {
  cotes: 'L\'évolution des cotes de tes cartes : celles qui montent, celles qui baissent et les plus précieuses.',
  sealed: 'Tous les produits scellés du JCC (displays, coffrets, bundles, blisters, pokébox…) avec leur cote et son évolution depuis 2024.',
  mine: 'Tes produits scellés, ce qu\'ils t\'ont coûté et ce qu\'ils valent aujourd\'hui.',
};
document.addEventListener('click', e => {
  const b = e.target.closest('.market-seg [data-mk]');
  if (!b) return;
  if (b.dataset.mk === 'wish') return show('wishlist');
  marketMode = b.dataset.mk;
  show('market');
});
function renderMarket() {
  document.querySelectorAll('#view-market .market-seg button').forEach(x => x.classList.toggle('active', x.dataset.mk === marketMode));
  $('#market-lede').textContent = MARKET_LEDE[marketMode];
  for (const m of ['cotes', 'sealed', 'mine']) $(`#mk-${m}`).hidden = marketMode !== m;
  if (marketMode === 'cotes') renderCotes();
  if (marketMode === 'sealed') renderSealed();
  if (marketMode === 'mine') renderMine();
}

// --- Cotes des cartes de la collection (fiches TCGdex rafraîchies toutes les 12 h) ---
const COTES_KEY = 'cardex.cotes.v1';
let cotesBusy = false;
async function loadCotes() {
  const c = lsGet(COTES_KEY, { t: 0, m: {} });
  const recs = store.all();
  const stale = Date.now() - c.t > 12 * 3600000;
  const todo = recs.filter(r => stale || !c.m[r.id]);
  if (!todo.length || cotesBusy) return c.m;
  cotesBusy = true;
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < todo.length) {
      const r = todo[i++];
      try {
        const full = await api.card(r.id);
        c.m[r.id] = Object.fromEntries(Object.keys(r.qty).map(f => [f, api.trendOf(full, f)]));
        store.refresh(full, false); // la valeur de la collection suit les nouvelles cotes
      } catch { /* hors ligne : on garde l'ancienne cote */ }
      done++;
      if (marketMode === 'cotes' && current === 'market') $('#cotes-list').innerHTML = `<p class="hint" style="text-align:center">Mise à jour des cotes… ${done} / ${todo.length}</p>`;
    }
  }));
  if (stale) c.t = Date.now();
  lsSet(COTES_KEY, c);
  cotesBusy = false;
  store.flush();
  return c.m;
}

async function renderCotes() {
  const recs = store.all();
  if (!recs.length) {
    $('#cotes-stats').innerHTML = '';
    $('#cotes-list').innerHTML = empty('Aucune carte', 'Ajoute des cartes à ta collection pour suivre leurs cotes.');
    return;
  }
  if (!lsGet(COTES_KEY, null)) $('#cotes-list').innerHTML = spinner;
  const m = await loadCotes();
  if (marketMode !== 'cotes' || current !== 'market') return;
  const rows = recs.flatMap(rec => Object.entries(rec.qty).map(([f, n]) => ({ rec, f, n, t: m[rec.id]?.[f] })));
  let v30 = 0, v7 = 0, up = 0, down = 0;
  for (const r of rows) {
    if (r.t?.a30 && r.t?.a7) { v30 += r.t.a30 * r.n; v7 += r.t.a7 * r.n; }
    if (r.t?.change > 0.005) up++; else if (r.t?.change < -0.005) down++;
  }
  const s = store.stats();
  $('#cotes-stats').innerHTML = `
    <div class="stat gold"><div class="v">${euro.format(s.value)}</div><div class="k">valeur de ta collection</div></div>
    <div class="stat"><div class="v">${v30 ? chg((v7 - v30) / v30 * 100) : '—'}</div><div class="k">sur 30 jours</div></div>
    <div class="stat"><div class="v up-c">${up}</div><div class="k">cartes en hausse</div></div>
    <div class="stat"><div class="v down-c">${down}</div><div class="k">cartes en baisse</div></div>`;
  const by = {
    up: rows.filter(r => r.t?.change > 0.005).sort((a, b) => b.t.change - a.t.change),
    down: rows.filter(r => r.t?.change < -0.005).sort((a, b) => a.t.change - b.t.change),
    top: rows.filter(r => r.t?.now).sort((a, b) => b.t.now - a.t.now),
  }[cotesFilter].slice(0, 60);
  $('#cotes-list').innerHTML = by.length ? by.map(({ rec, f, n, t }) => `<div class="mk-row" data-card="${esc(rec.id)}" data-finish="${f}">
      <div class="mk-img">${rec.image ? `<img loading="lazy" src="${esc(api.img(rec.image))}" alt="">` : ''}${f !== 'normal' ? `<span class="fb fb-${f}">${store.SHORT[f]}</span>` : ''}</div>
      <div class="mk-body"><b>${esc(rec.name)}</b><small>${esc(rec.setName)} · ${esc(fmtNum(rec))}${n > 1 ? ` · ×${n}` : ''}</small>
        <small>${t.a30 ? `moy. 30 j ${euro.format(t.a30)}` : ''}${t.a7 ? ` → moy. 7 j ${euro.format(t.a7)}` : ''}</small></div>
      <div class="mk-price"><b>${euro.format(t.now || t.a7 || t.a30)}</b>${t.change != null ? chg(t.change * 100) : ''}</div>
    </div>`).join('')
    : empty(cotesFilter === 'up' ? 'Aucune carte en hausse' : cotesFilter === 'down' ? 'Aucune carte en baisse' : 'Aucune cote', 'Les cotes bougent peu en ce moment.');
}
$('#cotes-chips').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  cotesFilter = c.dataset.f;
  document.querySelectorAll('#cotes-chips .chip').forEach(x => x.classList.toggle('active', x === c));
  renderCotes();
});

// --- Produits scellés (data/sealed.json, construit par tools/build_sealed.py) ---
let SEALED = null;
const sealedReady = () => (SEALED ? Promise.resolve(SEALED)
  : fetch('data/sealed.json').then(r => r.json()).then(d => { SEALED = d; d.byId = new Map(d.products.map(p => [p.id, p])); return d; }));
const KINDS = {
  box: 'Display', halfbox: 'Demi-display', etb: 'Coffret Dresseur d\'Élite', bundle: 'Bundle de boosters',
  coffret: 'Coffret', tin: 'Pokébox et tins', blister: 'Blister', booster: 'Booster', deck: 'Deck',
  prerelease: 'Kit d\'avant-première', case: 'Caisse scellée',
};
const KIND_ORDER = Object.keys(KINDS);
const bigImg = u => u.replace(/_200w\.jpg$/, '_400w.jpg');
// Titre lisible : le type en français, plus ce qui distingue le produit (Pokémon Center, variante…).
function ptitle(p) {
  const extra = [/pokemon center/i.test(p.n) && 'Pokémon Center', ...(p.n.match(/\[([^\]]+)\]/g) || []).map(x => x.slice(1, -1))].filter(Boolean);
  if (['box', 'halfbox', 'etb', 'bundle', 'booster', 'prerelease', 'case'].includes(p.k)) return [KINDS[p.k], ...extra].join(' · ');
  return p.n.replace(/\s*\[[^\]]+\]/g, '').trim() + (extra.length ? ` · ${extra.join(' · ')}` : '');
}
const year = p => (p.rel || '').slice(0, 4);
const mult = p => (p.first ? p.eur / p.first : 1);
const sinceLabel = p => (p.since ? new Date(`${p.since}T12:00`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '');

function ptile(p) {
  const own = store.sealedGet(p.id);
  return `<button class="ptile" data-product="${p.id}">
    <div class="pimg">${p.img ? `<img loading="lazy" src="${esc(p.img)}" alt="">` : '<div class="pimg-ph"></div>'}
      ${own ? `<span class="qty">${own.qty}</span>` : ''}${store.watching(p.id) ? '<span class="star">★</span>' : ''}</div>
    <span class="pill">${esc(KINDS[p.k])}</span>
    <b class="ptitle">${esc(ptitle(p))}</b>
    <small>${esc(p.set)}${year(p) ? ` · ${year(p)}` : ''}</small>
    <div class="pprice"><b>${euro.format(p.eur)}</b>${chg(p.c365 ?? p.c90 ?? p.c30)}</div>
  </button>`;
}

async function renderSealed() {
  $('#sealed-ideas').hidden = sealedMode !== 'ideas';
  $('#sealed-all').hidden = sealedMode !== 'all';
  const box = sealedMode === 'ideas' ? $('#sealed-ideas') : $('#sealed-grid');
  if (!SEALED) box.innerHTML = spinner;
  let d;
  try { d = await sealedReady(); } catch { box.innerHTML = empty('Catalogue indisponible', 'Vérifie ta connexion internet.'); return; }
  $('#sealed-credits').textContent = `Cotes TCGplayer (marché américain) via TCGCSV, converties en euros (1 $ = ${d.rate.toLocaleString('fr-FR')} €) · mises à jour le ${new Date(d.updatedAt).toLocaleDateString('fr-FR')}. Les prix en France (Cardmarket) peuvent différer.`;
  if (sealedMode === 'ideas') return renderIdeas(d);
  const q = scanner.norm($('#sealed-filter').value.trim());
  const counts = {};
  const base = d.products.filter(p => !q || scanner.norm(`${p.n} ${p.set} ${ptitle(p)} ${KINDS[p.k]}`).includes(q));
  for (const p of base) counts[p.k] = (counts[p.k] || 0) + 1;
  if (sealedKind !== 'all' && !counts[sealedKind]) sealedKind = 'all';
  $('#sealed-kinds').innerHTML = `<button class="chip ${sealedKind === 'all' ? 'active' : ''}" data-k="all">Tous<span class="n">${base.length}</span></button>`
    + KIND_ORDER.filter(k => counts[k]).map(k => `<button class="chip ${sealedKind === k ? 'active' : ''}" data-k="${k}">${KINDS[k]}<span class="n">${counts[k]}</span></button>`).join('');
  const sort = $('#sealed-sort').value;
  const by = {
    new: (a, b) => (b.rel || '').localeCompare(a.rel || '') || b.eur - a.eur,
    c365: (a, b) => (b.c365 ?? -1e9) - (a.c365 ?? -1e9),
    c90: (a, b) => (b.c90 ?? -1e9) - (a.c90 ?? -1e9),
    mult: (a, b) => mult(b) - mult(a),
    asc: (a, b) => a.eur - b.eur,
    desc: (a, b) => b.eur - a.eur,
  };
  const list = base.filter(p => sealedKind === 'all' || p.k === sealedKind).sort(by[sort]);
  $('#sealed-count').textContent = `${list.length.toLocaleString('fr-FR')} produits`;
  $('#sealed-grid').innerHTML = list.length ? list.slice(0, sealedShown).map(ptile).join('') : empty('Aucun produit', 'Rien ne correspond à ta recherche.');
  $('#sealed-more').hidden = list.length <= sealedShown;
}

// Pistes d'investissement : des listes simples et expliquées, calculées sur l'historique des prix.
function renderIdeas(d) {
  // ni caisses, ni boosters à l'unité, ni pièces de musée hors de prix
  const P = d.products.filter(p => p.k !== 'case' && p.k !== 'booster' && p.eur >= 5 && p.eur <= 1500);
  const now = Date.now(), months = p => (now - new Date(`${p.rel}T12:00`).getTime()) / (30.4 * 86400000);
  const watched = store.watchList().map(id => d.byId.get(id)).filter(Boolean);
  const sections = [
    watched.length && { t: 'Tes produits suivis', d: 'Ceux que tu as marqués d\'une étoile dans leur fiche.', list: watched },
    { t: 'Hausse régulière sur un an', d: 'Plus de 20 % sur un an, sans baisse marquée ces derniers mois : la demande tient dans la durée.',
      list: P.filter(p => p.c365 > 20 && (p.c90 ?? 0) >= 0 && (p.c30 ?? 0) > -5).sort((a, b) => b.c365 - a.c365) },
    { t: 'Forte dynamique sur 3 mois', d: 'Les plus fortes hausses récentes. Une hausse rapide peut aussi retomber : à surveiller avant d\'acheter.',
      list: P.filter(p => p.c90 > 10).sort((a, b) => b.c90 - a.c90) },
    { t: 'Encore proches de leur prix de sortie', d: 'Sortis il y a moins de 10 mois et pas plus de 10 % au-dessus de leur premier prix. Les produits prennent souvent de la valeur quand ils ne sont plus réimprimés.',
      list: P.filter(p => ['etb', 'box', 'bundle', 'coffret', 'tin'].includes(p.k) && months(p) < 10 && months(p) >= 0 && p.first && p.eur <= p.first * 1.1).sort((a, b) => (b.rel || '').localeCompare(a.rel || '')) },
    { t: 'Les plus belles plus-values depuis 2024', d: 'Le prix actuel comparé au premier prix connu (février 2024 pour les produits plus anciens).',
      list: P.filter(p => p.since && p.since <= '2024-03-01').sort((a, b) => mult(b) - mult(a)) },
    { t: 'En baisse sur 3 mois', d: 'Plus de 15 % de baisse : une occasion pour certains, un signal d\'alerte pour d\'autres.',
      list: P.filter(p => p.c90 < -15).sort((a, b) => a.c90 - b.c90) },
  ].filter(s => s && s.list.length);
  $('#sealed-ideas').innerHTML = `<div class="warn-box"><b>Ce ne sont pas des conseils financiers.</b> Ces listes classent les produits d'après l'évolution passée de leur cote, qui ne dit rien de l'avenir. Les cotes viennent du marché américain : vérifie le prix en France avant d'acheter, et garde tes produits bien scellés.</div>`
    + sections.map(s => `<section class="idea">
      <h2 class="season-title">${esc(s.t)}</h2><p class="hint">${esc(s.d)}</p>
      <div class="prow">${s.list.slice(0, 12).map(ptile).join('')}</div>
    </section>`).join('');
}

$('#sealed-mode').addEventListener('click', e => {
  const b = e.target.closest('[data-s]');
  if (!b) return;
  sealedMode = b.dataset.s;
  document.querySelectorAll('#sealed-mode button').forEach(x => x.classList.toggle('active', x === b));
  renderSealed();
});
$('#sealed-kinds').addEventListener('click', e => {
  const c = e.target.closest('[data-k]');
  if (!c) return;
  sealedKind = c.dataset.k; sealedShown = 60;
  renderSealed();
});
$('#sealed-sort').addEventListener('change', () => { sealedShown = 60; renderSealed(); });
$('#sealed-filter').addEventListener('input', () => { clearTimeout(sealedT); sealedT = setTimeout(() => { sealedShown = 60; renderSealed(); }, 200); });
$('#sealed-more').addEventListener('click', () => { sealedShown += 60; renderSealed(); });
document.addEventListener('click', e => {
  const p = e.target.closest('[data-product]');
  if (p) openProduct(+p.dataset.product);
});

// --- Fiche d'un produit scellé ---
const HIST = new Map();
const histOf = g => HIST.get(g) || HIST.set(g, fetch(`data/sealed/${g}.json`).then(r => r.json()).catch(() => null)).get(g);

async function openProduct(id) {
  const d = await sealedReady().catch(() => null);
  const p = d?.byId.get(id);
  if (!p) return toast('Produit introuvable');
  renderProduct(p);
  const h = await histOf(p.g);
  if (!sheetOpen || $('#product')?.dataset.id !== String(id)) return;
  const col = h?.p[String(id)] || [];
  const pts = h ? h.d.map((day, i) => ({ d: day, v: col[i] == null ? null : col[i] / 100 * d.rate })).filter(x => x.v != null) : [];
  $('#p-chart').innerHTML = pts.length > 1 ? chartHtml(pts) : '<p class="hint">Pas encore assez de points pour tracer la courbe.</p>';
  if (pts.length > 1) bindChart($('#p-chart'), pts);
}

function renderProduct(p) {
  const own = store.sealedGet(p.id);
  const w = store.watching(p.id);
  const cells = [['7 jours', p.c7], ['30 jours', p.c30], ['3 mois', p.c90], ['1 an', p.c365]]
    .map(([k, v]) => `<div><small>${k}</small>${v == null ? '<b>—</b>' : chg(v)}</div>`).join('');
  openSheet(`<div class="detail" id="product" data-id="${p.id}">
    <div class="pbig">${p.img ? `<img src="${esc(bigImg(p.img))}" data-fallback="${esc(p.img)}" alt="">` : ''}</div>
    <span class="pill">${esc(KINDS[p.k])}</span>
    <h2>${esc(ptitle(p))}</h2>
    <div class="meta">${esc(p.set)}${p.rel ? ` · sortie le ${new Date(`${p.rel}T12:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</div>
    <div class="meta" style="margin-top:-10px"><small>Nom d'origine : ${esc(p.n)}</small></div>
    <div class="price">
      <div><small>Cote actuelle</small><br><b>${euro.format(p.eur)}</b></div>
      <div style="text-align:right"><small>TCGplayer</small><br><span class="mono">${p.usd.toLocaleString('fr-FR', { style: 'currency', currency: 'USD' })}</span></div>
    </div>
    <div class="trend-cells">${cells}</div>
    <p class="section-title">Historique de la cote</p>
    <div id="p-chart" class="trend">${spinner}</div>
    <p class="hint">Premier prix connu : <b>${euro.format(p.first)}</b> (${esc(sinceLabel(p))}), soit <b>×${mult(p).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</b> aujourd'hui · plus haut : <b>${euro.format(p.max)}</b>.</p>
    <p class="section-title">Mon scellé</p>
    <div class="own-form" id="own-form">
      <label>Quantité<input id="own-qty" type="number" min="0" step="1" inputmode="numeric" value="${own?.qty || 1}"></label>
      <label>Prix d'achat (l'unité)<input id="own-cost" type="number" min="0" step="0.01" inputmode="decimal" value="${own?.cost ?? p.eur}"></label>
      <button class="btn primary" id="own-save">${own ? 'Mettre à jour' : 'J\'en ai'}</button>
      ${own ? '<button class="btn danger" id="own-del">Retirer</button>' : ''}
    </div>
    <div class="deck-actions" style="margin-top:14px">
      <button class="btn" id="p-watch">${w ? '★ Suivi' : '☆ Suivre ce produit'}</button>
      <a class="btn" href="https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(p.n.replace(/\s*\[[^\]]+\]/g, ''))}" target="_blank" rel="noopener">Chercher sur Cardmarket</a>
      <a class="btn" href="https://www.tcgplayer.com/product/${p.id}" target="_blank" rel="noopener">TCGplayer</a>
    </div>
  </div>`);
  $('#own-save').onclick = () => {
    const qty = Math.max(0, parseInt($('#own-qty').value, 10) || 0);
    const cost = Math.max(0, parseFloat(String($('#own-cost').value).replace(',', '.')) || 0);
    store.sealedSet(p.id, qty ? { qty, cost, at: own?.at || today() } : null);
    toast(qty ? 'Ajouté à ton scellé' : 'Retiré de ton scellé');
    openProduct(p.id);
  };
  $('#own-del')?.addEventListener('click', () => { store.sealedSet(p.id, null); toast('Retiré de ton scellé'); openProduct(p.id); });
  $('#p-watch').onclick = () => {
    const on = store.toggleWatch(p.id);
    $('#p-watch').textContent = on ? '★ Suivi' : '☆ Suivre ce produit';
    toast(on ? 'Produit suivi : il apparaît en tête des pistes' : 'Tu ne suis plus ce produit');
  };
}

// Courbe d'une cote dans le temps (un point par relevé), lisible au toucher.
function chartHtml(pts) {
  const W = 320, H = 90, P = 4;
  const t = pts.map(p => new Date(`${p.d}T12:00`).getTime()), t0 = t[0], t1 = t.at(-1);
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
  const x = i => P + ((t[i] - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = v => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  pts.geo = { x, W };
  return `<div class="trend-read" data-read>${shortDate(pts.at(-1).d)} : <b>${euro.format(vs.at(-1))}</b></div>
    <svg class="spark tall" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Historique de la cote">
      <line class="grid-l" x1="0" x2="${W}" y1="${y(hi)}" y2="${y(hi)}"/><line class="grid-l" x1="0" x2="${W}" y1="${y(lo)}" y2="${y(lo)}"/>
      <path class="area" d="${line}L${x(pts.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z"/><path class="line" d="${line}"/>
      <line class="cross" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/>
      <circle class="end" cx="${x(pts.length - 1)}" cy="${y(vs.at(-1))}" r="3.5"/>
    </svg>
    <div class="trend-axis"><span>${shortDate(pts[0].d)} ${pts[0].d.slice(0, 4)}</span><span>${euro.format(lo)} – ${euro.format(hi)}</span><span>${shortDate(pts.at(-1).d)}</span></div>`;
}
function bindChart(box, pts) {
  const svg = box.querySelector('svg'), cross = svg.querySelector('.cross'), out = box.querySelector('[data-read]');
  const { x, W } = pts.geo;
  svg.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    let b = 0;
    pts.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(b) - px)) b = i; });
    out.innerHTML = `${new Date(`${pts[b].d}T12:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })} : <b>${euro.format(pts[b].v)}</b>`;
    cross.setAttribute('x1', x(b)); cross.setAttribute('x2', x(b)); cross.setAttribute('visibility', 'visible');
  });
  svg.addEventListener('pointerleave', () => cross.setAttribute('visibility', 'hidden'));
}

// --- Mon scellé : valeur et plus-value ---
async function renderMine() {
  const mine = store.sealedAll();
  if (!mine.length) {
    $('#mine-stats').innerHTML = '';
    $('#mine-list').innerHTML = empty('Aucun produit scellé', 'Ouvre un produit dans l\'onglet Scellé et touche « J\'en ai ».');
    return;
  }
  let d;
  try { d = await sealedReady(); } catch { $('#mine-list').innerHTML = empty('Catalogue indisponible', 'Vérifie ta connexion internet.'); return; }
  const rows = mine.map(o => ({ o, p: d.byId.get(o.id) })).filter(r => r.p);
  const cost = rows.reduce((a, r) => a + r.o.cost * r.o.qty, 0), val = rows.reduce((a, r) => a + r.p.eur * r.o.qty, 0);
  const gain = val - cost;
  $('#mine-stats').innerHTML = `
    <div class="stat gold"><div class="v">${euro.format(val)}</div><div class="k">valeur actuelle</div></div>
    <div class="stat"><div class="v">${euro.format(cost)}</div><div class="k">investi</div></div>
    <div class="stat"><div class="v ${gain >= 0 ? 'up-c' : 'down-c'}">${gain >= 0 ? '+' : ''}${euro.format(gain)}</div><div class="k">plus-value</div></div>
    <div class="stat"><div class="v">${cost ? chg(gain / cost * 100) : '—'}</div><div class="k">rendement</div></div>`;
  $('#mine-list').innerHTML = rows.sort((a, b) => b.p.eur * b.o.qty - a.p.eur * a.o.qty).map(({ o, p }) => {
    const g = (p.eur - o.cost) * o.qty;
    return `<div class="mk-row" data-product="${p.id}">
      <div class="mk-img sq">${p.img ? `<img loading="lazy" src="${esc(p.img)}" alt="">` : ''}</div>
      <div class="mk-body"><b>${esc(ptitle(p))}</b><small>${esc(p.set)} · ${o.qty} × acheté ${euro.format(o.cost)}</small>
        <small class="${g >= 0 ? 'up-c' : 'down-c'}">${g >= 0 ? '+' : ''}${euro.format(g)}${o.cost ? ` (${pct((p.eur - o.cost) / o.cost * 100)})` : ''}</small></div>
      <div class="mk-price"><b>${euro.format(p.eur * o.qty)}</b>${chg(p.c30)}</div>
    </div>`;
  }).join('');
}

// ---------- Sauvegarde ----------
$('#btn-backup').addEventListener('click', () => {
  const t = store.lastSave();
  openSheet(`<div class="backup">
    <h2>Sauvegarde</h2>
    <p>Ta collection est enregistrée automatiquement sur cet appareil${t ? ` (dernière modif. ${new Date(t).toLocaleString('fr-FR')})` : ''}.
    Exporte un fichier de temps en temps pour ne rien perdre ou pour la transférer sur un autre appareil.</p>
    <button class="btn primary block" id="bk-export">Exporter ma collection</button>
    <label class="btn block" for="bk-file">Importer un fichier</label>
    <input type="file" id="bk-file" accept=".json,application/json" hidden>
    <button class="btn danger block" id="bk-clear">Tout effacer</button>
  </div>`);
  $('#bk-export').onclick = () => { store.exportFile(); toast('Fichier de sauvegarde téléchargé'); };
  $('#bk-file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { const n = store.importText(await f.text()); toast(`Import réussi : ${n} nouvelle(s) carte(s)`); closeSheet(); }
    catch { toast('Ce fichier n\'est pas une sauvegarde Cardex'); }
  };
  $('#bk-clear').onclick = () => {
    if (confirm('Effacer toute la collection ? Pense à exporter avant.')) { store.clearAll(); toast('Collection effacée'); closeSheet(); }
  };
});

// ---------- Mise à jour de l'affichage quand la collection change ----------
store.onChange(() => {
  recordHistory();
  checkAchievements();
  if (current === 'collection') renderCollection();
  if (current === 'set') renderSet();
  if (current === 'sets') renderSets();
  if (current === 'poke') renderPoke();
  if (current === 'decks') renderDecks();
  if (current === 'deck') renderDeck();
  if (current === 'market' && marketMode !== 'cotes') renderMarket();
  // met à jour les badges de quantité visibles (scan, recherche)
  document.querySelectorAll('#scan-results .tile:not([data-finish]), #search-results .tile').forEach(t => {
    const n = store.count(t.dataset.card);
    let b = t.querySelector('.qty');
    if (n && !b) { b = document.createElement('span'); b.className = 'qty'; t.querySelector('.img').after(b); }
    if (b) n ? (b.textContent = n) : b.remove();
  });
});

// ---------- Démarrage ----------
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
$('#search-results').innerHTML = empty('Trouve n\'importe quelle carte', 'Tape le nom d\'un Pokémon, d\'un dresseur…');
api.sets().catch(() => {});
recordHistory();
checkAchievements();
if (location.hash === '#wishlist') show('wishlist');
checkPrices();
