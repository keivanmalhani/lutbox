import { describe, expect, it } from 'vitest';
import {
  CPU_PIXEL_BUDGET,
  composeFrame,
  cpuSizeFor,
  previewSize,
  sameStack,
  splitColumn,
} from '../src/cpu';
import { sampleLut } from '../src/analyze';
import type { RGB } from '../src/analyze';
import type { CubeLut } from '../src/cube';
import { identityLut } from '../src/cube';
import { lut3d, slot } from './helpers';

/** An RGBA buffer where every pixel carries its own column and row. */
function grid(width: number, height: number, offset = 0): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = x + offset;
      data[i + 1] = y + offset;
      data[i + 2] = offset;
      data[i + 3] = 255;
    }
  }
  return data;
}

function pixel(
  frame: { data: Uint8ClampedArray; width: number },
  x: number,
  y: number,
): number[] {
  const i = (y * frame.width + x) * 4;
  return [frame.data[i], frame.data[i + 1], frame.data[i + 2], frame.data[i + 3]];
}

describe('previewSize', () => {
  it('leaves a frame that already fits alone', () => {
    expect(previewSize(640, 480, 400000)).toEqual({ width: 640, height: 480 });
  });

  it('leaves a frame exactly on the budget alone', () => {
    expect(previewSize(1000, 400, 400000)).toEqual({ width: 1000, height: 400 });
  });

  it('reduces a frame over the budget to about the budget', () => {
    const size = previewSize(4000, 3000, 400000);
    const total = size.width * size.height;
    expect(total).toBeLessThanOrEqual(400000 * 1.01);
    expect(total).toBeGreaterThan(400000 * 0.99);
  });

  it('keeps the aspect ratio when it reduces', () => {
    const size = previewSize(4000, 2500, 400000);
    expect(size.width / size.height).toBeCloseTo(4000 / 2500, 2);
  });

  it('handles a panorama without collapsing a side to zero', () => {
    const size = previewSize(20000, 200, 400000);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(size.width * size.height).toBeLessThanOrEqual(400000 * 1.01);
  });

  it('never returns a zero dimension', () => {
    expect(previewSize(1, 1, 400000)).toEqual({ width: 1, height: 1 });
    expect(previewSize(0, 0, 400000)).toEqual({ width: 1, height: 1 });
    expect(previewSize(4000, 3000, 1)).toEqual({ width: 1, height: 1 });
  });

  it('survives a budget of zero rather than dividing by it', () => {
    expect(previewSize(4000, 3000, 0)).toEqual({ width: 1, height: 1 });
  });

  it('uses a default budget that leaves a 3:2 frame usable', () => {
    const size = previewSize(6000, 4000);
    expect(size.width * size.height).toBeLessThanOrEqual(CPU_PIXEL_BUDGET * 1.01);
    expect(size.width).toBeGreaterThan(700);
  });
});

describe('splitColumn', () => {
  it('grades the whole frame at zero', () => {
    expect(splitColumn(100, 0)).toBe(0);
  });

  it('leaves the whole frame original at one', () => {
    expect(splitColumn(100, 1)).toBe(100);
  });

  it('cuts an even width in half', () => {
    expect(splitColumn(4, 0.5)).toBe(2);
  });

  it('cuts an odd width where the pixel centre crosses', () => {
    // Centres are 1/10, 3/10, 5/10, 7/10, 9/10. The first at or past 0.5 is
    // index 2, so two columns stay original.
    expect(splitColumn(5, 0.5)).toBe(2);
  });

  it('clamps a split outside zero to one', () => {
    expect(splitColumn(8, -3)).toBe(0);
    expect(splitColumn(8, 4)).toBe(8);
  });

  it('agrees with the shader test on every column', () => {
    // The fragment shader grades a pixel when uv.x >= uSplit, and uv.x at the
    // centre of column i of w is (i + 0.5) / w.
    const width = 37;
    for (const split of [0, 0.1, 0.25, 1 / 3, 0.5, 0.73, 0.999, 1]) {
      const cut = splitColumn(width, split);
      for (let i = 0; i < width; i++) {
        const gradedOnGpu = (i + 0.5) / width >= split;
        expect(i >= cut).toBe(gradedOnGpu);
      }
    }
  });
});

describe('composeFrame', () => {
  const width = 6;
  const height = 3;
  const original = grid(width, height, 0);
  const graded = grid(width, height, 100);

  it('returns the graded copy in graded mode', () => {
    const frame = composeFrame(original, graded, width, height, 'graded', 0.5);
    expect(frame.width).toBe(width);
    expect(frame.height).toBe(height);
    expect(pixel(frame, 0, 0)).toEqual([100, 100, 100, 255]);
    expect(pixel(frame, 5, 2)).toEqual([105, 102, 100, 255]);
  });

  it('returns the original in original mode', () => {
    const frame = composeFrame(original, graded, width, height, 'original', 0.5);
    expect(pixel(frame, 5, 2)).toEqual([5, 2, 0, 255]);
  });

  it('puts the original left of the split and the graded right', () => {
    const frame = composeFrame(original, graded, width, height, 'split', 0.5);
    expect(frame.width).toBe(width);
    for (let y = 0; y < height; y++) {
      expect(pixel(frame, 2, y)[2]).toBe(0);
      expect(pixel(frame, 3, y)[2]).toBe(100);
    }
  });

  it('grades everything when the split is at zero', () => {
    const frame = composeFrame(original, graded, width, height, 'split', 0);
    for (let x = 0; x < width; x++) expect(pixel(frame, x, 1)[2]).toBe(100);
  });

  it('grades nothing when the split is at one', () => {
    const frame = composeFrame(original, graded, width, height, 'split', 1);
    for (let x = 0; x < width; x++) expect(pixel(frame, x, 1)[2]).toBe(0);
  });

  it('doubles the width for side by side', () => {
    const frame = composeFrame(original, graded, width, height, 'sidebyside', 0.5);
    expect(frame.width).toBe(width * 2);
    expect(frame.height).toBe(height);
    expect(frame.data.length).toBe(width * 2 * height * 4);
  });

  it('shows the same frame twice in side by side', () => {
    const frame = composeFrame(original, graded, width, height, 'sidebyside', 0.5);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // The two panels differ only by the offset baked into the buffers.
        expect(pixel(frame, x, y)).toEqual([x, y, 0, 255]);
        expect(pixel(frame, width + x, y)).toEqual([100 + x, 100 + y, 100, 255]);
      }
    }
  });

  it('carries alpha through untouched', () => {
    const withAlpha = grid(width, height, 0);
    withAlpha[3] = 17;
    const frame = composeFrame(withAlpha, graded, width, height, 'original', 0.5);
    expect(pixel(frame, 0, 0)[3]).toBe(17);
  });

  it('does not write into either input', () => {
    const a = grid(width, height, 0);
    const b = grid(width, height, 100);
    const before = Array.from(a);
    composeFrame(a, b, width, height, 'split', 0.4);
    composeFrame(a, b, width, height, 'sidebyside', 0.4);
    expect(Array.from(a)).toEqual(before);
  });

  it('returns a buffer the caller can mutate without touching the source', () => {
    const frame = composeFrame(original, graded, width, height, 'graded', 0.5);
    frame.data[0] = 1;
    expect(graded[0]).toBe(100);
  });
});

describe('cpuSizeFor', () => {
  it('matches the image for the single frame modes', () => {
    for (const mode of ['graded', 'original', 'split'] as const) {
      expect(cpuSizeFor(mode, 800, 500)).toEqual({ width: 800, height: 500 });
    }
  });

  it('doubles the width for side by side, as the GL renderer does', () => {
    expect(cpuSizeFor('sidebyside', 800, 500)).toEqual({ width: 1600, height: 500 });
  });
});

describe('sameStack', () => {
  const a = identityLut(2, 'a');
  const b = identityLut(2, 'b');

  it('is false against nothing', () => {
    expect(sameStack([slot(a)], null)).toBe(false);
  });

  it('is true for the same tables at the same strengths', () => {
    expect(sameStack([slot(a, 0.5), slot(b)], [slot(a, 0.5), slot(b)])).toBe(true);
  });

  it('is false when a strength moves', () => {
    expect(sameStack([slot(a, 0.5)], [slot(a, 0.51)])).toBe(false);
  });

  it('is false when a table is swapped for a different one', () => {
    expect(sameStack([slot(a)], [slot(b)])).toBe(false);
  });

  it('is false when the order changes', () => {
    expect(sameStack([slot(a), slot(b)], [slot(b), slot(a)])).toBe(false);
  });

  it('is false when the length changes', () => {
    expect(sameStack([slot(a), slot(b)], [slot(a)])).toBe(false);
  });

  it('is false when a slot is switched off', () => {
    const off = { ...slot(a), enabled: false };
    expect(sameStack([off], [slot(a)])).toBe(false);
  });

  it('compares tables by identity, not by contents', () => {
    // Two separately built identity tables hold the same numbers, but the
    // stage uses this to decide whether to redo a megapixel of work, and a
    // deep compare of two million floats would cost more than the redraw.
    expect(sameStack([slot(identityLut(2))], [slot(identityLut(2))])).toBe(false);
  });
});

/**
 * The CPU sampler against the GPU's, written out longhand.
 *
 * The shader maps a colour to `(c * (size - 1) + 0.5) / size` and hands that
 * to a sampler3D with LINEAR filtering. The texture unit turns a normalised
 * coordinate into a texel position by multiplying by the size and subtracting
 * half a texel, then blends the neighbouring texels on each axis by the
 * fractional part, with CLAMP_TO_EDGE holding the ends. Writing that chain out
 * here and comparing it to sampleLut is the only way to check the two paths
 * agree without a GPU in the test runner.
 */
function shaderLookup(lut: CubeLut, rgb: RGB): RGB {
  const n = lut.size;
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  // toDomain() in the shader.
  const c = [0, 1, 2].map((i) =>
    clamp01(
      (rgb[i] - lut.domainMin[i]) / Math.max(lut.domainMax[i] - lut.domainMin[i], 1e-6),
    ),
  );
  // lookup3d() in the shader.
  const coord = c.map((v) => (v * (n - 1) + 0.5) / n);
  // What the texture unit does with that coordinate.
  const pos = coord.map((v) => v * n - 0.5);
  const i0 = pos.map((v) => Math.min(n - 1, Math.max(0, Math.floor(v))));
  const i1 = i0.map((v) => Math.min(n - 1, v + 1));
  const t = pos.map((v, k) => Math.min(1, Math.max(0, v - i0[k])));

  const at = (r: number, g: number, b: number, k: number): number =>
    lut.data[((b * n + g) * n + r) * 3 + k];

  const out: RGB = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const c00 = lerp(at(i0[0], i0[1], i0[2], k), at(i1[0], i0[1], i0[2], k), t[0]);
    const c10 = lerp(at(i0[0], i1[1], i0[2], k), at(i1[0], i1[1], i0[2], k), t[0]);
    const c01 = lerp(at(i0[0], i0[1], i1[2], k), at(i1[0], i0[1], i1[2], k), t[0]);
    const c11 = lerp(at(i0[0], i1[1], i1[2], k), at(i1[0], i1[1], i1[2], k), t[0]);
    out[k] = lerp(lerp(c00, c10, t[1]), lerp(c01, c11, t[1]), t[2]);
  }
  return out;
}

describe('the CPU sampler against the shader it stands in for', () => {
  const table = lut3d(
    5,
    (r, g, b) => [Math.sqrt(r), g * g, 1 - b * 0.6],
    'checked against the shader',
  );

  it('agrees on every lattice point', () => {
    const last = table.size - 1;
    for (let b = 0; b <= last; b++) {
      for (let g = 0; g <= last; g++) {
        for (let r = 0; r <= last; r++) {
          const input: RGB = [r / last, g / last, b / last];
          const cpu = sampleLut(table, input);
          const gpu = shaderLookup(table, input);
          for (let k = 0; k < 3; k++) expect(cpu[k]).toBeCloseTo(gpu[k], 6);
        }
      }
    }
  });

  it('agrees between lattice points', () => {
    const probes: RGB[] = [
      [0.125, 0.375, 0.625],
      [0.01, 0.99, 0.5],
      [1 / 3, 2 / 3, 1 / 7],
      [0.2499, 0.2501, 0.75],
      [0.87, 0.13, 0.41],
    ];
    for (const probe of probes) {
      const cpu = sampleLut(table, probe);
      const gpu = shaderLookup(table, probe);
      for (let k = 0; k < 3; k++) expect(cpu[k]).toBeCloseTo(gpu[k], 6);
    }
  });

  it('agrees outside the table, where both clamp to the edge', () => {
    for (const probe of [[-0.4, 1.6, 0.5], [2, -2, 2]] as RGB[]) {
      const cpu = sampleLut(table, probe);
      const gpu = shaderLookup(table, probe);
      for (let k = 0; k < 3; k++) expect(cpu[k]).toBeCloseTo(gpu[k], 6);
    }
  });

  it('agrees through a non default domain', () => {
    const shifted: CubeLut = { ...table, domainMin: [0.1, 0, -0.2], domainMax: [0.9, 2, 1] };
    for (const probe of [[0.5, 0.5, 0.5], [0.05, 1.5, 0], [0.95, 0.2, 0.99]] as RGB[]) {
      const cpu = sampleLut(shifted, probe);
      const gpu = shaderLookup(shifted, probe);
      for (let k = 0; k < 3; k++) expect(cpu[k]).toBeCloseTo(gpu[k], 6);
    }
  });

  it('lands on the value stored at a lattice point, by hand', () => {
    // Size 5, so lattice index 2 of 4 is input 0.5 and holds sqrt(0.5).
    expect(sampleLut(table, [0.5, 0.5, 0.5])[0]).toBeCloseTo(Math.sqrt(0.5), 6);
    expect(shaderLookup(table, [0.5, 0.5, 0.5])[0]).toBeCloseTo(Math.sqrt(0.5), 6);
  });

  it('blends two entries by hand halfway between lattice points', () => {
    // Green stores g * g at 0, 0.25, 0.5, 0.75, 1, so entries 0 and 0.0625.
    // Halfway through the first cell is input 0.125 and answer 0.03125.
    expect(sampleLut(table, [0.5, 0.125, 0.5])[1]).toBeCloseTo(0.03125, 6);
    expect(shaderLookup(table, [0.5, 0.125, 0.5])[1]).toBeCloseTo(0.03125, 6);
  });
});
