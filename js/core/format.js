// Mise en forme fr-FR (FINAL-design §5.4) : euros, pourcentages, dates, numéros de carte. Signe moins typographique (U+2212).
const MINUS = s => s.replace('-', '−');
const NF_EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const NF_EUR_D = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const NF_PCT = new Intl.NumberFormat('fr-FR', { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 });
const NF_NUM = new Intl.NumberFormat('fr-FR');
const RTF = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const ok = v => typeof v === 'number' && Number.isFinite(v);

export const eur = v => (ok(v) ? MINUS(NF_EUR.format(v)) : '—');                 // 1 430,00 €
export const eurC = cents => (ok(cents) ? eur(cents / 100) : '—');
export const eurDelta = v => (ok(v) ? MINUS(NF_EUR_D.format(v)) : '—');          // +12,30 €
export const pct = v => (ok(v) ? MINUS(NF_PCT.format(v / 100)) : '—');           // v en points : 41.2 → +41,2 %
export const dir = v => (!ok(v) ? 'flat' : v > 0.5 ? 'up' : v < -0.5 ? 'down' : 'flat');   // seuil ±0,5 %
export const num = n => (ok(n) ? MINUS(NF_NUM.format(n)) : '—');                 // 1 234
export const plural = (n, one, many) => `${num(n)} ${Math.abs(n) > 1 ? many : one}`;

// 'YYYY-MM-DD', millisecondes ou Date → Date (une date seule est lue à midi, heure locale)
export function toDate(d) {
  if (d instanceof Date) return d;
  if (typeof d === 'number') return new Date(d);
  const s = String(d ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
}
const valid = d => !Number.isNaN(d.getTime());
export const dateFr = d => { const x = toDate(d); return valid(x) ? x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };  // 25 nov. 2026
export const dateShort = d => { const x = toDate(d); return valid(x) ? x.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—'; };  // 25/11
export const dateDay = d => { const x = toDate(d); return valid(x) ? x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—'; };      // 25 nov.
export const timeFr = d => { const x = toDate(d); return valid(x) ? x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''; };     // 19:02

// aujourd’hui | hier | avant-hier | il y a 3 jours | il y a 2 mois | il y a 1 an
export function relDay(d, now = new Date()) {
  const x = toDate(d);
  if (!valid(x)) return '—';
  const day = t => Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 86400000;
  const days = Math.round(day(x) - day(now));
  if (Math.abs(days) < 30) return RTF.format(days, 'day');
  if (Math.abs(days) < 365) return RTF.format(Math.round(days / 30.44), 'month');
  return RTF.format(Math.round(days / 365.25), 'year');
}

// clé de recherche : sans accents ni casse, ligatures dépliées, apostrophes droites, espaces réduits
export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').replace(/[’‘`´]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();

// numéro tel qu'imprimé : TCGdex encode certains numéros dans ses ids (« %3F » pour « ? ») ; jamais d'exception
export const localNo = localId => { const s = String(localId ?? ''); try { return decodeURIComponent(s); } catch { return s; } };

// numéro imprimé : « 025/165 » quand le numéro est numérique et le total connu, sinon le numéro seul (« SWSH001 », « TG05 », « ? »)
export const cardNo = (localId, total) => {
  const l = localNo(localId);
  return total && /^\d+$/.test(l) ? `${l}/${total}` : l;
};
