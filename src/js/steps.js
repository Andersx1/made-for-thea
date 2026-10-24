// Sewing steps tab: construction order for the current garment (tick off as you go),
// your own extra steps and notes, plus the notions and fabric suggestions.
import { S, commit, garment, profileOf } from './store.js';
import { TYPES } from './garments/index.js';
import { esc } from './render.js';

export function stepsFor(g) { return TYPES[g.type].steps(profileOf(g).m, g.options); }

export function renderSteps(el) {
  const g = garment();
  if (!g) { el.innerHTML = '<div class="empty">Create a garment in <b>Design</b> first.</div>'; return; }
  const { steps, notions, fabrics } = stepsFor(g);
  const all = [...steps, ...g.custom], done = all.filter((s) => g.done[s]).length;
  el.innerHTML = `<div class="steps">
    <section>
      <h2>${esc(g.name)}: sewing steps</h2>
      <div class="progress"><i style="width:${all.length ? done / all.length * 100 : 0}%"></i></div><p class="tip">${done} of ${all.length} done</p>
      <ol class="checklist">${all.map((s, i) => `<li class="${g.done[s] ? 'done' : ''}"><label><input type="checkbox" data-step="${i}" ${g.done[s] ? 'checked' : ''}> <span>${esc(s)}</span></label>${i >= steps.length ? `<button class="x" data-del="${i - steps.length}" title="Remove">×</button>` : ''}</li>`).join('')}</ol>
      <div class="inline"><input data-f="newstep" placeholder="Add your own step…"><button data-a="add">Add</button></div>
      <h3>Notes</h3><textarea data-f="notes" rows="5" placeholder="Fabric used, changes you made, what to do differently next time…">${esc(g.notes)}</textarea>
    </section>
    <aside>
      <h3>You'll need</h3><ul>${notions.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      ${fabrics.length ? `<h3>Good fabrics</h3><ul>${fabrics.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p class="tip">Steps update when you change the design. Ticks are kept for steps that stay the same.</p>
    </aside></div>`;
  el.onchange = (e) => {
    const t = e.target;
    if (t.dataset.step != null) { const s = all[+t.dataset.step]; if (t.checked) g.done[s] = true; else delete g.done[s]; commit(); }
    if (t.dataset.f === 'notes') { g.notes = t.value; commit(); }
  };
  el.onclick = (e) => {
    if (e.target.dataset.del != null) { g.custom.splice(+e.target.dataset.del, 1); commit(); }
    if (e.target.dataset.a === 'add') { const i = el.querySelector('[data-f="newstep"]'); if (i.value.trim()) { g.custom.push(i.value.trim()); commit(); } }
  };
  el.onkeydown = (e) => { if (e.key === 'Enter' && e.target.dataset.f === 'newstep') el.querySelector('[data-a="add"]').click(); };
}
