/**
 * The image area: the canvas, the split handle, and the labels that say which
 * half you are looking at.
 */

import { Renderer, GlError } from '../gl';
import type { RenderMode } from '../gl';
import { el, clear } from './dom';
import type { ImageSource } from './state';

export interface StageCallbacks {
  onSplitChange: (split: number) => void;
}

export class Stage {
  readonly root: HTMLElement;
  private frame: HTMLElement;
  private canvas: HTMLCanvasElement;
  private handle: HTMLElement;
  private labelLeft: HTMLElement;
  private labelRight: HTMLElement;
  private notice: HTMLElement;
  private dragging = false;

  renderer: Renderer | null = null;
  /** Set when WebGL2 is missing or the renderer refused to start. */
  glFailure: string | null = null;

  private mode: RenderMode = 'split';
  private split = 0.5;
  private image: ImageSource | null = null;

  constructor(private callbacks: StageCallbacks) {
    this.canvas = el('canvas', { class: 'stage-canvas', width: 16, height: 9 });
    this.handle = el(
      'div',
      {
        class: 'split-handle',
        role: 'slider',
        tabindex: '0',
        'aria-label': 'Split position between the original and the graded image',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '50',
      },
      el('span', { class: 'split-grip' }),
    );
    this.labelLeft = el('span', { class: 'stage-label stage-label-left', text: 'ORIGINAL' });
    this.labelRight = el('span', { class: 'stage-label stage-label-right', text: 'GRADED' });
    this.notice = el('div', { class: 'stage-notice' });

    this.frame = el(
      'div',
      { class: 'stage-frame' },
      this.canvas,
      this.labelLeft,
      this.labelRight,
      this.handle,
    );

    this.root = el('div', { class: 'stage' }, this.frame, this.notice);

    this.attachHandle();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        this.layout();
        this.onResize();
      });
      observer.observe(this.root);
    }
  }

  /** Called after the stage changes size, so the caller can redraw. */
  onResize: () => void = () => undefined;

  /** Start GL. Returns false when the browser cannot do it. */
  init(): boolean {
    try {
      this.renderer = new Renderer(this.canvas);
      return true;
    } catch (error) {
      this.glFailure =
        error instanceof GlError
          ? error.message
          : 'The graphics context failed to start: ' + String(error);
      this.showNoWebgl();
      return false;
    }
  }

  private showNoWebgl(): void {
    this.frame.classList.add('is-blank');
    clear(this.notice);
    this.notice.classList.add('is-error');
    this.notice.append(
      el('p', { class: 'notice-title', text: 'No WebGL2 in this browser' }),
      el('p', { text: this.glFailure ?? '' }),
      el('p', {
        class: 'notice-dim',
        text:
          'The parser, the curve plot, the histogram and the LUT generator all ' +
          'still work. Only the live preview needs the GPU. WebGL2 is available ' +
          'in current Chrome, Firefox, Edge and Safari 15 and later, and is ' +
          'sometimes switched off in browser settings or by a driver blocklist.',
      }),
    );
  }

  setImage(image: ImageSource | null): void {
    this.image = image;
    if (!image) return;
    this.frame.classList.remove('is-blank');
    if (this.renderer) {
      this.renderer.setImage(image.canvas, image.width, image.height);
    }
    this.layout();
  }

  /**
   * Fit the frame inside the stage, preserving the aspect ratio.
   *
   * Done in script rather than with the aspect-ratio property because the
   * canvas is the thing being sized and it is also the thing the ratio would
   * be read from, which is circular. Explicit pixels keep the split handle's
   * coordinates exact.
   */
  layout(): void {
    if (!this.image) return;
    const wide = this.mode === 'sidebyside';
    const sourceW = wide ? this.image.width * 2 : this.image.width;
    const ratio = sourceW / this.image.height;

    const style = getComputedStyle(this.root);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const noticeH = this.notice.offsetHeight > 0 ? this.notice.offsetHeight + 14 : 0;

    const availableW = Math.max(40, this.root.clientWidth - padX);
    const availableH = Math.max(40, this.root.clientHeight - padY - noticeH);

    let w = availableW;
    let h = w / ratio;
    if (h > availableH) {
      h = availableH;
      w = h * ratio;
    }
    this.frame.style.width = Math.floor(w) + 'px';
    this.frame.style.height = Math.floor(h) + 'px';
  }

  setMode(mode: RenderMode): void {
    // Laying out reads computed styles, so only do it when the shape of the
    // frame can actually have changed.
    const changed = this.mode !== mode;
    this.mode = mode;
    if (changed) this.layout();
    this.frame.dataset.mode = mode;
    const showHandle = mode === 'split';
    this.handle.style.display = showHandle ? '' : 'none';
    this.labelLeft.style.display = mode === 'split' || mode === 'sidebyside' ? '' : 'none';
    this.labelRight.style.display = mode === 'split' || mode === 'sidebyside' ? '' : 'none';
    if (mode === 'sidebyside') {
      this.labelLeft.style.left = '10px';
      this.labelRight.style.right = '10px';
    }
    this.setSplit(this.split);
  }

  setSplit(split: number): void {
    this.split = Math.max(0, Math.min(1, split));
    this.handle.style.left = this.split * 100 + '%';
    this.handle.setAttribute('aria-valuenow', String(Math.round(this.split * 100)));
    if (this.mode === 'split') {
      this.labelLeft.style.left = '10px';
      this.labelLeft.style.opacity = this.split > 0.12 ? '1' : '0';
      this.labelRight.style.right = '10px';
      this.labelRight.style.opacity = this.split < 0.88 ? '1' : '0';
    } else {
      this.labelLeft.style.opacity = '1';
      this.labelRight.style.opacity = '1';
    }
  }

  /** Which label to show when the whole frame is one thing. */
  setSingleLabel(text: string | null): void {
    if (text === null) {
      this.labelLeft.style.display = 'none';
      this.labelRight.style.display = 'none';
      return;
    }
    this.labelLeft.textContent = text;
    this.labelLeft.style.display = '';
    this.labelLeft.style.opacity = '1';
    this.labelRight.style.display = 'none';
  }

  resetLabels(): void {
    this.labelLeft.textContent = 'ORIGINAL';
    this.labelRight.textContent = 'GRADED';
  }

  render(mode: RenderMode, split: number): void {
    if (!this.renderer || !this.image) return;
    this.renderer.render(mode, split);
  }

  setDropActive(active: boolean): void {
    this.root.classList.toggle('is-drop', active);
  }

  message(title: string, body: string, kind: 'info' | 'error' = 'info'): void {
    clear(this.notice);
    this.notice.classList.toggle('is-error', kind === 'error');
    this.notice.append(el('p', { class: 'notice-title', text: title }), el('p', { text: body }));
  }

  clearMessage(): void {
    if (this.glFailure) return;
    clear(this.notice);
    this.notice.classList.remove('is-error');
  }

  /** Pixels for export, straight off the canvas. */
  get canvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  private attachHandle(): void {
    const move = (event: PointerEvent): void => {
      if (!this.dragging) return;
      const rect = this.frame.getBoundingClientRect();
      if (rect.width === 0) return;
      const next = (event.clientX - rect.left) / rect.width;
      this.callbacks.onSplitChange(Math.max(0, Math.min(1, next)));
      event.preventDefault();
    };

    const start = (event: PointerEvent): void => {
      this.dragging = true;
      this.handle.setPointerCapture(event.pointerId);
      this.handle.classList.add('is-dragging');
      move(event);
    };

    const end = (event: PointerEvent): void => {
      this.dragging = false;
      this.handle.classList.remove('is-dragging');
      if (this.handle.hasPointerCapture(event.pointerId)) {
        this.handle.releasePointerCapture(event.pointerId);
      }
    };

    this.handle.addEventListener('pointerdown', start);
    this.handle.addEventListener('pointermove', move);
    this.handle.addEventListener('pointerup', end);
    this.handle.addEventListener('pointercancel', end);

    // Clicking anywhere on the frame jumps the handle there, which is quicker
    // than dragging when you want to look at one edge.
    this.frame.addEventListener('pointerdown', (event) => {
      if (event.target === this.handle || this.handle.contains(event.target as Node)) return;
      if (this.mode !== 'split') return;
      const rect = this.frame.getBoundingClientRect();
      if (rect.width === 0) return;
      this.callbacks.onSplitChange((event.clientX - rect.left) / rect.width);
    });

    this.handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      if (event.key === 'ArrowLeft') {
        this.callbacks.onSplitChange(this.split - step);
        event.preventDefault();
      } else if (event.key === 'ArrowRight') {
        this.callbacks.onSplitChange(this.split + step);
        event.preventDefault();
      } else if (event.key === 'Home') {
        this.callbacks.onSplitChange(0);
        event.preventDefault();
      } else if (event.key === 'End') {
        this.callbacks.onSplitChange(1);
        event.preventDefault();
      }
    });
  }
}
