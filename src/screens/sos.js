// SOS (brief §3.3): fast drumming (6+ knocks without a pause) →
//   3-second countdown with loud beeps and a huge CANCEL (touching the screen cancels) →
//   phone siren + full-screen red/black flashing at 1 flash per second (well under the
//   WCAG limit of 3 per second) + vibration + an SOS message to the Companion.
// The phone-side alarm works offline; the Companion alert needs a connection (the
// message waits in the link's outbox until the Companion is reachable).

import { app, go, bus } from '../app.js';
import { beep, siren, buzz } from '../voice.js';
import { sendToCompanion, cancelSos, phoneLink } from '../phoneLink.js';
import { $ } from '../ui/dom.js';
import { log } from '../ui/log.js';

const COUNTDOWN_S = 3;

export const sos = {
  instrument: false,

  mount(el) {
    this.el = el;
    this.state = 'countdown';
    this.left = COUNTDOWN_S;
    this.onAck = () => this.acknowledged();
    bus.addEventListener('ack', this.onAck);
    document.body.classList.add('sos-active');
    this.render();
    beep(app.engine.ctx);
    this.timer = setInterval(() => {
      this.left--;
      if (this.left > 0) {
        beep(app.engine.ctx);
        this.render();
      } else {
        clearInterval(this.timer);
        this.alarm();
      }
    }, 1000);
    log('SOS pattern detected — countdown');
  },

  unmount() {
    clearInterval(this.timer);
    clearInterval(this.vibeTimer);
    this.siren?.stop();
    if (navigator.vibrate) navigator.vibrate(0);
    bus.removeEventListener('ack', this.onAck);
    document.body.classList.remove('sos-active');
  },

  render() {
    const linked = phoneLink.status === 'connected';
    let body;
    if (this.state === 'countdown') {
      body = `
        <div class="sos-title">SOS</div>
        <p class="sos-text">Calling for help in</p>
        <div class="sos-count mono">${this.left}</div>
        <button class="btn big sos-cancel" data-act="cancel">CANCEL</button>
        <p class="sos-small">Touch anywhere to cancel.</p>`;
    } else if (this.state === 'alarm') {
      body = `
        <div class="sos-title">SOS</div>
        <p class="sos-text">Help needed!</p>
        <p class="sos-small">${linked ? 'Alert sent to the Companion.' : phoneLink.code ? 'Companion not reachable — the alert will be sent as soon as it is.' : 'No Companion paired — this alarm is only on this phone.'}</p>
        <button class="btn big sos-cancel" data-act="stop">Stop alarm</button>`;
    } else {
      body = `
        <div class="sos-title calm">✓</div>
        <p class="sos-text">Help is coming</p>
        <p class="sos-small">The caregiver acknowledged your SOS.</p>
        <button class="btn big" data-act="done">Done</button>`;
    }
    this.el.innerHTML = `<div class="sos-screen ${this.state}" role="alertdialog" aria-live="assertive">${body}</div>`;
    const screen = $('.sos-screen', this.el);
    if (this.state === 'countdown') screen.addEventListener('pointerdown', () => this.cancel(), { once: true });
    this.el.querySelector('[data-act=stop]')?.addEventListener('click', () => this.stop());
    this.el.querySelector('[data-act=done]')?.addEventListener('click', () => go('access'));
  },

  cancel() {
    if (this.state !== 'countdown') return;
    log('SOS cancelled during countdown');
    go('access');
  },

  alarm() {
    this.state = 'alarm';
    this.siren = siren(app.engine.ctx);
    const vibe = () => buzz([600, 300, 600]);
    vibe();
    this.vibeTimer = setInterval(vibe, 1600);
    sendToCompanion('sos', {}, true);
    log('SOS alarm on');
    this.render();
  },

  stop() {
    this.siren?.stop();
    clearInterval(this.vibeTimer);
    const unsent = cancelSos();
    log(`SOS stopped on the phone${unsent ? ' (it had not reached the Companion yet — dropped)' : ''}`);
    go('access');
  },

  acknowledged() {
    if (this.state !== 'alarm') return;
    this.siren?.stop();
    clearInterval(this.vibeTimer);
    if (navigator.vibrate) navigator.vibrate(0);
    this.state = 'acked';
    log('SOS acknowledged by the Companion');
    this.render();
  },

  onTap() {
    return null; // knocks do nothing while SOS is on screen
  },
};
