// Hum — phone app entry point (Phase 0: spike & go/no-go).
// Wires the pipeline together:  mic → engine (onsets) → features → k-NN → screens.
// Three tabs: TRAIN (teach each pad), TEST (randomised accuracy test), PLAY (free use).

import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles.css';

import { AudioEngine } from './audio/engine.js';
import { extractFeatures, dimWeights } from './audio/features.js';
import { ONSET_DEFAULTS } from './audio/onset.js';
import { KNN, leaveOneOut, summarise } from './ml/knn.js';
import { PRESETS, presetPads } from './pads.js';
import { Motion, keepScreenOn } from './platform.js';
import { loadSession, saveSession, loadSettings, saveSettings } from './store.js';
import { Scope } from './ui/scope.js';
import { TableMap } from './ui/tablemap.js';
import { confusionHtml, confusionAdvice } from './ui/confusion.js';
import { DebugPanel } from './ui/debug.js';
import { log } from './ui/log.js';
import { buildReport, buildDataset, copyText, downloadJson, sendToLaptop, latencyStats } from './report.js';

const TRAIN_PER_PAD = 8;
const TEST_PER_PAD = 20;
const MIN_PER_PAD_FOR_TEST = 4;
const DEFAULT_SETTINGS = { k: 3, minConfidence: 0.2, maxDistRatio: 4 };

const $ = (sel) => document.querySelector(sel);
const pct = (v) => `${Math.round(v * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const app = {
  engine: new AudioEngine(),
  motion: new Motion(),
  state: {
    presetId: PRESETS[0].id,
    pads: presetPads(PRESETS[0].id),
    samples: [], // training taps: { id, padId, sr, pre, channels, accel, feats, t }
    activePad: 0,
    model: null,
    loo: null,
    tab: 'train',
    test: null, // running test
    lastTest: null, // finished test
    settings: { ...DEFAULT_SETTINGS },
    detector: {},
    lastTap: null,
    play: [],
  },
};
const st = app.state;
const map = new TableMap($('#map'));
const scope = new Scope($('#scope'), app.engine);

// ---------------------------------------------------------------- start-up -----

$('#startBtn').addEventListener('click', start);

async function start() {
  const btn = $('#startBtn');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  $('#startError').hidden = true;
  try {
    const saved = await loadSettings();
    Object.assign(st.settings, saved.classifier || {});
    st.detector = saved.detector || {};
    app.engine.detectorOpts = { ...st.detector };
    await app.engine.start();
    app.motion.start();
    keepScreenOn();
    await restoreSession();
    $('#start').hidden = true;
    $('#lab').hidden = false;
    map.setPads(st.pads);
    scope.start();
    render();
    updateStatus();
    setInterval(updateStatus, 500);
  } catch (e) {
    log('start failed:', e.name, e.message);
    app.engine.stop();
    const el = $('#startError');
    el.hidden = false;
    el.textContent =
      e.name === 'NotAllowedError'
        ? 'Microphone permission was blocked. Tap the icon left of the address bar → Permissions → Microphone → Allow, then reload this page.'
        : e.name === 'NotFoundError'
          ? 'No microphone found on this device.'
          : e.code === 'insecure'
            ? 'This page must be opened over https:// (or http://localhost) for the microphone to work.'
            : `Could not start the microphone: ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Try again';
  }
}

app.engine.addEventListener('tap', (e) => onTap(e.detail));
app.engine.addEventListener('state', (e) => updateStatus(e.detail));

// Touching the glass makes a small knock too. Ignore taps from ~150 ms before to
// ~350 ms after any screen touch, so pressing buttons never counts as a table tap.
for (const type of ['pointerdown', 'pointerup']) {
  window.addEventListener(type, () => {
    const now = performance.now();
    app.engine.mute(now - 150, now + 350);
    app.engine.resume();
  }, { capture: true, passive: true });
}

// ---------------------------------------------------------------- tap routing --

function onTap(d) {
  const accel = app.motion.peakNear(d.onsetWall);
  const feats = extractFeatures(d.channels, d.sr, { pre: d.pre, accel });
  const sample = { id: uid(), sr: d.sr, pre: d.pre, channels: d.channels, accel, feats, t: Date.now() };
  let result = null;
  if (st.tab === 'train') result = trainTap(sample, d);
  else if (st.tab === 'test') result = testTap(sample, d);
  else result = playTap(sample, d);
  if (!result) return;
  // Latency = onset → result handled; refined below to the frame where it is drawn.
  const handled = performance.now() - d.onsetWall;
  if (result.record) result.record.latencyMs = handled;
  st.lastTap = { mode: st.tab, info: feats.info, accel, latencyMs: handled, ...result.summary };
  requestAnimationFrame(() => {
    const latency = performance.now() - d.onsetWall;
    if (result.record) result.record.latencyMs = latency;
    st.lastTap.latencyMs = latency;
    if (st.tab === 'play') renderPlayLatency(latency);
    if (result.record && st.tab === 'test' && !st.test) render(); // test just finished: include its last tap
  });
}

function classify(vec) {
  const p = st.model.predict(vec);
  p.rejected = p.confidence < st.settings.minConfidence || p.distRatio > st.settings.maxDistRatio;
  return p;
}

// ---------------------------------------------------------------- training -----

const countFor = (padId) => st.samples.filter((s) => s.padId === padId).length;

function trainTap(sample, d) {
  const pad = st.pads[st.activePad];
  if (!pad || countFor(pad.id) >= TRAIN_PER_PAD) {
    toast('This pad is full. Pick another pad, or go to Test.');
    return null;
  }
  sample.padId = pad.id;
  st.samples.push(sample);
  d.marker.label = pad.short;
  d.marker.ok = true;
  map.ripple(pad.id, 'train');
  if (countFor(pad.id) >= TRAIN_PER_PAD) {
    const next = st.pads.findIndex((p) => countFor(p.id) < TRAIN_PER_PAD);
    if (next >= 0) st.activePad = next;
  }
  retrain();
  persist();
  render();
  return { summary: { padId: pad.id } };
}

function retrain() {
  const ids = st.pads.map((p) => p.id);
  const usable = st.samples.filter((s) => ids.includes(s.padId));
  const trained = ids.filter((id) => countFor(id) >= 2);
  if (trained.length < 2) {
    st.model = null;
    st.loo = null;
    return;
  }
  const X = usable.map((s) => s.feats.vec);
  const y = usable.map((s) => s.padId);
  const opts = { k: st.settings.k, dimWeights: dimWeights() };
  st.model = new KNN(opts).fit(X, y);
  st.loo = ids.every((id) => countFor(id) >= 3) ? leaveOneOut(X, y, { ...opts, labels: ids }) : null;
}

const trainingComplete = () => st.pads.every((p) => countFor(p.id) >= TRAIN_PER_PAD);
const readyForTest = () => st.pads.every((p) => countFor(p.id) >= MIN_PER_PAD_FOR_TEST);

// ---------------------------------------------------------------- testing ------

function startTest() {
  const prompts = shuffle(st.pads.flatMap((p) => Array(TEST_PER_PAD).fill(p.id)));
  st.test = { prompts, idx: 0, results: [], excluded: 0, lastAt: 0, startedAt: new Date().toISOString(), feedback: null };
  map.highlight(prompts[0]);
  render();
}

function testTap(sample, d) {
  const t = st.test;
  if (!t || !st.model) return null;
  if (performance.now() - t.lastAt < 300) {
    log('test: extra tap ignored (<300 ms after the previous one)');
    return null;
  }
  const truth = t.prompts[t.idx];
  const p = classify(sample.feats.vec);
  sample.padId = truth;
  const ok = p.label === truth && !p.rejected;
  const record = { truth, pred: p.label, confidence: p.confidence, distRatio: p.distRatio, rejected: p.rejected, latencyMs: null, peakDb: sample.feats.info.peakDb, sample };
  t.results.push(record);
  t.idx++;
  t.lastAt = performance.now();
  t.feedback = { ok, rejected: p.rejected, heard: padById(p.label)?.label, confidence: p.confidence };
  d.marker.label = p.rejected ? '?' : padById(p.label)?.short;
  d.marker.ok = ok;
  map.ripple(p.rejected ? null : p.label, ok ? 'ok' : p.rejected ? 'unsure' : 'bad');
  if (t.idx >= t.prompts.length) finishTest();
  else map.highlight(t.prompts[t.idx]);
  render();
  return { record, summary: { pred: p.label, confidence: p.confidence, distRatio: p.distRatio, rejected: p.rejected, truth } };
}

function redoLastTestTap() {
  const t = st.test;
  if (!t || !t.results.length) return;
  t.results.pop();
  t.idx--;
  t.excluded++;
  t.feedback = null;
  log('test: last tap excluded by user (tapped the wrong spot)');
  map.highlight(t.prompts[t.idx]);
  render();
}

function finishTest() {
  const t = st.test;
  const ids = st.pads.map((p) => p.id);
  const res = t.results;
  const n = res.length;
  const forced = summarise(ids, res.map((r) => r.truth), res.map((r) => r.pred));
  const zoneOk = res.filter((r) => padById(r.truth).zone === padById(r.pred).zone).length;
  const typeOk = res.filter((r) => padById(r.truth).type === padById(r.pred).type).length;
  st.lastTest = {
    at: t.startedAt,
    presetId: st.presetId,
    results: res,
    summary: {
      n,
      accuracy: forced.accuracy,
      accuracyConfident: n ? res.filter((r) => r.pred === r.truth && !r.rejected).length / n : 0,
      notSure: res.filter((r) => r.rejected).length,
      zoneAccuracy: new Set(st.pads.map((p) => p.zone)).size > 1 ? zoneOk / n : null,
      typeAccuracy: new Set(st.pads.map((p) => p.type)).size > 1 ? typeOk / n : null,
      excludedByUser: t.excluded,
      trainingTaps: st.samples.length,
      labels: forced.labels,
      matrix: forced.matrix,
      perClass: forced.perClass,
    },
  };
  st.test = null;
  map.highlight(null);
  log('test finished', { accuracy: forced.accuracy, n });
  persist();
}

// ---------------------------------------------------------------- play ---------

function playTap(sample, d) {
  if (!st.model) return null;
  const p = classify(sample.feats.vec);
  st.play.unshift({ label: p.label, confidence: p.confidence, distRatio: p.distRatio, rejected: p.rejected, at: new Date() });
  st.play.length = Math.min(st.play.length, 8);
  d.marker.label = p.rejected ? '?' : padById(p.label)?.short;
  d.marker.ok = p.rejected ? null : true;
  map.ripple(p.rejected ? null : p.label, p.rejected ? 'unsure' : 'ok');
  render();
  return { summary: { pred: p.label, confidence: p.confidence, distRatio: p.distRatio, rejected: p.rejected } };
}

// ---------------------------------------------------------------- persistence --

let persistTimer = 0;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const strip = (s) => ({ id: s.id, padId: s.padId, sr: s.sr, pre: s.pre, channels: s.channels, accel: s.accel, t: s.t });
    saveSession({
      v: 1,
      presetId: st.presetId,
      samples: st.samples.map(strip),
      lastTest: st.lastTest && { ...st.lastTest, results: st.lastTest.results.map((r) => ({ ...r, sample: strip(r.sample) })) },
    });
  }, 400);
}

async function restoreSession() {
  const s = await loadSession();
  if (!s) return;
  st.presetId = s.presetId || PRESETS[0].id;
  st.pads = presetPads(st.presetId);
  // Features are recomputed from the stored raw audio, so feature-code updates apply.
  const withFeats = (x) => ({ ...x, feats: extractFeatures(x.channels, x.sr, { pre: x.pre, accel: x.accel }) });
  st.samples = (s.samples || []).map(withFeats);
  st.lastTest = s.lastTest ? { ...s.lastTest, results: s.lastTest.results.map((r) => ({ ...r, sample: withFeats(r.sample) })) } : null;
  const next = st.pads.findIndex((p) => countFor(p.id) < TRAIN_PER_PAD);
  st.activePad = next >= 0 ? next : 0;
  retrain();
  log(`restored ${st.samples.length} training taps (${st.presetId})`);
}

// ---------------------------------------------------------------- settings -----

function setSetting(group, key, value) {
  if (group === 'detector') {
    st.detector[key] = value;
    app.engine.setDetector({ [key]: value });
  } else {
    st.settings[key] = value;
    if (key === 'k') retrain();
  }
  saveSettings({ detector: st.detector, classifier: st.settings });
}

function resetSettings() {
  st.detector = {};
  st.settings = { ...DEFAULT_SETTINGS };
  app.engine.setDetector({ ...ONSET_DEFAULTS });
  retrain();
  saveSettings({ detector: {}, classifier: st.settings });
}

// ---------------------------------------------------------------- rendering ----

const padById = (id) => st.pads.find((p) => p.id === id);

document.querySelectorAll('.tabs [data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.disabled) return;
    if (st.test && b.dataset.tab !== 'test') st.test = null; // leaving aborts a running test
    st.tab = b.dataset.tab;
    map.highlight(st.tab === 'train' ? st.pads[st.activePad]?.id : null);
    render();
  }),
);

function render() {
  const ready = readyForTest();
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === st.tab);
    b.setAttribute('aria-selected', b.dataset.tab === st.tab);
    if (b.dataset.tab !== 'train') b.disabled = !ready;
  });
  for (const p of st.pads) map.setCount(p.id, `${countFor(p.id)}/${TRAIN_PER_PAD}`);
  const panel = $('#panel');
  if (st.tab === 'train') {
    map.highlight(trainingComplete() ? null : st.pads[st.activePad]?.id);
    panel.innerHTML = trainHtml();
    bindTrain(panel);
  } else if (st.tab === 'test') {
    panel.innerHTML = testHtml();
    bindTest(panel);
  } else {
    panel.innerHTML = playHtml();
  }
}

function trainHtml() {
  const pad = st.pads[st.activePad];
  const n = countFor(pad.id);
  const preset = PRESETS.find((p) => p.id === st.presetId);
  const dots = Array.from({ length: TRAIN_PER_PAD }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  const prompt = trainingComplete()
    ? `<div class="card ok"><div class="eyebrow">TRAINING COMPLETE</div><p>All pads learned. Check the result below, then run the accuracy test.</p></div>`
    : `<div class="card prompt" aria-live="polite">
        <div class="eyebrow">PAD ${st.activePad + 1} OF ${st.pads.length} · TAP ${Math.min(n + 1, TRAIN_PER_PAD)} OF ${TRAIN_PER_PAD}</div>
        <div class="big">${esc(pad.label)}</div>
        <div class="sub">${esc(pad.how)}, ${esc(pad.where)}. Tap about once a second.</div>
        <div class="dots">${dots}</div>
      </div>`;
  const pads = st.pads
    .map((p, i) => `<button class="chip ${i === st.activePad ? 'active' : ''} ${countFor(p.id) >= TRAIN_PER_PAD ? 'done' : ''}" data-pad="${i}">${esc(p.short)} <span class="mono">${countFor(p.id)}/${TRAIN_PER_PAD}</span></button>`)
    .join('');
  const loo = st.loo
    ? `<div class="card">
        <div class="eyebrow">TRAINING CHECK · LEAVE-ONE-OUT</div>
        <div class="metric"><span class="num">${pct(st.loo.accuracy)}</span><span class="muted">${st.loo.correct}/${st.loo.total} training taps recognised when held out</span></div>
        ${confusionHtml(st.loo, st.pads)}
        ${confusionAdvice(st.loo, st.pads).map((a) => `<p class="warn">⚠ ${esc(a)}</p>`).join('')}
      </div>`
    : '';
  return `
    <div class="row between">
      <label class="field">Pad set
        <select id="preset">${PRESETS.map((p) => `<option value="${p.id}" ${p.id === st.presetId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </label>
      <span class="muted small">${esc(preset.note)}</span>
    </div>
    ${prompt}
    <div class="chips">${pads}</div>
    <div class="row">
      <button class="btn" id="undo" ${st.samples.length ? '' : 'disabled'}>Undo last tap</button>
      <button class="btn" id="redoPad" ${n ? '' : 'disabled'}>Redo this pad</button>
      <button class="btn danger" id="resetAll" ${st.samples.length ? '' : 'disabled'}>Reset all</button>
    </div>
    ${loo}
    ${readyForTest() ? `<button class="btn primary big" id="goTest">Run accuracy test →</button>` : ''}
    <p class="muted small">Keep the phone flat, face-up and still, and stay quiet while training. Screen touches are ignored, so you can press buttons any time.</p>`;
}

function bindTrain(panel) {
  panel.querySelector('#preset').addEventListener('change', (e) => {
    if (st.samples.length && !confirm('Switching pad set clears your current training taps. Continue?')) {
      e.target.value = st.presetId;
      return;
    }
    st.presetId = e.target.value;
    st.pads = presetPads(st.presetId);
    st.samples = [];
    st.activePad = 0;
    st.lastTest = null;
    retrain();
    map.setPads(st.pads);
    persist();
    render();
  });
  panel.querySelectorAll('[data-pad]').forEach((b) =>
    b.addEventListener('click', () => {
      st.activePad = Number(b.dataset.pad);
      render();
    }),
  );
  panel.querySelector('#undo').addEventListener('click', () => {
    const s = st.samples.pop();
    if (s) st.activePad = st.pads.findIndex((p) => p.id === s.padId);
    retrain();
    persist();
    render();
  });
  panel.querySelector('#redoPad').addEventListener('click', () => {
    const id = st.pads[st.activePad].id;
    st.samples = st.samples.filter((s) => s.padId !== id);
    retrain();
    persist();
    render();
  });
  panel.querySelector('#resetAll').addEventListener('click', () => {
    if (!confirm('Delete all training taps for this pad set?')) return;
    st.samples = [];
    st.activePad = 0;
    st.lastTest = null;
    retrain();
    persist();
    render();
  });
  panel.querySelector('#goTest')?.addEventListener('click', () => {
    st.tab = 'test';
    render();
  });
}

function testHtml() {
  const t = st.test;
  if (t) {
    const pad = padById(t.prompts[t.idx]);
    const fb = t.feedback;
    const fbHtml = fb
      ? `<p class="feedback ${fb.ok ? 'ok' : fb.rejected ? 'unsure' : 'bad'}">${fb.ok ? '✓ correct' : fb.rejected ? `? not sure (best guess ${esc(fb.heard)})` : `✗ heard ${esc(fb.heard)}`} · confidence ${fb.confidence.toFixed(2)}</p>`
      : '<p class="feedback">&nbsp;</p>';
    return `
      <div class="card prompt" aria-live="polite">
        <div class="eyebrow">ACCURACY TEST · ${t.idx + 1} / ${t.prompts.length}</div>
        <div class="big">${esc(pad.label)}</div>
        <div class="sub">${esc(pad.how)}, ${esc(pad.where)}</div>
        <div class="progress"><i style="width:${(t.idx / t.prompts.length) * 100}%"></i></div>
      </div>
      ${fbHtml}
      <div class="row">
        <button class="btn" id="redoTap" ${t.results.length ? '' : 'disabled'}>I tapped the wrong spot — redo</button>
        <button class="btn danger" id="stopTest">Stop test</button>
      </div>
      <p class="muted small">"Redo" is only for <em>your</em> mistakes (wrong spot or tap type). Excluded taps are counted in the report.</p>`;
  }
  const intro = `
    <div class="card">
      <div class="eyebrow">ACCURACY TEST</div>
      <p>${TEST_PER_PAD} prompted taps per pad (${TEST_PER_PAD * st.pads.length} in total), in random order. Tap exactly what the screen asks, about once a second. Hum doesn't learn from these taps.</p>
      <button class="btn primary big" id="startTest">Start test</button>
    </div>`;
  return (st.lastTest ? resultsHtml(st.lastTest) : '') + intro;
}

function resultsHtml(lt) {
  const s = lt.summary;
  const lat = latencyStats(lt.results);
  const gate = s.accuracy >= 0.85 ? ['GO', 'ok', '≥ 85%: continue as planned'] : s.accuracy >= 0.7 ? ['REDUCE', 'warn', '70–85%: merge zones, lean on tap type'] : ['PLAN B', 'bad', '< 70%: tap type × rhythm'];
  const extra = [
    s.zoneAccuracy !== null ? `location right ${pct(s.zoneAccuracy)}` : null,
    s.typeAccuracy !== null ? `tap type right ${pct(s.typeAccuracy)}` : null,
    `confident & right ${pct(s.accuracyConfident)}`,
    `not sure ${s.notSure}`,
    `excluded by you ${s.excludedByUser}`,
  ].filter(Boolean);
  return `
    <div class="card">
      <div class="eyebrow">LAST TEST · ${esc(PRESETS.find((p) => p.id === lt.presetId)?.name || lt.presetId)} · ${s.n} taps · trained on ${s.trainingTaps}</div>
      <div class="metric"><span class="num">${pct(s.accuracy)}</span><span class="gate ${gate[1]}">${gate[0]}</span></div>
      <p class="muted small">${gate[2]} (brief §6 gate)</p>
      <p class="mono small">${extra.join(' · ')}</p>
      <p class="mono small">latency avg ${lat.meanMs?.toFixed(0) ?? '–'} ms · p95 ${lat.p95Ms?.toFixed(0) ?? '–'} ms (onset → on screen)</p>
      ${confusionHtml(s, st.pads)}
      <div class="row">
        <button class="btn primary" id="copyReport">Copy report</button>
        ${import.meta.env.DEV ? '<button class="btn" id="sendData">Send dataset to laptop</button>' : ''}
        <button class="btn" id="downloadData">Download dataset</button>
      </div>
    </div>`;
}

function bindTest(panel) {
  panel.querySelector('#startTest')?.addEventListener('click', startTest);
  panel.querySelector('#redoTap')?.addEventListener('click', redoLastTestTap);
  panel.querySelector('#stopTest')?.addEventListener('click', () => {
    st.test = null;
    map.highlight(null);
    render();
  });
  panel.querySelector('#copyReport')?.addEventListener('click', copyReport);
  panel.querySelector('#sendData')?.addEventListener('click', sendDataset);
  panel.querySelector('#downloadData')?.addEventListener('click', downloadDataset);
}

function playHtml() {
  const last = st.play[0];
  const main = last
    ? `<div class="big ${last.rejected ? 'unsure' : ''}">${last.rejected ? 'Not sure' : esc(padById(last.label)?.label)}</div>
       <div class="sub mono">confidence ${last.confidence.toFixed(2)} · distance ratio ${last.distRatio.toFixed(1)}${last.rejected ? ` · best guess ${esc(padById(last.label)?.short)}` : ''}</div>
       <div class="sub mono" id="playLatency"></div>`
    : `<div class="big muted">Tap the table</div><div class="sub">Hum will show which pad it heard.</div>`;
  const hist = st.play
    .slice(1)
    .map((p) => `<li><span>${p.rejected ? '?' : esc(padById(p.label)?.short)}</span><span class="mono muted">${p.confidence.toFixed(2)}</span></li>`)
    .join('');
  return `<div class="card prompt" aria-live="polite"><div class="eyebrow">LIVE</div>${main}</div><ul class="history">${hist}</ul>`;
}

function renderPlayLatency(ms) {
  const el = $('#playLatency');
  if (el) el.textContent = `latency ${ms.toFixed(0)} ms (onset → on screen)`;
}

function updateStatus() {
  const e = app.engine;
  const pill = $('#micPill');
  if (e.state === 'running' && e.ctx?.state === 'running') {
    pill.textContent = `LISTENING ${Math.round(e.sr / 1000)}k·${e.channels || '?'}ch`;
    pill.className = 'pill live';
  } else if (e.state === 'error') {
    pill.textContent = 'MIC LOST · reload';
    pill.className = 'pill bad';
  } else if (e.state === 'running') {
    pill.textContent = 'PAUSED · tap screen';
    pill.className = 'pill warn';
  } else {
    pill.textContent = 'MIC OFF';
    pill.className = 'pill';
  }
  const det = e.detector;
  $('#floorReadout').textContent = det ? `FLOOR ${det.floorDb.toFixed(0)} dB` : 'FLOOR —';
}

// ---------------------------------------------------------------- report/debug -

async function copyReport() {
  const text = JSON.stringify(buildReport(app));
  if (await copyText(text)) toast('Report copied — paste it to Claude.');
  else {
    downloadJson(JSON.parse(text), `hum-report-${Date.now()}.json`);
    toast('Clipboard blocked — report downloaded instead.');
  }
}

async function sendDataset() {
  try {
    const r = await sendToLaptop(buildDataset(app));
    toast(`Saved on laptop: data/${r.file}`);
  } catch (e) {
    toast(`Send failed: ${e.message}`);
  }
}

function downloadDataset() {
  downloadJson(buildDataset(app), `hum-dataset-${st.presetId}-${Date.now()}.json`);
}

const debug = new DebugPanel($('#debug'), app, {
  copyReport,
  sendToLaptop: import.meta.env.DEV ? sendDataset : null,
  downloadDataset,
  setSetting,
  resetSettings,
});

// Long-press the logo (0.7 s) to open the debug panel. Also reachable with ?debug.
let pressTimer = 0;
const logo = $('#logo');
logo.addEventListener('pointerdown', () => (pressTimer = setTimeout(() => debug.open(), 700)));
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) logo.addEventListener(ev, () => clearTimeout(pressTimer));
logo.addEventListener('contextmenu', (e) => e.preventDefault());
if (new URLSearchParams(location.search).has('debug')) logo.addEventListener('click', () => debug.open());

// ---------------------------------------------------------------- helpers ------

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

if (!window.isSecureContext) {
  $('#startError').hidden = false;
  $('#startError').textContent = 'This page is not secure, so the microphone is blocked. Open it via https:// or http://localhost.';
}
log('Hum loaded', { dev: import.meta.env.DEV, secure: window.isSecureContext });
