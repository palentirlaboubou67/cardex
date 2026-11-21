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

function tile(c, { sub = '', missing = false } = {}) {
  const n = store.count(c.id);
  const src = api.img(c.image);
  return `<div class="tile ${missing && !n ? 'missing' : ''}" data-card="${esc(c.id)}">
    <div class="img">${src ? `<img loading="lazy" src="${esc(src)}" alt="">` : `<div class="noimg">${esc(c.name)}</div>`}</div>
    ${n ? `<span class="qty">${n}</span>` : ''}
    <div class="name">${esc(c.name)}</div>
    <div class="sub">${esc(sub)}</div>
  </div>`;
}

const empty = (title, text) => `<div class="empty"><b>${esc(title)}</b>${esc(text)}</div>`;
const spinner = '<div class="spinner"></div>';

// Une image qui ne charge pas devient une vignette avec le nom.
document.addEventListener('error', e => {
  const el = e.target;
  if (el.tagName === 'IMG' && el.closest('.tile')) {
    const name = el.closest('.tile').querySelector('.name')?.textContent || '';
    el.outerHTML = `<div class="noimg">${esc(name)}</div>`;
  }
}, true);

// Clic sur n'importe quelle carte → fiche détaillée.
document.addEventListener('click', e => {
  const t = e.target.closest('[data-card]');
  if (t) openCard(t.dataset.card);
});

// ---------- Navigation ----------
let current = 'scan';
function show(view) {
  current = view;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  const tabView = view === 'set' ? 'sets' : view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === tabView));
  if (view !== 'scan') stopCam();
  if (view === 'collection') renderCollection();
  if (view === 'sets') renderSets();
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
let currentCard = null;

async function openCard(id) {
  openSheet(spinner);
  try {
    const full = await api.card(id);
    if (!sheetOpen) return;
    currentCard = full;
    renderCard(full);
  } catch {
    openSheet(empty('Impossible de charger la carte', 'Vérifie ta connexion internet.'));
  }
}

function variantsOf(full) {
  const v = full.variants;
  const keys = v ? Object.keys(store.VARIANTS).filter(k => v[k]) : [];
  return keys.length ? keys : ['normal'];
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
    </div></div>
    <h2>${esc(full.name)}</h2>
    <div class="meta">${esc(full.set?.name)} · ${esc(fmtNum({ localId: full.localId, setTotal: full.set?.cardCount?.official }))}${full.illustrator ? ` · ill. ${esc(full.illustrator)}` : ''}</div>
    <div class="tags">${tags}</div>
    ${price || priceHolo ? `<div class="price">
      <div><small>Cote Cardmarket (tendance)</small><br><b>${price ? euro.format(price) : '—'}</b></div>
      ${priceHolo ? `<div style="text-align:right"><small>Reverse / Holo</small><br><b>${euro.format(priceHolo)}</b></div>` : ''}
    </div>` : ''}
    <p class="section-title">Dans ma collection</p>
    <div class="variants" id="variants"></div>
    ${attacks ? `<p class="section-title">Attaques</p>${attacks}` : ''}
  </div>`);
  renderVariants();
  bindHolo($('#holo'));
}

function renderVariants() {
  const full = currentCard, box = $('#variants');
  if (!full || !box) return;
  const rec = store.get(full.id);
  box.innerHTML = variantsOf(full).map(v => `<div class="variant">
      <span>${store.VARIANTS[v]}</span>
      <div class="stepper">
        <button data-step="${v}" data-d="-1" aria-label="Retirer">−</button>
        <span>${rec?.qty[v] || 0}</span>
        <button class="plus" data-step="${v}" data-d="1" aria-label="Ajouter">+</button>
      </div>
    </div>`).join('');
}

$('#sheet-body').addEventListener('click', e => {
  const b = e.target.closest('[data-step]');
  if (!b || !currentCard) return;
  const v = b.dataset.step, d = +b.dataset.d;
  const n = Math.max(0, (store.get(currentCard.id)?.qty[v] || 0) + d);
  store.setQty(currentCard, v, n);
  renderVariants();
  if (d > 0) navigator.vibrate?.(15);
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
        <button class="btn primary" id="quick-add">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Ajouter
        </button>
        <button class="btn" data-card="${esc(best.id)}">Détails</button>
      </div>
    </div>
    ${others.length ? `<p class="others-title">Ce n'est pas elle ? Autres possibilités :</p>
      <div class="others">${others.map(c => tile(c, { sub: c.setName })).join('')}</div>` : ''}`;
  $('#quick-add').onclick = async () => {
    try {
      const full = await api.card(best.id);
      store.add(full, variantsOf(full)[0]);
      toast(`${full.name} ajoutée (${store.count(full.id)} au total)`);
    } catch { toast('Ajout impossible : vérifie ta connexion'); }
  };
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
      .sort((a, b) => (!!b.image - !!a.image) || ((b.set?.order ?? 0) - (a.set?.order ?? 0)));
    box.innerHTML = list.length
      ? list.map(c => tile(c, { sub: `${c.set?.name || ''} · ${c.localId}` })).join('')
      : empty('Aucun résultat', `Rien pour « ${q} ».`);
  } catch {
    if (seq === searchSeq) box.innerHTML = empty('Erreur', 'Vérifie ta connexion internet.');
  }
}

// ---------- Collection ----------
$('#col-filter').addEventListener('input', renderCollection);
$('#col-sort').addEventListener('change', renderCollection);

function renderCollection() {
  const s = store.stats();
  $('#stats').innerHTML = `
    <div class="stat"><div class="v">${s.total}</div><div class="k">cartes</div></div>
    <div class="stat"><div class="v">${s.unique}</div><div class="k">différentes</div></div>
    <div class="stat"><div class="v">${s.sets}</div><div class="k">séries</div></div>
    <div class="stat gold"><div class="v">${euro.format(s.value)}</div><div class="k">valeur estimée</div></div>`;

  const q = scanner.norm($('#col-filter').value.trim());
  const sort = $('#col-sort').value;
  let cards = store.all().filter(c => !q || scanner.norm(`${c.name} ${c.setName}`).includes(q));
  const by = {
    recent: (a, b) => b.addedAt - a.addedAt,
    name: (a, b) => a.name.localeCompare(b.name, 'fr'),
    set: (a, b) => a.setName.localeCompare(b.setName, 'fr') || parseInt(a.localId) - parseInt(b.localId),
    price: (a, b) => store.value(b) - store.value(a),
  };
  cards.sort(by[sort]);
  $('#col-grid').innerHTML = cards.length
    ? cards.map(c => tile(c, { sub: `${c.setName} · ${c.localId}` })).join('')
    : store.all().length
      ? empty('Aucune carte', 'Rien ne correspond au filtre.')
      : empty('Ta collection est vide', 'Scanne ta première carte avec l\'onglet Scanner !');
}

// ---------- Séries ----------
$('#sets-filter').addEventListener('input', renderSets);
$('#sets-mine').addEventListener('change', renderSets);

async function renderSets() {
  const box = $('#set-list');
  if (!box.children.length) box.innerHTML = spinner;
  let list;
  try { list = await api.sets(); } catch { box.innerHTML = empty('Erreur', 'Vérifie ta connexion internet.'); return; }
  const owned = store.ownedBySet();
  const q = scanner.norm($('#sets-filter').value.trim());
  const mine = $('#sets-mine').checked;
  const rows = [...list].reverse()
    .filter(s => (!q || scanner.norm(s.name).includes(q)) && (!mine || owned.has(s.id)))
    .map(s => {
      const have = owned.get(s.id) || 0;
      const tot = s.cardCount?.official || s.cardCount?.total || 0;
      const pct = tot ? Math.min(100, (have / tot) * 100) : 0;
      const l = api.logo(s.logo || s.symbol);
      return `<button class="set-row" data-set="${esc(s.id)}">
        <div class="set-logo">${l ? `<img loading="lazy" src="${esc(l)}" alt="">` : `<span class="ph">${esc(s.id)}</span>`}</div>
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

let currentSet = null, setFilter = 'all';
async function openSet(id) {
  show('set');
  $('#set-head').innerHTML = '';
  $('#set-grid').innerHTML = spinner;
  try {
    currentSet = await api.set(id);
    renderSet();
  } catch {
    $('#set-grid').innerHTML = empty('Erreur', 'Vérifie ta connexion internet.');
  }
}

function renderSet() {
  const s = currentSet;
  if (!s) return;
  const tot = s.cardCount?.official || s.cards.length;
  const have = s.cards.filter(c => store.count(c.id)).length;
  const pct = Math.min(100, (have / tot) * 100);
  const l = api.logo(s.logo || s.symbol);
  $('#set-head').innerHTML = `<div class="set-head">
    ${l ? `<img src="${esc(l)}" alt="">` : ''}
    <div class="body">
      <h1>${esc(s.name)}</h1>
      <div class="count">${have} / ${tot} cartes${s.cards.length > tot ? ` (+${s.cards.length - tot} secrètes)` : ''}</div>
      <div class="bar ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>
    </div>
  </div>`;
  const cards = s.cards.filter(c => setFilter === 'all' || (setFilter === 'owned') === !!store.count(c.id));
  $('#set-grid').innerHTML = cards.length
    ? cards.map(c => tile(c, { sub: `${c.localId}/${tot}`, missing: true })).join('')
    : empty(setFilter === 'owned' ? 'Aucune carte possédée' : 'Série complète !', '');
}

$('#set-back').addEventListener('click', () => show('sets'));
$('#set-chips').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  setFilter = c.dataset.f;
  document.querySelectorAll('#set-chips .chip').forEach(x => x.classList.toggle('active', x === c));
  renderSet();
});

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
  // met à jour les badges de quantité visibles (scan, recherche)
  document.querySelectorAll('#scan-results .tile, #search-results .tile').forEach(t => {
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
