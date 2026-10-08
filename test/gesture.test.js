import test from 'node:test';
import assert from 'node:assert/strict';
import { RhythmController, vote } from '../src/gesture.js';

// A fake clock + timer queue so tests run instantly and deterministically.
function harness(opts = {}) {
  let now = 0;
  let timers = [];
  let id = 0;
  const log = [];
  const ctl = new RhythmController(
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
      command: (c) => log.push(`command ${c.type}x${c.count}`),
      ask: (c) => log.push(`ask ${c.type}x${c.count}`),
      answer: (k, c) => log.push(`answer ${k} ${c.type}x${c.count}`),
      unsure: (r) => log.push(`unsure ${r}`),
      tooMany: (n) => log.push(`tooMany ${n}`),
      sos: () => log.push('sos'),
    },
  );
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
  // A knock happens now and is reported 80 ms later.
  const knock = (label, status = 'pad', confidence = 1) => {
    const t = now;
    advance(80);
    ctl.tap({ label, status, confidence, t });
  };
  // A pattern of n knocks `spacing` ms apart, then a long pause.
  const pattern = (label, n, spacing = 200) => {
    for (let i = 0; i < n; i++) {
      knock(label);
      if (i < n - 1) advance(spacing - 80);
    }
    advance(1000);
  };
  return { ctl, log, advance, knock, pattern };
}

test('confirm off: type × count become commands', () => {
  const h = harness({ confirm: false });
  h.pattern('palm', 1);
  h.pattern('knuckle', 2);
  h.pattern('palm', 3);
  assert.deepEqual(h.log, ['command palmx1', 'command knucklex2', 'command palmx3']);
});

test('the type is a vote across the pattern; unsure knocks count but do not vote', () => {
  const h = harness({ confirm: false });
  h.knock('palm');
  h.advance(120);
  h.knock('knuckle', 'unsure', 0.1);
  h.advance(120);
  h.knock('palm');
  h.advance(1000);
  assert.deepEqual(h.log, ['command palmx3']);
});

test('a mixed palm+knuckle pattern is unsure, not a guess', () => {
  const h = harness({ confirm: false });
  h.knock('palm');
  h.advance(120);
  h.knock('knuckle');
  h.advance(1000);
  assert.deepEqual(h.log, ['unsure mixed']);
});

test('4–5 knocks are a safety gap; 6 fast knocks are SOS and never a command', () => {
  const h = harness({ confirm: false });
  h.pattern('palm', 4);
  assert.deepEqual(h.log, ['tooMany 4']);
  h.pattern('knuckle', 8, 180); // urgent drumming: SOS at the 6th, the rest swallowed
  assert.deepEqual(h.log, ['tooMany 4', 'sos']);
  h.advance(2000);
  h.pattern('palm', 1); // after things go quiet, commands work again
  assert.deepEqual(h.log, ['tooMany 4', 'sos', 'command palmx1']);
});

test('commands done back to back never add up to a false SOS', () => {
  const h = harness({ confirm: false });
  h.pattern('palm', 3);
  h.pattern('knuckle', 3);
  h.pattern('palm', 2);
  assert.deepEqual(h.log, ['command palmx3', 'command knucklex3', 'command palmx2']);
});

test('"not a command" sounds are ignored completely', () => {
  const h = harness({ confirm: false });
  h.knock('x', 'ignored');
  h.advance(150);
  h.knock('palm');
  h.advance(1000);
  assert.deepEqual(h.log, ['command palmx1']);
});

test('confirm: a pattern asks; one palm says it', () => {
  const h = harness();
  h.pattern('knuckle', 2);
  h.pattern('palm', 1);
  assert.deepEqual(h.log, ['ask knucklex2', 'answer yes knucklex2']);
});

test('confirm: one knuckle cancels; silence times out after 4 s', () => {
  const h = harness();
  h.pattern('palm', 3);
  h.pattern('knuckle', 1);
  h.pattern('palm', 2);
  h.advance(4000);
  assert.deepEqual(h.log, ['ask palmx3', 'answer no palmx3', 'ask palmx2', 'answer timeout palmx2']);
});

test('confirm: an answer within 0.4 s of the question is ignored (tremor bounce)', () => {
  const h = harness();
  h.knock('palm');
  h.advance(450 + 120 - 80); // the question is asked at the end of this wait
  h.advance(100);
  h.knock('palm'); // starts 100 ms after the question → bounce
  h.advance(1000);
  assert.deepEqual(h.log, ['ask palmx1']);
});

test('confirm: a new 2–3 knock pattern while asking switches the question', () => {
  const h = harness();
  h.pattern('palm', 1);
  h.pattern('knuckle', 3);
  assert.deepEqual(h.log, ['ask palmx1', 'ask knucklex3']);
});

test('confirm: SOS overrides an open question', () => {
  const h = harness();
  h.pattern('palm', 2);
  h.pattern('palm', 6, 150);
  h.advance(5000);
  assert.deepEqual(h.log, ['ask palmx2', 'sos']);
});

test('vote needs a clear winner', () => {
  assert.equal(vote([{ type: 'palm', confidence: 1 }, { type: 'knuckle', confidence: 0.2 }]), 'palm');
  assert.equal(vote([{ type: 'palm', confidence: 0.5 }, { type: 'knuckle', confidence: 0.5 }]), null);
  assert.equal(vote([{ type: null }]), null);
});
