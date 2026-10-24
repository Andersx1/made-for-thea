// Body measurements (cm). Defaults are an average adult (about UK 12 / US 8 / EU 40, 165 cm tall).
// [group, key, label, how-to-measure tip, default]
export const FIELDS = [
  ['Overall', 'height', 'Height', 'Stand straight against a wall, barefoot. Measure floor to top of head.', 165],
  ['Upper body', 'bust', 'Bust', 'Around the fullest part of the bust, tape level all the way round.', 92],
  ['Upper body', 'highBust', 'High bust', 'Around the chest above the bust, under the arms.', 88],
  ['Upper body', 'underbust', 'Underbust', 'Around the ribcage just below the bust.', 76],
  ['Upper body', 'waist', 'Waist', 'Around the natural waist: the narrowest part, where you bend sideways. Tie a string there to find it.', 74],
  ['Upper body', 'neck', 'Neck', 'Around the base of the neck, where a necklace sits.', 37],
  ['Upper body', 'shoulderWidth', 'Shoulder width', 'Across the back from one shoulder tip (bone) to the other.', 39],
  ['Upper body', 'shoulderLength', 'Shoulder length', 'From the side of the neck to the shoulder tip.', 12.5],
  ['Upper body', 'backWidth', 'Across back', 'Across the back between the arm creases, about 10 cm below the neck.', 35],
  ['Upper body', 'frontWidth', 'Across front', 'Across the chest between the arm creases, about 5 cm below the collarbone.', 33],
  ['Upper body', 'bustSpan', 'Bust point to bust point', 'Straight across between the two bust points.', 18],
  ['Upper body', 'shoulderToBust', 'Shoulder to bust point', 'From the side of the neck down to the bust point.', 25],
  ['Upper body', 'backLength', 'Back length (nape to waist)', 'From the bone at the back of the neck down the spine to the waist string.', 41],
  ['Upper body', 'frontLength', 'Front length', 'From the side of the neck, over the bust point, down to the waist.', 44],
  ['Upper body', 'armholeDepth', 'Armhole depth', 'From the shoulder tip straight down to level with the underarm.', 21],
  ['Arms', 'armLength', 'Arm length', 'From the shoulder tip, over a slightly bent elbow, to the wrist bone.', 59],
  ['Arms', 'bicep', 'Upper arm', 'Around the fullest part of the upper arm.', 29],
  ['Arms', 'elbow', 'Elbow', 'Around the elbow with the arm bent.', 26],
  ['Arms', 'wrist', 'Wrist', 'Around the wrist bone.', 16],
  ['Lower body', 'highHip', 'High hip', 'Around the hip bones, about 10 cm below the waist.', 90],
  ['Lower body', 'hip', 'Hip', 'Around the fullest part of the hips and bottom, feet together.', 100],
  ['Lower body', 'waistToHip', 'Waist to hip', 'Down the side from the waist string to the fullest part of the hip.', 20.5],
  ['Lower body', 'waistToKnee', 'Waist to knee', 'Down the side from the waist to the middle of the knee.', 59],
  ['Lower body', 'waistToFloor', 'Waist to floor', 'Down the side from the waist to the floor, barefoot.', 104],
  ['Lower body', 'crotchDepth', 'Crotch depth (seated)', 'Sit on a hard flat chair. Measure down the side from the waist to the seat.', 27],
  ['Lower body', 'crotchLength', 'Crotch length', 'From the front waist, between the legs, up to the back waist.', 66],
  ['Lower body', 'inseam', 'Inside leg', 'From the crotch down the inside of the leg to the floor.', 77],
  ['Lower body', 'thigh', 'Thigh', 'Around the fullest part of one thigh.', 58],
  ['Lower body', 'knee', 'Knee', 'Around the knee.', 38],
  ['Lower body', 'calf', 'Calf', 'Around the fullest part of the calf.', 36],
  ['Lower body', 'ankle', 'Ankle', 'Around the ankle bone.', 24],
];
export const LABEL = Object.fromEntries(FIELDS.map((f) => [f[1], f[2]]));
export const defaults = () => Object.fromEntries(FIELDS.map((f) => [f[1], f[4]]));

// Gentle sanity checks so a typo (e.g. 47 instead of 74) is noticed before cutting fabric.
export function checks(m) {
  const w = [];
  for (const [, k, label] of FIELDS) if (!(m[k] > 0)) w.push(`${label} is missing.`);
  if (m.waist > m.hip + 5) w.push('Waist is much bigger than hip. Double-check both.');
  if (m.waist > m.bust + 10) w.push('Waist is much bigger than bust. Double-check both.');
  if (m.underbust > m.bust) w.push('Underbust is bigger than bust.');
  if (m.highBust > m.bust + 8) w.push('High bust is much bigger than bust.');
  if (m.waistToHip > m.waistToKnee * 0.6) w.push('Waist to hip looks long compared with waist to knee.');
  if (m.waistToKnee > m.waistToFloor) w.push('Waist to knee is longer than waist to floor.');
  if (m.crotchDepth > m.waistToKnee * 0.75) w.push('Crotch depth looks long. Measure it seated on a hard chair.');
  if (m.thigh > m.hip * 0.8) w.push('Thigh is very large compared with hip. Measure one leg only.');
  return w;
}
