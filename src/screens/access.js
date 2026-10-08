// Access Pad — the hero mode (brief §3.3). Knock the table, Hum speaks a phrase.
// Commands are tap type × number of knocks (✋/✊ × 1–3), anywhere on the table.
// Giant high-contrast tiles in a 2 × 3 grid (palm column, knuckle column; once / twice /
// three times) so the screen doubles as the cheat sheet. Nothing essential relies on
// colour alone: every state also has text and an icon.

import { app, go, bus } from '../app.js';
import { decide } from '../profile.js';
import { RhythmController } from '../gesture.js';
import { TAP_TYPES, MAX_COUNT, patternText, patternWords } from '../pads.js';
import { speak, playClip, chime, buzz } from '../voice.js';
import { $, $$, esc } from '../ui/dom.js';
import { log } from '../ui/log.js';

export const access = {
  instrument: false,

  mount(el) {
    this.el = el;
    this.asking = null;
    this.speaking = null;
    this.ctl = new RhythmController(
      { confirm: app.access.confirm, gapMs: app.access.gapMs },
      {
        count: (n, type) => this.status('counting', `${type ? TAP_TYPES[type].icon : '?'} ×${n} …`),
        ask: (cmd) => {
          this.asking = this.command(cmd);
          if (app.access.chime) chime(app.engine.ctx, 'preview');
          if (app.access.vibrate) buzz(30);
          this.renderTiles();
          this.status('asking', `“${esc(this.asking.phrase)}”? &nbsp;✋ once = say it · ✊ once = cancel`, true);
        },
        answer: (kind, cmd) => {
          this.asking = null;
          this.renderTiles();
          if (kind === 'yes') this.say(this.command(cmd));
          else this.flash(kind === 'timeout' ? 'Cancelled — no answer' : 'Cancelled');
        },
        command: (cmd) => this.say(this.command(cmd)),
        unsure: (reason) => this.flash(reason === 'mixed' ? 'Palm and knuckle got mixed — try again' : 'Didn’t catch that — knock again'),
        tooMany: (n) => this.flash(`${n} knocks — use 1 to 3 (fast 6+ is SOS)`),
        sos: () => go('sos'),
      },
    );
    this.render();
  },

  unmount() {
    this.ctl.dispose();
    clearTimeout(this.noticeTimer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },

  command(cmd) {
    return app.profile.commands.find((c) => c.type === cmd.type && c.count === cmd.count);
  },

  render() {
    this.el.innerHTML = `
      <div class="access">
        <div class="access-status" id="accessStatus" role="status" aria-live="assertive"></div>
        <div class="cmd-grid" id="tiles"></div>
        <div class="row access-actions">
          <button class="btn" data-act="phrases">Edit phrases &amp; voice</button>
          <button class="btn" data-act="home">Exit</button>
        </div>
        <p class="muted small">${
          app.access.confirm
            ? 'Knock a pattern anywhere on the table. Hum asks “…?” — then ✋ once says it, ✊ once cancels.'
            : 'Knock a pattern anywhere on the table and Hum says it right away.'
        } Fast drumming (6+ knocks) starts SOS.</p>
      </div>`;
    $$('[data-act]', this.el).forEach((b) => b.addEventListener('click', () => go(b.dataset.act === 'home' ? 'home' : 'phrases')));
    this.renderTiles();
    this.status();
  },

  renderTiles() {
    const types = app.profile.pads.map((p) => p.id);
    const head = types.map((t) => `<div class="cmd-head">${TAP_TYPES[t].icon} ${TAP_TYPES[t].label}</div>`).join('');
    let cells = '';
    for (let count = 1; count <= MAX_COUNT; count++) {
      for (const t of types) {
        const c = app.profile.commands.find((x) => x.type === t && x.count === count);
        if (!c) continue;
        const state = this.speaking === c.id ? 'speaking' : this.asking?.id === c.id ? 'preview' : '';
        const hint = state === 'speaking' ? '🔊 Speaking' : state === 'preview' ? '? ✋ = say it · ✊ = cancel' : '';
        cells += `<div class="tile ${state}" data-cmd="${c.id}">
          <span class="tile-pattern" aria-label="${esc(patternWords(c))}">${patternText(c)}</span>
          <span class="tile-phrase">${esc(c.phrase)}</span>
          ${c.clipId ? '<span class="tile-meta">🎙 recorded voice</span>' : ''}
          ${hint ? `<span class="tile-hint">${hint}</span>` : ''}
        </div>`;
      }
    }
    $('#tiles', this.el).style.setProperty('--cols', types.length);
    $('#tiles', this.el).innerHTML = head + cells;
  },

  /** Status line. kind: undefined (idle) | 'counting' | 'asking' | 'speaking' | 'notice'. */
  status(kind, html, countdown = false) {
    const el = $('#accessStatus', this.el);
    if (!el) return;
    this.statusKind = kind;
    const idle = app.access.confirm ? 'Knock ✋ or ✊ once, twice or three times' : 'Knock a pattern to speak';
    el.className = `access-status ${kind || ''}`;
    el.innerHTML = `${html || idle}${countdown ? '<span class="answer-bar"><i></i></span>' : ''}`;
  },

  flash(msg) {
    this.status('notice', `? ${esc(msg)}`);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.statusKind === 'notice' && this.status(), 1800);
  },

  async say(c) {
    if (!c) return;
    this.speaking = c.id;
    this.renderTiles();
    this.status('speaking', `🔊 “${esc(c.phrase)}”`);
    if (app.access.vibrate) buzz([40, 60, 40]);
    let via = 'tts';
    try {
      if (c.clipId && (await playClip(app.engine.ctx, c.clipId))) via = 'clip';
      else await speak(c.phrase, { rate: app.access.rate, voiceURI: app.access.voiceURI });
    } catch (e) {
      log('playback failed, falling back to speech:', e.message);
      await speak(c.phrase, { rate: app.access.rate, voiceURI: app.access.voiceURI });
    }
    log(`said "${c.phrase}" (${via})`);
    bus.dispatchEvent(new CustomEvent('phrase', { detail: { text: c.phrase, commandId: c.id, pattern: patternText(c), via, at: Date.now() } }));
    if (this.speaking === c.id) this.speaking = null;
    if (app.screen === this) {
      this.renderTiles();
      if (this.statusKind === 'speaking') this.status();
    }
  },

  onTap(sample, d) {
    if (!app.model) return null;
    const p = decide(app.model, sample.feats.vec, app.settings);
    d.marker.label = p.status === 'pad' ? TAP_TYPES[p.label]?.label : p.status === 'ignored' ? 'ignore' : '?';
    d.marker.ok = p.status === 'pad' ? true : null;
    this.ctl.tap({ label: p.label, status: p.status, confidence: p.confidence, t: d.onsetWall });
    return { summary: { pred: p.label, status: p.status, confidence: p.confidence, distRatio: p.distRatio } };
  },
};
