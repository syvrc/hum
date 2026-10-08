// Hum — phone app entry point.
// Pipeline: mic → engine (onsets) → features → k-NN (active table profile) → screens.
// This file only boots things up; the screens live in src/screens/.

import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles.css';

import { app, bus, loadState, handleTap, go, setSetting, resetSettings } from './app.js';
import { initLink, phoneLink } from './phoneLink.js';
import { keepScreenOn } from './platform.js';
import { Scope } from './ui/scope.js';
import { TableMap } from './ui/tablemap.js';
import { DebugPanel } from './ui/debug.js';
import { log } from './ui/log.js';
import { $ } from './ui/dom.js';
import { downloadJson, buildDataset } from './report.js';
import { home } from './screens/home.js';
import { wizard } from './screens/wizard.js';
import { lab, copyReport, sendDataset } from './screens/lab.js';
import { access } from './screens/access.js';
import { phrases } from './screens/phrases.js';
import { remote } from './screens/remote.js';
import { sos } from './screens/sos.js';
import { warmUpSpeech } from './voice.js';

app.screens = { home, wizard, lab, access, phrases, remote, sos };
app.map = new TableMap($('#map'));
app.scope = new Scope($('#scope'), app.engine);

// ---------------------------------------------------------------- start-up -----

$('#startBtn').addEventListener('click', start);

async function start() {
  const btn = $('#startBtn');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  $('#startError').hidden = true;
  warmUpSpeech(); // inside the tap: lets the browser speak later, when knocks (not taps) trigger it
  try {
    // start() creates the AudioContext synchronously, inside this tap (browsers only
    // allow audio to start from a user gesture); stored tables load in parallel.
    await Promise.all([app.engine.start(), loadState()]);
    app.engine.setDetector(app.detector);
    app.motion.start();
    keepScreenOn();
    $('#start').hidden = true;
    app.scope.start();
    updateStatus();
    setInterval(updateStatus, 500);
    initLink(); // reconnect to the Companion (or join the room from a scanned QR code)
    // First run (no table yet) goes straight into setup; otherwise straight to the Access Pad.
    go(app.profile ? (app.model ? 'access' : 'home') : 'wizard', { mode: 'new' });
  } catch (e) {
    log('start failed:', e.name, e.message);
    app.engine.stop();
    const el = $('#startError');
    el.hidden = false;
    el.textContent =
      e.name === 'NotAllowedError'
        ? 'Microphone permission was blocked. Tap the icon left of the address bar → Permissions → Microphone → Allow, then reload this page.'
        : e.name === 'NotFoundError'
          ? 'No microphone found on this device.'
          : e.code === 'insecure'
            ? 'This page must be opened over https:// (or http://localhost) for the microphone to work.'
            : `Could not start the microphone: ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Try again';
  }
}

app.engine.addEventListener('tap', (e) => handleTap(e.detail));
app.engine.addEventListener('state', () => updateStatus());

// Touching the glass makes a small knock too. Ignore taps from ~150 ms before to
// ~350 ms after any screen touch, so pressing buttons never counts as a table tap.
for (const type of ['pointerdown', 'pointerup']) {
  window.addEventListener(
    type,
    () => {
      const now = performance.now();
      app.engine.mute(now - 150, now + 350);
      app.engine.resume();
    },
    { capture: true, passive: true },
  );
}

function updateStatus() {
  const e = app.engine;
  const pill = $('#micPill');
  if (e.state === 'running' && e.ctx?.state === 'running') {
    pill.textContent = `LISTENING ${Math.round(e.sr / 1000)}k·${e.channels || '?'}ch`;
    pill.className = 'pill live';
  } else if (e.state === 'error') {
    pill.textContent = 'MIC LOST · reload';
    pill.className = 'pill bad';
  } else if (e.state === 'running') {
    pill.textContent = 'PAUSED · tap screen';
    pill.className = 'pill warn';
  } else {
    pill.textContent = 'MIC OFF';
    pill.className = 'pill';
  }
  const det = e.detector;
  $('#floorReadout').textContent = det ? `FLOOR ${det.floorDb.toFixed(0)} dB` : 'FLOOR —';
}

// Small companion-link indicator next to the floor readout.
bus.addEventListener('link', () => {
  const el = $('#linkReadout');
  const s = phoneLink.status;
  el.hidden = s === 'off';
  el.textContent = s === 'connected' ? '· LINK ✓' : s === 'offline' ? '· LINK ✗' : '· LINK …';
  el.className = `readout ${s === 'connected' ? 'ok' : s === 'offline' ? 'bad' : 'warn'}`;
});

// ---------------------------------------------------------------- debug --------

const debug = new DebugPanel($('#debug'), app, {
  copyReport,
  sendToLaptop: import.meta.env.DEV ? sendDataset : null,
  downloadDataset: () => downloadJson(buildDataset(app), `hum-dataset-${Date.now()}.json`),
  setSetting,
  resetSettings,
});

// Logo: tap = back to your tables; long-press (0.7 s) = debug panel (also ?debug + tap).
let pressTimer = 0;
let longPressed = false;
const logo = $('#logo');
logo.addEventListener('pointerdown', () => {
  longPressed = false;
  pressTimer = setTimeout(() => {
    longPressed = true;
    debug.open();
  }, 700);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) logo.addEventListener(ev, () => clearTimeout(pressTimer));
logo.addEventListener('contextmenu', (e) => e.preventDefault());
logo.addEventListener('click', () => {
  if (longPressed) return;
  if (new URLSearchParams(location.search).has('debug')) debug.open();
  else if (app.screen && app.screenName !== 'home') go('home');
});

if (!window.isSecureContext) {
  $('#startError').hidden = false;
  $('#startError').textContent = 'This page is not secure, so the microphone is blocked. Open it via https:// or http://localhost.';
}
log('Hum loaded', { dev: import.meta.env.DEV, secure: window.isSecureContext });
