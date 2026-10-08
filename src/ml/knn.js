// k-Nearest-Neighbours classifier with z-score normalisation.
//
// Why k-NN?
// - It "trains" instantly: training is just remembering your example taps.
// - It works with 6–8 examples per pad, where neural networks would overfit.
// - It is explainable: "this knock sounded most like these 3 knocks you taught me".
//
// How a prediction works:
// 1. Normalise every feature with the training set's mean and spread (z-score), so a
//    feature measured in Hz doesn't drown out one measured in dB.
// 2. Multiply by per-feature weights (see features.js GROUPS).
// 3. Find the k closest training taps; each votes for its pad with weight 1/distance.
// 4. Confidence = vote margin between the winner and the runner-up (0..1).
// 5. "Distance ratio" = how far the nearest same-pad example is, compared with how
//    far apart that pad's own examples usually are. A big ratio means "this sounds
//    like nothing you taught me" → the app can say "not sure" instead of guessing.

export const KNN_DEFAULTS = Object.freeze({ k: 3, zClip: 6 });

export class KNN {
  constructor(opts = {}) {
    this.k = opts.k ?? KNN_DEFAULTS.k;
    this.zClip = opts.zClip ?? KNN_DEFAULTS.zClip;
    this.dimWeights = opts.dimWeights || null;
  }

  /**
   * @param {ArrayLike<number>[]} X feature vectors
   * @param {string[]} y labels
   */
  fit(X, y) {
    if (X.length !== y.length || X.length === 0) throw new Error('KNN.fit needs matching, non-empty X and y');
    const n = X.length;
    const d = X[0].length;
    const mean = new Float64Array(d);
    const std = new Float64Array(d);
    for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n;
    for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / n;
    // Features that never vary in the training set carry no information → weight 0.
    const weight = new Float64Array(d);
    for (let j = 0; j < d; j++) {
      std[j] = Math.sqrt(std[j]);
      const w = this.dimWeights ? this.dimWeights[j] : 1;
      weight[j] = std[j] > 1e-9 && w > 0 ? w : 0;
    }
    this.mean = mean;
    this.std = std;
    this.weight = weight;
    this.dim = d;
    this.labels = [...new Set(y)];
    this.y = y.slice();
    this.Z = X.map((x) => this.transform(x));

    // Typical spacing inside each class: median distance from each example to its
    // nearest same-class neighbour. Used for the "sounds like nothing I know" check.
    this.classSpacing = {};
    for (const label of this.labels) {
      const idx = [];
      this.y.forEach((l, i) => l === label && idx.push(i));
      const nn = [];
      for (const i of idx) {
        let best = Infinity;
        for (const j of idx) if (j !== i) best = Math.min(best, dist(this.Z[i], this.Z[j]));
        if (best < Infinity) nn.push(best);
      }
      this.classSpacing[label] = nn.length ? median(nn) : NaN;
    }
    return this;
  }

  /** Normalise + weight one raw feature vector. */
  transform(x) {
    const z = new Float64Array(this.dim);
    for (let j = 0; j < this.dim; j++) {
      if (this.weight[j] === 0) continue;
      // Clip extreme z-scores so one freak feature can't dominate the distance.
      let v = (x[j] - this.mean[j]) / this.std[j];
      if (v > this.zClip) v = this.zClip;
      else if (v < -this.zClip) v = -this.zClip;
      z[j] = v * this.weight[j];
    }
    return z;
  }

  /** Classify one raw feature vector. */
  predict(x) {
    const z = this.transform(x);
    const k = Math.min(this.k, this.Z.length);
    // Keep the k nearest (n is small — tens to a few hundred — so a simple insert is fine).
    const near = [];
    for (let i = 0; i < this.Z.length; i++) {
      const dd = dist(z, this.Z[i]);
      if (near.length < k || dd < near[near.length - 1].d) {
        near.push({ i, d: dd, label: this.y[i] });
        near.sort((a, b) => a.d - b.d);
        if (near.length > k) near.pop();
      }
    }
    const votes = {};
    let total = 0;
    for (const nb of near) {
      const w = 1 / (nb.d + 1e-6);
      votes[nb.label] = (votes[nb.label] || 0) + w;
      total += w;
    }
    const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const [label, wBest] = ranked[0];
    const wSecond = ranked[1] ? ranked[1][1] : 0;
    const confidence = total > 0 ? (wBest - wSecond) / total : 0;
    const nnDist = Math.min(...near.filter((nb) => nb.label === label).map((nb) => nb.d));
    const spacing = this.classSpacing[label];
    const distRatio = spacing > 0 ? nnDist / spacing : 1;
    return {
      label,
      confidence,
      distRatio,
      nnDist,
      votes: Object.fromEntries(ranked.map(([l, w]) => [l, w / total])),
      neighbours: near.map((nb) => ({ index: nb.i, label: nb.label, d: nb.d })),
    };
  }
}

/**
 * Leave-one-out cross-validation: for every example, train on all the *others* and
 * check whether it is classified correctly. An honest accuracy estimate that doesn't
 * need extra test taps. Normalisation is re-fitted in every fold (no peeking).
 */
export function leaveOneOut(X, y, opts = {}) {
  const labels = opts.labels || [...new Set(y)];
  const predictions = [];
  for (let i = 0; i < X.length; i++) {
    const Xtr = X.filter((_, j) => j !== i);
    const ytr = y.filter((_, j) => j !== i);
    if (new Set(ytr).size < 1) continue;
    const p = new KNN(opts).fit(Xtr, ytr).predict(X[i]);
    predictions.push({ index: i, truth: y[i], ...p });
  }
  return summarise(labels, predictions.map((p) => p.truth), predictions.map((p) => p.label), predictions);
}

/** Accuracy, per-class recall and confusion matrix (rows = truth, columns = predicted). */
export function summarise(labels, truths, preds, predictions = null) {
  const idx = new Map(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => new Array(labels.length).fill(0));
  let correct = 0;
  for (let i = 0; i < truths.length; i++) {
    const t = idx.get(truths[i]);
    const p = idx.get(preds[i]);
    if (t === undefined || p === undefined) continue;
    matrix[t][p]++;
    if (t === p) correct++;
  }
  const perClass = {};
  labels.forEach((l, i) => {
    const row = matrix[i].reduce((a, b) => a + b, 0);
    perClass[l] = row ? matrix[i][i] / row : null;
  });
  return { labels, matrix, correct, total: truths.length, accuracy: truths.length ? correct / truths.length : 0, perClass, predictions };
}

function dist(a, b) {
  let s = 0;
  for (let j = 0; j < a.length; j++) {
    const d = a[j] - b[j];
    s += d * d;
  }
  return Math.sqrt(s);
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}
