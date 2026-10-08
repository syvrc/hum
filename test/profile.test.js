import test from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW, preSamples } from '../src/audio/features.js';
import {
  NONE, newProfile, withFeatures, trainModel, decide, selfCheck, advise, alternativeType,
  changePad, removePad, exportProfile, importProfile, hydrate, dehydrate, countFor, isReadyToCheck,
} from '../src/profile.js';
import { makePad } from '../src/pads.js';
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

function trainedProfile(seed = 1, withNone = true) {
  const r = rng(seed);
  const p = newProfile('Test table', ['left:palm', 'right:palm', 'near:knuckle', 'far:knuckle']);
  const specs = { 'left:palm': TAP_CLASSES.palmLeft, 'right:palm': TAP_CLASSES.palmRight, 'near:knuckle': TAP_CLASSES.knuckleNear, 'far:knuckle': TAP_CLASSES.knuckleFar };
  for (const [id, spec] of Object.entries(specs)) for (let i = 0; i < 8; i++) p.samples.push(sampleOf(id, spec, r));
  if (withNone) for (let i = 0; i < 8; i++) p.samples.push(noneSample(r));
  return { p, r, specs };
}

test('a trained profile classifies taps and ignores "not a command" sounds', () => {
  const { p, r, specs } = trainedProfile(1);
  assert.ok(isReadyToCheck(p));
  const model = trainModel(p, SETTINGS);
  const d = decide(model, sampleOf('near:knuckle', specs['near:knuckle'], r).feats.vec, SETTINGS);
  assert.equal(d.status, 'pad');
  assert.equal(d.label, 'near:knuckle');
  const n = decide(model, noneSample(r).feats.vec, SETTINGS);
  assert.equal(n.status, 'ignored');
  assert.equal(n.rejected, true);
});

test('self-check reports pad accuracy, false triggers and separability', () => {
  const { p } = trainedProfile(2);
  const c = selfCheck(p, SETTINGS);
  assert.equal(c.labels.at(-1), NONE);
  assert.equal(c.padTotal, 32);
  assert.equal(c.noneTotal, 8);
  assert.ok(c.padAccuracy >= 0.9, `pad accuracy ${c.padAccuracy}`);
  for (const id of p.pads.map((x) => x.id)) assert.ok(c.separability[id] > 0, `${id} separability ${c.separability[id]}`);
});

test('no model until two classes have examples', () => {
  const p = newProfile('x', ['left:palm', 'right:palm']);
  assert.equal(trainModel(p, SETTINGS), null);
});

test('advice names confused pairs and offers one-tap fixes', () => {
  const pads = ['left:palm', 'near:palm', 'far:knuckle'].map(makePad);
  const loo = { labels: pads.map((x) => x.id), matrix: [[6, 2, 0], [3, 5, 0], [0, 0, 8]] };
  const adv = advise(loo, pads);
  assert.equal(adv.length, 1);
  assert.match(adv[0].text, /LEFT · PALM and NEAR · PALM sound alike \(31% mixed up\)/);
  const change = adv[0].fixes.find((f) => f.action === 'changeType');
  assert.equal(change.type, 'knuckle'); // palm's most different sound
  assert.ok(adv[0].fixes.some((f) => f.action === 'remove'));
});

test('alternative tap type skips types already used in that zone', () => {
  const pads = ['right:palm', 'right:knuckle'].map(makePad);
  assert.equal(alternativeType(pads, pads[0]), 'nail');
});

test('changing or removing a pad drops its examples', () => {
  const { p } = trainedProfile(3, false);
  assert.ok(changePad(p, 'far:knuckle', 'far', 'nail'));
  assert.equal(countFor(p, 'far:knuckle'), 0);
  assert.equal(p.pads[3].label, 'FAR · NAIL');
  assert.equal(changePad(p, 'far:nail', 'left', 'palm'), false); // already exists
  removePad(p, 'far:nail');
  assert.equal(p.pads.length, 3);
});

test('export → import round-trips a profile (as a new copy)', () => {
  const { p } = trainedProfile(4);
  const json = JSON.parse(JSON.stringify(exportProfile(p)));
  const q = importProfile(json);
  assert.notEqual(q.id, p.id);
  assert.equal(q.samples.length, p.samples.length);
  assert.deepEqual(q.pads.map((x) => x.label), p.pads.map((x) => x.label));
  // int16 storage changes features only slightly
  for (let i = 0; i < 20; i++) assert.ok(Math.abs(q.samples[0].feats.vec[i] - p.samples[0].feats.vec[i]) < 0.5);
  assert.throws(() => importProfile({ kind: 'something-else' }), /not a Hum profile/);
});

test('dehydrate → hydrate keeps custom pad fields and drops derived ones', () => {
  const p = newProfile('x', ['left:palm']);
  p.pads[0].phrase = 'I need water';
  const stored = dehydrate(p);
  assert.deepEqual(Object.keys(stored.pads[0]).sort(), ['id', 'phrase']);
  assert.equal(hydrate(stored).pads[0].label, 'LEFT · PALM');
});
