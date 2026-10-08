// Access Pad — the hero mode (brief §3.3). Knock the table, Hum speaks a phrase.
// Giant high-contrast tiles laid out like the table (the left pad's tile is on the left),
// readable at arm's length. Nothing essential relies on colour alone: every state also
// has text and an icon.

import { app, go, bus } from '../app.js';
import { decide } from '../profile.js';
import { AccessController } from '../gesture.js';
import { speak, playClip, chime, buzz } from '../voice.js';
import { $, $$, esc } from '../ui/dom.js';
import { log } from '../ui/log.js';

const ZONE_ORDER = ['far', 'left', 'right', 'near'];

export const access = {
  instrument: false,

  mount(el) {
    this.el = el;
    this.preview = null;
    this.speaking = null;
    this.notice = null;
    this.ctl = new AccessController(
      { confirm: app.access.confirm },
      {
        preview: (padId) => {
          this.preview = padId;
          if (app.access.chime) chime(app.engine.ctx, 'preview');
          if (app.access.vibrate) buzz(30);
          this.renderTiles();
        },
        clearPreview: () => {
          this.preview = null;
          this.renderTiles();
        },
        speak: (padId) => this.say(padId),
        unsure: () => this.flash('Didn’t catch that — knock again'),
      },
    );
    this.render();
  },

  unmount() {
    this.ctl.dispose();
    clearTimeout(this.noticeTimer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },

  render() {
    this.el.innerHTML = `
      <div class="access">
        <div class="access-status" id="accessStatus" role="status" aria-live="assertive"></div>
        <div class="tiles" id="tiles"></div>
        <div class="row access-actions">
          <button class="btn" data-act="phrases">Edit phrases &amp; voice</button>
          <button class="btn" data-act="home">Exit</button>
        </div>
        <p class="muted small">${app.access.confirm ? 'Confirm mode is on: one knock chooses, a double-knock anywhere speaks.' : 'Confirm mode is off: a knock speaks right away.'} Change it in “Edit phrases &amp; voice”.</p>
      </div>`;
    $$('[data-act]', this.el).forEach((b) => b.addEventListener('click', () => go(b.dataset.act === 'home' ? 'home' : 'phrases')));
    this.renderTiles();
  },

  renderTiles() {
    const pads = app.profile.pads;
    const zones = Object.fromEntries(ZONE_ORDER.map((z) => [z, pads.filter((p) => p.zone === z)]));
    const tile = (p) => {
      const state = this.speaking === p.id ? 'speaking' : this.preview === p.id ? 'preview' : '';
      const hint = state === 'speaking' ? '🔊 Speaking' : state === 'preview' ? '▶ Double-knock anywhere to say it' : '';
      return `<div class="tile ${state}" data-pad="${p.id}">
          <span class="tile-phrase">${esc(p.phrase)}</span>
          <span class="tile-meta">${esc(p.short)}${p.clipId ? ' · 🎙 recorded voice' : ''}</span>
          ${hint ? `<span class="tile-hint">${hint}</span>` : ''}
        </div>`;
    };
    const classes = ['tiles', zones.left.length ? '' : 'no-left', zones.right.length ? '' : 'no-right'].join(' ');
    const tilesEl = $('#tiles', this.el);
    tilesEl.className = classes;
    tilesEl.innerHTML = ZONE_ORDER.map((z) => (zones[z].length ? `<div class="zone zone-${z}">${zones[z].map(tile).join('')}</div>` : '')).join('');
    this.renderStatus();
  },

  renderStatus() {
    const el = $('#accessStatus', this.el);
    if (!el) return;
    const pad = (id) => app.profile.pads.find((p) => p.id === id);
    let cls = '';
    let text;
    if (this.speaking) {
      cls = 'speaking';
      text = `🔊 “${esc(pad(this.speaking).phrase)}”`;
    } else if (this.preview) {
      cls = 'preview';
      text = `▶ “${esc(pad(this.preview).phrase)}” — double-knock to say it`;
    } else if (this.notice) {
      cls = 'notice';
      text = `? ${esc(this.notice)}`;
    } else {
      text = app.access.confirm ? 'Knock a pad to choose · double-knock to speak' : 'Knock a pad to speak';
    }
    el.className = `access-status ${cls}`;
    el.innerHTML = text;
  },

  flash(msg) {
    this.notice = msg;
    this.renderStatus();
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = null;
      this.renderStatus();
    }, 1500);
  },

  async say(padId) {
    const pad = app.profile.pads.find((p) => p.id === padId);
    if (!pad) return;
    this.speaking = padId;
    this.renderTiles();
    if (app.access.vibrate) buzz([40, 60, 40]);
    let via = 'tts';
    try {
      if (pad.clipId && (await playClip(app.engine.ctx, pad.clipId))) via = 'clip';
      else await speak(pad.phrase, { rate: app.access.rate, voiceURI: app.access.voiceURI });
    } catch (e) {
      log('playback failed, falling back to speech:', e.message);
      await speak(pad.phrase, { rate: app.access.rate, voiceURI: app.access.voiceURI });
    }
    log(`said "${pad.phrase}" (${via})`);
    bus.dispatchEvent(new CustomEvent('phrase', { detail: { text: pad.phrase, padId, via, at: Date.now() } }));
    if (this.speaking === padId) this.speaking = null;
    if (app.screen === this) this.renderTiles();
  },

  onTap(sample, d) {
    if (!app.model) return null;
    const p = decide(app.model, sample.feats.vec, app.settings);
    d.marker.label = p.status === 'pad' ? app.profile.pads.find((x) => x.id === p.label)?.short : p.status === 'ignored' ? 'ignore' : '?';
    d.marker.ok = p.status === 'pad' ? true : null;
    this.ctl.tap({ label: p.label, status: p.status, t: d.onsetWall });
    return { summary: { pred: p.label, status: p.status, confidence: p.confidence, distRatio: p.distRatio } };
  },
};
