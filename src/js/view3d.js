// 3D view: the garment's own pattern pieces (hand edits included) are sewn together along their
// seams and draped by a cloth simulation on a realistic body shaped to the measurement profile.
import * as THREE from '../../node_modules/three/build/three.module.js';
import { S, commit, garment, profileOf } from './store.js';
import { esc } from './render.js';
import { fmt } from './units.js';
import { makeBody } from './sim/body.js';
import { buildSDF, vertexNormals } from './sim/sdf.js';
import { assemble, bandMesh, simType } from './sim/garment.js';
import { makeSim, FABRICS } from './sim/solver.js';

let V = null; // { renderer, scene, camera, root, cam, key, look, bodyKey }
let run = null; // the drape in progress: { key, sim, sys, refresh }
let msgEl = null;
const setMsg = (t) => { if (msgEl) { msgEl.hidden = !t; msgEl.textContent = t; } };
const bodies = new Map(); // measurements → { body, F }
const drapes = new Map(); // garment state → finished cloth positions
const defaultFabric = (type) => (type === 'jeans' || type === 'jacket' ? 'denim' : type === 'trousers' ? 'linen' : 'cotton');

function bodyFor(m) {
  const k = JSON.stringify(m);
  if (!bodies.has(k)) {
    const body = makeBody(m);
    bodies.set(k, { k, body, F: buildSDF(body.pos, body.tris, { pads: body.pads }) });
    if (bodies.size > 3) bodies.delete(bodies.keys().next().value);
  }
  return bodies.get(k);
}
// Everything that changes the drape (not colour or photo, which only repaint).
const drapeKey = (g) => JSON.stringify([g.type, g.options, g.pieces.map((p) => [p.key, p.custom, p.role, p.nodes, p.segs, p.marks, p.cut, p.turns, p.flipped]), profileOf(g).m, g.fabric.kind]);

// ---------- scene ----------
function ensureRenderer() {
  if (V) return V;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf3f1f5);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb3aabb, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(120, 260, 220); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -100, right: 100, top: 200, bottom: -10, near: 10, far: 700 }); key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005;
  const rim = new THREE.DirectionalLight(0xfff1e0, 0.6); rim.position.set(-200, 150, -150);
  scene.add(key, rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ color: 0xebe8ee, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(30, 1, 5, 3000);
  const root = new THREE.Group(), bodyRoot = new THREE.Group(); scene.add(root, bodyRoot);
  V = { renderer, scene, camera, root, bodyRoot, floor, cam: { theta: 0.35, phi: 1.45, dist: 330, ty: 110 }, key: '', bodyKey: '', type: '' };
  return V;
}
function placeCamera() {
  const { camera, cam } = V;
  camera.position.set(cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta), cam.ty + cam.dist * Math.cos(cam.phi), cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta));
  camera.lookAt(0, cam.ty, 0);
}
function draw() { if (V && V.renderer.domElement.isConnected) { placeCamera(); V.renderer.render(V.scene, V.camera); } }

function showBody(B) {
  if (V.bodyKey === B.k) return;
  V.bodyKey = B.k; V.bodyRoot.clear();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(B.body.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(vertexNormals(B.body.pos, B.body.tris), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(B.body.tris), 1));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd9ccc4, roughness: 0.75 }));
  mesh.castShadow = mesh.receiveShadow = true;
  V.bodyRoot.add(mesh);
}

function clothMaterial(fab) {
  const mat = new THREE.MeshStandardMaterial({ color: fab.image ? '#ffffff' : fab.color, roughness: fab.kind === 'chiffon' || fab.kind === 'rayon' ? 0.6 : 0.9, side: THREE.DoubleSide });
  if (fab.image) {
    const t = new THREE.TextureLoader().load(fab.image, () => draw());
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / (fab.scale || 20), 1 / (fab.scale || 20)); // the cloth's uv is in pattern cm
    mat.map = t;
  }
  return mat;
}

// Build the cloth meshes for a garment and start (or reuse) its drape.
function build(g) {
  const m = profileOf(g).m, B = bodyFor(m), key = drapeKey(g);
  showBody(B);
  V.root.clear(); run = null;
  let sys;
  V.short = '';
  try { sys = assemble(g, m, B.body, B.F); } catch (e) { console.error(e); setMsg('This pattern couldn\'t be sewn up in 3D. If you edited a piece a lot, try resetting it.'); return; }
  if (!sys) { setMsg('None of these pieces can be draped in 3D.'); return; }
  V.short = sys.short.length ? `<div class="warn"><b>Too small to fit ${esc(profileOf(g).name)}</b>${sys.short.map((s) => `<br>At the ${s.where} your pieces go ${esc(fmt(s.cloth))} round, but the measurement is ${esc(fmt(s.body))}. Make them about ${esc(fmt(s.body - s.cloth + 4))} bigger round in total.`).join('')}<br><small>Too-small cloth can't sit on the body, so it may not show properly. Use the body guide in Pattern: each line is the width one front or back piece needs when you cut 2, plus a little ease.</small></div>` : '';
  const sh = document.querySelector('.v3d [data-short]'); if (sh) sh.innerHTML = V.short;
  const mat = clothMaterial(g.fabric), parts = [];
  for (const I of sys.inst) {
    const n = I.pc.mesh.pts.length, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sys.x.subarray(I.base * 3, (I.base + n) * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(sys.uv.subarray(I.base * 2, (I.base + n) * 2), 2));
    geo.setIndex(I.pc.mesh.tris.flat());
    parts.push(geo);
  }
  const bands = sys.bands.map((b) => {
    const M = bandMesh(b), geo = new THREE.BufferGeometry(), pos = new Float32Array(b.verts.length * M.rows * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(M.uv, 2)); geo.setIndex(M.index);
    return { M, geo, pos };
  });
  for (const geo of [...parts, ...bands.map((b) => b.geo)]) { const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true; V.root.add(mesh); }
  const refresh = () => {
    for (const geo of parts) { geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); }
    for (const b of bands) { b.M.update(sys.x, b.pos); b.geo.attributes.position.needsUpdate = true; b.geo.attributes.uv.needsUpdate = true; b.geo.computeVertexNormals(); }
  };
  if (V.type !== g.type) { // frame the garment
    V.type = g.type;
    V.cam.ty = { trousers: 72, jeans: 72, skirt: 82, dress: 100, top: 112, jacket: 112 }[g.type] ?? 100;
    V.cam.dist = g.type === 'trousers' || g.type === 'jeans' || g.type === 'dress' ? 380 : 300;
  }
  const done = drapes.get(key);
  if (done && done.length === sys.x.length) { sys.x.set(done); refresh(); setMsg(''); return; }
  const sim = makeSim(sys, B.F, FABRICS[g.fabric.kind] || FABRICS.cotton);
  run = { key, sim, sys, refresh };
  refresh();
  const tick = () => {
    if (!run || run.key !== key) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 28 && !sim.done) sim.frame();
    refresh(); draw();
    if (sim.done) { drapes.set(key, Float32Array.from(sys.x)); if (drapes.size > 20) drapes.delete(drapes.keys().next().value); run = null; setMsg(''); return; }
    setMsg(`Sewing and draping… ${Math.round(sim.t / sim.settle * 100)}%`);
    setTimeout(tick, 0); // not requestAnimationFrame: keeps going when the window is in the background
  };
  setMsg('Sewing and draping…');
  setTimeout(tick, 0);
}

function bindOrbit(el) {
  let d = null;
  el.onpointerdown = (e) => { el.setPointerCapture(e.pointerId); d = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey, ...V.cam }; };
  el.onpointermove = (e) => {
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.pan) V.cam.ty = Math.max(10, Math.min(180, d.ty + dy * 0.4));
    else { V.cam.theta = d.theta - dx * 0.008; V.cam.phi = Math.max(0.35, Math.min(1.75, d.phi - dy * 0.006)); }
    draw();
  };
  el.onpointerup = () => { d = null; };
  el.oncontextmenu = (e) => e.preventDefault();
  el.onwheel = (e) => { e.preventDefault(); V.cam.dist = Math.max(60, Math.min(700, V.cam.dist * Math.exp(e.deltaY * 0.001))); draw(); };
}

// Shrink big photos before they go into the project file.
function loadPhoto(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { const k = Math.min(1, 512 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.85)); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file);
  });
}

export function render3D(el) {
  const g = garment();
  if (!g || !simType(g)) { el.innerHTML = `<div class="empty">The 3D view sews up skirts, tops, dresses, trousers, jeans and jackets and drapes them on a body made from your measurements.<br>${!g ? 'Create a garment in <b>Design</b> first.' : g.type === 'shape' ? 'This garment has no 3D preview.' : 'For your own pieces, select each one in <b>Pattern</b> and choose what it is under "In 3D" (bodice front, sleeve, skirt back…), then click its edges and choose what each one sews to.'}</div>`; return; }
  g.fabric ||= { color: g.type === 'jeans' || g.type === 'jacket' ? '#3d5a80' : '#c95b82', image: null, scale: 20 };
  g.fabric.kind ||= defaultFabric(g.type);
  const fab = g.fabric;
  el.innerHTML = `<div class="v3d"><div class="v3dcanvas"><div class="v3dmsg" hidden></div></div>
    <aside class="opts"><h3>3D preview</h3><div data-short>${V?.short || ''}</div>
      <label class="row"><span>Fabric</span><select data-f="fkind">${Object.entries(FABRICS).map(([k, f]) => `<option value="${k}" ${k === fab.kind ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      ${fab.image ? '' : `<label class="row"><span>Fabric colour</span><input type="color" data-f="fcolor" value="${fab.color}"></label>`}
      <div class="row"><span>Fabric photo</span><div class="inline">${fab.image ? `<img class="swatch" src="${fab.image}" alt=""><button data-a="nophoto">Remove</button>` : '<button data-a="photo">Choose photo…</button>'}</div></div>
      ${fab.image ? `<label class="row"><span>Print size</span><input type="range" min="4" max="60" data-f="fscale" value="${fab.scale}"></label>` : ''}
      <div class="btns"><button data-view="0">Front</button><button data-view="1.5708">Side</button><button data-view="3.1416">Back</button></div>
      <div class="btns"><button data-a="redrape">Drape again</button></div>
      <p class="tip">Drag to turn, scroll to zoom, right-drag to move up and down.</p>
      <p class="tip">Your pattern pieces, including any you edited, are sewn together and draped on a body shaped to ${esc(profileOf(g).name)}'s measurements. It's a good guide to how the style hangs, but fit is still worth checking with a quick toile.</p>
      <input type="file" accept="image/*" hidden data-f="file">
    </aside></div>`;
  const host = el.querySelector('.v3dcanvas');
  msgEl = host.querySelector('.v3dmsg');
  try { ensureRenderer(); } catch { host.innerHTML = '<div class="empty">3D is not available on this computer (WebGL is turned off).</div>'; return; }
  host.prepend(V.renderer.domElement);
  const night = document.documentElement.dataset.theme === 'dark';
  V.scene.background.set(night ? 0x4d4c53 : 0xf3f1f5); V.floor.material.color.set(night ? 0x5c5b62 : 0xebe8ee);
  const dk = drapeKey(g), look = JSON.stringify([fab.color, fab.image, fab.scale, fab.kind]);
  if (dk !== V.key) { V.key = dk; V.look = look; build(g); }
  else if (look !== V.look) { V.look = look; const mat = clothMaterial(fab); V.root.traverse((x) => { if (x.isMesh) x.material = mat; }); }
  if (run) setMsg('Sewing and draping…');
  const size = () => { const r = host.getBoundingClientRect(); if (!r.width) return; V.renderer.setSize(r.width, r.height); V.camera.aspect = r.width / r.height; V.camera.updateProjectionMatrix(); draw(); };
  size(); new ResizeObserver(size).observe(host);
  bindOrbit(V.renderer.domElement);
  el.onclick = (e) => {
    const a = e.target.dataset.a, v = e.target.dataset.view;
    if (v != null) { V.cam.theta = +v; draw(); }
    if (a === 'photo') el.querySelector('[data-f="file"]').click();
    if (a === 'nophoto') { fab.image = null; commit(); }
    if (a === 'redrape') { drapes.delete(drapeKey(g)); V.key = ''; render3D(el); }
  };
  el.oninput = (e) => { // live colour preview without re-draping
    if (e.target.dataset.f === 'fcolor' && !fab.image) { fab.color = e.target.value; V.root.traverse((x) => { if (x.isMesh) x.material.color.set(fab.color); }); draw(); }
  };
  el.onchange = async (e) => {
    const f = e.target.dataset.f;
    if (f === 'fkind') fab.kind = e.target.value;
    if (f === 'fcolor') fab.color = e.target.value;
    if (f === 'fscale') fab.scale = +e.target.value;
    if (f === 'file' && e.target.files[0]) fab.image = await loadPhoto(e.target.files[0]);
    commit();
  };
}
