// End-to-end on synthetic audio: chunks → onset detector → ring buffer → tap windows
// → features → k-NN leave-one-out. Proves the plumbing (indices, windowing, wrap-around)
// is right. Real-world accuracy can only be measured on the phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OnsetDetector } from '../src/audio/onset.js';
import { RingBuffer } from '../src/audio/ring.js';
import { extractFeatures, WINDOW, preSamples, dimWeights } from '../src/audio/features.js';
import { leaveOneOut } from '../src/ml/knn.js';
import { rng, tap, scene, chunks, TAP_CLASSES } from './synth.js';

for (const sr of [48000, 44100]) {
  test(`full pipeline classifies 4 synthetic tap classes (${sr} Hz)`, () => {
    const r = rng(42);
    const names = Object.keys(TAP_CLASSES);
    const events = [];
    let t = 0.4;
    for (let i = 0; i < 48; i++) {
      const label = names[i % 4];
      const gain = 0.05 * 10 ** ((r() * 12 - 6) / 20); // ±6 dB force variation
      events.push({ at: t, label, sig: tap(sr, TAP_CLASSES[label], gain, r) });
      t += 0.35 + r() * 0.3;
    }
    const sig = scene(sr, t + 0.5, events, 0.0008, r);

    const det = new OnsetDetector(sr);
    const ring = new RingBuffer(1, 1 << 15); // small ring so the test exercises wrap-around
    const pre = preSamples(sr);
    const pending = [];
    const windows = [];
    for (const block of chunks([sig], 512)) {
      ring.write(block);
      pending.push(...det.process(block));
      while (pending.length && pending[0] - pre + WINDOW <= ring.written) {
        const o = pending.shift();
        windows.push({ onset: o, channels: ring.read(o - pre, WINDOW) });
      }
    }
    assert.equal(windows.length, events.length, 'every tap detected exactly once');

    const X = [];
    const y = [];
    windows.forEach((w, i) => {
      assert.ok(Math.abs(w.onset / sr - events[i].at) < 0.005);
      X.push(extractFeatures(w.channels, sr, { pre }).vec);
      y.push(events[i].label);
    });
    const loo = leaveOneOut(X, y, { k: 3, dimWeights: dimWeights() });
    assert.ok(loo.accuracy >= 0.95, `LOO accuracy ${loo.accuracy}`);
  });
}
