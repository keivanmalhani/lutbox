/** Very small DOM helpers. No framework, no virtual anything. */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function query<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error('Missing element: ' + selector);
  return found;
}

/** Escape text destined for an SVG or HTML string. */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a number for display in the monospace columns. */
export function num(value: number, places = 3): string {
  return value.toFixed(places);
}

export function pct(value: number): string {
  return Math.round(value * 100) + '%';
}

/** Human readable byte count, for file names in the LUT list. */
export function bytes(count: number): string {
  if (count < 1024) return count + ' B';
  if (count < 1024 * 1024) return (count / 1024).toFixed(1) + ' kB';
  return (count / (1024 * 1024)).toFixed(1) + ' MB';
}

/** Trigger a download of a blob without touching the network. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
