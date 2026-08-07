import { describe, expect, it } from 'vitest';
import {
  cornerMoves,
  curveAt,
  describe as describeStack,
  gradeBuffer,
  histogram,
  luma,
  measure,
  neutralCurve,
  neutralCurveForLut,
  summarize,
} from '../src/analyze';
import { identityLut } from '../src/cube';
import { contrastCurve } from '../src/generate';
import { full, lut1d, lut3d, slot } from './helpers';

const IDENTITY = identityLut(17);

describe('neutral axis extraction', () => {
  it('returns the requested number of samples', () => {
    const curve = neutralCurve(full(IDENTITY), 64);
    expect(curve.x.length).toBe(64);
    expect(curve.r.length).toBe(64);
  });

  it('starts at zero and ends at one on the input axis', () => {
    const curve = neutralCurve(full(IDENTITY), 32);
    expect(curve.x[0]).toBe(0);
    expect(curve.x[31]).toBe(1);
  });

  it('gives back the diagonal for an identity LUT', () => {
    const curve = neutralCurveForLut(IDENTITY, 33);
    for (let i = 0; i < curve.x.length; i++) {
      expect(curve.r[i]).toBeCloseTo(curve.x[i], 5);
      expect(curve.g[i]).toBeCloseTo(curve.x[i], 5);
      expect(curve.b[i]).toBeCloseTo(curve.x[i], 5);
    }
  });

  it('shows a lifted black point where the LUT lifts one', () => {
    const lifted = lut3d(9, (r, g, b) => [0.1 + r * 0.9, 0.1 + g * 0.9, 0.1 + b * 0.9]);
    const curve = neutralCurveForLut(lifted, 33);
    expect(curve.r[0]).toBeCloseTo(0.1, 4);
    expect(curve.r[32]).toBeCloseTo(1, 4);
  });

  it('separates the channels where the LUT applies a cast', () => {
    const warm = lut3d(9, (r, g, b) => [Math.min(1, r * 1.2), g, b * 0.8]);
    const curve = neutralCurveForLut(warm, 33);
    const mid = 16;
    expect(curve.r[mid]).toBeGreaterThan(curve.g[mid]);
    expect(curve.b[mid]).toBeLessThan(curve.g[mid]);
  });

  it('reads a curve at an arbitrary position', () => {
    const curve = neutralCurveForLut(IDENTITY, 5);
    expect(curveAt(curve, 0, 0.375)).toBeCloseTo(0.375, 5);
    expect(curveAt(curve, 1, 0)).toBeCloseTo(0, 6);
    expect(curveAt(curve, 2, 1)).toBeCloseTo(1, 6);
  });

  it('follows a stack rather than a single LUT', () => {
    const halve = lut3d(2, (r, g, b) => [r * 0.5, g * 0.5, b * 0.5]);
    const curve = neutralCurve([slot(halve), slot(halve)], 5);
    expect(curve.r[4]).toBeCloseTo(0.25, 5);
  });
});

describe('histogram', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 64, 200, 32, 255,
  ]);

  it('counts every pixel exactly once per channel', () => {
    const hist = histogram(pixels, 16);
    let total = 0;
    for (const count of hist.r) total += count;
    expect(total).toBe(4);
  });

  it('uses the requested number of bins', () => {
    expect(histogram(pixels, 32).bins).toBe(32);
    expect(histogram(pixels, 32).r.length).toBe(32);
  });

  it('puts black in the first bin and white in the last', () => {
    const hist = histogram(pixels, 8);
    expect(hist.r[0]).toBeGreaterThan(0);
    expect(hist.r[7]).toBeGreaterThan(0);
  });

  it('reports a peak of at least one', () => {
    expect(histogram(new Uint8ClampedArray(0), 8).peak).toBe(1);
  });

  it('computes a luma channel as well as the three colours', () => {
    const hist = histogram(pixels, 4);
    let total = 0;
    for (const count of hist.luma) total += count;
    expect(total).toBe(4);
  });
});

describe('grading a pixel buffer', () => {
  const pixels = new Uint8ClampedArray([200, 100, 50, 255, 10, 20, 30, 128]);

  it('applies the stack to every pixel', () => {
    const halve = lut3d(2, (r, g, b) => [r * 0.5, g * 0.5, b * 0.5]);
    const out = gradeBuffer(full(halve), pixels);
    expect(out[0]).toBe(100);
    expect(out[1]).toBe(50);
    expect(out[2]).toBe(25);
  });

  it('leaves alpha alone', () => {
    const halve = lut3d(2, (r, g, b) => [r * 0.5, g * 0.5, b * 0.5]);
    const out = gradeBuffer(full(halve), pixels);
    expect(out[3]).toBe(255);
    expect(out[7]).toBe(128);
  });

  it('clamps values that leave the range', () => {
    const blow = lut3d(2, (r, g, b) => [r * 4, g * 4, b * 4]);
    const out = gradeBuffer(full(blow), pixels);
    expect(out[0]).toBe(255);
  });
});

describe('cube corners', () => {
  it('reports all eight corners', () => {
    expect(cornerMoves(full(IDENTITY))).toHaveLength(8);
  });

  it('reports no movement for an identity LUT', () => {
    for (const move of cornerMoves(full(IDENTITY))) {
      expect(move.distance).toBeLessThan(1e-5);
    }
  });

  it('measures the distance a corner travels', () => {
    const crush = lut3d(2, (r, g, b) =>
      r === 1 && g === 1 && b === 1 ? [0, 1, 1] : [r, g, b],
    );
    const white = cornerMoves(full(crush)).find((move) => move.name === 'white');
    expect(white).toBeDefined();
    expect(white?.distance).toBeCloseTo(1, 5);
  });

  it('names the corners in the order the cube indexes them', () => {
    const names = cornerMoves(full(IDENTITY)).map((move) => move.name);
    expect(names).toEqual([
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
    ]);
  });
});

describe('measurements', () => {
  it('reads an identity LUT as doing nothing at all', () => {
    const stats = measure(full(IDENTITY));
    expect(stats.maxDelta).toBeLessThan(1e-5);
    expect(stats.contrast).toBeCloseTo(1, 4);
    expect(stats.exposure).toBeCloseTo(0, 5);
    expect(stats.saturation).toBeCloseTo(1, 4);
    expect(stats.blackLevel).toBeCloseTo(0, 5);
    expect(stats.whiteLevel).toBeCloseTo(1, 5);
  });

  it('measures a black lift', () => {
    const lifted = lut1d(33, (x) => [0.12 + x * 0.88, 0.12 + x * 0.88, 0.12 + x * 0.88]);
    expect(measure(full(lifted)).blackLevel).toBeCloseTo(0.12, 3);
  });

  it('measures a highlight rolloff', () => {
    const rolled = lut1d(33, (x) => [x * 0.85, x * 0.85, x * 0.85]);
    expect(measure(full(rolled)).whiteLevel).toBeCloseTo(0.85, 3);
  });

  it('measures added contrast as a slope above one', () => {
    const punchy = lut1d(65, (x) => {
      const v = contrastCurve(x, 1.5);
      return [v, v, v];
    });
    expect(measure(full(punchy)).contrast).toBeGreaterThan(1.1);
  });

  it('measures reduced contrast as a slope below one', () => {
    const flat = lut1d(65, (x) => {
      const v = contrastCurve(x, 0.6);
      return [v, v, v];
    });
    expect(measure(full(flat)).contrast).toBeLessThan(0.9);
  });

  it('reads a pure saturation change back at its own value', () => {
    const sat = lut3d(17, (r, g, b) => {
      const y = luma([r, g, b]);
      const s = 0.5;
      return [y + (r - y) * s, y + (g - y) * s, y + (b - y) * s];
    });
    expect(measure(full(sat)).saturation).toBeCloseTo(0.5, 1);
  });

  it('does not mistake a contrast change for a saturation change', () => {
    const punchy = lut1d(65, (x) => {
      const v = contrastCurve(x, 1.6);
      return [v, v, v];
    });
    expect(measure(full(punchy)).saturation).toBeCloseTo(1, 2);
  });

  it('measures a warm cast as positive temperature', () => {
    const warm = lut3d(17, (r, g, b) => [Math.min(1, r * 1.15), g, b * 0.85]);
    expect(measure(full(warm)).temperature).toBeGreaterThan(0.02);
  });

  it('measures a cool cast as negative temperature', () => {
    const cool = lut3d(17, (r, g, b) => [r * 0.85, g, Math.min(1, b * 1.15)]);
    expect(measure(full(cool)).temperature).toBeLessThan(-0.02);
  });

  it('measures a green cast as positive tint', () => {
    const green = lut3d(17, (r, g, b) => [r, Math.min(1, g * 1.15), b]);
    expect(measure(full(green)).tint).toBeGreaterThan(0.02);
  });

  it('counts the stops a channel is flat for at the top', () => {
    // Red reaches its maximum a quarter of the way up, which is two stops
    // below white.
    const clipped = lut1d(65, (x) => [Math.min(1, x * 4), x, x]);
    const stats = measure(full(clipped));
    expect(stats.topFlatStops[0]).toBeCloseTo(2, 1);
    expect(stats.topFlatStops[1]).toBe(0);
  });

  it('finds the level below which everything is black', () => {
    const crushed = lut1d(65, (x) => {
      const v = Math.max(0, (x - 0.25) / 0.75);
      return [v, v, v];
    });
    expect(measure(full(crushed)).shadowCrush).toBeCloseTo(0.25, 1);
  });

  it('gives the same numbers every time it is called', () => {
    const lut = lut3d(9, (r, g, b) => [r * 0.9, g, Math.min(1, b * 1.1)]);
    expect(measure(full(lut))).toEqual(measure(full(lut)));
  });
});

describe('the plain English summary', () => {
  it('says an identity LUT does nothing', () => {
    expect(summarize(measure(full(IDENTITY)))).toBe(
      'This LUT leaves the image essentially unchanged.',
    );
  });

  it('says a 2 point identity LUT also does nothing', () => {
    expect(summarize(measure(full(identityLut(2))))).toContain('essentially unchanged');
  });

  it('says an empty stack does nothing', () => {
    expect(describeStack([])).toContain('essentially unchanged');
  });

  it('says a LUT at zero strength does nothing', () => {
    const strong = lut3d(9, (r, g, b) => [r * 0.4, g * 0.4, b * 0.4]);
    expect(describeStack([slot(strong, 0)])).toContain('essentially unchanged');
  });

  it('mentions lifted shadows', () => {
    const lifted = lut1d(33, (x) => [0.09 + x * 0.91, 0.09 + x * 0.91, 0.09 + x * 0.91]);
    expect(describeStack(full(lifted))).toContain('lifts the shadows');
  });

  it('mentions crushed shadows', () => {
    const crushed = lut1d(65, (x) => {
      const v = Math.max(0, (x - 0.2) / 0.8);
      return [v, v, v];
    });
    expect(describeStack(full(crushed))).toContain('to black');
  });

  it('mentions added contrast', () => {
    const punchy = lut1d(65, (x) => {
      const v = contrastCurve(x, 1.6);
      return [v, v, v];
    });
    expect(describeStack(full(punchy))).toContain('adds contrast');
  });

  it('mentions flattened contrast', () => {
    const flat = lut1d(65, (x) => {
      const v = contrastCurve(x, 0.55);
      return [v, v, v];
    });
    expect(describeStack(full(flat))).toContain('flattens contrast');
  });

  it('mentions a highlight rolloff', () => {
    const rolled = lut1d(33, (x) => [x * 0.8, x * 0.8, x * 0.8]);
    expect(describeStack(full(rolled))).toContain('rolls the highlights off');
  });

  it('names the channel and the number of stops that are crushed', () => {
    const clipped = lut1d(65, (x) => [Math.min(1, x * 4), x, x]);
    expect(describeStack(full(clipped))).toContain('crushes the top two stops of red');
  });

  it('mentions warming', () => {
    const warm = lut3d(17, (r, g, b) => [Math.min(1, r * 1.2), g, b * 0.8]);
    expect(describeStack(full(warm))).toContain('warms the midtones');
  });

  it('mentions cooling', () => {
    const cool = lut3d(17, (r, g, b) => [r * 0.8, g, Math.min(1, b * 1.2)]);
    expect(describeStack(full(cool))).toContain('cools the midtones');
  });

  it('names the direction of a tint shift', () => {
    const green = lut3d(17, (r, g, b) => [r, Math.min(1, g * 1.12), b]);
    const magenta = lut3d(17, (r, g, b) => [r, g * 0.88, b]);
    expect(describeStack(full(green))).toContain('toward green');
    expect(describeStack(full(magenta))).toContain('toward magenta');
  });

  it('mentions a saturation boost', () => {
    const sat = lut3d(17, (r, g, b) => {
      const y = luma([r, g, b]);
      return [y + (r - y) * 1.4, y + (g - y) * 1.4, y + (b - y) * 1.4];
    });
    expect(describeStack(full(sat))).toContain('boosts saturation');
  });

  it('mentions a saturation cut', () => {
    const sat = lut3d(17, (r, g, b) => {
      const y = luma([r, g, b]);
      return [y + (r - y) * 0.6, y + (g - y) * 0.6, y + (b - y) * 0.6];
    });
    expect(describeStack(full(sat))).toContain('pulls saturation down');
  });

  it('calls a monochrome LUT black and white', () => {
    const mono = lut3d(17, (r, g, b) => {
      const y = luma([r, g, b]);
      return [y, y, y];
    });
    expect(describeStack(full(mono))).toContain('converts to black and white');
  });

  it('is one sentence ending in a full stop', () => {
    const lut = lut3d(17, (r, g, b) => [Math.min(1, r * 1.2), g * 0.95, b * 0.8]);
    const text = describeStack(full(lut));
    expect(text.endsWith('.')).toBe(true);
    expect(text.split('.').filter((part) => part.trim() !== '')).toHaveLength(1);
  });

  it('joins several effects with commas and a final and', () => {
    const busy = lut1d(65, (x) => {
      const v = contrastCurve(0.06 + x * 0.88, 1.5);
      return [Math.min(1, v * 1.15), v, v * 0.85];
    });
    const text = describeStack(full(busy));
    expect(text).toContain(', and ');
  });

  it('keeps the sentence short even when many things change', () => {
    const busy = lut1d(65, (x) => {
      const v = contrastCurve(0.08 + x * 0.8, 1.7);
      return [Math.min(1, v * 1.3), v * 1.05, v * 0.7];
    });
    const text = describeStack(full(busy));
    expect(text.split(',').length).toBeLessThanOrEqual(5);
  });

  it('is a pure function of the measurements', () => {
    const lut = lut3d(9, (r, g, b) => [r * 0.9, g, Math.min(1, b * 1.1)]);
    const stats = measure(full(lut));
    expect(summarize(stats)).toBe(summarize(stats));
    expect(summarize(stats)).toBe(describeStack(full(lut)));
  });

  it('always starts with the same subject', () => {
    const lut = lut3d(9, (r, g, b) => [r * 0.7, g * 0.7, b * 0.7]);
    expect(describeStack(full(lut)).startsWith('This LUT ')).toBe(true);
  });
});
