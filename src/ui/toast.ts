/** Short messages, mostly parse errors. They say what is wrong and where. */

import { el, prefersReducedMotion } from './dom';

export type ToastKind = 'info' | 'error';

let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (!host) {
    host = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

export function toast(title: string, body: string, kind: ToastKind = 'info'): void {
  const node = el(
    'div',
    { class: 'toast' + (kind === 'error' ? ' is-error' : '') },
    el('p', { class: 'toast-title', text: title }),
    el('p', { class: 'toast-body mono', text: body }),
  );
  const dismiss = el('button', {
    class: 'toast-close',
    type: 'button',
    'aria-label': 'Dismiss',
    text: 'x',
  });
  dismiss.addEventListener('click', () => node.remove());
  node.append(dismiss);
  ensureHost().append(node);

  const life = kind === 'error' ? 12000 : 5000;
  window.setTimeout(() => {
    if (!node.isConnected) return;
    if (prefersReducedMotion()) {
      node.remove();
      return;
    }
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 220);
  }, life);
}
