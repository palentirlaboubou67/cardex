// Tâches de fond quand le navigateur est libre (Safari n'a pas requestIdleCallback : repli sur setTimeout).
const ric = globalThis.requestIdleCallback;

export function whenIdle(fn, { timeout = 3000 } = {}) {
  const run = () => { try { fn(); } catch (e) { console.error(e); } };
  if (ric) { const id = ric(run, { timeout }); return () => cancelIdleCallback(id); }
  const id = setTimeout(run, 250);
  return () => clearTimeout(id);
}

// laisse la main au navigateur (entre deux lots de rendu)
export const yieldToMain = () => (globalThis.scheduler?.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0)));

// Attend que l'image suivante soit rendue (requestAnimationFrame, puis une tâche) : ce qui suit a sa propre tâche et sa
// propre mise en page. (scheduler.yield reprend AVANT le rendu : deux lots finiraient mis en page d'un coup.)
// Onglet caché : pas d'image, une simple tâche ; filet de 100 ms si l'image ne vient pas.
export const nextPaint = () => new Promise(res => {
  if (typeof document === 'undefined' || document.hidden) { setTimeout(res, 0); return; }
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
  requestAnimationFrame(go);
  setTimeout(go, 100);
});
