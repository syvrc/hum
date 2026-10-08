// Small wrappers around phone hardware APIs: screen wake lock and the accelerometer.

import { log } from './ui/log.js';

// --- Screen Wake Lock -------------------------------------------------------------
// Web apps can't listen with the screen off, so we ask the phone to keep it on.
// The lock is dropped whenever the tab is hidden; we re-acquire it when it's visible again.
let wantWake = false;
let sentinel = null;

export async function keepScreenOn() {
  wantWake = true;
  if (!('wakeLock' in navigator)) {
    log('wake lock not supported — keep the screen on manually');
    return false;
  }
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => log('wake lock released'));
    log('wake lock on');
    return true;
  } catch (e) {
    log('wake lock failed:', e.message);
    return false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantWake && (!sentinel || sentinel.released)) keepScreenOn();
});

// --- Accelerometer ----------------------------------------------------------------
// Records recent motion so each tap can carry the phone's acceleration around that
// moment. Used only as a *candidate* feature (weight 0) until data shows it helps.
export class Motion {
  constructor() {
    this.samples = []; // { t, x, y, z } with gravity removed
    this.available = false;
    this.onMotion = (e) => {
      const a = e.acceleration;
      if (!a || a.x === null) return;
      this.available = true;
      this.samples.push({ t: e.timeStamp, x: a.x, y: a.y, z: a.z });
      if (this.samples.length > 400) this.samples.splice(0, 100);
    };
  }

  start() {
    window.addEventListener('devicemotion', this.onMotion);
  }

  /** Strongest acceleration in [t-20 ms, t+80 ms] as [x, y, z] (m/s²), or null. */
  peakNear(t) {
    let best = null;
    let bestMag = -1;
    for (const s of this.samples) {
      if (s.t < t - 20 || s.t > t + 80) continue;
      const mag = s.x * s.x + s.y * s.y + s.z * s.z;
      if (mag > bestMag) {
        bestMag = mag;
        best = [s.x, s.y, s.z];
      }
    }
    return best;
  }
}
