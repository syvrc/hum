// Gesture layer: turns a stream of classified knocks into commands.
//
// Input model (brief §6 "Plan B", chosen after testing on a real table):
//   a command = TAP TYPE (palm / knuckle) × NUMBER OF TAPS (1–3), anywhere on the table.
//   • Knocks less than `gapMs` apart belong to one pattern; a longer pause ends it.
//   • Every knock in a pattern is classified; the confident ones vote on the type, so a
//     triple knock gets three chances to be recognised. Unsure knocks still count.
//   • 4–5 knocks = a deliberate safety gap (ignored, with feedback).
//   • 6+ knocks in ONE continuous burst (urgent drumming, no pause) = SOS — fired on the
//     6th knock, so SOS is never pre-empted by a command from the same burst. (Six knocks
//     ≤ 450 ms apart take < 3 s, matching the brief's "≥ 6 taps within 3 s"; counting
//     only one burst means separate commands done back to back can never add up to SOS.)
//
// Confirm mode ("Hum asks, you answer"):
//   a pattern makes Hum ASK about its phrase; then ONE palm = say it, ONE knuckle =
//   cancel; no answer within 4 s = cancel. Answers that start within 0.4 s of the
//   question are ignored (a tremor bounce can't answer). A new 2–3 tap pattern while
//   asking switches the question.
//
// Note: Hum never makes a sound or vibrates *during* a pattern — the self-hearing guard
// would swallow the next knock. Per-knock feedback is visual only (onCount).
//
// Pure logic with injectable clock/timers so it is unit-tested in Node.

export const RHYTHM_DEFAULTS = Object.freeze({
  confirm: true,
  gapMs: 450, // a pause longer than this ends the pattern
  maxCount: 3, // patterns of 1..maxCount knocks are commands
  sosCount: 6, // this many knocks in one continuous burst = SOS
  sosQuietMs: 1500, // after an SOS, ignore knocks until this much silence
  answerMs: 4000, // the question cancels itself after this long
  answerDelayMs: 400, // answers starting sooner than this after the question are ignored
  latencyMarginMs: 120, // a knock is reported ~60–100 ms after it happens; wait that much longer
  yesType: 'palm',
  noType: 'knuckle',
  minShare: 0.6, // the winning type needs ≥ 60% of the confidence-weighted vote
});

export class RhythmController {
  /**
   * @param {object} opts RHYTHM_DEFAULTS overrides + { now, setTimer, clearTimer }
   * @param {object} on   { count(n, type), command(cmd), ask(cmd), answer(kind, cmd), unsure(reason), tooMany(n), sos() }
   *                      cmd = { type, count }; kind = 'yes' | 'no' | 'timeout'
   */
  constructor(opts = {}, on = {}) {
    this.opts = { ...RHYTHM_DEFAULTS, ...opts };
    this.now = opts.now || (() => performance.now());
    this.setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer || ((t) => clearTimeout(t));
    this.on = on;
    this.burst = null; // { taps: [{type, confidence, t}], firstT, lastT, timer }
    this.asking = null; // { cmd, at, timer }
    this.sosLatch = null; // time of the last knock after an SOS (until things go quiet)
  }

  set(opts) {
    Object.assign(this.opts, opts);
    if (!this.opts.confirm) this.cancelAsk();
  }

  /** @param {{label: string, status: 'pad'|'unsure'|'ignored', confidence?: number, t: number}} ev */
  tap(ev) {
    if (ev.status === 'ignored') return; // "not a command" sounds never take part
    const o = this.opts;
    if (this.sosLatch !== null) {
      if (ev.t - this.sosLatch < o.sosQuietMs) {
        this.sosLatch = ev.t;
        return;
      }
      this.sosLatch = null;
    }
    const knock = { type: ev.status === 'pad' ? ev.label : null, confidence: ev.confidence ?? 1, t: ev.t };
    const b = this.burst;
    if (b && ev.t - b.lastT <= o.gapMs) {
      b.taps.push(knock);
      b.lastT = ev.t;
    } else {
      if (b) this.endBurst();
      this.burst = { taps: [knock], firstT: ev.t, lastT: ev.t, timer: null };
    }
    if (this.burst.taps.length >= o.sosCount) {
      // SOS: any knock types, fired immediately on the 6th knock of the burst.
      this.sosLatch = ev.t;
      this.dropBurst();
      this.cancelAsk(false);
      this.on.sos?.();
      return;
    }
    this.on.count?.(this.burst.taps.length, vote(this.burst.taps, o.minShare));
    this.scheduleEnd();
  }

  scheduleEnd() {
    const b = this.burst;
    if (b.timer) this.clearTimer(b.timer);
    const wait = Math.max(0, b.lastT + this.opts.gapMs + this.opts.latencyMarginMs - this.now());
    b.timer = this.setTimer(() => this.endBurst(), wait);
  }

  dropBurst() {
    if (this.burst?.timer) this.clearTimer(this.burst.timer);
    this.burst = null;
  }

  endBurst() {
    const b = this.burst;
    if (!b) return;
    this.dropBurst();
    const o = this.opts;
    const n = b.taps.length;
    if (n > o.maxCount) return this.on.tooMany?.(n);
    const type = vote(b.taps, o.minShare);
    if (!type) return this.on.unsure?.(b.taps.some((t) => t.type) ? 'mixed' : 'unclear');
    const cmd = { type, count: n };
    if (!o.confirm) return this.on.command?.(cmd);
    if (this.asking) {
      if (b.firstT - this.asking.at < o.answerDelayMs) return; // too soon: a bounce, not an answer
      if (n === 1 && (type === o.yesType || type === o.noType)) {
        const asked = this.asking.cmd;
        this.cancelAsk(false);
        return this.on.answer?.(type === o.yesType ? 'yes' : 'no', asked);
      }
    }
    this.ask(cmd);
  }

  ask(cmd) {
    if (this.asking?.timer) this.clearTimer(this.asking.timer);
    this.asking = { cmd, at: this.now(), timer: null };
    this.asking.timer = this.setTimer(() => {
      const asked = this.asking?.cmd;
      this.asking = null;
      if (asked) this.on.answer?.('timeout', asked);
    }, this.opts.answerMs);
    this.on.ask?.(cmd);
  }

  cancelAsk(notify = true) {
    if (!this.asking) return;
    if (this.asking.timer) this.clearTimer(this.asking.timer);
    const asked = this.asking.cmd;
    this.asking = null;
    if (notify) this.on.answer?.('no', asked);
  }

  dispose() {
    this.dropBurst();
    this.cancelAsk(false);
  }
}

/** Confidence-weighted majority type, or null if no type wins clearly. */
export function vote(taps, minShare = 0.6) {
  const w = {};
  let total = 0;
  for (const t of taps) {
    if (!t.type) continue;
    w[t.type] = (w[t.type] || 0) + Math.max(0.05, t.confidence);
    total += Math.max(0.05, t.confidence);
  }
  if (!total) return null;
  const [best, bw] = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
  return bw / total >= minShare ? best : null;
}
