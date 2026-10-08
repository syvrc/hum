// Shared state and services for every screen: the audio engine, sensors, the active
// Surface Profile and its trained classifier, settings, navigation and tap routing.

import { AudioEngine } from './audio/engine.js';
import { ONSET_DEFAULTS } from './audio/onset.js';
import { extractFeatures } from './audio/features.js';
import { Motion } from './platform.js';
import { hydrate, dehydrate, trainModel, newProfile, uid } from './profile.js';
import { presetPads } from './pads.js';
import * as store from './store.js';
import { log } from './ui/log.js';
import { $ } from './ui/dom.js';

export const DEFAULT_SETTINGS = Object.freeze({ k: 3, minConfidence: 0.2, maxDistRatio: 4 });

export const app = {
  engine: new AudioEngine(),
  motion: new Motion(),
  settings: { ...DEFAULT_SETTINGS },
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
  app.detector = saved.detector || {};
  app.engine.detectorOpts = { ...app.detector };

  const p0 = await store.takePhase0Session();
  if (p0) {
    const prof = newProfile('Test table (Phase 0)', presetPads(p0.presetId).map((p) => p.id));
    const stored = { ...dehydrate(prof), samples: p0.samples, lastTest: p0.lastTest || null };
    await store.saveProfile(stored);
    await store.setActiveId(stored.id);
    log('migrated Phase 0 training into a profile');
  }

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
  retrain();
  await store.setActiveId(id);
  log(`active profile "${app.profile.name}" (${app.profile.samples.length} taps)`);
  return true;
}

export function retrain() {
  app.model = app.profile ? trainModel(app.profile, app.settings) : null;
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
  store.saveSettings({ detector: app.detector, classifier: app.settings });
}

export function resetSettings() {
  app.detector = {};
  app.settings = { ...DEFAULT_SETTINGS };
  app.engine.setDetector({ ...ONSET_DEFAULTS });
  retrain();
  store.saveSettings({ detector: {}, classifier: app.settings });
}

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
