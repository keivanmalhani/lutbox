import { describe, expect, it } from 'vitest';
import { parseCube } from '../src/cube';
import { sampleLut } from '../src/analyze';
import { identity, make3dCubeText } from './helpers';

describe('DOMAIN_MIN and DOMAIN_MAX', () => {
  it('defaults to zero and one when the file says nothing', () => {
    const lut = parseCube(make3dCubeText(2, identity));
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it('reads the declared domain', () => {
    const lut = parseCube(
      make3dCubeText(2, identity, { domainMin: [0.1, 0.2, 0.3], domainMax: [0.9, 1.2, 2] }),
    );
    expect(lut.domainMin).toEqual([0.1, 0.2, 0.3]);
    expect(lut.domainMax).toEqual([0.9, 1.2, 2]);
  });

  it('accepts DOMAIN lines placed before the size keyword', () => {
    const lut = parseCube(
      'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 4 4 4\nLUT_3D_SIZE 2\n' +
        '0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
    );
    expect(lut.domainMax).toEqual([4, 4, 4]);
  });

  it('maps the domain minimum onto the first lattice entry', () => {
    const lut = parseCube(
      make3dCubeText(2, identity, { domainMin: [0.2, 0.2, 0.2], domainMax: [0.8, 0.8, 0.8] }),
    );
    expect(sampleLut(lut, [0.2, 0.2, 0.2])).toEqual([0, 0, 0]);
  });

  it('maps the domain maximum onto the last lattice entry', () => {
    const lut = parseCube(
      make3dCubeText(2, identity, { domainMin: [0.2, 0.2, 0.2], domainMax: [0.8, 0.8, 0.8] }),
    );
    const out = sampleLut(lut, [0.8, 0.8, 0.8]);
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[1]).toBeCloseTo(1, 6);
    expect(out[2]).toBeCloseTo(1, 6);
  });

  it('maps the middle of the domain to the middle of the table', () => {
    const lut = parseCube(
      make3dCubeText(2, identity, { domainMin: [0, 0, 0], domainMax: [2, 2, 2] }),
    );
    // An input of 1.0 is halfway through a domain of 0 to 2.
    const out = sampleLut(lut, [1, 1, 1]);
    expect(out[0]).toBeCloseTo(0.5, 6);
  });

  it('holds at the first entry for input below the domain', () => {
    const lut = parseCube(
      make3dCubeText(2, identity, { domainMin: [0.25, 0.25, 0.25], domainMax: [1, 1, 1] }),
    );
    expect(sampleLut(lut, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(sampleLut(lut, [-5, -5, -5])).toEqual([0, 0, 0]);
  });

  it('holds at the last entry for input above the domain', () => {
    const lut = parseCube(
      make3dCubeText(2, identity, { domainMin: [0, 0, 0], domainMax: [0.5, 0.5, 0.5] }),
    );
    const out = sampleLut(lut, [1, 1, 1]);
    expect(out[0]).toBeCloseTo(1, 6);
  });

  it('handles a different domain on each channel', () => {
    const lut = parseCube(
      make3dCubeText(2, identity, { domainMin: [0, 0, 0], domainMax: [1, 2, 4] }),
    );
    const out = sampleLut(lut, [0.5, 1, 2]);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(0.5, 6);
  });

  it('accepts a negative domain minimum, as log formats use', () => {
    const lut = parseCube(
      make3dCubeText(2, identity, { domainMin: [-0.1, -0.1, -0.1], domainMax: [1, 1, 1] }),
    );
    expect(lut.domainMin[0]).toBeCloseTo(-0.1, 6);
    expect(sampleLut(lut, [-0.1, -0.1, -0.1])).toEqual([0, 0, 0]);
  });
});
