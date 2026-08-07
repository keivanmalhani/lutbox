/**
 * The fallback renderer, for browsers with no WebGL2.
 *
 * This is the same picture as src/gl.ts produces, computed the slow way. It
 * exists because a browser without WebGL2 was previously shown a black
 * rectangle where the image should be, and a colour tool that shows a chunk of
 * its visitors nothing is broken for them however good the shader is.
 *
 * There is no second implementation of the lookup here. Every pixel goes
 * through gradeBuffer in src/analyze.ts, which is the trilinear sampler the
 * curve plots and the histograms already use and which the tests check against
 * hand-computed lattice points. The only thing this file adds is the framing:
 * which pixels come from the graded copy and which from the original.
 *
 * The tradeoff it makes is resolution. Grading a megapixel in JavaScript costs
 * a couple of hundred milliseconds, and the strength slider fires on every
 * pixel of a drag, so the preview is computed at a reduced size and scaled up
 * by the browser. Exports are not reduced: those go through the full
 * resolution path below, because an export is one deliberate action and the
 * file should be the same size the GPU path would have written.
 */

import { gradeBuffer } from './analyze';
import type { Slot } from './analyze';
import type { RenderMode } from './gl';

export class CpuError extends Error {}

export interface CpuFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * How many pixels the preview is allowed to be.
 *
 * Measured at roughly 0.19 microseconds per pixel for a 33 point table on a
 * current desktop, so 400,000 pixels is about 75 milliseconds per regrade
 * there and a few hundred on the kind of machine that has WebGL2 switched off.
 * That is slow enough to feel and fast enough to use, which is the honest
 * position for a fallback. A 3:2 frame lands at about 775 x 516.
 */
export const CPU_PIXEL_BUDGET = 400000;

/**
 * The preview size for a frame, never larger than the frame itself.
 *
 * Scaling by the square root of the ratio keeps the aspect ratio and lands on
 * the budget rather than under it, so a panorama and a square both get the
 * same number of pixels of detail.
 */
export function previewSize(
  width: number,
  height: number,
  budget = CPU_PIXEL_BUDGET,
): { width: number; height: number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (budget <= 0) return { width: 1, height: 1 };
  const total = w * h;
  if (total <= budget) return { width: w, height: h };
  const scale = Math.sqrt(budget / total);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * The first column that shows the graded image in split mode.
 *
 * The shader tests the pixel centre, `(i + 0.5) / width >= split`, so this
 * does too. Rounding the split to a whole column any other way would put the
 * seam half a pixel away from where the GPU puts it, and the two paths are
 * meant to be interchangeable.
 */
export function splitColumn(width: number, split: number): number {
  const boundary = Math.ceil(split * width - 0.5);
  return Math.min(width, Math.max(0, boundary));
}

/**
 * Assemble one output frame from an original and a graded copy of the same
 * pixels. Pure: it reads both buffers and writes a new one.
 *
 * Side by side returns a frame of double width, which is what the GL path
 * does as well, so the stage can size itself the same way in both cases.
 */
export function composeFrame(
  original: Uint8ClampedArray,
  graded: Uint8ClampedArray,
  width: number,
  height: number,
  mode: RenderMode,
  split: number,
): CpuFrame {
  const stride = width * 4;

  if (mode === 'graded') return { data: graded.slice(), width, height };
  if (mode === 'original') return { data: original.slice(), width, height };

  if (mode === 'sidebyside') {
    const out = new Uint8ClampedArray(stride * 2 * height);
    for (let y = 0; y < height; y++) {
      const from = y * stride;
      const to = y * stride * 2;
      out.set(original.subarray(from, from + stride), to);
      out.set(graded.subarray(from, from + stride), to + stride);
    }
    return { data: out, width: width * 2, height };
  }

  const cut = splitColumn(width, split) * 4;
  const out = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    out.set(original.subarray(row, row + cut), row);
    out.set(graded.subarray(row + cut, row + stride), row + cut);
  }
  return { data: out, width, height };
}

/** True when the two stacks would produce identical pixels. */
export function sameStack(a: readonly Slot[], b: readonly Slot[] | null): boolean {
  if (b === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // The LUT is compared by identity rather than by contents: a table is up
    // to two million floats and the entries in the stack are never mutated in
    // place, they are replaced.
    if (a[i].lut !== b[i].lut) return false;
    if (a[i].strength !== b[i].strength) return false;
    if (a[i].enabled !== b[i].enabled) return false;
  }
  return true;
}

/** The canvas size a given mode needs, matching Renderer.sizeFor. */
export function cpuSizeFor(
  mode: RenderMode,
  width: number,
  height: number,
): { width: number; height: number } {
  return mode === 'sidebyside' ? { width: width * 2, height } : { width, height };
}

export class CpuRenderer {
  private ctx: CanvasRenderingContext2D;
  private source: HTMLCanvasElement | null = null;
  private originalPixels: Uint8ClampedArray | null = null;
  private gradedPixels: Uint8ClampedArray | null = null;
  private slots: Slot[] = [];
  /** The stack gradedPixels was computed for, so a redraw can skip the work. */
  private gradedFor: Slot[] | null = null;

  /** The reduced size the preview is computed at. */
  imageWidth = 0;
  imageHeight = 0;
  /** The size the image was loaded at, which is what an export gets. */
  sourceWidth = 0;
  sourceHeight = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new CpuError('This browser gave us neither WebGL2 nor a 2D canvas context.');
    }
    this.ctx = ctx;
  }

  setImage(source: HTMLCanvasElement, width: number, height: number): void {
    const size = previewSize(width, height);
    const scratch = document.createElement('canvas');
    scratch.width = size.width;
    scratch.height = size.height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new CpuError('Could not get a 2D context to reduce the image into.');
    ctx.drawImage(source, 0, 0, size.width, size.height);

    this.source = source;
    this.sourceWidth = width;
    this.sourceHeight = height;
    this.imageWidth = size.width;
    this.imageHeight = size.height;
    this.originalPixels = ctx.getImageData(0, 0, size.width, size.height).data;
    this.gradedPixels = null;
    this.gradedFor = null;
  }

  setSlots(slots: readonly Slot[]): void {
    this.slots = slots.slice();
  }

  sizeFor(mode: RenderMode): { width: number; height: number } {
    return cpuSizeFor(mode, this.imageWidth, this.imageHeight);
  }

  /** True when the reduced preview is smaller than the image behind it. */
  get reduced(): boolean {
    return this.imageWidth < this.sourceWidth;
  }

  render(mode: RenderMode, split: number): void {
    const original = this.originalPixels;
    if (!original) return;

    if (!this.gradedPixels || !sameStack(this.slots, this.gradedFor)) {
      const active = this.slots.filter((slot) => slot.enabled && slot.strength > 0);
      // With nothing to apply the graded copy is the original, and there is
      // no reason to walk a megapixel to find that out.
      this.gradedPixels = active.length === 0 ? original : gradeBuffer(active, original);
      this.gradedFor = this.slots.slice();
    }

    const frame = composeFrame(
      original,
      this.gradedPixels,
      this.imageWidth,
      this.imageHeight,
      mode,
      split,
    );
    if (this.canvas.width !== frame.width) this.canvas.width = frame.width;
    if (this.canvas.height !== frame.height) this.canvas.height = frame.height;
    const image = this.ctx.createImageData(frame.width, frame.height);
    image.data.set(frame.data);
    this.ctx.putImageData(image, 0, 0);
  }

  /**
   * A full resolution graded copy of the frame, for export.
   *
   * Deliberately not cached. It is allocated per export and thrown away,
   * because holding a second full size buffer around for a button that is
   * pressed once is the wrong thing to do to a machine already short of the
   * hardware to do this properly.
   */
  fullGradedCanvas(): HTMLCanvasElement | null {
    if (!this.source) return null;
    const canvas = document.createElement('canvas');
    canvas.width = this.sourceWidth;
    canvas.height = this.sourceHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(this.source, 0, 0, this.sourceWidth, this.sourceHeight);
    const active = this.slots.filter((slot) => slot.enabled && slot.strength > 0);
    if (active.length > 0) {
      const image = ctx.getImageData(0, 0, this.sourceWidth, this.sourceHeight);
      image.data.set(gradeBuffer(active, image.data));
      ctx.putImageData(image, 0, 0);
    }
    return canvas;
  }
}
