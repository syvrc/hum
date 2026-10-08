// Offline analysis of datasets exported from the phone ("Send dataset to laptop" or
// "Download dataset"). Uses the *same* feature + k-NN code as the app, so numbers here
// match what the phone would compute.
//
//   node tools/analyze.js data/hum-....json [more.json ...] [--wav]
//
// Prints: train LOO, train→test accuracy, per-feature-group ablation, k sweep, and
// basic signal stats. --wav also writes every tap into one WAV (with gaps) to listen to.

import fs from 'node:fs';
import path from 'node:path';
import { extractFeatures, dimWeights, GROUPS, FEATURE_VERSION } from '../src/audio/features.js';
import { KNN, leaveOneOut, summarise } from '../src/ml/knn.js';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const wantWav = args.includes('--wav');
if (!files.length) {
  console.log('usage: node tools/analyze.js data/hum-*.json [--wav]');
  process.exit(1);
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;

function decode(b64) {
  const buf = Buffer.from(b64, 'base64');
  const i16 = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  return Float32Array.from(i16, (v) => v / 32767);
}

for (const file of files) {
  const ds = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`\n=== ${path.basename(file)} ===`);
  console.log(`${ds.profile?.name || ds.preset} · pads ${ds.pads.join(', ')} · ${ds.taps.length} taps · recorded with feature v${ds.featureVersion}, analysing with v${FEATURE_VERSION}`);
  console.log(`device: ${ds.device?.sampleRate} Hz, ${ds.device?.channels} ch, motion ${ds.device?.motion} · ${ds.device?.ua}`);

  const taps = ds.taps.map((t) => {
    const channels = t.audio.map(decode);
    const f = extractFeatures(channels, t.sr, { pre: t.pre, accel: t.accel });
    return { ...t, channels, vec: f.vec, info: f.info };
  });
  const train = taps.filter((t) => t.set === 'train');
  const test = taps.filter((t) => t.set === 'test');
  // "__none" = the "not a command" class (sounds to ignore), present when recorded.
  const labels = taps.some((t) => t.truth === '__none') ? [...ds.pads, '__none'] : ds.pads;

  const stereoReal = taps.filter((t) => t.info.stereoReal).length;
  console.log(`stereo really different on ${stereoReal}/${taps.length} taps · accel present on ${taps.filter((t) => t.accel).length}/${taps.length} · clipped taps ${taps.filter((t) => t.info.clipped > 0).length}/${taps.length}`);
  for (const l of labels) {
    const p = taps.filter((t) => t.truth === l).map((t) => t.info.peakDb);
    const c = taps.filter((t) => t.truth === l).map((t) => t.info.centroidHz);
    const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    console.log(`  ${l.padEnd(14)} n=${String(p.length).padStart(3)}  peak ${avg(p).toFixed(1)} dBFS (min ${Math.min(...p).toFixed(1)})  centroid ${avg(c).toFixed(0)} Hz`);
  }

  const evaluate = (weights, k = 3) => {
    const opts = { k, dimWeights: weights };
    const out = {};
    if (train.length) out.loo = leaveOneOut(train.map((t) => t.vec), train.map((t) => t.truth), { ...opts, labels }).accuracy;
    if (train.length && test.length) {
      const m = new KNN(opts).fit(train.map((t) => t.vec), train.map((t) => t.truth));
      const preds = test.map((t) => m.predict(t.vec).label);
      out.test = summarise(labels, test.map((t) => t.truth), preds);
    }
    const all = [...train, ...test];
    out.looAll = leaveOneOut(all.map((t) => t.vec), all.map((t) => t.truth), { ...opts, labels }).accuracy;
    return out;
  };

  const base = evaluate(dimWeights());
  console.log(`\nbaseline (k=3): train LOO ${pct(base.loo ?? 0)}${base.test ? ` · train→test ${pct(base.test.accuracy)}` : ''} · LOO on all taps ${pct(base.looAll)}`);
  if (base.test) {
    console.log('confusion (rows truth, cols predicted):');
    console.log(`  ${''.padEnd(14)}${labels.map((l) => l.slice(0, 9).padStart(10)).join('')}`);
    base.test.matrix.forEach((row, i) => console.log(`  ${labels[i].padEnd(14)}${row.map((v) => String(v).padStart(10)).join('')}`));
  }

  console.log('\nfeature-group ablation (LOO on all taps):');
  for (const g of GROUPS) {
    const without = evaluate(dimWeights({ [g.name]: 0 })).looAll;
    const only = evaluate(dimWeights(Object.fromEntries(GROUPS.map((x) => [x.name, x.name === g.name ? 1 : 0])))).looAll;
    console.log(`  ${g.name.padEnd(10)} default w=${g.weight}  without: ${pct(without).padStart(6)}  alone: ${pct(only).padStart(6)}`);
  }
  console.log('\nk sweep (LOO on all taps):', [1, 3, 5, 7].map((k) => `k=${k} ${pct(evaluate(dimWeights(), k).looAll)}`).join(' · '));

  if (wantWav) {
    const sr = taps[0].sr;
    const gap = Math.round(sr * 0.25);
    const total = taps.reduce((s, t) => s + t.channels[0].length + gap, 0);
    const pcm = new Int16Array(total);
    let o = 0;
    for (const t of taps) {
      for (let i = 0; i < t.channels[0].length; i++) pcm[o + i] = Math.max(-32768, Math.min(32767, Math.round(t.channels[0][i] * 32767)));
      o += t.channels[0].length + gap;
    }
    const out = file.replace(/\.json$/, '.wav');
    fs.writeFileSync(out, wav(pcm, sr));
    console.log(`\nwrote ${out} (${taps.length} taps, channel 0, in recorded order: ${taps.map((t) => t.truth).slice(0, 6).join(', ')}, ...)`);
  }
}

function wav(pcm, sr) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + pcm.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer).copy(b, 44);
  return b;
}
