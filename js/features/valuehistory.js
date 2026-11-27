// Historique de la valeur de la collection (clé cardex.history.v1) : un point par jour { d, v, n }, le dernier état
// de la journée, gardé sur deux ans. Enregistré seulement quand les cotes de toutes les séries possédées sont
// chargées : une valeur partielle (hors ligne, fichiers en route) ferait un faux creux dans la courbe.
// init() : appelé par main.js quand le navigateur est libre. points() → [{ d: 'YYYY-MM-DD', v, n }]
import * as col from '../state/collection.js';
import * as prices from '../data/prices.js';
import { whenIdle } from '../core/idle.js';

const KEY = 'cardex.history.v1';
const MAX = 730;                       // deux ans de points quotidiens (≈ 30 Ko)
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const subs = new Set();
let cache = null, started = false, timer = 0;

const pad = n => String(n).padStart(2, '0');
export const today = (t = new Date()) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;

function read() {
  if (cache) return cache;
  let h = [];
  try { h = JSON.parse(localStorage.getItem(KEY)); } catch { h = []; }
  cache = (Array.isArray(h) ? h : [])
    .filter(p => p && typeof p.d === 'string' && DAY_RE.test(p.d) && Number.isFinite(p.v) && p.v >= 0)
    .map(p => ({ d: p.d, v: Math.round(p.v * 100) / 100, n: Number.isInteger(p.n) ? p.n : null }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return cache;
}

const notify = () => subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

function write(h) {
  cache = h;
  try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* stockage plein : gardé en mémoire pour la session */ }
  notify();
}

// copie des points, du plus ancien au plus récent
export const points = () => read().map(p => ({ ...p }));

// fn() quand un point est ajouté ou corrigé (en-tête de la collection : courbe et variation)
export const on = fn => (subs.add(fn), () => subs.delete(fn));

// Point du jour : valeur actuelle si toutes les cotes sont là. -> true si l'historique a changé
export function record() {
  const st = col.stats();
  if (st.pending) return false;
  const h = read().slice();
  if (!st.total && !h.length) return false;                  // collection vide et pas d'historique : rien à noter
  const pt = { d: today(), v: st.value, n: st.total };
  const last = h[h.length - 1];
  if (last && last.d > pt.d) return false;                   // horloge de l'appareil revenue en arrière
  if (last && last.d === pt.d) {
    if (last.v === pt.v && last.n === pt.n) return false;
    h[h.length - 1] = pt;
  } else h.push(pt);
  write(h.slice(-MAX));
  return true;
}

// Variation sur `days` jours : maintenant (valeur en direct) contre le plus ancien point de la période.
// -> { pct, eur, from: 'YYYY-MM-DD', full: la période est couverte en entier } | null (pas encore deux jours notés)
export function change(now, days = 30) {
  const h = read();
  if (h.length < 2 || !Number.isFinite(now)) return null;
  const t = new Date();
  t.setDate(t.getDate() - days);
  const limit = today(t);
  const ref = h.find(p => p.d >= limit);
  if (!ref || ref.d >= today() || !ref.v) return null;
  return { pct: ((now - ref.v) / ref.v) * 100, eur: now - ref.v, from: ref.d, full: h[0].d <= limit };
}

function schedule(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => whenIdle(record, { timeout: 4000 }), ms);
}

export function init() {
  if (started) return;
  started = true;
  // carte ajoutée ou retirée, import, autre onglet : les cotes des nouvelles séries, puis le point du jour
  col.on(evs => {
    if (!evs.some(e => e.type === 'qty' || e.type === 'reload')) return;
    col.ensurePrices();
    schedule();
  });
  prices.on(() => schedule(600));
  addEventListener('storage', e => { if (e.key === KEY || e.key === null) { cache = null; notify(); } });
  // appli laissée ouverte d'un jour à l'autre : nouveau point au retour
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(800); });
  col.ensurePrices().then(() => schedule(0));
}
