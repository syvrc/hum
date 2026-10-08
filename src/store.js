// Local persistence (IndexedDB via idb-keyval). Everything stays on this phone.
// We store the *raw* tap windows, not just features, so improving the feature code
// later re-uses your existing training without re-recording.

import { get, set, del } from 'idb-keyval';
import { log } from './ui/log.js';

const KEY_SESSION = 'hum.p0.session';
const KEY_SETTINGS = 'hum.settings';

export async function loadSession() {
  try {
    return (await get(KEY_SESSION)) || null;
  } catch (e) {
    log('could not load session:', e.message);
    return null;
  }
}

export async function saveSession(session) {
  try {
    await set(KEY_SESSION, session);
  } catch (e) {
    log('could not save session:', e.message);
  }
}

export async function clearSession() {
  await del(KEY_SESSION).catch(() => {});
}

export async function loadSettings() {
  try {
    return (await get(KEY_SETTINGS)) || {};
  } catch {
    return {};
  }
}

export async function saveSettings(settings) {
  await set(KEY_SETTINGS, settings).catch(() => {});
}
