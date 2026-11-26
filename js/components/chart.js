// Courbes : lineChart (valeur de la collection, cote d'un produit) avec lecture au doigt, à la souris et au clavier,
// plages (7 j … Tout) et tableau des valeurs pour les lecteurs d'écran ; sparkline (tendance, sans axes).
// Trait 2 px dans l'accent, aire à 10 %, filets pleins discrets, point de fin 8 px avec anneau de la couleur du fond.
import { html, raw } from '../core/dom.js';
import { eur, pct, eurDelta, dir, dateFr, dateDay, toDate } from '../core/format.js';
import { icon } from '../core/icons.js';

const RANGES = {
  '7j': [7, '7 j'], '30j': [30, '30 j'], '90j': [90, '90 j'], '3m': [92, '3 mois'], '6m': [183, '6 mois'],
  '1a': [366, '1 an'], tout: [Infinity, 'Tout'],
};
const DAY = 86400000;
const H = 120, PAD_Y = 10;

const clean = points => (points || [])
  .map(p => ({ d: p.d, v: Number(p.v), t: toDate(p.d).getTime() }))
  .filter(p => Number.isFinite(p.v) && Number.isFinite(p.t))
  .sort((a, b) => a.t - b.t);

// lineChart(el, [{ d: 'YYYY-MM-DD', v }], { ranges, format, range, onRange, label }) → { update, setRange, destroy }
export function lineChart(el, points, { ranges = ['30j', '90j', 'tout'], format = eur, range, onRange, label = 'Évolution' } = {}) {
  let all = clean(points), cur = ranges.includes(range) ? range : (ranges.includes('tout') ? 'tout' : ranges[0]);
  let vis = [], idx = -1, geo = null, ro = null;
  el.classList.add('chart');
  el.tabIndex = 0;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', `${label} : courbe, flèches gauche et droite pour lire les valeurs`);

  const slice = () => {
    const [days] = RANGES[cur] || RANGES.tout;
    if (!all.length || days === Infinity) return all.slice();
    const from = all[all.length - 1].t - days * DAY;
    const s = all.filter(p => p.t >= from);
    return s.length ? s : all.slice(-1);
  };

  function render() {
    vis = slice();
    idx = -1;
    const segs = ranges.length > 1 ? html`<div class="seg" role="group" aria-label="Période">${ranges.map(k => html`<button type="button" data-r="${k}" aria-pressed="${k === cur ? 'true' : 'false'}">${(RANGES[k] || [0, k])[1]}</button>`)}</div>` : '';
    if (!vis.length) {
      el.innerHTML = String(html`<div class="chart-empty">Pas encore de données</div>${segs}`);
      return;
    }
    const w = Math.max(120, Math.round(el.clientWidth || 320));
    const lo = Math.min(...vis.map(p => p.v)), hi = Math.max(...vis.map(p => p.v));
    const t0 = vis[0].t, t1 = vis[vis.length - 1].t;
    const x = i => (vis.length === 1 ? w / 2 : 4 + ((vis[i].t - t0) / (t1 - t0 || 1)) * (w - 8));
    const y = v => (hi === lo ? H / 2 : H - PAD_Y - ((v - lo) / (hi - lo)) * (H - 2 * PAD_Y));
    geo = { x, y, w };
    const line = vis.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = vis.length > 1 ? `${line}L${x(vis.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z` : '';
    const last = vis[vis.length - 1];
    const year = d => toDate(d).getFullYear();
    const first = vis[0];
    const startLbl = year(first.d) !== year(last.d) ? dateFr(first.d) : dateDay(first.d);
    el.innerHTML = String(html`<div class="chart-read" aria-hidden="true"><b></b><span></span></div>
<svg class="plot" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" aria-hidden="true" focusable="false">
<line class="grid-l" x1="0" x2="${w}" y1="${y(hi).toFixed(1)}" y2="${y(hi).toFixed(1)}"/>${hi !== lo ? raw(`<line class="grid-l" x1="0" x2="${w}" y1="${y(lo).toFixed(1)}" y2="${y(lo).toFixed(1)}"/>`) : ''}
${area ? raw(`<path class="area" d="${area}"/>`) : ''}<path class="line" d="${line}"/>
<line class="cross" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/>
<circle class="pt" r="4" cx="${x(vis.length - 1).toFixed(1)}" cy="${y(last.v).toFixed(1)}"/></svg>
<div class="chart-axis" aria-hidden="true"><span>${startLbl}</span><span>${hi !== lo ? `${format(lo)} – ${format(hi)}` : format(hi)}</span><span>${dateDay(last.d)}</span></div>
${segs}
<table class="sr"><caption>${label}</caption><thead><tr><th scope="col">Date</th><th scope="col">Valeur</th></tr></thead><tbody>${
      vis.map(p => html`<tr><td>${dateFr(p.d)}</td><td>${format(p.v)}</td></tr>`)}</tbody></table>`);
    read(vis.length - 1, false);
  }

  // lecture d'un point : valeur d'abord, date ensuite ; la croix suit le point le plus proche
  function read(i, cross = true) {
    if (!vis.length || !geo) return;
    idx = Math.max(0, Math.min(vis.length - 1, i));
    const p = vis[idx];
    const out = el.querySelector('.chart-read');
    out.querySelector('b').textContent = format(p.v);
    out.querySelector('span').textContent = dateFr(p.d);
    const c = el.querySelector('.cross'), dot = el.querySelector('.pt');
    const cx = geo.x(idx).toFixed(1);
    c.setAttribute('x1', cx); c.setAttribute('x2', cx);
    c.setAttribute('visibility', cross ? 'visible' : 'hidden');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', geo.y(p.v).toFixed(1));
  }
  const nearest = clientX => {
    const svg = el.querySelector('.plot');
    if (!svg || !geo) return -1;
    const r = svg.getBoundingClientRect(), px = clientX - r.left;
    let best = 0;
    for (let i = 1; i < vis.length; i++) if (Math.abs(geo.x(i) - px) < Math.abs(geo.x(best) - px)) best = i;
    return best;
  };

  const onMove = e => { if (e.target.closest?.('.plot')) read(nearest(e.clientX)); };
  const onLeave = () => read(vis.length - 1, false);
  const onKey = e => {
    if (!vis.length) return;
    const k = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (k) { e.preventDefault(); read((idx < 0 ? vis.length - 1 : idx) + k); }
    else if (e.key === 'Home') { e.preventDefault(); read(0); }
    else if (e.key === 'End') { e.preventDefault(); read(vis.length - 1); }
  };
  const onClick = e => {
    const b = e.target.closest('[data-r]');
    if (!b || b.dataset.r === cur) return;
    cur = b.dataset.r;
    const refocus = el.contains(document.activeElement);
    render();
    if (refocus) el.querySelector(`[data-r="${cur}"]`)?.focus({ preventScroll: true });   // le rendu a remplacé le bouton
    onRange?.(cur);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerdown', onMove);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onLeave);
  el.addEventListener('click', onClick);
  let lastW = 0;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w && Math.abs(w - lastW) > 1) { lastW = w; render(); }
    });
    ro.observe(el);
  }
  render();
  lastW = Math.round(el.clientWidth);

  return {
    update(p) { all = clean(p); render(); },
    setRange(r) { if (ranges.includes(r) && r !== cur) { cur = r; render(); } },
    get range() { return cur; },
    destroy() {
      ro?.disconnect();
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onMove);
      el.removeEventListener('pointerleave', onLeave); el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onLeave); el.removeEventListener('click', onClick);
      el.innerHTML = '';
    },
  };
}

// petite courbe sans axes (en-tête de synthèse) : trait dans l'accent
export function sparkline(values, { w = 96, h = 32 } = {}) {
  const v = (values || []).map(Number).filter(Number.isFinite);
  if (v.length < 2) return raw('');
  const lo = Math.min(...v), hi = Math.max(...v), p = 2;
  const x = i => p + (i / (v.length - 1)) * (w - 2 * p);
  const y = n => (hi === lo ? h / 2 : h - p - ((n - lo) / (hi - lo)) * (h - 2 * p));
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join('');
  return raw(`<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`);
}

// variation colorée avec un triangle SVG (jamais ▲▼) : deltaHTML(4.1, { per: '30 j' }) ; kind 'eur' pour un écart en euros
export function deltaHTML(v, { kind = 'pct', per = '' } = {}) {
  if (v == null || !Number.isFinite(Number(v))) return html`<span class="delta">—</span>`;
  const n = Number(v);
  const d = kind === 'eur' ? (n > 0.004 ? 'up' : n < -0.004 ? 'down' : 'flat') : dir(n);
  const txt = kind === 'eur' ? eurDelta(n) : pct(n);
  return html`<span class="delta ${d}">${d === 'flat' ? '' : icon(d, { size: 9 })}${txt}${per ? html`<span class="per"> · ${per}</span>` : ''}</span>`;
}

