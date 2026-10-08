// Setup wizard — "Teach Hum your table" (brief §3.1). Target: under 60 seconds.
//   1 PLACE   lay the phone down, choose pads
//   2 QUIET   3 s of silence → noise floor
//   3 PADS    8 taps per pad
//   4 IGNORE  optional 5 s of everyday sounds → the "not a command" class
//   5 CHECK   leave-one-out self-check, confusion matrix, advice with one-tap fixes
//   → SAVE    name the table; it becomes the active profile
// Nothing is saved until the last step, so cancelling never damages an existing table.

import { app, go, saveProfile, retrain } from '../app.js';
import { PRESETS, ZONES, TAP_TYPES, makePad } from '../pads.js';
import { NONE, TRAIN_PER_PAD, MAX_PADS, MAX_NONE, newProfile, countFor, selfCheck, changePad, removePad, noneLabel, assignDefaultPhrases } from '../profile.js';
import { confusionHtml } from '../ui/confusion.js';
import { $, $$, esc, pct, toast } from '../ui/dom.js';
import { setActiveId } from '../store.js';
import { log } from '../ui/log.js';

const QUIET_MS = 3000;
const IGNORE_MS = 5000;
const SETTLE_MS = 600; // let the sound of pressing the button die away before measuring
const STEP_NAMES = { place: '1/5 · PLACE', quiet: '2/5 · QUIET', pad: '3/5 · PADS', ignore: '4/5 · IGNORE', check: '5/5 · CHECK', save: 'SAVE' };

export const wizard = {
  instrument: true,

  mount(el, { mode = 'new' } = {}) {
    this.el = el;
    this.saved = false;
    this.timers = [];
    if (mode === 'retrain' && app.profile) {
      // Independent copy: the saved table stays untouched until "Save".
      const p = app.profile;
      this.draft = { ...p, pads: p.pads.map((x) => ({ ...x })), samples: [], check: null, lastTest: null };
    } else {
      this.draft = newProfile('', PRESETS[0].pads);
    }
    this.mode = mode;
    this.presetId = PRESETS.find((pr) => pr.pads.join() === this.draft.pads.map((x) => x.id).join())?.id || 'custom';
    this.target = TRAIN_PER_PAD;
    this.queue = [];
    this.ignoreVisited = false;
    this.setupStart = null;
    this.setupSeconds = null;
    this.step = 'place';
    app.map.setPads(this.draft.pads);
    this.render();
  },

  unmount() {
    this.timers.forEach((t) => clearTimeout(t));
    clearInterval(this.countdown);
    app.map.highlight(null);
  },

  canLeave() {
    return this.saved || this.step === 'place' || confirm('Leave setup? This table will not be saved.');
  },

  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  },

  goStep(step) {
    this.step = step;
    if (step === 'check') this.runCheck();
    this.render();
  },

  // ------------------------------------------------------------------ render ----

  render() {
    const body = { place: this.placeHtml, quiet: this.quietHtml, pad: this.padHtml, ignore: this.ignoreHtml, check: this.checkHtml, save: this.saveHtml }[this.step].call(this);
    this.el.innerHTML = `
      <div class="wiz-head"><span class="eyebrow">SET UP ${this.mode === 'retrain' ? `“${esc(this.draft.name)}” ` : ''}· ${STEP_NAMES[this.step]}</span>
        <button class="btn small" data-act="cancel">Cancel</button></div>
      ${body}`;
    for (const p of this.draft.pads) app.map.setCount(p.id, `${countFor(this.draft, p.id)}/${this.target}`);
    app.map.highlight(this.step === 'pad' ? this.queue[0] : null);
    $$('[data-act]', this.el).forEach((b) => b.addEventListener('click', () => this.act(b.dataset.act, b.dataset)));
  },

  placeHtml() {
    const presets = [...PRESETS, { id: 'custom', name: 'Custom', note: 'Pick 2–8 pads: where × how you tap' }];
    const note = presets.find((p) => p.id === this.presetId).note;
    return `
      <h2>Place the phone</h2>
      <p>Lay it <b>flat and face-up</b> on a hard table, at least a hand-width from the edges. Two strips of tape at its corners let you put it back in exactly the same spot.</p>
      <h3>Choose your pads</h3>
      <div class="chips">${presets.map((p) => `<button class="chip ${this.presetId === p.id ? 'active' : ''}" data-act="preset" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>
      <p class="muted small">${esc(note)}</p>
      ${this.presetId === 'custom' ? this.gridHtml() : ''}
      <p class="mono small">${this.draft.pads.length} pads: ${this.draft.pads.map((p) => esc(p.short)).join(' · ')}</p>
      <button class="btn primary big" data-act="toQuiet" ${this.draft.pads.length >= 2 ? '' : 'disabled'}>Next: 3 seconds of quiet →</button>`;
  },

  gridHtml() {
    const zones = Object.keys(ZONES);
    const head = zones.map((z) => `<th scope="col">${ZONES[z].label}</th>`).join('');
    const rows = Object.keys(TAP_TYPES)
      .map((t) => {
        const cells = zones
          .map((z) => {
            const on = this.draft.pads.some((p) => p.id === `${z}:${t}`);
            return `<td><button class="cell ${on ? 'on' : ''}" data-act="cell" data-id="${z}:${t}" aria-pressed="${on}" aria-label="${ZONES[z].label} ${TAP_TYPES[t].label}">${on ? '✓' : ''}</button></td>`;
          })
          .join('');
        return `<tr><th scope="row">${TAP_TYPES[t].label}</th>${cells}</tr>`;
      })
      .join('');
    return `<div class="cm-wrap"><table class="padgrid"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  },

  quietHtml() {
    const q = this.quiet || {};
    if (q.running) {
      return `<h2>Shh… measuring the room</h2><div class="countdown mono" id="count">${q.left ?? ''}</div><p>Hands off the table, please.</p>`;
    }
    if (q.result) {
      const r = q.result;
      return `
        <h2>${r.disturbed ? 'I heard a knock' : 'Room measured'}</h2>
        <p class="mono">noise floor ${r.floorDb.toFixed(0)} dB · <span class="${r.level}">${esc(r.verdict)}</span></p>
        ${r.disturbed ? '<p>Keep your hands off the table and measure again.</p>' : ''}
        <div class="row">
          <button class="btn" data-act="quietStart">Measure again</button>
          ${r.disturbed ? '' : '<button class="btn primary" data-act="toPads">Next: teach the pads →</button>'}
        </div>`;
    }
    return `
      <h2>3 seconds of quiet</h2>
      <p>Hum measures how loud the room is when nobody taps, so it can tell a knock from the background.</p>
      <button class="btn primary big" data-act="quietStart">Start</button>`;
  },

  padHtml() {
    const pad = this.draft.pads.find((p) => p.id === this.queue[0]);
    const n = countFor(this.draft, pad.id);
    const idx = this.draft.pads.indexOf(pad);
    const dots = Array.from({ length: this.target }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    return `
      <div class="card prompt" aria-live="polite">
        <div class="eyebrow">PAD ${idx + 1} OF ${this.draft.pads.length} · TAP ${Math.min(n + 1, this.target)} OF ${this.target}</div>
        <div class="big">${esc(pad.label)}</div>
        <div class="sub">${esc(pad.how)}, ${esc(pad.where)}.</div>
        <div class="dots">${dots}</div>
      </div>
      <p class="muted small">Tap about once a second, the way you naturally would. Screen touches are ignored.</p>
      <div class="row">
        <button class="btn" data-act="undo" ${n ? '' : 'disabled'}>Undo last tap</button>
        <button class="btn" data-act="restartPad" ${n ? '' : 'disabled'}>Start this pad over</button>
      </div>`;
  },

  ignoreHtml() {
    const g = this.ignore || {};
    if (g.running) {
      return `<h2>Make everyday noise</h2><div class="countdown mono" id="count">${g.left}</div><p class="mono" id="heard">heard ${g.count} sounds</p>`;
    }
    return `
      <h2>Teach Hum what to ignore</h2>
      <p>Optional, 5 seconds. Talk, clap, cough, put a cup down — sounds that should <b>not</b> press a button. Hum learns them as “not a command”.</p>
      <button class="btn primary big" data-act="ignoreStart">Record 5 seconds</button>
      <button class="btn big" data-act="ignoreSkip">Skip</button>`;
  },

  checkHtml() {
    const c = this.check;
    const named = [...this.draft.pads, noneLabel];
    const bars = this.draft.pads
      .map((p) => {
        const s = c.separability[p.id];
        const cls = s === null ? '' : s >= 0.25 ? 'ok' : s >= 0.1 ? 'warn' : 'bad';
        const w = s === null ? 0 : Math.max(4, Math.min(100, s * 100));
        return `<li><span class="mono">${esc(p.short)}</span><span class="bar ${cls}"><i style="width:${w}%"></i></span><span class="mono small">${s === null ? '–' : s.toFixed(2)}</span></li>`;
      })
      .join('');
    const advice = c.advice.length
      ? c.advice
          .map(
            (a, i) => `<div class="card warn-card"><p>⚠ ${esc(a.text)}</p><div class="row">${a.fixes
              .map((f, j) => `<button class="btn small" data-act="fix" data-i="${i}" data-j="${j}">${esc(f.label)}</button>`)
              .join('')}</div></div>`,
          )
          .join('')
      : '<p class="ok">✓ No pads are getting mixed up.</p>';
    return `
      <div class="metric"><span class="num">${pct(c.padAccuracy)}</span><span class="muted">of ${c.padTotal} pad taps recognised when held out (leave-one-out)</span></div>
      <p class="mono small">${c.noneTotal ? `${c.falseTriggers} of ${c.noneTotal} ignore sounds would have pressed a pad` : 'no ignore sounds recorded'}${this.setupSeconds ? ` · setup took ${this.setupSeconds} s` : ''}</p>
      ${confusionHtml(c.loo, named)}
      <h3>How distinct each pad sounds</h3>
      <ul class="sep">${bars}</ul>
      <p class="muted small">1.00 = clearly its own sound · 0 = sounds as much like another pad as like itself.</p>
      ${advice}
      <button class="btn primary big" data-act="toSave">Save this table →</button>
      <div class="row">
        <button class="btn" data-act="more" ${this.target >= 16 ? 'disabled' : ''}>Add 4 more taps per pad</button>
        <button class="btn" data-act="redoIgnore">${countFor(this.draft, NONE) ? 'Redo' : 'Record'} ignore sounds</button>
      </div>`;
  },

  saveHtml() {
    const name = this.draft.name || 'Dining table';
    return `
      <h2>Name this table</h2>
      <label class="field-block"><span class="eyebrow">TABLE NAME</span>
        <input id="tableName" class="text" maxlength="40" value="${esc(name)}" autocomplete="off"></label>
      <div class="chips">${['Dining table', 'Desk', 'Bedside table', 'Kitchen counter'].map((n) => `<button class="chip" data-act="name" data-id="${n}">${n}</button>`).join('')}</div>
      <button class="btn primary big" data-act="save">Save &amp; finish</button>`;
  },

  // ------------------------------------------------------------------ actions ---

  act(action, data) {
    const d = this.draft;
    switch (action) {
      case 'cancel':
        go('home');
        break;
      case 'preset':
        this.presetId = data.id;
        if (data.id !== 'custom') d.pads = PRESETS.find((p) => p.id === data.id).pads.map(makePad);
        app.map.setPads(d.pads);
        this.render();
        break;
      case 'cell': {
        const has = d.pads.some((p) => p.id === data.id);
        if (has) d.pads = d.pads.filter((p) => p.id !== data.id);
        else if (d.pads.length >= MAX_PADS) return toast(`Up to ${MAX_PADS} pads.`);
        else d.pads.push(makePad(data.id));
        app.map.setPads(d.pads);
        this.render();
        break;
      }
      case 'toQuiet':
        this.setupStart = Date.now();
        this.quiet = null;
        this.goStep('quiet');
        break;
      case 'quietStart':
        this.startQuiet();
        break;
      case 'toPads':
        this.queue = d.pads.map((p) => p.id).filter((id) => countFor(d, id) < this.target);
        this.goStep(this.queue.length ? 'pad' : 'check');
        break;
      case 'undo': {
        const id = this.queue[0];
        const i = d.samples.findLastIndex((s) => s.padId === id);
        if (i >= 0) d.samples.splice(i, 1);
        this.render();
        break;
      }
      case 'restartPad':
        d.samples = d.samples.filter((s) => s.padId !== this.queue[0]);
        this.render();
        break;
      case 'ignoreStart':
        this.startIgnore();
        break;
      case 'ignoreSkip':
        this.ignoreVisited = true;
        this.goStep('check');
        break;
      case 'redoIgnore':
        d.samples = d.samples.filter((s) => s.padId !== NONE);
        this.ignore = null;
        this.goStep('ignore');
        break;
      case 'more':
        this.target = Math.min(16, this.target + 4);
        this.queue = d.pads.map((p) => p.id);
        this.goStep('pad');
        break;
      case 'fix':
        this.applyFix(this.check.advice[Number(data.i)].fixes[Number(data.j)]);
        break;
      case 'toSave':
        this.goStep('save');
        break;
      case 'name':
        $('#tableName', this.el).value = data.id;
        break;
      case 'save':
        this.save();
        break;
    }
  },

  applyFix(fix) {
    const d = this.draft;
    log('self-check fix:', fix);
    if (fix.action === 'retrain') {
      d.samples = d.samples.filter((s) => !fix.pads.includes(s.padId));
      this.queue = [...fix.pads];
      this.goStep('pad');
    } else if (fix.action === 'changeType') {
      const pad = d.pads.find((p) => p.id === fix.pad);
      if (!changePad(d, fix.pad, pad.zone, fix.type)) return toast('That pad already exists.');
      app.map.setPads(d.pads);
      this.queue = [`${pad.zone}:${fix.type}`];
      this.goStep('pad');
    } else if (fix.action === 'remove') {
      removePad(d, fix.pad);
      app.map.setPads(d.pads);
      this.goStep('check');
    } else if (fix.action === 'clearNone') {
      this.act('redoIgnore');
    }
  },

  startQuiet() {
    const det = app.engine.detector;
    this.quiet = { running: true, left: null, disturbed: 0 };
    this.render();
    this.later(() => {
      const startHop = det.hopIndex;
      this.quiet.measuring = true;
      this.quiet.left = 3;
      this.updateCount(3);
      this.countdown = setInterval(() => this.updateCount(--this.quiet.left), 1000);
      this.later(() => {
        clearInterval(this.countdown);
        this.quiet.measuring = false;
        const vals = [];
        for (let h = startHop; h < det.hopIndex; h++) vals.push(det.dbAt(h));
        vals.sort((a, b) => a - b);
        const floorDb = vals[vals.length >> 1];
        det.calibrate(floorDb); // start the adaptive floor from the measured value
        const [level, verdict] =
          floorDb < -55 ? ['ok', 'quiet — perfect'] : floorDb < -42 ? ['ok', 'fine'] : floorDb < -32 ? ['warn', 'noisy — tap firmly'] : ['bad', 'very noisy — Hum may miss taps'];
        this.quiet = { result: { floorDb, level, verdict, disturbed: this.quiet.disturbed > 0 } };
        this.draft.calibration = { floorDb, at: Date.now() };
        log(`quiet calibration: floor ${floorDb.toFixed(1)} dB, disturbed ${this.quiet.result.disturbed}`);
        this.render();
        if (!this.quiet.result.disturbed && level !== 'bad') this.later(() => this.step === 'quiet' && this.act('toPads'), 1200);
      }, QUIET_MS);
    }, SETTLE_MS);
  },

  startIgnore() {
    const d = this.draft;
    d.samples = d.samples.filter((s) => s.padId !== NONE);
    this.ignore = { running: true, left: 5, count: 0 };
    this.render();
    this.countdown = setInterval(() => this.updateCount(--this.ignore.left), 1000);
    this.later(() => {
      clearInterval(this.countdown);
      const n = this.ignore.count;
      this.ignore = null;
      this.ignoreVisited = true;
      toast(n ? `Learned ${Math.min(n, MAX_NONE)} sounds to ignore` : 'No loud sounds heard — that is fine.');
      this.goStep('check');
    }, IGNORE_MS);
  },

  updateCount(v) {
    const el = $('#count', this.el);
    if (el) el.textContent = Math.max(0, v);
  },

  runCheck() {
    if (this.setupSeconds === null && this.setupStart) this.setupSeconds = Math.round((Date.now() - this.setupStart) / 1000);
    this.check = selfCheck(this.draft, app.settings);
    log('self-check', { padAccuracy: this.check.padAccuracy, falseTriggers: this.check.falseTriggers, setupSeconds: this.setupSeconds });
  },

  async save() {
    const d = this.draft;
    d.name = ($('#tableName', this.el).value || '').trim().slice(0, 40) || 'My table';
    d.check = { padAccuracy: this.check.padAccuracy, falseTriggers: this.check.falseTriggers, noneTotal: this.check.noneTotal, setupSeconds: this.setupSeconds, at: Date.now() };
    this.saved = true;
    assignDefaultPhrases(d);
    await saveProfile(d);
    app.profile = d;
    retrain();
    await setActiveId(d.id);
    toast(`Saved “${d.name}” — knock a pad to try it`);
    go('access');
  },

  // ------------------------------------------------------------------ taps ------

  onTap(sample, d) {
    const draft = this.draft;
    if (this.step === 'quiet' && this.quiet?.measuring) {
      this.quiet.disturbed++;
      return null;
    }
    if (this.step === 'ignore' && this.ignore?.running) {
      this.ignore.count++;
      if (countFor(draft, NONE) < MAX_NONE) {
        sample.padId = NONE;
        draft.samples.push(sample);
      }
      d.marker.label = 'ignore';
      app.map.ripple(null, 'unsure');
      const el = $('#heard', this.el);
      if (el) el.textContent = `heard ${this.ignore.count} sounds`;
      return { summary: { padId: NONE } };
    }
    if (this.step !== 'pad' || this.locked) return null;
    const pad = draft.pads.find((p) => p.id === this.queue[0]);
    if (!pad) return null;
    sample.padId = pad.id;
    draft.samples.push(sample);
    d.marker.label = pad.short;
    d.marker.ok = true;
    app.map.ripple(pad.id, 'train');
    if (countFor(draft, pad.id) >= this.target) {
      // Pad complete: short pause (so a stray extra tap isn't counted), then the next pad.
      this.locked = true;
      this.later(() => {
        this.locked = false;
        this.queue.shift();
        if (this.queue.length) this.render();
        else this.goStep(this.ignoreVisited ? 'check' : 'ignore');
      }, 700);
    }
    this.render();
    return { summary: { padId: pad.id } };
  },
};
