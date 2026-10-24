// Tops/blouses and dresses (including sundresses) built from the bodice + sleeve blocks.
// Dresses add a skirt drafted by the skirt module with the bodice's waist ease, so the waist seams match.
import { bodicePieces, sleevePiece, armholeLen, frame, EASE, NECKLINES, SLEEVES, LENGTHS, tieStrap } from './bodice.js';
import skirt from './skirt.js';

const strappy = (o) => o.neckline === 'strappy';
const sleeved = (o) => !strappy(o) && o.sleeve !== 'none';
const defStrap = (m, o) => { const F = frame(m, { fit: o.fit || 'regular' }); return Math.round(F.BP.y - 12 + F.SD + 2 + 1); };

const bodiceOptions = (camisoleLabel) => [
  { key: 'neckline', label: 'Neckline', type: 'select', def: 'round', choices: [...NECKLINES, ['strappy', camisoleLabel]] },
  { key: 'straps', label: 'Straps', type: 'select', def: 'straps', choices: [['straps', 'Sewn straps'], ['ties', 'Shoulder ties']], show: strappy },
  { key: 'strapWidth', label: 'Strap width', type: 'len', def: () => 2.5, show: strappy },
  { key: 'strapLength', label: 'Strap length', type: 'len', def: defStrap, show: (o) => strappy(o) && o.straps !== 'ties' },
  { key: 'sleeve', label: 'Sleeves', type: 'select', def: 'short', choices: SLEEVES, show: (o) => !strappy(o) },
  { key: 'fit', label: 'Fit', type: 'select', def: 'regular', choices: [['fitted', 'Fitted'], ['regular', 'Regular'], ['relaxed', 'Relaxed']] },
  { key: 'shaping', label: 'Shaping', type: 'select', def: 'darts', choices: [['darts', 'Darts'], ['princess', 'Princess seams']], show: (o) => !strappy(o) },
  { key: 'closure', label: 'Opening', type: 'select', def: 'backzip', choices: (o) => strappy(o) ? [['backzip', 'Back zip'], ['none', 'None (pull-on)']] : [['backzip', 'Back zip'], ['buttons', 'Front buttons'], ['none', 'None (pull-over)']], show: (o) => !(strappy(o) && o.back === 'shirred') },
  { key: 'neckFinish', label: 'Neckline finish', type: 'select', def: 'facing', choices: [['facing', 'Facing'], ['binding', 'Bias binding']], show: (o) => !strappy(o) },
];

function finishing(m, o, pieces, warnings) {
  if (sleeved(o)) {
    const s = sleevePiece(m, o, armholeLen(pieces));
    pieces.push(s.p);
  }
  if (strappy(o) && o.straps === 'ties') {
    const i = pieces.findIndex((p) => p.key === 'strap');
    if (i >= 0) pieces.splice(i, 1, tieStrap(45, o.strapWidth));
  }
  if (o.closure === 'none' && o.fit === 'fitted' && !strappy(o)) warnings.push('A fitted top with no opening may not go over your head and shoulders. Use a stretch fabric, or choose a zip or buttons.');
  if (o.neckline === 'boat' && o.closure === 'none') warnings.push('Check the boat neck is wide enough to pull over your head before cutting.');
}

const fabricsTop = ['Cotton lawn', 'Cotton poplin', 'Linen', 'Rayon/viscose challis', 'Double gauze', 'Chambray'];

function bodiceSteps(m, o, { dress = false } = {}) {
  const S = [], notions = ['Matching thread'];
  if (o.fit !== 'relaxed') S.push('Recommended: sew a quick test bodice (toile) in cheap fabric and check the fit at the bust, waist and shoulders.');
  S.push('Cut out all pieces. Transfer darts, notches and button marks to the fabric.');
  if (!strappy(o) && o.neckFinish !== 'binding') { S.push('Fuse interfacing to the neck facings.'); notions.push('Lightweight fusible interfacing'); }
  if (o.closure === 'buttons') { S.push('Fuse interfacing along the front button edges.'); notions.push(`${Math.max(4, Math.round((dress ? 40 : 50) / 9))} buttons, about 12 mm`); }
  S.push(o.shaping === 'princess' && !strappy(o) ? 'Sew the princess seams: pin the side panels to the centre panels at the notches, ease the curve over the bust, sew, clip the curve and press toward the centre.' : 'Sew the bust darts (press them down) and the waist darts (press toward the centre).');
  if (strappy(o)) {
    S.push(o.straps === 'ties' ? 'Make the four ties: fold each in half lengthwise, sew, turn and press. Knot or finish one end.' : 'Make the straps: fold in half lengthwise, sew, turn right side out and press.');
    if (o.back === 'shirred') { S.push('Shirr the back panel: wind shirring elastic by hand onto the bobbin, then sew rows 1.5 cm apart along the marked lines. Steam to shrink.'); notions.push('Shirring elastic (1 reel)'); }
    S.push('Baste the straps to the right side of the bodice front at the marks (and the back marks if sewn straps).');
    S.push('Sew the bodice lining to the bodice along the top edge, with the straps sandwiched between. Understitch and turn the lining inside.');
    S.push('Try it on and adjust the strap length before stitching the back ends down.');
  } else {
    S.push('Sew the shoulder seams and press them open.');
    S.push(o.neckFinish === 'binding' ? 'Finish the neckline with bias binding: sew it on, trim, fold to the inside and topstitch.' : 'Sew the facing shoulder seams, then sew the facing to the neckline. Clip the curve, understitch, and turn the facing inside.');
    if (o.neckFinish === 'binding') notions.push(`${Math.round(m.neck + 30)} cm of bias binding for the neckline`);
    if (sleeved(o)) {
      S.push('Run two rows of easing stitches over the sleeve cap between the notches.');
      S.push('Pin the sleeves into the armholes flat, matching the shoulder notch and front/back notches. Ease the cap in and sew.');
      if (o.sleeve === 'puff') { S.push('Gather the puff sleeve cap evenly before setting it in.'); notions.push(`${Math.round(m.bicep + 2)} cm × 2 of 6 mm elastic for the sleeve hems`); }
    } else { S.push('Bind the armholes with bias binding.'); notions.push(`${Math.round(m.armholeDepth * 4.5 + 20)} cm of bias binding for the armholes`); }
  }
  return { S, notions };
}

const sideAndClose = (m, o, S, notions, len) => {
  if (o.closure === 'backzip' && !(strappy(o) && o.back === 'shirred')) { S.push('Insert an invisible zip in the centre back seam, then sew the rest of the seam below it.'); notions.push(`${len} cm invisible zip`); }
  S.push(sleeved(o) ? 'Sew each side seam and sleeve seam in one go, from the hem up through the underarm to the sleeve hem.' : 'Sew the side seams and finish the seam allowances.');
};

export const top = {
  id: 'top', name: 'Top / blouse', icon: '👚', blurb: 'Fitted or relaxed tops: 6 necklines, 8 sleeve styles, camisole straps, crop to tunic length.',
  needs: ['bust', 'highBust', 'waist', 'hip', 'neck', 'shoulderLength', 'backWidth', 'frontWidth', 'bustSpan', 'shoulderToBust', 'backLength', 'frontLength', 'armholeDepth', 'armLength', 'bicep', 'wrist', 'waistToHip'],
  title: (o) => strappy(o) ? 'Camisole' : `${{ crop: 'Cropped top', waist: 'Top', hip: 'Blouse', tunic: 'Tunic' }[o.length]}`,
  options: [...bodiceOptions('Camisole straps'), { key: 'length', label: 'Length', type: 'select', def: 'hip', choices: LENGTHS }],
  draft(m, o) {
    const { pieces } = bodicePieces(m, o), warnings = [];
    finishing(m, o, pieces, warnings);
    return { pieces, warnings };
  },
  steps(m, o) {
    const pre = ['Pre-wash and dry your fabric, then press it.', 'Print the pattern at 100% and check the test square.'];
    const { S, notions } = bodiceSteps(m, o);
    sideAndClose(m, o, S, notions, 40);
    S.push(o.sleeve === 'puff' ? 'Hem the sleeves with a narrow casing and thread elastic through.' : sleeved(o) ? 'Hem the sleeves.' : '', 'Hem the top: press up 1 cm then 1.5 cm and stitch.');
    if (o.closure === 'buttons') S.push('Mark and sew the buttonholes on the right front, then sew on the buttons.');
    S.push('Give the top a final press.');
    return { steps: [...pre, ...S.filter(Boolean)], notions, fabrics: fabricsTop };
  },
};

const SKIRTS = [['gathered', 'Gathered'], ['aline', 'A-line'], ['circle', 'Circle'], ['straight', 'Straight'], ['pencil', 'Pencil']];

export const dress = {
  id: 'dress', name: 'Dress', icon: '👗', blurb: 'Bodice + skirt with any neckline and sleeves. Pick "Sundress" for a strappy summer dress.',
  needs: [...top.needs, 'waistToKnee'],
  title: (o) => strappy(o) ? 'Sundress' : 'Dress',
  options: [
    ...bodiceOptions('Sundress straps'),
    { key: 'back', label: 'Back', type: 'select', def: 'zip', choices: [['zip', 'Zip'], ['shirred', 'Shirred (stretchy)']], show: strappy },
    { key: 'skirtStyle', label: 'Skirt', type: 'select', def: 'aline', choices: SKIRTS },
    { key: 'skirtLength', label: 'Skirt length', type: 'len', def: (m) => m.waistToKnee },
    { key: 'flare', label: 'Flare', type: 'select', def: 'medium', choices: [['slight', 'Slight'], ['medium', 'Medium'], ['full', 'Full']], show: (o) => o.skirtStyle === 'aline' },
    { key: 'fullness', label: 'Fullness', type: 'select', def: '1.8', choices: [['1.5', 'Light (1.5×)'], ['1.8', 'Medium (1.8×)'], ['2.2', 'Full (2.2×)']], show: (o) => o.skirtStyle === 'gathered' },
    { key: 'tiers', label: 'Tiers', type: 'select', def: '1', choices: [['1', 'One'], ['2', 'Two'], ['3', 'Three']], show: (o) => o.skirtStyle === 'gathered' },
    { key: 'circle', label: 'Circle', type: 'select', def: '0.5', choices: [['1', 'Full circle'], ['0.5', 'Half circle']], show: (o) => o.skirtStyle === 'circle' },
    { key: 'pockets', label: 'Pockets', type: 'select', def: 'inseam', choices: [['none', 'None'], ['inseam', 'In-seam']] },
  ],
  draft(m, o) {
    const { pieces } = bodicePieces(m, o, { forDress: true }), warnings = [];
    finishing(m, o, pieces, warnings);
    const pullOn = o.closure === 'none' || (strappy(o) && o.back === 'shirred');
    const so = { style: o.skirtStyle, length: o.skirtLength, fit: 'regular', flare: o.flare, fullness: o.fullness, tiers: o.tiers, circle: o.circle, pockets: o.pockets, taper: 2.5, vent: true };
    for (const op of skirt.options) if (so[op.key] === undefined) so[op.key] = typeof op.def === 'function' ? op.def(m, so) : op.def;
    Object.assign(so, { waist: 'none', zip: 'back', noZip: pullOn, waistEase: (EASE[o.fit] || EASE.regular)[1] });
    const sk = skirt.draft(m, so);
    for (const p of sk.pieces) {
      if (p.key !== 'pocket') { p.key = `skirt${p.key}`; if (!/^skirt/i.test(p.name)) p.name = `Skirt ${p.name.toLowerCase()}`; }
      pieces.push(p);
    }
    if (pullOn && ['straight', 'pencil'].includes(o.skirtStyle)) warnings.push('A straight or pencil skirt needs an opening to get over the hips. Choose a zip, or a fuller skirt.');
    return { pieces, warnings: [...warnings, ...sk.warnings] };
  },
  steps(m, o) {
    const pre = ['Pre-wash and dry your fabric, then press it.', 'Print the pattern at 100% and check the test square.'];
    const { S, notions } = bodiceSteps(m, o, { dress: true });
    S.push('Make the bodice side seams (and sleeve seams) now if the zip is in the back; otherwise after joining the skirt.');
    if (o.skirtStyle === 'gathered') S.push(+o.tiers > 1 ? 'Join the skirt tiers: gather each lower tier to fit the one above.' : 'Sew the skirt panels together at one side seam.');
    else if (['aline', 'straight', 'pencil'].includes(o.skirtStyle)) S.push('Sew the skirt darts and press them toward the centre.');
    if (o.pockets === 'inseam') S.push('Sew the pocket bags to the skirt side seams at the notches.');
    S.push('Sew the skirt side seams (leave the left side open above the notch if the zip is there).');
    if (o.skirtStyle === 'gathered') S.push('Gather the skirt top to fit the bodice waist, matching side seams and centres.');
    S.push('Sew the bodice to the skirt at the waist, right sides together. Press the seam up toward the bodice.');
    sideAndClose(m, o, S, notions, 55);
    if (o.skirtStyle === 'circle') S.push('Hang the dress for 24 hours so the bias can drop, then level the hem.');
    S.push(o.sleeve === 'puff' && !strappy(o) ? 'Hem the sleeves with a narrow casing and thread elastic through.' : sleeved(o) ? 'Hem the sleeves.' : '');
    S.push(o.skirtStyle === 'circle' ? 'Hem with a narrow rolled hem.' : 'Hem the skirt: press up 1 cm then 2 cm and stitch.');
    if (o.closure === 'buttons') S.push('Sew the buttonholes and buttons on the bodice front.');
    S.push('Give the dress a final press.');
    return { steps: [...pre, ...S.filter(Boolean)], notions, fabrics: strappy(o) ? ['Cotton lawn', 'Cotton poplin', 'Seersucker', 'Linen', 'Rayon challis', 'Broderie anglaise'] : fabricsTop };
  },
};
