// Collection › Succès (W-L) : « 7 / 18 succès » + progression, puis les 5 groupes en listes groupées
// (médaille, titre, explication, progression chiffrée ; coche et date quand c'est débloqué).
import { html, setHTML } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { num, dateFr } from '../../core/format.js';
import * as ach from '../../features/achievements.js';

const prog = ([have, need], unit) => {
  const h = Math.min(have, need);
  if (unit === '%') return `${h} %`;
  if (unit === '€') return `${num(h)} € / ${num(need)} €`;
  return `${num(h)} / ${num(need)}`;
};

function rowHTML(a) {
  const [have, need] = a.progress;
  const pc = need ? Math.min(100, (have / need) * 100) : 0;
  const when = a.done ? (a.at ? `Débloqué le ${dateFr(a.at)}` : 'Débloqué') : '';
  return html`<div class="row ach${a.done ? ' done' : ''}" data-ach="${a.id}">
    <span class="medal" aria-hidden="true">${icon(a.done ? 'star-fill' : 'award')}</span>
    <span class="body"><span class="t">${a.title}</span><span class="s"><span>${a.desc}</span></span>${
      a.done ? html`<span class="s"><span class="ok">${when}</span></span>`
        : html`<span class="s ach-prog"><span class="progress" aria-hidden="true"><i style="width:${pc.toFixed(1)}%"></i></span><span class="num">${prog(a.progress, a.unit)}</span></span>`}</span>${
      a.done ? html`<span class="end ach-ok" aria-hidden="true">${icon('check')}</span>` : ''}</div>`;   // « Débloqué » est déjà écrit
}

export function create(box, api) {
  box.innerHTML = '<div class="col-achhead"></div><div class="ach-groups" data-content></div>';
  const head = box.querySelector('.col-achhead'), groups = box.querySelector('.ach-groups');
  let rendered = false, dirty = false, loaded = false, timer = 0;

  function render() {
    dirty = false;
    rendered = true;
    const list = ach.list();
    const done = list.filter(a => a.done).length, tot = list.length;
    const pc = tot ? (done / tot) * 100 : 0;
    setHTML(head, html`<div class="prog${done === tot ? ' done' : ''}"><b class="num">${done} / ${tot}</b><span>succès</span><span class="progress wide${done === tot ? ' done' : ''}" aria-hidden="true"><i style="width:${pc.toFixed(1)}%"></i></span><span class="pc num">${Math.round(pc)} %</span></div>`);
    setHTML(groups, html`${ach.GROUPS.map(g => {
      const items = list.filter(a => a.group === g);
      return items.length ? html`<section class="ach-group" aria-label="${g}"><h2 class="sect">${g}</h2><div class="group">${items.map(rowHTML)}</div></section>` : '';
    })}`);
    if (!loaded) groups.setAttribute('aria-busy', 'true'); else groups.removeAttribute('aria-busy');
  }

  // succès débloqué ou remis à zéro, carte ajoutée : la liste (18 lignes) est refaite, un peu après (calcul groupé)
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => { if (api.shown()) render(); else dirty = true; }, 250); };
  ach.on(() => { if (rendered) soon(); });

  function onChange(evs, current) {
    if (!rendered) return;
    if (!current) { dirty = true; return; }
    if (evs.some(e => e.type === 'qty' || e.type === 'reload')) soon();
  }

  async function show() {
    if (!loaded) {
      // séries, Pokédex, decks et cotes : chiffres complets ; au-delà de 1,2 s, ce qui est déjà là, puis la suite
      const all = ach.ready().then(() => { loaded = true; ach.check(); if (api.shown()) render(); else dirty = true; });
      await Promise.race([all, new Promise(r => setTimeout(r, 1200))]);
      if (!rendered) render();
    } else if (!rendered || dirty) render();
  }

  return { show, resume() { if (dirty) render(); }, onChange, onPrices() { if (rendered) soon(); } };
}
