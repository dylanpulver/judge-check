import test from 'node:test';
import assert from 'node:assert/strict';
import { mean, sd, cohensD, resolveVerdict, calibrate, verdictLine } from '../lib/calibrate.js';

const cand = (id, tier, samples) => ({ id, tier, samples });
const P = (score) => ({ verdict: 'pass', score });
const F = (score) => ({ verdict: 'fail', score });

test('mean and sample sd', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(mean([]), null);
  assert.equal(sd([2, 4, 6]), 2);
  assert.equal(sd([5]), null);
});

test("Cohen's d: pooled-sd formula, and edge cases", () => {
  // groups {8,10} (m=9, s=sqrt(2)) vs {2,4} (m=3, s=sqrt(2)) → d = 6/sqrt(2)
  assert.ok(Math.abs(cohensD([8, 10], [2, 4]) - 6 / Math.SQRT2) < 1e-12);
  assert.equal(cohensD([5], [1, 2]), null); // too few samples
  assert.equal(cohensD([7, 7], [2, 2]), Infinity); // perfect zero-variance separation
  assert.equal(cohensD([3, 3], [3, 3]), 0);
});

test('resolveVerdict: explicit verdict wins, else score threshold, else null', () => {
  assert.equal(resolveVerdict({ verdict: 'fail', score: 9 }, 6), 'fail');
  assert.equal(resolveVerdict({ verdict: null, score: 6 }, 6), 'pass');
  assert.equal(resolveVerdict({ verdict: null, score: 5.9 }, 6), 'fail');
  assert.equal(resolveVerdict({ verdict: null, score: null }, 6), null);
});

test('pass/fail rates per tier and combined decoy rate', () => {
  const m = calibrate([
    cand('r1', 'real', [P(8), P(8)]),
    cand('g1', 'garbage', [F(1), P(7)]), // one garbage pass
    cand('s1', 'subtle', [F(2), F(3)]),
    cand('d1', 'gold', [P(9), F(4)]),   // one gold fail
  ]);
  assert.equal(m.tiers.garbage.passRate, 0.5);
  assert.equal(m.tiers.subtle.passRate, 0);
  assert.equal(m.decoy.passed, 1);
  assert.equal(m.decoy.judged, 4);
  assert.equal(m.tiers.gold.failRate, 0.5);
  assert.deepEqual(m.notable.decoysPassed, [{ id: 'g1', tier: 'garbage' }]);
  assert.deepEqual(m.notable.goldFailed, ['d1']);
});

test('score-only samples resolve through the pass threshold', () => {
  const m = calibrate(
    [cand('r1', 'real', [{ verdict: null, score: 7 }, { verdict: null, score: 3 }])],
    { passThreshold: 6 }
  );
  assert.equal(m.tiers.real.passed, 1);
  assert.equal(m.tiers.real.failed, 1);
  assert.deepEqual(m.flips.flippedIds, ['r1']); // 7→pass, 3→fail is a flip
});

test('flip rate counts candidates whose verdicts disagree across samplings', () => {
  const m = calibrate([
    cand('a', 'real', [P(8), F(4)]),
    cand('b', 'real', [P(8), P(9)]),
    cand('c', 'real', [{ verdict: null, score: null }, P(8)]), // single resolved sample: not comparable
  ]);
  assert.equal(m.flips.comparable, 2);
  assert.equal(m.flips.flipped, 1);
  assert.equal(m.flips.rate, 0.5);
  assert.equal(m.unparsed.count, 1);
  assert.equal(m.unparsed.total, 6);
});

test('score separation aggregates real vs decoy scores', () => {
  const m = calibrate([
    cand('r1', 'real', [P(8), P(10)]),
    cand('g1', 'garbage', [F(2)]),
    cand('s1', 'subtle', [F(4)]),
  ]);
  assert.equal(m.scores.realMean, 9);
  assert.equal(m.scores.decoyMean, 3);
  assert.equal(m.scores.delta, 6);
  assert.equal(m.scores.realN, 2);
  assert.equal(m.scores.decoyN, 2);
});

test('verdict: no decoys → calibration impossible', () => {
  const m = calibrate([cand('r1', 'real', [P(8)])]);
  assert.match(verdictLine(m), /calibration impossible/);
});

test('verdict: passing garbage → nodding', () => {
  const m = calibrate([cand('g1', 'garbage', [P(8), F(1)]), cand('r1', 'real', [P(8)])]);
  assert.match(verdictLine(m), /nodding.*obvious garbage/);
});

test('verdict: most subtle decoys pass → nodding; a few → leaks', () => {
  const half = calibrate([cand('s1', 'subtle', [P(7), P(7), F(2), F(2)])]);
  assert.match(verdictLine(half), /nodding.*subtle-decoy/);
  const leak = calibrate([cand('s1', 'subtle', [P(7), F(2), F(2), F(2)])]);
  assert.match(verdictLine(leak), /leaks/);
});

test('verdict: failing gold → over-strict', () => {
  const m = calibrate([
    cand('g1', 'garbage', [F(1), F(1)]),
    cand('d1', 'gold', [F(3), P(8)]),
  ]);
  assert.match(verdictLine(m), /over-strict/);
});

test('verdict: flips above threshold → inconsistent', () => {
  const m = calibrate([
    cand('g1', 'garbage', [F(1), F(1)]),
    cand('d1', 'gold', [P(8), P(8)]),
    cand('r1', 'real', [P(8), F(3)]),
    cand('r2', 'real', [P(8), F(3)]),
  ]);
  assert.match(verdictLine(m), /inconsistent/);
});

test('verdict: clean run → discriminates (with small-set caveat under 6 decoy judgments)', () => {
  const small = calibrate([
    cand('g1', 'garbage', [F(1), F(1)]),
    cand('d1', 'gold', [P(8), P(8)]),
    cand('r1', 'real', [P(8), P(8)]),
  ]);
  assert.match(verdictLine(small), /discriminates/);
  assert.match(verdictLine(small), /small decoy set/);

  const big = calibrate([
    cand('g1', 'garbage', [F(1), F(1)]),
    cand('s1', 'subtle', [F(2), F(2)]),
    cand('s2', 'subtle', [F(2), F(2)]),
    cand('d1', 'gold', [P(8), P(8)]),
    cand('r1', 'real', [P(8), P(8)]),
  ]);
  assert.match(verdictLine(big), /discriminates/);
  assert.doesNotMatch(verdictLine(big), /small decoy set/);
});
