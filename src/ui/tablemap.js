// Top-down map of the table: the phone in the middle, pads around it. Every detected
// tap fires a ripple at the pad Hum thinks you hit (or at the phone if it's not sure).

import { ZONES } from '../pads.js';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 300;

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export class TableMap {
  constructor(container) {
    this.container = container;
    this.pos = new Map();
  }

  setPads(pads) {
    this.pads = pads;
    const svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'img', 'aria-label': 'Table map: phone in the centre, pads around it' });
    svg.append(el('rect', { x: 4, y: 4, width: SIZE - 8, height: SIZE - 8, rx: 14, class: 'tm-table' }));
    for (let i = 1; i < 6; i++) {
      svg.append(el('line', { x1: (i * SIZE) / 6, y1: 4, x2: (i * SIZE) / 6, y2: SIZE - 4, class: 'tm-grid' }));
      svg.append(el('line', { x1: 4, y1: (i * SIZE) / 6, x2: SIZE - 4, y2: (i * SIZE) / 6, class: 'tm-grid' }));
    }
    svg.append(el('rect', { x: SIZE / 2 - 22, y: SIZE / 2 - 42, width: 44, height: 84, rx: 7, class: 'tm-phone' }));
    svg.append(el('circle', { cx: SIZE / 2, cy: SIZE / 2 + 34, r: 2.5, class: 'tm-mic' }));
    svg.append(el('text', { x: 14, y: SIZE - 12, class: 'tm-you' }, '▼ YOU'));

    // Spread pads that share a zone side by side.
    const byZone = {};
    pads.forEach((p) => (byZone[p.zone] ||= []).push(p));
    this.pos.clear();
    this.padEls = new Map();
    for (const [zone, list] of Object.entries(byZone)) {
      const z = ZONES[zone];
      const vertical = zone === 'left' || zone === 'right';
      list.forEach((p, i) => {
        const off = (i - (list.length - 1) / 2) * 58;
        const cx = z.x * SIZE + (vertical ? 0 : off);
        const cy = z.y * SIZE + (vertical ? off : 0);
        this.pos.set(p.id, { cx, cy });
        const g = el('g', { class: 'tm-pad', 'data-id': p.id });
        g.append(el('circle', { cx, cy, r: 26, class: 'tm-pad-ring' }));
        g.append(el('text', { x: cx, y: cy + 4, class: 'tm-pad-type' }, p.label.split(' · ')[1]));
        g.append(el('text', { x: cx, y: cy + 40, class: 'tm-pad-count' }, ''));
        svg.append(g);
        this.padEls.set(p.id, g);
      });
    }
    this.layer = el('g');
    svg.append(this.layer);
    this.container.replaceChildren(svg);
    this.svg = svg;
  }

  /** Outline the pad the user should tap next (or none). */
  highlight(padId) {
    for (const [id, g] of this.padEls) g.classList.toggle('target', id === padId);
  }

  setCount(padId, text) {
    const g = this.padEls.get(padId);
    if (g) g.querySelector('.tm-pad-count').textContent = text;
  }

  /** kind: 'train' | 'ok' | 'bad' | 'unsure' */
  ripple(padId, kind = 'ok') {
    if (!this.svg) return;
    const p = (padId && this.pos.get(padId)) || { cx: SIZE / 2, cy: SIZE / 2 };
    for (const delay of [0, 120]) {
      const c = el('circle', { cx: p.cx, cy: p.cy, r: 24, class: `tm-ripple ${kind}` });
      c.style.animationDelay = `${delay}ms`;
      c.addEventListener('animationend', () => c.remove());
      setTimeout(() => c.remove(), 1500); // also when animations don't run (hidden tab)
      this.layer.append(c);
    }
    const g = padId && this.padEls.get(padId);
    if (g) {
      g.classList.remove('hit');
      void g.getBoundingClientRect(); // restart the CSS animation
      g.classList.add('hit');
    }
  }
}
