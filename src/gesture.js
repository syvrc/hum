// Gesture layer for the Access Pad: turns a stream of classified knocks into actions.
//
// Confirm mode (default ON, brief §3.3):
//   • a knock on a pad PREVIEWS its phrase (big tile + chime + buzz);
//   • a DOUBLE-KNOCK (two knocks ≤ 350 ms apart) ANYWHERE on the table confirms and
//     SPEAKS the previewed phrase. "Anywhere" is deliberate: the preview already chose
//     the pad, and a double-knock then only needs the onset detector's timing, not a
//     second correct classification — fewer chances to be wrong;
//   • the preview cancels itself after 4 s.
// Confirm OFF: a knock on a pad speaks immediately.
//
// Waiting rule: a single knock only waits to see whether a second one follows when a
// double-knock could mean something — i.e. while a preview is showing. From idle, the
// first knock previews instantly, and extra knocks in the same burst are ignored (so a
// tremor "bounce" can't confirm by accident).
//
// Pure logic with injectable clock/timers so it is unit-tested in Node.

export const GESTURE_DEFAULTS = Object.freeze({
  confirm: true,
  gapMs: 350, // max gap between the two knocks of a double-knock
  previewMs: 4000, // preview cancels itself after this long
  latencyMarginMs: 120, // a knock is reported ~60–100 ms after it happens; wait that much longer
});

export class AccessController {
  /**
   * @param {object} opts GESTURE_DEFAULTS overrides + { now, setTimer, clearTimer }
   * @param {object} on   { preview(padId), clearPreview(), speak(padId), unsure(status) }
   */
  constructor(opts = {}, on = {}) {
    this.opts = { ...GESTURE_DEFAULTS, ...opts };
    this.now = opts.now || (() => performance.now());
    this.setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer || ((t) => clearTimeout(t));
    this.on = on;
    this.preview = null; // padId being previewed
    this.previewTimer = null;
    this.burst = null; // { taps, lastT, previewAtStart, timer }
  }

  set(opts) {
    Object.assign(this.opts, opts);
    if (!this.opts.confirm) this.cancelPreview();
  }

  /**
   * One classified knock.
   * @param {{label: string, status: 'pad'|'unsure'|'ignored', t: number}} ev  t = onset time (ms, same clock as now())
   */
  tap(ev) {
    if (ev.status === 'ignored') return; // "not a command" sounds never take part in gestures
    if (!this.opts.confirm) {
      if (ev.status === 'pad') this.on.speak?.(ev.label);
      else this.on.unsure?.(ev.status);
      return;
    }
    const b = this.burst;
    if (b && ev.t - b.lastT <= this.opts.gapMs) {
      b.taps.push(ev);
      b.lastT = ev.t;
      this.scheduleBurstEnd();
      return;
    }
    if (b) this.endBurst(); // previous burst's timer hasn't fired yet but this knock is clearly separate
    this.burst = { taps: [ev], lastT: ev.t, previewAtStart: this.preview, timer: null };
    if (!this.burst.previewAtStart) {
      // Nothing to confirm, so no reason to wait: preview right away.
      if (ev.status === 'pad') this.setPreview(ev.label);
      else this.on.unsure?.(ev.status);
    }
    this.scheduleBurstEnd();
  }

  scheduleBurstEnd() {
    const b = this.burst;
    if (b.timer) this.clearTimer(b.timer);
    const wait = Math.max(0, b.lastT + this.opts.gapMs + this.opts.latencyMarginMs - this.now());
    b.timer = this.setTimer(() => this.endBurst(), wait);
  }

  endBurst() {
    const b = this.burst;
    if (!b) return;
    if (b.timer) this.clearTimer(b.timer);
    this.burst = null;
    if (!b.previewAtStart) return; // started from idle: first knock already previewed; extras ignored
    if (b.taps.length >= 2) {
      const padId = b.previewAtStart;
      this.cancelPreview();
      this.on.speak?.(padId);
      return;
    }
    const ev = b.taps[0];
    if (ev.status === 'pad') this.setPreview(ev.label); // switch (or refresh) the preview
    else this.on.unsure?.(ev.status);
  }

  setPreview(padId) {
    if (this.previewTimer) this.clearTimer(this.previewTimer);
    this.preview = padId;
    this.previewTimer = this.setTimer(() => this.cancelPreview(), this.opts.previewMs);
    this.on.preview?.(padId);
  }

  cancelPreview() {
    if (this.previewTimer) this.clearTimer(this.previewTimer);
    this.previewTimer = null;
    if (this.preview !== null) {
      this.preview = null;
      this.on.clearPreview?.();
    }
  }

  dispose() {
    this.cancelPreview();
    if (this.burst?.timer) this.clearTimer(this.burst.timer);
    this.burst = null;
  }
}
