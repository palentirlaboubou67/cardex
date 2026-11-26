// Toast : un message court en bas de l'écran, au-dessus de la barre d'onglets, avec une action possible (« Annuler »).
// Un seul à la fois ; lu par les lecteurs d'écran (région aria-live). ms = 0 : reste jusqu'à l'action ou au suivant.
let region = null, timer = 0, current = null;

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

function dismiss(el = current) {
  if (!el) return;
  clearTimeout(timer);
  if (el === current) current = null;
  el.classList.add('out');
  const done = () => el.remove();
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 300);
}

export function toast(message, { action, onAction, ms = 4000 } = {}) {
  const r = ensureRegion();
  if (current) { clearTimeout(timer); current.remove(); current = null; }
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
    b.addEventListener('click', () => { dismiss(el); try { onAction?.(); } catch (e) { console.error(e); } });
    el.appendChild(b);
  }
  r.appendChild(el);
  current = el;
  const wait = ms === 0 ? 0 : Math.max(ms, action ? 5000 : 2500);   // une action laisse le temps de la lire
  if (wait) timer = setTimeout(() => dismiss(el), wait);
  return { el, close: () => dismiss(el) };
}

export const hideToast = () => dismiss();
