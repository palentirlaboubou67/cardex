// Choix d'affichage mémorisés (thème, blocs ouverts, finition du scan…). Clé 'cardex.prefs.v1'.
// Clés utilisées : theme ('auto'|'light'|'dark'), openBlocs (tableau), sealedLang ('int'|'int+ja'), compact (bool),
// scanFinish ('normal'…), scanAuto (bool), lastBackupReminder (ms).
const KEY = 'cardex.prefs.v1';
let data = load();
const subs = new Set();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}

// Copie défensive des objets et tableaux : une modification par l'appelant ne change pas la valeur gardée.
const clone = v => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

export const get = (key, fallback) => (Object.prototype.hasOwnProperty.call(data, key) ? clone(data[key]) : fallback);

export function set(key, value) {
  if (value === undefined) delete data[key];
  else data[key] = clone(value);
  const ok = save();
  subs.forEach(fn => { try { fn(key, get(key)); } catch (e) { console.error(e); } });
  return ok;
}

export const remove = key => set(key, undefined);

// fn(key, value) à chaque changement (cette page ou un autre onglet)
export const on = fn => (subs.add(fn), () => subs.delete(fn));

// Autre onglet (appli installée + onglet du navigateur) : on relit.
if (typeof addEventListener === 'function') {
  addEventListener('storage', e => {
    if (e.key !== KEY) return;
    const before = data;
    data = load();
    for (const k of new Set([...Object.keys(before), ...Object.keys(data)])) {
      if (JSON.stringify(before[k]) !== JSON.stringify(data[k])) subs.forEach(fn => { try { fn(k, get(k)); } catch (err) { console.error(err); } });
    }
  });
}
