// Icônes : une planche SVG en ligne (<symbol>), trait 1,75 sur une grille de 24, utilisée par <use href="#i-nom">.
// Tracés : en grande partie Lucide (https://lucide.dev, licence ISC, © Lucide Contributors) ou inspirés de Lucide,
// le reste dessiné pour Cardex. Les icônes de la barre d'onglets sont recopiées telles quelles dans index.html.
import { raw } from './dom.js';

const B = 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2';
const BELL = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
const STAR = 'm12 2.5 2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z';

// nom -> contenu du symbole (viewBox 0 0 24 24 sauf indication)
export const PATHS = {
  back: '<path d="M19 12H5M11 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  filter: '<path d="M21.5 3.5h-19l7.6 9V19l3.8 1.9v-8.4z"/>',
  more: '<g fill="currentColor"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></g>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.6-2.8 2.6M12 16.5h.01"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  bell: BELL,
  'bell-ring': `${BELL}<path d="M4 2.5C2.8 4.2 2 6 2 8M22 8c0-2-.8-3.8-2-5.5"/>`,
  star: `<path d="${STAR}"/>`,
  'star-fill': `<path d="${STAR}" fill="currentColor"/>`,
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  flash: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  'flash-off': '<path d="M12.41 6.75 13 2l-2.43 2.92M18.57 12.91 21 10h-5.34M8 8l-5 6h9l-1 8 5-6M2 2l20 20"/>',
  scan: `<path d="${B}M7 12h10"/>`,
  collection: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="15.5" width="7" height="5" rx="1.5"/>',
  series: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  market: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  'market-down': '<path d="M3 7l6 6 4-4 8 8M15 17h6v-6"/>',
  decks: '<rect x="8" y="3.5" width="11" height="15" rx="2"/><path d="M5 7.5v11a2 2 0 0 0 2 2h8"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9"/>',
  binder: '<rect x="5.5" y="3" width="15" height="18" rx="2"/><path d="M9.5 3v18M3 7h4M3 12h4M3 17h4"/>',
  sort: '<path d="m3 8 4-4 4 4M7 4v16M21 16l-4 4-4-4M17 20V4"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>',
  'wifi-off': '<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69M19 12.86a10 10 0 0 0-2-1.52M2 8.82a15 15 0 0 1 4.18-2.64M22 8.82a15 15 0 0 0-11.29-3.76M2 2l20 20"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
  sparkle: '<path d="M11 3c.45 4.2 2.3 6.05 6.5 6.5-4.2.45-6.05 2.3-6.5 6.5-.45-4.2-2.3-6.05-6.5-6.5C8.7 9.05 10.55 7.2 11 3zM18.5 14.5c.2 1.75.95 2.5 2.7 2.7-1.75.2-2.5.95-2.7 2.7-.2-1.75-.95-2.5-2.7-2.7 1.75-.2 2.5-.95 2.7-2.7z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  card: '<rect x="5.5" y="2.5" width="13" height="19" rx="2"/><path d="M8.5 6h7v6.5h-7zM8.5 15.5h7M8.5 18.5h4"/>',
  box: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12M3.3 7l8.7 5 8.7-5M7.5 4.27l9 5.15"/>',
  pokeball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h6M15 12h6"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  award: '<circle cx="12" cy="8.5" r="6"/><path d="M15.48 13.39 17 22l-5-3-5 3 1.52-8.61"/>',
  swap: '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
  edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5zM15 5l4 4"/>',
  // triangles pleins des variations de prix (viewBox 0 0 10 10) : jamais les caractères ▲▼
  up: { vb: '0 0 10 10', body: '<path d="M5 1.5 9 8.5H1z" fill="currentColor" stroke="none"/>' },
  down: { vb: '0 0 10 10', body: '<path d="M5 8.5 1 1.5h8z" fill="currentColor" stroke="none"/>' },
};

export const NAMES = Object.keys(PATHS);

function spriteHTML() {
  const sym = Object.entries(PATHS).map(([n, p]) => {
    const vb = typeof p === 'string' ? '0 0 24 24' : p.vb;
    return `<symbol id="i-${n}" viewBox="${vb}">${typeof p === 'string' ? p : p.body}</symbol>`;
  }).join('');
  return `<svg id="cardex-icons" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden"><defs>${sym}</defs></svg>`;
}

// pose la planche une seule fois en tête de <body>
export function injectSprite(doc = document) {
  if (!doc.body || doc.getElementById('cardex-icons')) return;
  doc.body.insertAdjacentHTML('afterbegin', spriteHTML());
}
if (typeof document !== 'undefined') injectSprite();

// <svg class="i …"><use href="#i-nom"/></svg> (décoratif : aria-hidden ; le libellé est sur le bouton)
export function icon(name, { size = 24, cls = '' } = {}) {
  const s = Number(size) || 24;
  return raw(`<svg class="i${cls ? ` ${cls}` : ''}" width="${s}" height="${s}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`);
}
