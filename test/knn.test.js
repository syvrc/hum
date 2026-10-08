import test from 'node:test';
import assert from 'node:assert/strict';
import { KNN, leaveOneOut, summarise } from '../src/ml/knn.js';
import { rng, gauss } from './synth.js';

function clusters(seed, perClass = 8) {
  const r = rng(seed);
  const centres = { a: [0, 0, 100], b: [5, 0, 100], c: [0, 5, 100], d: [5, 5, 100] };
  const X = [];
  const y = [];
  for (const [label, c] of Object.entries(centres)) {
    for (let i = 0; i < perClass; i++) {
      // 3rd feature is constant: it must be ignored, not divide by zero.
      X.push([c[0] + 0.6 * gauss(r), c[1] + 0.6 * gauss(r), 100]);
      y.push(label);
    }
  }
  return { X, y };
}

test('k-NN separates clear clusters and LOO reports 100%', () => {
  const { X, y } = clusters(1);
  const loo = leaveOneOut(X, y, { k: 3 });
  assert.equal(loo.accuracy, 1);
  assert.equal(loo.matrix.flat().reduce((a, b) => a + b, 0), X.length);
  const m = new KNN({ k: 3 }).fit(X, y);
  const p = m.predict([5.1, 4.9, 100]);
  assert.equal(p.label, 'd');
  assert.ok(p.confidence > 0.9);
  assert.ok(p.distRatio < 3);
});

test('a sound unlike anything taught gets a large distance ratio', () => {
  const { X, y } = clusters(2);
  const m = new KNN({ k: 3 }).fit(X, y);
  const p = m.predict([40, -30, 100]);
  assert.ok(p.distRatio > 5, `ratio ${p.distRatio}`);
});

test('ambiguous point between two classes has low confidence', () => {
  const { X, y } = clusters(3);
  const p = new KNN({ k: 5 }).fit(X, y).predict([2.5, 0, 100]);
  assert.ok(p.confidence < 0.7, `confidence ${p.confidence}`);
});

test('dimension weights of zero switch a feature off', () => {
  const X = [[0, 0], [0, 10], [1, 0], [1, 10]];
  const y = ['a', 'a', 'b', 'b'];
  // Only feature 0 separates the classes; feature 1 is noise with a huge spread.
  const m = new KNN({ k: 1, dimWeights: [1, 0] }).fit(X, y);
  assert.equal(m.predict([0.9, 0]).label, 'b');
});

test('summarise builds a confusion matrix', () => {
  const s = summarise(['x', 'y'], ['x', 'x', 'y', 'y'], ['x', 'y', 'y', 'y']);
  assert.deepEqual(s.matrix, [[1, 1], [0, 2]]);
  assert.equal(s.accuracy, 0.75);
  assert.equal(s.perClass.x, 0.5);
});
