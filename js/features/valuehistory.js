// (ébauche F1) Historique de la valeur de la collection (clé cardex.history.v1, un point par jour : { d, v, n }).
// Implémenté par la vue Collection (vague 2) : init() enregistre la valeur du jour une fois les cotes chargées.
// init() : appelé par main.js quand le navigateur est libre. points() → [{ d: 'YYYY-MM-DD', v }]
const KEY = 'cardex.history.v1';

export function init() {}

export function points() {
  try {
    const h = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(h) ? h.filter(p => p && typeof p.d === 'string' && Number.isFinite(p.v)).map(p => ({ d: p.d, v: p.v })) : [];
  } catch { return []; }
}
