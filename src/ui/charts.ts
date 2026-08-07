/**
 * Every chart on the page, written out as SVG strings.
 *
 * No chart library. The plots are simple enough that a library would be more
 * code than this file, and generating the markup as text means the same
 * function draws the panel on screen and the exported PNG card.
 */

import type { CornerMove, Histogram, NeutralCurve } from '../analyze';
import { escapeText } from './dom';

export interface ChartTheme {
  background: string;
  panel: string;
  grid: string;
  axis: string;
  text: string;
  dim: string;
  accent: string;
  red: string;
  green: string;
  blue: string;
  reference: string;
}

export const DARK_THEME: ChartTheme = {
  background: '#0b0b0d',
  panel: '#111114',
  grid: '#212127',
  axis: '#2c2c34',
  text: '#e6e6ea',
  dim: '#82828d',
  accent: '#d18e46',
  red: '#d9584c',
  green: '#4fa96e',
  blue: '#5286cc',
  reference: '#3d3d46',
};

function fmt(value: number): string {
  return Math.abs(value) < 1e-4 ? '0' : value.toFixed(2);
}

function path(points: Array<[number, number]>): string {
  let out = '';
  for (let i = 0; i < points.length; i++) {
    out += (i === 0 ? 'M' : 'L') + fmt(points[i][0]) + ' ' + fmt(points[i][1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Neutral axis curve
// ---------------------------------------------------------------------------

export interface CurveOptions {
  width?: number;
  height?: number;
  theme?: ChartTheme;
}

/**
 * The tone curve the LUT applies, read off the neutral axis.
 *
 * Where the three channels separate, the LUT is introducing a colour cast at
 * that brightness. Where a channel goes flat, it has run out of range.
 */
export function curveChartSvg(curve: NeutralCurve, options: CurveOptions = {}): string {
  const theme = options.theme ?? DARK_THEME;
  const w = options.width ?? 300;
  const h = options.height ?? 240;
  const padL = 30;
  const padR = 8;
  const padT = 10;
  const padB = 20;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const px = (x: number): number => padL + x * plotW;
  const py = (y: number): number => padT + (1 - Math.max(-0.1, Math.min(1.1, y))) * plotH;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  let grid = '';
  for (const t of ticks) {
    grid +=
      '<line x1="' + fmt(px(t)) + '" y1="' + fmt(padT) + '" x2="' + fmt(px(t)) +
      '" y2="' + fmt(padT + plotH) + '" stroke="' + theme.grid + '" stroke-width="1"/>';
    grid +=
      '<line x1="' + fmt(padL) + '" y1="' + fmt(py(t)) + '" x2="' + fmt(padL + plotW) +
      '" y2="' + fmt(py(t)) + '" stroke="' + theme.grid + '" stroke-width="1"/>';
  }

  let labels = '';
  for (const t of ticks) {
    labels +=
      '<text x="' + fmt(px(t)) + '" y="' + fmt(h - 6) +
      '" fill="' + theme.dim + '" font-family="monospace" font-size="9" text-anchor="middle">' +
      t.toFixed(2) + '</text>';
    labels +=
      '<text x="' + fmt(padL - 5) + '" y="' + fmt(py(t) + 3) +
      '" fill="' + theme.dim + '" font-family="monospace" font-size="9" text-anchor="end">' +
      t.toFixed(2) + '</text>';
  }

  const reference =
    '<line x1="' + fmt(px(0)) + '" y1="' + fmt(py(0)) + '" x2="' + fmt(px(1)) +
    '" y2="' + fmt(py(1)) + '" stroke="' + theme.reference +
    '" stroke-width="1" stroke-dasharray="3 3"/>';

  const channels: Array<[Float32Array, string]> = [
    [curve.b, theme.blue],
    [curve.g, theme.green],
    [curve.r, theme.red],
  ];
  let lines = '';
  for (const [values, colour] of channels) {
    const points: Array<[number, number]> = [];
    for (let i = 0; i < values.length; i++) {
      points.push([px(curve.x[i]), py(values[i])]);
    }
    lines +=
      '<path d="' + path(points) + '" fill="none" stroke="' + colour +
      '" stroke-width="1.6" stroke-linejoin="round"/>';
  }

  const frame =
    '<rect x="' + fmt(padL) + '" y="' + fmt(padT) + '" width="' + fmt(plotW) +
    '" height="' + fmt(plotH) + '" fill="none" stroke="' + theme.axis + '" stroke-width="1"/>';

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h +
    '" width="' + w + '" height="' + h + '" role="img" aria-label="Neutral axis response curve">' +
    grid + reference + frame + lines + labels +
    '</svg>'
  );
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

export interface HistogramOptions {
  width?: number;
  height?: number;
  theme?: ChartTheme;
  label?: string;
}

/**
 * One histogram panel.
 *
 * Counts are raised to a fractional power before plotting. A linear vertical
 * scale hides everything except the tallest bin, which is why every serious
 * scope does the same thing.
 */
export function histogramSvg(hist: Histogram, options: HistogramOptions = {}): string {
  const theme = options.theme ?? DARK_THEME;
  const w = options.width ?? 300;
  const h = options.height ?? 84;
  const padT = options.label ? 14 : 4;
  const padB = 12;
  const plotH = h - padT - padB;
  const peak = Math.max(1, hist.peak);

  const shape = (counts: Uint32Array): string => {
    const points: Array<[number, number]> = [[0, padT + plotH]];
    for (let i = 0; i < hist.bins; i++) {
      const x = (i / (hist.bins - 1)) * w;
      const y = padT + plotH - Math.pow(counts[i] / peak, 0.5) * plotH;
      points.push([x, y]);
    }
    points.push([w, padT + plotH]);
    return path(points) + 'Z';
  };

  const layer = (counts: Uint32Array, colour: string): string =>
    '<path d="' + shape(counts) + '" fill="' + colour +
    '" fill-opacity="0.42" stroke="' + colour + '" stroke-width="1" stroke-opacity="0.85"/>';

  let ticks = '';
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const x = t * w;
    ticks +=
      '<line x1="' + fmt(x) + '" y1="' + fmt(padT) + '" x2="' + fmt(x) + '" y2="' +
      fmt(padT + plotH) + '" stroke="' + theme.grid + '" stroke-width="1"/>';
    ticks +=
      '<text x="' + fmt(Math.min(w - 10, Math.max(10, x))) + '" y="' + fmt(h - 2) +
      '" fill="' + theme.dim + '" font-family="monospace" font-size="8" text-anchor="middle">' +
      t.toFixed(2) + '</text>';
  }

  const title = options.label
    ? '<text x="0" y="9" fill="' + theme.dim +
      '" font-family="monospace" font-size="9">' + escapeText(options.label) + '</text>'
    : '';

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h +
    '" width="' + w + '" height="' + h + '" role="img" aria-label="' +
    escapeText(options.label ?? 'Histogram') + '">' +
    ticks + title +
    layer(hist.b, theme.blue) +
    layer(hist.g, theme.green) +
    layer(hist.r, theme.red) +
    '<line x1="0" y1="' + fmt(padT + plotH) + '" x2="' + w + '" y2="' + fmt(padT + plotH) +
    '" stroke="' + theme.axis + '" stroke-width="1"/>' +
    '</svg>'
  );
}

// ---------------------------------------------------------------------------
// Cube corner displacement
// ---------------------------------------------------------------------------

export interface CubeOptions {
  width?: number;
  height?: number;
  theme?: ChartTheme;
}

// A yaw and a pitch, rather than a true isometric view.
//
// True isometric puts the three axes 120 degrees apart on screen, which maps
// the body diagonal of the cube onto a single point: black and white land on
// top of each other, and those are the two corners you most want to see. Half
// a turn less yaw and a shallower pitch keeps all eight corners distinct.
const YAW = (35 * Math.PI) / 180;
const PITCH = (22 * Math.PI) / 180;
const COS_YAW = Math.cos(YAW);
const SIN_YAW = Math.sin(YAW);
const COS_PITCH = Math.cos(PITCH);
const SIN_PITCH = Math.sin(PITCH);

/** Half the on-screen extent of the projected cube, in unit-cube terms. */
const PROJECTED_HALF_X = 0.697;
const PROJECTED_HALF_Y = 0.725;

function project(
  r: number,
  g: number,
  b: number,
  cx: number,
  cy: number,
  scale: number,
): [number, number] {
  // Put the middle of the cube at the origin so the view is centred.
  const x = r - 0.5;
  const y = g - 0.5;
  const z = b - 0.5;
  const sx = x * COS_YAW - z * SIN_YAW;
  const depth = x * SIN_YAW + z * COS_YAW;
  const sy = y * COS_PITCH - depth * SIN_PITCH;
  return [cx + sx * scale, cy - sy * scale];
}

const EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
];

/**
 * The colour of a corner marker.
 *
 * Lifted off zero so the black corner is still visible against a near black
 * background. Drawing black on black would hide the one corner people most
 * want to look at.
 */
function cornerColour(index: number): string {
  const floor = 74;
  const r = index & 1 ? 255 : floor;
  const g = index & 2 ? 255 : floor;
  const b = index & 4 ? 255 : floor;
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function toCss(rgb: [number, number, number]): string {
  const c = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return 'rgb(' + c(rgb[0]) + ',' + c(rgb[1]) + ',' + c(rgb[2]) + ')';
}

/**
 * Where the eight corners of colour space end up.
 *
 * The wireframe is the untouched cube. Each line runs from a corner to where
 * the LUT puts it, so the length of the line is how hard that corner is being
 * pushed and the direction tells you which way.
 */
export function cubeChartSvg(moves: CornerMove[], options: CubeOptions = {}): string {
  const theme = options.theme ?? DARK_THEME;
  const w = options.width ?? 300;
  const h = options.height ?? 190;
  const captionH = 14;
  const cx = w / 2;
  const cy = (h - captionH) / 2;
  // Fit the projected cube inside the box on whichever axis is tighter.
  const scale = Math.min(
    (w / 2 - 16) / PROJECTED_HALF_X,
    ((h - captionH) / 2 - 8) / PROJECTED_HALF_Y,
  );

  const from = moves.map((m) => project(m.from[0], m.from[1], m.from[2], cx, cy, scale));
  const to = moves.map((m) => project(m.to[0], m.to[1], m.to[2], cx, cy, scale));

  let wire = '';
  for (const [a, b] of EDGES) {
    wire +=
      '<line x1="' + fmt(from[a][0]) + '" y1="' + fmt(from[a][1]) + '" x2="' +
      fmt(from[b][0]) + '" y2="' + fmt(from[b][1]) + '" stroke="' + theme.axis +
      '" stroke-width="1"/>';
  }

  let vectors = '';
  let dots = '';
  for (let i = 0; i < moves.length; i++) {
    const moved = moves[i].distance > 0.004;
    if (moved) {
      vectors +=
        '<line x1="' + fmt(from[i][0]) + '" y1="' + fmt(from[i][1]) + '" x2="' +
        fmt(to[i][0]) + '" y2="' + fmt(to[i][1]) + '" stroke="' + theme.accent +
        '" stroke-width="1.4" stroke-linecap="round"/>';
    }
    dots +=
      '<circle cx="' + fmt(from[i][0]) + '" cy="' + fmt(from[i][1]) +
      '" r="2.4" fill="none" stroke="' + cornerColour(i) +
      '" stroke-width="1.2" stroke-opacity="0.75"/>';
    if (moved) {
      dots +=
        '<circle cx="' + fmt(to[i][0]) + '" cy="' + fmt(to[i][1]) + '" r="3.4" fill="' +
        toCss(moves[i].to) + '" stroke="' + theme.text + '" stroke-width="0.8"/>';
    }
  }

  const biggest = moves.reduce((a, b) => (b.distance > a.distance ? b : a), moves[0]);
  const caption =
    '<text x="' + (w - 2) + '" y="' + (h - 3) + '" fill="' + theme.dim +
    '" font-family="monospace" font-size="9" text-anchor="end">' +
    'largest move ' + escapeText(biggest.name) + ' ' + biggest.distance.toFixed(3) +
    '</text>';

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h +
    '" width="' + w + '" height="' + h +
    '" role="img" aria-label="Isometric view of how far each corner of colour space moves">' +
    wire + vectors + dots + caption +
    '</svg>'
  );
}

// ---------------------------------------------------------------------------
// The exportable analysis card
// ---------------------------------------------------------------------------

export interface CardInput {
  title: string;
  subtitle: string;
  summary: string;
  curve: NeutralCurve;
  before: Histogram | null;
  after: Histogram | null;
  moves: CornerMove[];
  theme?: ChartTheme;
}

/** Break a sentence into lines of at most `max` characters. */
export function wrapText(text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if ((line + ' ' + word).length <= max) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Strip the outer <svg> tag so a chart can be nested inside the card. */
function inner(svg: string): string {
  const open = svg.indexOf('>');
  const close = svg.lastIndexOf('</svg>');
  return svg.slice(open + 1, close);
}

function place(svg: string, x: number, y: number): string {
  return '<g transform="translate(' + x + ' ' + y + ')">' + inner(svg) + '</g>';
}

/** One self-contained SVG holding the whole analysis panel. */
export function analysisCardSvg(input: CardInput): string {
  const theme = input.theme ?? DARK_THEME;
  const w = 760;
  const h = 620;
  const colW = 340;

  const label = (x: number, y: number, text: string): string =>
    '<text x="' + x + '" y="' + y + '" fill="' + theme.dim +
    '" font-family="monospace" font-size="10" letter-spacing="1">' + text + '</text>';

  const curve = curveChartSvg(input.curve, { width: colW, height: 260, theme });
  const cube = cubeChartSvg(input.moves, { width: colW, height: 240, theme });
  const before = input.before
    ? histogramSvg(input.before, { width: colW, height: 100, theme, label: 'before' })
    : '';
  const after = input.after
    ? histogramSvg(input.after, { width: colW, height: 100, theme, label: 'after' })
    : '';

  const dividerY = h - 104;
  const summaryLines = wrapText(input.summary, 86).slice(0, 3);
  let summary = '';
  for (let i = 0; i < summaryLines.length; i++) {
    summary +=
      '<text x="32" y="' + (dividerY + 26 + i * 19) + '" fill="' + theme.text +
      '" font-family="sans-serif" font-size="14">' + escapeText(summaryLines[i]) + '</text>';
  }

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
    '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<rect width="' + w + '" height="' + h + '" fill="' + theme.background + '"/>' +
    '<text x="32" y="42" fill="' + theme.text +
    '" font-family="sans-serif" font-size="22" font-weight="600">' +
    escapeText(input.title) + '</text>' +
    '<text x="32" y="63" fill="' + theme.dim +
    '" font-family="monospace" font-size="11">' + escapeText(input.subtitle) + '</text>' +
    label(32, 98, 'NEUTRAL AXIS') +
    place(curve, 22, 106) +
    label(398, 98, 'CUBE CORNERS') +
    place(cube, 390, 106) +
    label(32, 394, 'HISTOGRAM, BEFORE AND AFTER') +
    (before ? place(before, 22, 402) : '') +
    (after ? place(after, 390, 402) : '') +
    '<line x1="32" y1="' + dividerY + '" x2="' + (w - 32) + '" y2="' + dividerY +
    '" stroke="' + theme.axis + '" stroke-width="1"/>' +
    summary +
    '<text x="32" y="' + (h - 20) + '" fill="' + theme.dim +
    '" font-family="monospace" font-size="10">' +
    'lutbox - measured in the browser, nothing uploaded</text>' +
    '</svg>'
  );
}
