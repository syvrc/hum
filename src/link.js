// Link between the Hum phone and the Companion page (laptop or a second phone).
//
// WebRTC data channel via PeerJS. The free public PeerJS server only introduces the two
// devices; messages then travel directly between them. Only small JSON messages are
// sent (phrases, SOS, media commands) — never audio.
//
// Protocol (brief §4.3): { v: 1, type: 'hello'|'phrase'|'sos'|'sos_cancel'|'ack'|'media'|'ping', ts, ... }
// If venue Wi-Fi blocks WebRTC, put both devices on a phone hotspot.

import { Peer } from 'peerjs';

export const PROTOCOL = 1;
const PREFIX = 'hum-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: easy to read aloud and type
const HEARTBEAT_MS = 4000;
const DEAD_AFTER_MS = 12000;

export function newRoomCode(len = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Clean up a typed code; returns null if it can't be a room code. */
export function normaliseCode(s) {
  const code = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 4 && code.length <= 8 && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

export const msg = (type, data = {}) => ({ v: PROTOCOL, type, ts: Date.now(), ...data });

/**
 * One reliable connection with auto-reconnect and a heartbeat.
 * Events: 'status' (detail: 'starting'|'waiting'|'connecting'|'connected'|'offline'|'id-taken'),
 *         'message' (detail: a protocol message), 'log' (detail: text).
 */
export class Link extends EventTarget {
  constructor(role, code, hello = {}) {
    super();
    this.role = role; // 'host' (companion) or 'client' (phone)
    this.code = code;
    this.hello = hello;
    this.status = 'starting';
    this.conn = null;
    this.outbox = []; // important messages (SOS) waiting for a connection
    this.closed = false;
    this.retryMs = 1000;
  }

  start() {
    this.setStatus('starting');
    this.peer = this.role === 'host' ? new Peer(PREFIX + this.code, { debug: 1 }) : new Peer({ debug: 1 });
    this.peer.on('open', () => {
      this.log(`signalling ok (${this.role})`);
      this.retryMs = 1000;
      if (this.role === 'host') this.setStatus(this.conn ? 'connected' : 'waiting');
      else this.dial();
    });
    this.peer.on('connection', (conn) => this.attach(conn)); // host: the phone dialled in
    this.peer.on('disconnected', () => {
      // Lost the signalling server (not necessarily the phone↔companion channel).
      if (this.closed) return;
      this.log('signalling lost — reconnecting');
      setTimeout(() => !this.closed && !this.peer.destroyed && this.peer.reconnect(), 1500);
    });
    this.peer.on('error', (err) => {
      this.log(`peer error: ${err.type}`);
      if (err.type === 'unavailable-id') return this.setStatus('id-taken');
      if (err.type === 'peer-unavailable') {
        this.setStatus('waiting'); // companion page not open (yet)
        return this.redial();
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.setStatus('offline');
        return this.redial();
      }
    });
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    return this;
  }

  dial() {
    if (this.closed || this.role !== 'client' || !this.peer || this.peer.disconnected) return;
    this.setStatus('connecting');
    this.attach(this.peer.connect(PREFIX + this.code, { reliable: true }));
  }

  redial() {
    if (this.role !== 'client' || this.closed) return;
    clearTimeout(this.redialTimer);
    this.redialTimer = setTimeout(() => this.dial(), this.retryMs);
    this.retryMs = Math.min(10000, this.retryMs * 1.6);
  }

  attach(conn) {
    conn.on('open', () => {
      if (this.conn && this.conn !== conn) this.conn.close(); // newest connection wins
      this.conn = conn;
      this.lastSeen = Date.now();
      this.retryMs = 1000;
      this.setStatus('connected');
      conn.send(msg('hello', { role: this.role, ...(typeof this.hello === 'function' ? this.hello() : this.hello) }));
      while (this.outbox.length) conn.send(this.outbox.shift());
    });
    conn.on('data', (data) => {
      this.lastSeen = Date.now();
      if (!data || typeof data !== 'object' || data.v !== PROTOCOL || data.type === 'ping') return;
      this.dispatchEvent(new CustomEvent('message', { detail: data }));
    });
    conn.on('close', () => {
      if (this.conn !== conn) return;
      this.conn = null;
      this.log('connection closed');
      this.setStatus(this.role === 'host' ? 'waiting' : 'connecting');
      this.redial();
    });
    conn.on('error', (e) => this.log(`connection error: ${e.type || e.message}`));
  }

  beat() {
    const c = this.conn;
    if (!c || !c.open) return;
    if (Date.now() - this.lastSeen > DEAD_AFTER_MS) {
      this.log('no heartbeat — dropping connection');
      c.close();
      return;
    }
    c.send(msg('ping'));
  }

  /** Send a message. `important` ones (SOS) are queued until connected instead of dropped. */
  send(type, data = {}, important = false) {
    const m = msg(type, data);
    if (this.conn?.open) {
      this.conn.send(m);
      return true;
    }
    if (important) this.outbox.push(m);
    return false;
  }

  setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    this.dispatchEvent(new CustomEvent('status', { detail: s }));
  }

  log(text) {
    this.dispatchEvent(new CustomEvent('log', { detail: text }));
  }

  close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.redialTimer);
    this.conn?.close();
    this.peer?.destroy();
    this.setStatus('offline');
  }
}
