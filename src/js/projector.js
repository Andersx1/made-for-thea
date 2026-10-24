// Projector mode: full-screen, white lines on black, at a calibrated true scale, so a projector
// above the cutting table can draw the pattern straight onto fabric (no printing or taping).
// Calibration is per computer/projector, so it's kept in local storage, not in the project.
import { garment } from './store.js';
import { pieceSVG, placedBox } from './render.js';
import { fmt, parseLen } from './units.js';

const KEY = 'clothes-projector';
const load = () => { try { return { pxPerCm: 37.8, mirror: false, x: 0, y: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { pxPerCm: 37.8, mirror: false, x: 0, y: 0 }; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked */ } };

export function openProjector() {
  const g = garment();
  if (!g?.pieces.length) return;
  const st = load();
  let calib = false;
  const el = document.createElement('div');
  el.className = 'projector';
  el.innerHTML = `<svg></svg><div class="pbar">
    <b>Projector</b><span class="ptip">Drag or use arrow keys to move · C calibrate · M mirror · Esc to exit</span>
    <span class="pcal" hidden>The square should be exactly 10 cm (4"). Measure it on your table: <input data-f="measured" size="7" placeholder="${fmt(10)}"> <button data-a="apply">Apply</button> or fine-tune with + and −</span>
    <button data-a="calib">Calibrate</button><button data-a="mirror">Mirror</button><button data-a="close">Exit</button></div>`;
  document.body.append(el);
  const svg = el.querySelector('svg');
  const boxes = g.pieces.map(placedBox), x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const art = g.pieces.map((p) => `<g transform="translate(${p.pos.x - x0},${p.pos.y - y0})">${pieceSVG(p, { print: true })}</g>`).join('');
  function draw() {
    const k = st.pxPerCm, W = innerWidth / k, H = innerHeight / k;
    const grid = calib ? `<g stroke="#000" stroke-width="${1.5 / k}" fill="none">${Array.from({ length: Math.ceil(W / 10) + 1 }, (_, i) => `<line x1="${i * 10}" y1="0" x2="${i * 10}" y2="${H}"/>`).join('')}${Array.from({ length: Math.ceil(H / 10) + 1 }, (_, i) => `<line x1="0" y1="${i * 10}" x2="${W}" y2="${i * 10}"/>`).join('')}
      <rect x="${W / 2 - 5}" y="${H / 2 - 5}" width="10" height="10" stroke-width="${4 / k}"/></g>` : '';
    // pieceSVG print mode draws black lines; the CSS filter inverts them to white on black.
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = calib ? grid : `<g transform="${st.mirror ? `translate(${W},0) scale(-1,1) ` : ''}translate(${st.x},${st.y})">${art}</g>`;
    el.querySelector('.pcal').hidden = !calib; el.querySelector('.ptip').hidden = calib;
  }
  const close = () => { save(st); removeEventListener('keydown', key, true); removeEventListener('resize', draw); if (document.fullscreenElement) document.exitFullscreen(); el.remove(); };
  const key = (e) => {
    e.stopPropagation();
    const step = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (e.target.matches('input')) { if (e.key === 'Enter') el.querySelector('[data-a="apply"]').click(); return; }
    if (mv) { st.x += mv[0] * (st.mirror ? -1 : 1); st.y += mv[1]; e.preventDefault(); }
    else if (e.key === 'Escape') return close();
    else if (/^c$/i.test(e.key)) calib = !calib;
    else if (/^m$/i.test(e.key)) st.mirror = !st.mirror;
    else if (e.key === '+' || e.key === '=') st.pxPerCm *= 1.002;
    else if (e.key === '-') st.pxPerCm /= 1.002;
    else return;
    save(st); draw();
  };
  el.onclick = (e) => {
    const a = e.target.dataset.a;
    if (a === 'close') close();
    if (a === 'calib') { calib = !calib; draw(); }
    if (a === 'mirror') { st.mirror = !st.mirror; save(st); draw(); }
    if (a === 'apply') { const v = parseLen(el.querySelector('[data-f="measured"]').value); if (v > 0) { st.pxPerCm *= 10 / v; save(st); calib = false; draw(); } }
  };
  let drag = null;
  svg.onpointerdown = (e) => { svg.setPointerCapture(e.pointerId); drag = { sx: e.clientX, sy: e.clientY, x: st.x, y: st.y }; };
  svg.onpointermove = (e) => { if (!drag) return; st.x = drag.x + (e.clientX - drag.sx) / st.pxPerCm * (st.mirror ? -1 : 1); st.y = drag.y + (e.clientY - drag.sy) / st.pxPerCm; draw(); };
  svg.onpointerup = () => { drag = null; save(st); };
  addEventListener('keydown', key, true);
  addEventListener('resize', draw);
  el.requestFullscreen?.().catch(() => {});
  draw();
}
