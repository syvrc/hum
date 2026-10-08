import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatures, FEATURE_DIM, FEATURE_NAMES, GROUPS, WINDOW, preSamples, dimWeights } from '../src/audio/features.js';
import { rng, noise, tap, TAP_CLASSES } from './synth.js';

function windowOf(sig, sr, noiseRms = 0.0005, seed = 7) {
  const r = rng(seed);
  const w = noise(WINDOW, noiseRms, r);
  const pre = preSamples(sr);
  for (let i = 0; i + pre < WINDOW && i < sig.length; i++) w[pre + i] += sig[i];
  return w;
}

test('layout: names, groups and vector length agree', () => {
  assert.equal(FEATURE_NAMES.length, FEATURE_DIM);
  assert.equal(GROUPS.reduce((s, g) => s + g.size, 0), FEATURE_DIM);
  assert.equal(dimWeights().length, FEATURE_DIM);
});

for (const sr of [48000, 44100]) {
  test(`features are finite and loudness-independent in shape (${sr} Hz)`, () => {
    const r = rng(11);
    const t = tap(sr, TAP_CLASSES.knuckleNear, 0.1, r);
    const quiet = extractFeatures([windowOf(t, sr)], sr);
    const loud = extractFeatures([windowOf(t.map((v) => v * 4), sr)], sr);
    assert.equal(quiet.vec.length, FEATURE_DIM);
    for (const v of quiet.vec) assert.ok(Number.isFinite(v));
    const pk = FEATURE_NAMES.indexOf('peak_dBFS');
    assert.ok(Math.abs(loud.vec[pk] - quiet.vec[pk] - 12.04) < 0.5);
    // Spectral shape (mel bands with clear signal) barely moves when the knock is 4x louder.
    let maxDiff = 0;
    for (let i = 0; i < 20; i++) maxDiff = Math.max(maxDiff, Math.abs(loud.vec[i] - quiet.vec[i]));
    assert.ok(maxDiff < 3, `mel shape changed by ${maxDiff.toFixed(2)} dB`);
  });
}

test('a brighter knock has a higher spectral centroid than a palm slap', () => {
  const sr = 48000;
  const r = rng(12);
  const palm = extractFeatures([windowOf(tap(sr, TAP_CLASSES.palmLeft, 0.2, r), sr)], sr);
  const knuckle = extractFeatures([windowOf(tap(sr, TAP_CLASSES.knuckleNear, 0.2, r), sr)], sr);
  assert.ok(knuckle.info.centroidHz > 2 * palm.info.centroidHz);
  assert.ok(knuckle.info.attackMs < palm.info.attackMs);
});

test('stereo: duplicated mono is detected as fake; a real delay is measured with the right sign', () => {
  const sr = 48000;
  const r = rng(13);
  const w = windowOf(tap(sr, TAP_CLASSES.knuckleNear, 0.2, r), sr);
  const fake = extractFeatures([w, Float32Array.from(w)], sr);
  assert.equal(fake.info.stereoReal, false);
  // Channel 1 hears the knock 6 samples later (and a bit quieter) → channel 0 heard it first.
  const late = new Float32Array(WINDOW);
  for (let i = 6; i < WINDOW; i++) late[i] = 0.7 * w[i - 6];
  const real = extractFeatures([w, late], sr);
  assert.equal(real.info.stereoReal, true);
  assert.ok(Math.abs(real.info.delayMs - -6 / 48) < 0.03, `delay ${real.info.delayMs} ms`);
  const ild = FEATURE_NAMES.indexOf('ild3_dB');
  assert.ok(Math.abs(real.vec[ild] - 20 * Math.log10(1 / 0.7)) < 1.5);
});
