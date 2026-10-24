// A garment made of pieces traced from an existing paper pattern (no drafting).
const traced = {
  id: 'traced', name: 'Traced pattern', icon: '📷', blurb: 'Copy an existing paper pattern from a photo or scan, then edit, print and lay it out like any other.',
  needs: [],
  title: () => 'Traced pattern',
  options: [],
  draft: () => ({ pieces: [], warnings: [] }),
  steps: () => ({
    steps: ['Pre-wash and press your fabric.', 'Print the traced pattern at 100% and check the test square.', 'Hold the printed pieces against the original paper pattern to check the tracing.', 'Cut out the pieces and transfer the markings from the original pattern.', 'Sew following the original pattern\'s instructions.'],
    notions: ['As listed on the original pattern'], fabrics: [],
  }),
};

// A blank garment for designing your own pieces in the Pattern editor.
export default traced;

export const custom = {
  ...traced, id: 'custom', name: 'Your own design', icon: '✏️', blurb: 'Draw your own pattern pieces, see them sewn up in 3D, then lay them out and print them.',
  title: () => 'Your own design',
  steps: () => ({
    steps: ['Pre-wash and press your fabric.', 'Print the pattern at 100% and check the test square.', 'Make a quick toile in cheap fabric and adjust the pieces.', 'Cut out the pieces following the fabric layout.', 'Sew the edges you matched in the Pattern editor, then hem the open edges.'],
    notions: ['Thread', 'Any zip, buttons or elastic your design needs'], fabrics: [],
  }),
};
