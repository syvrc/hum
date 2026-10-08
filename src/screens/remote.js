// Desk Remote (bonus mode, brief §3.4): knock patterns control the music/video player
// on the Companion page — play/pause, next, previous, volume. No confirm step here:
// a pattern acts as soon as it ends.

import { app, go, saveProfileSoon, bus } from '../app.js';
import { decide } from '../profile.js';
import { RhythmController } from '../gesture.js';
import { TAP_TYPES, MAX_COUNT, patternText, patternWords } from '../pads.js';
import { buzz } from '../voice.js';
import { phoneLink, sendToCompanion, isConnected } from '../phoneLink.js';
import { $, $$, esc } from '../ui/dom.js';

export const COMMANDS = {
  playpause: { icon: '⏯', label: 'Play / pause' },
  next: { icon: '⏭', label: 'Next' },
  prev: { icon: '⏮', label: 'Previous' },
  volup: { icon: '🔊', label: 'Volume up' },
  voldown: { icon: '🔉', label: 'Volume down' },
  none: { icon: '·', label: 'Nothing' },
};
// ✋×1 play/pause · ✊×1 next · ✊×2 previous · ✋×2 louder · ✋×3 quieter · ✊×3 nothing
const DEFAULTS = { palm1: 'playpause', knuckle1: 'next', knuckle2: 'prev', palm2: 'volup', palm3: 'voldown', knuckle3: 'none' };

export function assignDefaultRemote(profile) {
  for (const c of profile.commands) if (!COMMANDS[c.remote]) c.remote = DEFAULTS[c.id] || 'none';
}

export const remote = {
  instrument: false,

  mount(el) {
    this.el = el;
    assignDefaultRemote(app.profile);
    this.onLink = () => this.renderStatus();
    bus.addEventListener('link', this.onLink);
    this.ctl = new RhythmController(
      { confirm: false, gapMs: app.access.gapMs },
      {
        count: (n, type) => this.renderStatus(`${type ? TAP_TYPES[type].icon : '?'} ×${n} …`, true),
        command: (cmd) => this.run(app.profile.commands.find((c) => c.type === cmd.type && c.count === cmd.count)),
        unsure: () => this.note('? Didn’t catch that — knock again'),
        tooMany: (n) => this.note(`? ${n} knocks — use 1 to 3`),
        sos: () => go('sos'),
      },
    );
    this.render();
  },

  unmount() {
    this.ctl.dispose();
    bus.removeEventListener('link', this.onLink);
    clearTimeout(this.statusTimer);
  },

  render() {
    const types = app.profile.pads.map((p) => p.id);
    const head = types.map((t) => `<div class="cmd-head">${TAP_TYPES[t].icon} ${TAP_TYPES[t].label}</div>`).join('');
    let cells = '';
    for (let count = 1; count <= MAX_COUNT; count++) {
      for (const t of types) {
        const c = app.profile.commands.find((x) => x.type === t && x.count === count);
        if (!c) continue;
        cells += `<div class="tile remote-tile" data-cmd="${c.id}">
          <span class="tile-pattern" aria-label="${esc(patternWords(c))}">${patternText(c)}</span>
          <span class="tile-phrase">${COMMANDS[c.remote].icon} ${esc(COMMANDS[c.remote].label)}</span></div>`;
      }
    }
    const map = app.profile.commands
      .map(
        (c) => `<label class="remote-map"><span class="mono">${patternText(c)}</span>
          <select data-cmd="${c.id}">${Object.entries(COMMANDS).map(([k, v]) => `<option value="${k}" ${c.remote === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>`,
      )
      .join('');
    this.el.innerHTML = `
      <div class="access">
        <div class="wiz-head"><button class="btn small" data-act="home">← Tables</button><span class="eyebrow">DESK REMOTE</span></div>
        <div class="access-status" id="remoteStatus" role="status" aria-live="polite"></div>
        <div class="cmd-grid" style="--cols:${types.length}">${head}${cells}</div>
        <details class="card"><summary>Change what each pattern does</summary><div class="remote-maps">${map}</div></details>
        <p class="muted small">Knocks control the music on the Companion page: open <span class="mono">${esc(location.host)}/companion.html</span> on a laptop and pair from the home screen.</p>
      </div>`;
    $('[data-act=home]', this.el).addEventListener('click', () => go('home'));
    $$('select[data-cmd]', this.el).forEach((s) =>
      s.addEventListener('change', () => {
        app.profile.commands.find((c) => c.id === s.dataset.cmd).remote = s.value;
        saveProfileSoon();
        this.render();
      }),
    );
    this.renderStatus();
  },

  renderStatus(text, live = false) {
    const el = $('#remoteStatus', this.el);
    if (!el) return;
    const connected = isConnected();
    el.className = `access-status ${text ? (live ? 'counting' : 'speaking') : connected ? '' : 'notice'}`;
    el.textContent = text || (connected ? `Connected to the Companion (room ${phoneLink.code}) — knock a pattern` : phoneLink.code ? `Connecting to room ${phoneLink.code}…` : 'Not paired with a Companion — pair from the home screen');
  },

  note(text) {
    this.renderStatus(text);
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.renderStatus(), 1500);
  },

  run(c) {
    if (!c || c.remote === 'none') return this.note(`${c ? patternText(c) : '?'} — not mapped`);
    const cmd = COMMANDS[c.remote];
    const sent = sendToCompanion('media', { cmd: c.remote, pattern: patternText(c) });
    if (app.access.vibrate) buzz(25);
    const tile = $(`[data-cmd="${c.id}"]`, this.el);
    if (tile) {
      tile.classList.remove('speaking');
      void tile.offsetWidth;
      tile.classList.add('speaking');
      setTimeout(() => tile.classList.remove('speaking'), 600);
    }
    this.note(`${patternText(c)} → ${cmd.icon} ${cmd.label}${sent ? '' : ' — not sent: Companion not connected'}`);
  },

  onTap(sample, d) {
    if (!app.model) return null;
    const p = decide(app.model, sample.feats.vec, app.settings);
    d.marker.label = p.status === 'pad' ? TAP_TYPES[p.label]?.label : '?';
    d.marker.ok = p.status === 'pad' ? true : null;
    this.ctl.tap({ label: p.label, status: p.status, confidence: p.confidence, t: d.onsetWall });
    return { summary: { pred: p.label, status: p.status, confidence: p.confidence } };
  },
};
