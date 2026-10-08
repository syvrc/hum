// Local persistence (IndexedDB via idb-keyval). Everything stays on this phone.
// Each Surface Profile is stored under its own key (raw tap audio included), plus a
// small index for the profile list and the id of the active profile.

import { get, set, del } from 'idb-keyval';
import { log } from './ui/log.js';

const KEY_INDEX = 'hum.profiles';
const KEY_ACTIVE = 'hum.activeProfile';
const KEY_SETTINGS = 'hum.settings';
const KEY_P0 = 'hum.p0.session'; // Phase 0 spike storage, migrated once
const profileKey = (id) => `hum.profile.${id}`;

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    log('storage error:', e.message);
    return fallback;
  }
}

export const listProfiles = () => safe(async () => (await get(KEY_INDEX)) || [], []);
export const loadProfile = (id) => safe(() => get(profileKey(id)), null);
export const getActiveId = () => safe(() => get(KEY_ACTIVE), null);
export const setActiveId = (id) => safe(() => set(KEY_ACTIVE, id));

/** Save a stored-form profile (see profile.js dehydrate) and refresh the index. */
export async function saveProfile(stored) {
  await safe(async () => {
    await set(profileKey(stored.id), stored);
    const index = (await get(KEY_INDEX)) || [];
    const entry = { id: stored.id, name: stored.name, updatedAt: stored.updatedAt, pads: stored.pads.length };
    const i = index.findIndex((e) => e.id === stored.id);
    if (i >= 0) index[i] = entry;
    else index.push(entry);
    await set(KEY_INDEX, index);
  });
}

export async function deleteProfile(id) {
  await safe(async () => {
    await del(profileKey(id));
    await set(KEY_INDEX, ((await get(KEY_INDEX)) || []).filter((e) => e.id !== id));
    if ((await get(KEY_ACTIVE)) === id) await del(KEY_ACTIVE);
  });
}

/** One-time: turn a Phase 0 training session into a regular profile. Returns it (stored form) or null. */
export async function takePhase0Session() {
  return safe(async () => {
    const s = await get(KEY_P0);
    if (!s || !s.samples?.length) return null;
    await del(KEY_P0);
    return s;
  }, null);
}

export const loadSettings = () => safe(async () => (await get(KEY_SETTINGS)) || {}, {});
export const saveSettings = (settings) => safe(() => set(KEY_SETTINGS, settings));
