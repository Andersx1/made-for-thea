import shape from './shapes.js';
import skirt from './skirt.js';
import { top, dress } from './top.js';
import { trousers, jeans } from './trousers.js';
import { jacket } from './jacket.js';
import traced, { custom } from './traced.js';

export const TYPES = { skirt, top, dress, trousers, jeans, jacket, shape, custom, traced };
// Extra cards on the "new garment" screen that start a type with preset options.
export const PRESETS = [
  ['sundress', 'dress', '🌻', 'Sundress', 'Strappy bodice, shirred back, gathered skirt with pockets.', { neckline: 'strappy', back: 'shirred', closure: 'none', skirtStyle: 'gathered', fullness: '1.8', pockets: 'inseam' }],
];

const choicesOf = (op, o) => (typeof op.choices === 'function' ? op.choices(o) : op.choices);
export const visible = (op, o) => !op.show || op.show(o);
export const optionChoices = choicesOf;

// Fill in missing options with defaults and snap select values to a currently valid choice
// (e.g. switching to a wrap skirt drops the "facing" finish it can't have).
export function normalize(T, o, m) {
  for (const op of T.options) {
    if (o[op.key] === undefined) o[op.key] = typeof op.def === 'function' ? op.def(m, o) : op.def;
    const ch = choicesOf(op, o);
    if (ch && !ch.some((c) => c[0] == o[op.key])) o[op.key] = ch[0][0];
  }
  return o;
}
// Shown on the "new garment" screen as coming in later updates.
export const COMING = [
];
