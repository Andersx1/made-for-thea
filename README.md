# Made for Thea

Draft sewing patterns from your own measurements, adjust them, print them at true size on home printer paper, and follow the sewing steps.

## What it does today

- **Measure:** profiles for each person you sew for, with a tip on how to take every measurement.
- **Design:**
  - Tops and blouses: fitted, regular or relaxed, shaped with darts or **princess seams**, with 6 necklines (round, scoop, V, square, sweetheart, boat) or camisole straps. Sleeves: sleeveless, cap, short, puff, flutter, elbow, ¾ or long. Length: cropped, waist, hip or tunic. Back zip, front buttons or pull-over, with a neck facing or bias binding.
  - Dresses: any bodice above, joined to a gathered, A-line, circle, straight or pencil skirt, with in-seam pockets. The **Sundress** preset has straps or shoulder ties, a lined bodice and a shirred stretchy back.
  - Trousers & shorts: straight, slim, wide or flared legs, in full, ankle, capri, bermuda or shorts length. High, mid or low rise, a front fly or elastic waist, slant or in-seam pockets, and back patch pockets. Stretch fabric reduces the ease.
  - Denim jacket (trucker style): fitted, regular or oversized; cropped, classic or long; set-in or dropped shoulder. Includes front and back yokes, panel seams, a button stand, collar on a stand, cuffed sleeves, a waistband and flap chest pockets.
  - Jeans: skinny, slim, straight, bootcut or wide, with a back yoke, scoop pockets with facings and bags, coin pocket, fly, contoured waistband, belt loops and back pockets.
  - Skirts: straight, pencil (with back vent), A-line, full/half/quarter circle, gathered or tiered, and wrap.
  - Waist finishes: waistband, facing, or elastic. Zip at the back or side, plus in-seam or patch pockets.
  - Simple shapes: tote bag, apron, scrunchie, cushion cover, or any rectangle or circle.
  - Traced patterns: copy pieces from an existing paper pattern (see Trace below).
  - **Your own design:** start from a blank garment and draw your own pieces in the Pattern editor: ✏️ Draw a piece, then click each corner (Shift+click for points a curved edge passes through), or start from a rectangle. A **body guide** beside the pieces shows her shoulder, bust, waist and hip (a quarter of each, the width one front piece needs) and her knee and floor lengths at true size, so pieces are drawn big enough.
- **Pattern:**
  - Drag points and curve handles, and double-click an edge to add a point.
  - Set the seam allowance per edge, add notches, and rotate, flip or duplicate pieces.
  - Pieces you edit by hand are kept when you change the design options.
  - **Seam check:** compares edges that sew together (side seams, shoulders, sleeve cap vs armhole, waist seams, inside legs, crotch vs your measurement) and flags any that won't match, including after your own edits.
- **Print:** true-scale PDF tiled on A4 or Letter, a cover page with a test square and a page map, an "arrange for fewest pages" button, and a copy-shop A0 / 36" roll option.
- **Projector mode:** full-screen white lines on black at a calibrated true scale, to project the pattern straight onto fabric. Calibrate once with the 10 cm square; drag or use the arrow keys to move the pattern; mirror it if your projector needs that.
- **Fabric:** a cutting layout on folded or open fabric (110/140/150 cm or 45"/58"/60"), with grainlines along the selvedge and fold pieces on the fold. Shows how much to buy, with separate layouts for lining and pocketing, and a list of pieces to interface. Drag pieces to rearrange; print or save the layout.
- **3D:** a real fabric simulation. Pieces you drew, traced or duplicated join in too: select one in Pattern, choose what it is under "In 3D" (bodice front, sleeve, skirt back…), then click each edge and choose what it sews to. Your pattern pieces, including any you edited by hand, are sewn together along their seams (darts closed, gathers gathered) and draped by gravity on a realistic body shaped to your measurements. Pick a fabric type (denim, cotton, linen, rayon, chiffon or jersey) to see how it hangs, and a colour or a photo of your actual fabric. It's a good guide to the look and hang; a quick toile is still the way to check fit.
- **Sew:** a step-by-step checklist, the notions you'll need, fabric suggestions, and notes.
- **Sketch:** front and back figures drawn from your measurements. Draw with a pen (pressure-sensitive with a tablet), a marker or text, and fill shapes with a colour or a photo of your fabric. Organise your drawing in layers and export a picture.
- **Trace:**
  1. Photograph or scan a paper pattern.
  2. Set the scale with a ruler (2 clicks) or a known rectangle such as a sheet of A4 (4 clicks), which also corrects photos taken at an angle.
  3. Click around each piece. Shift+click marks a sharp corner.

  Traced pieces can be edited, printed and laid out like drafted ones.


## Sewing tips the app assumes

- **Always print page 1 first and measure the test square.** Print at 100% / "Actual size", never "Fit to page".
- Patterns drafted from measurements are a starting point. **Make a quick test version (toile) in cheap fabric** before cutting good fabric, then adjust the pattern.
- The solid outer line is the cutting line; the dashed inner line is where you stitch.

## Installing

Download the installer from the GitHub **Releases** page.

- **Windows:** run `Made for Thea Setup x.y.z.exe`. Windows may say "Windows protected your PC"; click **More info → Run anyway**. This happens because the app isn't code-signed.
- **Mac:** open the `.dmg` and drag the app into Applications. The first time, **right-click the app → Open → Open**, because it isn't signed with a paid Apple certificate.

**Updates:** the bottom of the sidebar shows the version and a **Check for updates** button. The app also checks once when it starts and the button says "Update available" when there is one. It opens the download page; install the new version the same way as the first time.

Projects save as `.clothes` files (File → Save). Your current work is also saved automatically.

## For the developer

```bash
npm install
npm start          # run the app
npm test           # drafting + geometry checks
npm run dist       # build an installer for this computer's OS into dist/
```

Mac and Windows installers are built by GitHub Actions (`.github/workflows/build.yml`):

1. Put this folder in its own GitHub repository and push it.
2. Tag a version and push the tag: `git tag v0.1.0 && git push --tags`.
3. When the "Build installers" action finishes, the `.exe` and `.dmg` are attached to a new Release.

The app is plain HTML/CSS/JS (no framework) in `src/`, with Electron in `main.js` / `preload.js`. The 3D view uses three.js, bundled with the app so it works offline. The cloth simulator is in `src/js/sim/`: `body.js` shapes the MakeHuman base body (CC0, made with [MakeHuman](http://www.makehumancommunity.org)) to the measurements, `sdf.js` builds the body's collision field, `mesh.js` turns pattern pieces into fabric meshes, `garment.js` places them around the body and pairs up the seams by their edge names, and `solver.js` drapes them (XPBD). The body data in `src/assets/body-data.js` is generated by `node tools/build-body.mjs`. Garment drafting lives in `src/js/garments/`. Each garment exports its options, a `draft(measurements, options)` that returns pattern pieces, and its sewing `steps`.
