// Internal unit is cm. Shown as cm, or inches with 1/8" fractions like a tape measure.
let metric = true;
export const setMetric = (v) => { metric = v; };
export const isMetric = () => metric;

const FR = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
const UF = { '⅛': '1/8', '¼': '1/4', '⅜': '3/8', '½': '1/2', '⅝': '5/8', '¾': '3/4', '⅞': '7/8' };

export function fmt(cm) {
  if (!isFinite(cm)) return '';
  if (metric) return `${+cm.toFixed(1)} cm`;
  const e = Math.round(Math.abs(cm) / 2.54 * 8), w = Math.floor(e / 8), f = e % 8;
  return `${cm < 0 ? '-' : ''}${w || !f ? w : ''}${f ? (w ? ' ' : '') + FR[f] : ''}"`;
}

export const fmtArea = (cm2) => (metric ? `${(cm2 / 1e4).toFixed(2)} m²` : `${(cm2 / 6.4516 / 1296).toFixed(2)} sq yd`);
export const fmtFabric = (cm) => (metric ? `${(Math.ceil(cm / 10) / 10).toFixed(1)} m` : `${Math.ceil(cm / 2.54 / 9) / 4} yd`);

// Accepts "12", "12.5", "12 3/8", "12⅜\"", "3/4 in", "30 cm", "1.2 m", "45mm".
// A bare number is in the current unit.
export function parseLen(s) {
  s = String(s).trim().toLowerCase().replace(/,/g, '.').replace(/[⅛¼⅜½⅝¾⅞]/g, (c) => ' ' + UF[c]).replace(/\s+/g, ' ').trim();
  let m = s.match(/^(-?\d*\.?\d+)\s*(mm|cm|m)$/);
  if (m) return +m[1] * { mm: 0.1, cm: 1, m: 100 }[m[2]];
  m = s.match(/^(-?\d*\.?\d+)?\s*(?:(\d+)\/(\d+))?\s*("|in|inch|inches)?$/);
  if (!m || (m[1] == null && m[2] == null) || m[3] === '0') return NaN;
  const v = (m[1] ? +m[1] : 0) + (m[2] ? +m[2] / +m[3] : 0);
  return m[4] || !metric ? v * 2.54 : v;
}
