// Project state, undo/redo (whole-project snapshots), autosave, and garment regeneration.
import { defaults } from './measure-data.js';
import { TYPES, normalize } from './garments/index.js';
import { bbox, offsetOutline, rotate90, flipX } from './geom.js';
import { setMetric } from './units.js';
import * as io from './io.js';

export const uid = () => Math.random().toString(36).slice(2, 9);
export const S = { project: null, path: null, tab: 'design', choosing: false, saved: true };

const subs = new Set();
export const subscribe = (f) => subs.add(f);
export const emit = () => subs.forEach((f) => f());

let hist = [], hi = -1, timer = 0;
// Undo snapshots keep big embedded images (photos, swatches) once, by reference, instead of 150 copies.
const blobs = new Map();
const pack = (o) => JSON.stringify(o, (k, v) => { if (typeof v === 'string' && v.length > 2000 && v.startsWith('data:')) { const id = `@img:${v.length}:${v.slice(-48)}`; blobs.set(id, v); return id; } return v; });
const unpack = (t) => JSON.parse(t, (k, v) => (typeof v === 'string' && v.startsWith('@img:') ? blobs.get(v) ?? v : v));
const autosave = () => { clearTimeout(timer); timer = setTimeout(() => io.autosaveWrite(JSON.stringify({ path: S.path, project: S.project })), 500); };

export function blankProject() {
  const id = uid();
  return { version: 1, name: 'My sewing project', units: /-(US|LR|MM)$/.test(navigator.language) ? 'imperial' : 'metric', profiles: [{ id, name: 'Me', m: defaults() }], garments: [], active: null };
}
export function load(project, path = null) {
  for (const p of project.profiles) p.m = { ...defaults(), ...p.m }; // older files gain new measurement fields
  S.project = project; S.path = path; S.choosing = !project.garments.length;
  setMetric(project.units !== 'imperial');
  hist = [pack(project)]; hi = 0; S.saved = !!path;
  autosave(); emit();
}
export function commit() {
  const t = pack(S.project);
  if (t === hist[hi]) return emit();
  hist = hist.slice(0, hi + 1); hist.push(t);
  if (hist.length > 150) hist.shift();
  hi = hist.length - 1; S.saved = false;
  setMetric(S.project.units !== 'imperial');
  autosave(); emit();
}
function restore() { S.project = unpack(hist[hi]); setMetric(S.project.units !== 'imperial'); S.saved = false; autosave(); emit(); }
export const undo = () => { if (hi > 0) { hi--; restore(); } };
export const redo = () => { if (hi < hist.length - 1) { hi++; restore(); } };
export async function save(as = false) {
  const p = await io.saveProject(JSON.stringify(S.project), S.project.name, as ? null : S.path);
  if (p || !io.isApp) { S.path = p || S.path; S.saved = true; autosave(); emit(); }
}

export const garment = () => S.project.garments.find((g) => g.id === S.project.active) || null;
export const profileOf = (g) => S.project.profiles.find((p) => p.id === g.profileId) || S.project.profiles[0];

// Re-draft a garment from its options. Pieces the user edited by hand are kept as they are;
// fresh pieces keep their position, rotation and flip.
export function regen(g) {
  const T = TYPES[g.type], m = profileOf(g).m;
  normalize(T, g.options, m);
  const { pieces, warnings = [] } = T.draft(m, g.options);
  const out = [];
  for (const np of pieces) {
    if ((g.removed || []).includes(np.key)) continue;
    const old = g.pieces.find((p) => p.key === np.key);
    if (old && old.edited) { out.push(old); continue; }
    np.id = old?.id || uid(); np.pos = old?.pos || null; np.turns = old?.turns || 0; np.flipped = !!old?.flipped; np.edited = false;
    if (old?.name && old.renamed) { np.name = old.name; np.renamed = true; }
    for (let i = 0; i < np.turns; i++) rotate90(np);
    if (np.flipped) flipX(np);
    out.push(np);
  }
  out.push(...g.pieces.filter((p) => p.custom));
  g.pieces = out; g.warnings = warnings;
  if (!g.renamed && T.title) g.name = T.title(g.options);
  if (out.some((p) => !p.pos)) arrange(g);
}
export function regenAll(profileId) { for (const g of S.project.garments) if (!profileId || g.profileId === profileId) regen(g); }

// Bottom-left packing within maxW cm: biggest pieces first, each placed as high (then as far
// left) as it fits. With rotate, a piece may be turned 90° if that ends up lower.
// ponytail: O(n³) candidate scan, fine for the ~20 pieces of a garment.
export function arrange(g, maxW = 110, { rotate = false, gap = 3 } = {}) {
  const placed = [], box = (p) => bbox(offsetOutline(p));
  const free = (x, y, w, h) => x + w <= maxW + 1e-6 && placed.every((r) => x >= r.x + r.w + gap - 1e-6 || x + w + gap <= r.x + 1e-6 || y >= r.y + r.h + gap - 1e-6 || y + h + gap <= r.y + 1e-6);
  const spot = (w, h) => {
    let best = null;
    for (const y of [0, ...placed.map((r) => r.y + r.h + gap)])
      for (const x of [0, ...placed.map((r) => r.x + r.w + gap)])
        if ((!best || y + h < best.y + h || (y === best.y && x < best.x)) && free(x, y, w, h)) best = { x, y };
    return best;
  };
  const items = g.pieces.map((p) => ({ p, b: box(p) })).sort((a, b) => b.b.w * b.b.h - a.b.w * a.b.h);
  for (const it of items) {
    let { b } = it, s = spot(b.w, b.h);
    if (rotate) {
      const s2 = spot(b.h, b.w);
      if (s2 && (!s || s2.y + b.w < s.y + b.h - 1)) { rotate90(it.p); it.p.turns = ((it.p.turns || 0) + 1) % 4; b = box(it.p); s = s2; }
    }
    s ||= { x: 0, y: Math.max(0, ...placed.map((r) => r.y + r.h + gap)) }; // wider than maxW: put it below everything
    it.p.pos = { x: s.x - b.x, y: s.y - b.y };
    placed.push({ x: s.x, y: s.y, w: b.w, h: b.h });
  }
}

export function addGarment(type, options = {}) {
  const T = TYPES[type];
  const g = { id: uid(), type, name: T.name, profileId: S.project.profiles[0].id, options: { ...options }, pieces: [], removed: [], done: {}, custom: [], notes: '' };
  regen(g);
  S.project.garments.push(g); S.project.active = g.id; S.choosing = false; S.tab = 'design';
  commit();
}
export function deleteGarment(id) {
  S.project.garments = S.project.garments.filter((g) => g.id !== id);
  S.project.active = S.project.garments[0]?.id || null;
  S.choosing = !S.project.active;
  commit();
}
