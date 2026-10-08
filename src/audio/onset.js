// Onset (tap) detector — decides *when* a knock happened, not *what* it was.
//
// Idea: a knock is a sudden jump in loudness. We cut the audio into tiny 64-sample
// slices (~1.3 ms) and track two things:
//   - a slow-moving "noise floor": how loud the room is when nobody is tapping;
//   - the energy of the newest slice.
// A tap starts when a slice is
//   (a) far above the noise floor              (kFloorDb, e.g. +12 dB),
//   (b) far above the few milliseconds before  (kRiseDb, e.g. +6 dB) — a *jump*, so a
//       fan or steady music getting louder doesn't count, and
//   (c) above an absolute minimum               (absMinDb), so a silent room doesn't
//       make the detector hypersensitive.
// After a tap we ignore new onsets for a short "refractory" period so one knock's
// ringing can't fire twice, and we pause floor tracking so the knock itself doesn't
// raise the floor.
//
// Pure JS (no browser APIs) so it is unit-tested in Node with synthetic taps.

export const ONSET_DEFAULTS = Object.freeze({
  hop: 64, // samples per slice
  kFloorDb: 12,
  kRiseDb: 6,
  absMinDb: -65,
  refractoryMs: 100,
  holdMs: 150, // floor tracking pauses this long after an onset (covers the knock's decay)
  floorTauMs: 1500, // how fast the floor follows the room (time constant)
  initMs: 150, // first audio used to initialise the floor
  riseFromMs: 20, // the "just before" reference window: from 20 ms ...
  riseToMs: 5, // ... to 5 ms before the current slice
});

const HISTORY = 4096; // slices of energy history kept for the scope display (~5 s)

export class OnsetDetector {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.hop = opts.hop ?? ONSET_DEFAULTS.hop;
    this.history = new Float32Array(HISTORY).fill(-120); // per-slice energy in dB
    this.linHistory = new Float64Array(64); // recent linear energies for the rise test
    this.hopIndex = 0; // number of completed slices
    this.sums = [0, 0];
    this.count = 0;
    this.dc = [{ x1: 0, y1: 0 }, { x1: 0, y1: 0 }];
    this.floorDb = -120;
    this.floorReady = false;
    this.initSum = 0;
    this.refractoryUntil = 0; // slice index
    this.holdUntil = 0; // slice index
    this.lastDb = -120;
    this.set({ ...ONSET_DEFAULTS, ...opts });
  }

  /** Update tunable parameters (from the debug panel). */
  set(opts) {
    this.opts = { ...(this.opts || ONSET_DEFAULTS), ...opts };
    const hopMs = (this.hop / this.sr) * 1000;
    const o = this.opts;
    this.refractoryHops = Math.ceil(o.refractoryMs / hopMs);
    this.holdHops = Math.ceil(Math.max(o.holdMs, o.refractoryMs) / hopMs);
    this.initHops = Math.max(4, Math.ceil(o.initMs / hopMs));
    this.alpha = Math.min(1, hopMs / o.floorTauMs);
    this.riseFrom = Math.max(2, Math.round(o.riseFromMs / hopMs));
    this.riseTo = Math.max(1, Math.round(o.riseToMs / hopMs));
    if (this.riseFrom > this.linHistory.length) this.riseFrom = this.linHistory.length;
  }

  /** Directly set the noise floor, e.g. from a silence calibration. */
  calibrate(floorDb) {
    this.floorDb = floorDb;
    this.floorReady = true;
  }

  get thresholdDb() {
    return Math.max(this.floorDb + this.opts.kFloorDb, this.opts.absMinDb);
  }

  /** Energy (dB) of slice `i` (absolute slice index), for drawing. */
  dbAt(i) {
    if (i < 0 || i < this.hopIndex - HISTORY || i >= this.hopIndex) return -120;
    return this.history[i % HISTORY];
  }

  /**
   * Feed a block of contiguous audio. `channels` is an array of 1–2 Float32Arrays.
   * Returns the absolute sample indices (counted from the first sample ever fed)
   * of any onsets found in this block.
   */
  process(channels) {
    const n = channels[0].length;
    const nch = Math.min(channels.length, 2);
    const R = 0.995; // DC-blocking high-pass: removes mic offset and sub-audible rumble
    const onsets = [];
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nch; c++) {
        const st = this.dc[c];
        const x = channels[c][i];
        const y = x - st.x1 + R * st.y1;
        st.x1 = x;
        st.y1 = y;
        this.sums[c] += y * y;
      }
      if (++this.count === this.hop) {
        const onset = this._endHop(nch);
        if (onset !== null) onsets.push(onset);
        this.sums[0] = 0;
        this.sums[1] = 0;
        this.count = 0;
      }
    }
    return onsets;
  }

  _endHop(nch) {
    // Loudest channel wins: on real two-mic phones a tap near one mic is louder there.
    let e = this.sums[0];
    if (nch > 1 && this.sums[1] > e) e = this.sums[1];
    e /= this.hop;
    const db = 10 * Math.log10(e + 1e-12);
    const h = this.hopIndex++;
    this.lastDb = db;
    this.history[h % HISTORY] = db;

    // Reference level "just before now" (mean linear energy from riseFrom to riseTo slices ago).
    const L = this.linHistory.length;
    let prev = 0;
    let prevCount = 0;
    for (let back = this.riseTo; back <= this.riseFrom; back++) {
      if (h - back < 0) break;
      prev += this.linHistory[(h - back) % L];
      prevCount++;
    }
    const prevDb = prevCount ? 10 * Math.log10(prev / prevCount + 1e-12) : -120;
    this.linHistory[h % L] = e;

    if (!this.floorReady) {
      this.initSum += db;
      if (h + 1 >= this.initHops) {
        this.floorDb = this.initSum / (h + 1);
        this.floorReady = true;
      }
      return null;
    }

    const o = this.opts;
    let onset = null;
    if (h >= this.refractoryUntil && db > this.floorDb + o.kFloorDb && db > o.absMinDb && db > prevDb + o.kRiseDb) {
      onset = h * this.hop; // sample index where this slice starts
      this.refractoryUntil = h + this.refractoryHops;
      this.holdUntil = h + this.holdHops;
    }
    // Track the room's noise floor in the log domain (a geometric mean is robust to
    // spikes), but not while a knock is still ringing.
    if (h >= this.holdUntil) this.floorDb += this.alpha * (db - this.floorDb);
    return onset;
  }
}
