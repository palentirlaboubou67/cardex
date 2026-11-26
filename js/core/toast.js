// Toast : un message court en bas de l'écran, au-dessus de la barre d'onglets, avec une action possible (« Annuler »).
// Un seul à la fois ; lu par les lecteurs d'écran (région aria-live). ms = 0 : toast persistant (« Nouvelle version
// disponible · Recharger ») ; un toast passager le recouvre puis il revient, jusqu'à son action ou close().
let region = null, timer = 0, current = null, sticky = null;

function host() {
  // une feuille modale ouverte rend le reste de la page inerte : le toast s'affiche alors dans la feuille
  const dlg = [...document.querySelectorAll('dialog[open]')].pop();
  return dlg || document.body;
}

function ensureRegion() {
  if (!region) {
    region = document.getElementById('toasts') || Object.assign(document.createElement('div'), { id: 'toasts' });
    region.className = 'toasts';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    // quand la feuille se ferme, le toast revient dans la page (il reste visible)
    document.addEventListener('close', e => {
      if (region && e.target instanceof HTMLDialogElement && e.target.contains(region)) document.body.appendChild(region);
    }, true);
  }
  const h = host();
  if (region.parentElement !== h) h.appendChild(region);
  return region;
}

function build(message, action, onDone) {
  const el = document.createElement('div');
  el.className = `toast${action ? ' has-act' : ''}`;
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = message;
  el.appendChild(msg);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'act';
    b.textContent = action;
    b.addEventListener('click', onDone);
    el.appendChild(b);
  }
  return el;
}

function dismiss(el = current) {
  if (!el) return;
  if (el === current) { clearTimeout(timer); current = null; }
  el.classList.add('out');
  let gone = false;
  const done = () => {
    if (gone) return;
    gone = true;
    el.remove();
    if (!current && sticky && !sticky.el.isConnected) showSticky();   // le toast persistant revient
  };
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 300);
}

function showSticky() {
  const r = ensureRegion();
  r.appendChild(sticky.el);
  sticky.el.classList.remove('out');
  current = sticky.el;
}

export function toast(message, { action, onAction, ms = 4000 } = {}) {
  const r = ensureRegion();
  if (current) { clearTimeout(timer); current.remove(); current = null; }   // un toast persistant reviendra ensuite
  const keep = ms === 0;
  let el = null;
  const close = () => {
    if (sticky?.el === el) sticky = null;
    dismiss(el);
  };
  el = build(message, action, () => { close(); try { onAction?.(); } catch (e) { console.error(e); } });
  if (keep) sticky = { el };
  r.appendChild(el);
  current = el;
  if (!keep) timer = setTimeout(() => dismiss(el), Math.max(ms, action ? 5000 : 2500));   // une action laisse le temps de la lire
  return { el, close };
}

export const hideToast = () => { if (current && sticky?.el === current) sticky = null; dismiss(); };
