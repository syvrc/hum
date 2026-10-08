// Shared state and services for every screen: the audio engine, sensors, the active
// Surface Profile and its trained classifier, settings, navigation and tap routing.

import { AudioEngine } from './audio/engine.js';
import { ONSET_DEFAULTS } from './audio/onset.js';
import { extractFeatures } from './audio/features.js';
import { Motion } from './platform.js';
import { hydrate, dehydrate, trainModel, uid, assignDefaultPhrases } from './profile.js';
import { setGuard, deleteClip } from './voice.js';
import * as store from './store.js';
import { log } from './ui/log.js';
import { $ } from './ui/dom.js';

export const DEFAULT_SETTINGS = Object.freeze({ k: 3, minConfidence: 0.2, maxDistRatio: 4 });
export const ACCESS_DEFAULTS = Object.freeze({ confirm: true, rate: 1, voiceURI: null, chime: true, vibrate: true, gapMs: 450 });

/** App-wide events for other parts (e.g. the Companion link): 'phrase', … */
export const bus = new EventTarget();

export const app = {
  engine: new AudioEngine(),
  motion: new Motion(),
  settings: { ...DEFAULT_SETTINGS },
  access: { ...ACCESS_DEFAULTS },
  detector: {},
  profiles: [], // index: [{ id, name, updatedAt, pads }]
  profile: null, // active profile (runtime form)
  model: null, // k-NN trained on the active profile
  screens: {},
  screen: null,
  screenName: null,
  lastTap: null,
  map: null,
  scope: null,
};

// ------------------------------------------------------------- state loading --

export async function loadState() {
  const saved = await store.loadSettings();
  Object.assign(app.settings, saved.classifier || {});
  Object.assign(app.access, saved.access || {});
  app.detector = saved.detector || {};
  app.engine.detectorOpts = { ...app.detector };

  // Phase 0 spike data used location pads, which Hum no longer uses — just clear it.
  await store.takePhase0Session();

  app.profiles = await store.listProfiles();
  const activeId = await store.getActiveId();
  if (activeId) await activate(activeId);
}

export async function activate(id) {
  const stored = await store.loadProfile(id);
  if (!stored) {
    app.profile = null;
    app.model = null;
    return false;
  }
  app.profile = hydrate(stored);
  if (!app.profile.legacy) assignDefaultPhrases(app.profile);
  retrain();
  await store.setActiveId(id);
  log(`active profile "${app.profile.name}" (${app.profile.samples.length} taps)`);
  return true;
}

export function retrain() {
  // Legacy (location-based) tables can't drive the tap-type × rhythm screens.
  app.model = app.profile && !app.profile.legacy ? trainModel(app.profile, app.settings) : null;
}

export async function saveProfile(profile = app.profile) {
  profile.updatedAt = Date.now();
  await store.saveProfile(dehydrate(profile));
  app.profiles = await store.listProfiles();
}

let saveTimer = 0;
export function saveProfileSoon(profile = app.profile) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProfile(profile), 400);
}

export async function deleteProfile(id) {
  const stored = await store.loadProfile(id);
  for (const c of [...(stored?.commands || []), ...(stored?.pads || [])]) if (c.clipId) await deleteClip(c.clipId); // recorded voices go too
  await store.deleteProfile(id);
  app.profiles = await store.listProfiles();
  if (app.profile?.id === id) {
    app.profile = null;
    app.model = null;
  }
}

// ------------------------------------------------------------- settings ------

export function setSetting(group, key, value) {
  if (group === 'detector') {
    app.detector[key] = value;
    app.engine.setDetector({ [key]: value });
  } else {
    app.settings[key] = value;
    if (key === 'k') retrain();
  }
  persistSettings();
}

export function persistSettings() {
  store.saveSettings({ detector: app.detector, classifier: app.settings, access: app.access });
}

export function resetSettings() {
  app.detector = {};
  app.settings = { ...DEFAULT_SETTINGS };
  app.engine.setDetector({ ...ONSET_DEFAULTS });
  retrain();
  persistSettings();
}

// ------------------------------------------------------------- self-hearing --
// Every sound/vibration Hum makes mutes knock detection for its duration (+ tail).
setGuard((ms) => {
  const now = performance.now();
  const m = app.engine.mute(now, now + ms);
  return {
    end(tailMs = 150) {
      m.to = performance.now() + tailMs;
    },
  };
});

// ------------------------------------------------------------- navigation ----

/** Show a screen by name. Screens: { mount(el, params), unmount?(), onTap?(sample, d), instrument? } */
export function go(name, params = {}) {
  if (app.screen?.canLeave && !app.screen.canLeave()) return;
  app.screen?.unmount?.();
  app.screenName = name;
  app.screen = app.screens[name];
  $('#instrument').hidden = !app.screen.instrument;
  const el = $('#screen');
  el.replaceChildren();
  window.scrollTo(0, 0);
  app.screen.mount(el, params);
}

// ------------------------------------------------------------- tap routing ---

/** Every detected knock: compute its features once, then hand it to the current screen. */
export function handleTap(d) {
  const accel = app.motion.peakNear(d.onsetWall);
  const feats = extractFeatures(d.channels, d.sr, { pre: d.pre, accel });
  const sample = { id: uid(), sr: d.sr, pre: d.pre, channels: d.channels, accel, feats, t: Date.now() };
  const result = app.screen?.onTap?.(sample, d);
  if (!result) return;
  // Latency = onset → result handled; refined below to the frame where it is drawn.
  const handled = performance.now() - d.onsetWall;
  if (result.record) result.record.latencyMs = handled;
  app.lastTap = { screen: app.screenName, info: feats.info, accel, latencyMs: handled, ...result.summary };
  requestAnimationFrame(() => {
    const shown = performance.now() - d.onsetWall;
    if (result.record) result.record.latencyMs = shown;
    app.lastTap.latencyMs = shown;
    app.screen?.onLatency?.(shown, result);
  });
}
