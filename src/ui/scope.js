// Live "oscilloscope": the last 3 seconds of microphone energy in dB, with the noise
// floor (cyan), the trigger threshold (amber) and a tick for every detected tap.
// It draws exactly what the onset detector sees, so you can watch it decide.

const DB_TOP = 0;
const DB_BOTTOM = -90;
const SPAN_S = 3;

export class Scope {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.engine = engine;
    this.running = false;
    this.css = getComputedStyle(document.documentElement);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  color(name) {
    return this.css.getPropertyValue(name).trim();
  }

  draw() {
    const { canvas, g } = this;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(canvas.clientWidth * dpr);
    const H = Math.round(canvas.clientHeight * dpr);
    if (!W || !H) return;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const y = (db) => Math.round(((DB_TOP - Math.max(DB_BOTTOM, Math.min(DB_TOP, db))) / (DB_TOP - DB_BOTTOM)) * (H - 1));
    g.fillStyle = this.color('--scope-bg');
    g.fillRect(0, 0, W, H);

    // Grid: every 20 dB and every 0.5 s.
    g.strokeStyle = this.color('--grid');
    g.lineWidth = 1;
    g.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
    g.fillStyle = this.color('--muted');
    for (let db = -20; db > DB_BOTTOM; db -= 20) {
      g.beginPath();
      g.moveTo(0, y(db) + 0.5);
      g.lineTo(W, y(db) + 0.5);
      g.stroke();
      g.fillText(`${db}`, 4 * dpr, y(db) - 3 * dpr);
    }
    for (let s = 0.5; s < SPAN_S; s += 0.5) {
      const x = Math.round((s / SPAN_S) * W) + 0.5;
      g.beginPath();
      g.moveTo(x, H - 6 * dpr);
      g.lineTo(x, H);
      g.stroke();
    }

    const det = this.engine.detector;
    if (!det) return;
    const span = Math.round((SPAN_S * this.engine.sr) / det.hop);
    const end = det.hopIndex;
    const start = end - span;

    // Energy trace, drawn as a filled area (max dB per pixel column).
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x < W; x++) {
      const h0 = start + Math.floor((x * span) / W);
      const h1 = Math.max(h0 + 1, start + Math.floor(((x + 1) * span) / W));
      let m = -120;
      for (let h = h0; h < h1; h++) m = Math.max(m, det.dbAt(h));
      g.lineTo(x, y(m));
    }
    g.lineTo(W, H);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, this.color('--signal'));
    grad.addColorStop(1, 'rgba(61,255,168,0.08)');
    g.fillStyle = grad;
    g.fill();

    // Noise floor and trigger threshold.
    g.setLineDash([4 * dpr, 4 * dpr]);
    g.strokeStyle = this.color('--cyan');
    g.beginPath();
    g.moveTo(0, y(det.floorDb));
    g.lineTo(W, y(det.floorDb));
    g.stroke();
    g.strokeStyle = this.color('--amber');
    g.beginPath();
    g.moveTo(0, y(det.thresholdDb));
    g.lineTo(W, y(det.thresholdDb));
    g.stroke();
    g.setLineDash([]);

    // Tap markers.
    for (const m of this.engine.onsets) {
      if (m.hop < start || m.hop >= end) continue;
      const x = Math.round(((m.hop - start) / span) * W) + 0.5;
      g.strokeStyle = m.ok === true ? this.color('--signal') : m.ok === false ? this.color('--red') : this.color('--cyan');
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
      if (m.label) {
        g.fillStyle = this.color('--text');
        g.fillText(m.label, Math.min(x + 4 * dpr, W - 70 * dpr), 12 * dpr);
      }
    }
    g.lineWidth = 1;
  }
}
