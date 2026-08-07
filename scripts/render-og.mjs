/**
 * Renders the social preview card to public/og.png at 1200x630.
 *
 * Deliberately not wired into the build. It needs a native canvas, and adding
 * that to devDependencies would make every clone of this repo download a
 * binary to produce one file that changes about once a year.
 *
 *   npm install --no-save @napi-rs/canvas
 *   node scripts/render-og.mjs
 *
 * The card modules are TypeScript, so they are bundled with the bundler Vite
 * already brings along rather than adding another tool. In this checkout that
 * is esbuild, at node_modules/.bin/esbuild; a newer Vite that ships rolldown
 * instead would need that one name changed below.
 *
 * The grade on the card is the real one. The frame comes from src/sample.ts,
 * the LUT is built by src/generate.ts, written out as .cube text and read back
 * through the parser in src/cube.ts, and every pixel of the right hand panel
 * goes through gradeBuffer in src/analyze.ts, which is the same trilinear
 * lookup the fragment shader performs on the GPU. Approximating the colour on
 * a card for a tool whose only claim is that the colour is correct would be
 * the one unforgivable shortcut here.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const canvasModule = await import('@napi-rs/canvas').catch(() => null);
if (!canvasModule) {
  console.error('Missing canvas. Run: npm install --no-save @napi-rs/canvas');
  process.exit(1);
}
const { createCanvas, GlobalFonts } = canvasModule;

// ---------------------------------------------------------------------------
// Bundle the source the card needs
// ---------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'lutbox-og-'));
const entry = join(scratch, 'entry.ts');
const bundle = join(scratch, 'bundle.mjs');

writeFileSync(
  entry,
  `
import { drawSampleImage, SAMPLE_WIDTH, SAMPLE_HEIGHT } from ${JSON.stringify(join(root, 'src/sample.ts'))};
import { gradeBuffer, measure, summarize } from ${JSON.stringify(join(root, 'src/analyze.ts'))};
import { PRESETS, buildPreset, generateCubeText } from ${JSON.stringify(join(root, 'src/generate.ts'))};
import { parseCube } from ${JSON.stringify(join(root, 'src/cube.ts'))};

export {
  drawSampleImage,
  SAMPLE_WIDTH,
  SAMPLE_HEIGHT,
  gradeBuffer,
  measure,
  summarize,
  PRESETS,
  buildPreset,
  generateCubeText,
  parseCube,
};
`,
);

execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--log-level=warning',
    `--outfile=${bundle}`,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

const lib = await import(`file://${bundle}`);

// ---------------------------------------------------------------------------
// Card geometry and palette
// ---------------------------------------------------------------------------

const W = 1200;
const H = 630;

/**
 * Two copies of the same frame rather than one frame cut down the middle.
 *
 * A single frame with a diagonal seam looks more like a screenshot of the
 * split view, but on this sample it argues badly: the sun sits on one side of
 * any seam and the step wedge is a ramp, so a viewer cannot tell how much of
 * the difference at the cut is the LUT and how much is the picture. Two full
 * copies remove the doubt. Every element appears twice, identically framed,
 * and the only thing that differs is the grade. It is also a mode the page
 * actually has.
 */
const PANEL_W = W / 2;
const IMAGE_H = 432;

/**
 * The crop into the 1600x1000 sample.
 *
 * Centred on the neutral step wedge so both ends of it survive in each panel.
 * The wedge is the part of the frame that makes a tone change measurable by
 * eye: sixteen greys, in the same place in both panels, so a lifted black or a
 * rolled off white is a difference you can point at.
 */
const CROP_X = 106;
const CROP_W = 1388;

// Straight out of src/styles.css. The card has to look like the page.
const BG = '#0a0a0b';
const LINE = '#23232a';
const TEXT = '#e7e7ea';
const DIM = '#83838e';
const DIMMER = '#5e5e68';
const ACCENT = '#d18e46';

const URL_LABEL = 'keivanmalhani.github.io/lutbox';
const TAGLINE = 'Apply a .cube LUT to your own photo at full resolution, in the browser.';

/**
 * The preset the card advertises.
 *
 * Blue Hour, not the Warm Contrast the page happens to load with. The sample
 * frame is a warm sunset, so a warm LUT lands on it almost invisibly, and a
 * preview card whose two halves look the same is worse than no card at all.
 * Averaged over every channel of every pixel, Blue Hour moves the frame by
 * 17.7 levels of 255 against Warm Contrast's 9.8 and Filmic Rolloff's 3.3.
 */
const PRESET_ID = 'blue-hour';

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * Use whatever the rendering machine has.
 *
 * The card is rendered once and committed, so the fonts only have to be right
 * on the machine that runs this; the alternative is checking a font binary
 * into a repository that currently ships no runtime dependency of any kind.
 * The name that was actually used is printed at the end.
 */
function pickFamily(candidates, fallback) {
  const available = new Set(GlobalFonts.families.map((item) => item.family));
  for (const name of candidates) {
    if (available.has(name)) return name;
  }
  return fallback;
}

const SANS = pickFamily(
  ['Inter', 'Helvetica Neue', 'Arial', 'Liberation Sans', 'DejaVu Sans', 'FreeSans'],
  'sans-serif',
);
const MONO = pickFamily(
  ['SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'DejaVu Sans Mono', 'FreeMono'],
  'monospace',
);

function font(weight, size, family) {
  return weight + ' ' + size + 'px ' + JSON.stringify(family);
}

// ---------------------------------------------------------------------------
// The frame, graded for real
// ---------------------------------------------------------------------------

const preset = lib.PRESETS.find((item) => item.id === PRESET_ID);
if (!preset) {
  console.error('No preset with id ' + PRESET_ID);
  process.exit(1);
}

// Round trip through .cube text so the card is drawn from a table the parser
// produced, not from the generator's in-memory floats. If the writer and the
// parser ever disagree, the card is a place that shows it.
const cubeText = lib.generateCubeText(preset.params, lib.buildPreset(preset));
const lut = lib.parseCube(cubeText, { name: preset.label + '.cube' });
const slots = [{ lut, strength: 1, enabled: true }];

const original = createCanvas(lib.SAMPLE_WIDTH, lib.SAMPLE_HEIGHT);
lib.drawSampleImage(original);
const source = original
  .getContext('2d')
  .getImageData(0, 0, lib.SAMPLE_WIDTH, lib.SAMPLE_HEIGHT);

// Grade at the sample's own resolution and let the draw call resample
// afterwards, which is the order the GPU path uses: every source pixel goes
// through the table, and the scaling down happens to the result.
const graded = createCanvas(lib.SAMPLE_WIDTH, lib.SAMPLE_HEIGHT);
const gradedCtx = graded.getContext('2d');
const gradedImage = gradedCtx.createImageData(lib.SAMPLE_WIDTH, lib.SAMPLE_HEIGHT);
gradedImage.data.set(lib.gradeBuffer(slots, source.data));
gradedCtx.putImageData(gradedImage, 0, 0);

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';

ctx.fillStyle = BG;
ctx.fillRect(0, 0, W, H);

function panel(sourceCanvas, x) {
  ctx.drawImage(
    sourceCanvas,
    CROP_X,
    0,
    CROP_W,
    lib.SAMPLE_HEIGHT,
    x,
    0,
    PANEL_W,
    IMAGE_H,
  );
}

panel(original, 0);
panel(graded, PANEL_W);

// The seam, in the same white the split handle uses on the page. No grip
// circle: the handle belongs to the split view, and this is the side by side.
ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
ctx.fillRect(PANEL_W - 1.5, 0, 3, IMAGE_H);

/** The little dark chips the stage puts its ORIGINAL and GRADED labels on. */
function label(text, x, y) {
  ctx.font = font(400, 16, MONO);
  const padX = 11;
  const padY = 7;
  const width = ctx.measureText(text).width + padX * 2;
  const height = 16 + padY * 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#f0f0f2';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + height / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

label('ORIGINAL', 24, 24);
label('GRADED', PANEL_W + 24, 24);

// Footer.
ctx.fillStyle = BG;
ctx.fillRect(0, IMAGE_H, W, H - IMAGE_H);
ctx.fillStyle = LINE;
ctx.fillRect(0, IMAGE_H, W, 1);

const ROW_1 = IMAGE_H + 62;
const ROW_2 = IMAGE_H + 98;
const ROW_3 = IMAGE_H + 148;
const MARGIN = 46;

ctx.textAlign = 'left';
ctx.fillStyle = TEXT;
ctx.font = font(700, 46, SANS);
ctx.fillText('lutbox', MARGIN, ROW_1);

ctx.fillStyle = DIM;
ctx.font = font(400, 19, SANS);
ctx.fillText(TAGLINE, MARGIN, ROW_2);

ctx.textAlign = 'right';
ctx.fillStyle = ACCENT;
ctx.font = font(600, 26, SANS);
ctx.fillText(lut.title, W - MARGIN, ROW_1 - 6);

ctx.fillStyle = DIM;
ctx.font = font(400, 18, MONO);
ctx.fillText(URL_LABEL, W - MARGIN, ROW_2);

// The sentence the page writes about this LUT, unedited. It is the other half
// of what the tool does, and it is the line nobody else's card has.
//
// Its length depends on the LUT, so the size is chosen to fit rather than
// fixed. Shrinking is better than wrapping here: a second line would push the
// footer taller than the frame can spare.
const summary = lib.summarize(lib.measure(slots));
const summaryWidth = W - MARGIN * 2;
let summarySize = 17;
ctx.font = font(400, summarySize, SANS);
while (summarySize > 11 && ctx.measureText(summary).width > summaryWidth) {
  summarySize -= 0.5;
  ctx.font = font(400, summarySize, SANS);
}
ctx.textAlign = 'left';
ctx.fillStyle = DIMMER;
ctx.fillText(summary, MARGIN, ROW_3);

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const out = join(root, 'public/og.png');
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(out, canvas.toBuffer('image/png'));
rmSync(scratch, { recursive: true, force: true });

console.log('wrote  ' + out + ' (' + W + 'x' + H + ', ' + statSync(out).size + ' bytes)');
console.log('lut    ' + lut.title + ', ' + lut.type + ' ' + lut.size + ', parsed from .cube text');
console.log('says   ' + summary);
console.log(
  'fit    summary at ' +
    summarySize +
    'px is ' +
    Math.round(ctx.measureText(summary).width) +
    'px of ' +
    summaryWidth,
);
console.log('fonts  ' + SANS + ' / ' + MONO);
