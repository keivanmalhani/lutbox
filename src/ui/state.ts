/** Application state and a minimal subscription mechanism. */

import type { CubeLut } from '../cube';
import type { Slot } from '../analyze';
import type { RenderMode } from '../gl';

export type LutSource = 'preset' | 'file' | 'generated';

export interface LutEntry {
  id: string;
  /** File name, preset label, or generator title. */
  name: string;
  lut: CubeLut;
  /** 0 to 1. */
  strength: number;
  enabled: boolean;
  source: LutSource;
  /** Size on disk when it came from a file. */
  bytes?: number;
}

export interface ImageSource {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  name: string;
  /** True when the file was larger than the GPU allows and had to be reduced. */
  downscaled: boolean;
}

export interface AppState {
  image: ImageSource | null;
  entries: LutEntry[];
  mode: RenderMode;
  /** Split handle position, 0 to 1. */
  split: number;
  /** True while the A/B key is held down. */
  flipped: boolean;
}

type Listener = (state: AppState) => void;

let nextId = 1;

export function makeId(prefix: string): string {
  return prefix + '-' + nextId++;
}

export class Store {
  private listeners: Listener[] = [];
  state: AppState = {
    image: null,
    entries: [],
    mode: 'split',
    split: 0.5,
    flipped: false,
  };

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** Apply a change and tell everyone. */
  update(change: (state: AppState) => void): void {
    change(this.state);
    for (const listener of this.listeners) listener(this.state);
  }

  /** The stack as the analysis and shader code wants it. */
  slots(): Slot[] {
    return this.state.entries
      .filter((entry) => entry.enabled)
      .map((entry) => ({ lut: entry.lut, strength: entry.strength, enabled: true }));
  }

  /** What the renderer should draw right now, honouring the held flip key. */
  effectiveMode(): RenderMode {
    if (this.state.flipped) return 'original';
    return this.state.mode;
  }
}
