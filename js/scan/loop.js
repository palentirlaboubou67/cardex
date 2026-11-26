// Boucle de scan en direct (FINAL-scanner §5.1, §5.4, §5.7) :
// détection ≈ 10 images/s sur une copie réduite de la zone du guide (worker) → quad affiché ;
// stabilité (coins immobiles à 1,5 % de la hauteur du guide sur 3 images) + netteté → identification sur l'image
// pleine résolution ; « forte » acceptée sur une image, « normale » confirmée par 2 des 3 dernières ;
// réimpressions et sosies départagés par la zone du code / numéro (sinon choix) ; incertaine pendant ≈ 1 s →
// « choose » (top 3) et lecture OCR en parallèle ; après une acceptation, pause jusqu'à ce que la carte sorte du cadre.
// Rien n'est livré après stop() / destroy() : chaque attente est suivie d'une vérification (époque).
import { call, frameOf } from './client.js';

export const LOOP = {
  tick: 100,            // ms entre deux détections
  tickPaused: 200,
  stableN: 3,           // images consécutives
  stableTol: 0.015,     // déplacement maximal des coins (fraction de la hauteur du guide)
  sharpRatio: 0.6,      // netteté ≥ 60 % du maximum vu sur la carte présente
  jump: 0.25,           // saut du quad (fraction de la hauteur du guide) : autre carte
  chooseAfter: 1000,    // ms d'incertitude stable avant de proposer un choix
  leaveN: 3,            // images sans carte : la carte est partie
  none: 1.45,           // au-delà : aucune carte plausible (en deçà, le choix montre le top 3)
  regionMargin: 0.01,   // écart minimal de corrélation entre les deux meilleures versions
  ocrMax: 2,            // lectures OCR au plus par carte présente
  smallH: 420,          // hauteur du guide dans la copie de détection
  margin: 0.3,          // marge autour du guide (fraction de sa hauteur)
};

const HINT = {
  frame: 'Cadre la carte dans le guide',
  far: 'Rapproche-toi',
  still: 'Ne bouge plus',
  blur: 'Image floue, ne bouge plus',
  busy: 'Analyse…',
  load: 'Chargement de la base des cartes…',
  holder: 'Sors la carte de son étui si tu peux',
  glare: 'Évite les reflets, incline un peu la carte',
  choose: 'Choisis la bonne carte',
  paused: 'Retire la carte pour en scanner une autre',
  none: 'Carte non reconnue',
  manual: 'Appuie sur le déclencheur',
  offline: 'Hors ligne : la base des cartes n’est pas encore enregistrée sur cet appareil',
  error: 'La base des cartes n’a pas pu être chargée, nouvel essai…',
};

const uniq = a => [...new Set(a)];
const ids = l => (l || []).map(x => x.id);

// Distance d'image connue d'une carte dans un résultat d'identification
function dOf(r, id) {
  for (const l of [r.top, r.group, r.rivals]) {
    const x = l?.find(v => v.id === id);
    if (x && x.d != null) return x.d;
  }
  return null;
}

// Résultat public (SPEC §5.7) + champs ajoutés : level, d2, stage, region, why, quad, token
// lead : cartes à placer en tête des candidats (versions départagées, groupe de réimpressions, jumelles).
export function resultOf(decision, bestId, r, { lead = [], alternatives = [], region = null, why = null, source = 'image', ms = 0, quad = null, extra = {} } = {}) {
  const top = ids((r.top || []).slice(0, 5));
  const candidates = uniq([bestId, ...lead, ...top]).slice(0, 5).map(id => ({ id, d: dOf(r, id) }));
  return {
    decision, best: { id: bestId, d: dOf(r, bestId) }, candidates,
    alternatives: uniq(alternatives).filter(id => id !== bestId), source, ms: Math.round(ms),
    level: r.level || 'none', d2: r.d2 ?? null, stage: r.stage || null, region, why, quad, token: r.token ?? null, ...extra,
  };
}

// Décision sur une identification (accept / choose), avec départage par la zone du numéro si la carte a des
// réimpressions (même illustration) ou des sosies : sans comparaison complète (hors ligne, réseau lent, image
// manquante), jamais d'acceptation → choix. Carte avec des jumelles sans image → choix.
// single = pas de vote (déclencheur manuel, photo importée). Renvoie null si annulé (signal).
// (Un contrôle de la zone du numéro de la seule carte reconnue a été mesuré : il ne sépare pas une réimpression
// absente de la base d'une vraie carte sous sleeve, voir tools/scan_bench.py --self ; il n'est pas appliqué.)
export async function settle(r, { single = false, t0 = performance.now(), quad = null, signal = null } = {}) {
  if (!r?.top?.length) return null;
  const top1 = r.top[0].id;
  const lvl = r.level;
  const ok = lvl === 'strong' || lvl === 'normal';
  const twins = r.twins || [];
  const fam = uniq([top1, ...ids(r.group), ...ids(r.rivals)]);
  const done = (decision, best, o = {}) => resultOf(decision, best, r, { ms: performance.now() - t0, quad, ...o });
  if (!ok) {
    if (r.d1 > LOOP.none) return null;
    return done('choose', top1, { lead: [...fam, ...twins], alternatives: [...fam, ...twins], why: 'incertaine' });
  }
  if (!single && lvl === 'normal') return null;    // la boucle gère le vote 2 sur 3
  if (fam.length > 1) {
    const reg = await call('region', { token: r.token, ids: fam }, [], { signal }).catch(() => null);
    if (signal?.aborted) return null;
    if (!reg?.complete) {
      // versions non comparables : le groupe d'abord (ordre de l'image), jamais d'acceptation sur l'image seule
      return done('choose', top1, { lead: [...fam, ...twins], alternatives: [...fam, ...twins], region: reg?.scores?.length ? reg.scores : null, why: 'zone-' + (reg?.reason || 'erreur') });
    }
    const region = reg.scores, best = region[0].id;
    const margin = region.length > 1 ? region[0].score - region[1].score : 1;
    const lead = [...ids(region), ...twins];
    if (twins.length) return done('choose', best, { lead, alternatives: lead, region, why: 'jumelles' });
    if (margin < LOOP.regionMargin) return done('choose', best, { lead, alternatives: lead, region, why: 'zone-marge' });
    return done('accept', best, { lead, alternatives: lead, region });
  }
  if (twins.length) return done('choose', top1, { lead: [top1, ...twins], alternatives: twins, why: 'jumelles' });
  return done('accept', top1);
}

// ---------------------------------------------------------------------------------------------------------

// ready : promesse de la base, ou fonction qui la (re)lance (index.js : preload) — un échec est alors réessayé.
// auto = false : détection et quad seulement, identification à l'appui sur le déclencheur (préférence scanAuto).
export function createLoop({ video, guide, onState = () => {}, onResult = () => {}, ready = null, ocr = true, auto = true } = {}) {
  let guideSrc = guide;
  let running = false, busy = false, dead = false, timer = 0, force = false, autoOn = auto;
  let epoch = 0, ctl = new AbortController();
  let phase = 'run';                  // run | paused
  let hist = [], sharpMax = 0, noCard = 0, leave = 0;
  let votes = [], unsureSince = 0, chose = false, lastKey = '', ocrBusy = false, ocrRuns = 0, accepted = null;
  let session = 0;                    // change quand la carte présente change (résultats OCR tardifs ignorés)

  // --- base des cartes : chargement, échec typé, nouvel essai (délai croissant, ou dès le retour du réseau)
  let db = ready ? 'idle' : 'ok', dbErr = null, dbTries = 0, dbAt = 0;
  function ensureDb() {
    if (db === 'ok' || db === 'loading') return;
    if (db === 'error' && performance.now() < dbAt) return;
    db = 'loading';
    const p = typeof ready === 'function' ? ready() : ready;
    Promise.resolve(p).then(() => { db = 'ok'; dbErr = null; dbTries = 0; }, e => {
      db = 'error'; dbErr = e; dbTries++;
      dbAt = performance.now() + Math.min(30000, 2000 * 2 ** Math.min(4, dbTries - 1));
      if (typeof ready !== 'function') dbAt = Infinity;      // promesse figée : pas de nouvel essai possible
      console.warn('scan : base des cartes indisponible :', e?.kind || e?.message || e);
    });
  }
  const onOnline = () => { if (db === 'error') { dbAt = 0; if (running) kick(); } };
  if (typeof addEventListener === 'function') addEventListener('online', onOnline);
  const dbHint = () => (dbErr?.kind === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false) ? HINT.offline : HINT.error);
  ensureDb();

  // --- géométrie : pixels CSS de la vidéo ↔ pixels du flux (object-fit, position centrée)
  function guideRect() {
    const g = typeof guideSrc === 'function' ? guideSrc() : guideSrc;
    if (!g) return null;
    if (typeof Element !== 'undefined' && g instanceof Element) {
      const a = g.getBoundingClientRect(), b = video.getBoundingClientRect();
      return { x: a.left - b.left, y: a.top - b.top, width: a.width, height: a.height };
    }
    return { x: g.x ?? g.left ?? 0, y: g.y ?? g.top ?? 0, width: g.width, height: g.height };
  }

  function geom() {
    const VW = video.videoWidth, VH = video.videoHeight, vw = video.clientWidth, vh = video.clientHeight;
    if (!VW || !VH || !vw || !vh || video.readyState < 2) return null;
    const fit = getComputedStyle(video).objectFit;
    let sx, sy;
    if (fit === 'cover') sx = sy = Math.max(vw / VW, vh / VH);
    else if (fit === 'fill') { sx = vw / VW; sy = vh / VH; }
    else if (fit === 'none') sx = sy = 1;
    else if (fit === 'scale-down') sx = sy = Math.min(1, vw / VW, vh / VH);
    else sx = sy = Math.min(vw / VW, vh / VH);
    const ox = (vw - VW * sx) / 2, oy = (vh - VH * sy) / 2;
    const g = guideRect();
    if (!g || !(g.width > 4) || !(g.height > 4)) return null;
    const gs = { x: (g.x - ox) / sx, y: (g.y - oy) / sy, w: g.width / sx, h: g.height / sy };
    const m = LOOP.margin * gs.h;
    const x0 = Math.max(0, Math.floor(gs.x - m)), y0 = Math.max(0, Math.floor(gs.y - m));
    const x1 = Math.min(VW, Math.ceil(gs.x + gs.w + m)), y1 = Math.min(VH, Math.ceil(gs.y + gs.h + m));
    if (x1 - x0 < 16 || y1 - y0 < 16) return null;
    return { VW, VH, g: gs, roi: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, toCss: ([x, y]) => [x * sx + ox, y * sy + oy] };
  }

  const css = (G, q) => (q ? q.map(G.toCss) : null);
  const alive = ep => !dead && ep === epoch;

  function emit(state, quad, hint, extra = {}) {
    try { onState({ state, quad, hint, ...extra }); } catch (e) { console.error(e); }
  }

  // une proposition d'image (« choose ») par carte ; les lectures OCR remplacent la précédente si elles diffèrent
  const keyOf = res => res.decision + '|' + res.candidates.map(c => c.id).join(',');
  function deliver(res) {
    lastKey = keyOf(res);
    try { onResult(res); } catch (e) { console.error(e); }
  }

  // --- appels au worker
  async function detect(G) {
    const R = G.roi, k = LOOP.smallH / G.g.h;
    const rw = Math.max(8, Math.round(R.w * k)), rh = Math.max(8, Math.round(R.h * k));
    const f = await frameOf(video, R.x, R.y, R.w, R.h, rw, rh);
    // échelle réelle (un navigateur qui ignore resizeWidth/Height rend la zone en pleine résolution : le worker réduit)
    const kx = f.w / R.w, ky = f.h / R.h;
    const g = { x: (G.g.x - R.x) * kx, y: (G.g.y - R.y) * ky, w: G.g.w * kx, h: G.g.h * ky };
    const r = await call('detect', { bmp: f.img, guide: g }, f.transfer);
    return { ...r, quad: r.quad ? r.quad.map(([x, y]) => [R.x + x / kx, R.y + y / ky]) : null };
  }

  async function identify(G) {
    const R = G.roi;
    const f = await frameOf(video, R.x, R.y, R.w, R.h);
    const t0 = performance.now();
    const r = await call('identify', { bmp: f.img, guide: { x: G.g.x - R.x, y: G.g.y - R.y, w: G.g.w, h: G.g.h } }, f.transfer);
    r.t0 = t0;
    r.squad = r.quad ? r.quad.map(([x, y]) => [x + R.x, y + R.y]) : null;     // pixels du flux
    return r;
  }

  // --- état de la carte présente
  function resetCard() {
    votes = []; unsureSince = 0; chose = false; lastKey = ''; hist = []; sharpMax = 0; ocrRuns = 0; session++;
  }

  function pause(r) {
    phase = 'paused';
    accepted = { quad: r.squad };
    leave = 0;
    resetCard();
  }

  const spread = qs => {
    let m = 0;
    for (let i = 1; i < qs.length; i++) for (let c = 0; c < 4; c++) m = Math.max(m, Math.hypot(qs[i][c][0] - qs[0][c][0], qs[i][c][1] - qs[0][c][1]));
    return m;
  };
  const sameCard = (a, b) => a.top?.[0] && b.top?.[0] && (a.top[0].id === b.top[0].id || (a.group || []).some(x => x.id === b.top[0].id));

  function hintOf(r) {
    if (!r || !r.top) return HINT.frame;
    if (r.stage === 'loin') return HINT.far;
    if (r.stage === 'porte-carte') return HINT.holder;
    return r.d1 > LOOP.none ? HINT.none : HINT.glare;
  }

  // acceptation : tout ce qui est encore en cours (autre identification, OCR) devient périmé
  function accept(res, r, G) {
    cancel();
    pause(r);
    emit('paused', css(G, r.squad), HINT.paused);
    deliver(res);
  }

  // Lecture OCR en parallèle (non attendue par la boucle) : son résultat est livré s'il diffère du dernier livré
  async function runOcr(r, G, candidates, ep) {
    if (!ocr || ocrBusy || !r.token || ocrRuns >= LOOP.ocrMax) return;
    ocrBusy = true;
    ocrRuns++;
    const ses = session;
    try {
      const mod = await import('./ocr.js');
      if (!alive(ep) || ses !== session) return;
      const dists = {};
      for (const l of [r.rivals, r.group, r.top]) for (const x of l || []) if (x.d != null) dists[x.id] = x.d;
      const o = await mod.ocrFrame(r.token, { candidates, dists });
      if (!o || !alive(ep) || ses !== session || phase === 'paused') return;
      // cartes de la lecture d'abord, puis celles que l'image proposait déjà (jumelles, versions) : rien n'est perdu
      const lead = o.decision === 'accept' ? o.ids : uniq([...o.ids, ...candidates]);
      const res = resultOf(o.decision, o.ids[0], r, {
        lead, alternatives: lead.slice(1), source: 'ocr', ms: performance.now() - r.t0, quad: css(G, r.squad),
        why: o.why, extra: { text: o.texts },
      });
      // les candidats viennent de la lecture : distances d'image inconnues pour les cartes hors top 5
      res.candidates = lead.slice(0, 5).map(id => ({ id, d: dOf(r, id) }));
      if (o.decision === 'accept') accept(res, r, G);
      else if (keyOf(res) !== lastKey) { chose = true; deliver(res); }
    } catch (e) {
      console.warn('OCR indisponible :', e?.message || e);
    } finally {
      ocrBusy = false;
    }
  }

  async function handle(r, G, single, ep) {
    const quad = css(G, r.squad);
    if (r.top) { votes.push(r); if (votes.length > 3) votes.shift(); }
    const lvl = r.level;
    const agree = r.top ? votes.filter(v => sameCard(v, r)).length : 0;
    if (r.top && (lvl === 'strong' || (lvl === 'normal' && (single || agree >= 2)))) {
      const res = await settle(r, { single: true, t0: r.t0, quad, signal: ctl.signal });
      if (!alive(ep) || !res) return;
      if (res.decision === 'accept') { accept(res, r, G); return; }
      // réimpression indécise, sosie ou jumelle : choix tout de suite, OCR en parallèle
      if (!chose || single) { chose = true; deliver(res); }
      emit('uncertain', quad, HINT.choose);
      runOcr(r, G, uniq([...res.candidates.map(x => x.id), ...res.alternatives]), ep);
      return;
    }
    // « normale » en attente de confirmation par l'image suivante : pas encore incertaine
    if (r.top && lvl === 'normal' && !single && votes.length < 3) { emit('identifying', quad, HINT.busy); return; }
    // incertaine
    const now = performance.now();
    unsureSince ||= now;
    if (single || now - unsureSince >= LOOP.chooseAfter) {
      const plausible = r.top && r.d1 <= LOOP.none;
      if (plausible && (!chose || single)) {
        const res = await settle({ ...r, level: 'weak' }, { single: true, t0: r.t0, quad });
        if (!alive(ep)) return;
        if (res) { chose = true; deliver(res); }
      }
      runOcr(r, G, plausible ? uniq([...ids(r.top), ...ids(r.group), ...ids(r.rivals), ...(r.twins || [])]) : [], ep);
    }
    emit('uncertain', quad, hintOf(r));
  }

  async function step(G, ep) {
    if (force) {
      force = false;
      if (phase === 'paused') { phase = 'run'; resetCard(); }
      emit('identifying', null, HINT.busy);
      ensureDb();
      if (db !== 'ok') {
        try { await (typeof ready === 'function' ? ready() : ready); db = 'ok'; } catch (e) { db = 'error'; dbErr = e; }
        if (!alive(ep)) return;
        if (db !== 'ok') { emit('error', null, dbHint(), { error: dbErr?.kind || 'unknown' }); return; }
      }
      const r = await identify(G);
      if (!alive(ep)) return;
      await handle(r, G, true, ep);
      if (!alive(ep)) return;
      if (!r.top || r.d1 > LOOP.none) emit('uncertain', css(G, r.squad), HINT.none);
      return;
    }
    const d = await detect(G);
    if (!alive(ep)) return;
    const present = !!d.quad && d.found >= 3;
    const quad = css(G, d.quad);
    if (phase === 'paused') {
      const moved = present && accepted?.quad ? spread([accepted.quad, d.quad]) > LOOP.jump * G.g.h : false;
      leave = !present || moved ? leave + 1 : 0;
      if (leave >= LOOP.leaveN) { phase = 'run'; resetCard(); emit('searching', present ? quad : null, HINT.frame); }
      else emit('paused', present ? quad : null, HINT.paused);
      return;
    }
    ensureDb();
    if (db === 'error') { emit('error', present ? quad : null, dbHint(), { error: dbErr?.kind || 'unknown', found: d.found }); return; }
    if (!present) {
      noCard++;
      hist = [];
      if (noCard >= LOOP.leaveN) resetCard();
      emit('searching', d.found >= 2 ? quad : null, d.far ? HINT.far : HINT.frame, { found: d.found });
      return;
    }
    noCard = 0;
    // saut du quad : une autre carte (ou replacée) → nouvel état de carte
    if (hist.length && spread([hist[hist.length - 1], d.quad]) > LOOP.jump * G.g.h) resetCard();
    hist.push(d.quad);
    if (hist.length > LOOP.stableN) hist.shift();
    const sh = d.nsharp ?? d.sharp ?? 0;
    sharpMax = Math.max(sharpMax, sh);               // maximum sur la carte présente seulement
    const stable = hist.length >= LOOP.stableN && spread(hist) < LOOP.stableTol * G.g.h;
    const sharp = sh >= LOOP.sharpRatio * sharpMax;
    const state = unsureSince ? 'uncertain' : 'detected';
    if (!stable || !sharp) { emit(state, quad, sharp ? HINT.still : HINT.blur, { found: d.found }); return; }
    if (db !== 'ok') { emit(state, quad, HINT.load, { found: d.found }); return; }
    if (!autoOn) { emit(state, quad, HINT.manual, { found: d.found }); return; }
    emit('identifying', quad, HINT.busy, { found: d.found });
    const r = await identify(G);
    if (!alive(ep)) return;
    await handle(r, G, false, ep);
  }

  async function tick() {
    timer = 0;
    if (dead || (!running && !force)) return;
    const t0 = performance.now();
    if (!busy && !(typeof document !== 'undefined' && document.hidden)) {
      const G = geom();
      if (G) {
        busy = true;
        try { await step(G, epoch); } catch (e) { console.warn('scan :', e?.message || e); } finally { busy = false; }
      } else if (!running) force = false;           // déclencheur sans image : rien à faire
    }
    if (dead) return;
    if (running) timer = setTimeout(tick, Math.max(0, (phase === 'paused' ? LOOP.tickPaused : LOOP.tick) - (performance.now() - t0)));
    else if (force) timer = setTimeout(tick, 0);
  }

  function kick() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!busy) tick();
  }

  // annule tout ce qui est en cours (résultats ignorés, téléchargements de la zone du numéro abandonnés)
  function cancel() {
    epoch++;
    ctl.abort();
    ctl = new AbortController();
  }

  return {
    start() { if (dead || running) return; running = true; emit('searching', null, HINT.frame); kick(); },
    stop() { running = false; force = false; if (timer) clearTimeout(timer); timer = 0; cancel(); },
    // déclencheur : identifie l'image courante tout de suite (même si elle bouge, même en pause), une seule fois ;
    // ne relance pas la boucle si elle est arrêtée
    shutter() { if (dead) return; force = true; chose = false; kick(); },
    // reprend le scan après une acceptation sans attendre que la carte sorte du cadre
    resume() { if (dead) return; cancel(); phase = 'run'; resetCard(); if (running) kick(); },
    // carte choisie dans la liste (« choose ») : pause comme après une acceptation, jusqu'à ce qu'elle sorte du cadre
    hold() {
      if (dead) return;
      const q = hist[hist.length - 1] || null;
      cancel();
      pause({ squad: q });
      emit('paused', null, HINT.paused);
    },
    setGuide(g) { guideSrc = g; hist = []; },
    setAuto(on) { autoOn = !!on; },
    get state() { return { running, phase, busy, auto: autoOn, db }; },
    destroy() {
      if (dead) return;
      dead = true; running = false; force = false;
      if (timer) clearTimeout(timer);
      timer = 0;
      cancel();
      if (typeof removeEventListener === 'function') removeEventListener('online', onOnline);
      call('forget', {}).catch(() => {});
    },
  };
}
