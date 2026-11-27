// Image de la fiche : inclinaison ±8° et reflet qui suivent le doigt ou la souris, calque de la finition qui glisse
// (FINAL-design §7). Au repos : immobile, aucune animation en boucle. Mouvement réduit : rien ne bouge.
const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const MAX = 8;                                   // degrés
const clamp = v => Math.min(1, Math.max(0, v));

// el = l'élément de la carte (.cp-card) ; renvoie de quoi tout retirer.
// onTap() : un appui sans glisser (agrandir l'image) ; un glisser ne déclenche pas le clic qui suit.
export function bindTilt(el, onTap) {
  if (!el) return () => {};
  let raf = 0, pt = null, down = null, dragged = false;
  const st = el.style;
  const apply = () => {
    raf = 0;
    if (!pt) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const x = clamp((pt.x - r.left) / r.width), y = clamp((pt.y - r.top) / r.height);
    st.setProperty('--ry', `${((x - 0.5) * 2 * MAX).toFixed(2)}deg`);
    st.setProperty('--rx', `${((0.5 - y) * 2 * MAX).toFixed(2)}deg`);
    st.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    st.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    st.setProperty('--px', `${(100 - x * 100).toFixed(1)}%`);
    st.setProperty('--py', `${(100 - y * 100).toFixed(1)}%`);
    st.setProperty('--shine', '1');
  };
  const rest = () => {
    pt = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    for (const p of ['--rx', '--ry', '--mx', '--my', '--px', '--py', '--shine']) st.removeProperty(p);
  };
  const move = e => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) dragged = true;
    if (reduce.matches) return;
    pt = { x: e.clientX, y: e.clientY };
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const press = e => { down = { x: e.clientX, y: e.clientY }; dragged = false; move(e); };
  const release = e => { down = null; if (e.pointerType !== 'mouse') rest(); };
  const leave = () => { down = null; rest(); };
  const click = e => {
    if (dragged) { dragged = false; e.preventDefault(); return; }
    onTap?.(e);
  };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', leave);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('click', click);
  return () => {
    rest();
    el.removeEventListener('pointerdown', press);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', release);
    el.removeEventListener('pointercancel', leave);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('click', click);
  };
}

// une seule passe du reflet sur le calque de la finition (choix d'une autre finition)
export function sheen(fx) {
  if (!fx || reduce.matches) return;
  fx.classList.remove('sheen-now');
  void fx.offsetWidth;                            // relance l'animation
  fx.classList.add('sheen-now');
  fx.addEventListener('animationend', () => fx.classList.remove('sheen-now'), { once: true });
}
