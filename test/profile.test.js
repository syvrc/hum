import test from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW, preSamples } from '../src/audio/features.js';
import {
  NONE, newProfile, withFeatures, trainModel, decide, selfCheck, advise, assignDefaultPhrases,
  exportProfile, importProfile, hydrate, dehydrate, isReadyToCheck,
} from '../src/profile.js';
import { makePad, makeCommands, patternText } from '../src/pads.js';
import { rng, noise, tap, TAP_CLASSES } from './synth.js';

const SR = 48000;
const SETTINGS = { k: 3, minConfidence: 0.2, maxDistRatio: 4 };

function sampleOf(padId, spec, r) {
  const pre = preSamples(SR);
  const w = noise(WINDOW, 0.0005, r);
  const t = tap(SR, spec, 0.05 * 10 ** ((r() * 12 - 6) / 20), r);
  for (let i = 0; i + pre < WINDOW && i < t.length; i++) w[pre + i] += t[i];
  return withFeatures({ id: `${padId}-${r()}`, padId, sr: SR, pre, channels: [w], accel: null, t: 0 });
}

// Synthetic "ignore" sounds: broadband noise bursts (like a clap or a cup).
function noneSample(r) {
  const pre = preSamples(SR);
  const w = noise(WINDOW, 0.0005, r);
  for (let i = 0; i < 400; i++) w[pre + i] += 0.08 * (r() * 2 - 1) * Math.exp(-i / 150);
  return withFeatures({ id: `n-${r()}`, padId: NONE, sr: SR, pre, channels: [w], accel: null, t: 0 });
}

// Palm and knuckle knocks from varying spots: alternate between two synthetic variants each.
const SPECS = { palm: [TAP_CLASSES.palmLeft, TAP_CLASSES.palmRight], knuckle: [TAP_CLASSES.knuckleNear, TAP_CLASSES.knuckleFar] };

function trainedProfile(seed = 1, withNone = true) {
  const r = rng(seed);
  const p = newProfile('Test table');
  for (const type of ['palm', 'knuckle']) for (let i = 0; i < 8; i++) p.samples.push(sampleOf(type, SPECS[type][i % 2], r));
  if (withNone) for (let i = 0; i < 8; i++) p.samples.push(noneSample(r));
  return { p, r };
}

test('a new profile has palm + knuckle sounds and 6 commands with default phrases', () => {
  const p = assignDefaultPhrases(newProfile('x'));
  assert.deepEqual(p.pads.map((x) => x.id), ['palm', 'knuckle']);
  assert.deepEqual(p.commands.map((c) => c.id), ['palm1', 'knuckle1', 'palm2', 'knuckle2', 'palm3', 'knuckle3']);
  assert.equal(p.commands[0].phrase, 'Yes');
  assert.equal(p.commands[1].phrase, 'No');
  assert.equal(patternText(p.commands[3]), '✊ ×2');
});

test('a trained profile tells palm from knuckle and ignores "not a command" sounds', () => {
  const { p, r } = trainedProfile(1);
  assert.ok(isReadyToCheck(p));
  const model = trainModel(p, SETTINGS);
  const d = decide(model, sampleOf('knuckle', SPECS.knuckle[0], r).feats.vec, SETTINGS);
  assert.equal(d.status, 'pad');
  assert.equal(d.label, 'knuckle');
  const n = decide(model, noneSample(r).feats.vec, SETTINGS);
  assert.equal(n.status, 'ignored');
});

test('self-check reports accuracy, false triggers and separability', () => {
  const { p } = trainedProfile(2);
  const c = selfCheck(p, SETTINGS);
  assert.deepEqual(c.labels, ['palm', 'knuckle', NONE]);
  assert.equal(c.padTotal, 16);
  assert.equal(c.noneTotal, 8);
  assert.ok(c.padAccuracy >= 0.9, `accuracy ${c.padAccuracy}`);
  assert.ok(c.separability.palm > 0 && c.separability.knuckle > 0);
});

test('no model until two classes have examples', () => {
  assert.equal(trainModel(newProfile('x'), SETTINGS), null);
});

test('advice explains a palm/knuckle mix-up and offers a retrain', () => {
  const pads = ['palm', 'knuckle'].map(makePad);
  const adv = advise({ labels: ['palm', 'knuckle'], matrix: [[6, 2], [3, 5]] }, pads);
  assert.equal(adv.length, 1);
  assert.match(adv[0].text, /PALM and KNUCKLE sound alike \(31% mixed up\)/);
  assert.deepEqual(adv[0].fixes.map((f) => f.action), ['retrain']);
});

test('old location-based tables are recognised as legacy', () => {
  const stored = { id: 'old', name: 'Old', pads: [{ id: 'left:palm' }, { id: 'right:knuckle' }], samples: [] };
  const p = hydrate(stored);
  assert.equal(p.legacy, true);
  assert.equal(p.commands.length, 0);
  assert.equal(p.pads[0].label, 'LEFT · PALM');
});

test('export → import round-trips a profile (as a new copy) with its phrases', () => {
  const { p } = trainedProfile(4);
  assignDefaultPhrases(p);
  p.commands[2].phrase = 'Water please';
  p.commands[2].clipId = 'clip-1';
  const json = JSON.parse(JSON.stringify(exportProfile(p)));
  const q = importProfile(json);
  assert.notEqual(q.id, p.id);
  assert.equal(q.samples.length, p.samples.length);
  assert.equal(q.commands[2].phrase, 'Water please');
  assert.equal(q.commands[2].clipId, undefined); // clips stay on the phone
  for (let i = 0; i < 20; i++) assert.ok(Math.abs(q.samples[0].feats.vec[i] - p.samples[0].feats.vec[i]) < 0.5);
  assert.throws(() => importProfile({ kind: 'something-else' }), /not a Hum profile/);
});

test('dehydrate → hydrate keeps command settings', () => {
  const p = newProfile('x');
  p.commands[0].phrase = 'Hello';
  p.commands[0].remote = 'next';
  const q = hydrate(dehydrate(p));
  assert.equal(q.commands[0].phrase, 'Hello');
  assert.equal(q.commands[0].remote, 'next');
  assert.equal(q.commands.length, makeCommands().length);
});
