// Sauvegarde : export avec toast, import d'un fichier (Réglages et l'état vide de Collection), et rappel mensuel
// (Collection › Cartes, Réglages).
// La collection ne vit que sur l'appareil : sans export depuis 30 jours (ou jamais, collection commencée il y a plus
// de 30 jours), une ligne propose d'exporter. « Plus tard » la cache 7 jours (prefs lastBackupReminder).
// Le rappel peut être coupé dans Réglages (prefs backupReminder = false).
import * as col from '../../state/collection.js';
import * as prefs from '../../state/prefs.js';
import { toast } from '../../core/toast.js';
import { relDay, plural } from '../../core/format.js';

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

// ---------- import ----------
const MAX_FILE = 30 * 1024 * 1024;

// éléments du fichier que la validation compte (cartes, scellé) -> { n, watch }
function entries(text) {
  try {
    const d = JSON.parse(text);
    const k = o => (o && typeof o === 'object' ? Object.keys(o).length : 0);
    const a = o => (Array.isArray(o) ? o.length : 0);
    return { n: k(d.cards) + k(d.sealed) + (d.v === 2 ? k(d.tcg?.sealed) : 0), watch: a(d.watch) + (d.v === 2 ? a(d.tcg?.watch) : 0) };
  } catch { return { n: 0, watch: 0 }; }
}

// importe un fichier de sauvegarde (ajouté à la collection, rien n'est effacé) et dit le résultat dans un toast
export async function importFile(file) {
  if (!file) return null;
  if (file.size > MAX_FILE) { toast('Fichier trop gros pour une sauvegarde Cardex'); return null; }
  let text;
  try { text = await file.text(); } catch { toast('Fichier illisible : ce n’est pas une sauvegarde Cardex'); return null; }
  let r;
  try { r = col.importText(text); } catch (e) { toast(e?.message || 'Ce fichier n’est pas une sauvegarde Cardex', { ms: 6000 }); return null; }
  const parts = [];
  if (r.cards) parts.push(plural(r.cards, 'nouvelle carte', 'nouvelles cartes'));
  if (r.updated) parts.push(plural(r.updated, 'carte complétée', 'cartes complétées'));
  if (r.sealed) parts.push(plural(r.sealed, 'produit scellé', 'produits scellés'));
  if (r.watch) parts.push(plural(r.watch, 'produit suivi', 'produits suivis'));
  // rien d'ajouté : fichier vide, rien de valide, ou tout était déjà là
  const e = parts.length ? null : entries(text);
  let msg = parts.length ? `Import réussi : ${parts.join(', ')}`
    : !e.n && !e.watch ? 'Sauvegarde vide : rien à importer'
    : r.skipped >= e.n && !e.watch ? 'Aucune carte valide dans ce fichier'
    : 'Rien de nouveau : ta collection contenait déjà tout';
  if (r.skipped) msg += ` · ${plural(r.skipped, 'élément ignoré (invalide)', 'éléments ignorés (invalides)')}`;
  if (parts.length && !r.saved) msg = 'Import fait, mais pas enregistré sur l’appareil : exporte ta collection';
  toast(msg, { ms: 6000 });
  return r;
}

// sélecteur de fichier (un seul champ, hors des contenus redessinés) ; à appeler pendant le geste de l'utilisateur
let picker = null, onPicked = null;
export function pickFile(done) {
  if (!picker) {
    picker = Object.assign(document.createElement('input'), { type: 'file', id: 'set-import', accept: '.json,application/json', hidden: true, tabIndex: -1 });
    picker.className = 'col-picker';
    document.body.appendChild(picker);
    picker.addEventListener('change', async () => {
      const f = picker.files?.[0];
      picker.value = '';
      const r = await importFile(f);
      onPicked?.(r);
    });
  }
  onPicked = done || null;
  picker.click();
}
