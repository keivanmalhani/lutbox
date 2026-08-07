/**
 * Builds .cube LUTs from a handful of controls, so the page is useful even
 * when you have no LUT to hand.
 *
 * The maths is deliberately plain and in a fixed order, and it is exposed as a
 * pure per-colour function so a generated table can be checked entry by entry.
 */

import type { CubeLut } from './cube';
import { formatCube } from './cube';
import type { RGB } from './analyze';

export interface GeneratorParams {
  title: string;
  /** Lattice points per axis for the 3D table. */
  size: number;
  /** Above zero raises the black point, below zero pulls it down. -1 to 1. */
  lift: number;
  /** Above 1 brightens the midtones. 0.2 to 3. */
  gamma: number;
  /** Overall multiplier on the signal. 0 to 3. */
  gain: number;
  /** Above zero is warmer, below zero is cooler. -1 to 1. */
  temperature: number;
  /** Above zero is greener, below zero is more magenta. -1 to 1. */
  tint: number;
  /** 1 leaves saturation alone, 0 is monochrome. 0 to 2. */
  saturation: number;
  /** 1 leaves contrast alone. Pivots around CONTRAST_PIVOT. 0 to 2. */
  contrast: number;
}

/** Middle grey in a display-referred signal, used as the contrast pivot. */
export const CONTRAST_PIVOT = 0.435;

export function defaultParams(): GeneratorParams {
  return {
    title: 'lutbox custom',
    size: 33,
    lift: 0,
    gamma: 1,
    gain: 1,
    temperature: 0,
    tint: 0,
    saturation: 1,
    contrast: 1,
  };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Contrast around a pivot that cannot clip.
 *
 * Below the pivot the curve is a power of the distance up from black, above it
 * a power of the distance down from white. Zero, the pivot and one are all
 * fixed points, and the slope at the pivot is exactly `amount`.
 */
export function contrastCurve(x: number, amount: number, pivot = CONTRAST_PIVOT): number {
  if (amount === 1) return x;
  if (x <= 0) return x;
  if (x >= 1) return x;
  if (x < pivot) return pivot * Math.pow(x / pivot, amount);
  const top = 1 - pivot;
  return 1 - top * Math.pow((1 - x) / top, amount);
}

/**
 * The grade applied to one colour.
 *
 * Order: white balance, then lift, then gamma, then gain, then contrast, then
 * saturation. Changing the order changes the look, so it is fixed here and the
 * generated file is a faithful record of it.
 */
export function evalGenerator(p: GeneratorParams, rgb: RGB): RGB {
  let r = rgb[0];
  let g = rgb[1];
  let b = rgb[2];

  // White balance as channel multipliers. Warm lifts red and drops blue.
  const t = p.temperature;
  r *= 1 + 0.3 * t;
  b *= 1 - 0.3 * t;
  const ti = p.tint;
  g *= 1 + 0.2 * ti;
  r *= 1 - 0.1 * ti;
  b *= 1 - 0.1 * ti;

  const applyTone = (x: number): number => {
    let v = x;
    // Lift. Positive holds white in place and raises black.
    if (p.lift >= 0) {
      v = p.lift + v * (1 - p.lift);
    } else {
      const l = -p.lift;
      v = (v - l) / (1 - l);
    }
    v = v < 0 ? 0 : v;
    // Gamma. Above 1 opens the midtones.
    if (p.gamma !== 1) v = Math.pow(v, 1 / p.gamma);
    // Gain.
    v *= p.gain;
    // Contrast about the pivot. This is a power curve on each side of the
    // pivot rather than a straight line, so black stays black and white stays
    // white however far the slider goes. A straight line would clip both ends
    // and throw away detail that was in the file.
    if (p.contrast !== 1) v = contrastCurve(v, p.contrast);
    return v;
  };

  r = applyTone(r);
  g = applyTone(g);
  b = applyTone(b);

  if (p.saturation !== 1) {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = y + (r - y) * p.saturation;
    g = y + (g - y) * p.saturation;
    b = y + (b - y) * p.saturation;
  }

  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** Build a 3D table by evaluating the grade at every lattice point. */
export function generateLut(p: GeneratorParams): CubeLut {
  const size = Math.max(2, Math.min(128, Math.round(p.size)));
  const last = size - 1;
  const data = new Float32Array(size * size * size * 3);
  let n = 0;
  // Red varies fastest, which is the order .cube writes entries in.
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const out = evalGenerator(p, [ri / last, gi / last, bi / last]);
        data[n++] = out[0];
        data[n++] = out[1];
        data[n++] = out[2];
      }
    }
  }
  return {
    title: p.title,
    type: '3D',
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data,
  };
}

/**
 * Build a 1D table.
 *
 * A 1D LUT can only hold three independent curves, so it can represent this
 * grade exactly whenever saturation is 1. When it is not, the table records
 * the neutral-axis behaviour and the saturation change is lost, which is a
 * property of the format rather than of this code.
 */
export function generate1DLut(p: GeneratorParams, size = 256): CubeLut {
  const n = Math.max(2, Math.min(65536, Math.round(size)));
  const last = n - 1;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = i / last;
    const out = evalGenerator({ ...p, saturation: 1 }, [x, x, x]);
    data[i * 3] = out[0];
    data[i * 3 + 1] = out[1];
    data[i * 3 + 2] = out[2];
  }
  return {
    title: p.title,
    type: '1D',
    size: n,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data,
  };
}

/** The .cube text for a set of parameters, with the settings in a comment. */
export function generateCubeText(p: GeneratorParams, lut?: CubeLut): string {
  const table = lut ?? generateLut(p);
  const note = [
    'Generated by lutbox.',
    'lift ' + p.lift.toFixed(3),
    'gamma ' + p.gamma.toFixed(3),
    'gain ' + p.gain.toFixed(3),
    'temperature ' + p.temperature.toFixed(3),
    'tint ' + p.tint.toFixed(3),
    'saturation ' + p.saturation.toFixed(3),
    'contrast ' + p.contrast.toFixed(3),
  ].join('\n');
  return formatCube(table, note);
}

export interface Preset {
  id: string;
  label: string;
  note: string;
  params: GeneratorParams;
  oneDimensional?: boolean;
}

/**
 * The three LUTs the page loads with. They are built from the generator above
 * rather than shipped as files, so there is no third-party colour science and
 * no licence question anywhere in this repository.
 */
export const PRESETS: Preset[] = [
  {
    id: 'warm-contrast',
    label: 'Warm Contrast',
    note: 'Warms the balance and steepens the midtones.',
    params: {
      ...defaultParams(),
      title: 'lutbox Warm Contrast',
      size: 33,
      temperature: 0.28,
      tint: -0.05,
      contrast: 1.18,
      saturation: 1.08,
      gamma: 0.96,
    },
  },
  {
    id: 'blue-hour',
    label: 'Blue Hour',
    note: 'Cool balance, lifted black point, gentle desaturation.',
    params: {
      ...defaultParams(),
      title: 'lutbox Blue Hour',
      size: 33,
      temperature: -0.3,
      tint: 0.06,
      lift: 0.055,
      contrast: 0.9,
      saturation: 0.86,
      gamma: 1.05,
    },
  },
  {
    id: 'filmic-rolloff',
    label: 'Filmic Rolloff',
    note: 'A 1D tone curve: lifted toe, highlights held back.',
    oneDimensional: true,
    params: {
      ...defaultParams(),
      title: 'lutbox Filmic Rolloff',
      size: 256,
      lift: 0.04,
      gamma: 1.12,
      gain: 0.9,
      contrast: 1.28,
    },
  },
];

/** Materialise a preset into a LUT. */
export function buildPreset(preset: Preset): CubeLut {
  return preset.oneDimensional
    ? generate1DLut(preset.params, preset.params.size)
    : generateLut(preset.params);
}
