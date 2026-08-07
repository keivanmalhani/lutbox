import { describe, expect, it } from 'vitest';
import { parseCube } from '../src/cube';
import { entryAt, identity, make3dCubeText } from './helpers';

describe('parseCube, valid 3D files', () => {
  it('reads the size and type of a minimal table', () => {
    const lut = parseCube(make3dCubeText(2, identity));
    expect(lut.type).toBe('3D');
    expect(lut.size).toBe(2);
  });

  it('allocates three floats per lattice entry', () => {
    const lut = parseCube(make3dCubeText(4, identity));
    expect(lut.data.length).toBe(4 * 4 * 4 * 3);
  });

  it('stores entries with red varying fastest', () => {
    // Encode each index in the output so the ordering is unambiguous.
    const text = make3dCubeText(3, (r, g, b) => [r, g * 0.5, b * 0.25]);
    const lut = parseCube(text);
    expect(entryAt(lut, 2, 0, 0)[0]).toBeCloseTo(1, 6);
    expect(entryAt(lut, 0, 2, 0)[1]).toBeCloseTo(0.5, 6);
    expect(entryAt(lut, 0, 0, 2)[2]).toBeCloseTo(0.25, 6);
    expect(entryAt(lut, 0, 2, 0)[0]).toBeCloseTo(0, 6);
  });

  it('reads a quoted TITLE', () => {
    const lut = parseCube(make3dCubeText(2, identity, { title: 'Kodak Two Step' }));
    expect(lut.title).toBe('Kodak Two Step');
  });

  it('reads an unquoted TITLE', () => {
    const lut = parseCube('TITLE Plain Words\nLUT_3D_SIZE 2\n' + eightEntries());
    expect(lut.title).toBe('Plain Words');
  });

  it('falls back to the supplied file name when there is no TITLE', () => {
    const lut = parseCube(make3dCubeText(2, identity), { name: 'grade.cube' });
    expect(lut.title).toBe('grade.cube');
  });

  it('falls back to a placeholder when there is no TITLE and no name', () => {
    const lut = parseCube(make3dCubeText(2, identity));
    expect(lut.title).toBe('Untitled LUT');
  });

  it('ignores whole line comments', () => {
    const text = make3dCubeText(2, identity, {
      preamble: ['# Created by a colourist', '#', '   # indented comment'],
    });
    const lut = parseCube(text);
    expect(lut.size).toBe(2);
  });

  it('ignores a comment on the end of a data line', () => {
    const text =
      'LUT_3D_SIZE 2\n' +
      '0 0 0 # black\n' +
      '1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
    const lut = parseCube(text);
    expect(entryAt(lut, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(entryAt(lut, 1, 1, 1)).toEqual([1, 1, 1]);
  });

  it('ignores blank and whitespace only lines', () => {
    const text = 'LUT_3D_SIZE 2\n\n   \n\t\n' + eightEntries();
    expect(parseCube(text).size).toBe(2);
  });

  it('accepts tab separated triples', () => {
    const lut = parseCube(make3dCubeText(2, identity, { separator: '\t' }));
    expect(entryAt(lut, 1, 1, 1)).toEqual([1, 1, 1]);
  });

  it('accepts runs of mixed spaces and tabs', () => {
    const text = 'LUT_3D_SIZE 2\n' + eightEntries('  \t ');
    const lut = parseCube(text);
    expect(entryAt(lut, 1, 0, 0)).toEqual([1, 0, 0]);
  });

  it('accepts leading and trailing whitespace on data lines', () => {
    const text = 'LUT_3D_SIZE 2\n' + eightEntries(' ', '   ', '  ');
    expect(parseCube(text).size).toBe(2);
  });

  it('accepts CRLF line endings', () => {
    const text = make3dCubeText(2, identity).replace(/\n/g, '\r\n');
    expect(parseCube(text).size).toBe(2);
  });

  it('accepts a leading byte order mark', () => {
    const text = String.fromCharCode(0xfeff) + make3dCubeText(2, identity);
    expect(parseCube(text).size).toBe(2);
  });

  it('accepts scientific notation', () => {
    const text =
      'LUT_3D_SIZE 2\n' +
      '1e-3 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1.0E0 1 1\n';
    const lut = parseCube(text);
    expect(entryAt(lut, 0, 0, 0)[0]).toBeCloseTo(0.001, 8);
    expect(entryAt(lut, 1, 1, 1)[0]).toBeCloseTo(1, 8);
  });

  it('keeps values above one rather than clamping them', () => {
    const lut = parseCube(make3dCubeText(2, (r, g, b) => [r * 1.4, g, b]));
    expect(entryAt(lut, 1, 0, 0)[0]).toBeCloseTo(1.4, 5);
  });

  it('keeps negative values', () => {
    const text = 'LUT_3D_SIZE 2\n-0.05 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
    expect(parseCube(text).data[0]).toBeCloseTo(-0.05, 6);
  });

  it('treats keywords case insensitively', () => {
    const lut = parseCube('lut_3d_size 2\n' + eightEntries());
    expect(lut.type).toBe('3D');
    expect(lut.size).toBe(2);
  });

  it('accepts a size keyword that appears after some comments', () => {
    const lut = parseCube('# note\n\nLUT_3D_SIZE 2\n' + eightEntries());
    expect(lut.size).toBe(2);
  });

  it('parses a full 33 point table', () => {
    const lut = parseCube(make3dCubeText(33, identity, { places: 6 }));
    expect(lut.size).toBe(33);
    expect(lut.data.length).toBe(33 * 33 * 33 * 3);
    expect(entryAt(lut, 32, 32, 32)).toEqual([1, 1, 1]);
  });

  it('parses the largest size it advertises support for', () => {
    // Two million entries. Built as a constant table so the test spends its
    // time in the parser rather than in the string builder.
    const entries = 128 * 128 * 128;
    const text = 'LUT_3D_SIZE 128\n' + new Array(entries).fill('0.5 0.25 0.125').join('\n');
    const lut = parseCube(text);
    expect(lut.size).toBe(128);
    expect(lut.data.length).toBe(entries * 3);
    expect(lut.data[lut.data.length - 1]).toBeCloseTo(0.125, 6);
  });
});

/** The eight entries of a 2x2x2 identity table, red varying fastest. */
function eightEntries(separator = ' ', prefix = '', suffix = ''): string {
  const rows = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  return rows.map((row) => prefix + row.join(separator) + suffix).join('\n') + '\n';
}
