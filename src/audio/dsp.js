// Small, dependency-free DSP toolkit: FFT, windows, mel filterbank, DCT.
//
// Why write this instead of using a feature library (e.g. Meyda)?
// - It is ~150 lines we can explain line by line to judges.
// - Tap classification needs a few non-standard choices (an asymmetric window that
//   keeps the attack of the knock, sub-frames aligned to the onset, two-channel
//   cross-correlation) that general-purpose libraries don't expose.
// Everything here is pure math on arrays, so it runs (and is unit-tested) in Node too.

const fftTablesCache = new Map();

function fftTables(n) {
  let tables = fftTablesCache.get(n);
  if (tables) return tables;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  tables = { rev, cos, sin };
  fftTablesCache.set(n, tables);
  return tables;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT.
 * Turns a slice of sound (time domain) into "how much of each frequency" (frequency domain).
 * @param {Float64Array} re real parts (length = power of two)
 * @param {Float64Array} im imaginary parts (same length)
 */
export function fft(re, im) {
  const n = re.length;
  const { rev, cos, sin } = fftTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Inverse FFT (in place), using the conjugate trick so we reuse the forward FFT. */
export function ifft(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

/**
 * Complex spectrum of `signal[offset .. offset+window.length)` multiplied by `window`.
 * Samples outside the signal count as zero.
 */
export function spectrum(signal, window, offset = 0) {
  const n = window.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = offset + i;
    re[i] = j >= 0 && j < signal.length ? signal[j] * window[i] : 0;
  }
  fft(re, im);
  return { re, im };
}

/** |X[k]|² for k = 0 .. n/2 (the non-redundant half of a real signal's spectrum). */
export function power({ re, im }) {
  const half = re.length / 2;
  const p = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

/** Periodic Hann window: the standard bell-shaped taper for short-time spectra. */
export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Window for a whole tap: a short fade-in that finishes *before* the knock starts,
 * flat through the knock, and a fade-out over the last quarter.
 * Why not Hann? A Hann window is near zero at the edges — it would erase the sharp
 * attack at the start of the window, which is exactly the part that tells taps apart.
 */
export function tapWindow(n, onsetIndex) {
  const w = new Float64Array(n).fill(1);
  const rise = Math.max(8, Math.min(onsetIndex - 32, n / 4) | 0);
  for (let i = 0; i < rise; i++) w[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / rise);
  const fall = (n / 4) | 0;
  for (let i = 0; i < fall; i++) w[n - 1 - i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / fall);
  return w;
}

export const hzToMel = (f) => 2595 * Math.log10(1 + f / 700);
export const melToHz = (m) => 700 * (10 ** (m / 2595) - 1);

/**
 * Triangular mel filterbank, stored sparsely as rows of { start, w } over FFT bins 0..nfft/2.
 * Mel spacing mimics the ear: narrow bands at low frequencies, wide bands at high ones.
 * Each filter is normalised to unit area, so a band's value is its *average* power.
 */
export function melFilterbank(nfft, sampleRate, nMels, fMin, fMax) {
  const nBins = nfft / 2 + 1;
  const binHz = sampleRate / nfft;
  const mMin = hzToMel(fMin);
  const mMax = hzToMel(fMax);
  const edges = [];
  for (let i = 0; i < nMels + 2; i++) edges.push(melToHz(mMin + ((mMax - mMin) * i) / (nMels + 1)));
  const filters = [];
  for (let m = 0; m < nMels; m++) {
    const lo = edges[m];
    const centre = edges[m + 1];
    const hi = edges[m + 2];
    const start = Math.max(0, Math.floor(lo / binHz));
    const end = Math.min(nBins - 1, Math.ceil(hi / binHz));
    const w = new Float64Array(end - start + 1);
    let sum = 0;
    for (let k = start; k <= end; k++) {
      const f = k * binHz;
      const v = f <= centre ? (f - lo) / (centre - lo) : (hi - f) / (hi - centre);
      w[k - start] = Math.max(0, v);
      sum += w[k - start];
    }
    if (sum === 0) {
      // Filter narrower than one FFT bin (happens at low frequencies): use the nearest bin.
      filters.push({ start: Math.min(nBins - 1, Math.round(centre / binHz)), w: Float64Array.of(1) });
      continue;
    }
    for (let i = 0; i < w.length; i++) w[i] /= sum;
    filters.push({ start, w });
  }
  return filters;
}

/** Applies a sparse filterbank to a power spectrum. Returns one value per filter. */
export function applyFilterbank(powerSpec, filters) {
  const out = new Float64Array(filters.length);
  for (let m = 0; m < filters.length; m++) {
    const { start, w } = filters[m];
    let s = 0;
    for (let i = 0; i < w.length; i++) s += w[i] * powerSpec[start + i];
    out[m] = s;
  }
  return out;
}

const dctCache = new Map();

/**
 * Orthonormal DCT-II, keeping the first `nOut` coefficients.
 * Applied to log-mel energies this gives MFCCs: a compact summary of spectral *shape*.
 */
export function dct(input, nOut) {
  const n = input.length;
  const key = `${n}:${nOut}`;
  let table = dctCache.get(key);
  if (!table) {
    table = new Float64Array(n * nOut);
    for (let k = 0; k < nOut; k++) {
      const scale = k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
      for (let i = 0; i < n; i++) table[k * n + i] = scale * Math.cos((Math.PI / n) * (i + 0.5) * k);
    }
    dctCache.set(key, table);
  }
  const out = new Float64Array(nOut);
  for (let k = 0; k < nOut; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += table[k * n + i] * input[i];
    out[k] = s;
  }
  return out;
}

export const toDb = (energy) => 10 * Math.log10(energy + 1e-12);
