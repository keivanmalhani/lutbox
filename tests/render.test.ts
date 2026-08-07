import { describe, expect, it } from 'vitest';
import { MAX_SLOTS, fragmentSource } from '../src/gl';
import {
  analysisCardSvg,
  cubeChartSvg,
  curveChartSvg,
  histogramSvg,
  wrapText,
} from '../src/ui/charts';
import { cornerMoves, histogram, neutralCurve } from '../src/analyze';
import { identityLut } from '../src/cube';
import { full, lut3d } from './helpers';

const WARM = lut3d(9, (r, g, b) => [Math.min(1, r * 1.2), g, b * 0.85], 'warm');

describe('the fragment shader source', () => {
  const source = fragmentSource(MAX_SLOTS);

  it('starts with the GLSL ES 3.00 version directive', () => {
    expect(source.startsWith('#version 300 es\n')).toBe(true);
  });

  it('declares a precision for every sampler type it uses', () => {
    expect(source).toContain('precision highp float;');
    expect(source).toContain('precision highp sampler3D;');
    expect(source).toContain('precision highp sampler2D;');
  });

  it('declares one full set of uniforms per slot', () => {
    for (let i = 0; i < MAX_SLOTS; i++) {
      expect(source).toContain('uniform sampler3D uLut3d' + i + ';');
      expect(source).toContain('uniform sampler2D uLut1d' + i + ';');
      expect(source).toContain('uniform float uStrength' + i + ';');
      expect(source).toContain('uniform vec3 uDomainMin' + i + ';');
    }
    expect(source).not.toContain('uLut3d' + MAX_SLOTS);
  });

  it('offsets the lookup to texel centres', () => {
    expect(source).toContain('(c * (size - 1.0) + 0.5) / size');
  });

  it('blends the table result by the slot strength', () => {
    expect(source).toContain('color = mix(color, lookup3d(uLut3d0, d0, uSize0), uStrength0);');
  });

  it('has balanced braces and parentheses', () => {
    const count = (needle: string): number => source.split(needle).length - 1;
    expect(count('{')).toBe(count('}'));
    expect(count('(')).toBe(count(')'));
  });

  it('writes to a single output', () => {
    expect(source.split('out vec4 fragColor;').length - 1).toBe(1);
  });
});

describe('chart output', () => {
  const curve = neutralCurve(full(WARM), 64);
  const moves = cornerMoves(full(WARM));
  const hist = histogram(new Uint8ClampedArray([10, 20, 30, 255, 200, 210, 220, 255]), 32);

  it('produces a well formed curve chart', () => {
    const svg = curveChartSvg(curve, { width: 300, height: 240 });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('aria-label="Neutral axis response curve"');
  });

  it('draws one path per channel plus a reference diagonal', () => {
    const svg = curveChartSvg(curve);
    expect(svg.split('<path').length - 1).toBe(3);
    expect(svg).toContain('stroke-dasharray');
  });

  it('labels the curve axes', () => {
    const svg = curveChartSvg(curve);
    for (const tick of ['0.00', '0.25', '0.50', '0.75', '1.00']) {
      expect(svg).toContain('>' + tick + '<');
    }
  });

  it('produces a well formed histogram', () => {
    const svg = histogramSvg(hist, { label: 'before' });
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('before');
    expect(svg.split('<path').length - 1).toBe(3);
  });

  it('produces a cube chart with twelve wireframe edges', () => {
    const svg = cubeChartSvg(moves);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('largest move');
  });

  it('keeps every projected corner distinct', () => {
    // A true isometric view would put black and white on the same spot.
    const svg = cubeChartSvg(cornerMoves(full(identityLut(2))), { width: 300, height: 190 });
    const points = Array.from(svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/g)).map(
      (match) => match[1] + ',' + match[2],
    );
    expect(points).toHaveLength(8);
    expect(new Set(points).size).toBe(8);
  });

  it('emits no raw angle brackets from user supplied text', () => {
    const svg = histogramSvg(hist, { label: '<script>bad</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('builds a self contained analysis card', () => {
    const svg = analysisCardSvg({
      title: 'Warm at 100%',
      subtitle: 'frame.png 1600 x 1000',
      summary: 'This LUT warms the midtones about 5 percent.',
      curve,
      before: hist,
      after: hist,
      moves,
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('NEUTRAL AXIS');
    expect(svg).toContain('CUBE CORNERS');
    expect(svg).toContain('HISTOGRAM');
    expect(svg).toContain('warms the midtones');
    // The card must be self contained. The only URL in it is the SVG
    // namespace, which is an identifier rather than something to fetch.
    expect(svg).not.toContain('href');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('@import');
    expect(svg).not.toContain('url(');
    const urls = svg.match(/https?:\/\/[^"']+/g) ?? [];
    expect(urls).toEqual(['http://www.w3.org/2000/svg']);
  });

  it('survives being asked for a card with no histogram', () => {
    const svg = analysisCardSvg({
      title: 'No image',
      subtitle: '',
      summary: 'This LUT leaves the image essentially unchanged.',
      curve,
      before: null,
      after: null,
      moves,
    });
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});

describe('text wrapping', () => {
  it('keeps a short line on one line', () => {
    expect(wrapText('short enough', 40)).toEqual(['short enough']);
  });

  it('breaks on the last space before the limit', () => {
    expect(wrapText('aaa bbb ccc ddd', 7)).toEqual(['aaa bbb', 'ccc ddd']);
  });

  it('does not drop a word longer than the limit', () => {
    const lines = wrapText('a supercalifragilistic b', 8);
    expect(lines.join(' ')).toBe('a supercalifragilistic b');
  });

  it('returns nothing for an empty string', () => {
    expect(wrapText('', 20)).toEqual([]);
  });
});
