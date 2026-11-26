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
