// Debug report (small JSON you can paste into chat) and dataset export (raw tap audio
// + labels for offline analysis with tools/analyze.py). Both are created on this phone
// and only leave it if you explicitly copy, download or send them.

import { FEATURE_VERSION, FEATURE_NAMES } from './audio/features.js';
import { logLines } from './ui/log.js';

const round = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(d)) : v);

function deviceInfo(app) {
  const e = app.engine;
  return {
    ua: navigator.userAgent,
    sampleRate: e.sr,
    channels: e.channels,
    trackSettings: e.trackSettings,
    baseLatencyMs: round((e.ctx?.baseLatency || 0) * 1000),
    inputLatencyMs: round(e.inputLatencyMs),
    motion: app.motion.available,
  };
}

function summaryOf(s) {
  if (!s) return null;
  return {
    accuracy: round(s.accuracy, 3),
    correct: s.correct,
    total: s.total,
    labels: s.labels,
    matrix: s.matrix,
    perClass: Object.fromEntries(Object.entries(s.perClass).map(([k, v]) => [k, round(v, 3)])),
  };
}

export function buildReport(app) {
  const st = app.state;
  const test = st.lastTest;
  return {
    kind: 'hum-debug-report',
    phase: 0,
    at: new Date().toISOString(),
    featureVersion: FEATURE_VERSION,
    device: deviceInfo(app),
    detector: { ...app.engine.detector?.opts, floorDb: round(app.engine.detector?.floorDb, 1) },
    settings: st.settings,
    preset: st.presetId,
    pads: st.pads.map((p) => p.id),
    train: {
      perPad: Object.fromEntries(st.pads.map((p) => [p.id, st.samples.filter((s) => s.padId === p.id).length])),
      loo: summaryOf(st.loo),
      stereoRealFraction: round(st.samples.filter((s) => s.feats.info.stereoReal).length / (st.samples.length || 1), 2),
      clippedTaps: st.samples.filter((s) => s.feats.info.clipped > 0).length,
      peakDb: Object.fromEntries(st.pads.map((p) => [p.id, st.samples.filter((s) => s.padId === p.id).map((s) => round(s.feats.info.peakDb, 1))])),
    },
    test: test && {
      ...test.summary,
      latency: latencyStats(test.results),
      rows: test.results.map((r) => [r.truth, r.pred, round(r.confidence), round(r.distRatio, 1), r.rejected ? 1 : 0, Math.round(r.latencyMs), round(r.peakDb, 1), r.sample.feats.info.clipped]),
      rowFormat: ['truth', 'pred', 'conf', 'distRatio', 'rejected', 'latencyMs', 'peakDb', 'clippedSamples'],
    },
    lastTap: st.lastTap,
    log: logLines().slice(-60),
  };
}

function toBase64Int16(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
  const bytes = new Uint8Array(i16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Mean and 95th-percentile latency (onset → result on screen) over test results. */
export function latencyStats(results) {
  const lat = results.map((r) => r.latencyMs).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (!lat.length) return { meanMs: null, p95Ms: null, n: 0 };
  return {
    meanMs: round(lat.reduce((a, b) => a + b, 0) / lat.length, 1),
    p95Ms: round(lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))], 1),
    n: lat.length,
  };
}

export function buildDataset(app) {
  const st = app.state;
  const tapRow = (set, s, extra = {}) => ({
    set,
    truth: s.padId,
    sr: s.sr,
    pre: s.pre,
    accel: s.accel,
    audio: s.channels.map(toBase64Int16),
    ...extra,
  });
  const taps = st.samples.map((s) => tapRow('train', s));
  if (st.lastTest) {
    for (const r of st.lastTest.results) {
      taps.push(tapRow('test', r.sample, { pred: r.pred, confidence: round(r.confidence, 3), distRatio: round(r.distRatio, 2), rejected: r.rejected, latencyMs: Math.round(r.latencyMs) }));
    }
  }
  return {
    kind: 'hum-dataset',
    version: 1,
    at: new Date().toISOString(),
    featureVersion: FEATURE_VERSION,
    featureNames: FEATURE_NAMES,
    device: deviceInfo(app),
    detector: app.engine.detector?.opts,
    settings: st.settings,
    preset: st.presetId,
    pads: st.pads.map((p) => p.id),
    audioFormat: 'int16 little-endian, base64, one string per channel',
    taps,
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Dev only: POST to the Vite dev server on *your* laptop, which saves it under data/. */
export async function sendToLaptop(obj) {
  const res = await fetch('/__hum/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}
