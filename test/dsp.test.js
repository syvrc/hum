import test from 'node:test';
import assert from 'node:assert/strict';
import { fft, ifft, spectrum, power, hann, melFilterbank, applyFilterbank, dct } from '../src/audio/dsp.js';
import { RingBuffer } from '../src/audio/ring.js';

test('FFT puts a sinusoid in the right bin and round-trips through IFFT', () => {
  const n = 256;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 10 * i) / n);
  const orig = Float64Array.from(re);
  fft(re, im);
  const mag = Array.from(re, (r, k) => Math.hypot(r, im[k]));
  const top = mag.slice(0, n / 2).indexOf(Math.max(...mag.slice(0, n / 2)));
  assert.equal(top, 10);
  assert.ok(Math.abs(mag[10] - n / 2) < 1e-9);
  ifft(re, im);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(re[i] - orig[i]) < 1e-9);
});

test("FFT satisfies Parseval's theorem", () => {
  const n = 512;
  const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.91));
  const ones = new Float64Array(n).fill(1);
  const { re, im } = spectrum(x, ones);
  let et = 0;
  let ef = 0;
  for (let i = 0; i < n; i++) { et += x[i] * x[i]; ef += re[i] * re[i] + im[i] * im[i]; }
  assert.ok(Math.abs(et - ef / n) < 1e-6);
  assert.equal(power({ re, im }).length, n / 2 + 1);
});

test('mel filterbank: every band has weight, centres increase', () => {
  for (const [nfft, sr] of [[2048, 48000], [512, 44100]]) {
    const fb = melFilterbank(nfft, sr, 32, 60, 16000);
    assert.equal(fb.length, 32);
    let lastCentre = -1;
    for (const f of fb) {
      const sum = f.w.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9);
      const centre = f.start + f.w.indexOf(Math.max(...f.w));
      assert.ok(centre >= lastCentre);
      lastCentre = centre;
    }
    const flat = new Float64Array(nfft / 2 + 1).fill(2);
    for (const v of applyFilterbank(flat, fb)) assert.ok(Math.abs(v - 2) < 1e-9);
  }
});

test('DCT of a constant has only a DC term', () => {
  const c = dct(new Float64Array(26).fill(3), 14);
  assert.ok(Math.abs(c[0] - 3 * Math.sqrt(26)) < 1e-9);
  for (let k = 1; k < 14; k++) assert.ok(Math.abs(c[k]) < 1e-9);
});

test('hann window is zero at the start and one in the middle', () => {
  const w = hann(512);
  assert.equal(w[0], 0);
  assert.ok(Math.abs(w[256] - 1) < 1e-12);
});

test('ring buffer reads back across the wrap point', () => {
  const rb = new RingBuffer(2, 16);
  let v = 0;
  for (let b = 0; b < 5; b++) {
    const a = Float32Array.from({ length: 5 }, () => v++);
    rb.write([a, a.map((x) => -x)]);
  }
  assert.equal(rb.written, 25);
  const [c0, c1] = rb.read(12, 10);
  assert.deepEqual(Array.from(c0), [12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  assert.deepEqual(Array.from(c1), [-12, -13, -14, -15, -16, -17, -18, -19, -20, -21]);
  assert.throws(() => rb.read(5, 4)); // already overwritten
  assert.throws(() => rb.read(20, 10)); // not written yet
  // A mono block written to a 2-channel ring is duplicated.
  rb.write([Float32Array.of(99)]);
  assert.deepEqual(rb.read(25, 1).map((c) => c[0]), [99, 99]);
});
