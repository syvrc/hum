// Lab: measure the active table honestly (randomised, prompted accuracy test of the 6
// knock patterns) and play with live recognition. Test knocks are never added to the
// training data.
//
// Reported separately, so we know WHAT fails if something does:
//   pattern accuracy — the whole command right (type AND count)
//   knock-type accuracy — each single knock's palm/knuckle classification
//   count accuracy — how often the number of knocks was right

import { app, go, saveProfileSoon } from '../app.js';
import { decide } from '../profile.js';
import { RhythmController } from '../gesture.js';
import { TAP_TYPES, commandId, patternText, patternWords } from '../pads.js';
import { summarise } from '../ml/knn.js';
import { confusionHtml } from '../ui/confusion.js';
import { $, $$, esc, pct, toast } from '../ui/dom.js';
import { buildReport, buildDataset, copyText, downloadJson, sendToLaptop, latencyStats } from '../report.js';
import { log } from '../ui/log.js';

const TEST_PER_COMMAND = 8;
const NEXT_PROMPT_PAUSE_MS = 700; // knocks in this pause are ignored, so they can't leak into the next prompt
const NO_CMD = 'nocmd';

export const lab = {
  instrument: true,

  mount(el, { tab = 'test' } = {}) {
    this.el = el;
    this.tab = tab;
    this.test = null;
    this.play = [];
    app.map.setPads(app.profile.pads);
    this.ctl = new RhythmController(
      { confirm: false, gapMs: app.access.gapMs },
      {
        count: (n, type) => this.live(n, type),
        command: (cmd) => this.result(commandId(cmd.type, cmd.count)),
        unsure: (why) => this.result(NO_CMD, why === 'mixed' ? 'mixed types' : 'unclear'),
        tooMany: (n) => this.result(NO_CMD, `${n} knocks`),
        sos: () => this.result(NO_CMD, 'SOS pattern'),
      },
    );
    this.render();
  },

  unmount() {
    this.ctl.dispose();
    app.map.highlight(null);
  },

  canLeave() {
    return !this.test || confirm('Stop the accuracy test? Results so far will be lost.');
  },

  cmd(id) {
    return app.profile.commands.find((c) => c.id === id);
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

  live(n, type) {
    const text = `${type ? TAP_TYPES[type].icon : '?'} ×${n}`;
    app.map.showPattern(text);
    const el = $('#liveCount', this.el);
    if (el) el.textContent = `heard so far: ${text} …`;
  },

  // ------------------------------------------------------------------ test ------

  testHtml() {
    const t = this.test;
    if (t) {
      const c = this.cmd(t.prompts[t.idx]);
      const fb = t.feedback;
      const fbHtml = fb
        ? `<p class="feedback ${fb.ok ? 'ok' : fb.pred === NO_CMD ? 'unsure' : 'bad'}">${
            fb.ok ? `✓ ${esc(fb.text)}` : fb.pred === NO_CMD ? `? no command (${esc(fb.why)})` : `✗ heard ${esc(fb.text)}`
          }</p>`
        : '<p class="feedback">&nbsp;</p>';
      return `
        <div class="card prompt" aria-live="polite">
          <div class="eyebrow">ACCURACY TEST · ${t.idx + 1} / ${t.prompts.length}</div>
          <div class="big">${patternText(c)}</div>
          <div class="sub">${esc(patternWords(c))} — ${esc(TAP_TYPES[c.type].how)}, anywhere</div>
          <div class="sub mono" id="liveCount">&nbsp;</div>
          <div class="progress"><i style="width:${(t.idx / t.prompts.length) * 100}%"></i></div>
        </div>
        ${fbHtml}
        <div class="row">
          <button class="btn" data-act="redo" ${t.results.length ? '' : 'disabled'}>I knocked the wrong pattern — redo</button>
          <button class="btn danger" data-act="stop">Stop test</button>
        </div>
        <p class="muted small">“Redo” is only for <em>your</em> mistakes. Excluded attempts are counted in the report.</p>`;
    }
    const n = TEST_PER_COMMAND * app.profile.commands.length;
    return `
      ${app.profile.lastTest?.kind === 'rhythm' ? this.resultsHtml(app.profile.lastTest) : ''}
      <div class="card">
        <div class="eyebrow">ACCURACY TEST</div>
        <p>${TEST_PER_COMMAND} prompts per pattern (${n} in total), in random order. Knock exactly the pattern shown, anywhere on the table, then wait for the next one. Hum does not learn from these knocks.</p>
        <button class="btn primary big" data-act="start">Start test</button>
      </div>`;
  },

  resultsHtml(lt) {
    const s = lt.summary;
    const lat = latencyStats(lt.results);
    const tapLat = latencyStats(lt.taps);
    const gate = s.accuracy >= 0.85 ? ['GO', 'ok', '≥ 85%: continue as planned'] : s.accuracy >= 0.7 ? ['REDUCE', 'warn', '70–85%: simplify (fewer patterns)'] : ['RETHINK', 'bad', '< 70%: needs a rethink'];
    const named = [...app.profile.commands.map((c) => ({ id: c.id, short: patternText(c) })), { id: NO_CMD, short: 'none' }];
    return `
      <div class="card">
        <div class="eyebrow">LAST TEST · ${s.n} patterns · ${s.knocks} knocks · trained on ${s.trainingTaps}</div>
        <div class="metric"><span class="num">${pct(s.accuracy)}</span><span class="gate ${gate[1]}">${gate[0]}</span></div>
        <p class="muted small">patterns fully right · ${gate[2]}</p>
        <p class="mono small">single knocks: palm/knuckle right ${pct(s.tapTypeAccuracy)} · knock count right ${pct(s.countAccuracy)} · no command ${s.noCommand} · excluded by you ${s.excludedByUser}</p>
        <p class="mono small">knock → on screen avg ${tapLat.meanMs?.toFixed(0) ?? '–'} ms · last knock → command avg ${lat.meanMs?.toFixed(0) ?? '–'} ms (includes the ${app.access.gapMs} ms pause that ends a pattern)</p>
        ${confusionHtml(s, named)}
        <div class="row">
          <button class="btn primary" data-act="copy">Copy report</button>
          ${import.meta.env.DEV ? '<button class="btn" data-act="send">Send dataset to laptop</button>' : ''}
          <button class="btn" data-act="download">Download dataset</button>
        </div>
      </div>`;
  },

  startTest() {
    if (!app.model) return toast('Set up this table first.');
    const prompts = shuffle(app.profile.commands.flatMap((c) => Array(TEST_PER_COMMAND).fill(c.id)));
    this.ctl.dispose();
    this.test = { prompts, idx: 0, results: [], taps: [], current: [], excluded: 0, lockedUntil: 0, startedAt: new Date().toISOString(), feedback: null };
    this.render();
  },

  /** A pattern was decided (or rejected) while a prompt was showing. */
  result(pred, why = '') {
    const t = this.test;
    if (this.tab === 'play' || !t) return this.playResult(pred, why);
    const truth = t.prompts[t.idx];
    const knocks = t.current;
    t.current = [];
    const last = knocks.at(-1);
    const record = { truth, pred, why, knocks: knocks.length, latencyMs: last ? performance.now() - last.onsetWall : null };
    t.results.push(record);
    for (const k of knocks) t.taps.push({ ...k, truth: this.cmd(truth).type });
    const ok = pred === truth;
    t.feedback = { ok, pred, why, text: pred === NO_CMD ? '' : patternText(this.cmd(pred)) };
    t.idx++;
    t.lockedUntil = performance.now() + NEXT_PROMPT_PAUSE_MS;
    if (t.idx >= t.prompts.length) this.finishTest();
    this.render();
  },

  redoLast() {
    const t = this.test;
    if (!t?.results.length) return;
    const r = t.results.pop();
    t.taps.splice(t.taps.length - r.knocks, r.knocks);
    t.idx--;
    t.excluded++;
    t.feedback = null;
    log('test: last attempt excluded by user');
    this.render();
  },

  finishTest() {
    const t = this.test;
    const cmds = app.profile.commands;
    const labels = [...cmds.map((c) => c.id), NO_CMD];
    const res = t.results;
    const forced = summarise(labels, res.map((r) => r.truth), res.map((r) => r.pred));
    const decided = res.filter((r) => r.pred !== NO_CMD);
    app.profile.lastTest = {
      kind: 'rhythm',
      at: t.startedAt,
      results: res,
      taps: t.taps,
      summary: {
        n: res.length,
        knocks: t.taps.length,
        accuracy: forced.accuracy,
        tapTypeAccuracy: t.taps.length ? t.taps.filter((k) => k.pred === k.truth).length / t.taps.length : 0,
        countAccuracy: res.length ? res.filter((r) => r.knocks === this.cmd(r.truth).count).length / res.length : 0,
        typeOfDecided: decided.length ? decided.filter((r) => this.cmd(r.pred).type === this.cmd(r.truth).type).length / decided.length : null,
        noCommand: res.length - decided.length,
        excludedByUser: t.excluded,
        trainingTaps: app.profile.samples.length,
        gapMs: app.access.gapMs,
        labels: forced.labels,
        matrix: forced.matrix,
        perClass: forced.perClass,
      },
    };
    this.test = null;
    log('test finished', { accuracy: forced.accuracy, n: res.length });
    saveProfileSoon();
  },

  // ------------------------------------------------------------------ play ------

  playHtml() {
    const last = this.play[0];
    const main = last
      ? last.pred === NO_CMD
        ? `<div class="big unsure">No command</div><div class="sub mono">${esc(last.why)}</div>`
        : `<div class="big">${patternText(this.cmd(last.pred))}</div><div class="sub">“${esc(this.cmd(last.pred).phrase)}”</div>`
      : `<div class="big muted">Knock a pattern</div><div class="sub">✋ or ✊, once to three times — Hum shows what it recognised (it doesn't speak here).</div>`;
    const hist = this.play
      .slice(1)
      .map((p) => `<li><span>${p.pred === NO_CMD ? `? ${esc(p.why)}` : patternText(this.cmd(p.pred))}</span><span class="mono muted">${p.pred === NO_CMD ? '' : esc(this.cmd(p.pred).phrase)}</span></li>`)
      .join('');
    return `<div class="card prompt" aria-live="polite"><div class="eyebrow">LIVE</div>${main}<div class="sub mono" id="liveCount">&nbsp;</div></div><ul class="history">${hist}</ul>`;
  },

  playResult(pred, why) {
    this.play.unshift({ pred, why });
    this.play.length = Math.min(this.play.length, 8);
    if (this.tab === 'play') this.render();
  },

  // ------------------------------------------------------------------ knocks ----

  onTap(sample, d) {
    if (!app.model) return null;
    const t = this.test;
    if (this.tab === 'test' && (!t || performance.now() < t.lockedUntil)) return null;
    const p = decide(app.model, sample.feats.vec, app.settings);
    d.marker.label = p.status === 'pad' ? TAP_TYPES[p.label]?.label : p.status === 'ignored' ? 'ignore' : '?';
    d.marker.ok = p.status === 'pad' ? true : null;
    app.map.ripple(p.status === 'pad' ? p.label : null, p.status === 'pad' ? 'ok' : 'unsure');
    const record = { pred: p.status === 'pad' ? p.label : p.status, status: p.status, confidence: p.confidence, distRatio: p.distRatio, peakDb: sample.feats.info.peakDb, onsetWall: d.onsetWall, latencyMs: null, sample };
    if (t && p.status !== 'ignored') t.current.push(record);
    this.ctl.tap({ label: p.label, status: p.status, confidence: p.confidence, t: d.onsetWall });
    return { record, summary: { pred: p.label, status: p.status, confidence: p.confidence, distRatio: p.distRatio } };
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
