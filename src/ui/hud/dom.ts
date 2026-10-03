/** Tiny DOM helpers for the HUD (no framework). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export function clear(e: HTMLElement) {
  while (e.firstChild) e.removeChild(e.firstChild);
}

/** press handler that works for mouse and touch without double firing; supports long-press */
export function onPress(e: HTMLElement, fn: (ev: PointerEvent) => void, opts: { long?: (ev: PointerEvent) => void; sound?: () => void } = {}) {
  let timer = 0;
  let longFired = false;
  let down = false;
  e.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    down = true;
    longFired = false;
    e.classList.add('down');
    if (opts.long) {
      timer = window.setTimeout(() => {
        longFired = true;
        opts.long!(ev);
      }, 450);
    }
  });
  const end = (ev: PointerEvent, fire: boolean) => {
    if (!down) return;
    down = false;
    e.classList.remove('down');
    clearTimeout(timer);
    if (fire && !longFired) {
      opts.sound?.();
      fn(ev);
    }
  };
  e.addEventListener('pointerup', (ev) => {
    ev.stopPropagation();
    end(ev, true);
  });
  e.addEventListener('pointerleave', (ev) => end(ev, false));
  e.addEventListener('pointercancel', (ev) => end(ev, false));
  e.addEventListener('contextmenu', (ev) => ev.preventDefault());
}

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

export function fmt(n: number) {
  n = Math.floor(n);
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
