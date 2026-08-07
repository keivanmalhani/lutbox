import { describe, expect, it } from 'vitest';
import { sampleLut } from '../src/analyze';
import type { RGB } from '../src/analyze';
import { identityLut } from '../src/cube';
import { lut1d, lut3d } from './helpers';

/** Nearest neighbour, which is what a naive implementation ends up doing. */
function sampleNearest(size: number, data: Float32Array, rgb: RGB): RGB {
  const last = size - 1;
  const i = rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * last));
  const base = ((i[2] * size + i[1]) * size + i[0]) * 3;
  return [data[base], data[base + 1], data[base + 2]];
}

describe('trilinear interpolation', () => {
  it('returns the input unchanged for an identity table', () => {
    const lut = identityLut(2);
    const out = sampleLut(lut, [0.317, 0.628, 0.041]);
    expect(out[0]).toBeCloseTo(0.317, 6);
    expect(out[1]).toBeCloseTo(0.628, 6);
    expect(out[2]).toBeCloseTo(0.041, 6);
  });

  it('lands exactly on lattice points', () => {
    const lut = lut3d(3, (r, g, b) => [r * r, g, b]);
    // Input 0.5 is lattice index 1 of 3, where the stored value is 0.25.
    const out = sampleLut(lut, [0.5, 0.5, 0.5]);
    expect(out[0]).toBeCloseTo(0.25, 6);
  });

  it('reproduces a channel permutation exactly, since it is linear', () => {
    // out = (b, r, g). Trilinear interpolation is exact for any function that
    // is linear in each axis, so this must hold at an arbitrary point.
    const lut = lut3d(2, (r, g, b) => [b, r, g]);
    const out = sampleLut(lut, [0.25, 0.5, 0.75]);
    expect(out[0]).toBeCloseTo(0.75, 6);
    expect(out[1]).toBeCloseTo(0.25, 6);
    expect(out[2]).toBeCloseTo(0.5, 6);
  });

  it('averages all eight corners at the centre of a 2x2x2 cell', () => {
    // Identity everywhere except the white corner, which is pulled to black.
    // At the centre every corner has weight 1/8, so red becomes
    // (0 + 1 + 0 + 1 + 0 + 1 + 0 + 0) / 8 = 3/8.
    const lut = lut3d(2, (r, g, b) =>
      r === 1 && g === 1 && b === 1 ? [0, 0, 0] : [r, g, b],
    );
    const out = sampleLut(lut, [0.5, 0.5, 0.5]);
    expect(out[0]).toBeCloseTo(0.375, 6);
    expect(out[1]).toBeCloseTo(0.375, 6);
    expect(out[2]).toBeCloseTo(0.375, 6);
  });

  it('weights a single non zero corner by the product of the axis fractions', () => {
    // Only the corner at (1,1,1) carries a value. At (0.25, 0.5, 0.75) its
    // weight is 0.25 * 0.5 * 0.75 = 0.09375.
    const lut = lut3d(2, (r, g, b) =>
      r === 1 && g === 1 && b === 1 ? [1, 1, 1] : [0, 0, 0],
    );
    const out = sampleLut(lut, [0.25, 0.5, 0.75]);
    expect(out[0]).toBeCloseTo(0.09375, 6);
  });

  it('weights the opposite corner by the complementary fractions', () => {
    // Only (0,0,0) carries a value, weight (1-0.25)(1-0.5)(1-0.75) = 0.09375.
    const lut = lut3d(2, (r, g, b) =>
      r === 0 && g === 0 && b === 0 ? [1, 1, 1] : [0, 0, 0],
    );
    const out = sampleLut(lut, [0.25, 0.5, 0.25]);
    expect(out[0]).toBeCloseTo(0.75 * 0.5 * 0.75, 6);
  });

  it('interpolates inside one cell of a larger table', () => {
    // A 3 point gamma table storing 0, 0.25, 1. An input of 0.25 sits halfway
    // through the first cell, so the answer is (0 + 0.25) / 2 = 0.125.
    const lut = lut3d(3, (r, g, b) => [r * r, g * g, b * b]);
    const out = sampleLut(lut, [0.25, 0.25, 0.25]);
    expect(out[0]).toBeCloseTo(0.125, 6);
    expect(out[1]).toBeCloseTo(0.125, 6);
    expect(out[2]).toBeCloseTo(0.125, 6);
  });

  it('interpolates a quarter of the way into a cell', () => {
    // Input 0.125 is a quarter of the way through the cell from 0 to 0.5,
    // so the answer is 0.25 * 0.25 = 0.0625.
    const lut = lut3d(3, (r, g, b) => [r * r, g * g, b * b]);
    expect(sampleLut(lut, [0.125, 0.125, 0.125])[0]).toBeCloseTo(0.0625, 6);
  });

  it('blends across axes independently', () => {
    // Red output equals the green input, so moving red must not change it.
    const lut = lut3d(2, (r, g, b) => [g, b, r]);
    expect(sampleLut(lut, [0.9, 0.3, 0.1])[0]).toBeCloseTo(0.3, 6);
    expect(sampleLut(lut, [0.1, 0.3, 0.1])[0]).toBeCloseTo(0.3, 6);
  });

  it('clamps input above one to the top of the table', () => {
    const lut = identityLut(4);
    expect(sampleLut(lut, [2, 2, 2])[0]).toBeCloseTo(1, 6);
  });

  it('clamps input below zero to the bottom of the table', () => {
    const lut = identityLut(4);
    expect(sampleLut(lut, [-1, -1, -1])[0]).toBeCloseTo(0, 6);
  });

  it('differs from nearest neighbour, which is the naive result', () => {
    const lut = lut3d(2, (r, g, b) =>
      r === 1 && g === 1 && b === 1 ? [0, 0, 0] : [r, g, b],
    );
    const trilinear = sampleLut(lut, [0.5, 0.5, 0.5]);
    const nearest = sampleNearest(lut.size, lut.data, [0.5, 0.5, 0.5]);
    expect(trilinear[0]).toBeCloseTo(0.375, 6);
    // Nearest neighbour rounds 0.5 up to the white corner and returns black.
    expect(nearest[0]).toBe(0);
    expect(Math.abs(trilinear[0] - nearest[0])).toBeGreaterThan(0.3);
  });

  it('is continuous across a cell boundary', () => {
    const lut = lut3d(5, (r, g, b) => [Math.sqrt(r), g, b]);
    const below = sampleLut(lut, [0.2499, 0.5, 0.5])[0];
    const above = sampleLut(lut, [0.2501, 0.5, 0.5])[0];
    expect(Math.abs(above - below)).toBeLessThan(0.002);
  });

  it('interpolates a 1D table linearly between entries', () => {
    const lut = lut1d(3, (x) => [x * x, x, x]);
    // Entries are 0, 0.25, 1. Halfway into the second cell gives 0.625.
    expect(sampleLut(lut, [0.75, 0.75, 0.75])[0]).toBeCloseTo(0.625, 6);
  });

  it('hits 1D lattice points exactly', () => {
    const lut = lut1d(5, (x) => [x * 0.5, x, 1 - x]);
    const out = sampleLut(lut, [0.25, 0.25, 0.25]);
    expect(out[0]).toBeCloseTo(0.125, 6);
    expect(out[1]).toBeCloseTo(0.25, 6);
    expect(out[2]).toBeCloseTo(0.75, 6);
  });
});
