import { describe, expect, it } from 'vitest';
import { CubeParseError, parseCube } from '../src/cube';

/** Parse and return the error, insisting that one was thrown. */
function failure(text: string): CubeParseError {
  try {
    parseCube(text);
  } catch (error) {
    if (error instanceof CubeParseError) return error;
    throw error;
  }
  throw new Error('expected parseCube to reject this text');
}

const EIGHT = '0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';

describe('parseCube, malformed files', () => {
  it('throws a CubeParseError carrying a line number', () => {
    const error = failure('LUT_3D_SIZE 2\n0 0 0\nnot a number here\n');
    expect(error).toBeInstanceOf(CubeParseError);
    expect(typeof error.line).toBe('number');
  });

  it('rejects a file with no size keyword', () => {
    const error = failure('# just a comment\n0.0 0.0 0.0\n');
    expect(error.line).toBe(2);
    expect(error.message).toContain('before LUT_1D_SIZE or LUT_3D_SIZE');
  });

  it('rejects a file with neither size keyword nor data', () => {
    const error = failure('# nothing here\n\n# still nothing\n');
    expect(error.message).toContain('not a .cube LUT');
  });

  it('rejects an empty file', () => {
    const error = failure('');
    expect(error.message).toContain('not a .cube LUT');
  });

  it('points at the line where data appears before the size keyword', () => {
    const error = failure('TITLE "early"\n\n0.1 0.1 0.1\nLUT_3D_SIZE 2\n');
    expect(error.line).toBe(3);
    expect(error.message).toMatch(/^Line 3: /);
  });

  it('points at a data line with only two values', () => {
    const error = failure('LUT_3D_SIZE 2\n0 0 0\n1 0\n');
    expect(error.line).toBe(3);
    expect(error.message).toContain('found 2');
  });

  it('points at a data line with four values', () => {
    const error = failure('LUT_3D_SIZE 2\n0 0 0\n1 0 0 0\n');
    expect(error.line).toBe(3);
    expect(error.message).toContain('found 4');
  });

  it('points at the channel that is not a number', () => {
    const error = failure('LUT_3D_SIZE 2\n0 0 0\n1 zero 0\n');
    expect(error.line).toBe(3);
    expect(error.message).toContain('green value is not a number');
    expect(error.message).toContain('zero');
  });

  it('rejects a hexadecimal value', () => {
    const error = failure('LUT_3D_SIZE 2\n0x10 0 0\n');
    expect(error.line).toBe(2);
    expect(error.message).toContain('red value is not a number');
  });

  it('rejects a value that is only a sign', () => {
    const error = failure('LUT_3D_SIZE 2\n0 0 0\n- 0 0\n');
    expect(error.line).toBe(3);
  });

  it('points at the first surplus entry', () => {
    const error = failure('LUT_3D_SIZE 2\n' + EIGHT + '0.5 0.5 0.5\n');
    expect(error.line).toBe(10);
    expect(error.message).toContain('more table entries');
  });

  it('reports a truncated table at the end of the file', () => {
    const text = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n';
    const error = failure(text);
    expect(error.message).toContain('3 of 8 entries');
    expect(error.line).toBe(4);
  });

  it('reports a table with a size line but no data at the size line', () => {
    const error = failure('TITLE "empty"\nLUT_3D_SIZE 4\n# and nothing else\n');
    expect(error.line).toBe(2);
    expect(error.message).toContain('no table data');
  });

  it('rejects a size of zero', () => {
    const error = failure('LUT_3D_SIZE 0\n0 0 0\n');
    expect(error.line).toBe(1);
    expect(error.message).toContain('outside the supported range');
  });

  it('rejects a size of one', () => {
    const error = failure('LUT_3D_SIZE 1\n0 0 0\n');
    expect(error.line).toBe(1);
  });

  it('rejects a negative size', () => {
    const error = failure('LUT_3D_SIZE -4\n0 0 0\n');
    expect(error.line).toBe(1);
    expect(error.message).toContain('whole number');
  });

  it('rejects a size that is not a number', () => {
    const error = failure('LUT_3D_SIZE large\n0 0 0\n');
    expect(error.line).toBe(1);
    expect(error.message).toContain('whole number');
  });

  it('rejects a 3D size beyond what it will load', () => {
    const error = failure('LUT_3D_SIZE 256\n0 0 0\n');
    expect(error.line).toBe(1);
    expect(error.message).toContain('outside the supported range 2 to 128');
  });

  it('rejects a 1D size beyond what it will load', () => {
    const error = failure('LUT_1D_SIZE 70000\n0 0 0\n');
    expect(error.line).toBe(1);
    expect(error.message).toContain('outside the supported range 2 to 65536');
  });

  it('rejects a size keyword with two values', () => {
    const error = failure('LUT_3D_SIZE 2 2\n0 0 0\n');
    expect(error.line).toBe(1);
    expect(error.message).toContain('exactly one value');
  });

  it('rejects a second size keyword and names the first line', () => {
    const error = failure('LUT_3D_SIZE 2\n' + EIGHT + 'LUT_3D_SIZE 4\n');
    expect(error.line).toBe(10);
    expect(error.message).toContain('line 1 already declared');
  });

  it('rejects a file that declares both a 1D and a 3D size', () => {
    const error = failure('LUT_1D_SIZE 2\n0 0 0\n1 1 1\nLUT_3D_SIZE 2\n');
    expect(error.line).toBe(4);
    expect(error.message).toContain('LUT_3D_SIZE');
  });

  it('rejects an unknown keyword', () => {
    const error = failure('LUT_3D_SIZE 2\n' + EIGHT + 'LUT_IN_VIDEO_RANGE 1\n');
    expect(error.line).toBe(10);
    expect(error.message).toContain('unknown keyword "LUT_IN_VIDEO_RANGE"');
  });

  it('rejects an unknown keyword before the size line', () => {
    const error = failure('WOBBLE 3\nLUT_3D_SIZE 2\n' + EIGHT);
    expect(error.line).toBe(1);
    expect(error.message).toContain('unknown keyword');
  });

  it('rejects a TITLE with nothing after it', () => {
    const error = failure('TITLE\nLUT_3D_SIZE 2\n' + EIGHT);
    expect(error.line).toBe(1);
    expect(error.message).toContain('TITLE has no value');
  });

  it('rejects DOMAIN_MIN with two values', () => {
    const error = failure('LUT_3D_SIZE 2\nDOMAIN_MIN 0 0\n' + EIGHT);
    expect(error.line).toBe(2);
    expect(error.message).toContain('needs three values, found 2');
  });

  it('rejects DOMAIN_MAX with four values', () => {
    const error = failure('LUT_3D_SIZE 2\nDOMAIN_MAX 1 1 1 1\n' + EIGHT);
    expect(error.line).toBe(2);
    expect(error.message).toContain('needs three values, found 4');
  });

  it('rejects a DOMAIN value that is not a number', () => {
    const error = failure('LUT_3D_SIZE 2\nDOMAIN_MAX 1 one 1\n' + EIGHT);
    expect(error.line).toBe(2);
    expect(error.message).toContain('DOMAIN_MAX green is not a number');
  });

  it('rejects a repeated DOMAIN_MIN and names the earlier line', () => {
    const error = failure('LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MIN 0.1 0.1 0.1\n' + EIGHT);
    expect(error.line).toBe(3);
    expect(error.message).toContain('already set on line 2');
  });

  it('rejects a repeated DOMAIN_MAX', () => {
    const error = failure('LUT_3D_SIZE 2\nDOMAIN_MAX 1 1 1\nDOMAIN_MAX 2 2 2\n' + EIGHT);
    expect(error.line).toBe(3);
    expect(error.message).toContain('DOMAIN_MAX appears twice');
  });

  it('rejects a domain whose maximum is below its minimum', () => {
    const error = failure('LUT_3D_SIZE 2\nDOMAIN_MIN 0.5 0 0\nDOMAIN_MAX 0.2 1 1\n' + EIGHT);
    expect(error.line).toBe(3);
    expect(error.message).toContain('must be greater than DOMAIN_MIN red');
  });

  it('rejects a domain that is a single point', () => {
    const error = failure('LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 0 1\n' + EIGHT);
    expect(error.message).toContain('DOMAIN_MAX green');
    expect(error.line).toBeGreaterThan(0);
  });

  it('prefixes the message with the line number', () => {
    const error = failure('LUT_3D_SIZE 2\n0 0 0\n1 0 0\nbad line\n');
    expect(error.message.startsWith('Line 4: ')).toBe(true);
  });

  it('counts lines from one, not zero', () => {
    const error = failure('nonsense on the very first line\n');
    expect(error.line).toBe(1);
  });

  it('keeps very long tokens out of the message', () => {
    const long = '9'.repeat(200) + 'x';
    const error = failure('LUT_3D_SIZE 2\n' + long + ' 0 0\n');
    expect(error.message).toContain('...');
    expect(error.message.length).toBeLessThan(120);
  });
});
