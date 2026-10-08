// Lab: measure the active table honestly (randomised prompted accuracy test) and
// play with live classification. Test taps are never added to the training data.

import { app, go, saveProfileSoon } from '../app.js';
import { decide, noneLabel } from '../profile.js';
import { summarise } from '../ml/knn.js';
import { confusionHtml } from '../ui/confusion.js';
import { $, $$, esc, pct, toast } from '../ui/dom.js';
import { buildReport, buildDataset, copyText, downloadJson, sendToLaptop, latencyStats } from '../report.js';
import { log } from '../ui/log.js';

const TEST_PER_PAD = 20;

export const lab = {
  instrument: true,

  mount(el, { tab = 'test' } = {}) {
    this.el = el;
    this.tab = tab;
    this.test = null;
    this.play = [];
    app.map.setPads(app.profile.pads);
    this.render();
  },

  unmount() {
    app.map.highlight(null);
  },

  canLeave() {
    return !this.test || confirm('Stop the accuracy test? Results so far will be lost.');
  },

  pad(id) {
    return id === noneLabel.id ? noneLabel : app.profile.pads.find((p) => p.id === id);
  },

  render() {
    const body = this.tab === 'test' ? this.testHtml() : this.playHtml();
    this.el.innerHTML = `
      <div class="wiz-head"><button class="btn small" data-act="home">← Tables</button><span class="eyebrow">${esc(app.profile.name)}</span></div>
      <nav class="tabs two" role="tablist">
        <button type="button" role="tab" data-tab="test" class="${this.tab === 'test' ? 'active' : ''}" aria-selected="${this.tab === 'test'}">Accuracy test</button>
        <button type="button" role="tab" data-tab="play" class="${this.tab === 'play' ? 'active' : ''}" aria-selected="${this.tab === 'play'}">Play</button>
      </nav>
      ${body}`;
    for (const p of app.profile.pads) app.map.setCount(p.id, '');
    $$('[data-tab]', this.el).forEach((b) =>
      b.addEventListener('click', () => {
        if (this.test && !this.canLeave()) return;
        this.test = null;
        this.tab = b.dataset.tab;
        app.map.highlight(null);
        this.render();
      }),
    );
    $$('[data-act]', this.el).forEach((b) => b.addEventListener('click', () => this.act(b.dataset.act)));
  },

  act(action) {
    switch (action) {
      case 'home':
        go('home');
        break;
      case 'start':
        this.startTest();
        break;
      case 'redo':
        this.redoLast();
        break;
      case 'stop':
        this.test = null;
        app.map.highlight(null);
        this.render();
        break;
      case 'copy':
        copyReport();
        break;
      case 'send':
        sendDataset();
        break;
      case 'download':
        downloadJson(buildDataset(app), `hum-dataset-${Date.now()}.json`);
        break;
    }
  },

  // ------------------------------------------------------------------ test ------

  testHtml() {
    const t = this.test;
    if (t) {
      const pad = this.pad(t.prompts[t.idx]);
      const fb = t.feedback;
      const fbHtml = fb
        ? `<p class="feedback ${fb.ok ? 'ok' : fb.status === 'pad' ? 'bad' : 'unsure'}">${
            fb.ok ? '✓ correct' : fb.status === 'ignored' ? '? heard as a sound to ignore' : fb.status === 'unsure' ? `? not sure (best guess ${esc(fb.heard)})` : `✗ heard ${esc(fb.heard)}`
          } · confidence ${fb.confidence.toFixed(2)}</p>`
        : '<p class="feedback">&nbsp;</p>';
      return `
        <div class="card prompt" aria-live="polite">
          <div class="eyebrow">ACCURACY TEST · ${t.idx + 1} / ${t.prompts.length}</div>
          <div class="big">${esc(pad.label)}</div>
          <div class="sub">${esc(pad.how)}, ${esc(pad.where)}</div>
          <div class="progress"><i style="width:${(t.idx / t.prompts.length) * 100}%"></i></div>
        </div>
        ${fbHtml}
        <div class="row">
          <button class="btn" data-act="redo" ${t.results.length ? '' : 'disabled'}>I tapped the wrong spot — redo</button>
          <button class="btn danger" data-act="stop">Stop test</button>
        </div>
        <p class="muted small">“Redo” is only for <em>your</em> mistakes (wrong spot or tap type). Excluded taps are counted in the report.</p>`;
    }
    const n = TEST_PER_PAD * app.profile.pads.length;
    return `
      ${app.profile.lastTest ? this.resultsHtml(app.profile.lastTest) : ''}
      <div class="card">
        <div class="eyebrow">ACCURACY TEST</div>
        <p>${TEST_PER_PAD} prompted taps per pad (${n} in total), in random order. Tap exactly what the screen asks, about once a second. Hum does not learn from these taps.</p>
        <button class="btn primary big" data-act="start">Start test</button>
      </div>`;
  },

  resultsHtml(lt) {
    const s = lt.summary;
    const lat = latencyStats(lt.results);
    const gate = s.accuracy >= 0.85 ? ['GO', 'ok', '≥ 85%: continue as planned'] : s.accuracy >= 0.7 ? ['REDUCE', 'warn', '70–85%: merge zones, lean on tap type'] : ['PLAN B', 'bad', '< 70%: tap type × rhythm'];
    const extra = [
      s.zoneAccuracy !== null ? `location right ${pct(s.zoneAccuracy)}` : null,
      s.typeAccuracy !== null ? `tap type right ${pct(s.typeAccuracy)}` : null,
      `confident & right ${pct(s.accuracyConfident)}`,
      `not sure ${s.notSure}`,
      s.ignored ? `heard as ignore ${s.ignored}` : null,
      `excluded by you ${s.excludedByUser}`,
    ].filter(Boolean);
    return `
      <div class="card">
        <div class="eyebrow">LAST TEST · ${s.n} taps · trained on ${s.trainingTaps}</div>
        <div class="metric"><span class="num">${pct(s.accuracy)}</span><span class="gate ${gate[1]}">${gate[0]}</span></div>
        <p class="muted small">${gate[2]} (brief §6 gate)</p>
        <p class="mono small">${extra.join(' · ')}</p>
        <p class="mono small">latency avg ${lat.meanMs?.toFixed(0) ?? '–'} ms · p95 ${lat.p95Ms?.toFixed(0) ?? '–'} ms (knock → on screen)</p>
        ${confusionHtml(s, [...app.profile.pads, noneLabel])}
        <div class="row">
          <button class="btn primary" data-act="copy">Copy report</button>
          ${import.meta.env.DEV ? '<button class="btn" data-act="send">Send dataset to laptop</button>' : ''}
          <button class="btn" data-act="download">Download dataset</button>
        </div>
      </div>`;
  },

  startTest() {
    if (!app.model) return toast('Train this table first.');
    const prompts = shuffle(app.profile.pads.flatMap((p) => Array(TEST_PER_PAD).fill(p.id)));
    this.test = { prompts, idx: 0, results: [], excluded: 0, lastAt: 0, startedAt: new Date().toISOString(), feedback: null };
    app.map.highlight(prompts[0]);
    this.render();
  },

  redoLast() {
    const t = this.test;
    if (!t?.results.length) return;
    t.results.pop();
    t.idx--;
    t.excluded++;
    t.feedback = null;
    log('test: last tap excluded by user (tapped the wrong spot)');
    app.map.highlight(t.prompts[t.idx]);
    this.render();
  },

  finishTest() {
    const t = this.test;
    const pads = app.profile.pads;
    const ids = pads.map((p) => p.id);
    const res = t.results;
    const n = res.length;
    // Predictions of "ignore" count as wrong; the matrix gets an IGNORE column when needed.
    const labels = res.some((r) => r.pred === noneLabel.id) ? [...ids, noneLabel.id] : ids;
    const forced = summarise(labels, res.map((r) => r.truth), res.map((r) => r.pred));
    const padOf = (id) => pads.find((p) => p.id === id);
    const zoneOk = res.filter((r) => padOf(r.pred) && padOf(r.truth).zone === padOf(r.pred).zone).length;
    const typeOk = res.filter((r) => padOf(r.pred) && padOf(r.truth).type === padOf(r.pred).type).length;
    app.profile.lastTest = {
      at: t.startedAt,
      results: res,
      summary: {
        n,
        accuracy: forced.accuracy,
        accuracyConfident: n ? res.filter((r) => r.pred === r.truth && r.status === 'pad').length / n : 0,
        notSure: res.filter((r) => r.status === 'unsure').length,
        ignored: res.filter((r) => r.status === 'ignored').length,
        zoneAccuracy: new Set(pads.map((p) => p.zone)).size > 1 ? zoneOk / n : null,
        typeAccuracy: new Set(pads.map((p) => p.type)).size > 1 ? typeOk / n : null,
        excludedByUser: t.excluded,
        trainingTaps: app.profile.samples.length,
        labels: forced.labels,
        matrix: forced.matrix,
        perClass: forced.perClass,
      },
    };
    this.test = null;
    app.map.highlight(null);
    log('test finished', { accuracy: forced.accuracy, n });
    saveProfileSoon();
  },

  // ------------------------------------------------------------------ play ------

  playHtml() {
    const last = this.play[0];
    const main = last
      ? `<div class="big ${last.status === 'pad' ? '' : 'unsure'}">${last.status === 'pad' ? esc(this.pad(last.label).label) : last.status === 'ignored' ? 'Ignored' : 'Not sure'}</div>
         <div class="sub mono">confidence ${last.confidence.toFixed(2)} · distance ratio ${last.distRatio.toFixed(1)}${last.status === 'unsure' ? ` · best guess ${esc(this.pad(last.label).short)}` : ''}</div>
         <div class="sub mono" id="latency"></div>`
      : `<div class="big muted">Tap the table</div><div class="sub">Hum shows which pad it heard.</div>`;
    const hist = this.play
      .slice(1)
      .map((p) => `<li><span>${p.status === 'pad' ? esc(this.pad(p.label).short) : p.status === 'ignored' ? 'ignored' : '?'}</span><span class="mono muted">${p.confidence.toFixed(2)}</span></li>`)
      .join('');
    return `<div class="card prompt" aria-live="polite"><div class="eyebrow">LIVE</div>${main}</div><ul class="history">${hist}</ul>`;
  },

  onLatency(ms) {
    const el = $('#latency', this.el);
    if (el) el.textContent = `latency ${ms.toFixed(0)} ms (knock → on screen)`;
    if (this.tab === 'test' && !this.test && this.justFinished) {
      this.justFinished = false;
      this.render(); // include the final tap's latency in the results
    }
  },

  // ------------------------------------------------------------------ taps ------

  onTap(sample, d) {
    if (!app.model) return null;
    const p = decide(app.model, sample.feats.vec, app.settings);
    const markerLabel = p.status === 'pad' ? this.pad(p.label).short : p.status === 'ignored' ? 'ignore' : '?';
    if (this.tab === 'play') {
      this.play.unshift({ label: p.label, status: p.status, confidence: p.confidence, distRatio: p.distRatio });
      this.play.length = Math.min(this.play.length, 8);
      d.marker.label = markerLabel;
      d.marker.ok = p.status === 'pad' ? true : null;
      app.map.ripple(p.status === 'pad' ? p.label : null, p.status === 'pad' ? 'ok' : 'unsure');
      this.render();
      return { summary: { pred: p.label, status: p.status, confidence: p.confidence, distRatio: p.distRatio } };
    }
    const t = this.test;
    if (!t) return null;
    if (performance.now() - t.lastAt < 300) {
      log('test: extra tap ignored (<300 ms after the previous one)');
      return null;
    }
    const truth = t.prompts[t.idx];
    sample.padId = truth;
    const ok = p.label === truth && p.status === 'pad';
    const record = { truth, pred: p.label, status: p.status, confidence: p.confidence, distRatio: p.distRatio, rejected: p.rejected, latencyMs: null, peakDb: sample.feats.info.peakDb, sample };
    t.results.push(record);
    t.idx++;
    t.lastAt = performance.now();
    t.feedback = { ok, status: p.status, heard: this.pad(p.label)?.label, confidence: p.confidence };
    d.marker.label = markerLabel;
    d.marker.ok = ok;
    app.map.ripple(p.status === 'pad' ? p.label : null, ok ? 'ok' : p.status === 'pad' ? 'bad' : 'unsure');
    if (t.idx >= t.prompts.length) {
      this.finishTest();
      this.justFinished = true;
    } else app.map.highlight(t.prompts[t.idx]);
    this.render();
    return { record, summary: { pred: p.label, status: p.status, confidence: p.confidence, distRatio: p.distRatio, truth } };
  },
};

export async function copyReport() {
  const text = JSON.stringify(buildReport(app));
  if (await copyText(text)) toast('Report copied — paste it to Claude.');
  else {
    downloadJson(JSON.parse(text), `hum-report-${Date.now()}.json`);
    toast('Clipboard blocked — report downloaded instead.');
  }
}

export async function sendDataset() {
  try {
    const r = await sendToLaptop(buildDataset(app));
    toast(`Saved on laptop: data/${r.file}`);
  } catch (e) {
    toast(`Send failed: ${e.message}`);
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
