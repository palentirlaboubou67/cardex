// Vue Scanner (SPEC §10, FINAL-design W-A / W-B, FINAL-scanner §5.7) sur l'API de js/scan (SC) :
// viseur pleine largeur (guide 63:88, quad détecté, coins verts quand les 4 côtés sont trouvés, pastille d'état),
// déclencheur, import de photo, lampe, zoom ; panneau de résultat au bas du viseur (ajout explicite par version, avec
// Annuler), choix « Laquelle est-ce ? », carte non reconnue ; caméra coupée en quittant la vue et relancée au retour ;
// états de la caméra (https, refus, absente) ; liste des cartes ajoutées pendant le scan.
import { setBar } from '../core/appbar.js';
import { html, setHTML, delegate } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { infoSheet, openSheet } from '../core/sheet.js';
import { toast } from '../core/toast.js';
import { whenIdle } from '../core/idle.js';
import { plural } from '../core/format.js';
import { MESSAGES } from '../core/net.js';
import * as col from '../state/collection.js';
import * as prefs from '../state/prefs.js';
import * as catalog from '../data/catalog.js';
import * as prices from '../data/prices.js';
import * as tcgdex from '../data/tcgdex.js';
import { dexNums } from '../data/dex.js';
import { FINISHES, LABEL, SHORT, DOT, sortFinishes } from '../data/finishes.js';
import * as scan from '../scan/index.js';
import * as session from './scanner/session.js';
import * as P from './scanner/panel.js';

const TIPS = [
  'Pose la carte à plat, bien éclairée, sans reflet. Les quatre coins doivent rester dans le guide.',
  'La carte est reconnue dès qu’elle ne bouge plus. Si l’image est floue, recule un peu le téléphone.',
  'Sors la carte de son étui rigide si tu peux : le bord de l’étui gêne la détection.',
  'Rien n’est ajouté tout seul : touche la version que tu as (Normale, Reverse…). « Ajout » choisit celle mise en avant.',
  'Plusieurs séries ont la même illustration : vérifie le numéro et le symbole en bas de la carte.',
  'La base de reconnaissance (environ 1,5 Mo) reste sur l’appareil : le scan marche ensuite hors ligne.',
];

// états de la caméra affichés dans le viseur (CameraError.kind de js/scan/camera.js, plus off et lost)
const OFF = {
  off: { t: 'Scanne tes cartes avec la caméra', p: 'Place une carte dans le guide : elle est reconnue toute seule.', act: 'start' },
  insecure: { t: 'Caméra indisponible ici', p: 'La caméra en direct demande une adresse sécurisée (https). Tu peux importer une photo de la carte.', act: 'import' },
  unsupported: { t: 'Caméra non prise en charge', p: 'Ce navigateur ne donne pas accès à la caméra. Tu peux importer une photo de la carte.', act: 'import' },
  denied: { t: 'Accès à la caméra refusé', p: 'Autorise la caméra pour ce site dans les réglages du navigateur, puis réessaie. Tu peux aussi importer une photo.', act: 'retry' },
  nocamera: { t: 'Aucune caméra trouvée', p: 'Importe une photo de la carte à la place.', act: 'import' },
  busy: { t: 'Caméra occupée', p: 'Une autre application utilise la caméra. Ferme-la, puis réessaie.', act: 'retry' },
  lost: { t: 'La caméra s’est arrêtée', p: 'Elle a été coupée par le système ou par une autre application.', act: 'retry' },
  unknown: { t: 'Impossible d’ouvrir la caméra', p: 'Réessaie, ou importe une photo de la carte.', act: 'retry' },
};
const LIVE = new Set(['init', 'starting', 'on']);
const NONE_HINT = 'Carte non reconnue';      // indication de js/scan/loop.js après un déclenchement sans carte plausible
const ZOOMS = [1, 1.5, 2, 3];
const desk = matchMedia('(min-width: 900px)');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uniq = a => [...new Set(a.filter(Boolean))];
const zoomLabel = z => `${(Math.round((z || 1) * 10) / 10).toLocaleString('fr-FR')}×`;

let el = null, E = {};
let visible = false, sig = null;
let loop = null, camGen = 0, camOn = false, caps = null, torch = false, zoom = null;
let vfState = 'init';
let dbReady = false, dbPct = 0, dbErr = null, preloading = false;
let shown = null;            // { mode: result|choose|none|busy, src: live|photo, res, cards, id, file, away }
let token = 0;               // change à chaque nouveau contenu du panneau : un résultat tardif est ignoré
let shutterAt = 0;
let perm = null;             // PermissionStatus de la caméra (si le navigateur le donne)
let sessSheet = null;        // feuille « Ajoutées pendant ce scan » ouverte
let quadOn = false, lastHint = '', hintT = 0, holdUntil = 0, ocrWarm = false;
let camOpts = {};            // contraintes en plus (tests : fausse caméra de Chromium en portrait)
let focusNext = false;       // geste explicite (déclencheur, photo) : le titre du panneau prend le focus

// ---------------------------------------------------------------------------------------------------------
// Squelette de la vue (une fois)

function skeleton() {
  return html`<div class="scn">
    <div class="scn-vf" data-cam="init" data-content>
      <video class="scn-video" playsinline muted autoplay disablepictureinpicture aria-hidden="true"></video>
      <div class="scn-stage" aria-hidden="true"><div class="scn-guide"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><i class="scn-line"></i></div></div>
      <svg class="scn-quad" aria-hidden="true" focusable="false"><polygon points=""/></svg>
      <div class="scn-off" hidden></div>
      <div class="scn-hud">
        <p class="scn-pill" role="status" aria-live="polite" hidden></p>
        <div class="scn-ctrl">
          <button type="button" class="scn-btn scn-photo" aria-label="Importer une photo">${icon('image')}</button>
          <button type="button" class="scn-shutter" aria-label="Scanner maintenant" disabled><span></span></button>
          <span class="scn-right">
            <button type="button" class="scn-btn scn-zoom" hidden></button>
            <button type="button" class="scn-btn scn-torch" aria-label="Allumer la lampe" aria-pressed="false" hidden>${icon('flash')}</button>
          </span>
        </div>
      </div>
      <input type="file" class="scn-file sr" accept="image/*" tabindex="-1" aria-hidden="true">
    </div>
    <section class="scn-panel" aria-label="Résultat du scan">
      <div class="scn-head">
        <span class="scn-sum"></span>
        <button type="button" class="chip chip-sel scn-preset" aria-haspopup="dialog"></button>
        <button type="button" class="ibtn scn-x" aria-label="Fermer le résultat" hidden>${icon('close')}</button>
      </div>
      <div class="scn-body"></div>
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------
// Barre d'app

function bar() {
  if (!visible || !sig || sig.aborted) return;
  const auto = prefs.get('scanAuto', true), n = session.count();
  const menu = [
    auto
      ? { icon: 'scan', label: 'Désactiver le scan automatique', sub: 'Tu déclenches chaque scan toi-même', onClick: () => setAuto(false) }
      : { icon: 'scan', label: 'Activer le scan automatique', sub: 'La carte est reconnue dès qu’elle ne bouge plus', onClick: () => setAuto(true) },
    { icon: 'list', label: 'Ajoutées pendant ce scan', sub: n ? plural(n, 'carte', 'cartes') : 'Aucune pour l’instant', onClick: openSession },
  ];
  if (camOn) menu.push({ icon: 'camera', label: 'Arrêter la caméra', onClick: () => stopCamera({ user: true }) });
  setBar({ title: 'Scanner', signal: sig, actions: [{ icon: 'info', label: 'Conseils de scan', onClick: () => infoSheet('Conseils de scan', TIPS) }], menu });
}

function setAuto(on) {
  prefs.set('scanAuto', !!on);
  loop?.setAuto(!!on);
  bar();
  toast(on ? 'Scan automatique activé' : 'Scan automatique désactivé : appuie sur le déclencheur');
}

// ---------------------------------------------------------------------------------------------------------
// Pastille d'état (aria-live) : une indication de la boucle ne s'affiche que si elle tient 300 ms (pas de clignotement
// ni de bavardage pour les lecteurs d'écran) ; une annonce (carte reconnue) reste 2 s.

function pillText() {
  if (vfState === 'starting') return 'Ouverture de la caméra…';
  if (!camOn) return '';
  if (!dbReady && !dbErr) return `Chargement de la base des cartes… ${Math.round(dbPct * 100)} %`;
  return lastHint || 'Cadre la carte dans le guide';
}

function paintPill(text) {
  if (E.pill.textContent !== text) E.pill.textContent = text;
  E.pill.hidden = !text;
}

function setHint(h, now = false) {
  if (h === lastHint) return;
  lastHint = h;
  if (performance.now() < holdUntil) return;
  clearTimeout(hintT);
  if (now) { paintPill(pillText()); return; }
  hintT = setTimeout(() => { if (performance.now() >= holdUntil) paintPill(pillText()); }, 300);
}

function announce(text, ms = 2000) {
  clearTimeout(hintT);
  holdUntil = performance.now() + ms;
  paintPill(text);
  hintT = setTimeout(() => { holdUntil = 0; paintPill(pillText()); }, ms);
}

const refreshPill = () => { if (performance.now() >= holdUntil) paintPill(pillText()); };

// ---------------------------------------------------------------------------------------------------------
// Base des cartes (1,2 Mo + 0,3 Mo, gardée par le service worker)

function startPreload() {
  if (dbReady || preloading) return;
  preloading = true;
  dbErr = null;
  scan.preload(p => { dbPct = p; if (!dbReady) refreshPill(); }).then(() => {
    dbReady = true; dbErr = null;
  }, e => {
    dbErr = e;
    console.warn('scan : base des cartes indisponible :', e?.kind || e?.message || e);
  }).finally(() => { preloading = false; refreshPill(); });
}

// ---------------------------------------------------------------------------------------------------------
// Caméra

async function camPermission() {
  try {
    if (!perm) {
      perm = await navigator.permissions?.query({ name: 'camera' });
      perm?.addEventListener?.('change', () => {
        if (!visible) return;
        if (perm.state === 'granted' && !camOn && vfState !== 'starting' && prefs.get('scanCam') !== false) startCamera();
        else if (perm.state === 'denied') { stopCamera(); setVf('denied'); }
      });
    }
    return perm?.state || null;
  } catch { return null; }       // Firefox ou Safari ancien : pas d'état de permission pour la caméra
}

// ordinateur sans caméra : « Importer une photo » devient l'action principale (sur téléphone, on suppose une caméra)
async function noCameraHere() {
  if (!matchMedia('(pointer: fine)').matches) return false;
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return Array.isArray(list) && !list.some(d => d.kind === 'videoinput');
  } catch { return false; }
}

// au retour sur la vue : caméra relancée si elle était allumée, ou si l'autorisation est déjà donnée
async function autoStart() {
  if (camOn || !visible || vfState === 'starting') return;
  const my = camGen;
  if (globalThis.isSecureContext === false) return setVf('insecure');
  if (!navigator.mediaDevices?.getUserMedia) return setVf('unsupported');
  const state = await camPermission();
  if (!visible || my !== camGen || camOn) return;
  if (state === 'denied') return setVf('denied');
  const want = prefs.get('scanCam');
  if (want === true || (state === 'granted' && want !== false)) return startCamera();
  const none = await noCameraHere();
  if (!visible || my !== camGen || camOn) return;
  setVf(none ? 'nocamera' : 'off', state === 'granted');
}

async function startCamera() {
  if (!visible) return;
  const my = ++camGen;
  setVf('starting');
  let res;
  try {
    res = await scan.openCamera(E.video, camOpts);
  } catch (e) {
    if (my !== camGen || e?.kind === 'aborted') return;
    camOn = false;
    setVf(OFF[e?.kind] ? e.kind : 'unknown');
    return;
  }
  if (my !== camGen || !visible) { if (my === camGen) scan.closeCamera(); return; }
  camOn = true;
  caps = res.caps;
  torch = false;
  zoom = caps?.zoom ? caps.zoom.value : null;
  prefs.set('scanCam', true);
  res.stream?.getVideoTracks?.()[0]?.addEventListener('ended', () => {
    if (my === camGen && camOn) { stopCamera(); setVf('lost'); }
  });
  setVf('on');
  startPreload();
  loop = scan.createLoop({ video: E.video, guide: E.guide, auto: prefs.get('scanAuto', true), onState, onResult });
  // un résultat de photo est affiché : la boucle attend qu'on le ferme
  if (!photoHeld()) loop.start();
  bar();
}

function stopCamera({ user = false } = {}) {
  camGen++;
  loop?.destroy();
  loop = null;
  scan.closeCamera();
  const was = camOn;
  camOn = false; caps = null; torch = false; zoom = null;
  shutterAt = 0;
  lastHint = '';
  drawQuad(null);
  delete E.vf.dataset.state;
  E.guide.classList.remove('ok');
  if (user) { prefs.set('scanCam', false); setVf('off', true); }
  if (was) bar();
}

function setVf(kind, granted = false) {
  vfState = kind;
  E.vf.dataset.cam = kind;
  const live = LIVE.has(kind);
  E.off.hidden = live;
  E.shutter.disabled = kind !== 'on';
  if (!live) {
    const o = OFF[kind] || OFF.unknown;
    const primary = o.act === 'import' ? ['import', 'Importer une photo']
      : o.act === 'start' ? ['start', granted ? 'Activer la caméra' : 'Autoriser la caméra'] : ['start', 'Réessayer'];
    // caméra inutilisable : la recherche par nom (Séries) reste proposée, comme dans l'ancienne appli
    setHTML(E.off, html`<span class="ic">${icon(kind === 'off' ? 'camera' : 'alert')}</span><b>${o.t}</b><p>${o.p}</p>
      <span class="scn-off-acts"><button type="button" class="btn primary" data-${primary[0]}>${primary[1]}</button>${
      o.act !== 'import' ? html`<button type="button" class="btn text" data-import>Importer une photo</button>` : ''}${
      kind !== 'off' ? html`<a class="btn text" href="${P.searchHref('')}">Chercher une carte par son nom</a>` : ''}</span>`);
  }
  renderCaps();
  renderHead();
  refreshPill();
}

function renderCaps() {
  const t = !!(camOn && caps?.torch);
  E.torch.hidden = !t;
  E.torch.setAttribute('aria-pressed', torch ? 'true' : 'false');
  E.torch.setAttribute('aria-label', torch ? 'Éteindre la lampe' : 'Allumer la lampe');
  setHTML(E.torch, icon(torch ? 'flash-off' : 'flash'));
  const steps = zoomSteps();
  E.zoom.hidden = !(camOn && steps.length > 1);
  if (!E.zoom.hidden) {
    E.zoom.textContent = zoomLabel(zoom);
    E.zoom.setAttribute('aria-label', `Zoom ${zoomLabel(zoom)}, toucher pour changer`);
  }
}

function zoomSteps() {
  const z = caps?.zoom;
  if (!z) return [];
  return uniq([z.min, ...ZOOMS].map(v => Math.round(v * 100) / 100)).filter(v => v >= z.min - 1e-6 && v <= z.max + 1e-6).sort((a, b) => a - b);
}

async function toggleTorch() {
  const want = !torch;
  const ok = await scan.setTorch(want);
  if (ok) torch = want; else toast('La lampe ne répond pas');
  renderCaps();
}

async function cycleZoom() {
  const steps = zoomSteps();
  if (steps.length < 2) return;
  const next = steps.find(v => v > (zoom ?? 0) + 0.05) ?? steps[0];
  if (await scan.setZoom(next)) zoom = next;
  renderCaps();
}

// ---------------------------------------------------------------------------------------------------------
// Boucle de scan : états (quad, pastille) et résultats

function drawQuad(q, found = 0) {
  if (!q) {
    if (quadOn) { E.poly.setAttribute('points', ''); E.quad.classList.remove('on', 'ok'); quadOn = false; }
    return;
  }
  E.poly.setAttribute('points', q.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
  E.quad.classList.toggle('ok', found >= 4);
  if (!quadOn) { E.quad.classList.add('on'); quadOn = true; }
}

function onState(s) {
  if (!visible || !camOn) return;
  if (s.state === 'error') dbErr ||= { kind: s.error };
  else if (dbErr && loop?.state?.db === 'ok') { dbErr = null; dbReady = true; }
  if (E.vf.dataset.state !== s.state) E.vf.dataset.state = s.state;
  // carte reconnue (pause) : coins verts tant qu'elle est là, sans contour (le panneau montre le résultat)
  const paused = s.state === 'paused';
  drawQuad(paused ? null : s.quad, s.found);
  E.guide.classList.toggle('ok', !!s.quad && (paused || s.found >= 4));
  setHint(s.hint || '', s.state === 'identifying' || s.state === 'error');
  // la carte affichée est partie et une autre arrive : l'ancien résultat est fermé (le guide redevient visible)
  if (shown && shown.src === 'live' && shown.mode !== 'busy') {
    if (s.state === 'searching') shown.away = (shown.away || 0) + 1;
    else if ((shown.away || 0) >= 3 && (s.state === 'detected' || s.state === 'identifying')) dismiss();
    else if (s.state !== 'error') shown.away = 0;
  }
  // déclencheur sans carte plausible
  if (shutterAt && s.hint === NONE_HINT && s.state === 'uncertain') {
    shutterAt = 0;
    showNone({ src: 'live' });
  }
}

function onResult(res) {
  if (!visible || !res?.best?.id) return;
  if (!shutterAt) focusNext = false;          // résultat venu tout seul : le focus ne bouge pas
  shutterAt = 0;
  if (res.decision === 'accept') {
    try { navigator.vibrate?.(30); } catch { /* pas de vibreur */ }
    showResult(res, 'live');
  } else showChooser(res, 'live');
}

// ---------------------------------------------------------------------------------------------------------
// Cartes des résultats (catalogue statique, sinon TCGdex en direct)

const fallbackBrief = id => {
  const s = catalog.setIdOf(id), m = catalog.metaSync(s), l = catalog.localIdOf(id);
  return { id, localId: l, name: `Carte ${l}`, setId: s, setName: m?.name || s, setTotal: m?.total || 0, image: '', rarity: '', category: '', dexId: [], finishes: ['normal'] };
};

async function briefOf(id) {
  let c = null;
  try { c = await catalog.card(id); } catch { /* hors ligne, série absente */ }
  if (!c) {
    try {
      const full = await tcgdex.card(id);
      const m = catalog.metaSync(catalog.setIdOf(id));
      c = { ...tcgdex.toBrief(full), setName: full?.set?.name || m?.name || '', setTotal: full?.set?.cardCount?.official || m?.total || 0 };
    } catch { c = null; }
  }
  if (c && (!c.setName || !c.setTotal)) {
    const m = catalog.metaSync(c.setId || catalog.setIdOf(id));
    c = { ...c, setName: c.setName || m?.name || '', setTotal: c.setTotal || m?.total || 0 };
  }
  return c;
}

async function briefs(ids) {
  const list = await Promise.all(ids.map(id => briefOf(id).then(c => [id, c])));
  return new Map(list.filter(([, c]) => c));
}

// Même illustration : groupes de réimpressions (dups) et jumelles (twins) de data/scan/cards.json. Les autres
// « alternatives » de js/scan sont des sosies (cartes différentes qui se ressemblent) : elles vont dans « Pas la bonne ? ».
let SAME = null;
function sameArt(id) {
  const d = scan.scanData();
  if (!d) return [id];
  if (!SAME) {
    SAME = new Map();
    const link = (a, b) => { if (a !== b) { if (!SAME.has(a)) SAME.set(a, new Set()); SAME.get(a).add(b); } };
    for (const g of d.dups || []) for (const a of g) for (const b of g) link(a, b);
    for (const [a, list] of Object.entries(d.twins || {})) for (const b of list || []) { link(a, b); link(b, a); }
  }
  return [id, ...(SAME.get(id) || [])];
}

const pricesSoon = ids => Promise.race([prices.ensure(uniq(ids.map(catalog.setIdOf))), sleep(600)]);

// finition de l'ajout rapide : la préférence si la carte l'a, sinon sa première version (WAVE1 §5.5)
const finishesOf = c => { const f = sortFinishes(c?.finishes || []); return f.length ? f : ['normal']; };
const prefOf = c => {
  const p = prefs.get('scanFinish', 'normal');
  const f = finishesOf(c);
  return f.includes(p) ? p : f[0];
};

// ---------------------------------------------------------------------------------------------------------
// Panneau

// résultat périmé : contenu du panneau remplacé ou fermé entre-temps ; en direct, vue quittée aussi. Une photo garde
// son résultat même si on quitte la vue (section gardée) : on le retrouve au retour, sans rester sur « Analyse… »
const stale = (my, src) => my !== token || (src !== 'photo' && !visible);

async function showResult(res, src, file = null) {
  const my = ++token;
  const base = uniq([res.best.id, ...(res.candidates || []).map(c => c.id), ...(res.alternatives || [])]);
  const cards = await briefs(uniq([...base, ...base.flatMap(sameArt)]));
  if (stale(my, src)) return;
  if (!cards.has(res.best.id)) cards.set(res.best.id, fallbackBrief(res.best.id));
  await pricesSoon([...cards.keys()]);
  if (stale(my, src)) return;
  shown = { mode: 'result', src, res, cards, id: res.best.id, file };
  render();
  if (visible) announce(`Reconnue : ${cards.get(res.best.id).name}`);
  if (src === 'live') warmOcrLater();
}

async function showChooser(res, src, file = null) {
  const my = ++token;
  const ids = uniq([...(res.candidates || []).map(c => c.id), res.best.id, ...(res.alternatives || [])]);
  const cards = await briefs(uniq([...ids, ...ids.flatMap(sameArt)]));
  if (stale(my, src)) return;
  await pricesSoon([...cards.keys()]);
  if (stale(my, src)) return;
  if (!cards.size) { showNone({ src, file }); return; }
  shown = { mode: 'choose', src, res, cards, id: null, file };
  render();
  if (visible) announce('Laquelle est-ce ? Touche la bonne carte');
  // photo importée : la lecture du numéro peut départager (en direct, la boucle le fait déjà)
  if (src === 'photo' && res.token) {
    scan.ocrFallback(file, { token: res.token, candidates: ids }).then(o => {
      if (my !== token || !o?.best?.id) return;
      if (o.decision === 'accept') showResult(o, 'photo', file);
      else if (o.candidates.map(c => c.id).join() !== (res.candidates || []).map(c => c.id).join()) showChooser(o, 'photo', file);
    }).catch(e => console.warn('OCR indisponible :', e?.message || e));
  }
}

function showNone({ src, file = null, title, text, retry, search = true, again = false } = {}) {
  token++;
  shown = { mode: 'none', src, file, title, text, retry, search, again };
  render();
  // photo sans résultat (y compris choix sans aucune carte connue) : le scan en direct reprend derrière le message
  if (src === 'photo' && camOn) loop?.start();
  if (visible) announce(title || 'Carte non reconnue');
}

const focusIn = node => { try { node?.focus({ preventScroll: true }); } catch { /* rien */ } };

function render() {
  const open = !!shown;
  // focus clavier dans le contenu remplacé (choix puis résultat, bouton « Annuler » de la liste) : il ne tombe pas sur <body>
  const ae = document.activeElement;
  const had = visible && !!ae && ae !== E.body && E.body.contains(ae);
  const undoAt = had && ae.matches('[data-undo]') ? [...E.body.querySelectorAll('[data-undo]')].indexOf(ae) : -1;
  E.panel.classList.toggle('open', open);
  E.x.hidden = !open;
  E.body.classList.toggle('idle', !open);
  if (!open) {
    setHTML(E.body, desk.matches ? P.idleHTML(session.list(), sessionValue()) : '');
    if (had) {
      const undos = E.body.querySelectorAll('[data-undo]');
      focusIn(undos[Math.min(Math.max(undoAt, 0), undos.length - 1)] || E.body.querySelector('[data-clear]') || E.preset);
    }
    return;
  }
  const s = shown;
  if (s.mode === 'busy') setHTML(E.body, P.busyHTML());
  else if (s.mode === 'none') setHTML(E.body, P.noneHTML({ title: s.title, text: s.text, retry: s.retry, search: s.search }));
  else if (s.mode === 'choose') {
    const picks = (s.res.candidates || []).map(c => s.cards.get(c.id)).filter(Boolean).slice(0, 3);
    const same = picks.some((c, i) => picks.some((d, j) => j > i && sameArt(c.id).includes(d.id)));
    setHTML(E.body, P.chooserHTML({ picks, same, q: picks[0]?.name || '' }));
  } else if (s.mode === 'result') setHTML(E.body, P.resultHTML(resultView()));
  E.body.scrollTop = 0;
  // vue quittée (photo analysée pendant ce temps) : le focus ne bouge pas
  if (!visible) { focusNext = false; return; }
  // les commandes du viseur passent sous le panneau : le focus clavier va au titre (analyse, choix, résultat) ; le
  // contenu suivant le reprend tant qu'il reste dans le panneau
  if (focusNext || had) {
    focusNext = false;
    focusIn(E.body.querySelector('.scn-name, .scn-ttl, .scn-busy-h'));
  }
}

function resultView() {
  const s = shown, c = s.cards.get(s.id);
  const pref = prefOf(c);
  // même illustration (réimpressions, jumelles sans image) : la carte affichée et ses autres versions, dans l'ordre
  // des candidats ; « Pas la bonne ? » : les autres candidats et sosies (5 vignettes au plus, la carte affichée d'abord)
  const order = uniq([s.res.best.id, ...(s.res.candidates || []).map(x => x.id), ...(s.res.alternatives || [])]);
  const art = sameArt(s.id);
  const group = uniq([...order.filter(id => art.includes(id)), ...art]).map(id => s.cards.get(id)).filter(Boolean)
    .sort((a, b) => (a.id === s.id ? -1 : b.id === s.id ? 1 : 0));
  const inGroup = new Set(group.map(g => g.id));
  const thumbs = uniq([s.id, ...order.filter(id => !inGroup.has(id))]).map(id => s.cards.get(id)).filter(Boolean).slice(0, 5);
  return {
    card: c, finishes: finishesOf(c), pref, price: prices.get(c.id, pref), qty: col.get(c.id)?.qty || {},
    dex: dexNums(c)[0] || null, group, thumbs, q: c.name,
  };
}

function patchResult() {
  if (shown?.mode !== 'result') return;
  const c = shown.cards.get(shown.id);
  const own = E.body.querySelector('.scn-own');
  if (own) { const t = P.ownedText(col.get(c.id)?.qty); own.textContent = t; own.hidden = !t; }
  const pr = E.body.querySelector('.scn-price');
  if (pr) { const f = prefOf(c); pr.outerHTML = String(P.priceHTML(prices.get(c.id, f), f)); }
}

// carte d'une photo importée à l'écran (analyse, résultat ou choix) : le scan en direct attend
const photoHeld = () => !!shown && shown.src === 'photo' && shown.mode !== 'none';

// user : fermé à la main (✕, Échap), pas parce que la carte est sortie du cadre
function dismiss({ user = false } = {}) {
  token++;
  const was = shown;
  const hadFocus = E.panel.contains(document.activeElement);
  shown = null;
  render();
  if (was?.src === 'photo') { if (camOn) loop?.start(); }
  else if (user && was?.src === 'live' && loop) {
    // le travail en cours (lecture du numéro) est annulé : rien ne rouvre le panneau tout seul. Résultat ou choix :
    // pause jusqu'à ce que la carte sorte du cadre, comme après un choix (le déclencheur relance un scan)
    if (was.mode === 'none') { loop.stop(); loop.start(); }
    else if (loop.state.phase !== 'paused') loop.hold();
  }
  refreshPill();
  // le focus clavier revient au viseur (déclencheur, ou action du bloc caméra)
  if (hadFocus) { try { (camOn ? E.shutter : E.off.querySelector('.btn') || E.preset).focus({ preventScroll: true }); } catch { /* rien */ } }
}

function pick(id, btn) {
  if (!shown?.cards?.has(id)) return;
  token++;                                    // un résultat tardif (lecture OCR) ne remplace pas ce choix
  const from = shown.mode;
  shown.mode = 'result';
  shown.id = id;
  if (from === 'choose' && shown.src === 'live') loop?.hold();
  render();
  // le focus suit le choix (le bouton touché a été redessiné)
  const sel = from === 'choose' ? '.scn-name'
    : btn?.classList.contains('scn-thumb') ? `.scn-thumb[data-pick="${CSS.escape(id)}"]` : `.scn-alts [data-pick="${CSS.escape(id)}"]`;
  try { (E.body.querySelector(sel) || E.body.querySelector('.scn-name'))?.focus({ preventScroll: true }); } catch { /* rien */ }
}

function retry() {
  if (shown?.again && shown.file) { importPhoto(shown.file); return; }   // base indisponible : même photo
  if (shown?.src === 'photo' || !camOn) { E.file.click(); return; }
  dismiss();
  shutter();
}

// ---------------------------------------------------------------------------------------------------------
// Ajout à la collection (toujours un geste, avec Annuler)

function addFinish(f) {
  if (shown?.mode !== 'result') return;
  const c = shown.cards.get(shown.id);
  if (!c || !FINISHES.includes(f)) return;
  try { col.add(c, f); } catch (e) { console.error(e); toast('Impossible d’ajouter cette carte'); return; }
  session.added(c, f);
  try { navigator.vibrate?.(20); } catch { /* pas de vibreur */ }
  toast(`${c.name} ajoutée en ${LABEL[f] || f} · ${col.qtyOf(c.id)} au total`, {
    action: 'Annuler',
    onAction: () => {
      const n = col.qtyOf(c.id, f);
      if (n > 0) col.setQty(col.get(c.id) || c, f, n - 1);
      session.removed(c.id, f, 1);
      toast('Ajout annulé');
    },
  });
}

function undoEntry(id, finish) {
  const x = session.find(id, finish);
  if (!x) return;
  const n = col.qtyOf(id, finish);
  if (n > 0) col.setQty(col.get(id) || x, finish, Math.max(0, n - x.n));
  session.removed(id, finish, x.n);
  toast(`Ajout annulé : ${x.name}`);
}

function sessionValue() {
  try { return prices.sum(session.list().map(x => ({ id: x.id, finish: x.finish, n: x.n }))); } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------
// En-tête du panneau : séance et version de l'ajout rapide

function renderHead() {
  const n = session.count();
  setHTML(E.sum, n
    ? html`<button type="button" class="scn-sum-b" aria-haspopup="dialog" aria-label="${`${plural(n, 'carte ajoutée', 'cartes ajoutées')} pendant ce scan, voir la liste`}">${icon('check', { size: 18 })}<span><b class="num">${n}</b> ${n > 1 ? 'ajoutées' : 'ajoutée'}</span>${icon('chevron-right', { size: 16 })}</button>`
    : html`<span class="scn-sum-t">${LIVE.has(vfState) && vfState !== 'init' ? 'Prêt à scanner' : 'Aucune carte ajoutée'}</span>`);
  const p = prefs.get('scanFinish', 'normal');
  setHTML(E.preset, html`<span class="v">Ajout : ${SHORT[p] || p}</span>${icon('chevron-down', { size: 14 })}`);
  E.preset.setAttribute('aria-label', `Version ajoutée en premier : ${LABEL[p] || p}. Changer`);
}

function presetSheet() {
  const cur = prefs.get('scanFinish', 'normal');
  const body = html`<div class="menu list" role="menu">${FINISHES.map(f => html`<button type="button" role="menuitemradio" class="row${f === cur ? ' sel' : ''}" aria-checked="${f === cur ? 'true' : 'false'}" data-f="${f}"><span class="lead"><i class="${DOT[f]}"></i></span><span class="body"><span class="t">${LABEL[f]}</span></span>${f === cur ? icon('check', { cls: 'scn-check' }) : ''}</button>`)}</div>
    <p class="scn-note">Cette version est mise en avant dans le résultat. Si la carte n’existe pas dans cette version, sa première version est proposée.</p>`;
  const s = openSheet({ title: 'Version ajoutée en premier', body });
  s.el.querySelector('.menu').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    prefs.set('scanFinish', b.dataset.f);
    renderHead();
    if (shown?.mode === 'result') render();
    s.close();
  });
}

const sessionBody = () => html`<div class="scn-sheet">${P.sessionHTML(session.list(), sessionValue())}</div>`;

function openSession() {
  if (desk.matches && !shown) { E.body.querySelector('.scn-sect')?.scrollIntoView({ block: 'nearest' }); return; }
  const s = openSheet({ title: 'Ajoutées pendant ce scan', body: sessionBody(), onClose: () => { sessSheet = null; } });
  sessSheet = s;
  s.el.addEventListener('click', onSessionClick);
}

function onSessionClick(e) {
  const u = e.target.closest('[data-undo]');
  if (u) { undoEntry(u.dataset.undo, u.dataset.fin); return; }
  if (e.target.closest('[data-clear]')) { session.clear(); toast('Liste effacée : les cartes restent dans ta collection'); }
}

function onSession() {
  renderHead();
  if (sessSheet?.el?.isConnected && sessSheet.el.querySelector('.scn-sheet')) setHTML(sessSheet.el, sessionBody());
  if (!shown && desk.matches) render();
  bar();
}

// préchargement de l'OCR (≈ 4,8 Mo, une fois par appareil) après une première reconnaissance, en ligne, au repos
function warmOcrLater() {
  if (ocrWarm) return;
  ocrWarm = true;
  try { if (localStorage.getItem('cardex.ocrWarm.v1') || navigator.onLine === false || navigator.connection?.saveData) return; } catch { return; }
  whenIdle(() => {
    scan.warmOcr().then(() => { try { localStorage.setItem('cardex.ocrWarm.v1', String(Date.now())); } catch { /* rien */ } }).catch(() => {});
  }, { timeout: 10000 });
}

// ---------------------------------------------------------------------------------------------------------
// Photo importée et déclencheur

async function importPhoto(file) {
  if (!file) return;
  focusNext = true;
  loop?.stop();
  shutterAt = 0;
  const my = ++token;
  shown = { mode: 'busy', src: 'photo', file };
  render();
  announce('Analyse de la photo…');
  let res = null, err = null;
  try { res = await scan.identifyImage(file); } catch (e) { err = e; }
  if (stale(my, 'photo')) return;
  if (err) {
    const decode = err instanceof scan.ScanError || err?.kind === 'decode';
    if (!decode) console.warn('scan : photo :', err?.kind || err?.message || err);
    showNone(decode
      ? { src: 'photo', file, title: 'Image illisible', text: 'Choisis une photo au format JPEG, PNG ou WebP.', retry: 'Importer une autre photo', search: false }
      : { src: 'photo', file, title: 'Base des cartes indisponible', text: `${MESSAGES[err?.kind] || MESSAGES.network}. Réessaie quand tu es en ligne.`, retry: 'Réessayer', search: false, again: true });
    return;
  }
  if (!res) {
    showNone({ src: 'photo', file, text: 'Aucune carte trouvée sur la photo. Cadre-la de plus près, bien à plat.', retry: 'Importer une autre photo' });
    return;
  }
  if (res.decision === 'accept') await showResult(res, 'photo', file);
  else await showChooser(res, 'photo', file);
}

function shutter() {
  if (!camOn || !loop) { E.file.click(); return; }
  if (shown) { token++; shown = null; render(); }
  shutterAt = performance.now();
  focusNext = true;
  loop.start();
  loop.shutter();
  setHint('Analyse…', true);
}

// ---------------------------------------------------------------------------------------------------------
// Page cachée (appli en arrière-plan) : la caméra est rendue, puis relancée au retour

function onVisibility() {
  if (!visible) return;
  if (document.hidden) { if (camOn || vfState === 'starting') { stopCamera(); setVf('init'); } }
  else autoStart();
}

function wire() {
  const on = (sel, fn) => delegate(el, 'click', sel, (e, b) => { e.preventDefault(); fn(b, e); });
  on('.scn-shutter', () => shutter());
  on('.scn-photo, [data-import]', () => E.file.click());
  on('.scn-torch', () => toggleTorch());
  on('.scn-zoom', () => cycleZoom());
  on('[data-start]', () => startCamera());
  on('.scn-preset', () => presetSheet());
  on('.scn-sum-b', () => openSession());
  on('.scn-x', () => dismiss({ user: true }));
  on('[data-add]', b => addFinish(b.dataset.add));
  on('[data-pick]', b => pick(b.dataset.pick, b));
  on('[data-retry]', () => retry());
  delegate(el, 'click', '.scn-body [data-undo], .scn-body [data-clear]', e => onSessionClick(e));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && visible && shown && !e.defaultPrevented && !document.querySelector('dialog[open]')) { e.preventDefault(); dismiss({ user: true }); }
  });
  E.file.addEventListener('change', () => {
    const f = E.file.files?.[0];
    E.file.value = '';
    if (f) importPhoto(f);
  });
  session.on(onSession);
  prices.on(() => { if (shown?.mode === 'result') patchResult(); else if (!shown && desk.matches) render(); });
  desk.addEventListener?.('change', () => { if (!shown) render(); });
  document.addEventListener('visibilitychange', onVisibility);
  addEventListener('online', () => { if (!dbReady && visible) startPreload(); });
  addEventListener('pagehide', () => { if (camOn) stopCamera(); });
}

const view = {
  mount(section) {
    el = section;
    el.classList.add('full');
    setHTML(el, skeleton());
    const q = s => el.querySelector(s);
    E = {
      vf: q('.scn-vf'), video: q('.scn-video'), guide: q('.scn-guide'), quad: q('.scn-quad'), poly: q('.scn-quad polygon'),
      off: q('.scn-off'), pill: q('.scn-pill'), shutter: q('.scn-shutter'), torch: q('.scn-torch'), zoom: q('.scn-zoom'),
      file: q('.scn-file'), panel: q('.scn-panel'), sum: q('.scn-sum'), preset: q('.scn-preset'), x: q('.scn-x'), body: q('.scn-body'),
    };
    wire();
    renderHead();
    render();
  },
  async show(r) {
    visible = true;
    sig = r.signal;
    bar();
    renderHead();
    if (!shown) render();
    startPreload();
    autoStart();
  },
  resume(r) {
    visible = true;
    sig = r.signal;
    bar();
    renderHead();
    startPreload();
    autoStart();
  },
  hide() {
    visible = false;
    clearTimeout(hintT);
    holdUntil = 0;
    stopCamera();
    if (LIVE.has(vfState)) setVf('init');
  },
  onChange(events) {
    if (shown?.mode === 'result' && events.some(e => e.type === 'reload' || e.id === shown.id)) patchResult();
  },
  // tests (tools/shotsteps/V-SCAN.json, scripts du scratchpad)
  _test: {
    result: res => onResult(res),
    photo: blob => importPhoto(blob),
    cam: kind => { stopCamera(); setVf(kind); },
    camera: (opts = {}) => { camOpts = opts; stopCamera(); return startCamera(); },
    none: () => showNone({ src: 'live' }),
    state: () => ({ vf: vfState, camOn, open: scan.cameraOpen(), mode: shown?.mode || null, id: shown?.id || null, loop: loop?.state || null, dbReady, pill: E.pill.textContent }),
  },
};

export default view;
