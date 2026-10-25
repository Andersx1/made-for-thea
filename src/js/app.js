// App shell: top bar, tab navigation, keyboard shortcuts, menus, startup.
import { S, subscribe, commit, undo, redo, load, blankProject, save, garment } from './store.js';
import { renderMeasure } from './measure.js';
import { renderDesign } from './design.js';
import { renderPattern, editorKey } from './editor.js';
import { renderPrint } from './print-ui.js';
import { renderSteps } from './steps.js';
import { render3D } from './view3d.js';
import { renderLayout } from './layout-ui.js';
import { renderSketch } from './sketch.js';
import { renderTrace } from './trace-ui.js';
import { esc } from './render.js';
import * as io from './io.js';

// Line icons (24×24, stroked).
const ICON = {
  measure: '<path d="M3 15.5 15.5 3 21 8.5 8.5 21z"/><path d="m7 11.5 1.8 1.8M10 8.5l1.8 1.8M13 5.5l1.8 1.8"/>',
  design: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/>',
  pattern: '<path d="M4 20V4l16 16z"/><path d="M8 16v-4l4 4z"/>',
  view3d: '<circle cx="12" cy="4.5" r="2.2"/><path d="M8.5 21 9.5 13 7.5 10l1.8-2.5h5.4l1.8 2.5-2 3 1 8"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/>',
  steps: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5"/>',
  sketch: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.9 0-1.2-1-1.6-1-2.6 0-.9.8-1.5 1.8-1.5H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10" cy="7.2" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  trace: '<path d="M4 7h3l2-2.5h6L17 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  new: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 3v5h7V3M7 21v-7h10v7"/>',
};
export const icon = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
// Grouped in the order she works: plan it, make the pattern, then cut and sew.
const TABS = [
  ['measure', 'Measurements', renderMeasure, 'Start'],
  ['design', 'Design', renderDesign],
  ['pattern', 'Pattern', renderPattern, 'Pattern'],
  ['view3d', '3D preview', render3D],
  ['print', 'Print', renderPrint, 'Make it'],
  ['layout', 'Fabric layout', renderLayout],
  ['steps', 'Sewing steps', renderSteps],
  ['sketch', 'Sketchbook', renderSketch, 'Extras'],
  ['trace', 'Trace a pattern', renderTrace],
];
const $ = (s) => document.querySelector(s);
// Light or dark, remembered on this computer; until chosen, follows the system setting.
const dark = () => document.documentElement.dataset.theme === 'dark';
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.theme = t; } catch { /* not saved */ } }
try { document.documentElement.dataset.theme = localStorage.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch { /* light */ }

function renderTop() {
  const P = S.project, g = garment();
  $('#top').innerHTML = `<b class="brand"><img src="assets/icon.png" alt=""><span>Made for Thea</span></b>
    <input class="pname" data-f="pname" value="${esc(P.name)}" title="Project name">
    <span class="saved ${S.saved ? '' : 'dirty'}">${S.saved ? 'Saved' : 'Unsaved changes'}</span>
    <span class="grow"></span>
    <select data-f="garment" title="Garment">${P.garments.map((x) => `<option value="${x.id}" ${x === g ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__new">＋ New garment…</option></select>
    <span class="sep"></span>
    <span class="group"><button class="icon" data-a="undo" title="Undo (Ctrl/⌘+Z)">${icon('undo')}</button><button class="icon" data-a="redo" title="Redo (Ctrl/⌘+Shift+Z)">${icon('redo')}</button></span>
    <button class="icon" data-a="theme" title="${dark() ? 'Light mode' : 'Dark mode'}">${icon(dark() ? 'light' : 'dark')}</button>
    <select data-f="units" title="Units"><option value="metric">cm</option><option value="imperial" ${P.units === 'imperial' ? 'selected' : ''}>inches</option></select>
    <span class="sep"></span>
    <span class="group"><button data-a="newp" title="New project">${icon('new')}<span class="lbl">New</span></button><button data-a="open" title="Open a project (Ctrl/⌘+O)">${icon('open')}<span class="lbl">Open</span></button><button data-a="save" class="primary" title="Save (Ctrl/⌘+S)">${icon('save')}Save</button></span>`;
}
// The desktop app checks GitHub for a newer version once at startup, and again from the button.
let ver = null, update = null;
function renderNav() {
  $('#nav').innerHTML = TABS.map(([id, label, , grp]) => `${grp ? `<div class="grp">${grp}</div>` : ''}<button data-tab="${id}" class="${S.tab === id ? 'on' : ''}" title="${label}">${icon(id)}<span class="label">${label}</span></button>`).join('')
    + (ver ? `<div class="foot">Version ${esc(ver)}<button data-a="update" class="${update ? 'on' : ''}">${update ? `Update available: ${esc(update)}` : 'Check for updates'}</button></div>` : '');
}
async function checkUpdate(quiet) {
  try {
    const u = await io.checkUpdate();
    update = u.newer ? u.latest : null; renderNav();
    if (u.newer && !quiet && confirm(`Version ${u.latest} is available (you have ${u.current}).

Open the download page? On a Mac, download the .dmg and drag the app into Applications to replace this one. On Windows, run the Setup .exe.`)) io.openReleases();
    if (!u.newer && !quiet) alert(`You have the latest version (${u.current}).`);
  } catch { if (!quiet) alert("Couldn't check for updates. Check that you're online and try again."); }
}
let queued = false;
function renderAll() {
  if (queued) return;
  queued = true;
  setTimeout(() => { // after the browser moves focus (e.g. Tab), so focus can be restored to the same field
    queued = false;
    const af = document.activeElement?.dataset?.f;
    renderTop(); renderNav();
    const main = $('#main');
    main.className = `tab-${S.tab}`;
    TABS.find((t) => t[0] === S.tab)[2](main);
    if (af) { const el = document.querySelector(`[data-f="${af}"]`); if (el && el !== document.activeElement) { el.focus(); el.select?.(); } }
    document.title = `${S.project.name}${S.saved ? '' : ' •'} — Made for Thea`;
  }, 0);
}

async function openFile(r) {
  if (!r) return;
  try { const p = JSON.parse(r.text); if (!Array.isArray(p.garments)) throw 0; load(p, r.path); }
  catch { alert("That file doesn't look like a Made for Thea project."); }
}
function newProject() { if (S.saved || confirm('Start a new project? Unsaved changes to this one will be lost.')) load(blankProject()); }
const ACT = { undo, redo, open: async () => openFile(await io.openProject()), save: () => save(), saveAs: () => save(true), newp: newProject, new: newProject, theme: () => { setTheme(dark() ? 'light' : 'dark'); renderAll(); } };

$('#top').addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) ACT[a](); });
$('#top').addEventListener('change', (e) => {
  const f = e.target.dataset.f, P = S.project;
  if (f === 'pname') P.name = e.target.value || P.name;
  if (f === 'units') P.units = e.target.value;
  if (f === 'garment') { if (e.target.value === '__new') { S.choosing = true; S.tab = 'design'; } else { P.active = e.target.value; S.choosing = false; } }
  commit();
});
$('#nav').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) { S.tab = t; renderAll(); } if (e.target.closest('[data-a="update"]')) checkUpdate(false); });
addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select'), mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); save(e.shiftKey); return; }
  if (mod && k === 'o') { e.preventDefault(); ACT.open(); return; }
  if (typing) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (S.tab === 'pattern' && editorKey(e)) e.preventDefault();
});
addEventListener('resize', () => { if (S.tab === 'pattern') renderAll(); });
io.onMenu((cmd) => ACT[cmd]?.());
io.onOpenPath(openFile);
subscribe(renderAll);

if (io.isApp) io.version().then((v) => { ver = v; renderNav(); checkUpdate(true); });
// Start: a file the app was opened with, else the autosave, else a fresh project.
(async () => {
  const f = await io.startupFile();
  if (f) return openFile(f);
  try { const a = JSON.parse(await io.autosaveRead()); if (a?.project?.garments) { load(a.project, a.path); S.saved = true; return; } } catch { /* no autosave yet */ }
  load(blankProject());
})();
