// Debug report (small JSON you can paste into chat) and dataset export (raw tap audio
// + labels for offline analysis with tools/analyze.js). Both are created on this phone
// and only leave it if you explicitly copy, download or send them.

import { FEATURE_VERSION, FEATURE_NAMES } from './audio/features.js';
import { f32ToB64, NONE } from './profile.js';
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

/** Mean and 95th-percentile latency (knock → result on screen) over test results. */
export function latencyStats(results) {
  const lat = results.map((r) => r.latencyMs).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (!lat.length) return { meanMs: null, p95Ms: null, n: 0 };
  return {
    meanMs: round(lat.reduce((a, b) => a + b, 0) / lat.length, 1),
    p95Ms: round(lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))], 1),
    n: lat.length,
  };
}

export function buildReport(app) {
  const p = app.profile;
  const test = p?.lastTest;
  const samples = p?.samples || [];
  return {
    kind: 'hum-debug-report',
    at: new Date().toISOString(),
    featureVersion: FEATURE_VERSION,
    device: deviceInfo(app),
    detector: { ...app.engine.detector?.opts, floorDb: round(app.engine.detector?.floorDb, 1) },
    settings: app.settings,
    profile: p && {
      name: p.name,
      pads: p.pads.map((x) => x.id),
      perPad: Object.fromEntries([...p.pads.map((x) => x.id), NONE].map((id) => [id, samples.filter((s) => s.padId === id).length])),
      calibration: p.calibration,
      check: p.check,
      stereoRealFraction: round(samples.filter((s) => s.feats.info.stereoReal).length / (samples.length || 1), 2),
      clippedTaps: samples.filter((s) => s.feats.info.clipped > 0).length,
      peakDb: Object.fromEntries(p.pads.map((x) => [x.id, samples.filter((s) => s.padId === x.id).map((s) => round(s.feats.info.peakDb, 1))])),
    },
    test: test && {
      ...test.summary,
      latency: latencyStats(test.results),
      rows: test.results.map((r) => [r.truth, r.pred, r.status, round(r.confidence), round(r.distRatio, 1), Math.round(r.latencyMs ?? -1), round(r.peakDb, 1), r.sample?.feats?.info.clipped ?? null]),
      rowFormat: ['truth', 'pred', 'status', 'conf', 'distRatio', 'latencyMs', 'peakDb', 'clippedSamples'],
    },
    lastTap: app.lastTap,
    log: logLines().slice(-60),
  };
}

export function buildDataset(app) {
  const p = app.profile;
  const tapRow = (set, s, extra = {}) => ({ set, truth: s.padId, sr: s.sr, pre: s.pre, accel: s.accel, audio: s.channels.map(f32ToB64), ...extra });
  const taps = (p?.samples || []).map((s) => tapRow('train', s));
  for (const r of p?.lastTest?.results || []) {
    if (!r.sample) continue;
    taps.push(tapRow('test', r.sample, { pred: r.pred, status: r.status, confidence: round(r.confidence, 3), distRatio: round(r.distRatio, 2), latencyMs: Math.round(r.latencyMs ?? -1) }));
  }
  return {
    kind: 'hum-dataset',
    version: 2,
    at: new Date().toISOString(),
    featureVersion: FEATURE_VERSION,
    featureNames: FEATURE_NAMES,
    device: deviceInfo(app),
    detector: app.engine.detector?.opts,
    settings: app.settings,
    profile: p && { name: p.name, calibration: p.calibration, check: p.check },
    pads: p ? p.pads.map((x) => x.id) : [],
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
