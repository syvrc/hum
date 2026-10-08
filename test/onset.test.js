import test from 'node:test';
import assert from 'node:assert/strict';
import { OnsetDetector } from '../src/audio/onset.js';
import { rng, noise, tap, scene, chunks, TAP_CLASSES } from './synth.js';

const SR = 48000;

function detectAll(signal, chunkSize = 512, opts = {}) {
  const det = new OnsetDetector(SR, opts);
  const found = [];
  for (const block of chunks([signal], chunkSize)) found.push(...det.process(block));
  return { found, det };
}

test('no onsets in plain room noise', () => {
  const r = rng(1);
  const { found, det } = detectAll(noise(SR * 4, 0.002, r));
  assert.equal(found.length, 0);
  assert.ok(Math.abs(det.floorDb - 20 * Math.log10(0.002)) < 2, `floor ${det.floorDb}`);
});

test('finds every tap within a couple of milliseconds, even soft ones', () => {
  const r = rng(2);
  const times = [0.5, 1.1, 1.6, 2.4, 3.0, 3.35, 4.2];
  const gains = [0.3, 0.05, 0.6, 0.02, 0.2, 0.1, 0.4];
  const names = Object.keys(TAP_CLASSES);
  const events = times.map((at, i) => ({ at, sig: tap(SR, TAP_CLASSES[names[i % names.length]], gains[i], r) }));
  const { found } = detectAll(scene(SR, 5, events, 0.001, r));
  assert.equal(found.length, times.length, `found ${found.map((s) => (s / SR).toFixed(3))}`);
  found.forEach((s, i) => {
    const errMs = ((s - times[i] * SR) / SR) * 1000;
    // Slice start can be up to one slice (1.3 ms) before the tap; slow palm attacks can be ~3 ms late.
    assert.ok(errMs > -2 && errMs < 4, `tap ${i} error ${errMs.toFixed(2)} ms`);
  });
});

test('chunk size does not change the result', () => {
  const r = rng(3);
  const events = [0.4, 0.9, 1.5].map((at) => ({ at, sig: tap(SR, TAP_CLASSES.knuckleNear, 0.2, r) }));
  const sig = scene(SR, 2, events, 0.001, r);
  const a = detectAll(sig, 128).found;
  const b = detectAll(sig, 512).found;
  const c = detectAll(sig, 1000).found;
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test('refractory period merges a knock’s ringing but allows fast double-knocks', () => {
  const r = rng(4);
  const close = scene(SR, 1.5, [{ at: 0.5, sig: tap(SR, TAP_CLASSES.knuckleNear, 0.3, r) }, { at: 0.56, sig: tap(SR, TAP_CLASSES.knuckleNear, 0.3, r) }], 0.001, r);
  assert.equal(detectAll(close).found.length, 1);
  const dbl = scene(SR, 1.5, [{ at: 0.5, sig: tap(SR, TAP_CLASSES.knuckleNear, 0.3, r) }, { at: 0.7, sig: tap(SR, TAP_CLASSES.knuckleNear, 0.3, r) }], 0.001, r);
  assert.equal(detectAll(dbl).found.length, 2);
});

test('a slowly rising steady sound is not a tap, and the floor adapts to it', () => {
  const r = rng(5);
  const n = SR * 4;
  const sig = noise(n, 0.001, r);
  // A 300 Hz hum fading in over 1 s from silence to -26 dBFS (like a fan or music starting).
  for (let i = SR; i < n; i++) sig[i] += 0.05 * Math.min(1, (i - SR) / SR) * Math.sin((2 * Math.PI * 300 * i) / SR);
  const { found, det } = detectAll(sig);
  assert.equal(found.length, 0);
  assert.ok(det.floorDb > -40, `floor should have risen, got ${det.floorDb.toFixed(1)}`);
});
