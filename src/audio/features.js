// Feature extraction — turns one ~45 ms tap recording into a list of numbers
// ("a fingerprint") that the classifier can compare.
//
// What makes taps different?
//   Tap TYPE  (palm / knuckle / nail / fist): how bright or dull it sounds, how sharp
//             the attack is, how long it rings → spectral shape + envelope features.
//   LOCATION  (left / right / near / far): the table filters the sound differently on
//             its way from each spot to the phone (high frequencies fade with distance,
//             the table's own resonances depend on where you hit it) → spectral shape;
//             and on phones that really expose two microphones, the level and arrival-
//             time difference between them → stereo features.
// Raw loudness is kept only as one low-weight number: people never tap equally hard.
//
// Pure JS (no browser APIs) so the whole pipeline is unit-tested in Node.

import { spectrum, power, hann, tapWindow, melFilterbank, applyFilterbank, dct, ifft, toDb } from './dsp.js';

export const FEATURE_VERSION = 1; // bump whenever the vector layout or maths changes
export const WINDOW = 2048; // samples per tap (~43 ms at 48 kHz, ~46 ms at 44.1 kHz)
export const PRE_MS = 5; // how much audio *before* the detected onset we keep

const N_MELS = 32;
const N_MFCC = 13;
const SUB = 512; // sub-frame length for MFCCs
const N_SUB = 3;
const N_ILD = 8;

// Feature groups and how much say each group gets in the distance calculation.
// Inside the classifier each group is scaled by weight / sqrt(size), so a group of 32
// numbers doesn't automatically outvote a group of 2. "accel" starts at 0: it is
// recorded so we can *measure* whether it helps before trusting it.
export const GROUPS = [
  { name: 'mel', size: N_MELS, weight: 1 },
  { name: 'mfcc', size: N_MFCC, weight: 1 },
  { name: 'spectral', size: 4, weight: 1 },
  { name: 'envelope', size: 3, weight: 0.7 },
  { name: 'level', size: 1, weight: 0.3 },
  { name: 'stereo', size: N_ILD + 1, weight: 1 },
  { name: 'accel', size: 3, weight: 0 },
];

export const FEATURE_NAMES = [
  ...Array.from({ length: N_MELS }, (_, i) => `mel${i}`),
  ...Array.from({ length: N_MFCC }, (_, i) => `mfcc${i + 1}`),
  'centroid_log2Hz', 'rolloff85_log2Hz', 'flatness_dB', 'zcr_perMs',
  'attack_ms', 'decay_dBperMs', 'tcentroid_ms',
  'peak_dBFS',
  ...Array.from({ length: N_ILD }, (_, i) => `ild${i}_dB`), 'gcc_delay_ms',
  'accel_x', 'accel_y', 'accel_z',
];

export const FEATURE_DIM = GROUPS.reduce((s, g) => s + g.size, 0);

/** Per-dimension weights for the classifier (group weight / sqrt(group size)). */
export function dimWeights(groupWeights = {}) {
  const w = new Float64Array(FEATURE_DIM);
  let i = 0;
  for (const g of GROUPS) {
    const gw = groupWeights[g.name] ?? g.weight;
    for (let j = 0; j < g.size; j++) w[i++] = gw / Math.sqrt(g.size);
  }
  return w;
}

export const preSamples = (sr) => Math.round((PRE_MS * sr) / 1000);

const cache = new Map();
function setup(sr, n, pre) {
  const key = `${sr}:${n}:${pre}`;
  let s = cache.get(key);
  if (!s) {
    const fMax = Math.min(16000, sr * 0.47);
    s = {
      fMax,
      tapWin: tapWindow(n, pre),
      melFull: melFilterbank(n, sr, N_MELS, 60, fMax),
      subWin: hann(SUB),
      melSub: melFilterbank(SUB, sr, 26, 100, fMax),
      ildEdges: Array.from({ length: N_ILD + 1 }, (_, i) => 100 * (fMax / 100) ** (i / N_ILD)),
    };
    cache.set(key, s);
  }
  return s;
}

/**
 * @param {Float32Array[]} channels 1 or 2 channels, each WINDOW samples, onset at `pre`
 * @param {number} sr sample rate
 * @param {{pre?: number, accel?: number[]|null}} opts
 * @returns {{vec: Float64Array, info: object}}
 */
export function extractFeatures(channels, sr, opts = {}) {
  const n = channels[0].length;
  const pre = opts.pre ?? preSamples(sr);
  const S = setup(sr, n, pre);
  const binHz = sr / n;

  // 1) Remove DC offset (estimated from the quiet pre-roll) and mix to mono.
  const chans = channels.slice(0, 2).map((ch) => {
    const m = mean(ch, 0, Math.max(16, pre - 32));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = ch[i] - m;
    return out;
  });
  let mono = chans[0];
  if (chans.length === 2) {
    mono = new Float64Array(n);
    for (let i = 0; i < n; i++) mono[i] = 0.5 * (chans[0][i] + chans[1][i]);
  }

  // 2) Peak, and a loudness-independent onset: the first sample reaching 15% of the peak.
  //    Aligning on this (instead of the detector's coarse slice) makes soft and hard taps
  //    line up the same way in the sub-frames below.
  const searchFrom = Math.max(0, pre - 96);
  let peak = 0;
  let peakIdx = pre;
  for (let i = searchFrom; i < n; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) { peak = a; peakIdx = i; }
  }
  let onset = pre;
  for (let i = searchFrom; i <= peakIdx; i++) {
    if (Math.abs(mono[i]) >= 0.15 * peak) { onset = i; break; }
  }
  const peakDb = 20 * Math.log10(peak + 1e-9);
  // Clipping check (diagnostic only): a knock right next to the phone can overload the mic.
  let clipped = 0;
  for (const ch of channels) for (let i = 0; i < n; i++) if (Math.abs(ch[i]) >= 0.99) clipped++;

  // 3) Envelope: attack time, decay slope, and "temporal centroid" (where the energy sits in time).
  const B = 32;
  const nb = Math.floor((n - onset) / B);
  const env = new Float64Array(nb);
  let eTot = 0;
  let eT = 0;
  for (let j = 0; j < nb; j++) {
    let s = 0;
    for (let i = onset + j * B; i < onset + (j + 1) * B; i++) s += mono[i] * mono[i];
    env[j] = toDb(s / B);
    eTot += s;
    eT += s * (j + 0.5);
  }
  const blockMs = (B / sr) * 1000;
  const attackMs = ((peakIdx - onset) / sr) * 1000;
  const tcentroidMs = eTot > 0 ? (eT / eTot) * blockMs : 0;
  let pk = 0;
  for (let j = 1; j < nb; j++) if (env[j] > env[pk]) pk = j;
  const decayEnd = Math.min(nb - 1, pk + Math.round(30 / blockMs));
  const decaySlope = slope(env, pk, decayEnd) / blockMs; // dB per ms (negative = decaying)

  // 4) Whole-tap spectrum → 32 log-mel bands, with the overall level subtracted so only
  //    the *shape* of the spectrum remains.
  const P = power(spectrum(mono, S.tapWin));
  const logMel = Array.from(applyFilterbank(P, S.melFull), toDb);
  const melMean = logMel.reduce((a, b) => a + b, 0) / N_MELS;
  const melShape = logMel.map((v) => v - melMean);

  // 5) Spectral summary numbers (ignoring < 50 Hz rumble).
  const k0 = Math.ceil(50 / binHz);
  const kMax = Math.floor(S.fMax / binHz);
  let sumP = 0;
  let sumFP = 0;
  let sumLog = 0;
  for (let k = k0; k <= kMax; k++) {
    sumP += P[k];
    sumFP += P[k] * k * binHz;
    sumLog += Math.log(P[k] + 1e-20);
  }
  const nk = kMax - k0 + 1;
  const centroid = sumP > 0 ? sumFP / sumP : 0;
  let cum = 0;
  let rolloff = S.fMax;
  for (let k = k0; k <= kMax; k++) {
    cum += P[k];
    if (cum >= 0.85 * sumP) { rolloff = k * binHz; break; }
  }
  const flatnessDb = sumP > 0 ? 10 * Math.log10(Math.exp(sumLog / nk) / (sumP / nk) + 1e-12) : 0;
  const zEnd = Math.min(n, onset + Math.round(0.02 * sr));
  let zc = 0;
  for (let i = onset + 1; i < zEnd; i++) if ((mono[i - 1] < 0) !== (mono[i] < 0)) zc++;
  const zcrPerMs = zc / (((zEnd - onset) / sr) * 1000 || 1);

  // 6) MFCCs from three 512-sample sub-frames starting just before the onset, averaged.
  const mfcc = new Float64Array(N_MFCC);
  for (let f = 0; f < N_SUB; f++) {
    const start = Math.min(n - SUB, Math.max(0, onset - 128 + f * SUB));
    const p = power(spectrum(mono, S.subWin, start));
    const lm = Array.from(applyFilterbank(p, S.melSub), toDb);
    const c = dct(lm, N_MFCC + 1); // c[0] is overall loudness — dropped on purpose
    for (let i = 0; i < N_MFCC; i++) mfcc[i] += c[i + 1] / N_SUB;
  }

  // 7) Stereo: only if the phone really gives us two *different* microphones.
  //    Many phones just copy one mic into both channels — detect that honestly.
  const stereo = new Float64Array(N_ILD + 1);
  let stereoReal = false;
  let delayMs = 0;
  if (chans.length === 2) {
    const [a, b] = chans;
    let d2 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const d = a[i] - b[i];
      const s = 0.5 * (a[i] + b[i]);
      d2 += d * d;
      s2 += s * s;
    }
    stereoReal = s2 > 0 && Math.sqrt(d2 / s2) > 0.02; // channels differ by more than ~-34 dB
    if (stereoReal) {
      const A = spectrum(a, S.tapWin);
      const Bs = spectrum(b, S.tapWin);
      const PA = power(A);
      const PB = power(Bs);
      // Inter-channel level difference per band (which mic is closer to the knock).
      for (let band = 0; band < N_ILD; band++) {
        const lo = Math.max(1, Math.floor(S.ildEdges[band] / binHz));
        const hi = Math.max(lo, Math.floor(S.ildEdges[band + 1] / binHz));
        let ea = 0;
        let eb = 0;
        for (let k = lo; k <= hi; k++) { ea += PA[k]; eb += PB[k]; }
        stereo[band] = toDb(ea) - toDb(eb);
      }
      delayMs = gccPhatDelay(A, Bs, PA, PB, sr);
      stereo[N_ILD] = delayMs;
    }
  }

  const accel = opts.accel && opts.accel.length === 3 ? opts.accel : [0, 0, 0];

  const vec = Float64Array.from([
    ...melShape,
    ...mfcc,
    Math.log2(Math.max(centroid, 1)), Math.log2(Math.max(rolloff, 1)), flatnessDb, zcrPerMs,
    attackMs, decaySlope, tcentroidMs,
    peakDb,
    ...stereo,
    ...accel,
  ]);
  return {
    vec,
    info: {
      peakDb,
      onsetShift: onset - pre,
      attackMs,
      decaySlope,
      centroidHz: centroid,
      rolloffHz: rolloff,
      flatnessDb,
      stereoReal,
      delayMs,
      clipped,
      channels: chans.length,
    },
  };
}

/**
 * GCC-PHAT: the time delay between two microphones, from the phase of their
 * cross-spectrum. "PHAT" keeps only phase, which makes the peak sharp even for
 * a ringing table. Returns the delay in ms (positive = channel 1 heard it first).
 */
function gccPhatDelay(A, B, PA, PB, sr) {
  const n = A.re.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let maxMag = 0;
  for (let k = 0; k <= n / 2; k++) maxMag = Math.max(maxMag, Math.sqrt(PA[k] * PB[k]));
  const binHz = sr / n;
  const kLo = Math.ceil(100 / binHz);
  const kHi = Math.floor(8000 / binHz);
  for (let k = kLo; k <= Math.min(kHi, n / 2); k++) {
    // Cross-spectrum A·conj(B), normalised to unit magnitude; skip near-silent bins.
    const cr = A.re[k] * B.re[k] + A.im[k] * B.im[k];
    const ci = A.im[k] * B.re[k] - A.re[k] * B.im[k];
    const mag = Math.hypot(cr, ci);
    if (mag < 1e-4 * maxMag || mag === 0) continue;
    re[k] = cr / mag;
    im[k] = ci / mag;
    if (k > 0 && k < n / 2) { re[n - k] = re[k]; im[n - k] = -im[k]; }
  }
  ifft(re, im);
  const maxLag = Math.round(0.001 * sr); // phone mics are < 20 cm apart → < ~0.6 ms in air
  let best = 0;
  let bestV = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const v = re[(lag + n) % n];
    if (v > bestV) { bestV = v; best = lag; }
  }
  // Parabolic interpolation for sub-sample precision.
  const y0 = re[(best - 1 + n) % n];
  const y2 = re[(best + 1 + n) % n];
  const denom = y0 - 2 * bestV + y2;
  const frac = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  // IFFT(A·conj(B))[lag] = Σ a[t+lag]·b[t]: a positive lag means channel 0 lags, i.e. channel 1 heard it first.
  return ((best + Math.max(-0.5, Math.min(0.5, frac))) / sr) * 1000;
}

function mean(arr, from, to) {
  let s = 0;
  const end = Math.min(arr.length, to);
  for (let i = from; i < end; i++) s += arr[i];
  return end > from ? s / (end - from) : 0;
}

/** Least-squares slope of y[from..to] against index. */
function slope(y, from, to) {
  const m = to - from + 1;
  if (m < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = from; i <= to; i++) {
    const x = i - from;
    sx += x; sy += y[i]; sxx += x * x; sxy += x * y[i];
  }
  const d = m * sxx - sx * sx;
  return d !== 0 ? (m * sxy - sx * sy) / d : 0;
}
