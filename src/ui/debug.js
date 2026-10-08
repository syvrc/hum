// Debug panel (long-press the Hum logo). Shows what the pipeline is really doing on
// this phone, lets us tune thresholds live, and produces a report to paste to Claude.

import { logLines, onLog } from './log.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '–');

const SLIDERS = [
  { group: 'detector', key: 'kFloorDb', label: 'Tap must be this far above the floor (dB)', min: 4, max: 30, step: 1 },
  { group: 'detector', key: 'kRiseDb', label: 'Sudden rise needed (dB)', min: 2, max: 20, step: 1 },
  { group: 'detector', key: 'absMinDb', label: 'Absolute minimum level (dBFS)', min: -90, max: -30, step: 1 },
  { group: 'detector', key: 'refractoryMs', label: 'Refractory after a tap (ms)', min: 50, max: 300, step: 10 },
  { group: 'classifier', key: 'k', label: 'k (neighbours that vote)', min: 1, max: 7, step: 2 },
  { group: 'classifier', key: 'minConfidence', label: '"Not sure" below confidence', min: 0, max: 0.9, step: 0.05 },
  { group: 'classifier', key: 'maxDistRatio', label: '"Not sure" above distance ratio', min: 1.5, max: 15, step: 0.5 },
];

export class DebugPanel {
  /**
   * @param {HTMLElement} root
   * @param {object} app  { engine, motion, state }
   * @param {object} actions { copyReport, sendToLaptop?, downloadDataset, setSetting, resetSettings }
   */
  constructor(root, app, actions) {
    this.root = root;
    this.app = app;
    this.actions = actions;
    onLog((line) => {
      if (this.root.hidden || !this.logEl) return;
      this.logEl.textContent += `\n${line}`;
      this.logEl.scrollTop = this.logEl.scrollHeight;
    });
  }

  open() {
    this.root.hidden = false;
    this.render();
    this.timer = setInterval(() => this.updateLive(), 250);
  }

  close() {
    this.root.hidden = true;
    clearInterval(this.timer);
  }

  render() {
    const { engine } = this.app;
    const values = { ...engine.detector?.opts, ...this.app.settings };
    const sliders = SLIDERS.map(
      (s) => `<label class="dbg-slider"><span>${esc(s.label)} <b data-val="${s.key}">${values[s.key]}</b></span>
        <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${values[s.key]}" data-group="${s.group}" data-key="${s.key}"></label>`,
    ).join('');
    this.root.innerHTML = `
      <div class="dbg-head"><h2>Debug</h2><button class="btn" data-act="close">Close</button></div>
      <div class="dbg-actions">
        <button class="btn primary" data-act="copy">Copy debug report</button>
        ${this.actions.sendToLaptop ? '<button class="btn" data-act="send">Send dataset to laptop</button>' : ''}
        <button class="btn" data-act="download">Download dataset</button>
      </div>
      <h3>Live</h3><pre class="dbg-live" id="dbgLive"></pre>
      <h3>Last tap</h3><pre class="dbg-live" id="dbgTap"></pre>
      <h3>Tuning</h3>${sliders}
      <button class="btn small" data-act="reset">Reset tuning to defaults</button>
      <h3>Microphone settings (getSettings)</h3><pre class="dbg-pre">${esc(JSON.stringify(engine.trackSettings || {}, null, 1))}</pre>
      <h3>Log</h3><pre class="dbg-log" id="dbgLog">${esc(logLines().join('\n'))}</pre>`;
    this.logEl = this.root.querySelector('#dbgLog');
    this.logEl.scrollTop = this.logEl.scrollHeight;
    this.root.querySelectorAll('input[type=range]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        this.root.querySelector(`[data-val="${inp.dataset.key}"]`).textContent = v;
        this.actions.setSetting(inp.dataset.group, inp.dataset.key, v);
      }),
    );
    this.root.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'close') this.close();
        if (act === 'copy') this.actions.copyReport();
        if (act === 'send') this.actions.sendToLaptop();
        if (act === 'download') this.actions.downloadDataset();
        if (act === 'reset') {
          this.actions.resetSettings();
          this.render();
        }
      }),
    );
    this.updateLive();
  }

  updateLive() {
    const { engine, motion, profile, model } = this.app;
    const det = engine.detector;
    const live = this.root.querySelector('#dbgLive');
    if (live) {
      live.textContent = [
        `rate ${engine.sr || '–'} Hz · channels ${engine.channels ?? '–'} · ctx ${engine.ctx?.state || '–'} · chunks ${engine.chunkCount}`,
        `level ${fmt(det?.lastDb)} dB · floor ${fmt(det?.floorDb)} dB · threshold ${fmt(det?.thresholdDb)} dB`,
        `mic latency (reported) ${fmt(engine.inputLatencyMs)} ms · base ${fmt((engine.ctx?.baseLatency || 0) * 1000)} ms · motion ${motion.available ? 'yes' : 'no'}`,
        `table ${profile ? `"${profile.name}" · ${profile.samples.length} example taps` : 'none'} · model ${model ? 'ready' : 'none'}`,
      ].join('\n');
    }
    const tapEl = this.root.querySelector('#dbgTap');
    const t = this.app.lastTap;
    if (tapEl) {
      tapEl.textContent = t
        ? [
            `${t.screen}: ${t.pred ? `${t.pred} [${t.status}] conf ${fmt(t.confidence, 2)} ratio ${fmt(t.distRatio, 2)}` : `recorded as ${t.padId}`}`,
            `latency ${fmt(t.latencyMs, 0)} ms (onset → on screen)`,
            `peak ${fmt(t.info.peakDb)} dBFS${t.info.clipped ? ` (CLIPPED ×${t.info.clipped})` : ''} · centroid ${fmt(t.info.centroidHz, 0)} Hz · attack ${fmt(t.info.attackMs, 2)} ms · decay ${fmt(t.info.decaySlope, 2)} dB/ms`,
            `stereo ${t.info.stereoReal ? `REAL (delay ${fmt(t.info.delayMs, 3)} ms)` : `no (${t.info.channels} ch)`} · accel ${t.accel ? t.accel.map((v) => fmt(v, 2)).join(',') : 'none'}`,
          ].join('\n')
        : 'no taps yet';
    }
  }
}
