// Design tab: pick a garment type, then set its style options. The pattern re-drafts live.
import { S, commit, garment, profileOf, regen, addGarment, deleteGarment } from './store.js';
import { TYPES, COMING, PRESETS, visible, optionChoices } from './garments/index.js';
import { LABEL } from './measure-data.js';
import { pieceSVG, placedBox, esc, cutText } from './render.js';
import { fmt, parseLen } from './units.js';

function chooser() {
  const card = (id, T) => `<button class="card" data-new="${id}"><span class="ic">${T.icon}</span><b>${esc(T.name)}</b><small>${esc(T.blurb)}</small></button>`;
  return `<div class="chooser"><h2>What would you like to make?</h2>
    <div class="cards">${Object.entries(TYPES).map(([id, T]) => card(id, T)).join('')}
    ${PRESETS.map(([id, , ic, n, b]) => `<button class="card" data-preset="${id}"><span class="ic">${ic}</span><b>${esc(n)}</b><small>${esc(b)}</small></button>`).join('')}
    ${COMING.map(([ic, n, b]) => `<div class="card soon"><span class="ic">${ic}</span><b>${esc(n)}</b><small>${esc(b)}</small><em>Coming in an update</em></div>`).join('')}</div>
    ${S.project.garments.length ? '<p><button data-a="cancel">Cancel</button></p>' : ''}</div>`;
}

function optionRow(op, g) {
  const v = g.options[op.key], f = `o:${op.key}`;
  let inp;
  if (op.type === 'select') inp = `<select data-f="${f}">${optionChoices(op, g.options).map(([val, lab]) => `<option value="${val}" ${val == v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  else if (op.type === 'check') inp = `<input type="checkbox" data-f="${f}" ${v ? 'checked' : ''}>`;
  else if (op.type === 'num') inp = `<input type="number" min="1" data-f="${f}" value="${v}">`;
  else inp = `<input data-f="${f}" value="${esc(fmt(v))}">`;
  return `<label class="row"><span>${esc(op.label)}</span>${inp}</label>`;
}

function preview(g) {
  if (!g.pieces.length) return '';
  const bs = g.pieces.map(placedBox), x0 = Math.min(...bs.map((b) => b.x)) - 3, y0 = Math.min(...bs.map((b) => b.y)) - 3;
  const w = Math.max(...bs.map((b) => b.x + b.w)) + 3 - x0, h = Math.max(...bs.map((b) => b.y + b.h)) + 3 - y0, k = Math.max(w, h) / 560;
  return `<svg class="preview" viewBox="${x0} ${y0} ${w} ${h}">${g.pieces.map((p) => `<g transform="translate(${p.pos.x},${p.pos.y})">${pieceSVG(p, { k })}</g>`).join('')}</svg>`;
}

export function renderDesign(el) {
  const g = garment();
  if (S.choosing || !g) el.innerHTML = chooser();
  else {
    const T = TYPES[g.type], prof = profileOf(g), m = prof.m;
    const missing = T.needs.filter((k) => !(m[k] > 0));
    el.innerHTML = `<div class="design">
      <aside class="opts">
        <label class="row"><span>Name</span><input data-f="gname" value="${esc(g.name)}"></label>
        ${T.needs.length ? `<label class="row"><span>Made for</span><select data-f="profile">${S.project.profiles.map((p) => `<option value="${p.id}" ${p.id === prof.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
        <h4>${esc(T.name)} options</h4>
        ${T.options.filter((op) => visible(op, g.options)).map((op) => optionRow(op, g)).join('')}
        <div class="btns"><button data-a="go-pattern" class="primary">Edit pattern →</button><button data-a="go-print">Print</button><button data-a="del" class="danger">Delete garment</button></div>
      </aside>
      <section class="pv">
        ${missing.length ? `<div class="warn">⚠ Missing measurements: ${missing.map((k) => esc(LABEL[k])).join(', ')}. <a data-a="go-measure">Add them</a></div>` : ''}
        ${(g.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}
        ${g.pieces.some((p) => p.edited && !p.custom) ? '<div class="note">Some pieces were edited by hand in the pattern editor and are kept as they are. Reset them there to follow these options again.</div>' : ''}
        ${preview(g)}
        <table class="pieces"><tr><th>Piece</th><th>Cut</th></tr>${g.pieces.map((p) => `<tr><td>${esc(p.name)}${p.edited ? ' <small>(edited)</small>' : ''}</td><td>${cutText(p)}</td></tr>`).join('')}</table>
        ${T.needs.length ? `<p class="tip">Drafted from ${esc(prof.name)}'s measurements with standard ease. Always make a quick test version (toile) in cheap fabric before cutting your good fabric.</p>` : ''}
      </section></div>`;
  }
  el.onclick = (e) => {
    const n = e.target.closest('[data-new]')?.dataset.new;
    if (n) { addGarment(n); if (n === 'traced' || n === 'custom') { S.tab = n === 'traced' ? 'trace' : 'pattern'; commit(); } return; }
    const pr = PRESETS.find((x) => x[0] === e.target.closest('[data-preset]')?.dataset.preset);
    if (pr) return addGarment(pr[1], pr[5]);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') { S.choosing = false; commit(); }
    if (a?.startsWith('go-')) { S.tab = a.slice(3); commit(); }
    if (a === 'del' && confirm(`Delete "${g.name}" and its pattern?`)) deleteGarment(g.id);
  };
  el.onchange = (e) => {
    const f = e.target.dataset.f;
    if (!g || !f) return;
    if (f === 'gname') { g.name = e.target.value || g.name; g.renamed = true; }
    if (f === 'profile') { g.profileId = e.target.value; regen(g); }
    if (f.startsWith('o:')) {
      const op = TYPES[g.type].options.find((o) => o.key === f.slice(2));
      let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (op.type === 'len') { v = parseLen(v); if (!(v > 0)) { e.target.value = fmt(g.options[op.key]); return; } }
      if (op.type === 'num') v = Math.max(1, Math.round(+v) || 1);
      g.options[op.key] = v;
      regen(g);
    }
    commit();
  };
}
