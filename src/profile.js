// Surface Profiles — everything Hum knows about one table ("Dining table", "Desk"…):
// which pads exist, the example taps for each pad, sounds to ignore, and the noise
// floor measured during setup.
//
// We store the *raw* ~45 ms audio of every example (not just the numbers computed
// from it), so improving the feature code later automatically upgrades old profiles.
//
// Pure JS (no browser APIs) — unit-tested in Node.

import { extractFeatures, dimWeights, FEATURE_VERSION } from './audio/features.js';
import { KNN, leaveOneOut } from './ml/knn.js';
import { makePad, ZONES, TAP_TYPES } from './pads.js';

export const NONE = '__none'; // the "Not a command" class: sounds Hum should ignore
export const TRAIN_PER_PAD = 8;
export const MIN_PER_PAD = 4; // fewer than this and a pad can't be checked or tested
export const MAX_PADS = 8;
export const MAX_NONE = 24;
export const PROFILE_VERSION = 1;

const DERIVED_PAD_KEYS = ['zone', 'type', 'label', 'short', 'where', 'how'];

export const noneLabel = { id: NONE, label: 'IGNORE', short: 'IGNORE' };

export function newProfile(name, padIds, id = uid()) {
  const now = Date.now();
  return { v: PROFILE_VERSION, id, name, createdAt: now, updatedAt: now, pads: padIds.map((pid) => makePad(pid)), samples: [], calibration: null, check: null, lastTest: null };
}

/** Stored form → runtime form (pads expanded, features computed from the raw audio). */
export function hydrate(stored) {
  return {
    ...stored,
    pads: stored.pads.map((p) => ({ ...makePad(p.id), ...stripDerived(p) })),
    samples: (stored.samples || []).map(withFeatures),
    lastTest: stored.lastTest ? { ...stored.lastTest, results: stored.lastTest.results.map((r) => ({ ...r, sample: r.sample && withFeatures(r.sample) })) } : null,
  };
}

/** Runtime form → stored form (no derived fields, no feature vectors). */
export function dehydrate(profile) {
  return {
    v: PROFILE_VERSION,
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    pads: profile.pads.map(stripDerived),
    samples: profile.samples.map(stripSample),
    calibration: profile.calibration ?? null,
    check: profile.check ?? null, // summary of the last self-check { padAccuracy, falseTriggers, setupSeconds, at }
    lastTest: profile.lastTest ? { ...profile.lastTest, results: profile.lastTest.results.map((r) => ({ ...r, sample: r.sample && stripSample(r.sample) })) } : null,
  };
}

export function withFeatures(s) {
  return { ...s, feats: extractFeatures(s.channels, s.sr, { pre: s.pre, accel: s.accel }) };
}

function stripSample(s) {
  return { id: s.id, padId: s.padId, sr: s.sr, pre: s.pre, channels: s.channels, accel: s.accel ?? null, t: s.t };
}

function stripDerived(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) if (!DERIVED_PAD_KEYS.includes(k)) out[k] = v;
  return out;
}

export const countFor = (profile, padId) => profile.samples.filter((s) => s.padId === padId).length;

/** Labels the classifier knows: every pad, plus NONE if ignore-sounds were recorded. */
export function classLabels(profile) {
  const ids = profile.pads.map((p) => p.id);
  return countFor(profile, NONE) > 0 ? [...ids, NONE] : ids;
}

/** Train a k-NN on the profile. Returns null until at least two classes have 2+ taps. */
export function trainModel(profile, settings) {
  const labels = classLabels(profile);
  const usable = profile.samples.filter((s) => labels.includes(s.padId));
  const enough = labels.filter((l) => usable.filter((s) => s.padId === l).length >= 2);
  if (enough.length < 2) return null;
  return new KNN({ k: settings.k, dimWeights: dimWeights() }).fit(
    usable.map((s) => s.feats.vec),
    usable.map((s) => s.padId),
  );
}

/**
 * Turn a raw k-NN prediction into a decision:
 *   'pad'     — confident: act on it
 *   'ignored' — sounded like a trained "not a command" sound
 *   'unsure'  — too close between pads, or unlike anything taught → do nothing
 */
export function decide(model, vec, settings) {
  const p = model.predict(vec);
  const unsure = p.confidence < settings.minConfidence || p.distRatio > settings.maxDistRatio;
  p.status = p.label === NONE ? 'ignored' : unsure ? 'unsure' : 'pad';
  p.rejected = p.status !== 'pad';
  return p;
}

export function isReadyToCheck(profile) {
  return profile.pads.length >= 2 && profile.pads.every((p) => countFor(profile, p.id) >= MIN_PER_PAD);
}

/**
 * Self-check after training: leave-one-out accuracy, confusion matrix, how separable
 * each pad is, and plain-English advice for pads that get mixed up.
 */
export function selfCheck(profile, settings) {
  const labels = classLabels(profile);
  const usable = profile.samples.filter((s) => labels.includes(s.padId));
  const X = usable.map((s) => s.feats.vec);
  const y = usable.map((s) => s.padId);
  const opts = { k: settings.k, dimWeights: dimWeights() };
  const loo = leaveOneOut(X, y, { ...opts, labels });
  // Pad accuracy only counts real pad taps; "ignore" sounds wrongly heard as pads are
  // reported separately as false triggers.
  const padPreds = loo.predictions.filter((p) => p.truth !== NONE);
  const padAccuracy = padPreds.length ? padPreds.filter((p) => p.label === p.truth).length / padPreds.length : 0;
  const nonePreds = loo.predictions.filter((p) => p.truth === NONE);
  const falseTriggers = nonePreds.filter((p) => p.label !== NONE).length;
  const model = new KNN(opts).fit(X, y);
  return {
    labels,
    loo,
    padAccuracy,
    padTotal: padPreds.length,
    noneTotal: nonePreds.length,
    falseTriggers,
    separability: separability(model),
    advice: advise(loo, profile.pads),
  };
}

/**
 * Silhouette score per class, in the classifier's own (normalised, weighted) space:
 * for each example, (distance to the nearest *other* pad's examples − distance to its
 * own pad's examples) ÷ the larger of the two. Near 1 = clearly its own sound;
 * near 0 or below = it sounds as much like another pad as like itself.
 */
export function separability(model) {
  const { Z, y, labels } = model;
  const dist = (a, b) => {
    let s = 0;
    for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2;
    return Math.sqrt(s);
  };
  const out = {};
  for (const label of labels) {
    const scores = [];
    Z.forEach((zi, i) => {
      if (y[i] !== label) return;
      const meanTo = {};
      const counts = {};
      Z.forEach((zj, j) => {
        if (i === j) return;
        meanTo[y[j]] = (meanTo[y[j]] || 0) + dist(zi, zj);
        counts[y[j]] = (counts[y[j]] || 0) + 1;
      });
      if (!counts[label]) return;
      const a = meanTo[label] / counts[label];
      let b = Infinity;
      for (const other of Object.keys(counts)) if (other !== label) b = Math.min(b, meanTo[other] / counts[other]);
      if (b === Infinity) return;
      scores.push((b - a) / Math.max(a, b));
    });
    out[label] = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
  }
  return out;
}

/** The most-confused pairs (≥ 10% of their taps mixed up), worst first, with fixes. */
export function advise(loo, pads) {
  const name = (id) => (id === NONE ? 'background sounds' : pads.find((p) => p.id === id)?.label || id);
  const { labels, matrix } = loo;
  const pairs = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const mixed = matrix[i][j] + matrix[j][i];
      const total = matrix[i].reduce((s, v) => s + v, 0) + matrix[j].reduce((s, v) => s + v, 0);
      if (!total || mixed / total < 0.1) continue;
      pairs.push({ a: labels[i], b: labels[j], frac: mixed / total });
    }
  }
  pairs.sort((p, q) => q.frac - p.frac);
  return pairs.slice(0, 3).map(({ a, b, frac }) => {
    const pctTxt = `${Math.round(frac * 100)}%`;
    if (a === NONE || b === NONE) {
      const pad = a === NONE ? b : a;
      return {
        a: pad,
        b: NONE,
        frac,
        text: `${name(pad)} is sometimes mistaken for background sounds (${pctTxt}). Tap it a little firmer, or re-record the ignore sounds.`,
        fixes: [{ action: 'retrain', pads: [pad], label: `Retrain ${shortName(pads, pad)}` }, { action: 'clearNone', label: 'Re-record ignore sounds' }],
      };
    }
    // Suggest changing the tap type of the second pad to one that sounds most different.
    const padB = pads.find((p) => p.id === b);
    const newType = padB && alternativeType(pads, padB);
    const fixes = [{ action: 'retrain', pads: [a, b], label: 'Retrain both' }];
    if (newType) fixes.push({ action: 'changeType', pad: b, type: newType, label: `Make ${shortName(pads, b)} a ${TAP_TYPES[newType].label.toLowerCase()} tap` });
    if (pads.length > 2) fixes.push({ action: 'remove', pad: b, label: `Remove ${shortName(pads, b)}` });
    return {
      a,
      b,
      frac,
      text: `${name(a)} and ${name(b)} sound alike (${pctTxt} mixed up) — retrain them, move one, or change one's tap type.`,
      fixes,
    };
  });
}

const shortName = (pads, id) => pads.find((p) => p.id === id)?.short || id;

// Which tap type sounds most different from each type (palm ↔ knuckle are the most distinct).
const CONTRAST = { palm: ['knuckle', 'nail', 'fist'], knuckle: ['palm', 'fist', 'nail'], nail: ['palm', 'fist', 'knuckle'], fist: ['nail', 'knuckle', 'palm'] };

export function alternativeType(pads, pad) {
  const used = new Set(pads.filter((p) => p.zone === pad.zone).map((p) => p.type));
  return CONTRAST[pad.type].find((t) => !used.has(t)) || null;
}

/** Replace pad `padId` with a new (zone, type) pad, dropping its examples. */
export function changePad(profile, padId, zone, type) {
  const newId = `${zone}:${type}`;
  if (profile.pads.some((p) => p.id === newId)) return false;
  profile.pads = profile.pads.map((p) => (p.id === padId ? { ...makePad(newId), ...stripDerived(p), id: newId } : p));
  profile.samples = profile.samples.filter((s) => s.padId !== padId);
  return true;
}

export function removePad(profile, padId) {
  profile.pads = profile.pads.filter((p) => p.id !== padId);
  profile.samples = profile.samples.filter((s) => s.padId !== padId);
}

// --- Export / import --------------------------------------------------------------

export function exportProfile(profile) {
  const stored = dehydrate(profile);
  return {
    kind: 'hum-profile',
    version: PROFILE_VERSION,
    featureVersion: FEATURE_VERSION,
    exportedAt: new Date().toISOString(),
    audioFormat: 'int16 little-endian, base64, one string per channel',
    profile: {
      ...stored,
      samples: stored.samples.map((s) => ({ ...s, channels: s.channels.map(f32ToB64) })),
      lastTest: stored.lastTest ? { ...stored.lastTest, results: stored.lastTest.results.map(({ sample, ...r }) => r) } : null,
    },
  };
}

/** Parse an exported profile. Throws with a readable message if the file is wrong. */
export function importProfile(json) {
  if (!json || json.kind !== 'hum-profile' || !json.profile) throw new Error('This file is not a Hum profile.');
  const p = json.profile;
  if (!Array.isArray(p.pads) || !Array.isArray(p.samples)) throw new Error('This profile file is damaged.');
  for (const pad of p.pads) {
    const [zone, type] = String(pad.id).split(':');
    if (!ZONES[zone] || !TAP_TYPES[type]) throw new Error(`Unknown pad "${pad.id}" in profile.`);
  }
  const stored = {
    ...p,
    id: uid(), // imported copies never overwrite an existing profile
    updatedAt: Date.now(),
    samples: p.samples.map((s) => ({ ...s, channels: s.channels.map(b64ToF32) })),
    lastTest: p.lastTest ? { ...p.lastTest, results: p.lastTest.results.map((r) => ({ ...r, sample: null })) } : null,
  };
  return hydrate(stored);
}

function f32ToB64(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
  const bytes = new Uint8Array(i16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64ToF32(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer);
  return Float32Array.from(i16, (v) => v / 32767);
}

export { f32ToB64 };

export function uid() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
