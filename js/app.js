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
  if (el.tagName === 'IMG' && el.closest('.set-logo, .set-head')) el.outerHTML = plate(el.alt);
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
  const tabView = { set: 'sets', poke: 'collection', deck: 'decks' }[view] || view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === tabView));
  if (view !== 'scan') stopCam();
  if (view === 'collection') renderCollection();
  if (view === 'poke') renderPoke();
  if (view === 'sets') renderSets();
  if (view === 'wishlist') renderWishlist();
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
  $('#col-cards').hidden = colMode !== 'cards';
  $('#col-dex').hidden = colMode !== 'dex';
  if (colMode === 'dex') return renderDex();

  const s = store.stats();
  $('#stats').innerHTML = `
    <div class="stat"><div class="v">${s.total}</div><div class="k">cartes</div></div>
    <div class="stat"><div class="v">${s.unique}</div><div class="k">différentes</div></div>
    <div class="stat"><div class="v">${s.sets}</div><div class="k">séries</div></div>
    <div class="stat gold"><div class="v">${euro.format(s.value)}</div><div class="k">valeur estimée</div></div>`;

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
  let list;
  try { [list] = await Promise.all([api.sets(), api.logosReady]); } catch { box.innerHTML = empty('Erreur', 'Vérifie ta connexion internet.'); return; }
  const owned = store.ownedBySet();
  const q = scanner.norm($('#sets-filter').value.trim());
  const mine = $('#sets-mine').checked;
  const rows = [...list].reverse()
    .filter(s => (!q || scanner.norm(s.name).includes(q)) && (!mine || owned.has(s.id)))
    .map(s => {
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
    });
  box.innerHTML = rows.length ? rows.join('') : empty('Aucune série', mine ? 'Tu n\'as encore aucune carte.' : 'Rien ne correspond.');
}

$('#set-list').addEventListener('click', e => {
  const r = e.target.closest('[data-set]');
  if (r) openSet(r.dataset.set);
});

let currentSet = null, setFilter = 'all', setMode = 'master', setFinishMap = null, deepProgress = null;
async function openSet(id) {
  show('set');
  currentSet = null; setFinishMap = null; deepProgress = null;
  $('#set-head').innerHTML = '';
  $('#set-deep').innerHTML = '';
  $('#set-grid').innerHTML = spinner;
  try {
    const [s] = await Promise.all([api.set(id), api.logosReady]);
    currentSet = s;
    renderSet();
    if (setMode === 'master') loadFinishes();
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
  if (setMode !== 'master' || !currentSet) { box.innerHTML = ''; return; }
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
  $('#set-head').innerHTML = `<div class="set-head">
    ${setLogoHtml(s)}
    <div class="body">
      <h1>${esc(s.name)}</h1>
      <div class="count">${have} / ${tot} cartes${s.cards.length > tot ? ` (+${s.cards.length - tot} secrètes)` : ''}</div>
      <div class="bar ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>
      ${master ? `<div class="count" style="margin-top:8px">Toutes les versions (master set) : ${mHave} / ${mTot}</div>
        <div class="bar ${mHave >= mTot ? 'done' : ''}"><i style="width:${Math.min(100, mHave / mTot * 100)}%"></i></div>` : ''}
    </div>
  </div>`;
  renderDeepBox();

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
  if (current === 'collection') renderCollection();
  if (current === 'set') renderSet();
  if (current === 'sets') renderSets();
  if (current === 'poke') renderPoke();
  if (current === 'decks') renderDecks();
  if (current === 'deck') renderDeck();
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
if (location.hash === '#wishlist') show('wishlist');
checkPrices();
