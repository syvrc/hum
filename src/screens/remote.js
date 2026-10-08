// Desk Remote (bonus mode, brief §3.4): the same knocks control the music/video player
// on the Companion page — play/pause, next, previous, volume. Knocks act immediately.

import { app, go, saveProfileSoon, bus } from '../app.js';
import { decide } from '../profile.js';
import { buzz } from '../voice.js';
import { phoneLink, sendToCompanion, isConnected } from '../phoneLink.js';
import { $, $$, esc } from '../ui/dom.js';

export const COMMANDS = {
  playpause: { icon: '⏯', label: 'Play / pause' },
  next: { icon: '⏭', label: 'Next' },
  prev: { icon: '⏮', label: 'Previous' },
  volup: { icon: '🔊', label: 'Volume up' },
  voldown: { icon: '🔉', label: 'Volume down' },
};
const DEFAULT_ORDER = ['playpause', 'next', 'prev', 'volup', 'voldown'];
const ZONE_DEFAULT = { left: 'prev', right: 'next', near: 'playpause', far: 'volup' }; // spatial: ⏮ left, ⏭ right
const ZONE_ORDER = ['far', 'left', 'right', 'near'];

/** Give unmapped pads a command: by position first (left = previous …), then whatever is unused. */
export function assignDefaultCommands(profile) {
  const used = new Set(profile.pads.map((p) => p.remote).filter((c) => COMMANDS[c]));
  for (const p of profile.pads) {
    if (COMMANDS[p.remote]) continue;
    const byZone = ZONE_DEFAULT[p.zone];
    p.remote = byZone && !used.has(byZone) ? byZone : DEFAULT_ORDER.find((c) => !used.has(c)) || 'playpause';
    used.add(p.remote);
  }
}

export const remote = {
  instrument: false,

  mount(el) {
    this.el = el;
    assignDefaultCommands(app.profile);
    this.onLink = () => this.renderStatus();
    bus.addEventListener('link', this.onLink);
    this.render();
  },

  unmount() {
    bus.removeEventListener('link', this.onLink);
    clearTimeout(this.statusTimer);
  },

  render() {
    const pads = app.profile.pads;
    const zones = Object.fromEntries(ZONE_ORDER.map((z) => [z, pads.filter((p) => p.zone === z)]));
    const tile = (p) => `<div class="tile remote-tile" data-pad="${p.id}">
        <span class="tile-phrase">${COMMANDS[p.remote].icon} ${esc(COMMANDS[p.remote].label)}</span>
        <span class="tile-meta">${esc(p.short)}</span></div>`;
    const map = pads
      .map(
        (p) => `<label class="remote-map"><span class="mono">${esc(p.short)}</span>
          <select data-pad="${p.id}">${Object.entries(COMMANDS).map(([k, c]) => `<option value="${k}" ${p.remote === k ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}</select></label>`,
      )
      .join('');
    this.el.innerHTML = `
      <div class="access">
        <div class="wiz-head"><button class="btn small" data-act="home">← Tables</button><span class="eyebrow">DESK REMOTE</span></div>
        <div class="access-status" id="remoteStatus" role="status" aria-live="polite"></div>
        <div class="tiles ${zones.left.length ? '' : 'no-left'} ${zones.right.length ? '' : 'no-right'}">
          ${ZONE_ORDER.map((z) => (zones[z].length ? `<div class="zone zone-${z}">${zones[z].map(tile).join('')}</div>` : '')).join('')}
        </div>
        <details class="card"><summary>Change what each pad does</summary><div class="remote-maps">${map}</div></details>
        <p class="muted small">Knocks control the music on the Companion page: open <span class="mono">${esc(location.host)}/companion.html</span> on a laptop and pair from the home screen.</p>
      </div>`;
    $('[data-act=home]', this.el).addEventListener('click', () => go('home'));
    $$('select[data-pad]', this.el).forEach((s) =>
      s.addEventListener('change', () => {
        app.profile.pads.find((p) => p.id === s.dataset.pad).remote = s.value;
        saveProfileSoon();
        this.render();
      }),
    );
    this.renderStatus();
  },

  renderStatus(text) {
    const el = $('#remoteStatus', this.el);
    if (!el) return;
    const connected = isConnected();
    el.className = `access-status ${text ? 'speaking' : connected ? '' : 'notice'}`;
    el.textContent = text || (connected ? `Connected to the Companion (room ${phoneLink.code}) — knock a pad` : phoneLink.code ? `Connecting to room ${phoneLink.code}…` : 'Not paired with a Companion — pair from the home screen');
  },

  onTap(sample, d) {
    if (!app.model) return null;
    const p = decide(app.model, sample.feats.vec, app.settings);
    d.marker.label = p.status === 'pad' ? app.profile.pads.find((x) => x.id === p.label)?.short : '?';
    d.marker.ok = p.status === 'pad' ? true : null;
    if (p.status !== 'pad') {
      if (p.status === 'unsure') this.renderStatus('? Didn’t catch that — knock again');
      clearTimeout(this.statusTimer);
      this.statusTimer = setTimeout(() => this.renderStatus(), 1200);
      return { summary: { pred: p.label, status: p.status, confidence: p.confidence } };
    }
    const pad = app.profile.pads.find((x) => x.id === p.label);
    const cmd = COMMANDS[pad.remote];
    const sent = sendToCompanion('media', { cmd: pad.remote, pad: pad.short });
    if (app.access.vibrate) buzz(25);
    const tileEl = $(`[data-pad="${CSS.escape(pad.id)}"]`, this.el);
    if (tileEl) {
      tileEl.classList.remove('speaking');
      void tileEl.offsetWidth;
      tileEl.classList.add('speaking');
      setTimeout(() => tileEl.classList.remove('speaking'), 500);
    }
    this.renderStatus(`${cmd.icon} ${cmd.label}${sent ? '' : ' — not sent: Companion not connected'}`);
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.renderStatus(), 1200);
    return { summary: { pred: p.label, status: p.status, confidence: p.confidence, cmd: pad.remote, sent } };
  },
};
