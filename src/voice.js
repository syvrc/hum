// Hum's outputs: speech (Web Speech API), recorded voice clips (MediaRecorder), a soft
// chime and vibration.
//
// Self-hearing guard: the phone lies ON the table, so its own speaker and vibration
// motor shake the table exactly like a knock. Every output therefore tells the guard
// how long it will last, and knocks during that time (+150 ms) are ignored.

import { get, set, del } from 'idb-keyval';
import { log } from './ui/log.js';

const TAIL_MS = 150;
let guard = () => ({ end() {} });

/** fn(ms) must start ignoring knocks for `ms` and return { end(tailMs) } to finish early. */
export function setGuard(fn) {
  guard = fn;
}

// ------------------------------------------------------------- speech --------

export const hasSpeech = () => 'speechSynthesis' in window;

export function englishVoices() {
  if (!hasSpeech()) return [];
  return speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
}

function pickVoice(voiceURI) {
  const all = englishVoices();
  if (voiceURI) {
    const v = all.find((x) => x.voiceURI === voiceURI);
    if (v) return v;
  }
  const lang = (navigator.language || 'en-US').toLowerCase();
  return all.find((v) => v.lang.toLowerCase().replace('_', '-') === lang) || all.find((v) => /en[-_]us/i.test(v.lang)) || all[0] || null;
}

/** Load the voice list early (Chrome fills it asynchronously). Call from a user gesture. */
export function warmUpSpeech() {
  if (!hasSpeech()) return;
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => log(`${englishVoices().length} English voices available`));
}

/**
 * Speak `text`. Resolves when finished. Android's `onend` event is unreliable, so an
 * estimated duration (≈14 characters per second at rate 1) is used as a backstop.
 */
export function speak(text, { rate = 1, voiceURI = null } = {}) {
  return new Promise((resolve) => {
    if (!hasSpeech()) {
      log('speech synthesis not available');
      resolve(false);
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(voiceURI);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = 'en-US';
    u.rate = rate;
    const estMs = (text.length / (14 * rate)) * 1000 + 600;
    const g = guard(estMs * 1.6 + TAIL_MS);
    let done = false;
    const finish = (why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      g.end(TAIL_MS);
      if (why !== 'end') log(`speech finished by ${why}`);
      resolve(true);
    };
    const timer = setTimeout(() => finish('timeout'), estMs * 1.6);
    u.onend = () => finish('end');
    u.onerror = (e) => {
      log('speech error:', e.error);
      finish('error');
    };
    speechSynthesis.speak(u);
  });
}

// ------------------------------------------------------------- voice clips ---
// A caregiver or family member records each phrase in their own voice. Clips are
// stored only on this phone (IndexedDB) and preferred over text-to-speech.

const clipKey = (id) => `hum.clip.${id}`;
const decoded = new Map(); // clipId → AudioBuffer (decode once)

export const saveClip = (id, blob) => set(clipKey(id), blob);
export const loadClip = (id) => get(clipKey(id));
export async function deleteClip(id) {
  decoded.delete(id);
  await del(clipKey(id));
}

/**
 * Start recording from the (already open) microphone stream.
 * Returns { stop(), done: Promise<Blob> }; stops by itself after maxMs.
 */
export function recordClip(stream, maxMs = 4000) {
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => window.MediaRecorder?.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  const g = guard(maxMs + 500); // the speaker's voice must not count as knocks
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve, reject) => {
    rec.onstop = () => {
      g.end(TAIL_MS);
      resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
    };
    rec.onerror = (e) => {
      g.end(TAIL_MS);
      reject(e.error || new Error('recording failed'));
    };
  });
  rec.start();
  const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), maxMs);
  return {
    stop() {
      clearTimeout(timer);
      if (rec.state === 'recording') rec.stop();
    },
    done,
  };
}

/** Play a stored clip through the app's AudioContext. Resolves when it has finished. */
export async function playClip(ctx, clipId, blob = null) {
  let buf = decoded.get(clipId);
  if (!buf) {
    const b = blob || (await loadClip(clipId));
    if (!b) return false;
    buf = await ctx.decodeAudioData(await b.arrayBuffer());
    decoded.set(clipId, buf);
  }
  return new Promise((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const g = guard(buf.duration * 1000 + TAIL_MS);
    src.onended = () => {
      g.end(TAIL_MS);
      resolve(true);
    };
    src.start();
  });
}

// ------------------------------------------------------------- chime & buzz --

/** A soft two-note chime: "I heard you". */
export function chime(ctx, kind = 'preview') {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const notes = kind === 'confirm' ? [784, 1175] : [660, 990];
  const out = ctx.createGain();
  out.gain.value = 0.12;
  out.connect(ctx.destination);
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const start = t + i * 0.09;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(1, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    o.connect(g).connect(out);
    o.start(start);
    o.stop(start + 0.18);
  });
  guard(notes.length * 90 + 180 + TAIL_MS);
}

/** Vibrate (if supported). A vibrating phone on a table buzzes loudly, so it's guarded too. */
export function buzz(pattern) {
  if (!navigator.vibrate) return;
  const total = (Array.isArray(pattern) ? pattern : [pattern]).reduce((a, b) => a + b, 0);
  guard(total + TAIL_MS);
  navigator.vibrate(pattern);
}
