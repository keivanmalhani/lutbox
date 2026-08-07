import { describe, expect, it } from 'vitest';
import { applyStack, applyWithStrength, sampleLut } from '../src/analyze';
import type { RGB } from '../src/analyze';
import { identityLut } from '../src/cube';
import { lut3d, slot } from './helpers';

/** Pulls everything toward black by half. Easy to reason about. */
const halve = lut3d(2, (r, g, b) => [r * 0.5, g * 0.5, b * 0.5], 'halve');
/** Swaps red and blue. */
const swap = lut3d(2, (r, g, b) => [b, g, r], 'swap');

const INPUT: RGB = [0.8, 0.4, 0.2];

describe('strength blending', () => {
  it('leaves the colour untouched at zero percent', () => {
    const out = applyWithStrength(halve, INPUT, 0);
    expect(out).toEqual(INPUT);
  });

  it('applies the table in full at one hundred percent', () => {
    const out = applyWithStrength(halve, INPUT, 1);
    const direct = sampleLut(halve, INPUT);
    expect(out[0]).toBeCloseTo(direct[0], 6);
    expect(out[1]).toBeCloseTo(direct[1], 6);
    expect(out[2]).toBeCloseTo(direct[2], 6);
  });

  it('lands exactly halfway at fifty percent', () => {
    const out = applyWithStrength(halve, INPUT, 0.5);
    expect(out[0]).toBeCloseTo(0.8 * 0.75, 6);
    expect(out[1]).toBeCloseTo(0.4 * 0.75, 6);
    expect(out[2]).toBeCloseTo(0.2 * 0.75, 6);
  });

  it('is linear in the strength', () => {
    const quarter = applyWithStrength(halve, INPUT, 0.25);
    const half = applyWithStrength(halve, INPUT, 0.5);
    const full = applyWithStrength(halve, INPUT, 1);
    expect(quarter[0] - INPUT[0]).toBeCloseTo((full[0] - INPUT[0]) * 0.25, 6);
    expect(half[0] - INPUT[0]).toBeCloseTo((full[0] - INPUT[0]) * 0.5, 6);
  });

  it('clamps a strength above one', () => {
    const out = applyWithStrength(halve, INPUT, 4);
    expect(out[0]).toBeCloseTo(0.4, 6);
  });

  it('clamps a negative strength', () => {
    const out = applyWithStrength(halve, INPUT, -2);
    expect(out).toEqual(INPUT);
  });

  it('does not change the input array', () => {
    const source: RGB = [0.8, 0.4, 0.2];
    applyWithStrength(halve, source, 0.5);
    expect(source).toEqual([0.8, 0.4, 0.2]);
  });

  it('an identity table at any strength is a no-op', () => {
    const out = applyWithStrength(identityLut(9), INPUT, 0.37);
    expect(out[0]).toBeCloseTo(INPUT[0], 6);
  });
});

describe('stacking', () => {
  it('returns the input for an empty stack', () => {
    expect(applyStack([], INPUT)).toEqual(INPUT);
  });

  it('feeds each LUT the output of the one before it', () => {
    const out = applyStack([slot(halve), slot(halve)], INPUT);
    expect(out[0]).toBeCloseTo(0.2, 6);
  });

  it('skips a disabled slot', () => {
    const out = applyStack(
      [{ lut: halve, strength: 1, enabled: false }, slot(halve)],
      INPUT,
    );
    expect(out[0]).toBeCloseTo(0.4, 6);
  });

  it('skips a slot at zero strength', () => {
    const out = applyStack([slot(halve, 0), slot(halve, 1)], INPUT);
    expect(out[0]).toBeCloseTo(0.4, 6);
  });

  it('honours the order of the stack', () => {
    // lift(x) = 0.2 + 0.8x, halve(x) = 0.5x. Halving first gives
    // 0.2 + 0.8 * 0.4 = 0.52; lifting first gives 0.5 * 0.84 = 0.42.
    const lift = lut3d(2, (r, g, b) => [
      Math.min(1, r + 0.2),
      Math.min(1, g + 0.2),
      Math.min(1, b + 0.2),
    ]);
    const halveThenLift = applyStack([slot(halve), slot(lift)], INPUT);
    const liftThenHalve = applyStack([slot(lift), slot(halve)], INPUT);
    expect(halveThenLift[0]).toBeCloseTo(0.52, 6);
    expect(liftThenHalve[0]).toBeCloseTo(0.42, 6);
  });

  it('combines strengths across a stack', () => {
    const out = applyStack([slot(halve, 0.5), slot(halve, 0.5)], INPUT);
    // Two 50 percent halvings: 0.8 -> 0.6 -> 0.45.
    expect(out[0]).toBeCloseTo(0.45, 6);
  });

  it('mixes a 1D and a 3D table in one stack', () => {
    const out = applyStack([slot(swap), slot(halve)], [1, 0, 0]);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(0.5, 6);
  });
});
