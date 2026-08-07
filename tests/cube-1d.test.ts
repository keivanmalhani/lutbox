import { describe, expect, it } from 'vitest';
import { parseCube } from '../src/cube';
import { sampleLut } from '../src/analyze';
import { make1dCubeText } from './helpers';

describe('parseCube, valid 1D files', () => {
  it('reads LUT_1D_SIZE and reports the type as 1D', () => {
    const lut = parseCube(make1dCubeText(4, (x) => [x, x, x]));
    expect(lut.type).toBe('1D');
    expect(lut.size).toBe(4);
  });

  it('stores one triple per entry', () => {
    const lut = parseCube(make1dCubeText(16, (x) => [x, x, x]));
    expect(lut.data.length).toBe(16 * 3);
  });

  it('keeps the three curves independent', () => {
    const lut = parseCube(make1dCubeText(3, (x) => [x, x * 0.5, 1 - x]));
    expect(lut.data[0]).toBeCloseTo(0, 6);
    expect(lut.data[1]).toBeCloseTo(0, 6);
    expect(lut.data[2]).toBeCloseTo(1, 6);
    expect(lut.data[6]).toBeCloseTo(1, 6);
    expect(lut.data[7]).toBeCloseTo(0.5, 6);
    expect(lut.data[8]).toBeCloseTo(0, 6);
  });

  it('accepts the smallest legal 1D table', () => {
    const lut = parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n');
    expect(lut.size).toBe(2);
  });

  it('accepts a large 1D table', () => {
    const lut = parseCube(make1dCubeText(4096, (x) => [x, x, x], { places: 4 }));
    expect(lut.size).toBe(4096);
  });

  it('applies each channel on its own axis when sampled', () => {
    // Red doubled and clipped, green untouched, blue halved.
    const lut = parseCube(
      make1dCubeText(3, (x) => [Math.min(1, x * 2), x, x * 0.5]),
    );
    const out = sampleLut(lut, [0.25, 0.25, 0.25]);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.25, 6);
    expect(out[2]).toBeCloseTo(0.125, 6);
  });

  it('carries a DOMAIN through a 1D table', () => {
    const lut = parseCube(
      make1dCubeText(2, (x) => [x, x, x], {
        domainMin: [0, 0, 0],
        domainMax: [2, 2, 2],
      }),
    );
    expect(lut.domainMax).toEqual([2, 2, 2]);
    expect(sampleLut(lut, [1, 1, 1])[0]).toBeCloseTo(0.5, 6);
  });

  it('reads the title of a 1D table', () => {
    const lut = parseCube(make1dCubeText(2, (x) => [x, x, x], { title: 'Toe and shoulder' }));
    expect(lut.title).toBe('Toe and shoulder');
  });
});
