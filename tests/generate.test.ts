import { describe, expect, it } from 'vitest';
import { formatCube, parseCube } from '../src/cube';
import {
  CONTRAST_PIVOT,
  PRESETS,
  buildPreset,
  contrastCurve,
  defaultParams,
  evalGenerator,
  generate1DLut,
  generateCubeText,
  generateLut,
} from '../src/generate';
import { describe as describeStack, measure, sampleLut } from '../src/analyze';
import { entryAt, full } from './helpers';

describe('the contrast curve', () => {
  it('leaves the signal alone at an amount of one', () => {
    for (const x of [0, 0.2, 0.435, 0.7, 1]) {
      expect(contrastCurve(x, 1)).toBe(x);
    }
  });

  it('holds black, white and the pivot in place', () => {
    expect(contrastCurve(0, 1.8)).toBeCloseTo(0, 9);
    expect(contrastCurve(1, 1.8)).toBeCloseTo(1, 9);
    expect(contrastCurve(CONTRAST_PIVOT, 1.8)).toBeCloseTo(CONTRAST_PIVOT, 9);
  });

  it('never clips, however far the amount is pushed', () => {
    for (let i = 0; i <= 40; i++) {
      const x = i / 40;
      const out = contrastCurve(x, 2.5);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
      if (x > 0 && x < 1) {
        expect(out).toBeGreaterThan(0);
        expect(out).toBeLessThan(1);
      }
    }
  });

  it('darkens below the pivot and brightens above it when steepened', () => {
    expect(contrastCurve(0.2, 1.5)).toBeLessThan(0.2);
    expect(contrastCurve(0.8, 1.5)).toBeGreaterThan(0.8);
  });

  it('is monotonic', () => {
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const out = contrastCurve(i / 100, 1.7);
      expect(out).toBeGreaterThan(previous);
      previous = out;
    }
  });
});

describe('the generator', () => {
  it('is the identity with default parameters', () => {
    const p = defaultParams();
    for (const probe of [
      [0, 0, 0],
      [0.3, 0.6, 0.9],
      [1, 1, 1],
    ] as Array<[number, number, number]>) {
      const out = evalGenerator(p, probe);
      expect(out[0]).toBeCloseTo(probe[0], 9);
      expect(out[1]).toBeCloseTo(probe[1], 9);
      expect(out[2]).toBeCloseTo(probe[2], 9);
    }
  });

  it('produces a table of the requested size and type', () => {
    const lut = generateLut({ ...defaultParams(), size: 17 });
    expect(lut.type).toBe('3D');
    expect(lut.size).toBe(17);
    expect(lut.data.length).toBe(17 * 17 * 17 * 3);
  });

  it('writes lattice entries in the order .cube expects', () => {
    const lut = generateLut({ ...defaultParams(), size: 5 });
    expect(entryAt(lut, 4, 0, 0)[0]).toBeCloseTo(1, 6);
    expect(entryAt(lut, 4, 0, 0)[1]).toBeCloseTo(0, 6);
    expect(entryAt(lut, 0, 0, 4)[2]).toBeCloseTo(1, 6);
  });

  it('agrees with the per-colour function at every lattice point', () => {
    const p = { ...defaultParams(), temperature: 0.3, contrast: 1.4, saturation: 1.2 };
    const size = 9;
    const lut = generateLut({ ...p, size });
    const last = size - 1;
    for (let b = 0; b < size; b += 2) {
      for (let g = 0; g < size; g += 2) {
        for (let r = 0; r < size; r += 2) {
          const expected = evalGenerator(p, [r / last, g / last, b / last]);
          const stored = entryAt(lut, r, g, b);
          expect(stored[0]).toBeCloseTo(expected[0], 6);
          expect(stored[1]).toBeCloseTo(expected[1], 6);
          expect(stored[2]).toBeCloseTo(expected[2], 6);
        }
      }
    }
  });

  it('warms the image when temperature goes up', () => {
    const out = evalGenerator({ ...defaultParams(), temperature: 0.5 }, [0.5, 0.5, 0.5]);
    expect(out[0]).toBeGreaterThan(0.5);
    expect(out[2]).toBeLessThan(0.5);
  });

  it('cools the image when temperature goes down', () => {
    const out = evalGenerator({ ...defaultParams(), temperature: -0.5 }, [0.5, 0.5, 0.5]);
    expect(out[0]).toBeLessThan(0.5);
    expect(out[2]).toBeGreaterThan(0.5);
  });

  it('pushes green when tint goes up', () => {
    const out = evalGenerator({ ...defaultParams(), tint: 0.5 }, [0.5, 0.5, 0.5]);
    expect(out[1]).toBeGreaterThan(0.5);
    expect(out[0]).toBeLessThan(0.5);
  });

  it('raises the black point with lift and holds white', () => {
    const p = { ...defaultParams(), lift: 0.1 };
    expect(evalGenerator(p, [0, 0, 0])[1]).toBeCloseTo(0.1, 6);
    expect(evalGenerator(p, [1, 1, 1])[1]).toBeCloseTo(1, 6);
  });

  it('opens the midtones with gamma above one', () => {
    const out = evalGenerator({ ...defaultParams(), gamma: 1.5 }, [0.25, 0.25, 0.25]);
    expect(out[1]).toBeGreaterThan(0.25);
  });

  it('goes fully monochrome at zero saturation', () => {
    const out = evalGenerator({ ...defaultParams(), saturation: 0 }, [0.8, 0.2, 0.4]);
    expect(out[0]).toBeCloseTo(out[1], 9);
    expect(out[1]).toBeCloseTo(out[2], 9);
  });

  it('keeps every output inside the display range', () => {
    const p = { ...defaultParams(), gain: 2, contrast: 2, saturation: 2, temperature: 1 };
    for (let i = 0; i <= 20; i++) {
      const out = evalGenerator(p, [i / 20, 1 - i / 20, 0.5]);
      for (const value of out) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('builds a 1D table of the requested length', () => {
    const lut = generate1DLut(defaultParams(), 64);
    expect(lut.type).toBe('1D');
    expect(lut.size).toBe(64);
    expect(lut.data.length).toBe(64 * 3);
  });

  it('drops saturation from a 1D table, which cannot express it', () => {
    const p = { ...defaultParams(), saturation: 0.2, contrast: 1.3 };
    const lut = generate1DLut(p, 33);
    const neutral = evalGenerator({ ...p, saturation: 1 }, [0.5, 0.5, 0.5]);
    expect(lut.data[16 * 3]).toBeCloseTo(neutral[0], 5);
  });
});

describe('round tripping through the parser', () => {
  const params = {
    ...defaultParams(),
    title: 'Round Trip Test',
    size: 9,
    lift: 0.04,
    gamma: 1.1,
    gain: 0.95,
    temperature: 0.25,
    tint: -0.1,
    saturation: 1.15,
    contrast: 1.3,
  };

  it('survives formatting and reparsing with the same shape', () => {
    const original = generateLut(params);
    const reparsed = parseCube(formatCube(original));
    expect(reparsed.type).toBe(original.type);
    expect(reparsed.size).toBe(original.size);
    expect(reparsed.data.length).toBe(original.data.length);
  });

  it('keeps every value to the precision it was written at', () => {
    const original = generateLut(params);
    const reparsed = parseCube(formatCube(original));
    for (let i = 0; i < original.data.length; i++) {
      expect(reparsed.data[i]).toBeCloseTo(original.data[i], 5);
    }
  });

  it('keeps the title', () => {
    const reparsed = parseCube(formatCube(generateLut(params)));
    expect(reparsed.title).toBe('Round Trip Test');
  });

  it('keeps the domain', () => {
    const reparsed = parseCube(formatCube(generateLut(params)));
    expect(reparsed.domainMin).toEqual([0, 0, 0]);
    expect(reparsed.domainMax).toEqual([1, 1, 1]);
  });

  it('round trips a 1D table too', () => {
    const original = generate1DLut(params, 128);
    const reparsed = parseCube(formatCube(original));
    expect(reparsed.type).toBe('1D');
    expect(reparsed.size).toBe(128);
    for (let i = 0; i < original.data.length; i += 7) {
      expect(reparsed.data[i]).toBeCloseTo(original.data[i], 5);
    }
  });

  it('samples the same way before and after the round trip', () => {
    const original = generateLut(params);
    const reparsed = parseCube(formatCube(original));
    for (const probe of [
      [0.1, 0.2, 0.3],
      [0.5, 0.5, 0.5],
      [0.9, 0.4, 0.15],
    ] as Array<[number, number, number]>) {
      const a = sampleLut(original, probe);
      const b = sampleLut(reparsed, probe);
      expect(b[0]).toBeCloseTo(a[0], 5);
      expect(b[1]).toBeCloseTo(a[1], 5);
      expect(b[2]).toBeCloseTo(a[2], 5);
    }
  });

  it('writes the settings into a comment that the parser then ignores', () => {
    const text = generateCubeText(params);
    expect(text).toContain('# Generated by lutbox.');
    expect(text).toContain('# contrast 1.300');
    expect(parseCube(text).size).toBe(9);
  });

  it('writes a file that starts with a title and a size line', () => {
    const lines = generateCubeText({ ...params, size: 3 }).split('\n');
    expect(lines.some((line) => line.startsWith('TITLE '))).toBe(true);
    expect(lines.some((line) => line === 'LUT_3D_SIZE 3')).toBe(true);
  });

  it('escapes a title containing a quote so the file stays readable', () => {
    const text = generateCubeText({ ...params, title: 'a "quoted" name', size: 3 });
    expect(parseCube(text).title).toBe("a 'quoted' name");
  });

  it('round trips an identity generator to an identity table', () => {
    const reparsed = parseCube(formatCube(generateLut({ ...defaultParams(), size: 17 })));
    expect(describeStack(full(reparsed))).toContain('essentially unchanged');
  });
});

describe('the bundled presets', () => {
  it('ships three of them', () => {
    expect(PRESETS).toHaveLength(3);
  });

  it('has a unique id for each', () => {
    const ids = new Set(PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(PRESETS.length);
  });

  it('builds every preset into a table that parses back', () => {
    for (const preset of PRESETS) {
      const lut = buildPreset(preset);
      const reparsed = parseCube(formatCube(lut));
      expect(reparsed.size).toBe(lut.size);
      expect(reparsed.type).toBe(lut.type);
    }
  });

  it('makes every preset do something visible', () => {
    for (const preset of PRESETS) {
      const stats = measure(full(buildPreset(preset)));
      expect(stats.maxDelta).toBeGreaterThan(0.01);
    }
  });

  it('keeps every preset clear of clipping worth reporting', () => {
    // Nothing is crushed at the bottom, and no channel is flat for anything
    // approaching a stop below white. Warming a picture does pin red in the
    // last few percent of the range, which is what warming a picture means.
    for (const preset of PRESETS) {
      const stats = measure(full(buildPreset(preset)));
      expect(stats.shadowCrush).toBe(0);
      for (const stops of stats.topFlatStops) {
        expect(stops).toBeLessThan(0.25);
      }
    }
  });

  it('describes each preset in plain words', () => {
    for (const preset of PRESETS) {
      const text = describeStack(full(buildPreset(preset)));
      expect(text.startsWith('This LUT ')).toBe(true);
      expect(text).not.toContain('essentially unchanged');
    }
  });

  it('includes one 1D table so that path is exercised on load', () => {
    const types = PRESETS.map((preset) => buildPreset(preset).type);
    expect(types).toContain('1D');
    expect(types).toContain('3D');
  });
});
