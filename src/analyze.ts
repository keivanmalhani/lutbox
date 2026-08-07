/**
 * The CPU side of lutbox.
 *
 * Two jobs. First, a reference implementation of the LUT lookup that matches
 * what the fragment shader does, so the curve plots and the histogram agree
 * with the pixels on screen and so the maths can be tested without a GPU.
 * Second, a set of measurements over a LUT that are turned into a plain
 * sentence describing what the grade actually does.
 */

import type { CubeLut } from './cube';

export type RGB = [number, number, number];

/** One LUT in the stack, with the blend amount the user has dialled in. */
export interface Slot {
  lut: CubeLut;
  /** 0 leaves the input alone, 1 applies the LUT fully. */
  strength: number;
  enabled: boolean;
}

/** Rec. 709 luma, used everywhere a single brightness number is needed. */
export function luma(rgb: RGB): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Look one colour up in a LUT.
 *
 * For a 3D table this is real trilinear interpolation: the input lands inside
 * one cell of the lattice and the result is the weighted blend of that cell's
 * eight corners. Nearest neighbour, which is what you get from a naive
 * implementation, would quantise every colour to the lattice and band badly.
 */
export function sampleLut(lut: CubeLut, rgb: RGB): RGB {
  const { size, data, domainMin, domainMax } = lut;
  const last = size - 1;

  // Map through the declared domain, then clamp. Values outside the domain
  // hold at the edge of the table, which is what the shader does too.
  const u = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    u[c] = clamp01((rgb[c] - domainMin[c]) / (domainMax[c] - domainMin[c]));
  }

  if (lut.type === '1D') {
    const out: RGB = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const pos = u[c] * last;
      const i0 = Math.min(Math.floor(pos), last);
      const i1 = Math.min(i0 + 1, last);
      const t = pos - i0;
      out[c] = lerp(data[i0 * 3 + c], data[i1 * 3 + c], t);
    }
    return out;
  }

  const pos = [u[0] * last, u[1] * last, u[2] * last];
  const i0 = [0, 0, 0];
  const i1 = [0, 0, 0];
  const t = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const f = Math.min(Math.floor(pos[c]), last);
    i0[c] = f;
    i1[c] = Math.min(f + 1, last);
    t[c] = pos[c] - f;
  }

  const at = (r: number, g: number, b: number, c: number): number =>
    data[((b * size + g) * size + r) * 3 + c];

  const out: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    // Interpolate along red, then green, then blue.
    const c00 = lerp(at(i0[0], i0[1], i0[2], c), at(i1[0], i0[1], i0[2], c), t[0]);
    const c10 = lerp(at(i0[0], i1[1], i0[2], c), at(i1[0], i1[1], i0[2], c), t[0]);
    const c01 = lerp(at(i0[0], i0[1], i1[2], c), at(i1[0], i0[1], i1[2], c), t[0]);
    const c11 = lerp(at(i0[0], i1[1], i1[2], c), at(i1[0], i1[1], i1[2], c), t[0]);
    const c0 = lerp(c00, c10, t[1]);
    const c1 = lerp(c01, c11, t[1]);
    out[c] = lerp(c0, c1, t[2]);
  }
  return out;
}

/** Apply one LUT and blend the result back toward the input by strength. */
export function applyWithStrength(lut: CubeLut, rgb: RGB, strength: number): RGB {
  const s = clamp01(strength);
  if (s === 0) return [rgb[0], rgb[1], rgb[2]];
  const graded = sampleLut(lut, rgb);
  return [
    lerp(rgb[0], graded[0], s),
    lerp(rgb[1], graded[1], s),
    lerp(rgb[2], graded[2], s),
  ];
}

/** Run a colour through every enabled slot in order. */
export function applyStack(slots: readonly Slot[], rgb: RGB): RGB {
  let current: RGB = [rgb[0], rgb[1], rgb[2]];
  for (const slot of slots) {
    if (!slot.enabled || slot.strength === 0) continue;
    current = applyWithStrength(slot.lut, current, slot.strength);
  }
  return current;
}

/** The three output curves along the neutral axis, plus the input positions. */
export interface NeutralCurve {
  x: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

/**
 * Walk the grey ramp from black to white and record what comes out.
 *
 * This is the honest way to see a LUT's tone curve: the neutral axis is the
 * diagonal of the colour cube, so the three output channels along it are the
 * contrast curve and the colour cast in one picture.
 */
export function neutralCurve(slots: readonly Slot[], samples = 128): NeutralCurve {
  const x = new Float32Array(samples);
  const r = new Float32Array(samples);
  const g = new Float32Array(samples);
  const b = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const v = samples === 1 ? 0 : i / (samples - 1);
    const out = applyStack(slots, [v, v, v]);
    x[i] = v;
    r[i] = out[0];
    g[i] = out[1];
    b[i] = out[2];
  }
  return { x, r, g, b };
}

/** Convenience wrapper for a single LUT at full strength. */
export function neutralCurveForLut(lut: CubeLut, samples = 128): NeutralCurve {
  return neutralCurve([{ lut, strength: 1, enabled: true }], samples);
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

export interface Histogram {
  bins: number;
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  /** Largest count in any channel bin, for scaling the plot. */
  peak: number;
}

/** Count an RGBA byte buffer into per-channel bins. Alpha is ignored. */
export function histogram(pixels: Uint8ClampedArray | Uint8Array, bins = 128): Histogram {
  const r = new Uint32Array(bins);
  const g = new Uint32Array(bins);
  const b = new Uint32Array(bins);
  const l = new Uint32Array(bins);
  const scale = bins / 256;
  for (let i = 0; i < pixels.length; i += 4) {
    const pr = pixels[i];
    const pg = pixels[i + 1];
    const pb = pixels[i + 2];
    r[Math.min(bins - 1, (pr * scale) | 0)]++;
    g[Math.min(bins - 1, (pg * scale) | 0)]++;
    b[Math.min(bins - 1, (pb * scale) | 0)]++;
    const y = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
    l[Math.min(bins - 1, (y * scale) | 0)]++;
  }
  let peak = 1;
  for (let i = 0; i < bins; i++) {
    if (r[i] > peak) peak = r[i];
    if (g[i] > peak) peak = g[i];
    if (b[i] > peak) peak = b[i];
  }
  return { bins, r, g, b, luma: l, peak };
}

/** Push an RGBA buffer through the stack. Used for the "after" histogram. */
export function gradeBuffer(
  slots: readonly Slot[],
  pixels: Uint8ClampedArray | Uint8Array,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const graded = applyStack(slots, [
      pixels[i] / 255,
      pixels[i + 1] / 255,
      pixels[i + 2] / 255,
    ]);
    out[i] = Math.round(clamp01(graded[0]) * 255);
    out[i + 1] = Math.round(clamp01(graded[1]) * 255);
    out[i + 2] = Math.round(clamp01(graded[2]) * 255);
    out[i + 3] = pixels[i + 3];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cube corner displacement
// ---------------------------------------------------------------------------

export interface CornerMove {
  name: string;
  from: RGB;
  to: RGB;
  /** Euclidean distance moved in RGB space. */
  distance: number;
}

const CORNER_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
];

/** Where each of the eight corners of the colour cube ends up. */
export function cornerMoves(slots: readonly Slot[]): CornerMove[] {
  const moves: CornerMove[] = [];
  for (let i = 0; i < 8; i++) {
    const from: RGB = [i & 1 ? 1 : 0, i & 2 ? 1 : 0, i & 4 ? 1 : 0];
    const to = applyStack(slots, from);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    moves.push({
      name: CORNER_NAMES[i],
      from,
      to,
      distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
    });
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Measurements and the plain-English summary
// ---------------------------------------------------------------------------

export interface LutStats {
  /** Output luma when the input is black. */
  blackLevel: number;
  /** Output luma when the input is white. */
  whiteLevel: number;
  /** Slope of the tone curve between the quarter tones. 1 means unchanged. */
  contrast: number;
  /** Average luma shift across the whole ramp. */
  exposure: number;
  /** Chroma of the graded probe colours over chroma of the originals. */
  saturation: number;
  /** Positive is warmer, negative is cooler, measured at mid grey. */
  temperature: number;
  /** Positive is toward green, negative is toward magenta, at mid grey. */
  tint: number;
  /** How many stops from white each channel is flat for. Zero means none. */
  topFlatStops: [number, number, number];
  /** Input level below which the output stops moving. Zero means none. */
  shadowCrush: number;
  /** The largest movement any probe colour makes. */
  maxDelta: number;
}

/**
 * Probe colours used to measure chroma and total movement.
 *
 * These are the colours that turn up in photographs rather than the corners of
 * the colour cube. Measuring against fully saturated primaries makes every
 * white balance change look like a huge saturation change, which is not what
 * you see when you look at the picture.
 */
const PROBES: RGB[] = [
  [0.78, 0.6, 0.5], // light skin
  [0.55, 0.38, 0.3], // mid skin
  [0.35, 0.5, 0.72], // sky
  [0.3, 0.45, 0.22], // foliage
  [0.55, 0.35, 0.18], // wood
  [0.62, 0.18, 0.18], // deep red
  [0.18, 0.5, 0.52], // teal
  [0.42, 0.28, 0.58], // purple
  [0.78, 0.68, 0.25], // warm yellow
  [0.2, 0.2, 0.2], // shadow neutral
  [0.5, 0.5, 0.5], // mid neutral
  [0.8, 0.8, 0.8], // highlight neutral
];

function chroma(rgb: RGB): number {
  return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
}

/** Read one channel of a neutral curve at an arbitrary input level. */
export function curveAt(curve: NeutralCurve, channel: 0 | 1 | 2, x: number): number {
  const values = channel === 0 ? curve.r : channel === 1 ? curve.g : curve.b;
  const n = values.length;
  if (n === 1) return values[0];
  const pos = clamp01(x) * (n - 1);
  const i0 = Math.min(Math.floor(pos), n - 1);
  const i1 = Math.min(i0 + 1, n - 1);
  return lerp(values[i0], values[i1], pos - i0);
}

/** Measure a stack. Pure: same input always gives the same numbers. */
export function measure(slots: readonly Slot[]): LutStats {
  const samples = 129;
  const curve = neutralCurve(slots, samples);

  const lumaAt = (i: number): number =>
    0.2126 * curve.r[i] + 0.7152 * curve.g[i] + 0.0722 * curve.b[i];

  const idx = (v: number): number => Math.round(v * (samples - 1));

  const blackLevel = lumaAt(0);
  const whiteLevel = lumaAt(samples - 1);
  const q1 = lumaAt(idx(0.25));
  const q3 = lumaAt(idx(0.75));
  const contrast = (q3 - q1) / 0.5;

  let exposureSum = 0;
  for (let i = 0; i < samples; i++) exposureSum += lumaAt(i) - curve.x[i];
  const exposure = exposureSum / samples;

  const mid = idx(0.5);
  const dR = curve.r[mid] - 0.5;
  const dG = curve.g[mid] - 0.5;
  const dB = curve.b[mid] - 0.5;
  const temperature = (dR - dB) / 2;
  const tint = dG - (dR + dB) / 2;

  // Saturation is measured against what the tone curve alone would have done.
  //
  // Running each channel of a probe through that channel's neutral curve gives
  // the colour you would get from a pure per-channel grade. Comparing the real
  // output's chroma to that prediction separates a genuine saturation change
  // from the chroma that any contrast or white balance move produces on its
  // own. A LUT that only bends tone reads back as 1.
  let satSum = 0;
  let satCount = 0;
  let maxDelta = 0;
  for (const probe of PROBES) {
    const out = applyStack(slots, probe);
    const tonal: RGB = [
      curveAt(curve, 0, probe[0]),
      curveAt(curve, 1, probe[1]),
      curveAt(curve, 2, probe[2]),
    ];
    const cTonal = chroma(tonal);
    if (cTonal > 0.03) {
      satSum += chroma(out) / cTonal;
      satCount++;
    }
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(out[c] - probe[c]);
      if (d > maxDelta) maxDelta = d;
    }
  }
  for (let i = 0; i < samples; i++) {
    const d = Math.max(
      Math.abs(curve.r[i] - curve.x[i]),
      Math.abs(curve.g[i] - curve.x[i]),
      Math.abs(curve.b[i] - curve.x[i]),
    );
    if (d > maxDelta) maxDelta = d;
  }
  const saturation = satCount > 0 ? satSum / satCount : 1;

  // A channel is flat near the top when its value stops changing before the
  // input reaches white. Expressed in stops below white: flat from 0.25 up is
  // the top two stops.
  const FLAT = 0.004;
  const channels: Array<Float32Array> = [curve.r, curve.g, curve.b];
  const topFlatStops: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const values = channels[c];
    const top = values[samples - 1];
    let start = samples - 1;
    while (start > 0 && Math.abs(values[start - 1] - top) < FLAT) start--;
    const xStart = curve.x[start];
    topFlatStops[c] = xStart > 0.02 && start < samples - 1 ? Math.log2(1 / xStart) : 0;
  }

  // Mirror of the above at the bottom of the range.
  let crushEnd = 0;
  const black = [curve.r[0], curve.g[0], curve.b[0]];
  let k = 0;
  while (
    k + 1 < samples &&
    Math.abs(curve.r[k + 1] - black[0]) < FLAT &&
    Math.abs(curve.g[k + 1] - black[1]) < FLAT &&
    Math.abs(curve.b[k + 1] - black[2]) < FLAT
  ) {
    k++;
  }
  if (k > 0) crushEnd = curve.x[k];

  return {
    blackLevel,
    whiteLevel,
    contrast,
    exposure,
    saturation,
    temperature,
    tint,
    topFlatStops,
    shadowCrush: crushEnd,
    maxDelta,
  };
}

interface Clause {
  text: string;
  /** Canonical position in the sentence. */
  order: number;
  /** How notable this is, used to pick the strongest few. */
  weight: number;
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

function stopsWord(stops: number): string {
  const n = Math.round(stops);
  return n >= 1 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

function pct(value: number): string {
  const n = Math.max(1, Math.round(Math.abs(value) * 100));
  return n + ' percent';
}

function joinClauses(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] + ' and ' + parts[1];
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
}

const CHANNEL_NAMES = ['red', 'green', 'blue'];

/**
 * Turn measurements into one sentence a person can read.
 *
 * Pure function of the stats, so it can be tested against known LUT shapes.
 * An identity LUT has to come out as doing nothing.
 */
export function summarize(stats: LutStats): string {
  if (stats.maxDelta < 0.004) {
    return 'This LUT leaves the image essentially unchanged.';
  }

  const clauses: Clause[] = [];

  if (Math.abs(stats.exposure) > 0.02) {
    clauses.push({
      order: 0,
      weight: Math.abs(stats.exposure) * 3,
      text:
        (stats.exposure > 0 ? 'raises exposure about ' : 'lowers exposure about ') +
        pct(stats.exposure),
    });
  }

  if (stats.blackLevel > 0.012) {
    clauses.push({
      order: 1,
      weight: stats.blackLevel * 6,
      text: 'lifts the shadows about ' + pct(stats.blackLevel),
    });
  } else if (stats.shadowCrush > 0.03) {
    clauses.push({
      order: 1,
      weight: stats.shadowCrush * 4,
      text: 'crushes everything below ' + pct(stats.shadowCrush) + ' to black',
    });
  }

  if (stats.contrast > 1.06) {
    clauses.push({
      order: 2,
      weight: (stats.contrast - 1) * 2,
      text: 'adds contrast, ' + pct(stats.contrast - 1) + ' steeper through the midtones',
    });
  } else if (stats.contrast < 0.94) {
    clauses.push({
      order: 2,
      weight: (1 - stats.contrast) * 2,
      text: 'flattens contrast by about ' + pct(1 - stats.contrast),
    });
  }

  if (stats.whiteLevel < 0.985) {
    clauses.push({
      order: 3,
      weight: (1 - stats.whiteLevel) * 2,
      text: 'rolls the highlights off to ' + pct(stats.whiteLevel),
    });
  }

  for (let c = 0; c < 3; c++) {
    const stops = stats.topFlatStops[c];
    if (stops >= 0.6) {
      clauses.push({
        order: 4 + c * 0.1,
        weight: stops * 0.9,
        text: 'crushes the top ' + stopsWord(stops) + ' stops of ' + CHANNEL_NAMES[c],
      });
    }
  }

  if (Math.abs(stats.temperature) > 0.012) {
    clauses.push({
      order: 5,
      weight: Math.abs(stats.temperature) * 8,
      text:
        (stats.temperature > 0 ? 'warms the midtones about ' : 'cools the midtones about ') +
        pct(stats.temperature),
    });
  }

  if (Math.abs(stats.tint) > 0.012) {
    clauses.push({
      order: 6,
      weight: Math.abs(stats.tint) * 8,
      text:
        'shifts midtone green about ' +
        pct(stats.tint) +
        (stats.tint > 0 ? ' toward green' : ' toward magenta'),
    });
  }

  if (stats.saturation < 0.08) {
    clauses.push({ order: 7, weight: 5, text: 'converts to black and white' });
  } else if (stats.saturation > 1.06) {
    clauses.push({
      order: 7,
      weight: (stats.saturation - 1) * 2,
      text: 'boosts saturation about ' + pct(stats.saturation - 1),
    });
  } else if (stats.saturation < 0.94) {
    clauses.push({
      order: 7,
      weight: (1 - stats.saturation) * 2,
      text: 'pulls saturation down about ' + pct(1 - stats.saturation),
    });
  }

  if (clauses.length === 0) {
    return 'This LUT moves colour by a small amount with no single dominant effect.';
  }

  // Keep the four strongest effects so the sentence stays readable, then put
  // them back into canonical order.
  const kept = clauses
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .sort((a, b) => a.order - b.order);

  const sentence = joinClauses(kept.map((c) => c.text));
  return 'This LUT ' + sentence + '.';
}

/** Measure and describe in one call. */
export function describe(slots: readonly Slot[]): string {
  return summarize(measure(slots));
}
