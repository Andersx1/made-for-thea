// 3D view: the garment's own pattern pieces (hand edits included) are sewn together along their
// seams and draped by a cloth simulation on a realistic body shaped to the measurement profile.
import * as THREE from '../../node_modules/three/build/three.module.js';
import { S, commit, garment, profileOf } from './store.js';
import { esc } from './render.js';
import { fmt } from './units.js';
import * as io from './io.js';
import { makeBody, posed, poser, POSES } from './sim/body.js';
import { buildSDF, vertexNormals, loopSubdivide } from './sim/sdf.js';
import { assemble, bandMesh, simType, outward } from './sim/garment.js';
import { FABRICS } from './sim/solver.js';
import { createRunner } from './sim/runner.js';
import { carryOver, carry } from './sim/warm.js';
import { fitMap, tightZones } from './sim/fit.js';
import { studio, clothMaterial, threadMaterial, seamMaterial, fitMaterial, fitColors, shade, FIT_CSS } from './look.js';

let V = null; // { renderer, scene, camera, root, cam, key, look, bodyKey, fit (showing the fit map), tug, pose,
// cloth (the garment being worked on, as a layer: see makeLayer), worn (the rest of its outfit, as layers),
// layers (all of them, in the order they go on), last (the finished job, kept so it can be woken) }
let run = null; // the draping in progress: { id, g, B, pose, layers, then (what to do when it's finished), woken, twirl }
let msgEl = null;
const setMsg = (t) => { if (msgEl) { msgEl.hidden = !t; msgEl.textContent = t; } };
const bodies = new Map(); // measurements → { k, body, F, poses }
const drapes = new Map(); // garment state → finished cloth positions
const remember = (key, x) => { drapes.set(key, Float32Array.from(x)); if (drapes.size > 40) drapes.delete(drapes.keys().next().value); };
const defaultFabric = (type) => (type === 'jeans' || type === 'jacket' ? 'denim' : type === 'trousers' ? 'linen' : 'cotton');
// A garment as the 3D view needs it: with a fabric.
const ready = (g) => { g.fabric ||= { color: g.type === 'jeans' || g.type === 'jacket' ? '#3d5a80' : '#c95b82', image: null, scale: 20 }; g.fabric.kind ||= defaultFabric(g.type); return g; };

function bodyFor(m) {
  const k = JSON.stringify(m);
  if (!bodies.has(k)) {
    const body = makeBody(m);
    bodies.set(k, { k, body, F: buildSDF(body.pos, body.tris, { pads: body.pads }), poses: {} });
    if (bodies.size > 3) bodies.delete(bodies.keys().next().value);
  }
  return bodies.get(k);
}
// The body in a pose: its points, how a point near it moves with it and, only when the fit map asks, its field.
const poseOf = (B, pose) => (B.poses[pose] ||= { pos: posed(B.body, pose), move: poser(B.body, pose) });
const fieldOf = (B, pose) => (pose ? (poseOf(B, pose).F ||= buildSDF(poseOf(B, pose).pos, B.body.tris, { pads: B.body.pads })) : B.F);

// Everything that changes the drape (not colour or photo, which only repaint).
const keyOf = (g, sim) => JSON.stringify([g.type, g.options, g.pieces.filter((p) => !(sim && (p.on || p.role === 'patch'))).map((p) => [p.key, p.custom, p.role, p.nodes, p.segs, p.marks, p.cut, p.turns, p.flipped, p.rev, sim ? 0 : [p.id, p.on]]), profileOf(g).m, g.fabric.kind, !!g.fabric.fine]);
const drapeKey = (g) => keyOf(g, false);
// Pockets lie on the cloth without changing how it hangs, so moving one reuses the drape.
const simKey = (g) => keyOf(g, true);
// What a garment is worn with (g.with: other garments of the same person), in the order they go on: skirts and
// trousers first, then tops and dresses, then jackets. Each lies on the body and on those before it.
const rank = (g) => ({ trousers: 0, jeans: 0, skirt: 0, jacket: 2 })[simType(g)] ?? 1;
const others = (g) => S.project.garments.filter((o) => o !== g && simType(o) && profileOf(o) === profileOf(g));
const outfitOf = (g) => [g, ...others(g).filter((o) => (g.with || []).includes(o.id))].map(ready).map((o, i) => [o, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((a) => a[0]);
const sceneKey = (g) => JSON.stringify([V?.pose || '', outfitOf(g).map(drapeKey)]);

// "Fine" spaces the cloth's points closer for smaller folds, at about three times the work.
const detailOf = (fab) => (fab.fine ? { maxPoints: 20000, hMin: 1.15 } : {});

// ---------- running drapes ----------
// Drapes run in a background worker, so turning the model and editing the pattern stay smooth. Where a
// worker can't be started, or it trips, the same runner works on the page instead.
let jobId = 0, engine = null; // { worker, send(msg), bodyKey (the body the worker already has) }
const here = createRunner((msg) => onFrame(msg));
const onPage = () => ({ send: (msg) => here.handle(msg) });
function startEngine() {
  if (engine) return engine;
  try {
    const worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => onFrame(e.data);
    worker.onerror = (e) => { e.preventDefault?.(); fallBack('could not start'); };
    engine = { worker, send: (msg) => worker.postMessage(msg) };
  } catch { engine = onPage(); }
  return engine;
}
function fallBack(why) { // carry on here, restarting the drape in hand
  console.warn('Drape worker:', why, '- draping on the page instead.');
  engine?.worker?.terminate();
  engine = onPage(); V.last = null;
  if (run) launch(run);
}
// Send an outfit off to be draped, garment by garment. The worker assembles the same garments itself (it is
// quick, and only numbers cross over); on the page the runner works straight on ours.
function launch(r) {
  const E = startEngine(), B = r.B, base = { key: `${B.k}#${r.pose}`, pos: r.pose ? poseOf(B, r.pose).pos : null };
  const layer = (C) => ({ fabric: C.g.fabric.kind, warm: C.state === 'warm' && (C.lift ? 2 : true), done: C.state === 'done', lift: !!C.lift, key: C.rk });
  if (!E.worker) return E.send({ type: 'start', id: r.id, bodyKey: B.k, body: B.body, base: { ...base, F: r.pose ? undefined : B.F }, layers: r.layers.map((C) => ({ ...layer(C), sys: C.sys })) });
  const msg = { type: 'start', id: r.id, bodyKey: B.k, base, layers: r.layers.map((C) => ({ ...layer(C), N: C.sys.N, x0: C.state === 'cold' ? null : Float32Array.from(C.sys.x), opts: detailOf(C.g.fabric), m: profileOf(C.g).m, g: { type: C.g.type, options: C.g.options, pieces: C.g.pieces } })) };
  if (E.bodyKey !== B.k) { E.bodyKey = B.k; msg.body = { pos: B.body.pos, tris: B.body.tris, loops: B.body.loops, landmarks: B.body.landmarks, pads: B.body.pads }; if (!r.pose) base.F = B.F; }
  try { E.send(msg); } catch (e) { fallBack(e.message); }
}
function onFrame(msg) {
  if (!run || msg.id !== run.id) return;
  if (msg.type === 'failed') return fallBack(msg.why);
  const C = run.layers[msg.layer];
  if (!C) return;
  if (msg.x) C.sys.x.set(msg.x);
  C.warmOk ||= msg.layerDone || msg.progress > 0.3; // sewn and hanging: an edit can carry on from here
  if (run.twirl) { const u = Math.min(1, msg.progress * 1.6), e = u * u * (3 - 2 * u); V.cam.theta = run.from + 2 * Math.PI * e; } // the view turns once round her while the cloth flies
  C.refresh(); draw();
  if (msg.layerDone) remember(C.rk + (run.pose ? `#${run.pose}` : ''), C.sys.x);
  if (!msg.done) {
    const who = run.layers.length > 1 ? `${C.g.name}: ` : '';
    return setMsg(msg.held ? 'Let go and it settles' : run.twirl ? 'Twirling…' : C.state === 'cold' && !run.woken ? `${who}Sewing and draping… ${Math.round(msg.progress * 100)}%` : `${who}Settling…`);
  }
  for (const L of run.layers) for (const p of L.parts) p.geo.computeBoundingSphere();
  const r = run;
  run = null; V.last = r; r.woken = r.twirl = false; setMsg('');
  r.then?.();
}
// A finished outfit wakes up in the runner, to be tugged or twirled (the runner may never have seen it, if every
// drape was remembered: then it is sent as it stands).
function wake() {
  if (run) return run;
  if (V.last) run = V.last;
  else { for (const C of V.layers) C.state = 'done'; run = { id: ++jobId, g: V.cloth.g, B: V.cloth.B, pose: V.cloth.pose, layers: V.layers }; launch(run); }
  run.woken = true;
  return run;
}

// ---------- scene ----------
function ensureRenderer() {
  if (V) return V;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps fabric colours true
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf3f1f5);
  scene.environment = studio(renderer); scene.environmentIntensity = 0.5;
  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(120, 260, 220); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -100, right: 100, top: 200, bottom: -10, near: 10, far: 700 }); key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.radius = 3;
  const rim = new THREE.DirectionalLight(0xfff1e0, 0.4); rim.position.set(-200, 150, -150);
  scene.add(key, rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ color: 0xebe8ee, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(30, 1, 5, 3000);
  const root = new THREE.Group(), bodyRoot = new THREE.Group(); scene.add(root, bodyRoot);
  V = { renderer, scene, camera, root, bodyRoot, floor, cam: { theta: 0.35, phi: 1.45, dist: 330, ty: 110 }, key: '', bodyKey: '', type: '', fit: false, tug: false, pose: '', cloth: null, worn: [], layers: [], last: null };
  return V;
}
function placeCamera() {
  const { camera, cam } = V;
  camera.position.set(cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta), cam.ty + cam.dist * Math.cos(cam.phi), cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta));
  camera.lookAt(0, cam.ty, 0);
}
function draw() { if (V && V.renderer.domElement.isConnected) { placeCamera(); V.renderer.render(V.scene, V.camera); } }

function showBody(B, pose) {
  const key = `${B.k}#${pose}`;
  if (V.bodyKey === key) return;
  V.bodyKey = key; V.bodyRoot.clear();
  const g = new THREE.BufferGeometry(), S = loopSubdivide(poseOf(B, pose).pos, B.body.tris); // drawn smoother than the collision mesh
  g.setAttribute('position', new THREE.BufferAttribute(S.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(vertexNormals(S.pos, S.tris), 3));
  g.setIndex(new THREE.BufferAttribute(S.tris, 1));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd9ccc4, roughness: 0.75 }));
  mesh.castShadow = mesh.receiveShadow = true;
  V.bodyRoot.add(mesh);
}

// ---------- the cloth ----------
// Lines of stitching: a narrow strip of thread lying on the cloth a little way in from each chain
// of edge points (chains: [{ v: point numbers, off: cm in from the edge, closed }]).
function ribbon(sys, chains, width = 0.22) {
  const segs = [];
  for (const c of chains) { // points with no neighbour inside the piece (dart tips) break the line
    let cur = null;
    for (const v of c.closed ? [...c.v, c.v[0]] : c.v) { if (sys.inU[v] >= 0) { if (!cur) segs.push(cur = { v: [], off: c.off }); cur.v.push(v); } else cur = null; }
  }
  const live = segs.filter((sg) => sg.v.length > 1), n = live.reduce((t, sg) => t + sg.v.length, 0), pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), index = [];
  let k = 0;
  for (const sg of live) { sg.k = k; for (let i = 0; i < sg.v.length - 1; i++) { const a = (k + i) * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } k += sg.v.length; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(index);
  const mesh = new THREE.Mesh(geo); mesh.frustumCulled = false;
  const update = () => {
    const x = sys.x;
    for (const sg of live) {
      let len = 0, px = 0, py = 0, pz = 0;
      sg.v.forEach((v, i) => {
        const u = sys.inU[v], f = Math.min(0.95, sg.off / sys.inPerp[v]), ex = x[u * 3] - x[v * 3], ey = x[u * 3 + 1] - x[v * 3 + 1], ez = x[u * 3 + 2] - x[v * 3 + 2], h = width / 2 / (Math.hypot(ex, ey, ez) || 1);
        const cx = x[v * 3] + ex * f, cy = x[v * 3 + 1] + ey * f, cz = x[v * 3 + 2] + ez * f, o = (sg.k + i) * 6, q = (sg.k + i) * 4;
        if (i) len += Math.hypot(cx - px, cy - py, cz - pz);
        px = cx; py = cy; pz = cz;
        pos.set([cx - ex * h, cy - ey * h, cz - ez * h, cx + ex * h, cy + ey * h, cz + ez * h], o);
        uv[q] = uv[q + 2] = len / 0.5; uv[q + 1] = 0; uv[q + 3] = 1; // two stitches to the centimetre
      });
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true; geo.computeVertexNormals();
  };
  update();
  return { mesh, update };
}

const THREAD = '#d9a441'; // the gold of jeans topstitching
const ALT = '#f4efe6'; // the second colour to start from: off-white
const topstitched = (fab) => fab.topstitch ?? fab.kind === 'denim';
const lookKey = (fab) => JSON.stringify([fab.color, fab.image, fab.scale, fab.kind, fab.inside, fab.alt, fab.topstitch, fab.thread]);
function clearScene() {
  for (const C of V.layers) for (const mt of C.mats) mt.dispose();
  V.root.traverse((o) => o.geometry?.dispose());
  V.root.clear(); V.cloth = null; V.worn = []; V.layers = [];
}

// Dress a layer's draped cloth: the fabric (main colour or photo, a second colour on chosen pieces, another
// colour inside), its stitching, or (fit) the fit map in place of the fabric.
function dress(C, fit) {
  const fab = C.g.fabric;
  for (const mt of C.mats) mt.dispose();
  C.mats = [];
  const keep = (mt) => { C.mats.push(mt); return mt; }, R = V.renderer, alt = fab.alt?.keys.length ? fab.alt : null;
  const made = new Map(), cloth = (color, side, image) => { const k = `${color}|${side}|${!!image}`; if (!made.has(k)) made.set(k, keep(clothMaterial(R, fab.kind, { color, side, image, scale: fab.scale || 20, onLoad: draw }))); return made.get(k); };
  if (fit) {
    const fm = keep(fitMaterial()), plain = keep(new THREE.MeshStandardMaterial({ color: FIT_CSS.right, roughness: 0.9, side: THREE.DoubleSide }));
    for (const p of C.parts) { p.outer.material = fm; p.inner.visible = false; }
    for (const b of [...C.bands, ...C.patches]) b.mesh.material = plain;
  } else {
    const side = fab.inside ? THREE.FrontSide : THREE.DoubleSide, of = (key, sd) => (alt?.keys.includes(key) ? cloth(alt.color, sd) : cloth(fab.color, sd, fab.image));
    for (const p of C.parts) { p.outer.material = of(p.key, side); p.inner.visible = !!fab.inside; if (fab.inside) p.inner.material = cloth(fab.inside, THREE.BackSide); }
    for (const b of C.bands) b.mesh.material = of('bands', THREE.DoubleSide);
    for (const pt of C.patches) pt.mesh.material = of(pt.key, THREE.DoubleSide);
  }
  C.seams.material = keep(seamMaterial());
  // Stitching: hems always; with topstitching, every seam too, in the contrast thread.
  if (C.stitch) { C.group.remove(C.stitch.mesh); C.stitch.mesh.geometry.dispose(); }
  const top = topstitched(fab);
  C.stitch = ribbon(C.sys, [...C.sys.hems, ...(top ? C.sys.lines.filter((l) => !l.dart).map((l) => ({ ...l, off: 0.6 })) : [])]);
  C.stitch.mesh.material = keep(top ? threadMaterial(fab.thread || THREAD) : fab.image || fit ? threadMaterial('#3c3c3c', 0.45) : threadMaterial(shade(fab.color), 0.9));
  for (const pt of C.patches) { pt.stitch.mesh.material = C.stitch.mesh.material; pt.edge.material = C.seams.material; }
  C.group.add(C.stitch.mesh);
}
// Dress everything on screen (the fit map goes on the garment being worked on only).
function applyLook() {
  if (!V.cloth) return;
  for (const C of V.layers) dress(C, V.fit && C === V.cloth);
  if (V.fit) paintFit();
  draw();
}

// Colour the cloth by fit, and say in words where it's tight.
function paintFit() {
  const C = V.cloth;
  if (!C) return;
  C.fitV = fitMap(C.sys, fieldOf(C.B, C.pose), C.fitV);
  for (const p of C.parts) { const col = p.geo.attributes.color; fitColors(C.fitV, p.base, p.n, col.array); col.needsUpdate = true; }
  const el = document.querySelector('.v3d [data-fit]');
  if (!el) return;
  const z = run ? null : tightZones(C.sys, C.fitV, C.B.body.landmarks), list = z && (z.length > 1 ? `${z.slice(0, -1).join(', ')} and ${z[z.length - 1]}` : z[0]);
  const html = `<div class="fitkey"><i></i><div><span>Loose</span><span>Just right</span><span>Tight</span></div></div>
    <p class="tip"><b>${!z ? 'Still draping…' : z.length ? `Tight around the ${list}.` : 'Nothing is pulling tight.'}</b><br>Red is where the fabric has to stretch to get round the body: let the pattern out there. Blue hangs 3 cm or more away from the body.</p>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

// One garment in the scene: its assembled cloth and everything drawn from it.
// { g, sys, B, gid, group, parts, bands, patches, seams, names, stitch, fitV, mats, refresh,
//   rk (what its drape is remembered by), pose, state ('done' | 'warm' | 'cold'), lift, warmOk }
function makeLayer(g, B, active) {
  const m = profileOf(g).m;
  let sys;
  if (active) V.short = '';
  try { sys = assemble(g, m, B.body, B.F, detailOf(g.fabric)); } catch (e) { console.error(e); if (active) setMsg('This pattern couldn\'t be sewn up in 3D. If you edited a piece a lot, try resetting it.'); return null; }
  if (!sys) { if (active) setMsg('None of these pieces can be draped in 3D.'); return null; }
  if (active) {
    V.short = sys.short.length ? `<div class="warn"><b>Too small to fit ${esc(profileOf(g).name)}</b>${sys.short.map((s) => `<br>At the ${s.where} your pieces go ${esc(fmt(s.cloth))} round, but the measurement is ${esc(fmt(s.body))}. Make them about ${esc(fmt(s.body - s.cloth + 4))} bigger round in total.`).join('')}<br><small>Too-small cloth can't sit on the body, so it may not show properly. Use the body guide in Pattern: each line is the width one front or back piece needs when you cut 2, plus a little ease.</small></div>` : '';
    const sh = document.querySelector('.v3d [data-short]'); if (sh) sh.innerHTML = V.short;
  }
  const group = new THREE.Group(); V.root.add(group);
  // Each piece is drawn twice from the same points: its outside, and (when the inside has its own colour) its inside.
  const parts = sys.inst.map((I) => {
    const n = I.pc.mesh.pts.length, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sys.x.subarray(I.base * 3, (I.base + n) * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(sys.uv.subarray(I.base * 2, (I.base + n) * 2), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    geo.setIndex(outward(sys, I, B.F));
    const outer = new THREE.Mesh(geo), inner = new THREE.Mesh(geo);
    outer.castShadow = outer.receiveShadow = inner.receiveShadow = true;
    group.add(outer, inner);
    return { geo, outer, inner, key: I.key, base: I.base, n };
  });
  const bands = sys.bands.map((b) => {
    const M = bandMesh(b), geo = new THREE.BufferGeometry(), pos = new Float32Array(b.verts.length * M.rows * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(M.uv, 2)); geo.setIndex(M.index);
    const mesh = new THREE.Mesh(geo); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    return { M, geo, pos, mesh };
  });
  // Seams show as a fine dark line along one side of each.
  const sg = new THREE.BufferGeometry(), si = [];
  for (const l of sys.lines) { for (let i = 1; i < l.v.length; i++) si.push(l.v[i - 1], l.v[i]); if (l.closed) si.push(l.v[l.v.length - 1], l.v[0]); }
  sg.setAttribute('position', new THREE.BufferAttribute(sys.x, 3)); sg.setIndex(si);
  const seams = new THREE.LineSegments(sg); seams.frustumCulled = false; group.add(seams);
  // Pockets and patches lie on the draped cloth: each point follows its spot on the host piece, a little proud of it.
  const patches = sys.patches.map((pt) => {
    const n = pt.pts.length, pos = new Float32Array(n * 3), geo = new THREE.BufferGeometry(), host = parts[pt.inst];
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(pt.uv, 2)); geo.setIndex(pt.tris.flat());
    const mesh = new THREE.Mesh(geo), eg = new THREE.BufferGeometry();
    eg.setAttribute('position', geo.attributes.position); eg.setIndex([...new Set(pt.runs.flatMap((r) => r.idx))]);
    const edge = new THREE.LineLoop(eg), stitch = ribbon({ x: pos, inU: pt.inU, inPerp: pt.inPerp }, pt.runs.filter((r) => !r.open).map((r) => ({ v: r.idx, off: 0.5 }))); // stitched down all round, bar the opening
    mesh.receiveShadow = true; mesh.frustumCulled = edge.frustumCulled = false;
    group.add(mesh, edge, stitch.mesh);
    const update = () => {
      const hn = host.geo.attributes.normal.array, x = sys.x, { bind, w } = pt;
      for (let i = 0; i < n; i++) {
        let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
        for (let c = 0; c < 3; c++) { const v = bind[i * 3 + c], k = w[i * 3 + c], l = (v - host.base) * 3; px += x[v * 3] * k; py += x[v * 3 + 1] * k; pz += x[v * 3 + 2] * k; nx += hn[l] * k; ny += hn[l + 1] * k; nz += hn[l + 2] * k; }
        const nl = 0.25 / (Math.hypot(nx, ny, nz) || 1);
        pos[i * 3] = px + nx * nl; pos[i * 3 + 1] = py + ny * nl; pos[i * 3 + 2] = pz + nz * nl;
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); stitch.update();
    };
    return { key: pt.key, mesh, edge, stitch, update };
  });
  // The pieces by name, for choosing which get the second colour.
  const names = [];
  for (const I of sys.inst) if (!names.some((nm) => nm[0] === I.key)) names.push([I.key, I.pc.name || I.key]);
  for (const pt of sys.patches) if (!names.some((nm) => nm[0] === pt.key)) names.push([pt.key, pt.name]);
  if (sys.bands.length) names.push(['bands', [...new Set(sys.bands.map((b) => ({ up: 'Waistband', down: 'Hem band', collar: 'Collar', cuff: 'Cuffs' })[b.kind]))].join(', ')]);
  const C = { g, sys, B, gid: g.id, group, parts, bands, patches, seams, names, stitch: null, fitV: undefined, mats: [], rk: '', pose: '', state: 'cold', lift: false, warmOk: false };
  C.refresh = () => {
    for (const p of parts) { p.geo.attributes.position.needsUpdate = true; p.geo.computeVertexNormals(); }
    for (const b of bands) { b.M.update(sys.x, b.pos); b.geo.attributes.position.needsUpdate = true; b.geo.attributes.uv.needsUpdate = true; b.geo.computeVertexNormals(); }
    sg.attributes.position.needsUpdate = true;
    C.stitch?.update();
    for (const pt of patches) pt.update(); // after the pieces' normals: pockets sit along them
    if (V.fit && C === V.cloth) paintFit();
  };
  return C;
}

// Build the scene for a garment and what it's worn with, and start (or reuse) their drapes.
let lastBuild = 0; // when the last build finished
function build(g) { buildNow(g); lastBuild = performance.now(); }
function buildNow(g) {
  const B = bodyFor(profileOf(g).m), want = V.pose || '', fresh = V.cold;
  // What's on screen now, garment by garment: one that has got as far as hanging is carried on from.
  const old = new Map();
  if (!fresh) for (const C of V.layers) if (C.warmOk && C.B === B) old.set(C.gid, C);
  V.cold = false;
  if (run) engine?.send({ type: 'stop' });
  clearScene(); run = null; V.last = null;
  let chain = '';
  for (const o of outfitOf(g)) { // each garment's drape is remembered by itself and everything under it
    const C = makeLayer(o, B, o === g);
    if (!C) { if (o === g) return; continue; }
    chain += `|${simKey(o)}`; C.rk = chain; V.layers.push(C);
  }
  V.cloth = V.layers.find((C) => C.g === g); V.worn = V.layers.filter((C) => C.g !== g);
  const kept = (C, pose) => { const d = !fresh && drapes.get(C.rk + (pose ? `#${pose}` : '')); return d && d.length === C.sys.x.length ? d : null; };
  // A pose is reached from the standing drape (the cloth is carried along with the limbs, then settles). If a
  // garment has neither yet, everything is draped standing first, and posed after.
  const pose = want && V.layers.some((C) => !kept(C, want) && !kept(C, '') && old.get(C.gid)?.pose !== want) ? '' : want;
  showBody(B, pose);
  let anew = false; // once one garment is draped anew, those over it are too
  for (const C of V.layers) {
    C.pose = pose;
    let done = !anew && kept(C, pose);
    const was = old.get(C.gid), from = !done && was?.pose === pose && carryOver(was.sys, C.sys), stood = !done && !from && pose && kept(C, '');
    if (done) C.sys.x.set(done);
    else if (from) C.sys.x.set(from);
    else if (stood) {
      C.sys.x.set(stood);
      const to = carry(C.sys, poseOf(B, pose).move);
      // A garment the pose doesn't touch (a skirt when only the arms move) hangs as it did, if nothing under it changed.
      if (!anew && to.every((v, i) => Math.abs(v - stood[i]) < 0.05)) { done = stood; remember(C.rk + `#${pose}`, stood); } else { C.sys.x.set(to); C.lift = true; }
    }
    C.state = done ? 'done' : from || stood ? 'warm' : 'cold'; C.warmOk = C.state !== 'cold';
    if (!done) anew = true;
    dress(C, V.fit && C === V.cloth); C.refresh();
  }
  if (V.type !== g.type) { // frame the garment
    V.type = g.type;
    V.cam.ty = { trousers: 72, jeans: 72, skirt: 82, dress: 100, top: 112, jacket: 112 }[g.type] ?? 100;
    V.cam.dist = g.type === 'trousers' || g.type === 'jeans' || g.type === 'dress' ? 380 : 300;
  }
  draw();
  if (!anew) return setMsg('');
  run = { id: ++jobId, g, B, pose, layers: V.layers, then: pose === want ? null : () => { if (garment() === g && msgEl?.isConnected) { V.key = sceneKey(g); build(g); } } };
  setMsg(V.layers.some((C) => C.state === 'cold') ? 'Sewing and draping…' : 'Settling…');
  launch(run);
}

// ---------- taking hold of the cloth ----------
const caster = new THREE.Raycaster(), pointer = new THREE.Vector2();
function aim(e) { const r = V.renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); V.camera.updateMatrixWorld(); caster.setFromCamera(pointer, V.camera); }
// The cloth point under the pointer: { i (its number), plane (facing the camera through it, for dragging it about) }.
function pickCloth(e) {
  const C = V.cloth;
  if (!C) return null;
  aim(e);
  for (const p of C.parts) p.geo.computeBoundingSphere();
  const hit = caster.intersectObjects(C.parts.map((p) => p.outer), false)[0];
  if (!hit) return null;
  const part = C.parts.find((p) => p.outer === hit.object), pos = part.geo.attributes.position, q = new THREE.Vector3();
  let best = hit.face.a, bd = Infinity;
  for (const k of [hit.face.a, hit.face.b, hit.face.c]) { const d = q.fromBufferAttribute(pos, k).distanceToSquared(hit.point); if (d < bd) { bd = d; best = k; } }
  return { i: part.base + best, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(V.camera.getWorldDirection(new THREE.Vector3()), hit.point) };
}
function takeHold(hit) { const r = wake(); engine.send({ type: 'grab', id: r.id, layer: r.layers.indexOf(V.cloth), i: hit.i }); }
// A twirl: the cloth of the garment being worked on flies out as if she spun, while the view turns once round
// her (in step with the simulation: see onFrame).
function twirl() {
  if (!V.cloth || run?.twirl) return;
  const r = wake(); r.twirl = true; r.from = V.cam.theta;
  engine.send({ type: 'spin', id: r.id, layer: r.layers.indexOf(V.cloth) });
}
function pullTo(e, hit) { aim(e); const p = caster.ray.intersectPlane(hit.plane, new THREE.Vector3()); if (p && run) engine.send({ type: 'pull', id: run.id, p: [p.x, Math.max(1, p.y), p.z] }); }

function bindOrbit(el) {
  let d = null;
  el.style.cursor = V.tug ? 'pointer' : '';
  el.onpointerdown = (e) => {
    el.setPointerCapture(e.pointerId);
    const hold = V.tug && e.button === 0 && !e.shiftKey && pickCloth(e); // in tug mode a drag on the cloth pulls it; anywhere else turns the view
    if (hold) { d = { hold }; takeHold(hold); return; }
    d = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey, ...V.cam };
  };
  el.onpointermove = (e) => {
    if (!d) return;
    if (d.hold) return pullTo(e, d.hold);
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.pan) V.cam.ty = Math.max(10, Math.min(180, d.ty + dy * 0.4));
    else { V.cam.theta = d.theta - dx * 0.008; V.cam.phi = Math.max(0.35, Math.min(1.75, d.phi - dy * 0.006)); }
    draw();
  };
  el.onpointerup = el.onpointercancel = () => { if (d?.hold && run) engine.send({ type: 'release', id: run.id }); d = null; };
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

// Put the 3D view in a box on the page (the 3D tab's, or the one beside the pattern) and bring it up to date.
export function mount3D(host, g) {
  ready(g);
  if (!host.querySelector('.v3dmsg')) host.insertAdjacentHTML('afterbegin', '<div class="v3dmsg" hidden></div>');
  msgEl = host.querySelector('.v3dmsg');
  try { ensureRenderer(); } catch { host.innerHTML = '<div class="empty">3D is not available on this computer (WebGL is turned off).</div>'; return false; }
  host.prepend(V.renderer.domElement);
  const night = document.documentElement.dataset.theme === 'dark';
  V.scene.background.set(night ? 0x4d4c53 : 0xf3f1f5); V.floor.material.color.set(night ? 0x5c5b62 : 0xebe8ee);
  const dk = sceneKey(g), look = outfitOf(g).map((o) => lookKey(o.fabric)).join('|');
  if (dk !== V.key) { V.key = dk; V.look = look; build(g); }
  else if (look !== V.look) { V.look = look; applyLook(); }
  if (run) setMsg(run.layers.some((C) => C.state === 'cold') ? 'Sewing and draping…' : 'Settling…');
  const size = () => { const r = host.getBoundingClientRect(); if (!r.width) return; V.renderer.setSize(r.width, r.height); V.camera.aspect = r.width / r.height; V.camera.updateProjectionMatrix(); draw(); };
  size(); new ResizeObserver(size).observe(host);
  bindOrbit(V.renderer.domElement);
  return true;
}
// The pattern changed but isn't committed yet (a point is being dragged, the 3D view beside it): re-drape,
// carrying on from the cloth as it is. Rebuilding takes 0.1–0.25 s, so the editor asks when the drag pauses.
export function nudge3D(g) {
  if (!V || !msgEl?.isConnected || performance.now() - lastBuild < 600) return;
  const dk = sceneKey(g);
  if (dk !== V.key) { V.key = dk; build(g); }
}

export function render3D(el) {
  const g = garment();
  if (!g || !simType(g)) { el.innerHTML = `<div class="empty">The 3D view sews up skirts, tops, dresses, trousers, jeans and jackets and drapes them on a body made from your measurements.<br>${!g ? 'Create a garment in <b>Design</b> first.' : g.type === 'shape' ? 'This garment has no 3D preview.' : 'For your own pieces, select each one in <b>Pattern</b> and choose what it is under "In 3D" (bodice front, sleeve, skirt back…), then click its edges and choose what each one sews to. Collars, cuffs, waistbands and ruffles are "Sewn-on pieces": sew one of their edges to the garment and they appear with it.'}</div>`; return; }
  const fab = ready(g).fabric, top = topstitched(fab), rest = others(g);
  el.innerHTML = `<div class="v3d"><div class="v3dcanvas"><div class="v3dmsg" hidden></div></div>
    <aside class="opts"><h3>3D preview</h3><div data-short>${V?.short || ''}</div>
      <div class="btns"><button data-a="fit" class="${V?.fit ? 'primary' : ''}">${V?.fit ? 'Show the fabric' : 'Show the fit'}</button></div>
      <div data-fit></div>
      <div class="btns"><button data-view="0">Front</button><button data-view="1.5708">Side</button><button data-view="3.1416">Back</button></div>
      <label class="row"><span>Fabric</span><select data-f="fkind">${Object.entries(FABRICS).map(([k, f]) => `<option value="${k}" ${k === fab.kind ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      ${fab.image ? '' : `<label class="row"><span>Fabric colour</span><input type="color" data-f="fcolor" value="${fab.color}"></label>`}
      <div class="row"><span>Fabric photo</span><div class="inline">${fab.image ? `<img class="swatch" src="${fab.image}" alt=""><button data-a="nophoto">Remove</button>` : '<button data-a="photo">Choose photo…</button>'}</div></div>
      ${fab.image ? `<label class="row"><span>Print size</span><input type="range" min="4" max="60" data-f="fscale" value="${fab.scale}"></label>` : ''}
      <div class="row"><span>Inside colour</span><div class="inline"><input type="color" data-f="finside" value="${fab.inside || fab.color}">${fab.inside ? '<button data-a="noinside" title="Same as the outside">Reset</button>' : ''}</div></div>
      <label class="row"><span>Topstitching</span><input type="checkbox" data-f="ftop" ${top ? 'checked' : ''}></label>
      ${top ? `<label class="row"><span>Thread colour</span><input type="color" data-f="fthread" value="${fab.thread || THREAD}"></label>` : ''}
      <h4>Second colour</h4>
      <label class="row"><span>Colour</span><input type="color" data-f="faltc" value="${fab.alt?.color || ALT}"></label>
      <div data-pieces></div>
      <h4>Worn with</h4>
      ${rest.length ? rest.map((o) => `<label class="row"><span>${esc(o.name)}</span><input type="checkbox" data-with="${esc(o.id)}" ${(g.with || []).includes(o.id) ? 'checked' : ''}></label>`).join('') + '<p class="tip">Skirts and trousers go on first, then tops and dresses, then jackets. What is underneath is not squeezed by what goes over it.</p>' : `<p class="tip">Other garments made for ${esc(profileOf(g).name)} in this project can be shown with this one, as an outfit.</p>`}
      <label class="row"><span>Pose</span><select data-f="pose">${POSES.map(([k, n]) => `<option value="${k}" ${k === (V?.pose || '') ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="row"><span>Detail</span><select data-f="fdetail"><option value="">Standard</option><option value="fine" ${fab.fine ? 'selected' : ''}>Fine (slower)</option></select></label>
      <div class="btns"><button data-a="tug" class="${V?.tug ? 'primary' : ''}" title="Drag the fabric to pull it; let go and it settles">${V?.tug ? '✋ Tugging: on' : '✋ Tug the cloth'}</button><button data-a="twirl" title="The cloth flies out as if she spun round once">💃 Twirl</button><button data-a="redrape">Drape again</button><button data-a="snap">Save a picture</button></div>
      <p class="tip">${V?.tug ? 'Drag the fabric to pull it about; let go and it settles. Drag anywhere else to turn the view.' : 'Drag to turn, scroll to zoom, right-drag to move up and down.'}</p>
      <p class="tip">Your pattern pieces, including any you edited, are sewn together and draped on a body shaped to ${esc(profileOf(g).name)}'s measurements. It's a good guide to how the style hangs, but fit is still worth checking with a quick toile.</p>
      <input type="file" accept="image/*" hidden data-f="file">
    </aside></div>`;
  if (!mount3D(el.querySelector('.v3dcanvas'), g)) return;
  // The pieces that can take the second colour, and the fit map's key.
  el.querySelector('[data-pieces]').innerHTML = (V.cloth?.names || []).map(([k, nm]) => `<label class="row"><span>${esc(nm)}</span><input type="checkbox" data-alt="${esc(k)}" ${fab.alt?.keys.includes(k) ? 'checked' : ''}></label>`).join('');
  if (V.fit) paintFit();
  el.onclick = (e) => {
    const a = e.target.dataset.a, v = e.target.dataset.view;
    if (v != null) { V.cam.theta = +v; draw(); }
    if (a === 'photo') el.querySelector('[data-f="file"]').click();
    if (a === 'nophoto') { fab.image = null; commit(); }
    if (a === 'noinside') { delete fab.inside; commit(); }
    if (a === 'redrape') { V.key = ''; V.cold = true; render3D(el); } // from scratch: not from the cloth as it is, nor from a remembered drape
    if (a === 'twirl') twirl();
    if (a === 'tug') { V.tug = !V.tug; render3D(el); }
    if (a === 'fit') { V.fit = !V.fit; render3D(el); applyLook(); }
    if (a === 'snap') { draw(); V.renderer.domElement.toBlob((bl) => io.download(bl, `${g.name}.png`)); }
  };
  const colours = (e) => { // a colour picker moved: returns true when it was one
    const f = e.target.dataset.f, v = e.target.value;
    if (f === 'fcolor') fab.color = v; else if (f === 'finside') fab.inside = v; else if (f === 'fthread') fab.thread = v; else if (f === 'faltc') (fab.alt ||= { color: ALT, keys: [] }).color = v; else return false;
    return true;
  };
  el.oninput = (e) => { if (colours(e)) applyLook(); }; // live colour preview without re-draping
  el.onchange = async (e) => {
    const f = e.target.dataset.f, k = e.target.dataset.alt, w = e.target.dataset.with;
    if (f === 'pose') { V.pose = e.target.value; return render3D(el); } // how she stands is for looking, not part of the project
    if (w) g.with = e.target.checked ? [...(g.with || []), w] : (g.with || []).filter((id) => id !== w);
    colours(e);
    if (k) { const A = (fab.alt ||= { color: ALT, keys: [] }); A.keys = e.target.checked ? [...A.keys, k] : A.keys.filter((q) => q !== k); }
    if (f === 'fkind') fab.kind = e.target.value;
    if (f === 'fdetail') fab.fine = e.target.value === 'fine';
    if (f === 'ftop') fab.topstitch = e.target.checked;
    if (f === 'fscale') fab.scale = +e.target.value;
    if (f === 'file' && e.target.files[0]) fab.image = await loadPhoto(e.target.files[0]);
    commit();
  };
}
