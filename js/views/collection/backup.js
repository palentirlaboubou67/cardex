// Sauvegarde : export avec toast, et rappel mensuel (Collection › Cartes, Réglages).
// La collection ne vit que sur l'appareil : sans export depuis 30 jours (ou jamais, collection commencée il y a plus
// de 30 jours), une ligne propose d'exporter. « Plus tard » la cache 7 jours (prefs lastBackupReminder).
// Le rappel peut être coupé dans Réglages (prefs backupReminder = false).
import * as col from '../../state/collection.js';
import * as prefs from '../../state/prefs.js';
import { toast } from '../../core/toast.js';
import { relDay } from '../../core/format.js';

const DAY = 86400e3, MONTH = 30 * DAY, SNOOZE = 7 * DAY;

// date de référence : dernier export, sinon la plus ancienne carte (collection jamais exportée)
export function since() {
  const last = col.lastExport();
  if (last) return last;
  let t = Infinity;
  for (const r of col.all()) if (r.addedAt < t) t = r.addedAt;
  return Number.isFinite(t) ? t : 0;
}

export const enabled = () => prefs.get('backupReminder', true) !== false;
export const overdue = (now = Date.now()) => col.all().length > 0 && now - since() >= MONTH;

// texte du rappel, ou null quand il n'a pas lieu d'être
export function reminder(now = Date.now()) {
  if (!enabled() || !overdue(now)) return null;
  if (now - (Number(prefs.get('lastBackupReminder', 0)) || 0) < SNOOZE) return null;
  const last = col.lastExport();
  return last ? `Dernier export ${relDay(last)}` : 'Collection jamais exportée';      // court : une ligne à 390 px
}

export const snooze = () => prefs.set('lastBackupReminder', Date.now());

// fichier .json téléchargé -> { name, size } | null
export function exportNow() {
  try {
    const r = col.exportFile();
    toast('Sauvegarde téléchargée');
    dispatchEvent(new CustomEvent('cardex:export'));
    return r;
  } catch (e) {
    console.error(e);
    toast('Export impossible sur ce navigateur');
    return null;
  }
}
