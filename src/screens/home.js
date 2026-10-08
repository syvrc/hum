// Home: the active table profile, other saved tables, and setup / import.

import { app, activate, deleteProfile, saveProfile, go, bus } from '../app.js';
import { phoneLink, connect, disconnect } from '../phoneLink.js';
import { normaliseCode } from '../link.js';
import { countFor, NONE, exportProfile, importProfile, hydrate } from '../profile.js';
import { downloadJson } from '../report.js';
import { $, $$, esc, pct, toast, ago } from '../ui/dom.js';
import * as store from '../store.js';

export const home = {
  instrument: false,

  mount(el) {
    this.el = el;
    this.onLink = () => this.render();
    bus.addEventListener('link', this.onLink);
    this.render();
  },

  unmount() {
    bus.removeEventListener('link', this.onLink);
  },

  companionHtml() {
    const s = phoneLink.status;
    const statusText = !phoneLink.code
      ? 'Not paired.'
      : s === 'connected'
        ? `Connected · room ${phoneLink.code}`
        : s === 'offline'
          ? `Room ${phoneLink.code} · offline (no internet?)`
          : `Room ${phoneLink.code} · waiting for the Companion page…`;
    return `<div class="card">
        <div class="eyebrow">COMPANION · CAREGIVER FEED · SOS ALERTS · DESK REMOTE</div>
        <p class="mono small ${s === 'connected' ? 'ok' : ''}">${esc(statusText)}</p>
        <div class="row">
          ${phoneLink.code ? '<button class="btn" data-act="unpair">Unpair</button>' : '<button class="btn" data-act="pair">Pair with a code</button>'}
          <button class="btn" data-act="remote" ${app.model ? '' : 'disabled'}>Desk Remote →</button>
        </div>
        <p class="muted small">Open <span class="mono">${esc(location.host)}/companion.html</span> on a laptop, then scan its QR code with this phone's camera or type its code here.</p>
      </div>`;
  },

  render() {
    const p = app.profile;
    const others = app.profiles.filter((e) => e.id !== p?.id);
    const active = p
      ? `<div class="card active-profile">
          <div class="eyebrow">ACTIVE TABLE</div>
          <div class="title-row"><h2>${esc(p.name)}</h2><button class="btn small" data-act="rename" data-id="${p.id}">Rename</button></div>
          <p class="mono small muted">${p.pads.length} pads · ${p.samples.filter((s) => s.padId !== NONE).length} example taps${countFor(p, NONE) ? ` · ${countFor(p, NONE)} ignore sounds` : ''} · updated ${ago(p.updatedAt)}</p>
          <p class="mono small">self-check ${pct(p.check?.padAccuracy)}${p.lastTest ? ` · last accuracy test ${pct(p.lastTest.summary.accuracy)} (${p.lastTest.summary.n} taps)` : ''}${p.check?.setupSeconds ? ` · setup took ${p.check.setupSeconds} s` : ''}</p>
          <div class="chips">${p.pads.map((pad) => `<span class="chip static">${esc(pad.short)} <span class="mono">${countFor(p, pad.id)}</span></span>`).join('')}</div>
          <button class="btn primary big" data-act="access" ${app.model ? '' : 'disabled'}>Open Access Pad →</button>
          <div class="row">
            <button class="btn" data-act="lab" ${app.model ? '' : 'disabled'}>Accuracy test &amp; play</button>
            <button class="btn" data-act="retrain">Retrain</button>
            <button class="btn" data-act="export" data-id="${p.id}">Export</button>
          </div>
        </div>`
      : `<div class="card">
          <div class="eyebrow">NO TABLE YET</div>
          <p>Teach Hum your table: lay the phone down, stay quiet for 3 seconds, then tap each pad 8 times. It takes about a minute.</p>
        </div>`;
    const list = others.length
      ? `<h3>Other tables</h3><ul class="profile-list">${others
          .map(
            (e) => `<li><div><b>${esc(e.name)}</b><span class="mono small muted">${e.pads} pads · ${ago(e.updatedAt)}</span></div>
              <div class="row"><button class="btn small" data-act="use" data-id="${e.id}">Use</button>
              <button class="btn small" data-act="export" data-id="${e.id}">Export</button>
              <button class="btn small danger" data-act="delete" data-id="${e.id}">Delete</button></div></li>`,
          )
          .join('')}</ul>`
      : '';
    this.el.innerHTML = `
      <div class="screen-head">
        <p class="eyebrow">HUM · YOUR TABLES</p>
      </div>
      ${active}
      ${this.companionHtml()}
      <button class="btn ${p ? '' : 'primary'} big" data-act="new">+ Set up a new table</button>
      ${list}
      <label class="btn small file-btn">Import a table profile (.json)<input type="file" accept="application/json,.json" hidden></label>
      <p class="muted small">Tables are stored only on this phone. Export one to back it up or move it to another phone.</p>`;
    this.bind();
  },

  bind() {
    $$('[data-act]', this.el).forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        switch (b.dataset.act) {
          case 'access':
            go('access');
            break;
          case 'lab':
            go('lab');
            break;
          case 'remote':
            go('remote');
            break;
          case 'pair': {
            const code = normaliseCode(prompt('Room code shown on the Companion page'));
            if (code) connect(code);
            else toast('That is not a room code — it has 4–8 letters/numbers.');
            this.render();
            break;
          }
          case 'unpair':
            await disconnect();
            this.render();
            break;
          case 'new':
            go('wizard', { mode: 'new' });
            break;
          case 'retrain':
            go('wizard', { mode: 'retrain' });
            break;
          case 'use':
            await activate(id);
            this.render();
            break;
          case 'rename': {
            const name = prompt('Name this table', app.profile.name);
            if (name && name.trim()) {
              app.profile.name = name.trim().slice(0, 40);
              await saveProfile();
              this.render();
            }
            break;
          }
          case 'export': {
            const stored = id === app.profile?.id ? null : await store.loadProfile(id);
            const prof = stored ? hydrate(stored) : app.profile;
            downloadJson(exportProfile(prof), `hum-table-${prof.name.replace(/\W+/g, '-').toLowerCase()}.json`);
            break;
          }
          case 'delete': {
            const entry = app.profiles.find((e) => e.id === id);
            if (confirm(`Delete "${entry?.name}" and all its example taps from this phone?`)) {
              await deleteProfile(id);
              this.render();
            }
            break;
          }
        }
      }),
    );
    $('input[type=file]', this.el).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const prof = importProfile(JSON.parse(await file.text()));
        prof.name = `${prof.name} (imported)`;
        await saveProfile(prof);
        await activate(prof.id);
        toast(`Imported "${prof.name}"`);
        this.render();
      } catch (err) {
        toast(`Import failed: ${err.message}`);
      }
    });
  },

  onTap() {
    return null; // knocks do nothing on the home screen
  },
};
