// Logos et symboles de séries (« covers de séries », FINAL-design §6.9, FINAL-images §4).
// Logo auto-hébergé (setMeta.logo) ; plaque claire en thème sombre quand meta.dark ; sinon couverture générée :
// symbole + code (« MEW », « TK9P »), jamais le nom complet (il est déjà écrit à côté).
import { html, raw, esc } from '../core/dom.js';

const SIZES = new Set(['row', 'hero', 'bloc']);
const codeOf = m => String(m?.code || m?.id || '?').toUpperCase().replace(/[^A-Z0-9.:]/g, '').slice(0, 6) || '?';
// image d'un autre hôte : toujours en CORS (le service worker ne garde que des réponses lisibles, SPEC §7)
const cors = u => (/^https?:\/\//.test(u) && !u.startsWith(location.origin) ? ' crossorigin="anonymous"' : '');

function monoHTML(m, size) {
  const sym = m?.sym ? `<img class="setsym" src="${esc(m.sym)}"${cors(m.sym)} alt="" decoding="async">` : '';
  return `<span class="setlogo setlogo-${size} mono" aria-hidden="true">${sym}<span class="code">${esc(codeOf(m))}</span>${tagHTML(m, size)}</span>`;
}
const tagHTML = (m, size) => (m?.tag && size !== 'bloc' ? `<span class="setlogo-tag">${esc(m.tag)}</span>` : '');

// setLogoHTML(setMeta, { size: 'row' (64 × 36) | 'hero' (160 × 64) | 'bloc' (16 px de haut) }) → Safe
export function setLogoHTML(meta, { size = 'row' } = {}) {
  const s = SIZES.has(size) ? size : 'row';
  installFallback();
  if (!meta?.logo) return raw(monoHTML(meta, s));
  const eager = s === 'hero';
  return html`<span class="setlogo setlogo-${s}${meta.dark ? ' dark' : ''}" aria-hidden="true" data-code="${codeOf(meta)}"${meta.sym ? raw(` data-sym="${esc(meta.sym)}"`) : ''}${meta.tag ? raw(` data-tag="${esc(meta.tag)}"`) : ''}><img src="${meta.logo}"${raw(cors(meta.logo))} alt=""${eager ? raw(' fetchpriority="high"') : raw(' loading="lazy"')} decoding="async">${raw(tagHTML(meta, s))}</span>`;
}

// setSymHTML(setMeta, { size }) → Safe : le petit symbole imprimé sur les cartes, ou rien
export function setSymHTML(meta, { size = 20 } = {}) {
  if (!meta?.sym) return raw('');
  const n = Number(size) || 20;
  return html`<img class="setsym" src="${meta.sym}"${raw(cors(meta.sym))} width="${n}" height="${n}" alt="" loading="lazy" decoding="async">`;
}

// un logo introuvable devient la couverture générée ; un symbole introuvable disparaît
let installed = false;
function installFallback() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.classList.contains('setsym')) {
      const box = img.closest('.setlogo.mono');
      img.remove();
      if (box && !box.querySelector('.code')?.textContent) box.remove();
      return;
    }
    const box = img.parentElement;
    if (!box?.classList.contains('setlogo') || box.classList.contains('mono')) return;
    const size = ['hero', 'bloc'].find(s => box.classList.contains(`setlogo-${s}`)) || 'row';
    box.outerHTML = monoHTML({ code: box.dataset.code, sym: box.dataset.sym, tag: box.dataset.tag }, size);
  }, true);
}
