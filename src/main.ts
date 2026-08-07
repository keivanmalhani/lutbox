/**
 * lutbox. Drop an image and a .cube file, see the grade, understand it.
 *
 * This file wires the parser, the renderer, the analysis and the panel
 * together. Nothing here talks to a network.
 */

import './styles.css';

import { parseCube, CubeParseError } from './cube';
import type { CubeLut } from './cube';
import { MAX_SLOTS } from './gl';
import type { RenderMode } from './gl';
import {
  cornerMoves,
  gradeBuffer,
  histogram,
  measure,
  neutralCurve,
  summarize,
} from './analyze';
import type { Histogram } from './analyze';
import { PRESETS, buildPreset, generateLut, generateCubeText, defaultParams } from './generate';
import { drawSampleImage, SAMPLE_HEIGHT, SAMPLE_WIDTH } from './sample';
import { Store, makeId } from './ui/state';
import type { ImageSource, LutEntry } from './ui/state';
import { Stage } from './ui/stage';
import { Panel } from './ui/panel';
import { analysisCardSvg } from './ui/charts';
import { el, download, query } from './ui/dom';
import { installDropTarget, loadImage, sampleThumbnail, sortFiles } from './ui/files';
import { toast } from './ui/toast';

const store = new Store();

let thumbnail: Uint8ClampedArray | null = null;
let beforeHistogram: Histogram | null = null;
let analysisTimer = 0;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const stage = new Stage({
  onSplitChange: (split) => {
    store.update((state) => {
      state.split = split;
    });
  },
});

const panel = new Panel({
  onModeChange: (mode) => setMode(mode),
  onStrengthChange: (id, strength) => {
    store.update((state) => {
      const entry = state.entries.find((item) => item.id === id);
      if (entry) entry.strength = strength;
    });
  },
  onToggle: (id) => {
    store.update((state) => {
      const entry = state.entries.find((item) => item.id === id);
      if (entry) entry.enabled = !entry.enabled;
    });
  },
  onRemove: (id) => {
    store.update((state) => {
      state.entries = state.entries.filter((item) => item.id !== id);
    });
  },
  onMove: (id, direction) => {
    store.update((state) => {
      const index = state.entries.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= state.entries.length) return;
      const copy = state.entries.slice();
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      state.entries = copy;
    });
  },
  onAddPreset: (presetId) => {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    addLut(buildPreset(preset), preset.label, 'preset');
  },
  onPickLut: () => lutInput.click(),
  onPickImage: () => imageInput.click(),
  onGeneratorChange: () => {
    // Nothing to do until the user asks for the LUT; the sliders are cheap.
  },
  onGeneratorApply: () => {
    const params = panel.params;
    addLut(generateLut(params), params.title, 'generated');
  },
  onGeneratorDownload: () => {
    const params = panel.params;
    const text = generateCubeText(params);
    download(new Blob([text], { type: 'text/plain' }), safeFilename(params.title) + '.cube');
    toast('Saved', safeFilename(params.title) + '.cube written to your downloads.');
  },
  onExport: (kind) => exportOutput(kind),
});

const imageInput = el('input', {
  type: 'file',
  accept: 'image/*',
  class: 'visually-hidden',
  'aria-hidden': 'true',
  tabindex: '-1',
});
const lutInput = el('input', {
  type: 'file',
  accept: '.cube',
  multiple: true,
  class: 'visually-hidden',
  'aria-hidden': 'true',
  tabindex: '-1',
});

imageInput.addEventListener('change', () => {
  if (imageInput.files && imageInput.files.length > 0) {
    void handleFiles(Array.from(imageInput.files));
  }
  imageInput.value = '';
});
lutInput.addEventListener('change', () => {
  if (lutInput.files && lutInput.files.length > 0) {
    void handleFiles(Array.from(lutInput.files));
  }
  lutInput.value = '';
});

function buildLayout(): void {
  const header = el(
    'header',
    { class: 'masthead' },
    el(
      'div',
      { class: 'masthead-main' },
      el('h1', { class: 'wordmark', text: 'lutbox' }),
      el('p', {
        class: 'tagline',
        text: 'Drop a photo and a .cube LUT. See the grade, and see what it is doing.',
      }),
    ),
    el(
      'p',
      { class: 'privacy' },
      el('span', { class: 'privacy-dot', 'aria-hidden': 'true' }),
      'Everything runs in this tab. Your image is never uploaded, because there is no server.',
    ),
  );

  const main = el('main', { class: 'layout' }, stage.root, panel.root);
  const app = query<HTMLElement>('#app');
  app.append(header, main, imageInput, lutInput);
}

// ---------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------

function setMode(mode: RenderMode): void {
  store.update((state) => {
    state.mode = mode;
  });
}

function addLut(lut: CubeLut, name: string, source: LutEntry['source'], size?: number): void {
  if (store.state.entries.length >= MAX_SLOTS) {
    toast(
      'Stack is full',
      'lutbox holds ' + MAX_SLOTS + ' LUTs at once. Remove one to add another.',
      'error',
    );
    return;
  }
  const entry: LutEntry = {
    id: makeId('lut'),
    name,
    lut,
    strength: 1,
    enabled: true,
    source,
  };
  if (size !== undefined) entry.bytes = size;
  store.update((state) => {
    state.entries = state.entries.concat(entry);
  });
}

function setImage(image: ImageSource): void {
  store.update((state) => {
    state.image = image;
  });
  stage.setImage(image);
  thumbnail = sampleThumbnail(image);
  beforeHistogram = thumbnail.length > 0 ? histogram(thumbnail) : null;
  scheduleAnalysis();
  render();
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

async function handleFiles(files: File[]): Promise<void> {
  const sorted = sortFiles(files);

  for (const file of sorted.luts) {
    try {
      const text = await file.text();
      const lut = parseCube(text, { name: file.name });
      addLut(lut, file.name, 'file', file.size);
    } catch (error) {
      if (error instanceof CubeParseError) {
        toast(
          'Could not read ' + file.name,
          error.message,
          'error',
        );
      } else {
        toast('Could not read ' + file.name, String(error), 'error');
      }
    }
  }

  if (sorted.images.length > 0) {
    const file = sorted.images[0];
    try {
      const max = stage.renderer ? stage.renderer.info.maxTextureSize : 4096;
      const image = await loadImage(file, max);
      setImage(image);
      if (image.downscaled) {
        toast(
          'Image reduced',
          'This GPU tops out at ' +
            max +
            ' pixels on a side, so the preview and the export are ' +
            image.width +
            ' x ' +
            image.height +
            '.',
        );
      }
    } catch (error) {
      toast('Could not open ' + file.name, String(error), 'error');
    }
  }

  for (const file of sorted.rejected) {
    toast(
      'Ignored ' + file.name,
      'lutbox takes images and .cube LUT files. That looked like neither.',
      'error',
    );
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function scheduleAnalysis(): void {
  if (analysisTimer) window.clearTimeout(analysisTimer);
  analysisTimer = window.setTimeout(runAnalysis, 70);
}

function runAnalysis(): void {
  analysisTimer = 0;
  const slots = store.slots();
  const curve = neutralCurve(slots, 128);
  const stats = measure(slots);
  const summary = summarize(stats);
  const moves = cornerMoves(slots);

  let after: Histogram | null = null;
  if (thumbnail && thumbnail.length > 0) {
    after = slots.length === 0 ? beforeHistogram : histogram(gradeBuffer(slots, thumbnail));
  }

  const detail: Array<[string, string]> = [
    ['black level', stats.blackLevel.toFixed(4)],
    ['white level', stats.whiteLevel.toFixed(4)],
    ['midtone slope', stats.contrast.toFixed(3)],
    ['exposure shift', (stats.exposure >= 0 ? '+' : '') + stats.exposure.toFixed(4)],
    ['saturation', stats.saturation.toFixed(3)],
    ['largest move', stats.maxDelta.toFixed(4)],
  ];

  panel.setAnalysis({ summary, curve, before: beforeHistogram, after, moves, detail });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(): void {
  const state = store.state;
  const mode = store.effectiveMode();
  stage.setMode(state.flipped ? 'original' : state.mode);
  stage.setSplit(state.split);
  if (state.flipped) {
    stage.setSingleLabel('ORIGINAL');
  } else if (state.mode === 'graded') {
    stage.setSingleLabel('GRADED');
  } else {
    stage.resetLabels();
  }
  // The stack has to reach the renderer before the draw, and this is the one
  // place every state change funnels through. The stage skips the work when
  // nothing about the stack actually moved.
  stage.setSlots(store.slots());
  stage.render(mode, state.split);
}

store.subscribe((state) => {
  panel.update(state);
  panel.setStackFull(state.entries.length >= MAX_SLOTS);
  render();
  scheduleAnalysis();
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'lutbox' : cleaned;
}

function baseName(): string {
  const image = store.state.image;
  const raw = image ? image.name.replace(/\.[^.]+$/, '') : 'lutbox';
  const lut = store.state.entries.find((entry) => entry.enabled);
  const suffix = lut ? '-' + lut.name.replace(/\.cube$/i, '') : '';
  return safeFilename(raw + suffix);
}

function exportOutput(kind: 'png' | 'jpeg' | 'card'): void {
  if (kind === 'card') {
    void exportCard();
    return;
  }
  if (!store.state.image) {
    toast('Nothing to export', 'Load an image first.', 'error');
    return;
  }

  // Whichever renderer is live, this is the full frame graded with no split.
  // On the CPU path it is a fresh full resolution canvas rather than the
  // reduced one on screen, so it takes a moment on a large image.
  const source = stage.exportCanvas();
  if (!source) {
    toast(
      'Nothing to export',
      'This browser gave us neither WebGL2 nor a 2D canvas, so there are no pixels to write.',
      'error',
    );
    return;
  }

  const type = kind === 'png' ? 'image/png' : 'image/jpeg';
  const extension = kind === 'png' ? '.png' : '.jpg';
  source.toBlob(
    (blob) => {
      if (!blob) {
        toast('Export failed', 'The browser would not turn the canvas into a file.', 'error');
        render();
        return;
      }
      download(blob, baseName() + extension);
      toast('Saved', baseName() + extension + ', ' + store.state.image?.width + ' pixels wide.');
      render();
    },
    type,
    kind === 'jpeg' ? 0.92 : undefined,
  );
}

async function exportCard(): Promise<void> {
  const slots = store.slots();
  const names = store.state.entries
    .filter((entry) => entry.enabled)
    .map((entry) => entry.name + ' at ' + Math.round(entry.strength * 100) + '%');
  const svg = analysisCardSvg({
    title: names.length > 0 ? names.join(' + ') : 'No LUT loaded',
    subtitle:
      (store.state.image ? store.state.image.name : 'generated sample') +
      '   ' +
      (store.state.image
        ? store.state.image.width + ' x ' + store.state.image.height
        : ''),
    summary: summarize(measure(slots)),
    curve: neutralCurve(slots, 128),
    before: beforeHistogram,
    after:
      thumbnail && thumbnail.length > 0
        ? slots.length === 0
          ? beforeHistogram
          : histogram(gradeBuffer(slots, thumbnail))
        : null,
    moves: cornerMoves(slots),
  });

  try {
    const blob = await svgToPng(svg, 760, 620, 2);
    download(blob, baseName() + '-analysis.png');
    toast('Saved', baseName() + '-analysis.png');
  } catch (error) {
    toast('Export failed', String(error), 'error');
  }
}

/** Rasterise an SVG string. The data URL keeps this off the network. */
function svgToPng(svg: string, width: number, height: number, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No 2D context for the card.'));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The browser would not encode the card.'));
      }, 'image/png');
    };
    image.onerror = () => reject(new Error('The browser would not render the card.'));
    image.src = url;
  });
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // A slider keeps focus after you drag it, and you cannot type into one, so
  // the shortcuts should keep working while it is focused.
  if (target instanceof HTMLInputElement && target.type === 'range') return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

window.addEventListener('keydown', (event) => {
  if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'b') {
    if (!store.state.flipped) {
      store.update((state) => {
        state.flipped = true;
      });
    }
    event.preventDefault();
  } else if (key === '1') {
    setMode('split');
  } else if (key === '2') {
    setMode('sidebyside');
  } else if (key === '3') {
    setMode('graded');
  }
});

window.addEventListener('keyup', (event) => {
  if (event.key.toLowerCase() !== 'b') return;
  if (store.state.flipped) {
    store.update((state) => {
      state.flipped = false;
    });
  }
});

window.addEventListener('blur', () => {
  if (store.state.flipped) {
    store.update((state) => {
      state.flipped = false;
    });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function start(): void {
  buildLayout();
  const ready = stage.init();

  installDropTarget({
    onFiles: (files) => void handleFiles(files),
    onDragState: (active) => stage.setDropActive(active),
  });

  const canvas = document.createElement('canvas');
  drawSampleImage(canvas);
  setImage({
    canvas,
    width: SAMPLE_WIDTH,
    height: SAMPLE_HEIGHT,
    name: 'sample-frame.png',
    downscaled: false,
  });

  panel.params = { ...defaultParams(), temperature: 0.2, contrast: 1.15, lift: 0.02 };
  panel.syncGenerator();

  const first = PRESETS[0];
  addLut(buildPreset(first), first.label, 'preset');

  if (!ready && stage.usingCpu) {
    toast(
      'Running on the CPU',
      'This browser has no WebGL2, so the LUT is being applied in JavaScript. ' +
        'Same result, much slower, and the preview is drawn at a reduced size. ' +
        'Exports stay at full resolution.',
    );
  } else if (!ready) {
    toast(
      'No preview',
      'This browser gave us neither WebGL2 nor a 2D canvas. The analysis, the ' +
        'parser and the generator still work.',
      'error',
    );
  }

  stage.onResize = () => render();
  window.addEventListener('resize', () => {
    stage.layout();
    render();
  });
}

start();
