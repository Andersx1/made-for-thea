// How things look in the 3D view: studio lighting, the weave of each fabric, stitching thread,
// and the colours of the fit map.
import * as THREE from '../../node_modules/three/build/three.module.js';

// Soft studio light to reflect in the fabric: a grey room with a big light overhead and softer
// ones in front and to the sides. Built once into an environment map.
export function studio(renderer) {
  const room = new THREE.Scene(), box = (w, h, d, x, y, z, v, side = THREE.FrontSide) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v), side }));
    m.position.set(x, y, z); room.add(m);
  };
  box(100, 100, 100, 0, 0, 0, 0.45, THREE.BackSide);
  box(60, 1, 60, 0, 48, 0, 7); // overhead
  box(40, 50, 1, 15, 5, 48, 3.5); // front
  box(1, 50, 40, -48, 5, 10, 2.5); box(1, 50, 40, 48, 5, -10, 1.5); // sides
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(room, 0.04).texture;
  pm.dispose();
  return tex;
}

// ---------- fabric ----------
// weave: [pattern, size of one repeat (cm), depth]. Drawn a few times bigger than real threads so it
// reads on screen when you zoom in; from further away it blends smooth, as real cloth does.
const KINDS = {
  denim: { weave: ['twill', 0.6, 1.4], rough: 0.95, tint: true },
  cotton: { weave: ['plain', 0.4, 0.7], rough: 0.9 },
  linen: { weave: ['slub', 0.7, 1.3], rough: 0.95 },
  rayon: { weave: ['plain', 0.25, 0.3], rough: 0.6, sheen: 0.5 },
  chiffon: { weave: ['plain', 0.3, 0.4], rough: 0.6, sheen: 0.7 },
  jersey: { weave: ['knit', 0.5, 0.9], rough: 0.85 },
};
const weaves = new Map(), photos = new Map();
function weaveCanvas(pattern) {
  const n = 64, c = document.createElement('canvas'), ctx = c.getContext('2d'), img = ctx.createImageData(n, n), TAU = Math.PI * 2;
  c.width = c.height = n;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const thick = Array.from({ length: 16 }, () => (pattern === 'slub' ? 0.55 + 0.45 * rnd() : 1)); // linen's threads vary
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v;
    if (pattern === 'twill') v = (0.5 + 0.5 * Math.sin(TAU * (x + y) / 16)) * (0.8 + 0.2 * Math.sin(TAU * (x - y) / 8)); // diagonal ribs
    else if (pattern === 'knit') { const u = (x % 16) / 16, w = (y % 16) / 16; v = Math.sqrt(Math.sin(Math.PI * u)) * (0.65 + 0.35 * Math.cos(TAU * (w - Math.abs(u - 0.5)))); } // columns of V stitches
    else { // plain weave: threads going over and under each other
      const cx = Math.floor(x / 8), cy = Math.floor(y / 8), over = (cx + cy) % 2, across = ((over ? y : x) % 8 + 0.5) / 8, along = ((over ? x : y) % 8 + 0.5) / 8;
      v = Math.sin(Math.PI * across) * (0.7 + 0.3 * Math.sin(Math.PI * along)) * thick[over ? cy : 8 + cx];
    }
    const k = (y * n + x) * 4, b = Math.round(255 * Math.max(0, Math.min(1, v)));
    img.data[k] = img.data[k + 1] = img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function weave(renderer, pattern, tint) {
  const key = pattern + (tint ? ':tint' : '');
  if (!weaves.has(key)) {
    let c = weaveCanvas(pattern);
    if (tint) { // denim's paler threads showing between the blue ones
      const d = document.createElement('canvas'), ctx = d.getContext('2d'); d.width = d.height = c.width;
      ctx.fillStyle = '#c4c4c4'; ctx.fillRect(0, 0, d.width, d.height); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.24; ctx.drawImage(c, 0, 0); c = d;
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (tint) t.colorSpace = THREE.SRGBColorSpace;
    weaves.set(key, t);
  }
  return weaves.get(key);
}
function photo(image, onLoad) {
  if (!photos.has(image)) {
    const t = new THREE.TextureLoader().load(image, onLoad);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    photos.set(image, t);
    if (photos.size > 4) { const old = photos.keys().next().value; photos.get(old).dispose(); photos.delete(old); }
  }
  return photos.get(image);
}

// Cloth of one fabric type in a colour (or, with image, a photo of the real fabric). The cloth's uv is in pattern cm.
export function clothMaterial(renderer, kind, { color, image = null, scale = 20, side = THREE.DoubleSide, onLoad } = {}) {
  const K = KINDS[kind] || KINDS.cotton, [pattern, size, depth] = K.weave;
  const mat = K.sheen ? new THREE.MeshPhysicalMaterial({ sheen: K.sheen, sheenRoughness: 0.4, sheenColor: 0xffffff }) : new THREE.MeshStandardMaterial();
  mat.color.set(image ? '#ffffff' : color); mat.roughness = K.rough; mat.side = side; mat.shadowSide = THREE.DoubleSide;
  mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 1; // seam lines and stitches draw on top
  mat.bumpMap = weave(renderer, pattern); mat.bumpMap.repeat.set(1 / size, 1 / size); mat.bumpScale = depth;
  if (image) { mat.map = photo(image, onLoad); mat.map.repeat.set(1 / scale, 1 / scale); }
  else if (K.tint) { mat.map = weave(renderer, pattern, true); mat.map.repeat.set(1 / size, 1 / size); }
  return mat;
}

// ---------- stitching ----------
let dashes = null;
// Thread for lines of stitching: drawn as short dashes close up, a fine line from further away.
export function threadMaterial(color, opacity = 1) {
  if (!dashes) {
    const c = document.createElement('canvas'), ctx = c.getContext('2d'); c.width = 16; c.height = 1;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 11, 1);
    dashes = new THREE.CanvasTexture(c); dashes.wrapS = THREE.RepeatWrapping; dashes.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshStandardMaterial({ color, map: dashes, roughness: 0.7, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
}
export const seamMaterial = () => new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
// A darker shade of a colour: matching thread, and the shadow line of a seam.
export const shade = (hex, k = 0.72) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

// ---------- fit map ----------
export const FIT_CSS = { loose: '#4f7fd9', right: '#e9e4dc', snug: '#f2c744', tight: '#e5484d' };
const stops = () => Object.fromEntries(Object.entries(FIT_CSS).map(([k, v]) => [k, new THREE.Color(v)]));
let FITC = null;
export const fitMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
// Writes the colour of each fit value (-1 loose … 0 just right … 1 tight) into rgb.
export function fitColors(fit, base, n, rgb) {
  FITC ||= stops();
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const f = fit[base + i];
    if (f <= 0) c.lerpColors(FITC.right, FITC.loose, -f);
    else if (f < 0.5) c.lerpColors(FITC.right, FITC.snug, f * 2);
    else c.lerpColors(FITC.snug, FITC.tight, f * 2 - 1);
    rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b;
  }
}
