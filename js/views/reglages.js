// Réglages (#/reglages, W-V) : sauvegarde (exporter, importer, rappel mensuel), état du stockage et copies de secours,
// affichage (thème, grille compacte), sources, zone sensible (tout effacer, avec « Annuler »).
import { setBar } from '../core/appbar.js';
import { html, setHTML, delegate } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { num, plural, dateFr, timeFr, relDay } from '../core/format.js';
import { openSheet } from '../core/sheet.js';
import { toast } from '../core/toast.js';
import * as col from '../state/collection.js';
import * as prefs from '../state/prefs.js';
import * as prices from '../data/prices.js';
import * as backup from './collection/backup.js';

// mentions des sources (SPEC §8), une par ligne
const credits = () => [
  prices.creditText(),
  'Données des cartes : TCGdex',
  'Noms et images des Pokémon : PokéAPI',
  'Photos des produits : TCGplayer (version anglaise)',
  'Certaines illustrations : version anglaise (TCGdex, Scrydex)',
  'Listes des decks : Limitless TCG',
  'Logo de Destinées Radieuses : Poképédia (licence CC BY-NC-SA 3.0)',
  'Lecture du numéro des cartes : Tesseract.js (licence Apache 2.0)',
  'Icônes : Lucide (licence ISC) · Police : Instrument Sans (licence OFL)',
];

const THEMES = [['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']];
const MAX_FILE = 30 * 1024 * 1024;
let el = null, body = null, picker = null, sig = null, est = null, persisted = null;

const size = n => (n < 1024 ? `${num(n)} o` : n < 1048576 ? `${num(Math.round(n / 1024))} Ko`
  : n < 1073741824 ? `${(n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
  : `${(n / 1073741824).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`);
const when = ms => `${dateFr(ms)} à ${timeFr(ms)}`;
const today = () => new Date().toISOString().slice(0, 10);

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name, rel: 'noopener' });
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- rendu ----------
function contents() {
  const recs = col.all();
  const st = col.stats();
  const sealed = col.sealedAll().length, watch = col.watchList().length;
  const last = col.lastExport(), saved = col.lastSave();
  const late = backup.overdue();
  const what = [plural(st.total, 'carte', 'cartes'), sealed ? plural(sealed, 'produit scellé', 'produits scellés') : '', watch ? plural(watch, 'produit suivi', 'produits suivis') : ''].filter(Boolean).join(', ');
  return { recs, st, sealed, watch, last, saved, late, what };
}

// action de l'alerte de stockage : « Exporter » quand l'enregistrement échoue (la collection en mémoire est la bonne) ;
// collection illisible remplacée par une vide : exporter ne sauverait rien, on propose la copie gardée
function alertAction(s) {
  if (s.readOnly) return '';                                // texte illisible : ligne « Télécharger » plus bas
  if (s.error) return html`<button type="button" class="btn text sm" data-act="export">Exporter</button>`;
  if (s.notice === 'corrupt' && s.corrupt && s.backups.some(b => b.key === s.corrupt)) {
    return html`<button type="button" class="btn text sm" data-act="bk-dl" data-key="${s.corrupt}">Télécharger la copie</button>`;
  }
  return '';
}

function render() {
  const c = contents();
  const s = col.storageState();
  const t = prefs.get('theme', 'auto');
  setHTML(body, html`
    <h2 class="sect">Sauvegarde</h2>
    <div class="group">
      <button type="button" class="row" data-act="export"><span class="lead">${icon('download')}</span><span class="body"><span class="t">Exporter ma collection</span><span class="s"><span>Fichier .json · ${c.what}</span></span></span></button>
      <button type="button" class="row" data-act="import"><span class="lead">${icon('upload')}</span><span class="body"><span class="t">Importer une sauvegarde</span><span class="s"><span>Ajoutée à ta collection : rien n’est effacé</span></span></span></button>
      <div class="row set-info"><span class="lead">${icon('clock')}</span><span class="body"><span class="t">Enregistrée sur cet appareil</span><span class="s set-wrap"><span>${c.saved ? `Dernier changement le ${when(c.saved)}` : 'Aucun changement pour l’instant'}</span></span><span class="s set-wrap"><span class="${c.late ? 'set-late' : ''}">${c.last ? `Dernier export ${relDay(c.last)}` : c.recs.length ? 'Jamais exportée' : 'Rien à exporter pour l’instant'}</span></span></span></div>
      <label class="row"><span class="lead">${icon('bell')}</span><span class="body"><span class="t">Rappel de sauvegarde</span><span class="s set-wrap"><span>Chaque mois, sur l’écran Collection</span></span></span><input type="checkbox" role="switch" class="switch" data-pref="backupReminder"${backup.enabled() ? ' checked' : ''}></label>
    </div>

    <h2 class="sect">Stockage</h2>
    ${s.message ? html`<div class="set-alert" role="alert">${icon('alert')}<span class="grow">${s.message}</span>${alertAction(s)}</div>` : ''}
    <div class="group">
      <div class="row"><span class="lead">${icon('box')}</span><span class="body"><span class="t">Collection</span><span class="s"><span>${size(s.bytes)} dans le stockage du navigateur</span></span></span></div>
      <div class="row set-est"><span class="lead">${icon('collection')}</span><span class="body"><span class="t">Espace du site</span><span class="s set-wrap"><span>${est ? `${size(est.usage)} utilisés sur ${size(est.quota)} (cartes, images et cotes gardées pour le hors ligne)` : 'Calcul…'}</span></span></span></div>
      <div class="row"><span class="lead">${icon('check')}</span><span class="body"><span class="t">Stockage persistant</span><span class="s set-wrap"><span>${persisted === true ? 'Oui : le navigateur ne l’effacera pas de lui-même' : persisted === false ? 'Non : le navigateur peut l’effacer s’il manque de place' : 'Inconnu sur ce navigateur'}</span></span>${
        persisted === false && navigator.storage?.persist ? html`<button type="button" class="btn text sm set-inline" data-act="persist">Demander au navigateur</button>` : ''}</span></div>
      ${s.hasCorruptText ? html`<div class="row"><span class="lead">${icon('alert')}</span><span class="body"><span class="t">Collection illisible</span><span class="s set-wrap"><span>Plus de place pour en garder une copie : télécharge-la avant de repartir de zéro</span></span></span></div>
        <div class="row set-btnrow"><button type="button" class="btn sm" data-act="raw-dl">${icon('download')}Télécharger</button><button type="button" class="btn sm danger" data-act="raw-discard">Repartir de zéro</button></div>` : ''}
    </div>
    ${s.backups.length ? html`<h2 class="sect">Copies de secours</h2>
      <div class="group">${s.backups.map(b => html`<div class="row set-backup"><span class="lead">${icon('alert')}</span><span class="body"><span class="t">Copie du ${b.at ? when(b.at) : 'jour inconnu'}</span><span class="s"><span>${size(b.size)} · collection illisible gardée telle quelle</span></span></span><button type="button" class="ibtn" data-act="bk-dl" data-key="${b.key}" aria-label="Télécharger la copie du ${b.at ? dateFr(b.at) : 'jour inconnu'}">${icon('download')}</button><button type="button" class="ibtn" data-act="bk-del" data-key="${b.key}" aria-label="Supprimer la copie du ${b.at ? dateFr(b.at) : 'jour inconnu'}">${icon('trash')}</button></div>`)}</div>
      <p class="caption">Ta collection enregistrée était illisible : elle a été gardée ici. Télécharge-la pour la confier à quelqu’un qui saura la réparer, puis supprime-la.</p>` : ''}

    <h2 class="sect">Affichage</h2>
    <div class="group">
      <div class="row"><span class="lead">${icon('theme')}</span><span class="body"><span class="t">Thème</span></span><span class="seg" role="group" aria-label="Thème">${
        THEMES.map(([v, l]) => html`<button type="button" data-theme-set="${v}" aria-pressed="${v === t ? 'true' : 'false'}">${l}</button>`)}</span></div>
      <label class="row"><span class="lead">${icon('grid')}</span><span class="body"><span class="t">Grille compacte</span><span class="s set-wrap"><span>4 cartes par ligne, sans légende (Collection, Pokémon)</span></span></span><input type="checkbox" role="switch" class="switch" data-pref="compact"${prefs.get('compact', false) ? ' checked' : ''}></label>
    </div>

    <h2 class="sect">Sources</h2>
    <div class="set-credits">${credits().map(x => html`<p>${x}</p>`)}</div>

    <h2 class="sect">Zone sensible</h2>
    <div class="group">
      <button type="button" class="row danger" data-act="clear"${c.recs.length || c.sealed || c.watch ? '' : ' disabled'}><span class="lead">${icon('trash')}</span><span class="body"><span class="t">Tout effacer</span><span class="s"><span>Cartes, scellé et produits suivis de cet appareil</span></span></span></button>
    </div>`);
}

// ---------- actions ----------
// feuille de confirmation : l'écouteur va sur le contenu créé ici (le corps de la feuille est réutilisé d'une feuille
// à l'autre : un écouteur posé dessus survivrait à sa feuille)
function confirmSheet(title, lede, buttons, onPick) {
  const box = document.createElement('div');
  box.innerHTML = String(html`<p class="col-sheet-lede">${lede}</p><div class="col-sheet-btns">${buttons.map(([x, ic, label, danger]) => html`<button type="button" class="btn block${danger ? ' danger' : ''}" data-x="${x}">${icon(ic)}${label}</button>`)}</div>`);
  const s = openSheet({ title, body: box });
  box.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) onPick(b.dataset.x, s); });
  return s;
}

function clearSheet() {
  const c = contents();
  confirmSheet('Tout effacer ?', `Toute ta collection sera effacée de cet appareil : ${c.what || 'rien pour l’instant'}. Pense à exporter avant.`,
    [['export', 'download', 'Exporter d’abord'], ['clear', 'trash', 'Tout effacer', true]], (x, s) => {
      if (x === 'export') { backup.exportNow(); render(); return; }
      const saved = col.exportText();                        // pour « Annuler »
      const n = c.st.total;
      const ok = col.clearAll();
      s.close();
      render();
      toast(ok ? `Collection effacée (${plural(n, 'carte', 'cartes')})` : 'Collection effacée, mais pas enregistrée sur l’appareil', {
        action: 'Annuler', ms: 8000,
        onAction: () => { try { col.importText(saved); toast('Collection rétablie'); } catch (e) { toast(e.message); } render(); },
      });
    });
}

// éléments du fichier que la validation compte (cartes, scellé) -> { n, watch }
function entries(text) {
  try {
    const d = JSON.parse(text);
    const k = o => (o && typeof o === 'object' ? Object.keys(o).length : 0);
    const a = o => (Array.isArray(o) ? o.length : 0);
    return { n: k(d.cards) + k(d.sealed) + (d.v === 2 ? k(d.tcg?.sealed) : 0), watch: a(d.watch) + (d.v === 2 ? a(d.tcg?.watch) : 0) };
  } catch { return { n: 0, watch: 0 }; }
}

async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE) { toast('Fichier trop gros pour une sauvegarde Cardex'); return; }
  let text;
  try { text = await file.text(); } catch { toast('Fichier illisible : ce n’est pas une sauvegarde Cardex'); return; }
  let r;
  try { r = col.importText(text); } catch (e) { toast(e?.message || 'Ce fichier n’est pas une sauvegarde Cardex', { ms: 6000 }); return; }
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
  render();
}

async function refreshStorage() {
  try { est = await navigator.storage?.estimate?.() || null; } catch { est = null; }
  try { persisted = typeof navigator.storage?.persisted === 'function' ? await navigator.storage.persisted() : null; } catch { persisted = null; }
  if (el && !el.hidden && !sig?.aborted) render();
}

export default {
  mount(section) {
    el = section;
    // le champ fichier est créé une fois, hors du contenu redessiné : un rendu pendant que le sélecteur est ouvert
    // (date des cotes arrivée, autre onglet…) ne le remplace plus, et le fichier choisi arrive bien
    body = el.appendChild(Object.assign(document.createElement('div'), { className: 'set-body' }));
    picker = el.appendChild(Object.assign(document.createElement('input'), { type: 'file', id: 'set-import', accept: '.json,application/json', hidden: true, tabIndex: -1 }));
    picker.addEventListener('change', () => { const f = picker.files?.[0]; picker.value = ''; importFile(f); });
    delegate(el, 'click', '[data-theme-set]', (e, b) => {
      prefs.set('theme', b.dataset.themeSet);
      for (const x of el.querySelectorAll('[data-theme-set]')) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    });
    delegate(el, 'change', 'input[data-pref]', (e, i) => { prefs.set(i.dataset.pref, i.checked); });
    delegate(el, 'click', '[data-act]', async (e, b) => {
      const a = b.dataset.act, key = b.dataset.key;
      if (a === 'export') { backup.exportNow(); render(); }
      else if (a === 'import') picker.click();
      else if (a === 'clear') clearSheet();
      else if (a === 'persist') {
        try { persisted = await navigator.storage.persist(); } catch { /* refusé */ }
        toast(persisted ? 'Stockage persistant activé' : 'Le navigateur a refusé pour l’instant');
        render();
      } else if (a === 'bk-dl') {
        const text = col.corruptText(key);
        if (text != null) download(text, `cardex-copie-illisible-${today()}.json`); else toast('Copie introuvable');
      } else if (a === 'bk-del') {
        confirmSheet('Supprimer cette copie ?', 'La copie de ta collection illisible sera supprimée de cet appareil. Télécharge-la d’abord si tu veux la garder.',
          [['dl', 'download', 'Télécharger'], ['del', 'trash', 'Supprimer', true]], (x, s) => {
            if (x === 'dl') { const t = col.corruptText(key); if (t != null) download(t, `cardex-copie-illisible-${today()}.json`); return; }
            const ok = col.deleteBackup(key);
            s.close();
            toast(ok ? 'Copie supprimée' : 'Copie introuvable');
            render();
          });
      } else if (a === 'raw-dl') {
        const text = col.corruptText();
        if (text != null) download(text, `cardex-collection-illisible-${today()}.json`);
      } else if (a === 'raw-discard') {
        confirmSheet('Repartir de zéro ?', 'La collection illisible gardée en mémoire sera perdue si tu ne l’as pas téléchargée.',
          [['dl', 'download', 'Télécharger'], ['go', 'trash', 'Repartir de zéro', true]], (x, s) => {
            if (x === 'dl') { const t = col.corruptText(); if (t != null) download(t, `cardex-collection-illisible-${today()}.json`); return; }
            const ok = col.discardCorrupt();
            s.close();
            toast(ok ? 'Nouvelle collection vide enregistrée' : 'Toujours impossible d’enregistrer');
            render();
          });
      }
    });
    // autre onglet, import, problème d'enregistrement : l'écran suit
    addEventListener('cardex:storage', () => { if (!el.hidden) render(); });
    addEventListener('cardex:export', () => { if (!el.hidden) render(); });
    // réglage changé (ici ou dans un autre onglet) : les contrôles sont corrigés en place (le focus reste)
    prefs.on((k, v) => {
      if (k === 'theme') for (const x of el.querySelectorAll('[data-theme-set]')) x.setAttribute('aria-pressed', x.dataset.themeSet === (v || 'auto') ? 'true' : 'false');
      const i = el.querySelector(`input[data-pref="${k}"]`);
      if (i) i.checked = k === 'backupReminder' ? v !== false : !!v;
    });
  },

  async show(r) {
    sig = r.signal;
    setBar({ title: 'Réglages', back: true, signal: r.signal });
    render();
    refreshStorage();
    // date des cotes pour la mention Cardmarket : un fichier de cotes suffit (ceux de la collection d'abord)
    if (!prices.date()) {
      const p = col.all().length ? col.ensurePrices() : import('../data/catalog.js').then(c => c.sets()).then(s => prices.ensure([s.sets[0]?.id].filter(Boolean)));
      p.then(() => { if (!el.hidden && !r.signal.aborted) render(); }).catch(() => {});
    }
  },

  resume(r) { sig = r.signal; render(); refreshStorage(); },

  hide() {},

  // la collection change (autre onglet, scanner…) : nombres et boutons à jour
  onChange() { if (el && !el.hidden) render(); },
};
