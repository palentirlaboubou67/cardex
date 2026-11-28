// Lecture du code de série et du numéro (repli, chargé à la demande) : tesseract.js 7.0.0 auto-hébergé
// (vendor/tesseract, même origine, marche hors ligne une fois en cache), PSM 7 (une ligne) + liste de caractères.
// Les lignes sont préparées par ocrprep.js (dans le worker) ; ici : lecture, grammaire, candidats, vérification.

import { call, getCards } from './client.js';

const VENDOR = new URL('../../vendor/tesseract/', import.meta.url).href;
const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/';

let tess = null;          // promesse du worker tesseract
let idx = null;           // index des cartes pour la grammaire (setCards)

// ---------------------------------------------------------------------------------------------------------
// Moteur

export function load(onProgress) {
  tess ??= (async () => {
    const mod = await import(VENDOR + 'tesseract.esm.min.js');
    const T = mod.default || mod;
    const w = await T.createWorker('fra', 1, {
      workerPath: VENDOR + 'worker.min.js',
      corePath: VENDOR + 'core',
      langPath: VENDOR + 'lang',
      workerBlobURL: false,         // worker chargé depuis notre origine (contrôlé par le service worker)
      cacheMethod: 'none',          // le service worker garde déjà vendor/** (pas de copie IndexedDB)
      gzip: true,
      logger: m => onProgress?.(m),
      errorHandler: () => {},
    });
    // debug_file : les traces de tesseract (« Bottom=0, top=78… », « Total count=0 ») partaient en console.error
    // à chaque ligne difficile (SPEC §12 « aucune erreur console ») ; elles vont dans /dev/null (FS du cœur wasm)
    await w.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: WHITELIST, preserve_interword_spaces: '1', debug_file: '/dev/null' });
    return w;
  })();
  tess.catch(() => { tess = null; });
  return tess;
}

export const loaded = () => !!tess;

// Variante du cœur que le worker de tesseract choisira sur cet appareil (mêmes tests que wasm-feature-detect)
const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const RELAXED = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);
export function coreFile() {
  try { if (WebAssembly.validate(RELAXED)) return 'tesseract-core-relaxedsimd-lstm.wasm.js'; } catch { /* non pris en charge */ }
  try { if (WebAssembly.validate(SIMD)) return 'tesseract-core-simd-lstm.wasm.js'; } catch { /* non pris en charge */ }
  return 'tesseract-core-lstm.wasm.js';
}

// Télécharge (sans démarrer tesseract) les 4 fichiers dont cet appareil aura besoin : le service worker les garde,
// la lecture marchera ensuite hors ligne. Retourne le nombre d'octets reçus.
export async function warm() {
  let bytes = 0;
  for (const f of ['tesseract.esm.min.js', 'worker.min.js', 'core/' + coreFile(), 'lang/fra.traineddata.gz']) {
    const r = await fetch(VENDOR + f);
    if (!r.ok) throw new Error(`${f} : ${r.status}`);
    bytes += (await r.arrayBuffer()).byteLength;
  }
  return bytes;
}

export async function terminate() {
  if (!tess) return;
  const p = tess;
  tess = null;
  try { (await p).terminate(); } catch { /* déjà arrêté */ }
}

function canvasOf(img) {
  const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(img.width, img.height) : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const x = c.getContext('2d');
  x.putImageData(img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

// Une ligne (ImageData noir sur blanc) → { text, conf }
export async function readLine(img) {
  const w = await load();
  const { data } = await w.recognize(canvasOf(img));
  return { text: (data.text || '').replace(/\s+/g, ' ').trim(), conf: data.confidence ?? 0 };
}

// ---------------------------------------------------------------------------------------------------------
// Index des cartes (cards.json : ids avec image + noimg, sets{t, era, num, c}, codes)

const setOf = id => id.slice(0, id.lastIndexOf('-'));
const localOf = id => id.slice(id.lastIndexOf('-') + 1);
// numéro normalisé : majuscules, zéros de tête retirés de la partie chiffrée (« 001 » → « 1 », « TG01 » → « TG1 »)
export const normNum = s => String(s).toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');
const pad3 = s => (/^\d+$/.test(s) ? s.padStart(3, '0') : s);

export function setCards(cards) {
  const all = [...cards.ids, ...(cards.noimg || [])];
  const byNum = new Map();          // numéro normalisé → [ids]
  const prefixTotal = new Map();    // « g1|RC » → nombre de cartes (total imprimé des sous-séries)
  for (const id of all) {
    const n = normNum(localOf(id));
    (byNum.get(n) || byNum.set(n, []).get(n)).push(id);
    const m = /^([A-Z]+)\d+$/.exec(localOf(id).toUpperCase());
    if (m) { const k = setOf(id) + '|' + m[1]; prefixTotal.set(k, (prefixTotal.get(k) || 0) + 1); }
  }
  const codes = new Map();
  for (const [c, v] of Object.entries(cards.codes || {})) codes.set(c, Array.isArray(v) ? v : [v]);
  idx = { sets: cards.sets || {}, byNum, prefixTotal, codes, all: new Set(all) };
}

// Ce qui est imprimé sur la carte, en deux parties : code de série (SV/ME, sans « FR ») et numéro
// (« 079/165 », « 001/202 », « 4/102 », « RC1/RC32 », « TG05/TG30 », « SWSH001 », « 001 » pour les promos SV)
// Séries qui reprennent le numéro d'origine de la carte reproduite (Collection Classique : « 4/102 ») : numéro
// imprimé inconnu ici → la lecture ne peut ni les confirmer ni les écarter.
const REPRINT_NUM = new Set(['cel25cc']);

export function parts(id) {
  if (!idx) return { code: '', num: '' };
  const sid = setOf(id), lid = localOf(id).toUpperCase(), s = idx.sets[sid] || {};
  if (REPRINT_NUM.has(sid)) return { code: '', num: '', unknown: true };
  const m = /^([A-Z]+)(\d+)$/.exec(lid);
  if (s.c) {
    const promo = !s.t || sid === 'svp' || sid === 'mep';
    return { code: s.c, num: `${pad3(lid)}${promo ? '' : '/' + String(s.t).padStart(3, '0')}` };
  }
  if (m) {
    const tot = idx.prefixTotal.get(sid + '|' + m[1]);
    if (['TG', 'GG', 'SV', 'RC'].includes(m[1]) && tot) {
      return { code: '', num: `${lid}/${m[1]}${m[1] === 'SV' && m[2].length === 3 ? String(tot).padStart(3, '0') : tot}` };
    }
    return { code: '', num: lid };                      // promos SWSH001, SM01…, H01, SH4…
  }
  if (!/^\d+$/.test(lid)) return { code: '', num: lid };
  const t = s.t || 0;
  if (s.era === 'swsh') return { code: '', num: `${pad3(lid)}/${String(t).padStart(3, '0')}` };
  return { code: '', num: t ? `${normNum(lid)}/${t}` : normNum(lid) };
}

// Chaîne complète attendue (affichage, tests) : « MEWFR025/165 », « 4/102 »
export function expected(id) {
  const p = parts(id);
  return p.code ? `${p.code}FR${p.num}` : p.num;
}

// ---------------------------------------------------------------------------------------------------------
// Grammaire (FINAL-scanner §5.6) : candidats dont le numéro imprimé apparaît dans la lecture

const CONF = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6', D: '0', Q: '0', T: '7', U: '0' };
const LETTER = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G', 7: 'T', 4: 'A' };
const digits = s => s.replace(/[A-Z]/g, c => CONF[c] ?? c);
const D = '[0-9OILSBZGDQTU]';

// coût de substitution d'un caractère lu (a) par le caractère attendu (b) : confusions courantes de l'OCR à 0,35
const subCost = (a, b) => (a === b ? 0 : (CONF[a] === b || CONF[b] === a || LETTER[a] === b || LETTER[b] === a) ? 0.35 : 1);

const clean = t => String(t).toUpperCase().replace(/[^A-Z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();
const inSet = (sid, n) => (idx.byNum.get(normNum(n)) || []).filter(id => setOf(id) === sid);

// Texte lu → ids compatibles (numéro + total, galeries, promos, codes SV/ME des promos sans total)
export function parse(text) {
  if (!idx) return [];
  const T = ' ' + clean(text) + ' ', out = new Set();
  // n / total (cartes secrètes au-delà du total comprises)
  for (const m of T.matchAll(new RegExp(`(${D}{1,3}) ?\/ ?(${D}{2,3})`, 'g'))) {
    const tot = +digits(m[2]);
    // une lettre en tête peut être un chiffre mal lu (I, L → 1) ou le symbole de série lu comme une lettre
    // (« L52/149 » sur sm1-52) : les deux lectures, la vérification départage ou propose un choix
    const heads = /^[A-Z]/.test(m[1]) && m[1].length > 1 ? [m[1], m[1].slice(1)] : [m[1]];
    for (const h of heads) {
      const n = digits(h);
      if (!/^\d+$/.test(n) || !tot) continue;
      for (const id of idx.byNum.get(normNum(n)) || []) if ((idx.sets[setOf(id)] || {}).t === tot) out.add(id);
    }
  }
  // galeries et sous-séries : TG01/TG30, GG12/GG70, SV001/SV122, RC1/RC32
  for (const m of T.matchAll(/(TG|GG|SV|RC|SL|SH|RT|AR|H) ?(\d{1,3}) ?\/ ?(?:TG|GG|SV|RC|SL)? ?(\d{1,3})/g)) {
    for (const id of idx.byNum.get(m[1] + normNum(m[2])) || []) out.add(id);
  }
  // promos : SWSH001, SM01, XY01, BW01, DP01, HGSS01
  for (const m of T.matchAll(/(SWSH|HGSS|SM|XY|BW|DP) ?(\d{2,3})(?! ?\/)/g)) {
    for (const id of idx.byNum.get(m[1] + normNum(m[2])) || []) out.add(id);
  }
  // SV / ME sans total (promos SVP, MEP) : code + numéro à 3 chiffres
  for (const m of T.matchAll(new RegExp(`([A-Z0-9]{3})[A-Z]{0,2} ?(${D}{3})(?! ?\/)`, 'g'))) {
    for (const [c, sids] of idx.codes) {
      if (fitDist(m[1], c) > 1) continue;
      for (const sid of sids) for (const id of inSet(sid, digits(m[2]))) out.add(id);
    }
  }
  return [...out];
}

// Distance d'édition « semi-globale » : l'attendu peut se trouver n'importe où dans le texte lu
// (lettre de règlement, symbole de rareté ou de série autour sont gratuits). Retourne aussi le début de l'alignement.
export function fitAlign(text, exp) {
  const t = String(text).toUpperCase().replace(/[^A-Z0-9/]/g, ''), e = exp;
  if (!e) return { d: 99, start: 0, t };
  let prev = new Float64Array(t.length + 1), ps = new Int32Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) ps[j] = j;                     // début gratuit
  for (let i = 1; i <= e.length; i++) {
    const row = new Float64Array(t.length + 1), rs = new Int32Array(t.length + 1);
    row[0] = i; rs[0] = 0;
    for (let j = 1; j <= t.length; j++) {
      let v = prev[j - 1] + subCost(t[j - 1], e[i - 1]), st = ps[j - 1];
      if (prev[j] + 1 < v) { v = prev[j] + 1; st = ps[j]; }
      if (row[j - 1] + 1 < v) { v = row[j - 1] + 1; st = rs[j - 1]; }
      row[j] = v; rs[j] = st;
    }
    prev = row; ps = rs;
  }
  let m = Infinity, start = 0;
  for (let j = 0; j <= t.length; j++) if (prev[j] < m) { m = prev[j]; start = ps[j]; }   // fin gratuite
  return { d: m, start, t };
}
export const fitDist = (text, exp) => fitAlign(text, exp).d;

// Distance au numéro imprimé ; « 47/165 » ne doit pas profiter de « 047/165 » (chiffre juste avant : pénalité)
function numDist(text, num) {
  const a = fitAlign(text, num);
  if (/^\d/.test(num) && a.start > 0 && /\d/.test(a.t[a.start - 1])) return a.d + 0.6;
  return a.d;
}

// Lectures : chaînes, ou { text, num (zone lue : bl | blsm | br | ec), box (cartouche SV/ME vu), variant }.
const items = texts => (Array.isArray(texts) ? texts : [texts]).filter(Boolean)
  .map(t => (typeof t === 'string' ? { text: t } : t)).filter(t => t.text);
const zoneOf = id => { const s = idx.sets[setOf(id)] || {}; return s.num === 'bl' && s.era === 'sm' ? 'blsm' : s.num || 'br'; };
// une lecture ne vaut que pour les cartes dont le numéro est dans la zone lue (et un cartouche → série SV/ME)
const fits = (t, id) => (!t.num || t.num === zoneOf(id)) && (!t.box || !!(idx.sets[setOf(id)] || {}).c);

// Classement des candidats : distance au numéro imprimé (total compris), puis au code de série ;
// agree = nombre de lectures (variantes d'image) où le numéro est lu exactement
export function verify(texts, ids) {
  const list = items(texts);
  return ids.map(id => {
    const p = parts(id);
    let num = 99, code = p.code ? 99 : 0, agree = 0;
    for (const t of list) {
      if (p.unknown || !fits(t, id)) continue;
      const nd = numDist(t.text, p.num);
      num = Math.min(num, nd);
      if (nd < 0.5) agree++;
      if (p.code) code = Math.min(code, fitDist(t.text, p.code));
    }
    return { id, num, code, agree, unknown: !!p.unknown, score: num + 0.5 * code, exp: p.code ? `${p.code}FR${p.num}` : p.num };
  }).sort((a, b) => a.score - b.score || a.num - b.num);
}

// Parmi des candidats dont le numéro est lu exactement : un seul, ou le code de série en désigne un
function pick(exact) {
  const a = exact[0], b = exact[1];
  if (!b) return a;
  if (a.exp.includes('FR') && b.exp.includes('FR') && b.code - a.code >= 1) return a;
  return null;
}

// Décision à partir des lectures. candidates = cartes proposées par l'image (mode vérification), dans l'ordre de
// l'image ; dists = { id: distance d'image } (facultatif).
// accept : numéro lu exactement (aux confusions près) et porté par une seule carte (ou désignée par son code) ;
// en vérification, la carte lue ne doit pas être nettement plus loin à l'image que la première (chiffre mal lu
// → choix entre les deux) ; sans candidats de l'image (grammaire seule) il faut en plus le code SV/ME lu
// (séries SV/ME) ou deux lectures concordantes (autres séries).
// choose : cartes dont le numéro est lu à une erreur près. Retourne { decision, ids, why } ou null.
export const OCR = { imageSlack: 0.25 };
export function decideOcr(texts, candidates = [], dists = null) {
  if (!idx) return null;
  const list = items(texts);
  if (!list.length) return null;
  const first = list[0].text;
  const cands = [...new Set(candidates)].filter(id => idx.all.has(id));
  // 1. vérification parmi les cartes proposées par l'image
  if (cands.length) {
    const v = verify(list, cands), exact = v.filter(x => x.num < 0.5);
    const unknown = v.filter(x => x.unknown).map(x => x.id);
    if (exact.length && unknown.length) {
      // une version au numéro imprimé inconnu (reproduction) reste possible : choix
      return { decision: 'choose', ids: [...new Set([...exact.map(x => x.id), ...unknown])].slice(0, 8), why: 'reproduction au même numéro possible' };
    }
    if (exact.length) {
      const a = pick(exact);
      const d0 = dists?.[cands[0]], da = dists?.[a?.id];
      if (a && d0 != null && da != null && da > d0 + OCR.imageSlack) {
        return { decision: 'choose', ids: [...new Set([cands[0], a.id, ...exact.map(x => x.id)])].slice(0, 8), why: 'lecture contredite par l’image' };
      }
      if (a) return { decision: 'accept', ids: [a.id, ...v.filter(x => x.id !== a.id).map(x => x.id)].slice(0, 8), why: `lu « ${first} » ≈ ${a.exp}` };
      return { decision: 'choose', ids: exact.map(x => x.id).slice(0, 8), why: 'numéro porté par plusieurs versions' };
    }
  }
  // 2. grammaire seule : toutes les cartes dont le numéro apparaît dans une lecture de leur zone
  const pool = [...new Set([...list.flatMap(t => parse(t.text).filter(id => fits(t, id))), ...cands])];
  if (!pool.length) return null;
  const v = verify(list, pool), exact = v.filter(x => x.num < 0.5);
  if (exact.length) {
    const a = pick(exact);
    // un numéro mal lu peut tomber sur une autre carte réelle : deux lectures concordantes, ou le code SV/ME
    if (a && (a.exp.includes('FR') ? a.code <= 1 : a.agree >= 2)) {
      return { decision: 'accept', ids: [a.id, ...exact.filter(x => x.id !== a.id).map(x => x.id)].slice(0, 8), why: `lu « ${first} » ≈ ${a.exp}` };
    }
    return { decision: 'choose', ids: exact.map(x => x.id).slice(0, 8), why: 'numéro lu, plusieurs cartes possibles' };
  }
  const near = v.filter(x => x.num <= 1.0);
  if (near.length) return { decision: 'choose', ids: near.map(x => x.id).slice(0, 8), why: 'lecture approximative' };
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Lecture d'une image identifiée par le worker (token) : zones selon l'ère des candidats, sinon toutes.

export function numsFor(ids) {
  if (!idx || !ids.length) return ['bl', 'br', 'blsm', 'ec'];
  const out = [];
  for (const id of ids) {
    const s = idx.sets[setOf(id)];
    if (!s) continue;
    const k = s.num === 'bl' && s.era === 'sm' ? 'blsm' : s.num || 'br';
    if (!out.includes(k)) out.push(k);
  }
  return out.length ? out : ['bl', 'br', 'blsm', 'ec'];
}

export async function ocrFrame(token, { candidates = [], dists = null, quad = null, onProgress } = {}) {
  if (!idx && getCards()) setCards(getCards());
  if (!idx) return null;
  const t0 = performance.now();
  const cands = [...new Set(candidates)].filter(id => idx.all.has(id));
  // lignes préparées d'abord : l'image (token) peut être oubliée par le worker pendant le chargement de tesseract
  const lines = await call('ocrprep', { token, nums: numsFor(cands), quad });
  if (!lines.length) return null;
  await load(onProgress);
  const reads = [];
  let d = null;
  for (const l of lines) {
    const { text } = await readLine(l.img);
    if (text) reads.push({ text, num: l.num, box: !!l.box, variant: l.variant });
    d = decideOcr(reads, cands, dists);
    if (d && d.decision === 'accept') break;
  }
  return d ? { ...d, texts: reads.map(r => r.text), ms: performance.now() - t0 } : null;
}
