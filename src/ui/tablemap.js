// Top-down view of the table with the phone in the middle. Hum doesn't know WHERE a
// knock landed (it listens for tap type × count), so every knock ripples out from the
// phone — coloured by the type Hum heard — and a live counter shows the pattern so far.

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2 - 14;

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export class TableMap {
  constructor(container) {
    this.container = container;
    this.legend = new Map();
  }

  /** pads = the sound classes (tap types). */
  setPads(pads) {
    const svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'img', 'aria-label': 'Table view: the phone in the middle; each knock ripples out from it' });
    svg.append(el('rect', { x: 4, y: 4, width: SIZE - 8, height: SIZE - 8, rx: 14, class: 'tm-table' }));
    for (let i = 1; i < 6; i++) {
      svg.append(el('line', { x1: (i * SIZE) / 6, y1: 4, x2: (i * SIZE) / 6, y2: SIZE - 4, class: 'tm-grid' }));
      svg.append(el('line', { x1: 4, y1: (i * SIZE) / 6, x2: SIZE - 4, y2: (i * SIZE) / 6, class: 'tm-grid' }));
    }
    svg.append(el('circle', { cx: CX, cy: CY, r: 104, class: 'tm-zone' }));
    svg.append(el('text', { x: CX, y: CY - 110, class: 'tm-you' }, 'KNOCK ANYWHERE'));
    svg.append(el('rect', { x: CX - 22, y: CY - 42, width: 44, height: 84, rx: 7, class: 'tm-phone' }));
    svg.append(el('circle', { cx: CX, cy: CY + 34, r: 2.5, class: 'tm-mic' }));
    this.countEl = el('text', { x: CX, y: CY + 6, class: 'tm-count' }, '');
    this.layer = el('g');
    svg.append(this.layer, this.countEl);

    // Legend along the bottom: one entry per tap type, with a training counter.
    this.legend.clear();
    const w = (SIZE - 24) / Math.max(1, pads.length);
    pads.forEach((p, i) => {
      const x = 12 + w * i + w / 2;
      const g = el('g', { class: 'tm-pad', 'data-id': p.id });
      g.append(el('rect', { x: x - w / 2 + 4, y: SIZE - 48, width: w - 8, height: 36, rx: 8, class: 'tm-pad-ring' }));
      g.append(el('text', { x, y: SIZE - 26, class: 'tm-pad-type' }, `${p.icon || ''} ${p.label}`));
      g.append(el('text', { x, y: SIZE - 15, class: 'tm-pad-count' }, ''));
      svg.append(g);
      this.legend.set(p.id, g);
    });
    this.container.replaceChildren(svg);
    this.svg = svg;
  }

  /** Outline the tap type the user should knock next (or none). */
  highlight(padId) {
    for (const [id, g] of this.legend) g.classList.toggle('target', id === padId);
  }

  setCount(padId, text) {
    const g = this.legend.get(padId);
    if (g) g.querySelector('.tm-pad-count').textContent = text;
  }

  /** Big live text in the middle of the phone, e.g. "✋ ×2". */
  showPattern(text) {
    if (!this.countEl) return;
    this.countEl.textContent = text;
    clearTimeout(this.patternTimer);
    if (text) this.patternTimer = setTimeout(() => (this.countEl.textContent = ''), 1600);
  }

  /** kind: 'train' | 'ok' | 'bad' | 'unsure'; padId = tap type heard (palm → wide, soft ripple). */
  ripple(padId, kind = 'ok') {
    if (!this.layer) return;
    const soft = padId === 'palm';
    for (const delay of soft ? [0, 160] : [0, 70, 140]) {
      const c = el('circle', { cx: CX, cy: CY, r: 46, class: `tm-ripple ${kind} ${soft ? 'soft' : 'sharp'}` });
      c.style.animationDelay = `${delay}ms`;
      c.addEventListener('animationend', () => c.remove());
      setTimeout(() => c.remove(), 1500); // also when animations don't run (hidden tab)
      this.layer.append(c);
    }
    const g = padId && this.legend.get(padId);
    if (g) {
      g.classList.remove('hit');
      void g.getBoundingClientRect(); // restart the CSS animation
      g.classList.add('hit');
    }
  }
}
