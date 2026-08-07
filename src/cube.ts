/**
 * Parser for Adobe .cube LUT files.
 *
 * Handles both 1D (LUT_1D_SIZE) and 3D (LUT_3D_SIZE) tables, DOMAIN_MIN and
 * DOMAIN_MAX, TITLE, comments introduced by '#', blank lines, and data triples
 * separated by any run of spaces or tabs.
 *
 * Every rejection carries the 1-based line number of the offending line so the
 * user is told exactly where the file is wrong.
 */

export type LutType = '1D' | '3D';

export interface CubeLut {
  /** Human label. Taken from TITLE when present, otherwise the file name. */
  title: string;
  type: LutType;
  /** Entries per axis. */
  size: number;
  /** Lower bound of the input domain, per channel. */
  domainMin: [number, number, number];
  /** Upper bound of the input domain, per channel. */
  domainMax: [number, number, number];
  /**
   * Table values, three floats per entry.
   *
   * For a 3D table the entry at lattice point (r, g, b) starts at
   * ((b * size + g) * size + r) * 3. Red varies fastest, which is the order
   * the .cube format writes on disk.
   *
   * For a 1D table entry i starts at i * 3 and holds the independent red,
   * green and blue curve values for input i / (size - 1).
   */
  data: Float32Array;
}

/** A parse failure that knows which line it happened on. */
export class CubeParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(line > 0 ? 'Line ' + line + ': ' + message : message);
    this.name = 'CubeParseError';
    this.line = line;
  }
}

const MAX_3D_SIZE = 128;
const MIN_3D_SIZE = 2;
const MAX_1D_SIZE = 65536;
const MIN_1D_SIZE = 2;

/** Split on any run of spaces or tabs. Carriage returns are stripped earlier. */
function tokenize(line: string): string[] {
  const trimmed = line.replace(/^[ \t]+|[ \t]+$/g, '');
  if (trimmed === '') return [];
  return trimmed.split(/[ \t]+/);
}

/**
 * Accepts the number formats that show up in real .cube files: plain decimals,
 * leading signs, and scientific notation. Rejects hex, Infinity, NaN and the
 * things Number() is otherwise too generous about.
 */
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseNumber(token: string, lineNo: number, what: string): number {
  if (!NUMBER_RE.test(token)) {
    throw new CubeParseError(
      what + ' is not a number (found "' + clip(token) + '")',
      lineNo,
    );
  }
  const value = Number(token);
  if (!Number.isFinite(value)) {
    throw new CubeParseError(what + ' is not a finite number', lineNo);
  }
  return value;
}

/** Keep error messages short when a line contains something very long. */
function clip(token: string): string {
  return token.length > 24 ? token.slice(0, 24) + '...' : token;
}

function parseInteger(token: string, lineNo: number, what: string): number {
  if (!/^\d+$/.test(token)) {
    throw new CubeParseError(
      what + ' must be a whole number (found "' + clip(token) + '")',
      lineNo,
    );
  }
  return Number(token);
}

function stripQuotes(rest: string): string {
  const trimmed = rest.replace(/^[ \t]+|[ \t]+$/g, '');
  const quoted = /^"(.*)"$/.exec(trimmed);
  return quoted ? quoted[1] : trimmed;
}

export interface ParseOptions {
  /** Used as the title when the file carries no TITLE line. */
  name?: string;
}

export function parseCube(text: string, options: ParseOptions = {}): CubeLut {
  // Tolerate CRLF and a UTF-8 byte order mark.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = source.split(/\r\n|\n|\r/);

  let type: LutType | null = null;
  let size = 0;
  let sizeLine = 0;
  let title: string | null = null;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let domainMinLine = 0;
  let domainMaxLine = 0;

  // Data is collected into a plain array first because the expected length is
  // only known once the size keyword has been seen, and a file may legally put
  // DOMAIN lines after the size line but before the table.
  let data: Float32Array | null = null;
  let written = 0;
  let lastDataLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];

    // A '#' starts a comment that runs to the end of the line.
    const hash = raw.indexOf('#');
    const body = hash >= 0 ? raw.slice(0, hash) : raw;
    const tokens = tokenize(body);
    if (tokens.length === 0) continue;

    const keyword = tokens[0].toUpperCase();

    switch (keyword) {
      case 'TITLE': {
        // Everything after the keyword, quotes optional.
        const withoutKeyword = body.replace(/^[ \t]*[Tt][Ii][Tt][Ll][Ee]/, '');
        const value = stripQuotes(withoutKeyword);
        if (value === '') {
          throw new CubeParseError('TITLE has no value', lineNo);
        }
        title = value;
        continue;
      }

      case 'LUT_3D_SIZE':
      case 'LUT_1D_SIZE': {
        const is3d = keyword === 'LUT_3D_SIZE';
        if (type !== null) {
          throw new CubeParseError(
            'a second size keyword (' +
              keyword +
              ') was found; line ' +
              sizeLine +
              ' already declared the table size',
            lineNo,
          );
        }
        if (tokens.length !== 2) {
          throw new CubeParseError(
            keyword + ' takes exactly one value, found ' + (tokens.length - 1),
            lineNo,
          );
        }
        const value = parseInteger(tokens[1], lineNo, keyword);
        const min = is3d ? MIN_3D_SIZE : MIN_1D_SIZE;
        const max = is3d ? MAX_3D_SIZE : MAX_1D_SIZE;
        if (value < min || value > max) {
          throw new CubeParseError(
            keyword +
              ' is ' +
              value +
              ', outside the supported range ' +
              min +
              ' to ' +
              max,
            lineNo,
          );
        }
        type = is3d ? '3D' : '1D';
        size = value;
        sizeLine = lineNo;
        const entries = is3d ? value * value * value : value;
        data = new Float32Array(entries * 3);
        continue;
      }

      case 'DOMAIN_MIN':
      case 'DOMAIN_MAX': {
        const isMin = keyword === 'DOMAIN_MIN';
        if (isMin && domainMinLine > 0) {
          throw new CubeParseError(
            'DOMAIN_MIN appears twice, it was already set on line ' + domainMinLine,
            lineNo,
          );
        }
        if (!isMin && domainMaxLine > 0) {
          throw new CubeParseError(
            'DOMAIN_MAX appears twice, it was already set on line ' + domainMaxLine,
            lineNo,
          );
        }
        if (tokens.length !== 4) {
          throw new CubeParseError(
            keyword +
              ' needs three values, found ' +
              (tokens.length - 1),
            lineNo,
          );
        }
        const triple: [number, number, number] = [
          parseNumber(tokens[1], lineNo, keyword + ' red'),
          parseNumber(tokens[2], lineNo, keyword + ' green'),
          parseNumber(tokens[3], lineNo, keyword + ' blue'),
        ];
        if (isMin) {
          domainMin = triple;
          domainMinLine = lineNo;
        } else {
          domainMax = triple;
          domainMaxLine = lineNo;
        }
        continue;
      }

      default:
        break;
    }

    // Anything that is not a known keyword must be a data triple. Catch a
    // stray word early so the message is about the word and not about it
    // failing to be a number.
    if (/^[A-Za-z_]/.test(tokens[0])) {
      throw new CubeParseError(
        'unknown keyword "' + clip(tokens[0]) + '"',
        lineNo,
      );
    }

    if (type === null || data === null) {
      throw new CubeParseError(
        'table data appears before LUT_1D_SIZE or LUT_3D_SIZE',
        lineNo,
      );
    }

    if (tokens.length !== 3) {
      throw new CubeParseError(
        'expected three values on a table line, found ' + tokens.length,
        lineNo,
      );
    }

    if (written + 3 > data.length) {
      throw new CubeParseError(
        'more table entries than LUT_' +
          type +
          '_SIZE ' +
          size +
          ' allows (expected ' +
          data.length / 3 +
          ')',
        lineNo,
      );
    }

    lastDataLine = lineNo;

    data[written] = parseNumber(tokens[0], lineNo, 'red value');
    data[written + 1] = parseNumber(tokens[1], lineNo, 'green value');
    data[written + 2] = parseNumber(tokens[2], lineNo, 'blue value');
    written += 3;
  }

  if (type === null || data === null) {
    throw new CubeParseError(
      'no LUT_1D_SIZE or LUT_3D_SIZE line was found, so this is not a .cube LUT',
      0,
    );
  }

  if (written === 0) {
    throw new CubeParseError(
      'the file declares LUT_' + type + '_SIZE ' + size + ' but has no table data',
      sizeLine,
    );
  }

  if (written < data.length) {
    throw new CubeParseError(
      'the table stops early, ' +
        written / 3 +
        ' of ' +
        data.length / 3 +
        ' entries were found',
      lastDataLine,
    );
  }

  for (let c = 0; c < 3; c++) {
    if (!(domainMax[c] > domainMin[c])) {
      const channel = ['red', 'green', 'blue'][c];
      throw new CubeParseError(
        'DOMAIN_MAX ' +
          channel +
          ' (' +
          domainMax[c] +
          ') must be greater than DOMAIN_MIN ' +
          channel +
          ' (' +
          domainMin[c] +
          ')',
        Math.max(domainMaxLine, domainMinLine),
      );
    }
  }

  return {
    title: title ?? options.name ?? 'Untitled LUT',
    type,
    size,
    domainMin,
    domainMax,
    data,
  };
}

/** Serialise a LUT back to .cube text. Used by the generator and by tests. */
export function formatCube(lut: CubeLut, comment?: string): string {
  const out: string[] = [];
  if (comment) {
    for (const line of comment.split('\n')) out.push('# ' + line);
  }
  out.push('TITLE "' + lut.title.replace(/"/g, "'") + '"');
  out.push('');
  out.push(lut.type === '3D' ? 'LUT_3D_SIZE ' + lut.size : 'LUT_1D_SIZE ' + lut.size);
  out.push('DOMAIN_MIN ' + lut.domainMin.map(fmt).join(' '));
  out.push('DOMAIN_MAX ' + lut.domainMax.map(fmt).join(' '));
  out.push('');
  const entries = lut.data.length / 3;
  for (let i = 0; i < entries; i++) {
    out.push(
      fmt(lut.data[i * 3]) +
        ' ' +
        fmt(lut.data[i * 3 + 1]) +
        ' ' +
        fmt(lut.data[i * 3 + 2]),
    );
  }
  out.push('');
  return out.join('\n');
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return '0.000000';
  return value.toFixed(6);
}

/** An identity 3D LUT of the given size. Useful as a neutral starting point. */
export function identityLut(size: number, title = 'Identity'): CubeLut {
  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  let n = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[n++] = r / last;
        data[n++] = g / last;
        data[n++] = b / last;
      }
    }
  }
  return {
    title,
    type: '3D',
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data,
  };
}
