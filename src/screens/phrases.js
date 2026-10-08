// Phrases & voice: what each pad says, recorded voice clips (a family member's voice
// is preferred over text-to-speech), confirm mode and speech settings.

import { app, go, saveProfileSoon, persistSettings } from '../app.js';
import { decide, uid } from '../profile.js';
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
    if (hasSpeech()) speechSynthesis.addEventListener?.('voiceschanged', this.onVoices = () => this.render());
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
    const padCards = app.profile.pads
      .map((p) => {
        const recording = this.rec?.padId === p.id;
        return `<div class="card phrase-card" data-card="${p.id}">
          <div class="eyebrow">${esc(p.label)} — ${esc(p.how)}</div>
          <input class="text phrase-input" data-pad="${p.id}" value="${esc(p.phrase)}" maxlength="60" aria-label="Phrase for ${esc(p.label)}">
          <div class="row">
            <button class="btn small" data-act="say" data-pad="${p.id}">▶ Play</button>
            ${
              recording
                ? `<button class="btn small danger" data-act="stop" data-pad="${p.id}">■ Stop recording</button>`
                : `<button class="btn small" data-act="rec" data-pad="${p.id}" ${this.rec ? 'disabled' : ''}>🎙 ${p.clipId ? 'Re-record voice' : 'Record voice'}</button>`
            }
            ${p.clipId && !recording ? `<button class="btn small" data-act="delclip" data-pad="${p.id}">Use synthetic voice</button>` : ''}
          </div>
          <p class="muted small">${recording ? `Recording… say “${esc(p.phrase)}” (max ${CLIP_MAX_MS / 1000} s)` : p.clipId ? 'Plays your recorded voice.' : 'Uses the synthetic voice.'}</p>
        </div>`;
      })
      .join('');
    this.el.innerHTML = `
      <div class="wiz-head"><button class="btn small" data-act="back">← Access Pad</button><span class="eyebrow">${esc(app.profile.name)}</span></div>
      <h2>Phrases &amp; voice</h2>
      <div class="card settings-card">
        <label class="switch"><input type="checkbox" data-set="confirm" ${a.confirm ? 'checked' : ''}><span><b>Confirm mode</b><br><span class="muted small">One knock chooses a phrase, a double-knock anywhere speaks it. Off: a knock speaks immediately.</span></span></label>
        <label class="switch"><input type="checkbox" data-set="chime" ${a.chime ? 'checked' : ''}><span><b>Chime</b> when a phrase is chosen</span></label>
        <label class="switch"><input type="checkbox" data-set="vibrate" ${a.vibrate ? 'checked' : ''}><span><b>Vibrate</b> when a phrase is chosen or spoken</span></label>
        <label class="dbg-slider"><span>Speech speed <b id="rateVal">${a.rate.toFixed(1)}×</b></span><input type="range" min="0.6" max="1.4" step="0.1" value="${a.rate}" data-set="rate"></label>
        <label class="field-block"><span class="eyebrow">VOICE</span><select data-set="voiceURI">${voiceOptions}</select></label>
      </div>
      <p class="muted small">Knock a pad on the table to see which card it is.</p>
      ${padCards}
      <button class="btn primary big" data-act="back">Done</button>`;
    this.bind();
  },

  bind() {
    $$('[data-set]', this.el).forEach((inp) =>
      inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
        const key = inp.dataset.set;
        app.access[key] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : inp.value || null;
        if (key === 'rate') $('#rateVal', this.el).textContent = `${app.access.rate.toFixed(1)}×`;
        persistSettings();
      }),
    );
    $$('.phrase-input', this.el).forEach((inp) =>
      inp.addEventListener('change', () => {
        const pad = app.profile.pads.find((p) => p.id === inp.dataset.pad);
        pad.phrase = inp.value.trim() || pad.label;
        saveProfileSoon();
      }),
    );
    $$('[data-act]', this.el).forEach((b) => b.addEventListener('click', () => this.act(b.dataset.act, b.dataset.pad)));
  },

  async act(action, padId) {
    const pad = app.profile.pads.find((p) => p.id === padId);
    switch (action) {
      case 'back':
        go('access');
        break;
      case 'say':
        if (pad.clipId) await playClip(app.engine.ctx, pad.clipId);
        else await speak(pad.phrase, { rate: app.access.rate, voiceURI: app.access.voiceURI });
        break;
      case 'rec': {
        if (!window.MediaRecorder) return toast('Recording is not supported in this browser.');
        const ctl = recordClip(app.engine.stream, CLIP_MAX_MS);
        this.rec = { padId, ctl };
        this.render();
        try {
          const blob = await ctl.done;
          const id = uid();
          await saveClip(id, blob);
          if (pad.clipId) await deleteClip(pad.clipId);
          pad.clipId = id;
          saveProfileSoon();
          log(`recorded clip for ${pad.id}: ${(blob.size / 1024).toFixed(0)} KB ${blob.type}`);
          this.rec = null;
          this.render();
          await playClip(app.engine.ctx, id, blob); // play it back so you can hear the result
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
        await deleteClip(pad.clipId);
        delete pad.clipId;
        saveProfileSoon();
        this.render();
        break;
    }
  },

  onTap(sample) {
    if (!app.model) return null;
    const p = decide(app.model, sample.feats.vec, app.settings);
    if (p.status === 'pad') {
      const card = $(`[data-card="${CSS.escape(p.label)}"]`, this.el);
      if (card) {
        card.classList.remove('hit');
        void card.offsetWidth;
        card.classList.add('hit');
      }
    }
    return { summary: { pred: p.label, status: p.status, confidence: p.confidence } };
  },
};
