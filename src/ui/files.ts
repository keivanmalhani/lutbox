/**
 * Getting files into the page.
 *
 * Everything here uses the File API and stays in the tab. There is no fetch,
 * no XMLHttpRequest and no form post anywhere in this project.
 */

import type { ImageSource } from './state';

export interface Sorted {
  images: File[];
  luts: File[];
  rejected: File[];
}

const IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp|gif|bmp|avif)$/i;
const IMAGE_NAMES = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

export function sortFiles(files: readonly File[]): Sorted {
  const images: File[] = [];
  const luts: File[] = [];
  const rejected: File[] = [];
  for (const file of files) {
    if (/\.cube$/i.test(file.name)) luts.push(file);
    else if (IMAGE_TYPES.test(file.type) || IMAGE_NAMES.test(file.name)) images.push(file);
    else rejected.push(file);
  }
  return { images, luts, rejected };
}

export async function readText(file: File): Promise<string> {
  return await file.text();
}

interface Decoded {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  release: () => void;
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the img element path.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('The browser could not decode this image.'));
      node.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * Decode an image into a canvas, shrinking it only if the GPU cannot hold a
 * texture that large. Anything that fits is kept at full resolution.
 */
export async function loadImage(file: File, maxSize: number): Promise<ImageSource> {
  const decoded = await decode(file);
  try {
    if (decoded.width === 0 || decoded.height === 0) {
      throw new Error('That image reported a size of zero.');
    }
    const limit = Math.max(1024, maxSize);
    const scale = Math.min(1, limit / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('Could not get a 2D context to decode into.');
    decoded.draw(ctx, width, height);

    return {
      canvas,
      width,
      height,
      name: file.name,
      downscaled: scale < 1,
    };
  } finally {
    decoded.release();
  }
}

/** A small copy of the frame, used for the histograms. */
export function sampleThumbnail(source: ImageSource, longest = 240): Uint8ClampedArray {
  const scale = Math.min(1, longest / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return new Uint8ClampedArray(0);
  ctx.drawImage(source.canvas, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

export interface DropHandlers {
  onFiles: (files: File[]) => void;
  onDragState: (active: boolean) => void;
}

/** Whole-window drop target, so you can let go anywhere. */
export function installDropTarget(handlers: DropHandlers): void {
  let depth = 0;

  const hasFiles = (event: DragEvent): boolean => {
    const types = event.dataTransfer?.types;
    return types ? Array.prototype.indexOf.call(types, 'Files') >= 0 : false;
  };

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    handlers.onDragState(true);
  });

  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) handlers.onDragState(false);
  });

  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    depth = 0;
    handlers.onDragState(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) handlers.onFiles(files);
  });
}
