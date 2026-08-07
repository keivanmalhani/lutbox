/** Builders for the .cube text the tests parse. Nothing is read from disk. */

import type { CubeLut } from '../src/cube';
import type { RGB, Slot } from '../src/analyze';

export interface CubeTextOptions {
  title?: string;
  domainMin?: [number, number, number];
  domainMax?: [number, number, number];
  /** Separator between the three numbers on a data line. */
  separator?: string;
  /** Lines placed before the size keyword. */
  preamble?: string[];
  /** Number of decimal places written out. */
  places?: number;
}

export function make3dCubeText(
  size: number,
  fn: (r: number, g: number, b: number) => RGB,
  options: CubeTextOptions = {},
): string {
  const sep = options.separator ?? ' ';
  const places = options.places ?? 6;
  const lines: string[] = [];
  for (const line of options.preamble ?? []) lines.push(line);
  if (options.title !== undefined) lines.push('TITLE "' + options.title + '"');
  lines.push('LUT_3D_SIZE ' + size);
  if (options.domainMin) lines.push('DOMAIN_MIN ' + options.domainMin.join(' '));
  if (options.domainMax) lines.push('DOMAIN_MAX ' + options.domainMax.join(' '));
  lines.push('');
  const last = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = fn(r / last, g / last, b / last);
        lines.push(out.map((v) => v.toFixed(places)).join(sep));
      }
    }
  }
  return lines.join('\n') + '\n';
}

export function make1dCubeText(
  size: number,
  fn: (x: number) => RGB,
  options: CubeTextOptions = {},
): string {
  const sep = options.separator ?? ' ';
  const places = options.places ?? 6;
  const lines: string[] = [];
  for (const line of options.preamble ?? []) lines.push(line);
  if (options.title !== undefined) lines.push('TITLE "' + options.title + '"');
  lines.push('LUT_1D_SIZE ' + size);
  if (options.domainMin) lines.push('DOMAIN_MIN ' + options.domainMin.join(' '));
  if (options.domainMax) lines.push('DOMAIN_MAX ' + options.domainMax.join(' '));
  lines.push('');
  const last = size - 1;
  for (let i = 0; i <= last; i++) {
    lines.push(
      fn(i / last)
        .map((v) => v.toFixed(places))
        .join(sep),
    );
  }
  return lines.join('\n') + '\n';
}

export const identity = (r: number, g: number, b: number): RGB => [r, g, b];

/** Read one lattice entry out of a parsed 3D table. */
export function entryAt(lut: CubeLut, r: number, g: number, b: number): RGB {
  const base = ((b * lut.size + g) * lut.size + r) * 3;
  return [lut.data[base], lut.data[base + 1], lut.data[base + 2]];
}

/** Build a 3D LUT object directly, without going through text. */
export function lut3d(
  size: number,
  fn: (r: number, g: number, b: number) => RGB,
  title = 'test',
): CubeLut {
  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  let n = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = fn(r / last, g / last, b / last);
        data[n++] = out[0];
        data[n++] = out[1];
        data[n++] = out[2];
      }
    }
  }
  return { title, type: '3D', size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}

/** Build a 1D LUT object directly. */
export function lut1d(size: number, fn: (x: number) => RGB, title = 'test'): CubeLut {
  const data = new Float32Array(size * 3);
  const last = size - 1;
  for (let i = 0; i < size; i++) {
    const out = fn(i / last);
    data[i * 3] = out[0];
    data[i * 3 + 1] = out[1];
    data[i * 3 + 2] = out[2];
  }
  return { title, type: '1D', size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}

export function slot(lut: CubeLut, strength = 1): Slot {
  return { lut, strength, enabled: true };
}

export function full(lut: CubeLut): Slot[] {
  return [slot(lut, 1)];
}
