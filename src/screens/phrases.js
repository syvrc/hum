// Phrases & voice: what each knock pattern says, recorded voice clips (a family
// member's voice is preferred over text-to-speech), confirm mode and speech settings.

import { app, go, saveProfileSoon, persistSettings } from '../app.js';
import { decide, uid } from '../profile.js';
import { patternText, patternWords } from '../pads.js';
import { speak, englishVoices, hasSpeech, recordClip, saveClip, deleteClip, playClip } from '../voice.js';
import { $, $$, esc, toast } from '../ui/dom.js';
import { log } from '../ui/log.js';

const CLIP_MAX_MS = 4000;

export const phrases = {
  instrument: false,

  mount(el) {
    this.el = el;
    this.rec = null;
    this.render();
    if (hasSpeech()) speechSynthesis.addEventListener?.('voiceschanged', (this.onVoices = () => this.render()));
  },

  unmount() {
    this.rec?.ctl.stop();
    if (this.onVoices) speechSynthesis.removeEventListener?.('voiceschanged', this.onVoices);
  },

  render() {
    const a = app.access;
    const voices = englishVoices();
    const voiceOptions = voices.length
      ? `<option value="">Automatic</option>${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === a.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}`
      : '<option value="">Default voice</option>';
    const cards = app.profile.commands
      .map((c) => {
        const recording = this.rec?.id === c.id;
        return `<div class="card phrase-card" data-card="${c.id}">
          <div class="eyebrow"><span class="pattern-chip small">${patternText(c)}</span> ${esc(patternWords(c))}</div>
          <input class="text phrase-input" data-cmd="${c.id}" value="${esc(c.phrase)}" maxlength="60" aria-label="Phrase for ${esc(patternWords(c))}">
          <div class="row">
            <button class="btn small" data-act="say" data-cmd="${c.id}">▶ Play</button>
            ${
              recording
                ? `<button class="btn small danger" data-act="stop" data-cmd="${c.id}">■ Stop recording</button>`
                : `<button class="btn small" data-act="rec" data-cmd="${c.id}" ${this.rec ? 'disabled' : ''}>🎙 ${c.clipId ? 'Re-record voice' : 'Record voice'}</button>`
            }
            ${c.clipId && !recording ? `<button class="btn small" data-act="delclip" data-cmd="${c.id}">Use synthetic voice</button>` : ''}
          </div>
          <p class="muted small">${recording ? `Recording… say “${esc(c.phrase)}” (max ${CLIP_MAX_MS / 1000} s)` : c.clipId ? 'Plays your recorded voice.' : 'Uses the synthetic voice.'}</p>
        </div>`;
      })
      .join('');
    this.el.innerHTML = `
      <div class="wiz-head"><button class="btn small" data-act="back">← Access Pad</button><span class="eyebrow">${esc(app.profile.name)}</span></div>
      <h2>Phrases &amp; voice</h2>
      <div class="card settings-card">
        <label class="switch"><input type="checkbox" data-set="confirm" ${a.confirm ? 'checked' : ''}><span><b>Confirm mode</b><br><span class="muted small">Hum asks “…?” first; ✋ once says it, ✊ once cancels. Off: a pattern speaks immediately.</span></span></label>
        <label class="switch"><input type="checkbox" data-set="chime" ${a.chime ? 'checked' : ''}><span><b>Chime</b> when Hum asks</span></label>
        <label class="switch"><input type="checkbox" data-set="vibrate" ${a.vibrate ? 'checked' : ''}><span><b>Vibrate</b> when Hum asks or speaks</span></label>
        <label class="dbg-slider"><span>Pause that ends a pattern <b id="gapVal">${a.gapMs} ms</b><br><span class="muted small">Longer = more time between knocks, but Hum waits longer before acting.</span></span><input type="range" min="300" max="800" step="50" value="${a.gapMs}" data-set="gapMs"></label>
        <label class="dbg-slider"><span>Speech speed <b id="rateVal">${a.rate.toFixed(1)}×</b></span><input type="range" min="0.6" max="1.4" step="0.1" value="${a.rate}" data-set="rate"></label>
        <label class="field-block"><span class="eyebrow">VOICE</span><select data-set="voiceURI">${voiceOptions}</select></label>
      </div>
      <p class="muted small">Knock once to check Hum hears ✋ palm and ✊ knuckle correctly.</p>
      ${cards}
      <button class="btn primary big" data-act="back">Done</button>`;
    this.bind();
  },

  bind() {
    $$('[data-set]', this.el).forEach((inp) =>
      inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
        const key = inp.dataset.set;
        app.access[key] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : inp.value || null;
        if (key === 'rate') $('#rateVal', this.el).textContent = `${app.access.rate.toFixed(1)}×`;
        if (key === 'gapMs') $('#gapVal', this.el).textContent = `${app.access.gapMs} ms`;
        persistSettings();
      }),
    );
    $$('.phrase-input', this.el).forEach((inp) =>
      inp.addEventListener('change', () => {
        const c = app.profile.commands.find((x) => x.id === inp.dataset.cmd);
        c.phrase = inp.value.trim() || c.phrase;
        saveProfileSoon();
      }),
    );
    $$('[data-act]', this.el).forEach((b) => b.addEventListener('click', () => this.act(b.dataset.act, b.dataset.cmd)));
  },

  async act(action, id) {
    const c = app.profile.commands.find((x) => x.id === id);
    switch (action) {
      case 'back':
        go('access');
        break;
      case 'say':
        if (c.clipId) await playClip(app.engine.ctx, c.clipId);
        else await speak(c.phrase, { rate: app.access.rate, voiceURI: app.access.voiceURI });
        break;
      case 'rec': {
        if (!window.MediaRecorder) return toast('Recording is not supported in this browser.');
        const ctl = recordClip(app.engine.stream, CLIP_MAX_MS);
        this.rec = { id, ctl };
        this.render();
        try {
          const blob = await ctl.done;
          const clipId = uid();
          await saveClip(clipId, blob);
          if (c.clipId) await deleteClip(c.clipId);
          c.clipId = clipId;
          saveProfileSoon();
          log(`recorded clip for ${c.id}: ${(blob.size / 1024).toFixed(0)} KB ${blob.type}`);
          this.rec = null;
          this.render();
          await playClip(app.engine.ctx, clipId, blob); // play it back so you can hear the result
        } catch (e) {
          this.rec = null;
          this.render();
          toast(`Recording failed: ${e.message}`);
        }
        break;
      }
      case 'stop':
        this.rec?.ctl.stop();
        break;
      case 'delclip':
        await deleteClip(c.clipId);
        delete c.clipId;
        saveProfileSoon();
        this.render();
        break;
    }
  },

  // Knocks only show their type here (patterns are handled on the Access Pad).
  onTap(sample) {
    if (!app.model) return null;
    const p = decide(app.model, sample.feats.vec, app.settings);
    if (p.status === 'pad') toast(`Heard ${p.label}`, 900);
    return { summary: { pred: p.label, status: p.status, confidence: p.confidence } };
  },
};
