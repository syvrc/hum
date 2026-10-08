// Synthetic audio for unit tests ONLY (never used by the app).
// A "tap" here is a few exponentially decaying resonances plus a short click —
// a crude physical model of a knock on a plate. Good enough to check that the
// detector, ring buffer, features and classifier are wired correctly.

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function noise(n, rms, rand) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rms * gauss(rand);
  return out;
}

/**
 * @param {number} sr
 * @param {{modes: {f:number, amp:number, decayMs:number}[], clickAmp?: number, clickMs?: number, attackMs?: number}} spec
 * @param {number} gain overall amplitude
 * @param {() => number} rand
 */
export function tap(sr, spec, gain, rand) {
  const n = Math.round(0.12 * sr);
  const out = new Float32Array(n);
  const attack = Math.max(1, Math.round(((spec.attackMs ?? 0.3) / 1000) * sr));
  for (const m of spec.modes) {
    const phase = rand() * 2 * Math.PI;
    const f = m.f * (1 + 0.01 * gauss(rand)); // small natural variation between knocks
    const tau = (m.decayMs / 1000) * sr;
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / attack) * Math.exp(-i / tau);
      out[i] += m.amp * env * Math.sin((2 * Math.PI * f * i) / sr + phase);
    }
  }
  const clickN = Math.round(((spec.clickMs ?? 0.5) / 1000) * sr);
  for (let i = 0; i < clickN; i++) out[i] += (spec.clickAmp ?? 0) * gauss(rand) * (1 - i / clickN);
  for (let i = 0; i < n; i++) out[i] *= gain;
  return out;
}

/** Mix signals into a noisy recording. events: [{at: seconds, sig: Float32Array}] */
export function scene(sr, seconds, events, noiseRms, rand) {
  const out = noise(Math.round(seconds * sr), noiseRms, rand);
  for (const { at, sig } of events) {
    const start = Math.round(at * sr);
    for (let i = 0; i < sig.length && start + i < out.length; i++) out[start + i] += sig[i];
  }
  return out;
}

/** Feed a long signal to a callback in fixed-size chunks, like the AudioWorklet does. */
export function* chunks(channels, size) {
  for (let i = 0; i < channels[0].length; i += size) yield channels.map((c) => c.subarray(i, Math.min(c.length, i + size)));
}

// Four tap "classes" loosely mimicking palm vs knuckle and near vs far
// (far = high frequencies more damped). Only for tests.
export const TAP_CLASSES = {
  palmLeft: { modes: [{ f: 180, amp: 1, decayMs: 12 }, { f: 420, amp: 0.5, decayMs: 8 }, { f: 1100, amp: 0.12, decayMs: 4 }], attackMs: 2, clickAmp: 0.02 },
  palmRight: { modes: [{ f: 240, amp: 1, decayMs: 12 }, { f: 610, amp: 0.45, decayMs: 8 }, { f: 1500, amp: 0.15, decayMs: 4 }], attackMs: 2, clickAmp: 0.02 },
  knuckleNear: { modes: [{ f: 900, amp: 0.7, decayMs: 6 }, { f: 2600, amp: 0.6, decayMs: 4 }, { f: 5200, amp: 0.4, decayMs: 2 }], attackMs: 0.2, clickAmp: 0.4 },
  knuckleFar: { modes: [{ f: 750, amp: 0.8, decayMs: 7 }, { f: 2100, amp: 0.35, decayMs: 4 }, { f: 4300, amp: 0.1, decayMs: 2 }], attackMs: 0.3, clickAmp: 0.15 },
};
