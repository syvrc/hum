// The phone's end of the Companion link: connect by room code (typed, or from the
// Companion's QR which opens Hum with ?room=CODE), forward spoken phrases, SOS and
// Desk Remote commands, and receive the caregiver's acknowledgement.
// Everything here is optional: Hum works fully offline without it.

import { get, set, del } from 'idb-keyval';
import { app, bus } from './app.js';
import { Link, normaliseCode } from './link.js';
import { log } from './ui/log.js';

const KEY = 'hum.room';
export const phoneLink = { link: null, code: null, status: 'off' };

function emit(status) {
  phoneLink.status = status;
  bus.dispatchEvent(new CustomEvent('link', { detail: status }));
}

/** On start-up: use ?room=CODE from a scanned QR, else the last room, if any. */
export async function initLink() {
  const params = new URLSearchParams(location.search);
  const fromUrl = normaliseCode(params.get('room'));
  if (fromUrl) {
    params.delete('room');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }
  let code = fromUrl;
  if (!code) {
    try {
      code = await get(KEY);
    } catch {
      code = null;
    }
  }
  if (code) connect(code);
}

export function connect(code) {
  phoneLink.link?.close();
  phoneLink.code = code;
  set(KEY, code).catch(() => {});
  const link = new Link('client', code, () => ({ table: app.profile?.name || 'Hum phone' })).start();
  link.addEventListener('status', (e) => emit(e.detail));
  link.addEventListener('log', (e) => log('link:', e.detail));
  link.addEventListener('message', (e) => {
    const m = e.detail;
    if (m.type === 'ack') bus.dispatchEvent(new CustomEvent('ack', { detail: m }));
  });
  phoneLink.link = link;
  log(`companion link: room ${code}`);
}

export async function disconnect() {
  phoneLink.link?.close();
  phoneLink.link = null;
  phoneLink.code = null;
  await del(KEY).catch(() => {});
  emit('off');
}

export const isConnected = () => phoneLink.status === 'connected';

/** Send a message if linked. `important` messages (SOS) wait for the connection. */
export function sendToCompanion(type, data = {}, important = false) {
  return phoneLink.link ? phoneLink.link.send(type, { table: app.profile?.name, ...data }, important) : false;
}

/** Cancel an SOS: if it never reached the Companion, it must not be delivered later. */
export function cancelSos() {
  const dropped = phoneLink.link?.dropQueued('sos') || 0;
  if (!dropped) sendToCompanion('sos_cancel');
  return dropped;
}

// Every phrase Hum speaks goes to the caregiver feed.
bus.addEventListener('phrase', (e) => {
  const { text, via, pattern } = e.detail;
  sendToCompanion('phrase', { text, via, pad: pattern });
});
