// Boucle de scan en direct (FINAL-scanner §5.1, §5.4, §5.7) :
// détection ≈ 10 images/s sur une copie réduite de la zone du guide (worker) → quad affiché ;
// stabilité (coins immobiles à 1,5 % de la hauteur du guide sur 3 images) + netteté → identification sur l'image
// pleine résolution ; « forte » acceptée sur une image, « normale » confirmée par 2 des 3 dernières ;
// réimpressions et sosies départagés par la zone du code / numéro ; incertaine pendant ≈ 1 s → « choose » (top 3)
// et lecture OCR en parallèle ; après une acceptation, pause jusqu'à ce que la carte sorte du cadre.
import { call, frameOf } from './client.js';

export const LOOP = {
  tick: 100,            // ms entre deux détections
  tickPaused: 200,
  stableN: 3,           // images consécutives
  stableTol: 0.015,     // déplacement maximal des coins (fraction de la hauteur du guide)
  sharpRatio: 0.6,      // netteté ≥ 60 % du maximum récent
  chooseAfter: 1000,    // ms d'incertitude stable avant de proposer un choix
  leaveN: 3,            // images sans carte : la carte est partie
  none: 1.45,           // au-delà : aucune carte plausible (en deçà, le choix montre le top 3)
  regionMargin: 0.01,   // écart minimal de corrélation entre les deux meilleures versions
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
  paused: 'Retire la carte pour en scanner une autre',
  none: 'Carte non reconnue',
};

const uniq = a => [...new Set(a)];

// Distance d'image connue d'une carte dans un résultat d'identification
function dOf(r, id) {
  for (const l of [r.top, r.group, r.rivals]) {
    const x = l?.find(v => v.id === id);
    if (x && x.d != null) return x.d;
  }
  return null;
}

// Résultat public (SPEC §5.7) + champs ajoutés : level, region, stage, quad, d2
export function resultOf(decision, bestId, r, { alternatives = [], region = null, source = 'image', ms = 0, quad = null, extra = {} } = {}) {
  const top = (r.top || []).slice(0, 5).map(x => ({ id: x.id, d: x.d }));
  let candidates = top;
  if (region && region.length) {
    // version désignée par la zone en premier, puis les autres versions, puis le reste du top 5
    const lead = region.map(x => ({ id: x.id, d: dOf(r, x.id) }));
    candidates = uniq([...lead.map(x => x.id), ...top.map(x => x.id)]).slice(0, 5).map(id => ({ id, d: dOf(r, id) }));
  }
  return {
    decision, best: { id: bestId, d: dOf(r, bestId) }, candidates,
    alternatives: alternatives.filter(id => id !== bestId), source, ms: Math.round(ms),
    level: r.level || 'none', d2: r.d2 ?? null, stage: r.stage || null, region, quad, ...extra,
  };
}

// Décision sur une identification (accept / choose), avec départage par la zone du numéro si la carte a des
// réimpressions (même illustration) ou des sosies. single = pas de vote (déclencheur manuel, photo importée).
export async function settle(r, { single = false, t0 = performance.now(), quad = null } = {}) {
  if (!r?.top?.length) return null;
  const top1 = r.top[0].id;
  const lvl = r.level;
  const ok = lvl === 'strong' || lvl === 'normal';
  const ids = uniq([top1, ...(r.group || []).map(x => x.id), ...(r.rivals || []).map(x => x.id)]);
  if (!ok) {
    if (r.d1 > LOOP.none) return null;
    return resultOf('choose', top1, r, { alternatives: ids.slice(1), ms: performance.now() - t0, quad });
  }
  if (!single && lvl === 'normal') return null;    // la boucle gère le vote 2 sur 3
  let best = top1, alternatives = ids.slice(1), region = null, decision = 'accept';
  if (ids.length > 1) {
    region = await call('region', { token: r.token, ids }).catch(() => null);
    if (region && region.length) {
      best = region[0].id;
      alternatives = uniq([...region.slice(1).map(x => x.id), ...ids]).filter(id => id !== best);
      const margin = region.length > 1 ? region[0].score - region[1].score : 1;
      if (margin < LOOP.regionMargin) decision = 'choose';
    } else if ((r.rivals || []).length) {
      decision = 'choose';     // sosies sans zone comparable : jamais acceptés sur l'image seule
    }
  }
  return resultOf(decision, best, r, { alternatives, region, ms: performance.now() - t0, quad });
}

// ---------------------------------------------------------------------------------------------------------

export function createLoop({ video, guide, onState = () => {}, onResult = () => {}, ready = null, ocr = true } = {}) {
  let guideSrc = guide;
  let running = false, busy = false, dead = false, timer = 0;
  let phase = 'run';                  // run | paused
  let hist = [], sharpMax = 0, noCard = 0, leave = 0;
  let votes = [], unsureSince = 0, chose = false, ocrBusy = false, accepted = null, force = false;
  let session = 0;                    // change quand la carte présente change (résultats OCR tardifs ignorés)
  let dbReady = !ready;
  if (ready) ready.then(() => { dbReady = true; }, () => {});

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

  function emit(state, quad, hint, extra = {}) {
    try { onState({ state, quad, hint, ...extra }); } catch (e) { console.error(e); }
  }

  function deliver(res) {
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
    votes = []; unsureSince = 0; chose = false; hist = []; session++;
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

  async function runOcr(r, G, candidates) {
    if (!ocr || ocrBusy || !r.token) return;
    ocrBusy = true;
    const ses = session;
    try {
      const mod = await import('./ocr.js');
      const o = await mod.ocrFrame(r.token, { candidates });
      if (!o || dead || !running || ses !== session) return;
      if (phase === 'paused') return;
      const res = resultOf(o.decision, o.ids[0], r, {
        alternatives: o.ids.slice(1), source: 'ocr', ms: performance.now() - r.t0, quad: css(G, r.squad),
        extra: { text: o.texts },
      });
      // les candidats viennent de la lecture : distances d'image inconnues pour les cartes hors top 5
      res.candidates = o.ids.slice(0, 5).map(id => ({ id, d: dOf(r, id) }));
      if (o.decision === 'accept') { pause(r); emit('paused', css(G, r.squad), HINT.paused); deliver(res); }
      else if (!chose) { chose = true; deliver(res); }
    } catch (e) {
      console.warn('OCR indisponible :', e?.message || e);
    } finally {
      ocrBusy = false;
    }
  }

  async function handle(r, G, single) {
    const quad = css(G, r.squad);
    if (r.top) { votes.push(r); if (votes.length > 3) votes.shift(); }
    const lvl = r.level;
    const agree = r.top ? votes.filter(v => sameCard(v, r)).length : 0;
    if (r.top && (lvl === 'strong' || (lvl === 'normal' && (single || agree >= 2)))) {
      const res = await settle(r, { single: true, t0: r.t0, quad });
      if (res.decision === 'accept') {
        pause(r);
        emit('paused', quad, HINT.paused);
        deliver(res);
        return;
      }
      // réimpression indécise ou sosie : choix immédiat, OCR en parallèle
      if (!chose) { chose = true; deliver(res); }
      emit('uncertain', quad, HINT.glare);
      runOcr(r, G, res.candidates.map(x => x.id).concat(res.alternatives));
      return;
    }
    // « normale » en attente de confirmation par l'image suivante : pas encore incertaine
    if (r.top && lvl === 'normal' && !single && votes.length < 3) { emit('identifying', quad, HINT.busy); return; }
    // incertaine
    const now = performance.now();
    unsureSince ||= now;
    if (single || now - unsureSince >= LOOP.chooseAfter) {
      const plausible = r.top && r.d1 <= LOOP.none;
      if (plausible && !chose) {
        chose = true;
        deliver(await settle({ ...r, level: 'weak' }, { single: true, t0: r.t0, quad }));
      }
      runOcr(r, G, plausible ? uniq([...r.top.map(x => x.id), ...(r.group || []).map(x => x.id), ...(r.rivals || []).map(x => x.id)]) : []);
    }
    emit('uncertain', quad, hintOf(r));
  }

  async function step(G) {
    if (force) {
      force = false;
      if (phase === 'paused') { phase = 'run'; resetCard(); }
      chose = false;                  // chaque appui donne un résultat (acceptation ou choix)
      emit('identifying', null, HINT.busy);
      if (!dbReady) await ready;
      const r = await identify(G);
      await handle(r, G, true);
      if (!r.top || r.d1 > LOOP.none) emit('uncertain', css(G, r.squad), HINT.none);
      return;
    }
    const d = await detect(G);
    const present = !!d.quad && d.found >= 3;
    const quad = css(G, d.quad);
    if (phase === 'paused') {
      const moved = present && accepted?.quad ? spread([accepted.quad, d.quad]) > 0.25 * G.g.h : false;
      leave = !present || moved ? leave + 1 : 0;
      if (leave >= LOOP.leaveN) { phase = 'run'; resetCard(); emit('searching', present ? quad : null, HINT.frame); }
      else emit('paused', present ? quad : null, HINT.paused);
      return;
    }
    if (!present) {
      noCard++;
      hist = [];
      if (noCard >= LOOP.leaveN) resetCard();
      emit('searching', d.found >= 2 ? quad : null, d.far ? HINT.far : HINT.frame, { found: d.found });
      return;
    }
    noCard = 0;
    hist.push(d.quad);
    if (hist.length > LOOP.stableN) hist.shift();
    sharpMax = Math.max(sharpMax * 0.995, d.sharp || 0);
    const stable = hist.length >= LOOP.stableN && spread(hist) < LOOP.stableTol * G.g.h;
    const sharp = (d.sharp || 0) >= LOOP.sharpRatio * sharpMax;
    const state = unsureSince ? 'uncertain' : 'detected';
    if (!stable || !sharp) { emit(state, quad, sharp ? HINT.still : HINT.blur, { found: d.found }); return; }
    if (!dbReady) { emit(state, quad, HINT.load, { found: d.found }); return; }
    emit('identifying', quad, HINT.busy, { found: d.found });
    const r = await identify(G);
    if (!running || dead) return;
    await handle(r, G, false);
  }

  async function tick() {
    timer = 0;
    if (!running || dead) return;
    const t0 = performance.now();
    if (!busy && !(typeof document !== 'undefined' && document.hidden)) {
      const G = geom();
      if (G) {
        busy = true;
        try { await step(G); } catch (e) { console.warn('scan :', e?.message || e); } finally { busy = false; }
      }
    }
    if (running && !dead) timer = setTimeout(tick, Math.max(0, (phase === 'paused' ? LOOP.tickPaused : LOOP.tick) - (performance.now() - t0)));
  }

  function kick() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!busy) tick();
  }

  return {
    start() { if (dead || running) return; running = true; emit('searching', null, HINT.frame); kick(); },
    stop() { running = false; if (timer) clearTimeout(timer); timer = 0; },
    // déclencheur manuel : identifie l'image courante tout de suite (même si elle bouge, même en pause)
    shutter() { if (dead) return; force = true; if (!running) { running = true; } kick(); },
    // reprend le scan après une acceptation sans attendre que la carte sorte du cadre
    resume() { if (dead) return; phase = 'run'; resetCard(); if (running) kick(); },
    setGuide(g) { guideSrc = g; hist = []; },
    get state() { return { running, phase, busy }; },
    destroy() {
      dead = true; running = false;
      if (timer) clearTimeout(timer);
      call('forget', {}).catch(() => {});
    },
  };
}
