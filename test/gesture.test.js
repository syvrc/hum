import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessController } from '../src/gesture.js';

// A fake clock + timer queue so tests run instantly and deterministically.
function harness(opts = {}) {
  let now = 0;
  let timers = [];
  let id = 0;
  const log = [];
  const ctl = new AccessController(
    {
      ...opts,
      now: () => now,
      setTimer: (fn, ms) => {
        const t = { id: ++id, at: now + ms, fn };
        timers.push(t);
        return t.id;
      },
      clearTimer: (tid) => (timers = timers.filter((t) => t.id !== tid)),
    },
    {
      preview: (p) => log.push(`preview ${p}`),
      clearPreview: () => log.push('clear'),
      speak: (p) => log.push(`speak ${p}`),
      unsure: (s) => log.push(`unsure ${s}`),
    },
  );
  // Advance time, firing due timers in order. A knock is reported 80 ms after it happens.
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  const knock = (label, status = 'pad') => {
    const t = now;
    advance(80);
    ctl.tap({ label, status, t });
  };
  return { ctl, log, advance, knock };
}

test('confirm mode: knock previews instantly, double-knock anywhere speaks it', () => {
  const h = harness();
  h.knock('A');
  assert.deepEqual(h.log, ['preview A']); // no waiting from idle
  h.advance(1000);
  h.knock('B'); // first knock of a double, on a different pad
  h.advance(150);
  h.knock('C', 'unsure'); // second knock — its classification doesn't matter
  h.advance(600);
  assert.deepEqual(h.log, ['preview A', 'clear', 'speak A']);
});

test('confirm mode: a single knock while previewing switches the preview (after the double-knock window)', () => {
  const h = harness();
  h.knock('A');
  h.advance(1000);
  h.knock('B');
  assert.deepEqual(h.log, ['preview A']); // waits: B might be the start of a double-knock
  h.advance(600);
  assert.deepEqual(h.log, ['preview A', 'preview B']);
});

test('confirm mode: preview cancels after 4 s', () => {
  const h = harness();
  h.knock('A');
  h.advance(4100);
  assert.deepEqual(h.log, ['preview A', 'clear']);
});

test('confirm mode: a double-knock from idle only previews (tremor bounce cannot speak)', () => {
  const h = harness();
  h.knock('A');
  h.advance(120);
  h.knock('A');
  h.advance(1000);
  assert.deepEqual(h.log, ['preview A']);
});

test('confirm mode: knocks further apart than 350 ms are two singles, not a double', () => {
  const h = harness();
  h.knock('A');
  h.advance(1000);
  h.knock('A');
  h.advance(400);
  h.knock('A');
  h.advance(1000);
  assert.ok(!h.log.some((l) => l.startsWith('speak')), h.log.join(', '));
});

test('"not a command" sounds never take part; unsure knocks give feedback', () => {
  const h = harness();
  h.knock('x', 'ignored');
  h.knock('y', 'unsure');
  assert.deepEqual(h.log, ['unsure unsure']);
});

test('confirm OFF: a knock on a pad speaks immediately', () => {
  const h = harness({ confirm: false });
  h.knock('A');
  h.knock('B', 'unsure');
  assert.deepEqual(h.log, ['speak A', 'unsure unsure']);
});
