/**
 * The control panel. Deliberately quiet: the image is the thing you are
 * looking at, this is the thing you occasionally reach for.
 */

import { el, clear, num, pct, bytes } from './dom';
import type { AppState, LutEntry } from './state';
import type { RenderMode } from '../gl';
import { MAX_SLOTS } from '../gl';
import { PRESETS, defaultParams } from '../generate';
import type { GeneratorParams } from '../generate';
import type { CornerMove, Histogram, NeutralCurve } from '../analyze';
import { curveChartSvg, histogramSvg, cubeChartSvg } from './charts';

export interface PanelCallbacks {
  onModeChange: (mode: RenderMode) => void;
  onStrengthChange: (id: string, strength: number) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onAddPreset: (presetId: string) => void;
  onPickLut: () => void;
  onPickImage: () => void;
  onGeneratorChange: (params: GeneratorParams) => void;
  onGeneratorApply: () => void;
  onGeneratorDownload: () => void;
  onExport: (kind: 'png' | 'jpeg' | 'card') => void;
}

export interface AnalysisView {
  summary: string;
  curve: NeutralCurve;
  before: Histogram | null;
  after: Histogram | null;
  moves: CornerMove[];
  detail: Array<[string, string]>;
}

const MODES: Array<[RenderMode, string]> = [
  ['split', 'Split'],
  ['sidebyside', 'Side by side'],
  ['graded', 'Graded'],
];

interface SliderSpec {
  key: keyof GeneratorParams;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

const GENERATOR_SLIDERS: SliderSpec[] = [
  { key: 'lift', label: 'Lift', min: -0.3, max: 0.3, step: 0.005, format: (v) => num(v, 3) },
  { key: 'gamma', label: 'Gamma', min: 0.4, max: 2.5, step: 0.01, format: (v) => num(v, 2) },
  { key: 'gain', label: 'Gain', min: 0.4, max: 2, step: 0.01, format: (v) => num(v, 2) },
  { key: 'contrast', label: 'Contrast', min: 0.5, max: 2, step: 0.01, format: (v) => num(v, 2) },
  {
    key: 'temperature',
    label: 'Temperature',
    min: -1,
    max: 1,
    step: 0.01,
    format: (v) => (v > 0 ? '+' : '') + num(v, 2),
  },
  {
    key: 'tint',
    label: 'Tint',
    min: -1,
    max: 1,
    step: 0.01,
    format: (v) => (v > 0 ? '+' : '') + num(v, 2),
  },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, format: (v) => num(v, 2) },
];

export class Panel {
  readonly root: HTMLElement;
  private stackList: HTMLElement;
  private stackNote: HTMLElement;
  private modeButtons = new Map<RenderMode, HTMLButtonElement>();
  private sourceLine: HTMLElement;
  private summaryText: HTMLElement;
  private curveHost: HTMLElement;
  private histBeforeHost: HTMLElement;
  private histAfterHost: HTMLElement;
  private cubeHost: HTMLElement;
  private detailList: HTMLElement;
  private presetRow: HTMLElement;
  private generatorValues = new Map<string, HTMLElement>();
  private generatorInputs = new Map<string, HTMLInputElement>();
  private titleInput: HTMLInputElement;
  private sizeSelect: HTMLSelectElement;
  /** Which entries the stack list was last built for. */
  private stackSignature = '';

  params: GeneratorParams = defaultParams();

  constructor(private callbacks: PanelCallbacks) {
    this.sourceLine = el('p', { class: 'mono dim source-line', text: 'no image loaded' });
    this.stackList = el('ul', { class: 'stack' });
    this.stackNote = el('p', { class: 'dim small' });
    this.summaryText = el('p', { class: 'summary' });
    this.curveHost = el('div', { class: 'chart' });
    this.histBeforeHost = el('div', { class: 'chart' });
    this.histAfterHost = el('div', { class: 'chart' });
    this.cubeHost = el('div', { class: 'chart' });
    this.detailList = el('dl', { class: 'detail' });
    this.presetRow = el('div', { class: 'button-row' });
    this.titleInput = el('input', {
      type: 'text',
      class: 'mono text-input',
      value: 'lutbox custom',
      'aria-label': 'Title written into the generated .cube file',
    });
    this.sizeSelect = el('select', {
      class: 'mono select',
      'aria-label': 'Lattice points per axis',
    });

    this.root = el(
      'aside',
      { class: 'panel', id: 'panel' },
      this.buildSource(),
      this.buildView(),
      this.buildStack(),
      this.buildAnalysis(),
      this.buildGenerator(),
      this.buildExport(),
      this.buildFooter(),
    );
  }

  // -------------------------------------------------------------------------

  private section(title: string, ...children: Array<Node | string>): HTMLElement {
    return el(
      'section',
      { class: 'panel-section' },
      el('h2', { class: 'section-title', text: title }),
      ...children,
    );
  }

  private buildSource(): HTMLElement {
    const pick = el('button', { class: 'button', type: 'button', text: 'Choose image' });
    pick.addEventListener('click', () => this.callbacks.onPickImage());
    return this.section(
      'Image',
      this.sourceLine,
      el('div', { class: 'button-row' }, pick),
      el('p', {
        class: 'dim small',
        text:
          'Drop an image and one or more .cube files anywhere on this page. ' +
          'Nothing is uploaded. There is no server to upload to.',
      }),
    );
  }

  private buildView(): HTMLElement {
    const row = el('div', { class: 'button-row' });
    for (const [mode, label] of MODES) {
      const button = el('button', {
        class: 'button toggle',
        type: 'button',
        text: label,
        'aria-pressed': 'false',
      });
      button.addEventListener('click', () => this.callbacks.onModeChange(mode));
      this.modeButtons.set(mode, button);
      row.append(button);
    }
    return this.section(
      'View',
      row,
      el('p', {
        class: 'dim small',
        text:
          'Drag the handle to move the split. Hold the B key at any time to see ' +
          'the original, let go to return to the grade.',
      }),
    );
  }

  private buildStack(): HTMLElement {
    const add = el('button', { class: 'button', type: 'button', text: 'Add .cube' });
    add.addEventListener('click', () => this.callbacks.onPickLut());

    for (const preset of PRESETS) {
      const button = el('button', {
        class: 'button subtle',
        type: 'button',
        text: preset.label,
        title: preset.note,
      });
      button.addEventListener('click', () => this.callbacks.onAddPreset(preset.id));
      this.presetRow.append(button);
    }

    return this.section(
      'LUT stack',
      this.stackList,
      this.stackNote,
      el('div', { class: 'button-row' }, add),
      el('p', { class: 'dim small', text: 'Built in, generated by this page:' }),
      this.presetRow,
    );
  }

  private buildAnalysis(): HTMLElement {
    return this.section(
      'What it does',
      this.summaryText,
      el('h3', { class: 'chart-title', text: 'Neutral axis response' }),
      this.curveHost,
      el('p', {
        class: 'dim small',
        text:
          'The grey ramp pushed through the stack. Where the three lines ' +
          'separate the LUT is adding a cast at that brightness. The dashed ' +
          'diagonal is no change at all.',
      }),
      el('h3', { class: 'chart-title', text: 'Histogram' }),
      this.histBeforeHost,
      this.histAfterHost,
      el('h3', { class: 'chart-title', text: 'Cube corners' }),
      this.cubeHost,
      el('p', {
        class: 'dim small',
        text:
          'The eight corners of RGB space in isometric view. Each line runs ' +
          'from where a corner was to where the LUT puts it.',
      }),
      this.detailList,
    );
  }

  private buildGenerator(): HTMLElement {
    const rows: HTMLElement[] = [];

    for (const spec of GENERATOR_SLIDERS) {
      const value = el('span', {
        class: 'mono value',
        text: spec.format(this.params[spec.key] as number),
      });
      const input = el('input', {
        type: 'range',
        class: 'slider',
        min: String(spec.min),
        max: String(spec.max),
        step: String(spec.step),
        value: String(this.params[spec.key] as number),
        'aria-label': spec.label,
      });
      input.addEventListener('input', () => {
        const next = Number(input.value);
        (this.params as unknown as Record<string, number>)[spec.key as string] = next;
        value.textContent = spec.format(next);
        this.callbacks.onGeneratorChange(this.params);
      });
      this.generatorValues.set(spec.key as string, value);
      this.generatorInputs.set(spec.key as string, input);
      rows.push(
        el(
          'div',
          { class: 'control' },
          el('label', { class: 'control-label' }, spec.label, value),
          input,
        ),
      );
    }

    for (const size of [17, 33, 65]) {
      this.sizeSelect.append(
        el('option', { value: String(size), selected: size === 33 }, size + ' points'),
      );
    }
    this.sizeSelect.addEventListener('change', () => {
      this.params.size = Number(this.sizeSelect.value);
      this.callbacks.onGeneratorChange(this.params);
    });
    this.titleInput.addEventListener('input', () => {
      this.params.title = this.titleInput.value || 'lutbox custom';
      this.callbacks.onGeneratorChange(this.params);
    });

    const reset = el('button', { class: 'button subtle', type: 'button', text: 'Reset' });
    reset.addEventListener('click', () => {
      this.params = defaultParams();
      this.syncGenerator();
      this.callbacks.onGeneratorChange(this.params);
    });
    const apply = el('button', { class: 'button', type: 'button', text: 'Add to stack' });
    apply.addEventListener('click', () => this.callbacks.onGeneratorApply());
    const save = el('button', { class: 'button', type: 'button', text: 'Download .cube' });
    save.addEventListener('click', () => this.callbacks.onGeneratorDownload());

    return this.section(
      'Generate a LUT',
      ...rows,
      el(
        'div',
        { class: 'control' },
        el('label', { class: 'control-label' }, 'Title'),
        this.titleInput,
      ),
      el(
        'div',
        { class: 'control' },
        el('label', { class: 'control-label' }, 'Size'),
        this.sizeSelect,
      ),
      el('div', { class: 'button-row' }, apply, save, reset),
      el('p', {
        class: 'dim small',
        text:
          'The table is written out by evaluating the grade at every lattice ' +
          'point, in the order the .cube format expects, red varying fastest.',
      }),
    );
  }

  private buildExport(): HTMLElement {
    const png = el('button', { class: 'button', type: 'button', text: 'PNG' });
    const jpeg = el('button', { class: 'button', type: 'button', text: 'JPEG' });
    const card = el('button', { class: 'button', type: 'button', text: 'Analysis card' });
    png.addEventListener('click', () => this.callbacks.onExport('png'));
    jpeg.addEventListener('click', () => this.callbacks.onExport('jpeg'));
    card.addEventListener('click', () => this.callbacks.onExport('card'));
    return this.section(
      'Export',
      el('div', { class: 'button-row' }, png, jpeg, card),
      el('p', {
        class: 'dim small',
        text: 'Full resolution, graded, straight from the canvas to a file on your disk.',
      }),
    );
  }

  private buildFooter(): HTMLElement {
    return el(
      'section',
      { class: 'panel-section panel-footer' },
      el('p', {
        class: 'dim small',
        text:
          'The background is near black on purpose. Judging colour against ' +
          'white chrome shifts your perception of every tone in the frame, ' +
          'which is why grading suites are dark rooms.',
      }),
    );
  }

  // -------------------------------------------------------------------------

  syncGenerator(): void {
    for (const spec of GENERATOR_SLIDERS) {
      const input = this.generatorInputs.get(spec.key as string);
      const value = this.generatorValues.get(spec.key as string);
      const current = this.params[spec.key] as number;
      if (input) input.value = String(current);
      if (value) value.textContent = spec.format(current);
    }
    this.titleInput.value = this.params.title;
    this.sizeSelect.value = String(this.params.size);
  }

  update(state: AppState): void {
    if (state.image) {
      this.sourceLine.textContent =
        state.image.name +
        '  ' +
        state.image.width +
        ' x ' +
        state.image.height +
        (state.image.downscaled ? '  (reduced to fit the GPU)' : '');
    } else {
      this.sourceLine.textContent = 'no image loaded';
    }

    for (const [mode, button] of this.modeButtons) {
      const active = state.mode === mode;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.classList.toggle('is-active', active);
    }

    this.renderStack(state.entries);
  }

  private renderStack(entries: LutEntry[]): void {
    // Rebuilding this list throws away the slider the user may currently have
    // hold of, which would end the drag on the first input event. Only rebuild
    // when the set, the order or the on/off state has actually changed;
    // strength changes update their own readout in place.
    const signature = entries
      .map((entry) => entry.id + ':' + (entry.enabled ? '1' : '0'))
      .join('|');
    if (signature === this.stackSignature) return;
    this.stackSignature = signature;

    clear(this.stackList);
    if (entries.length === 0) {
      this.stackList.append(
        el('li', {
          class: 'stack-empty dim',
          text: 'No LUT loaded. Drop a .cube file, or pick one of the built in ones below.',
        }),
      );
    }

    entries.forEach((entry, index) => {
      const toggle = el('button', {
        class: 'icon-button' + (entry.enabled ? ' is-on' : ''),
        type: 'button',
        title: entry.enabled ? 'Disable this LUT' : 'Enable this LUT',
        'aria-pressed': entry.enabled ? 'true' : 'false',
        text: entry.enabled ? 'on' : 'off',
      });
      toggle.addEventListener('click', () => this.callbacks.onToggle(entry.id));

      const up = el('button', {
        class: 'icon-button',
        type: 'button',
        title: 'Move earlier in the stack',
        'aria-label': 'Move ' + entry.name + ' earlier',
        text: 'up',
        disabled: index === 0,
      });
      up.addEventListener('click', () => this.callbacks.onMove(entry.id, -1));

      const down = el('button', {
        class: 'icon-button',
        type: 'button',
        title: 'Move later in the stack',
        'aria-label': 'Move ' + entry.name + ' later',
        text: 'dn',
        disabled: index === entries.length - 1,
      });
      down.addEventListener('click', () => this.callbacks.onMove(entry.id, 1));

      const remove = el('button', {
        class: 'icon-button',
        type: 'button',
        title: 'Remove from the stack',
        'aria-label': 'Remove ' + entry.name,
        text: 'x',
      });
      remove.addEventListener('click', () => this.callbacks.onRemove(entry.id));

      const strengthValue = el('span', { class: 'mono value', text: pct(entry.strength) });
      const strength = el('input', {
        type: 'range',
        class: 'slider',
        min: '0',
        max: '100',
        step: '1',
        value: String(Math.round(entry.strength * 100)),
        'aria-label': 'Strength of ' + entry.name,
      });
      strength.addEventListener('input', () => {
        const value = Number(strength.value) / 100;
        strengthValue.textContent = pct(value);
        this.callbacks.onStrengthChange(entry.id, value);
      });

      const meta =
        entry.lut.type +
        ' ' +
        entry.lut.size +
        (entry.lut.type === '3D' ? '^3' : '') +
        (entry.bytes !== undefined ? '  ' + bytes(entry.bytes) : '');

      this.stackList.append(
        el(
          'li',
          { class: 'stack-item' + (entry.enabled ? '' : ' is-off') },
          el(
            'div',
            { class: 'stack-head' },
            el('span', { class: 'stack-index mono', text: String(index + 1) }),
            el(
              'div',
              { class: 'stack-name' },
              el('span', { class: 'mono name', text: entry.name }),
              el('span', { class: 'mono dim meta', text: meta }),
            ),
            el('div', { class: 'stack-actions' }, toggle, up, down, remove),
          ),
          el('div', { class: 'stack-strength' }, strength, strengthValue),
        ),
      );
    });

    const count = entries.length;
    this.stackNote.textContent =
      count === 0
        ? ''
        : count +
          ' of ' +
          MAX_SLOTS +
          ' slots used. They are applied top to bottom, each one on the output of the last.';
  }

  setAnalysis(view: AnalysisView): void {
    this.summaryText.textContent = view.summary;
    this.curveHost.innerHTML = curveChartSvg(view.curve, { width: 300, height: 240 });
    this.histBeforeHost.innerHTML = view.before
      ? histogramSvg(view.before, { width: 300, height: 84, label: 'before' })
      : '';
    this.histAfterHost.innerHTML = view.after
      ? histogramSvg(view.after, { width: 300, height: 84, label: 'after' })
      : '';
    this.cubeHost.innerHTML = cubeChartSvg(view.moves, { width: 300, height: 190 });

    clear(this.detailList);
    for (const [key, value] of view.detail) {
      this.detailList.append(
        el('dt', { class: 'dim', text: key }),
        el('dd', { class: 'mono', text: value }),
      );
    }
  }

  setStackFull(full: boolean): void {
    for (const button of this.presetRow.querySelectorAll('button')) {
      button.toggleAttribute('disabled', full);
    }
  }
}
