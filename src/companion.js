// Companion page (laptop or a second phone): pairs with the Hum phone through a room
// code / QR, shows the caregiver feed, takes over the screen on SOS (siren +
// notification + acknowledge), and hosts the Desk Remote media player.

import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles.css';
import './companion.css';
import QRCode from 'qrcode';
import { Link, newRoomCode } from './link.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const ROOM_KEY = 'hum.companion.room';
let code = readRoom();
let link = null;
let table = null;
let idTakenRetries = 0;
let audioCtx = null;

function readRoom() {
  try {
    return localStorage.getItem(ROOM_KEY) || newRoomCode();
  } catch {
    return newRoomCode();
  }
}

// ---------------------------------------------------------------- arming -------
// Browsers block sound until the user interacts; one click unlocks audio for the SOS
// siren and asks for notification permission (for alerts while this tab is hidden).

$('#armBtn').addEventListener('click', async () => {
  audioCtx = new AudioContext();
  await audioCtx.resume();
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      /* not supported here */
    }
  }
  $('#arm').hidden = true;
});

// ---------------------------------------------------------------- pairing ------

function startLink() {
  link?.close();
  try {
    localStorage.setItem(ROOM_KEY, code);
  } catch {
    /* private mode: code just won't survive a reload */
  }
  $('#roomCode').textContent = code;
  const url = `${location.origin}/?room=${code}`;
  QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#e2efeb', light: '#00000000' } }).then((svg) => ($('#qr').innerHTML = svg));
  link = new Link('host', code, { app: 'companion' }).start();
  link.addEventListener('status', (e) => onStatus(e.detail));
  link.addEventListener('message', (e) => onMessage(e.detail));
  link.addEventListener('log', (e) => console.log('[link]', e.detail));
}

function onStatus(s) {
  const pill = $('#linkPill');
  if (s === 'id-taken') {
    // A reload can find the old session still holding the code for a few seconds.
    if (idTakenRetries++ < 3) setTimeout(startLink, 2500);
    else {
      code = newRoomCode();
      idTakenRetries = 0;
      startLink();
    }
    pill.textContent = 'CLAIMING CODE…';
    pill.className = 'pill warn';
    return;
  }
  const label = { starting: 'STARTING…', waiting: 'WAITING FOR PHONE', connected: `CONNECTED${table ? ` · ${table}` : ''}`, offline: 'OFFLINE — check internet' }[s] || s.toUpperCase();
  pill.textContent = label;
  pill.className = `pill ${s === 'connected' ? 'live' : s === 'offline' ? 'bad' : 'warn'}`;
  if (s === 'waiting' && table) addFeed({ kind: 'info', text: 'Phone disconnected — waiting for it to come back', ts: Date.now() });
}

$('#newCode').addEventListener('click', () => {
  if (link?.status === 'connected' && !confirm('A phone is connected. Make a new code anyway? It will need to re-pair.')) return;
  code = newRoomCode();
  startLink();
});

// ---------------------------------------------------------------- messages -----

function onMessage(m) {
  switch (m.type) {
    case 'hello':
      table = m.table || 'Hum phone';
      onStatus('connected');
      addFeed({ kind: 'info', text: `Phone connected (${table})`, ts: m.ts });
      break;
    case 'phrase':
      addFeed({ kind: 'phrase', text: m.text, meta: `${m.pad || ''}${m.via === 'clip' ? ' · recorded voice' : ' · synthetic voice'}`, ts: m.ts });
      ding();
      break;
    case 'sos':
      showSos(m);
      break;
    case 'sos_cancel':
      endSos('Cancelled on the phone');
      addFeed({ kind: 'info', text: 'SOS cancelled on the phone', ts: m.ts });
      break;
    case 'media':
      media(m.cmd);
      break;
  }
}

function addFeed({ kind, text, meta = '', ts }) {
  const list = $('#feed');
  list.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  li.className = `feed-item ${kind}`;
  li.innerHTML = `<span class="mono small muted">${time(ts)}</span><span class="feed-text">${esc(text)}</span>${meta ? `<span class="mono small muted">${esc(meta)}</span>` : ''}`;
  list.prepend(li);
  while (list.children.length > 50) list.lastChild.remove();
}

function ding() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  o.connect(g).connect(audioCtx.destination);
  o.start(t);
  o.stop(t + 0.45);
}

// ---------------------------------------------------------------- SOS ----------

let siren = null;

function showSos(m) {
  $('#sos').hidden = false;
  $('#sosText').textContent = `Help needed at ${m.table || table || 'the Hum phone'}`;
  $('#sosTime').textContent = `since ${time(m.ts)}`;
  $('#ackBtn').hidden = false;
  $('#ackBtn').disabled = false;
  $('#sosClose').hidden = true;
  addFeed({ kind: 'sos', text: 'SOS — help needed', ts: m.ts });
  startSiren();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const n = new Notification('Hum SOS — help needed', { body: `From ${m.table || table || 'the Hum phone'} at ${time(m.ts)}`, requireInteraction: true, tag: 'hum-sos' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }
}

function endSos(text) {
  stopSiren();
  if ($('#sos').hidden) return;
  $('#sosText').textContent = text;
  $('#ackBtn').hidden = true;
  $('#sosClose').hidden = false;
}

$('#ackBtn').addEventListener('click', () => {
  link?.send('ack', { by: 'companion' }, true);
  addFeed({ kind: 'info', text: 'SOS acknowledged — the phone shows “Help is coming”', ts: Date.now() });
  endSos('Acknowledged — the phone now shows “Help is coming”.');
});
$('#sosClose').addEventListener('click', () => ($('#sos').hidden = true));

/** Two-tone siren (Web Audio). Needs the page to be armed (a click) first. */
function startSiren() {
  if (!audioCtx) {
    $('#arm').hidden = false; // can't make sound yet — the arm button doubles as "unmute"
    return;
  }
  stopSiren();
  const o = audioCtx.createOscillator();
  const f = audioCtx.createBiquadFilter();
  const g = audioCtx.createGain();
  o.type = 'sawtooth';
  f.type = 'lowpass';
  f.frequency.value = 2400;
  g.gain.value = 0.25;
  o.connect(f).connect(g).connect(audioCtx.destination);
  let hi = false;
  const flip = () => {
    hi = !hi;
    o.frequency.setTargetAtTime(hi ? 960 : 640, audioCtx.currentTime, 0.02);
  };
  flip();
  o.start();
  siren = { o, timer: setInterval(flip, 450) };
}

function stopSiren() {
  if (!siren) return;
  clearInterval(siren.timer);
  siren.o.stop();
  siren = null;
}

// ---------------------------------------------------------------- media --------

const player = $('#player');
const playlist = [];
let current = -1;
player.volume = 0.8;

function addFiles(files) {
  for (const f of files) {
    if (!/^(audio|video)\//.test(f.type)) continue;
    playlist.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) });
  }
  if (current < 0 && playlist.length) load(0, false);
  renderPlaylist();
}

function load(i, autoplay = true) {
  if (!playlist.length) return;
  current = (i + playlist.length) % playlist.length;
  player.src = playlist[current].url;
  if (autoplay) player.play().catch(() => {});
  renderNow();
  renderPlaylist();
}

function renderPlaylist() {
  $('#playlist').innerHTML = playlist.map((t, i) => `<li class="${i === current ? 'current' : ''}"><button type="button" data-i="${i}">${i === current ? '▶ ' : ''}${esc(t.name)}</button></li>`).join('');
  $('#playlist').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => load(Number(b.dataset.i))));
}

function renderNow() {
  $('#nowTitle').textContent = current >= 0 ? playlist[current].name : 'Nothing loaded';
  $('#nowState').textContent = player.paused ? '⏸' : '▶';
  $('#volBar').style.width = `${Math.round(player.volume * 100)}%`;
  $('#volVal').textContent = `${Math.round(player.volume * 100)}%`;
}
for (const ev of ['play', 'pause', 'volumechange']) player.addEventListener(ev, renderNow);
player.addEventListener('ended', () => load(current + 1));

const COMMANDS = {
  playpause: ['⏯', 'PLAY / PAUSE'],
  next: ['⏭', 'NEXT'],
  prev: ['⏮', 'PREVIOUS'],
  volup: ['🔊', 'VOLUME UP'],
  voldown: ['🔉', 'VOLUME DOWN'],
};

/** A media command from a knock on the table. */
function media(cmd) {
  if (!COMMANDS[cmd]) return;
  flashCommand(cmd);
  if (cmd === 'volup') player.volume = Math.min(1, Math.round((player.volume + 0.1) * 10) / 10);
  else if (cmd === 'voldown') player.volume = Math.max(0, Math.round((player.volume - 0.1) * 10) / 10);
  else if (!playlist.length) return;
  else if (cmd === 'playpause') player.paused ? player.play().catch(() => {}) : player.pause();
  else if (cmd === 'next') load(current + 1);
  else if (cmd === 'prev') player.currentTime > 3 ? (player.currentTime = 0) : load(current - 1);
  renderNow();
}

let flashTimer = 0;
function flashCommand(cmd) {
  const [icon, label] = COMMANDS[cmd];
  const el = $('#flash');
  el.innerHTML = `<span class="flash-icon">${icon}</span><span class="flash-label">${label}</span><span class="flash-sub">knock on the table${playlist.length || cmd.startsWith('vol') ? '' : ' — add some music first'}</span>`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 1100);
}

$('#files').addEventListener('change', (e) => addFiles(e.target.files));
const section = $('#mediaSection');
section.addEventListener('dragover', (e) => {
  e.preventDefault();
  $('#drop').classList.add('over');
});
section.addEventListener('dragleave', () => $('#drop').classList.remove('over'));
section.addEventListener('drop', (e) => {
  e.preventDefault();
  $('#drop').classList.remove('over');
  addFiles(e.dataTransfer.files);
});

startLink();
renderNow();
