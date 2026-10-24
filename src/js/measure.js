// Measurements tab: profiles (Me, Mum, a friend…) with every body measurement and how to take it.
import { S, commit, garment, regenAll, uid } from './store.js';
import { FIELDS, checks, defaults } from './measure-data.js';
import { TYPES } from './garments/index.js';
import { fmt, parseLen, isMetric } from './units.js';
import { esc } from './render.js';

export function renderMeasure(el) {
  const P = S.project, prof = P.profiles.find((p) => p.id === S.profile) || P.profiles[0];
  S.profile = prof.id;
  const g = garment(), needs = new Set(g && g.profileId === prof.id ? TYPES[g.type].needs : []);
  const groups = [...new Set(FIELDS.map((f) => f[0]))];
  const warn = checks(prof.m);
  el.innerHTML = `<div class="measure">
    <div class="mhead">
      <label>Measurements for <select data-f="profile">${P.profiles.map((p) => `<option value="${p.id}" ${p.id === prof.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <button data-a="new">＋ New person</button><button data-a="rename">Rename</button><button data-a="dup">Duplicate</button>
      ${P.profiles.length > 1 ? '<button data-a="del" class="danger">Delete</button>' : ''}
    </div>
    <p class="tip">Measure over underwear or close-fitting clothes, with the tape snug but not tight. Type numbers in ${isMetric() ? 'cm' : 'inches'}, or add a unit like <b>30 cm</b> or <b>12 ½"</b>.
      ${needs.size ? `<span class="needkey">Highlighted</span> = used by your ${esc(g.name.toLowerCase())}.` : ''}</p>
    ${warn.length ? `<div class="warn">${warn.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
    ${groups.map((gr) => `<section><h3>${gr}</h3><div class="mgrid">${FIELDS.filter((f) => f[0] === gr).map(([, k, label, tip]) => `
      <label class="mfield ${needs.has(k) ? 'need' : ''}"><span>${label}</span><input data-f="m:${k}" value="${esc(fmt(prof.m[k]))}"><small>${esc(tip)}</small></label>`).join('')}</div></section>`).join('')}
    <div class="btns"><button data-a="reset">Reset ${esc(prof.name)} to average sizes</button></div>
  </div>`;
  el.onchange = (e) => {
    const f = e.target.dataset.f;
    if (f === 'profile') { S.profile = e.target.value; renderMeasure(el); return; }
    if (!f?.startsWith('m:')) return;
    const v = parseLen(e.target.value);
    if (!(v > 0)) { e.target.value = fmt(prof.m[f.slice(2)]); return; }
    prof.m[f.slice(2)] = v;
    regenAll(prof.id); commit();
  };
  el.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'new' || a === 'dup') {
      const name = prompt('Name for this person:', a === 'dup' ? `${prof.name} copy` : '');
      if (!name) return;
      const np = { id: uid(), name, m: a === 'dup' ? { ...prof.m } : defaults() };
      P.profiles.push(np); S.profile = np.id; commit();
    }
    if (a === 'rename') { const name = prompt('New name:', prof.name); if (name) { prof.name = name; commit(); } }
    if (a === 'del' && confirm(`Delete ${prof.name}'s measurements? Garments using them will switch to ${P.profiles.find((p) => p !== prof).name}.`)) {
      P.profiles = P.profiles.filter((p) => p !== prof);
      for (const gm of P.garments) if (gm.profileId === prof.id) gm.profileId = P.profiles[0].id;
      S.profile = P.profiles[0].id; regenAll(); commit();
    }
    if (a === 'reset' && confirm('Replace all measurements with average sizes?')) { prof.m = defaults(); regenAll(prof.id); commit(); }
  };
}
