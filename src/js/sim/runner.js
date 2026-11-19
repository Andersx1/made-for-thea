// Runs drapes and reports back, so the same code can sit in a background worker (worker.js) or, where
// workers aren't available, on the page itself.
// A job is one or more garments worn together (layers), draped in order, each over the body and the
// layers before it. Messages in: start, grab, pull, release, spin, stop.
// Messages out (through post): frame { id, layer, x, progress, held, layerDone, done }, failed { id, why }.
import { assemble, liftOut } from './garment.js';
import { makeSim, FABRICS } from './solver.js';
import { buildSDF } from './sdf.js';
import { shell, clearOf } from './layers.js';

// post(message, transfer): how frames get back. slice: ms of simulating between reports.
export function createRunner(post, { slice = 28 } = {}) {
  // job: { id, body, pos (the body's points: posed, or as it stands), base (its field), baseKey,
  //   layers: [{ g, m, opts, fabric, N, x0, warm, done, lift, key, sys, F, own }], k (the layer in hand), ready (how many are prepared), sim, only }
  let job = null, waiting = false, kept = null; // kept: the last body sent, reused until a new one arrives
  const fields = new Map(); // collision fields already built, by what they are of
  const field = (key, make) => { if (!fields.has(key)) { fields.set(key, make()); if (fields.size > 8) fields.delete(fields.keys().next().value); } return fields.get(key); };
  const now = () => performance.now();
  // A garment over another keeps a little further off it than cloth does off skin, so the one underneath doesn't show through.
  const simOf = (L, warm) => makeSim(L.sys, L.F, FABRICS[L.fabric] || FABRICS.cotton, { warm, thick: L.over ? 0.9 : 0.5 });

  // Get layer k ready: what it drapes over, the garment itself, and where its cloth starts.
  function prepare(k) {
    const L = job.layers[k], under = job.layers.slice(0, k).map((u) => u.sys);
    L.F = k ? field(`${job.baseKey}|${job.layers[k - 1].key}`, () => shell(job.body, job.pos, under, job.base)) : job.base;
    if (!L.sys) { // the page hands over either its own assembled garment or what's needed to assemble the same one here
      L.sys = assemble(L.g, L.m, job.body, L.F, L.opts);
      if (!L.sys || L.sys.N !== L.N) throw new Error('the garment came out differently here');
      if (L.x0) L.sys.x.set(L.x0);
    }
    if (k && !L.done) clearOf(L.sys, under, job.body); // nothing starts underneath what's already on
    if (L.lift) liftOut(L.sys, L.F); // carried along by a moved limb, it may have ended up inside it
    L.over = k > 0; job.ready = k + 1; job.k = k; job.sim = L.done ? null : simOf(L, L.warm);
  }
  const report = (layerDone, done) => {
    const L = job.layers[job.k], x = L.own && job.sim ? Float32Array.from(L.sys.x) : null;
    post({ type: 'frame', id: job.id, layer: job.k, x, progress: job.sim ? job.sim.progress : 1, held: !!job.sim?.held, layerDone, done }, x ? [x.buffer] : []);
  };
  const fail = (id, e) => { job = null; post({ type: 'failed', id, why: String(e?.message || e) }); };
  const loop = () => {
    waiting = false;
    if (!job) return;
    try {
      if (job.sim && !job.sim.done) { const t0 = now(); while (now() - t0 < slice && !job.sim.done) job.sim.frame(); }
      const fin = !job.sim || job.sim.done, last = job.only || job.k === job.layers.length - 1;
      report(fin, fin && last);
      if (!fin) return kick();
      if (!last) { prepare(job.k + 1); kick(); } // on to the next garment
    } catch (e) { fail(job.id, e); }
  };
  const kick = () => { if (!waiting) { waiting = true; setTimeout(loop, 0); } }; // a pause between slices lets messages in

  function start(msg) {
    job = null;
    if (msg.body) kept = { key: msg.bodyKey, body: msg.body };
    try {
      if (!kept || kept.key !== msg.bodyKey) throw new Error('no body');
      const pos = msg.base.pos || kept.body.pos;
      if (msg.base.F) fields.set(msg.base.key, msg.base.F);
      job = { id: msg.id, body: kept.body, pos, baseKey: msg.base.key, base: field(msg.base.key, () => buildSDF(pos, kept.body.tris, { pads: kept.body.pads })), layers: msg.layers.map((L) => ({ ...L, own: !L.sys })), k: 0, ready: 0, sim: null, only: false };
      prepare(0);
      kick();
    } catch (e) { fail(msg.id, e); }
  }
  // Wake one layer of a finished outfit (to be tugged or twirled); the others stay as they are.
  function wake(k) {
    while (job.ready <= k) prepare(job.ready);
    if (job.k !== k || !job.sim || job.sim.done) { job.k = k; job.sim = simOf(job.layers[k], true); }
    job.only = true;
  }

  return {
    handle(msg) {
      if (msg.type === 'start') return start(msg);
      if (msg.type === 'stop') { job = null; return; }
      if (!job || msg.id !== job.id) return;
      try {
        if (msg.type === 'grab') { wake(msg.layer || 0); job.sim.grab(msg.i); }
        if (msg.type === 'spin') { wake(msg.layer || 0); job.sim.spin(); }
        if (msg.type === 'pull') job.sim?.pull(msg.p);
        if (msg.type === 'release') job.sim?.release();
        kick();
      } catch (e) { fail(job.id, e); }
    },
  };
}
